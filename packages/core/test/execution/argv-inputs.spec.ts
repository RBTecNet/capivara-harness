import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { verificationInputSelectors, resolveInputDependencies } from '../../src/execution/dependencies.js';
import { checkInputHash, runVerification } from '../../src/execution/checks.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { createBuildState, runBuild } from '../../src/execution/build.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { digest, inputHash } from '../../src/execution/files.js';
import { executeCommand, runTerminal } from '../../src/runtime/index.js';
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace(){const root=await mkdtemp(join(tmpdir(),'capivara-argv-inputs-'));temporary.push(root);return root;}
const brief:ProductBrief={schema:'capivara/product/1',status:'ready',id:'b',revision:1,name:'Artifact fixture',summary:'Preserve the required artifact',request:'Produce a readable document with a Wireframe section.',modes:['cli'],targets:['portable'],requirements:[{id:'r',statement:'The delivered document contains its Wireframe section.',mode:'cli',source:{kind:'request',reference:'request',text:'Produce a readable document with a Wireframe section.'}}],constraints:[],decisions:[],gaps:[]};
function fixture(check:Verification){const task:WorkUnit={id:'artifact',title:'Required artifact',goal:'Deliver the readable artifact.',instructions:'Produce the required artifact.',requirementIds:['r'],dependsOn:[],environmentIds:[],contractIds:[],files:['docs/plan.md'],criteria:['The delivered document contains its Wireframe section.'],checks:[check],risk:'normal',blockedBy:[]};const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[task]};return{task,plan};}
const documentCheck:Verification={id:'document',kind:'cli',command:'rg',args:['-n','Paleta|Tipografia|Wireframe|Princípios','docs'],expected:'The artifact contains its required Wireframe section.',assertion:{type:'contains',value:'Wireframe',source:'stdout'},expectedExitCode:0,inputs:['SKILL.md'],requirementIds:['r'],requiredCapabilities:[],level:'behavior'};
it('records a bare reader directory before it exists and invalidates only changes in its actual read scope',async()=>{
  const root=await workspace();await writeFile(join(root,'SKILL.md'),'Reference');const {plan,task}=fixture(documentCheck);
  expect(await verificationInputSelectors(root,plan,task,documentCheck)).toEqual(['SKILL.md','docs']);
  const missing=await checkInputHash(root,plan,task,documentCheck,brief);await writeFile(join(root,'README.md'),'Unrelated documentation');expect(await checkInputHash(root,plan,task,documentCheck,brief)).toBe(missing);
  await mkdir(join(root,'docs'));await writeFile(join(root,'docs/plan.md'),'Wireframe\n');const created=await checkInputHash(root,plan,task,documentCheck,brief);expect(created).not.toBe(missing);
  await writeFile(join(root,'README.md'),'Unrelated edit');expect(await checkInputHash(root,plan,task,documentCheck,brief)).toBe(created);
  await writeFile(join(root,'docs/plan.md'),'Wireframe\nRevised layout');expect(await checkInputHash(root,plan,task,documentCheck,brief)).not.toBe(created);
});
it('uses the same discovered inputs for a real failed observation, its hash and the successful retry',async()=>{
  const root=await workspace();await writeFile(join(root,'SKILL.md'),'Reference');const {plan,task}=fixture(documentCheck);
  const failed=await runVerification(root,brief,task,plan,documentCheck,executeCommand,runTerminal);expect(failed.evidence.passed).toBe(false);expect(failed.evidence.inputs).toContain('docs');expect(failed.evidence.inputHash).toBe(await checkInputHash(root,plan,task,documentCheck,brief));
  await mkdir(join(root,'docs'));await writeFile(join(root,'docs/plan.md'),'Wireframe');const passed=await runVerification(root,brief,task,plan,documentCheck,executeCommand,runTerminal);expect(passed.evidence.passed).toBe(true);expect(passed.evidence.inputHash).not.toBe(failed.evidence.inputHash);expect(passed.evidence.inputs).toContain('docs/plan.md');
});
it('replaces a stale verification copy and cached negative after a preserved repair without another editor',async()=>{
  const root=await workspace();await writeFile(join(root,'SKILL.md'),'Reference');const {plan,task}=fixture(documentCheck),hash=digest(JSON.stringify(task));
  const proposal=await createTaskWorkspace(root,task.id,hash,task.files);proposal.phase='checking';
  const oldSelectors=await verificationInputSelectors(proposal.directory,plan,task,documentCheck),operational=emptyOperationalEnvironment(proposal.directory);
  const stale=await createTaskWorkspace(proposal.directory,'old-proof',hash,task.files);
  const negative=await runVerification(stale.directory,brief,task,plan,documentCheck,executeCommand,runTerminal);expect(negative.evidence.passed).toBe(false);
  const state=createBuildState(plan);state.evidence.push(negative.evidence);state.tasks[task.id]={status:'checking',revision:'',attempts:1,changedFiles:[],findings:[],strategy:'targeted-repair',actions:[],reviews:[],checkpoint:proposal,verificationCheckpoint:{directory:stale.directory,sourceHash:await inputHash(proposal.directory,await resolveInputDependencies(proposal.directory,oldSelectors),operational.revision)}};
  await mkdir(join(proposal.directory,'docs'));await writeFile(join(proposal.directory,'docs/plan.md'),'Wireframe\n');
  let editors=0,reviews=0,commands=0;
  const result=await runBuild({workspace:root,brief,plan,state,signal:AbortSignal.timeout(3000),executeCommand:async request=>{if(request.executionPolicy?.purpose==='verification')commands++;return executeCommand(request);},agent:async request=>{
    if(request.role==='reviewer'){reviews++;return{status:'complete',text:'{"approved":true,"findings":[]}',commands:[],changedFiles:[]};}editors++;return{status:'complete',text:'',commands:[],changedFiles:[]};
  }});
  expect(result.status,JSON.stringify(result.incidents)).toBe('complete');expect({editors,reviews,commands}).toEqual({editors:0,reviews:1,commands:1});expect(await readFile(join(root,'docs/plan.md'),'utf8')).toContain('Wireframe');expect(result.state.evidence.some(proof=>proof.passed&&proof.inputHash!==negative.evidence.inputHash)).toBe(true);
});
it('tracks existing unknown CLI operands, arbitrary extensions, cwd and literal string commands',async()=>{
  const root=await workspace();await mkdir(join(root,'sub/docs'),{recursive:true});await writeFile(join(root,'README.md'),'readme');await writeFile(join(root,'asset.custom'),'asset');
  const {task,plan}=fixture(documentCheck);
  expect(await verificationInputSelectors(root,plan,task,{...documentCheck,command:'custom-check',args:['README.md','asset.custom'],inputs:[]})).toEqual(['README.md','asset.custom']);
  const {args:_args,...literal}=documentCheck;expect(await verificationInputSelectors(root,plan,task,{...literal,cwd:'sub',command:"rg -n 'Wireframe|Paleta' docs",inputs:[]})).toEqual(['sub/docs']);
});
it('keeps package-manager metadata, pattern flags, inline source and produced outputs out of inferred reads',async()=>{
  const root=await workspace();for(const folder of ['e2e','build','docs','dist'])await mkdir(join(root,folder));await writeFile(join(root,'input.expr'),'2+3');await writeFile(join(root,'compile.mjs'),'// compiler');await writeFile(join(root,'dist/result.js'),'first');
  const {task,plan}=fixture(documentCheck),manager={...documentCheck,command:'npm',args:['run','e2e','--','--grep','docs'],inputs:[]};
  expect(await verificationInputSelectors(root,plan,task,manager)).toEqual([]);
  expect(await verificationInputSelectors(root,plan,task,{...documentCheck,command:process.execPath,args:['-e','console.log("docs/result.js")'],inputs:[]})).toEqual([]);
  const producer={...documentCheck,command:process.execPath,args:['compile.mjs','input.expr','--output','dist'],inputs:['input.expr'],outputs:['dist/result.js']};
  const before=await checkInputHash(root,plan,task,producer,brief);await writeFile(join(root,'dist/result.js'),'second');expect(await checkInputHash(root,plan,task,producer,brief)).toBe(before);expect(await verificationInputSelectors(root,plan,task,producer)).toEqual(['compile.mjs','input.expr']);
});
it.skipIf(process.platform==='win32')('does not infer escaping paths or symlinked external inputs',async()=>{
  const root=await workspace(),external=await workspace();await writeFile(join(external,'secret.md'),'external');await symlink(external,join(root,'outside'),'dir');const {task,plan}=fixture(documentCheck);
  expect(await verificationInputSelectors(root,plan,task,{...documentCheck,command:'custom-check',args:[join(external,'secret.md'),'../secret.md','outside/secret.md'],inputs:[]})).toEqual([]);
});
