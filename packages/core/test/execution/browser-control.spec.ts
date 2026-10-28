import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { createBuildState, runBuild } from '../../src/execution/build.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { digest } from '../../src/execution/files.js';
import type { BuildOptions, BuildState } from '../../src/execution/types.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { AgentResult } from '../../src/runtime/types.js';

// This fixture proves engine control and real child-process/environment wiring.
// It deliberately models the browser provider and does not claim a physical GUI.
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
async function seedCache(directory:string){
  for(const name of ['chromium','chromium_headless_shell','ffmpeg']){
    const folder=join(directory,`${name}-1`);await mkdir(folder,{recursive:true});await writeFile(join(folder,'browser'),'usable');
  }
}
async function fixture(){
  const workspace=await mkdtemp(join(tmpdir(),'capivara-browser-control-'));roots.push(workspace);
  const pkg=join(workspace,'node_modules','playwright'),core=join(workspace,'node_modules','playwright-core');
  await mkdir(pkg,{recursive:true});await mkdir(core,{recursive:true});
  await writeFile(join(workspace,'package.json'),JSON.stringify({name:'control-fixture',private:true,scripts:{e2e:`"${process.execPath}" node_modules/playwright/cli.cjs test alpha.mjs`}}));
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'playwright',version:'1.0.0',main:'index.cjs',bin:{playwright:'cli.cjs'}}));
  await writeFile(join(core,'package.json'),JSON.stringify({name:'playwright-core',version:'1.0.0',main:'index.cjs'}));
  await writeFile(join(core,'browsers.json'),JSON.stringify({browsers:['chromium','chromium-headless-shell','ffmpeg'].map(name=>({name,revision:'1'}))}));
  await writeFile(join(pkg,'index.cjs'),`const fs=require('node:fs'),path=require('node:path');const executable=()=>path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium-1','browser');exports.chromium={executablePath:executable,async launch(options){if(options.headless!==true)throw Error('expected headless readiness');for(const name of ['chromium','chromium_headless_shell','ffmpeg'])if(fs.readFileSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,name+'-1','browser'),'utf8')!=='usable')throw Error('provider is unavailable');return{version(){return 'fixture-provider-1'},async close(){}}}};`);
  await writeFile(join(pkg,'cli.cjs'),`const fs=require('node:fs'),path=require('node:path');(async()=>{if(process.argv[2]==='install'){fs.writeFileSync(path.join(__dirname,'unexpected-install'),'attempted');throw Error('the seeded provider must be adopted without installation');}if(process.argv[2]!=='test')throw Error('unexpected CLI command');const cache=process.env.PLAYWRIGHT_BROWSERS_PATH;if(!cache||!cache.includes(path.join('.capivara-next','providers','playwright')))throw Error('proof did not receive the prepared fixed cache');const browser=await require('./index.cjs').chromium.launch({headless:true});const result=require('node:child_process').spawnSync(process.execPath,[process.argv[3]],{cwd:process.cwd(),encoding:'utf8'});await browser.close();process.stdout.write('FIXED_CACHE='+cache+'\\n'+result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;})().catch(error=>{process.stderr.write(String(error.stack||error));process.exitCode=1});`);
  const brief:ProductBrief={schema:'capivara/product/1',id:'web-control',revision:1,status:'ready',name:'Alpha',summary:'Observe alpha through the requested web proof.',request:'Create a web interface with a real observable alpha flow.',modes:['web'],targets:['browser'],constraints:[],decisions:[],gaps:[],requirements:[{id:'alpha',statement:'The web flow observes alpha.',mode:'web',kind:'interface',source:{kind:'request',reference:'request',text:'Create a web interface with a real observable alpha flow.'}}]};
  const task:WorkUnit={id:'alpha-ui',title:'Alpha flow',goal:'Expose alpha in the requested flow.',instructions:'Implement the alpha entrypoint.',requirementIds:['alpha'],dependsOn:[],environmentIds:[],contractIds:[],files:['alpha.mjs'],criteria:['The observed flow returns alpha.'],checks:[{id:'alpha-browser',kind:'web',command:'npm',args:['run','e2e'],expected:'The observed flow returns alpha.',assertion:{type:'contains',source:'stdout',value:'alpha'},level:'behavior',inputs:['alpha.mjs','node_modules/playwright/cli.cjs','node_modules/playwright/index.cjs','node_modules/playwright-core/browsers.json'],requirementIds:['alpha'],requiredCapabilities:['browser']}],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:brief.revision,environment:[],contracts:[],tasks:[task]};
  return{workspace,pkg,brief,task,plan};
}

