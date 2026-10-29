import { expect, it } from 'vitest';
import { runPlan } from '../../src/domain/plan.js';
import type { DevelopmentPlan, EnvironmentNode, ProductBrief, WorkUnit } from '../../src/domain/types.js';

it('repairs an environment-node identity with its actual operational context when no product requirement mandates the provider',async()=>{
  const brief:ProductBrief={schema:'capivara/product/1',id:'p',revision:1,status:'ready',name:'Records',summary:'Persist records locally.',request:'Persist records locally.',modes:['cli'],targets:['portable'],requirements:[{id:'records',statement:'Persist records locally.',source:{kind:'request',reference:'request',text:'Persist records locally.'},mode:'shared'}],constraints:[],decisions:[],gaps:[]};
  const node:EnvironmentNode={id:'sqlite',name:'SQLite',kind:'database',dependsOn:[],targets:['portable'],reason:'The local repository invokes the SQLite executable.',check:{command:'.tooling/sqlite/bin/sqlite3',args:['--version'],capabilities:[]},prepare:[{command:'prepare-local-sqlite',args:['.tooling/sqlite'],system:false,capabilities:[]}],provides:{command:['.tooling/sqlite/bin/sqlite3'],aliases:['sqlite3'],paths:['.tooling/sqlite/bin'],inputs:['.tooling/sqlite/bin/sqlite3']}};
  const task:WorkUnit={id:'repository',title:'Persist records',goal:'Persist and reopen records in a local database.',instructions:'Implement local record persistence.',requirementIds:['records'],dependsOn:[],environmentIds:['sqlite'],contractIds:[],files:['src/repository.ts'],criteria:['Records are retained after reopening the database.'],checks:[],risk:'normal',blockedBy:[]};
  const existing:DevelopmentPlan={schema:'capivara/plan/1',revision:1,briefId:brief.id,briefRevision:1,status:'planning',environment:[node],contracts:[],tasks:[task],planning:{schema:'capivara/plan-progress/1',briefRevision:1,groups:[{requirementIds:['records'],environmentComplete:true,outlineComplete:true,environmentScope:['database:sqlite']}]}};
  const original=structuredClone(existing);
  let calls=0;
  const result=await runPlan({brief,existing,agent:async request=>{
    calls++;
    expect(request.operation).toBe('repair');
    expect(request.prompt).toContain('ambiguous-environment-kind');
    // The incident subject names an environment node, rather than a bound
    // requirement. Its real probe, preparation and exports must still be shown.
    expect(request.prompt).toContain('.tooling/sqlite/bin/sqlite3');
    expect(request.prompt).toContain('prepare-local-sqlite');
    expect(request.prompt).toContain('"aliases":["sqlite3"]');
    return JSON.stringify({environmentUpdates:[{id:'sqlite',identity:{capability:'data-store-cli',kind:'cli',provider:'SQLite'}}],reason:'The existing readiness and export invoke the SQLite CLI; classify the actual node without changing installation or the product.'});
  }});
  expect(calls).toBe(1);expect(result.status).toBe('ready');
  expect(result.environment).toEqual([{...node,identity:{capability:'data-store-cli',kind:'cli',provider:'SQLite'},requirementIds:[]}]);
  expect(result.tasks).toEqual(original.tasks);
  expect(result.environment[0]!.check).toEqual(original.environment[0]!.check);
  expect(result.environment[0]!.prepare).toEqual(original.environment[0]!.prepare);
  expect(result.environment[0]!.provides).toEqual(original.environment[0]!.provides);
  expect(existing).toEqual(original);
});
