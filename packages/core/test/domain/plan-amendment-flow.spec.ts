import { expect, it } from 'vitest';
import { runPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';

it('completa cobertura por emenda de identidade existente preservando arquivos, critérios e consumidores',async()=>{
  const brief:ProductBrief={schema:'capivara/product/1',id:'product',revision:1,status:'ready',name:'Exporter',summary:'Export records through a CLI.',request:'Export records and document local startup.',modes:['cli'],targets:['portable'],requirements:[
    {id:'export',statement:'Export records through a CLI.',source:{kind:'request',reference:'request',text:'Export records'},mode:'cli'},
    {id:'startup',statement:'Document local startup.',source:{kind:'request',reference:'request',text:'document local startup'},mode:'shared'},
  ],constraints:[],decisions:[],gaps:[]};
  const foundation:WorkUnit={id:'foundation',title:'Foundation',goal:'A local runtime exports records.',instructions:'Implement the actual export.',requirementIds:['export'],dependsOn:[],environmentIds:[],contractIds:[],files:['package.json','src/main.ts','src/export.ts'],inputs:['data/input.csv'],resources:['database'],exclusiveContracts:[],criteria:['Export includes every record.'],checks:[],risk:'normal',blockedBy:[]};
  const consumer:WorkUnit={...structuredClone(foundation),id:'consumer',goal:'Format exported records.',dependsOn:['foundation'],files:['src/format.ts'],inputs:['src/export.ts'],criteria:['Formatting preserves all records.']};
  const existing:DevelopmentPlan={schema:'capivara/plan/1',revision:1,briefId:brief.id,briefRevision:1,status:'planning',environment:[],contracts:[],tasks:[foundation,consumer],planning:{schema:'capivara/plan-progress/1',briefRevision:1,groups:[{requirementIds:['export','startup'],environmentComplete:true,outlineComplete:true,environmentScope:[]}]}};
  const original=structuredClone(existing),calls:string[]=[];
  const result=await runPlan({brief,existing,agent:async request=>{
    calls.push(request.operation);
    expect(request.operation).toBe('outline');
    expect(request.prompt).toContain('Reconcile uncovered mandatory outcomes');
    return JSON.stringify({tasks:[{...foundation,goal:'A documented local setup runs the export CLI.',instructions:'Document how to install and start the local CLI.',requirementIds:['startup'],files:['package.json','package-lock.json','README.md'],inputs:['config/defaults.json'],resources:['installer'],criteria:['Startup uses documented commands.'],checks:[]}],environment:[],acceptance:[]});
  }});
  expect(result.status).toBe('ready');expect(calls).toEqual(['outline']);
  expect(result.tasks.map(task=>task.id)).toEqual(['foundation','consumer']);
  const amended=result.tasks[0]!;
  expect(amended.requirementIds).toEqual(['export','startup']);
  expect(amended.files).toEqual(['package.json','src/main.ts','src/export.ts','package-lock.json','README.md']);
  expect(amended.inputs).toEqual(['data/input.csv','config/defaults.json']);
  expect(amended.resources).toEqual(['database','installer']);
  expect(amended.criteria).toEqual(['Export includes every record.','Startup uses documented commands.']);
  expect(amended.instructions).toContain(foundation.instructions);
  expect(amended.instructions).toContain('Document how to install');
  expect(result.tasks[1]).toEqual(consumer);
  expect(existing).toEqual(original);
  await expect(runPlan({brief,existing:result,agent:async()=>{throw Error('No new inference is necessary.');}})).resolves.toEqual(result);
});
