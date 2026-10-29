import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { runBuild } from '../../src/execution/build.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});

it('resolves a missing behavior proof labeled as source through actual verification and a fresh review without editing again',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-review-proof-debt-'));roots.push(workspace);
  const source="if(process.argv[2]==='--sum')console.log('total='+process.argv.slice(3).reduce((sum,value)=>sum+Number(value),0));else console.log('hello');\n";
  const statement='The CLI greets and calculates the actual sum of two numbers.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Sum',summary:statement,request:statement,modes:['cli'],targets:['portable'],requirements:[{id:'outcome',statement,kind:'behavior',mode:'cli',source:{kind:'request',reference:'request',text:statement}}],constraints:[],decisions:[],gaps:[]};
  const greeting:Verification={id:'greeting',kind:'cli',level:'behavior',command:process.execPath,args:['application.mjs'],expected:'The real CLI prints hello.',assertion:{type:'contains',source:'stdout',value:'hello'},inputs:['application.mjs'],requirementIds:['outcome'],requiredCapabilities:[]};
  const sum:Verification={id:'sum-outcome',kind:'command',level:'behavior',command:process.execPath,args:['application.mjs','--sum','2','3'],expected:'The actual CLI calculates 2 + 3 as 5.',assertion:{type:'contains',source:'stdout',value:'total=5'},inputs:['application.mjs'],requirementIds:['outcome'],requiredCapabilities:[]};
  const task:WorkUnit={id:'delivery',title:'Sum',goal:statement,instructions:'Implement actual greeting and summation.',requirementIds:['outcome'],dependsOn:[],environmentIds:[],contractIds:[],files:['application.mjs'],criteria:['The CLI prints hello by default.','The CLI calculates 2 + 3 as 5.'],checks:[greeting],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const finding={kind:'product',evidenceType:'source',file:'application.mjs',observed:'The saved evidence does not demonstrate the sum of 2 and 3.',expected:'Observe the actual CLI sum result for 2 and 3.',evidence:'The current receipt shows only the greeting invocation.',fix:'Run and record the real sum scenario.'};
  const rejection=JSON.stringify({approved:false,findings:[finding]});
  let editors=0,classifications=0,reviews=0;
  const outcome=await runBuild({workspace,brief,plan,repairPlan:async()=>{throw Error('Missing proof must not replan the correct implementation.');},agent:async request=>{
    if(request.role==='editor'){
      editors++;expect(editors).toBe(1);await writeFile(join(request.workspace,'application.mjs'),source);return complete();
    }
    if(request.role==='reviewer'&&request.instruction.startsWith('Classify the basis')){
      classifications++;expect(request.readOnly).toBe(true);
      expect(request.context).toContain(finding.observed);
      return complete(JSON.stringify({basis:'verification-debt',cause:'The finding names an absent runtime observation, not a concrete defect in the existing source.',verification:sum}));
    }
    if(request.role==='reviewer'){
      reviews++;
      if(reviews===1)return complete(rejection);
      expect(request.context).toContain('total=5');
      expect(request.context).toContain('STDOUT:');
      return complete('{"approved":true,"findings":[]}');
    }
    throw Error('A correct product with missing evidence does not authorize a repair editor.');
  }});
  expect(outcome.status,JSON.stringify(outcome.incidents)).toBe('complete');
  expect({editors,classifications,reviews}).toEqual({editors:1,classifications:1,reviews:2});
  expect(await readFile(join(workspace,'application.mjs'),'utf8')).toBe(source);
  const progress=outcome.state.tasks.delivery!;
  expect(progress.reviews?.[0]?.assessment.original).toBe(rejection);
  expect(progress.reviews?.[0]?.assessment.approved).toBe(false);
  expect(progress.reviews?.[0]?.assessment.transformations.some(change=>change.operation==='classify'&&JSON.stringify(change.original).includes(finding.observed))).toBe(true);
  expect(progress.reviews?.at(-1)?.assessment.approved).toBe(true);
  expect(outcome.state.evidence.some(proof=>proof.passed&&proof.observation?.stdout.includes('total=5'))).toBe(true);
  const healthy=outcome.state.evidence.filter(proof=>proof.checkId===greeting.id);
  expect(healthy.every(proof=>proof.passed)).toBe(true);
  expect(new Set(healthy.map(proof=>proof.id)).size).toBe(1);
});
