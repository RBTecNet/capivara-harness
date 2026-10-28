import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult, CommandRequest, CommandResult } from '../../src/runtime/types.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
import { interpretReview, runBuild } from '../../src/execution/build.js';
import { prepareEnvironmentNode } from '../../src/execution/environment.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace():Promise<string>{const path=await mkdtemp(join(tmpdir(),'capivara-build-'));temporary.push(path);return path;}
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
function brief():ProductBrief{return{schema:'capivara/product/1',status:'ready',id:'b1',revision:1,name:'Greeting',summary:'CLI greeting',request:'Create a CLI that prints hello using --greet.',modes:['cli'],targets:['portable'],requirements:[{id:'r1',statement:'Print hello for --greet.',mode:'cli',source:{kind:'request',reference:'request',text:'Print hello for --greet.'}}],constraints:[],decisions:[],gaps:[]};}
function task():WorkUnit{return{id:'greet',title:'CLI greeting',goal:'Print hello',instructions:'Create cli.mjs for the greeting command.',requirementIds:['r1'],dependsOn:[],environmentIds:[],contractIds:[],files:['cli.mjs'],criteria:['The documented --greet command prints hello.'],checks:[{id:'greeting',kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expected:'contains:hello',requirementIds:['r1'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};}
function plan(unit=task()):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b1',briefRevision:1,environment:[],contracts:[],tasks:[unit]};}
const goodCode="if(process.argv.includes('--greet')) console.log('hello'); else if(process.argv.includes('--stdin')){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data', chunk=>input+=chunk);process.stdin.on('end',()=>console.log(input.trim()));}else process.exitCode=2;";

describe('build cooperativo por evidência',()=>{
  it('esclarece uma exigência de testes sem defeito e um contexto excedido sem reeditar',async()=>{
    expect(interpretReview('Complete input validation is missing; malformed input crashes.').approved).toBe(false);
    expect(interpretReview('Approved.').approved).toBe(true);
    const root=await workspace();let editorCalls=0,reviewCalls=0;
    const result=await runBuild({workspace:root,brief:brief(),plan:plan(),contextChars:12000,agent:async request=>{
      expect(request.context?.length??0).toBeLessThanOrEqual(12000);
      if(request.role==='editor'){editorCalls++;await writeFile(join(root,'cli.mjs'),goodCode);return complete();}
      if(request.role==='reviewer'){
        reviewCalls++;
        if(reviewCalls===2)return{status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'context',message:'The provider rejected the context.',recoverable:true}};
        return complete(reviewCalls===1?JSON.stringify({approved:false,findings:[{observed:'Missing unit tests',evidence:'No test files were added',fix:'Create more tests'}]}):JSON.stringify({approved:true,findings:[]}));
      }
      throw new Error(`Unexpected role ${request.role}`);
    }});
    expect(result.status).toBe('complete');expect(editorCalls).toBe(1);expect(reviewCalls).toBe(3);
    expect(result.state.evidence[0]?.output).toContain('hello');
  });

  it('retoma um parecer indisponível sem repetir edição ou verificação confirmada',async()=>{
    const root=await workspace();let edits=0,checks=0,unavailable=true,mutateReview=true;
    const agent=async(request:Parameters<Parameters<typeof runBuild>[0]['agent']>[0]):Promise<AgentResult>=>{
      if(request.role==='editor'){edits++;await writeFile(join(root,'cli.mjs'),goodCode);return complete();}
      if(unavailable)return{status:'unavailable',text:'',commands:[],changedFiles:[],issue:{kind:'rate-limit',message:'retry later',recoverable:true}};
      if(mutateReview){mutateReview=false;await writeFile(join(root,'cli.mjs'),`${goodCode}\n// reviewer changed this file`);return{...complete('{"approved":true}'),changedFiles:['cli.mjs']};}
      return complete('{"approved":true}');
    };
    const execute=async(request:CommandRequest):Promise<CommandResult>=>{checks++;return executeCommand(request);};
    const first=await runBuild({workspace:root,brief:brief(),plan:plan(),agent,executeCommand:execute});
    expect(first.status).toBe('waiting');expect(first.state.tasks.greet?.strategy).toBe('resume-review');
    unavailable=false;
    const second=await runBuild({workspace:root,brief:brief(),plan:first.plan,state:first.state,agent,executeCommand:execute});
    expect(second.status).toBe('complete');expect(edits).toBe(1);expect(checks).toBe(2);
    await writeFile(join(root,'package.json'),'{"name":"greeting","version":"1.0.0"}');
    const third=await runBuild({workspace:root,brief:brief(),plan:second.plan,state:second.state,agent,executeCommand:execute});
    expect(third.status).toBe('complete');expect(edits).toBe(1);expect(checks).toBe(3);
  });

  it('corrige o comportamento defeituoso com orientação concreta e preserva o restante',async()=>{
    const root=await workspace();await writeFile(join(root,'user.txt'),'preserve this');let edits=0,diagnoses=0;
    const productPlan=plan();productPlan.tasks[0]!.checks.push({id:'invalid-arguments',kind:'cli',command:process.execPath,args:['cli.mjs','--invalid'],expected:'stdout vazio; código de saída 2.',requirementIds:['r1'],requiredCapabilities:[]});
    productPlan.tasks[0]!.checks.push({id:'greeting-exit',kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expectedExitCode:0,expected:'exit:0',requirementIds:['r1'],requiredCapabilities:[]},{id:'stdin-greeting',kind:'cli',command:process.execPath,args:['cli.mjs','--stdin'],input:['hello\n'],expected:'contains:hello',requirementIds:['r1'],requiredCapabilities:[]});
    const result=await runBuild({workspace:root,brief:brief(),plan:productPlan,agent:async request=>{
      if(request.role==='editor'||request.role==='repair'){
        edits++;if(edits===2)expect(request.instruction).toContain('hello');
        if(edits===2)return complete();
        if(edits===3){await writeFile(join(root,'cli.mjs'),"import http from 'node:http'; http.createServer((req,res)=>res.end('hello')).listen(8080);");await writeFile(join(root,'repair-note.txt'),'preserve unrelated repair work');return complete();}
        await writeFile(join(root,'cli.mjs'),edits===1?"console.log('wrong')":goodCode);return complete();
      }
      if(request.instruction.startsWith('Diagnose this repeated failure')){diagnoses++;expect(request.readOnly).toBe(true);return complete(JSON.stringify({kind:'product',cause:'The greeting still prints wrong and invalid arguments still exit 0.',fix:'Implement the --greet branch returning hello, accept stdin only with --stdin, and reject all other arguments with exit code 2.'}));}
      return complete('{"approved":true,"findings":[]}');
    }});
    expect(result.status).toBe('complete');expect(edits).toBe(4);expect(diagnoses).toBe(1);
    expect(result.state.evidence.some(value=>value.checkId==='greeting-exit'&&value.passed)).toBe(true);expect(result.state.evidence.some(value=>value.checkId==='stdin-greeting'&&value.passed)).toBe(true);
    expect(await readFile(join(root,'user.txt'),'utf8')).toBe('preserve this');
    expect(await readFile(join(root,'repair-note.txt'),'utf8')).toBe('preserve unrelated repair work');
  });

  it('troca um instrumento web incompatível sem alterar outra vez uma CLI correta',async()=>{
    const root=await workspace();let edits=0,recipeRepairs=0;
    const unit=task();unit.checks=[{id:'wrong-browser',kind:'web',command:'npx playwright test',requirementIds:['r1'],requiredCapabilities:['browser']}];
    const result=await runBuild({workspace:root,brief:brief(),plan:plan(unit),agent:async request=>{
      if(request.role==='editor'){edits++;await writeFile(join(root,'cli.mjs'),goodCode);return complete();}
      if(request.role==='repair'){recipeRepairs++;expect(request.readOnly).toBe(true);return complete(JSON.stringify({checks:[{kind:'cli',command:process.execPath,args:['cli.mjs','--greet'],expected:'contains:hello',requiredCapabilities:[]}]}));}
      return complete('{"approved":true}');
    }});
    expect(result.status).toBe('complete');expect(edits).toBe(1);expect(recipeRepairs).toBe(1);
    expect(result.plan.tasks[0]?.checks[0]?.kind).toBe('cli');
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
    const result=await runBuild({workspace:root,brief:product,plan:productPlan,runTerminal,repairPlan:async()=>{throw new Error('An instrument failure cannot replan the product.');},agent:async request=>{
      if(request.role==='editor'){edits++;await writeFile(join(root,'menu.mjs'),"process.stdin.setRawMode(true);process.stdin.resume();console.log('READY');process.stdin.on('data', b=>{if(b.toString()==='j')console.log('SELECTED 2');if(b.toString()==='q')process.exit(0);});");return complete();}
      if(request.role==='repair'){recipeRepairs++;expect(request.readOnly).toBe(true);if(recipeRepairs>1){expect(request.context).toContain('STDOUT:');expect(request.context).toContain('READY');expect(request.context).toContain('Runtime issue');}return complete(JSON.stringify({checks:[{kind:'tui',command:process.execPath,args:['menu.mjs'],steps:[{waitFor:recipeRepairs===1?'READY visível no terminal':'READY',timeoutMs:150},{input:'j',waitFor:'SELECTED 2'}],closeInput:'q',expected:'contains:SELECTED 2',requiredCapabilities:[]}]}));}
      return complete('{"approved":true}');
    }});
    expect(result.status).toBe('complete');expect(edits).toBe(1);expect(recipeRepairs).toBe(2);expect(result.plan.tasks).toHaveLength(1);expect(result.state.evidence.find(value=>value.kind==='tui')?.terminal).toBe(true);expect(result.state.evidence.find(value=>value.kind==='tui')?.output).toContain('SELECTED 2');
  },10000);
});
