import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairWorkPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { runVerification } from '../../src/execution/checks.js';
import { executeCommand } from '../../src/runtime/command.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('preserves an executable restart reproduction while quarantining unrelated conformance metadata without inferring proof',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-metadata-'));roots.push(workspace);
  await writeFile(join(workspace,'application.mjs'),"import {readFileSync,writeFileSync,existsSync} from 'node:fs';const file='records.json';if(process.argv.includes('create'))writeFileSync(file,JSON.stringify({id:17}));else {if(!existsSync(file)||JSON.parse(readFileSync(file)).id!==17)throw Error('Record did not survive the process restart');console.log('persisted=17');}\n");
  const statement='Records survive an application process restart.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Records',summary:statement,request:statement,modes:['cli'],targets:['portable'],requirements:[{id:'persistence',statement,mode:'shared',kind:'behavior',source:{kind:'request',reference:'request',text:statement}}],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'delivery',title:'Records',goal:statement,instructions:'Deliver actual persistent records.',requirementIds:['persistence'],dependsOn:[],environmentIds:[],contractIds:[],files:['application.mjs'],criteria:[statement],checks:[],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:brief.id,briefRevision:1,environment:[],contracts:[],tasks:[task]};
  const wrongClaim={requirementId:'persistence',capability:'database',kind:'driver',provider:'Unrelated database',productInputs:[]};
  const check:Verification={id:'restart',kind:'cli',level:'behavior',command:process.execPath,args:['--input-type=module','-e',"import {spawnSync} from 'node:child_process';for(const mode of ['create','read']){const result=spawnSync(process.execPath,['application.mjs',mode],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);process.stdout.write(result.stdout);}"],expected:statement,assertion:{type:'contains',source:'stdout',value:'persisted=17'},inputs:['application.mjs'],requirementIds:['persistence'],requiredCapabilities:[]};
  const events:unknown[]=[];
  const next=await repairWorkPlan({brief,plan,taskId:task.id,repairScope:'verification',problem:'A reviewer needs an application restart reproduction.',onEvent:event=>events.push(event),agent:async()=>JSON.stringify({checks:[{...check,conformance:wrongClaim}]})});
  const adopted=next.tasks[0]!.checks[0]!;
  expect(adopted).toEqual(check);
  expect({...next.tasks[0]!,checks:[]}).toEqual(task);
  expect(plan.tasks[0]).toEqual(task);
  expect(next).not.toHaveProperty('evidence');
  expect(events).toContainEqual(expect.objectContaining({type:'verification-declaration-rejected',subject:task.id,detail:expect.objectContaining({checkId:'restart',original:wrongClaim,retained:null})}));
  const observed=await runVerification(workspace,brief,next.tasks[0]!,next,adopted,executeCommand,async()=>{throw Error('No terminal adapter is involved.');});
  expect(observed.evidence.passed,observed.evidence.output).toBe(true);
  expect(observed.evidence.provenance?.exitCode).toBe(0);
  expect(observed.evidence).not.toHaveProperty('conformance');
  // A failed invocation must remain a failed observation after the same
  // metadata classification; quarantining declarations never approves code.
  await writeFile(join(workspace,'application.mjs'),"throw Error('Actual product failure');\n");
  const failed=await runVerification(workspace,brief,next.tasks[0]!,next,adopted,executeCommand,async()=>{throw Error('No terminal adapter is involved.');});
  expect(failed.evidence.passed).toBe(false);
});
