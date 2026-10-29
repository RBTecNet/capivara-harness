import { expect, it } from 'vitest';
import { recoveryPlanIdentity } from '../../src/execution/build.js';
import type { DevelopmentPlan } from '../../src/domain/types.js';

it('rejects prose-only delivery recovery while allowing executable boundaries and source-bound authority repairs',()=>{
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[],contracts:[],tasks:[{id:'unit',title:'Original',goal:'Implement the operation.',instructions:'Inspect and implement.',requirementIds:['r'],dependsOn:[],environmentIds:[],contractIds:[],files:['app.py'],criteria:['The requested operation works.'],checks:[{id:'behavior',kind:'cli',command:'python3',args:['app.py'],assertion:{type:'contains',value:'ready'},requirementIds:['r'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]}]};
  const previous=recoveryPlanIdentity(plan,'delivery');
  for(let index=0;index<3;index++){
    const proposal=structuredClone(plan);proposal.revision++;
    Object.assign(proposal.tasks[0]!,{title:`Explanation ${index}`,goal:`Rephrased goal ${index}`,instructions:`Try again with more explanation ${index}`,criteria:[`The same outcome, reworded ${index}`]});
    proposal.tasks[0]!.id=`renamed-unit-${index}`;
    proposal.tasks[0]!.checks[0]!.expected=`Human description ${index}`;
    expect(recoveryPlanIdentity(proposal,'delivery')).toBe(previous);
    expect(recoveryPlanIdentity(proposal,undefined)).toBe(recoveryPlanIdentity(plan,undefined));
    expect(recoveryPlanIdentity(proposal,'authority')).not.toBe(recoveryPlanIdentity(plan,'authority'));
  }
  const changed=structuredClone(plan);changed.tasks[0]!.files.push('operation.py');
  expect(recoveryPlanIdentity(changed,'delivery')).not.toBe(previous);
  changed.tasks[0]!.files=plan.tasks[0]!.files;changed.tasks[0]!.checks[0]!.args=['app.py','--health'];
  expect(recoveryPlanIdentity(changed,'delivery')).not.toBe(previous);
});