describe('recursos de navegador no controle completo do build',()=>{
  for(const seed of ['canonical','editor'] as const)it(`adota o cache ${seed}, usa a prova privada e retoma sem replay nem perder o provider`,async()=>{
    const f=await fixture();
    let state:BuildState|undefined;
    if(seed==='canonical')await seedCache(join(f.workspace,'.capivara-runtime','cache','ms-playwright'));
    else{
      const checkpoint=await createTaskWorkspace(f.workspace,f.task.id,digest(JSON.stringify(f.task)),f.task.files);
      await seedCache(join(checkpoint.directory,'.capivara-runtime','cache','ms-playwright'));
      state=createBuildState(f.plan);
      state.tasks[f.task.id]={status:'pending',revision:'',attempts:0,changedFiles:[],findings:[],strategy:'implement',actions:[],reviews:[],checkpoint};
    }
    let editors=0,reviewers=0,productCommands=0;
    const adopted:string[]=[];const taskCopies=new Set<string>();const proofCopies=new Set<string>();
    const snapshots:{state:BuildState;plan:DevelopmentPlan}[]=[];
    const options:BuildOptions={workspace:f.workspace,brief:f.brief,plan:f.plan,...(state?{state}:{}),signal:AbortSignal.timeout(10000),agent:async request=>{
      if(request.role==='reviewer'){reviewers++;return complete('{"approved":true,"findings":[]}');}
      expect(request.role).toBe('editor');editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");\n');return complete();
    },executeCommand:async request=>{
      if(request.executionPolicy?.purpose==='verification'){productCommands++;proofCopies.add(request.cwd);}
      return executeCommand(request);
    },onEvent:event=>{
      if(event.type==='environment'&&'detail' in event&&event.detail&&typeof event.detail==='object'&&'changed' in event.detail&&event.detail.changed===true)adopted.push(JSON.stringify(event.detail));
    },onState:async(saved,plan)=>{
      expect(saved.planRevision).toBe(plan.revision);
      expect(plan.tasks.map(task=>task.id)).toContain(f.task.id);
      const checkpoint=saved.tasks[f.task.id]?.checkpoint;
      if(checkpoint)taskCopies.add(checkpoint.directory);
      snapshots.push({state:structuredClone(saved),plan:structuredClone(plan)});
    }};
    const result=await runBuild(options);
    expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
    expect(editors).toBe(1);expect(reviewers).toBe(1);expect(productCommands).toBe(1);expect(adopted).toHaveLength(1);
    expect(proofCopies.size).toBe(1);expect([...proofCopies][0]).not.toBe(f.workspace);
    const resource=Object.values(result.state.environment).find(item=>item.operational&&JSON.stringify(item.operational).includes('playwright-browser'))!;
    const operational=resource.operational as {env:Record<string,string>;bindings:Record<string,{relocation?:string;fingerprint?:string}>};
    const cache=operational.env.PLAYWRIGHT_BROWSERS_PATH!;
    expect(cache).toContain(join(f.workspace,'.capivara-next','providers','playwright'));
    expect(operational.bindings.browser?.relocation).toBe('fixed');
    expect(resource.fingerprint).toBe(operational.bindings.browser?.fingerprint);
    expect(await readFile(join(cache,'chromium-1','browser'),'utf8')).toBe('usable');
    await expect(readFile(join(f.pkg,'unexpected-install'))).rejects.toMatchObject({code:'ENOENT'});
    for(const copy of taskCopies)await expect(stat(dirname(copy))).rejects.toMatchObject({code:'ENOENT'});
    const proof=result.state.evidence.find(item=>item.checkId==='alpha-browser'&&item.passed)!;
    expect(proof.observation?.stdout).toContain(`FIXED_CACHE=${cache}`);
    expect(snapshots.at(-1)?.state.tasks[f.task.id]?.status).toBe('complete');
    const before=result.state.evidence.length;
    const resumed=await runBuild({...options,plan:result.plan,state:JSON.parse(JSON.stringify(result.state)),signal:AbortSignal.timeout(10000)});
    expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');
    expect(editors).toBe(1);expect(reviewers).toBe(1);expect(productCommands).toBe(1);expect(adopted).toHaveLength(1);
    expect(resumed.state.evidence).toHaveLength(before);
    expect(await readFile(join(cache,'chromium-1','browser'),'utf8')).toBe('usable');
  });
});

describe('provas web embrulhadas em preparação redundante de navegador',()=>{
  for(const wrapper of ['shell','npm-script'] as const)it.skipIf(process.platform==='win32')(`normaliza ${wrapper} sem executar install no produto nem perder a modalidade web`,async()=>{
    const {symlink}=await import('node:fs/promises');
    const f=await fixture();await mkdir(join(f.workspace,'node_modules/.bin'));await symlink('../playwright/cli.cjs',join(f.workspace,'node_modules/.bin/playwright'));
    await seedCache(join(f.workspace,'.capivara-runtime/cache/ms-playwright'));
    const program='npx playwright install chromium && npx playwright test alpha.mjs --reporter=line';
    if(wrapper==='npm-script')await writeFile(join(f.workspace,'package.json'),JSON.stringify({scripts:{e2e:program}}));
    f.task.checks[0]!.kind='command';
    if(wrapper==='shell'){f.task.checks[0]!.command='/bin/bash';f.task.checks[0]!.args=['-lc',program];}
    let editors=0,reviewers=0,repairs=0,proofs=0;
    const result=await runBuild({workspace:f.workspace,brief:f.brief,plan:f.plan,signal:AbortSignal.timeout(10000),executeCommand:async request=>{
      if(request.executionPolicy?.purpose==='verification'){proofs++;expect(typeof request.command).not.toBe('string');expect(request.command).not.toContain('install');expect(request.command[0]).toBe(process.execPath);}
      return executeCommand(request);
    },agent:async request=>{
      if(request.role==='reviewer'){reviewers++;return complete('{"approved":true,"findings":[]}');}
      if(request.role==='repair'){repairs++;return complete('{}');}
      editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");');return complete();
    }});
    expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect({editors,reviewers,repairs,proofs}).toEqual({editors:1,reviewers:1,repairs:0,proofs:1});
    expect(result.state.evidence.some(proof=>proof.kind==='web'&&proof.passed&&proof.level==='behavior')).toBe(true);expect(Object.keys(result.state.resourceBindings?.[f.task.id]??{})).toHaveLength(1);
    await expect(readFile(join(f.pkg,'unexpected-install'))).rejects.toMatchObject({code:'ENOENT'});
  });
});
