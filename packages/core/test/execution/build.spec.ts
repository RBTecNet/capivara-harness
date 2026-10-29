import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult, CommandRequest, CommandResult } from '../../src/runtime/types.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import { interpretReview, runBuild } from '../../src/execution/build.js';
import { prepareEnvironmentNode } from '../../src/execution/environment.js';
import type { BuildGateMeasurement } from '../../src/telemetry/progress.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace():Promise<string>{const path=await mkdtemp(join(tmpdir(),'capivara-build-'));temporary.push(path);return path;}
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
function brief():ProductBrief{return{schema:'capivara/product/1',status:'ready',id:'b1',revision:1,name:'Greeting',summary:'CLI greeting',request:'Create a CLI that prints hello using --greet.',modes:['cli'],targets:['portable'],requirements:[{id:'r1',statement:'Print hello for --greet.',mode:'cli',source:{kind:'request',reference:'request',text:'Print hello for --greet.'}}],constraints:[],decisions:[],gaps:[]};}
function task():WorkUnit{return{id:'greet',title:'CLI greeting',goal:'Print hello',instructions:'Create cli.mjs for the greeting command.',requirementIds:['r1'],dependsOn:[],environmentIds:[],contractIds:[],files:['cli.mjs'],criteria:['The documented --greet command prints hello.'],checks:[{id:'greeting',kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expected:'contains:hello',requirementIds:['r1'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};}
function plan(unit=task()):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b1',briefRevision:1,environment:[],contracts:[],tasks:[unit]};}
const goodCode="if(process.argv.includes('--greet')) console.log('hello'); else if(process.argv.includes('--stdin')){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data', chunk=>input+=chunk);process.stdin.on('end',()=>console.log(input.trim()));}else process.exitCode=2;";

describe('build cooperativo por evidência',()=>{
  it('recria entradas privadas alteradas por uma verificação antes de recuperar a próxima prova',async()=>{
    const root=await workspace(),unit=task();unit.files.push('state.json');
    unit.checks.push({id:'runner-ready',kind:'command',command:process.execPath,args:['-e',"console.log('READY')"],inputs:['cli.mjs'],level:'behavior',expected:'The runner reports readiness.',requirementIds:[],requiredCapabilities:[]});
    let edits=0,assertions=0,reviews=0;
    const result=await runBuild({workspace:root,brief:brief(),plan:plan(unit),agent:async request=>{
      if(request.role==='editor'){
        edits++;await writeFile(join(request.workspace,'cli.mjs'),"import fs from 'node:fs';if(fs.readFileSync('state.json','utf8')!=='0')throw Error('stale verification state');fs.writeFileSync('state.json','1');console.log('hello');");
        await writeFile(join(request.workspace,'state.json'),'0');return complete();
      }
      if(request.role==='repair'&&request.context?.includes('bind-observed-assertion')){assertions++;return complete(JSON.stringify({assertions:[{checkId:'runner-ready',assertion:{type:'contains',source:'stdout',value:'READY'}}]}));}
      if(request.role==='reviewer'){reviews++;return complete('{"approved":true}');}
      throw Error('A private temporary-state change must not authorize a product repair.');
    }});
    expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
    expect({edits,assertions,reviews}).toEqual({edits:1,assertions:1,reviews:1});
    expect(result.state.metrics?.repetitions.some(item=>item.action==='replace-mutated-verification-workspace')).toBe(true);
    expect(result.state.evidence.some(proof=>proof.output.includes('stale verification state'))).toBe(false);
    expect(await readFile(join(root,'state.json'),'utf8')).toBe('0');
  });

  it('encaminha defeito material do aceite final à entrega responsável e preserva a independente',async()=>{
    const root=await workspace();const product=brief();product.requirements[0]!.statement='Print hello normally and extra with --extra.';product.requirements[0]!.source.text=product.requirements[0]!.statement;
    product.requirements.push({id:'r2',statement:'Print stable independently.',mode:'cli',source:{kind:'request',reference:'request',text:'Print stable independently.'}});
    const second:WorkUnit={...task(),id:'secondary',title:'Stable command',goal:'Print stable independently',requirementIds:['r2'],files:['stable.mjs'],checks:[{id:'stable',kind:'cli',command:process.execPath,args:['stable.mjs'],expected:'contains:stable',requirementIds:['r2'],requiredCapabilities:[]}]};
    const productPlan=plan();productPlan.tasks.push(second);productPlan.acceptance=[{id:'mandatory-extra',kind:'cli',command:process.execPath,args:['cli.mjs','--extra'],expected:'contains:extra',requirementIds:['r1'],requiredCapabilities:[]}];
    const edits:Record<string,number>={greet:0,secondary:0};
    const result=await runBuild({workspace:root,brief:product,plan:productPlan,agent:async request=>{
      if(request.role==='reviewer')return complete('{"approved":true}');
      const id=request.context!.match(/Work unit (\w+):/)![1]!;edits[id]=(edits[id]??0)+1;
      await writeFile(join(request.workspace,id==='secondary'?'stable.mjs':'cli.mjs'),id==='secondary'?"console.log('stable');":edits.greet===1?"console.log('hello');":"console.log(process.argv.includes('--extra')?'extra':'hello');");return complete();
    }});
    expect(result.status).toBe('complete');expect(edits).toEqual({greet:2,secondary:1});expect(result.state.acceptance?.some(proof=>proof.checkId==='mandatory-extra'&&proof.passed)).toBe(true);
  });

  it('reproduz uma alegação de comando somente leitura em área gravável antes de autorizar qualquer reparo',async()=>{
    const root=await workspace();let edits=0,reviews=0;
    const result=await runBuild({workspace:root,brief:brief(),plan:plan(),agent:async request=>{
      if(request.role==='editor'){edits++;await writeFile(join(request.workspace,'cli.mjs'),"import fs from 'node:fs';fs.writeFileSync('scratch.db','temporary verification state');console.log('hello');");return complete();}
      if(request.role==='repair'){edits++;throw new Error('An inspection restriction must not authorize a product rewrite.');}
      reviews++;
      return complete(reviews===1?JSON.stringify({approved:false,findings:[{kind:'product',evidenceType:'inspection-command',file:'cli.mjs',observed:'The inspection command could not create its scratch database.',expected:'The documented command works in a writable execution area.',evidence:'EROFS from the read-only inspection environment.',fix:'Rewrite the storage implementation.',verification:{kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expected:'contains:hello',requiredCapabilities:[]}}]}):JSON.stringify({approved:true,findings:[]}));
    }});
    expect(result.status).toBe('complete');expect(edits).toBe(1);expect(reviews).toBe(2);
    const assessment=result.state.tasks.greet!.reviews![0]!.assessment;
    expect(assessment.original).toContain('EROFS');expect(assessment.findings[0]?.kind).toBe('instrument');expect(assessment.transformations.some(change=>change.reason.includes('not reproduced'))).toBe(true);
    await expect(readFile(join(root,'scratch.db'))).rejects.toThrow();
  });

  it('limita o esclarecimento de parecer sem defeito e preserva código quando o instrumento permanece indisponível',async()=>{
    expect(interpretReview('Complete input validation is missing; malformed input crashes.').approved).toBe(false);
    expect(interpretReview('Approved.').approved).toBe(true);
    const root=await workspace();let editorCalls=0,reviewCalls=0;
    const result=await runBuild({workspace:root,brief:brief(),plan:plan(),contextChars:12000,agent:async request=>{
      expect(request.context?.length??0).toBeLessThanOrEqual(12000);
      if(request.role==='editor'){editorCalls++;await writeFile(join(request.workspace,'cli.mjs'),goodCode);return complete();}
      if(request.role==='reviewer'){
        reviewCalls++;
        if(reviewCalls===2)return{status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'context',message:'The provider rejected the context.',recoverable:true}};
        return complete(reviewCalls===1?JSON.stringify({approved:false,findings:[{observed:'Missing unit tests',evidence:'No test files were added',fix:'Create more tests'}]}):JSON.stringify({approved:true,findings:[]}));
      }
      throw new Error(`Unexpected role ${request.role}`);
    }});
    expect(result.status).toBe('waiting');expect(editorCalls).toBe(1);expect(reviewCalls).toBe(2);expect(result.incidents.some(item=>item.kind==='instrument')).toBe(true);
    expect(result.state.evidence[0]?.output).toContain('hello');
  });

  it('retoma um parecer indisponível sem repetir edição ou verificação confirmada',async()=>{
    const root=await workspace();let edits=0,checks=0,unavailable=true,mutateReview=true;
    const agent=async(request:Parameters<Parameters<typeof runBuild>[0]['agent']>[0]):Promise<AgentResult>=>{
      if(request.role==='editor'){edits++;await writeFile(join(request.workspace,'cli.mjs'),goodCode);return complete();}
      if(unavailable)return{status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'rate-limit',message:'retry later',recoverable:true}};
      if(mutateReview){mutateReview=false;await writeFile(join(request.workspace,'cli.mjs'),`${goodCode}\n// reviewer changed this file`);return{...complete('{"approved":true}'),changedFiles:['cli.mjs']};}
      return complete('{"approved":true}');
    };
    const execute=async(request:CommandRequest):Promise<CommandResult>=>{checks++;return executeCommand(request);};
    const first=await runBuild({workspace:root,brief:brief(),plan:plan(),agent,executeCommand:execute});
    expect(first.status).toBe('waiting');expect(first.state.tasks.greet?.strategy).toBe('resume-review');
    unavailable=false;
    const second=await runBuild({workspace:root,brief:brief(),plan:first.plan,state:first.state,configurationRevision:'transport-ready',agent,executeCommand:execute});
    expect(second.status).toBe('complete');expect(edits).toBe(1);expect(checks).toBe(1);
    await writeFile(join(root,'package.json'),'{"name":"greeting","version":"1.0.0"}');
    const third=await runBuild({workspace:root,brief:brief(),plan:second.plan,state:second.state,agent,executeCommand:execute});
    expect(third.status).toBe('complete');expect(edits).toBe(1);expect(checks).toBe(2);
  });

  it('corrige o comportamento defeituoso com orientação concreta e preserva o restante',async()=>{
    const root=await workspace();await writeFile(join(root,'user.txt'),'preserve this');let edits=0,diagnoses=0;
    const gates:BuildGateMeasurement[]=[];
    const productPlan=plan();productPlan.tasks[0]!.checks.push({id:'invalid-arguments',kind:'cli',command:process.execPath,args:['cli.mjs','--invalid'],expected:'stdout vazio; código de saída 2.',expectedExitCode:2,assertion:{type:'all',assertions:[{type:'empty',source:'stdout'},{type:'exit',value:2}]},requirementIds:['r1'],requiredCapabilities:[]});
    productPlan.tasks[0]!.checks.push({id:'greeting-exit',kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expectedExitCode:0,expected:'exit:0',requirementIds:['r1'],requiredCapabilities:[]},{id:'stdin-greeting',kind:'cli',command:process.execPath,args:['cli.mjs','--stdin'],input:['hello\n'],expected:'contains:hello',requirementIds:['r1'],requiredCapabilities:[]});
    const result=await runBuild({workspace:root,brief:brief(),plan:productPlan,onEvent:event=>{if('gate' in event&&event.gate)gates.push(event.gate);},agent:async request=>{
      if(request.role==='editor'||request.role==='repair'){
        edits++;if(edits===2)expect(`${request.instruction}\n${request.context}`).toContain('hello');
        if(edits===2)return complete();
        if(edits===3){await writeFile(join(request.workspace,'cli.mjs'),"import http from 'node:http'; http.createServer((req,res)=>res.end('hello')).listen(8080);");await writeFile(join(request.workspace,'repair-note.txt'),'preserve unrelated repair work');return complete();}
        await writeFile(join(request.workspace,'cli.mjs'),edits===1?"console.log('wrong')":goodCode);return complete();
      }
      if(request.instruction.startsWith('Diagnose this repeated failure')){diagnoses++;expect(request.readOnly).toBe(true);return complete(JSON.stringify({kind:'product',cause:'The greeting still prints wrong and invalid arguments still exit 0.',fix:'Implement the --greet branch returning hello, accept stdin only with --stdin, and reject all other arguments with exit code 2.'}));}
      return complete('{"approved":true,"findings":[]}');
    }});
    expect(result.status).toBe('complete');expect(edits).toBe(4);expect(diagnoses).toBe(1);
    const checks=gates.filter(gate=>gate.gate==='G2');
    const returned=checks.findIndex(gate=>gate.status==='returned');
    expect(returned).toBeGreaterThanOrEqual(0);
    expect(checks.slice(returned+1).some(gate=>gate.status==='running')).toBe(true);
    expect(checks.at(-1)?.status).toBe('complete');
    expect(result.state.evidence.some(value=>value.checkId==='greeting-exit'&&value.passed)).toBe(true);expect(result.state.evidence.some(value=>value.checkId==='stdin-greeting'&&value.passed)).toBe(true);
    expect(await readFile(join(root,'user.txt'),'utf8')).toBe('preserve this');
    expect(await readFile(join(root,'repair-note.txt'),'utf8')).toBe('preserve unrelated repair work');
  });

  it('troca um instrumento web incompatível sem alterar outra vez uma CLI correta',async()=>{
    const root=await workspace();let edits=0,recipeRepairs=0;
    const unit=task();unit.checks=[{id:'wrong-browser',kind:'web',command:'npx playwright test',requirementIds:['r1'],requiredCapabilities:['browser']}];
    const result=await runBuild({workspace:root,brief:brief(),plan:plan(unit),agent:async request=>{
      if(request.role==='editor'){edits++;await writeFile(join(request.workspace,'cli.mjs'),goodCode);return complete();}
      if(request.role==='repair'){recipeRepairs++;expect(request.readOnly).toBe(true);return complete(JSON.stringify({checks:[{kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expected:'contains:hello',requiredCapabilities:[]}]}));}
      return complete('{"approved":true}');
    }});
    expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect(edits).toBe(1);expect(recipeRepairs).toBe(1);
    expect(result.state.tasks.greet?.checks?.[0]?.kind).toBe('cli');
  });

  it('reconcilia lockfile incompatível durante o preparo sem transformar preferência em falha',async()=>{
    const root=await workspace();const commands:string[]=[];let installed=false;
    const result=await prepareEnvironmentNode(root,{id:'deps',name:'packages',kind:'package',dependsOn:[],targets:['portable'],reason:'Required CLI dependency',check:{command:'check-dependency'},prepare:[{command:'npm ci'}]},brief(),async request=>{
      const command=typeof request.command==='string'?request.command:request.command.join(' ');commands.push(command);
      const success=command==='check-dependency'?installed:command==='npm install';if(command==='npm install')installed=true;
      return{command,cwd:request.cwd,exitCode:success?0:1,stdout:'',stderr:command==='npm ci'?'npm ERR! code EUSAGE: lockfile out of sync':'',durationMs:0,timedOut:false,cancelled:false,signal:null,fingerprint:command};
    });
    expect(result.ready).toBe(true);expect(commands).toEqual(['check-dependency','npm ci','npm install','check-dependency']);
  });

  it('recupera a prova TUI ausente e um waitFor descritivo sem replanejar ou reeditar',async()=>{
    if(process.platform!=='linux')return;
    const root=await workspace();const product=brief();product.modes=['tui'];product.requirements[0]!.mode='tui';product.request='Create a TUI menu: j selects next; q quits.';
    const unit=task();unit.files=['menu.mjs'];unit.instructions='Create the interactive menu.';unit.checks=[{id:'syntax',kind:'command',command:process.execPath,args:['--check','menu.mjs'],requirementIds:['r1'],requiredCapabilities:[]}];
    let edits=0,recipeRepairs=0;const productPlan=plan(unit);unit.environmentIds=['pty'];productPlan.environment=[{id:'pty',name:'Interactive terminal',kind:'tool',dependsOn:[],targets:['portable'],reason:'Native terminal input is required.',check:{command:process.execPath,args:['-e','if(!process.stdin.isTTY)process.exit(3)'],capabilities:['pty']},prepare:[]}];
    const gates:BuildGateMeasurement[]=[];
    const result=await runBuild({workspace:root,brief:product,plan:productPlan,runTerminal,onEvent:event=>{if('gate' in event&&event.gate)gates.push(event.gate);},repairPlan:async()=>{throw new Error('An instrument failure cannot replan the product.');},agent:async request=>{
      if(request.role==='editor'){edits++;await writeFile(join(request.workspace,'menu.mjs'),"process.stdin.setRawMode(true);process.stdin.resume();console.log('READY');process.stdin.on('data', b=>{if(b.toString()==='j')console.log('SELECTED 2');if(b.toString()==='q')process.exit(0);});");return complete();}
      if(request.role==='repair'){recipeRepairs++;expect(request.readOnly).toBe(true);if(recipeRepairs>1){expect(request.context).toContain('STDOUT:');expect(request.context).toContain('READY');expect(request.context).toContain('Runtime issue');}return complete(JSON.stringify({checks:[{kind:'tui',command:process.execPath,args:['menu.mjs'],steps:[{waitFor:recipeRepairs===1?'READY visível no terminal':'READY',timeoutMs:150},{input:'j',waitFor:'SELECTED 2'}],closeInput:'q',expected:'contains:SELECTED 2',requiredCapabilities:[]}]}));}
      return complete('{"approved":true}');
    }});
    expect(result.status).toBe('complete');expect(edits).toBe(1);expect(recipeRepairs).toBe(2);expect(result.plan.tasks).toHaveLength(1);expect(result.state.evidence.find(value=>value.kind==='tui')?.terminal).toBe(true);expect(result.state.evidence.find(value=>value.kind==='tui')?.output).toContain('SELECTED 2');
    expect(gates.some(gate=>gate.gate==='G4'&&gate.status==='returned')).toBe(true);
    expect(gates.filter(gate=>gate.gate==='G4').at(-1)?.status).toBe('complete');
  },10000);
});
