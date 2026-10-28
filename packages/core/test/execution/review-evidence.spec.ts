import { expect, it } from 'vitest';
import { buildReviewEvidence } from '../../src/execution/review-evidence.js';
import { createBuildState } from '../../src/execution/build.js';
import type { DevelopmentPlan, Verification, WorkUnit } from '../../src/domain/types.js';
import type { BuildState, TaskProgress, VerificationEvidence } from '../../src/execution/types.js';
const timestamp='2026-10-28T17:00:00.000Z';
function check(id:string,kind:Verification['kind']='command',level:Verification['level']='build'):Verification{return{id,kind,level,command:'actual-runner',requirementIds:['category'],requiredCapabilities:[]};}
function task(id:string,files:string[],checks:Verification[],dependsOn:string[]=[],requirements=['category']):WorkUnit{return{id,title:id,goal:'Deliver the selected behavior.',instructions:'Implement its selected scope.',requirementIds:requirements,dependsOn,environmentIds:[],contractIds:[],files,inputs:[],criteria:['The selected behavior works.'],checks,risk:'normal',blockedBy:[]};}
function plan(tasks:WorkUnit[]):DevelopmentPlan{return{schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks};}
function proof(task:WorkUnit,recipe=task.checks[0]!,id=`e-${task.id}`,hash=`hash-${task.id}`,stdout='recorded success'):VerificationEvidence{return{id,taskId:task.id,checkId:recipe.id,inputHash:hash,passed:true,command:'actual-runner',output:stdout,terminal:false,kind:recipe.kind,level:recipe.level!,checkedAt:timestamp,observedAt:'2026-10-28T16:59:50.000Z',assertionStatus:'ready',observation:{command:'actual-runner',stdout,stderr:'',exitCode:0,cancelled:false,timedOut:false,terminal:false}};}
function progress(task:WorkUnit,evidence?:VerificationEvidence,status:TaskProgress['status']='complete'):TaskProgress{return{status,revision:'revision',attempts:1,changedFiles:[],findings:[],strategy:'verified',checks:task.checks,...(evidence?{verificationEvidence:[{checkId:evidence.checkId,evidenceId:evidence.id,inputHash:evidence.inputHash}]}:{})};}
function seed(state:BuildState,task:WorkUnit,evidence:VerificationEvidence,receipt=true){state.tasks[task.id]=progress(task,receipt?evidence:undefined);state.evidence.push(evidence);}
it('selects an older cached positive by its verified identity rather than recent unrelated negative output',()=>{
  const own=task('category-ui',['src/categories/UI.tsx'],[check('build')]),proposal=plan([own]),state=createBuildState(proposal);
  const current={...proof(own,own.checks[0],'current','current-input','BUILD CURRENT PASSED'),reinterpretedFrom:'original-observation'};seed(state,own,current);
  state.evidence.push({...proof(own,own.checks[0],'newer-negative','different-input','OBSOLETE FAILURE MUST NOT BE SHOWN'),passed:false,classification:'product'});
  const packet=buildReviewEvidence(state,proposal,own);expect(packet.status).toBe('ready');expect(packet.own.map(item=>item.evidence.id)).toEqual(['current']);expect(packet.text).toContain('BUILD CURRENT PASSED');expect(packet.text).not.toContain('OBSOLETE FAILURE');expect(packet.text).toContain(`observedAt=${current.observedAt}`);expect(packet.text).toContain('reinterpretedFrom=original-observation');
});
it('requires exact own receipts and never invents a positive from history or an inconsistent reference',()=>{
  const own=task('category-ui',['src/categories/UI.tsx'],[check('build')]),proposal=plan([own]),state=createBuildState(proposal),current=proof(own);seed(state,own,current,false);
  expect(buildReviewEvidence(state,proposal,own).status).toBe('needs-check');
  state.tasks[own.id]!.verificationEvidence=[{checkId:'build',evidenceId:current.id,inputHash:'different-input'}];expect(buildReviewEvidence(state,proposal,own).own).toEqual([]);
  state.tasks[own.id]!.verificationEvidence=[{checkId:'build',evidenceId:current.id,inputHash:current.inputHash}];current.passed=false;current.classification='product';const negative=buildReviewEvidence(state,proposal,own);expect(negative.status).toBe('needs-check');expect(negative.own[0]?.evidence.passed).toBe(false);
  current.passed=true;current.kind='web';expect(buildReviewEvidence(state,proposal,own).status).toBe('needs-check');
});
function relatedFixture(){
  const api=task('category-api',['server/categories.ts'],[check('api-tests','cli','behavior')],[],['api-category']);
  const foundation=task('foundation',['package.json'],[check('foundation-build')],[],['shared']);
  const own=task('category-ui',['src/categories/UI.tsx'],[check('ui-build')],[api.id,foundation.id],['category','shared']);
  const integrated=task('global-browser',['e2e/integration.spec.ts'],[check('browser-tests','web','behavior')],[own.id],['category']);
  const unrelated=task('unrelated-node-ui',['src/tasks/UI.tsx'],[check('other-tests','web','behavior')],[],['category','shared']);
  const proposal=plan([api,foundation,own,integrated,unrelated]),state=createBuildState(proposal);seed(state,own,proof(own));
  seed(state,api,proof(api,undefined,undefined,undefined,'Categories API: 4 passed'));seed(state,foundation,proof(foundation,undefined,undefined,undefined,'Production build passed'));seed(state,integrated,proof(integrated,undefined,undefined,undefined,'Global Chromium flows: 5 passed'),false);seed(state,unrelated,proof(unrelated,undefined,undefined,undefined,'UNRELATED MUST NOT CROWD'));
  return{own,api,integrated,proposal,state};
}
it('provides dependency API and completed consumer evidence without using unrelated shared requirements or granting own approval',()=>{
  const f=relatedFixture(),before=JSON.stringify(f.state),packet=buildReviewEvidence(f.state,f.proposal,f.own);
  expect(packet.status).toBe('ready');expect(packet.own).toHaveLength(1);expect(packet.related.map(item=>item.taskId)).toEqual(['category-api','foundation','global-browser']);
  expect(packet.text).toContain('Categories API: 4 passed');expect(packet.text).toContain('Global Chromium flows: 5 passed');expect(packet.text).not.toContain('UNRELATED MUST NOT CROWD');expect(packet.related.find(item=>item.taskId===f.integrated.id)?.selection).toBe('completed-task-record');expect(packet.text).toContain('source-hash revalidation belongs to the scheduler');expect(JSON.stringify(f.state)).toBe(before);
  delete f.state.tasks[f.own.id]!.verificationEvidence;const missing=buildReviewEvidence(f.state,f.proposal,f.own);expect(missing.related.length).toBeGreaterThan(0);expect(missing.status).toBe('needs-check');
});
it('bounds review text and related summaries while retaining own identities and honest output truncation',()=>{
  const f=relatedFixture();f.state.evidence[0]!.observation!.stdout='large own transcript\n'.repeat(5000)+'CURRENT BUILD FINISHED';f.state.evidence.find(item=>item.taskId===f.api.id)!.observation!.stdout='large API transcript\n'.repeat(5000)+'API: 4 passed';
  const packet=buildReviewEvidence(f.state,f.proposal,f.own,undefined,{maxChars:1800});expect(packet.text.length).toBeLessThanOrEqual(1800);expect(packet.text).toContain(`evidence=e-${f.own.id}`);expect(packet.text).toContain('input=hash-category-ui');expect(packet.text).toContain('evaluatedAt=');expect(packet.text).toContain('observedAt=');expect(packet.text).toContain('truncated');expect(packet.related.every(item=>item.summary.length<=1200)).toBe(true);expect(packet.related[0]?.summary).toContain('RELATED category-api');expect(packet.related[0]?.summary).toContain('API: 4 passed');expect(packet.truncated).toBe(true);
});
it('omits related tasks that are incomplete even if a historical positive exists',()=>{
  const f=relatedFixture();f.state.tasks[f.api.id]!.status='checking';const packet=buildReviewEvidence(f.state,f.proposal,f.own);expect(packet.related.some(item=>item.taskId===f.api.id)).toBe(false);
});
