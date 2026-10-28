import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildState, runBuild } from '../../src/execution/build.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});

it('reconciles a missing interface proof after malformed local repair without discarding existing product work',async()=>{
  // The browser API is a deterministic control fixture. Its CLI and the product
  // both run as real child processes; this test claims no physical GUI evidence.
  const root=await mkdtemp(join(tmpdir(),'capivara-proof-contract-'));roots.push(root);
  const pkg=join(root,'node_modules','playwright'),core=join(root,'node_modules','playwright-core');
  await mkdir(pkg,{recursive:true});await mkdir(core,{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{e2e:`"${process.execPath}" node_modules/playwright/cli.cjs test alpha.mjs`}}));
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'playwright',version:'1.0.0',main:'index.cjs',bin:{playwright:'cli.cjs'}}));
  await writeFile(join(core,'package.json'),JSON.stringify({name:'playwright-core',version:'1.0.0',main:'index.cjs'}));
  await writeFile(join(core,'browsers.json'),JSON.stringify({browsers:['chromium','chromium-headless-shell','ffmpeg'].map(name=>({name,revision:'1'}))}));
  await writeFile(join(pkg,'index.cjs'),`const fs=require('node:fs'),path=require('node:path');const executable=()=>path.join(process.env.PLAYWRIGHT_BROWSERS_PATH,'chromium-1','browser');exports.chromium={executablePath:executable,async launch(options){if(options.headless!==true||fs.readFileSync(executable(),'utf8')!=='usable')throw Error('browser resource is not usable');return{version(){return 'controlled-1'},async close(){}}}};`);
  await writeFile(join(pkg,'cli.cjs'),`(async()=>{if(process.argv[2]!=='test')throw Error('unexpected installer');const browser=await require('./index.cjs').chromium.launch({headless:true});const result=require('node:child_process').spawnSync(process.execPath,[process.argv[3]],{cwd:process.cwd(),encoding:'utf8'});await browser.close();process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status??1;})().catch(error=>{console.error(error);process.exitCode=1});`);
  for(const name of ['chromium','chromium_headless_shell','ffmpeg']){const folder=join(root,'.capivara-runtime','cache','ms-playwright',`${name}-1`);await mkdir(folder,{recursive:true});await writeFile(join(folder,'browser'),'usable');}
  const brief:ProductBrief={schema:'capivara/product/1',id:'web',revision:1,status:'ready',name:'Alpha',summary:'Observe alpha in the requested interface.',request:'Create a web interface with an observable alpha flow.',modes:['web'],targets:['browser'],requirements:[{id:'alpha',statement:'The web flow observes alpha.',mode:'web',kind:'interface',source:{kind:'request',reference:'request',text:'Create a web interface with an observable alpha flow.'}}],constraints:[],decisions:[],gaps:[]};
  const check={id:'alpha-browser',kind:'web' as const,command:'npm',args:['run','e2e'],assertion:{type:'contains' as const,value:'alpha'},level:'behavior' as const,inputs:['alpha.mjs','node_modules/playwright/cli.cjs','node_modules/playwright/index.cjs','node_modules/playwright-core/browsers.json'],requirementIds:['alpha'],requiredCapabilities:['browser']};
  const task:WorkUnit={id:'alpha',title:'Alpha flow',goal:'Expose alpha in the requested interface.',instructions:'Implement the alpha flow.',requirementIds:['alpha'],dependsOn:[],environmentIds:[],contractIds:[],files:['alpha.mjs'],criteria:['The observed flow returns alpha.'],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'web',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const state=createBuildState(plan);
  state.tasks.alpha={status:'pending',revision:'',attempts:0,changedFiles:[],findings:[],strategy:'implement',checks:[{...check,kind:'command',command:process.execPath,args:['alpha.mjs'],requiredCapabilities:[]}]};
  let editors=0,localRepairs=0,replans=0,proposal='';
  const result=await runBuild({workspace:root,brief,plan,state,signal:AbortSignal.timeout(6000),onState:async current=>{proposal=current.tasks.alpha?.checkpoint?.directory??proposal;},agent:async request=>{
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    if(request.role==='repair'){localRepairs++;return complete('{}');}
    editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");\n');return complete();
  },repairPlan:async(incident,owner)=>{
    replans++;expect(incident.repairScope).toBe('verification');expect(owner.id).toBe('alpha');
    expect(await readFile(join(proposal,'alpha.mjs'),'utf8')).toContain('alpha');
    return structuredClone(plan);
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
  expect(editors).toBe(1);expect(localRepairs).toBe(1);expect(replans).toBe(1);
  expect(result.plan.tasks[0]?.id).toBe('alpha');expect(result.plan.tasks[0]?.criteria).toEqual(task.criteria);
  expect(result.state.evidence.some(proof=>proof.kind==='command'&&proof.passed)).toBe(true);
  expect(result.state.evidence.some(proof=>proof.kind==='web'&&proof.passed&&proof.level==='behavior')).toBe(true);
});

it('resolves an inconclusive review through a scoped new observation without reediting correct source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'capivara-review-contract-'));roots.push(root);
  const brief:ProductBrief={schema:'capivara/product/1',id:'cli',revision:1,status:'ready',name:'Alpha CLI',summary:'Alpha and health commands',request:'Create a CLI that prints alpha and reports healthy for --health.',modes:['cli'],targets:['portable'],requirements:[{id:'alpha',statement:'Print alpha and report healthy for --health.',mode:'cli',source:{kind:'request',reference:'request',text:'Create a CLI that prints alpha and reports healthy for --health.'}}],constraints:[],decisions:[],gaps:[]};
  const check={id:'alpha-cli',kind:'cli' as const,command:process.execPath,args:['alpha.mjs'],assertion:{type:'contains' as const,value:'alpha'},level:'behavior' as const,inputs:['alpha.mjs'],requirementIds:['alpha'],requiredCapabilities:[]};
  const task:WorkUnit={id:'alpha',title:'Alpha CLI',goal:'Provide greeting and health commands.',instructions:'Implement both commands.',requirementIds:['alpha'],dependsOn:[],environmentIds:[],contractIds:[],files:['alpha.mjs'],criteria:['The default command prints alpha.','The health command prints healthy.'],checks:[check],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'cli',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  let editors=0,replans=0,reviewers=0;
  const result=await runBuild({workspace:root,brief,plan,signal:AbortSignal.timeout(5000),agent:async request=>{
    if(request.role==='reviewer'){
      reviewers++;
      return complete(request.context?.includes('STDOUT:\nhealthy')?'{"approved":true,"findings":[]}':'{"approved":false,"findings":[]}');
    }
    if(request.role==='repair')return complete('{}');
    editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log(process.argv.includes("--health") ? "healthy" : "alpha");\n');return complete();
  },repairPlan:async(incident,owner)=>{
    replans++;expect(incident.repairScope).toBe('verification');expect(owner.id).toBe('alpha');
    const revised=structuredClone(plan);revised.revision++;
    revised.tasks[0]!.checks.push({...check,id:'health-cli',args:['alpha.mjs','--health'],assertion:{type:'contains',value:'healthy'}});
    return revised;
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');
  expect(editors).toBe(1);expect(replans).toBe(1);expect(reviewers).toBeGreaterThanOrEqual(3);
  expect(result.state.evidence.some(proof=>proof.checkId==='health-cli'&&proof.passed&&proof.observation?.stdout==='healthy\n')).toBe(true);
  expect(result.state.tasks.alpha?.reviews?.some(review=>review.assessment.decision==='unresolved')).toBe(true);
});

function preflightFixture(){
  const brief:ProductBrief={schema:'capivara/product/1',id:'cli',revision:1,status:'ready',name:'Alpha',summary:'Print alpha',request:'Create a CLI that prints alpha.',modes:['cli'],targets:['portable'],requirements:[{id:'alpha',statement:'The CLI prints alpha.',mode:'cli',source:{kind:'request',reference:'request',text:'Create a CLI that prints alpha.'}}],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'alpha',title:'Alpha',goal:'Print alpha.',instructions:'Implement alpha.',requirementIds:['alpha'],dependsOn:[],environmentIds:['runtime'],contractIds:[],files:['alpha.mjs'],criteria:['The CLI prints alpha.'],checks:[{id:'alpha-cli',kind:'cli',command:process.execPath,args:['alpha.mjs'],assertion:{type:'contains',value:'alpha'},level:'behavior',inputs:['alpha.mjs'],requirementIds:['alpha'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'cli',briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const repaired=structuredClone(plan);repaired.revision++;
  repaired.environment.push({id:'runtime',name:'Runtime',kind:'runtime',dependsOn:[],targets:[],reason:'Execute the requested CLI.',check:{command:process.execPath,args:['--version']},prepare:[],provides:{command:[process.execPath]}});
  return{brief,plan,repaired};
}

it('records a throwing preflight reconciliation without approving its invalid plan or leaving a running action',async()=>{
  const root=await mkdtemp(join(tmpdir(),'capivara-preflight-failure-'));roots.push(root);
  const f=preflightFixture();let calls=0,agents=0;
  const options={workspace:root,brief:f.brief,plan:f.plan,agent:async()=>{agents++;return complete();},repairPlan:async()=>{calls++;throw Error('No executable provider contract was returned.');}};
  const failed=await runBuild(options);
  expect(failed.status).toBe('waiting');expect(agents).toBe(0);expect(calls).toBe(1);
  expect(failed.state.tasks.alpha?.actions?.find(action=>action.strategy==='preflight')).toMatchObject({outcome:'failed',failure:'No executable provider contract was returned.'});
  expect(failed.incidents.some(incident=>incident.evidence.includes('No executable provider contract was returned.'))).toBe(true);
  const again=await runBuild({...options,plan:failed.plan,state:JSON.parse(JSON.stringify(failed.state))});
  expect(again.status).toBe('waiting');expect(calls).toBe(1);expect(agents).toBe(0);
});

for(const point of ['durable-guard','callback','durable-proposal'] as const)it(`resumes preflight after ${point} interruption without losing a completed proposal`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'capivara-preflight-resume-'));roots.push(root);
  const f=preflightFixture(),controller=new AbortController();let interrupted=false,calls=0,editors=0;
  const agent:Parameters<typeof runBuild>[0]['agent']=async request=>{
    if(request.role==='reviewer')return complete('{"approved":true,"findings":[]}');
    expect(request.role).toBe('editor');editors++;await writeFile(join(request.workspace,'alpha.mjs'),'console.log("alpha");\n');return complete();
  };
  const repairPlan=async()=>{
    calls++;
    if(point==='callback'&&!interrupted){interrupted=true;controller.abort();throw Error('Planning operation interrupted before returning a result.');}
    return structuredClone(f.repaired);
  };
  const first=await runBuild({workspace:root,brief:f.brief,plan:f.plan,agent,repairPlan,signal:controller.signal,onState:async state=>{
    if(interrupted)return;
    const running=Object.values(state.acceptanceRecovery??{}).includes('running:preflight');
    const proposal=state.tasks.alpha?.actions?.some(action=>action.strategy==='preflight'&&action.planProposal);
    if(point==='durable-guard'&&running||point==='durable-proposal'&&proposal){interrupted=true;controller.abort();}
  }});
  expect(first.status,JSON.stringify(first.incidents)).toBe('cancelled');expect(editors).toBe(0);
  expect(Object.values(first.state.acceptanceRecovery??{})).toContain('interrupted:preflight');
  const resumed=await runBuild({workspace:root,brief:f.brief,plan:first.plan,state:JSON.parse(JSON.stringify(first.state)),agent,repairPlan,signal:AbortSignal.timeout(4000)});
  expect(resumed.status,JSON.stringify(resumed.incidents)).toBe('complete');expect(editors).toBe(1);
  expect(calls).toBe(point==='callback'?2:1);
  expect(resumed.plan.environment.some(node=>node.id==='runtime')).toBe(true);
  expect(resumed.state.evidence.some(proof=>proof.checkId==='alpha-cli'&&proof.passed)).toBe(true);
});
