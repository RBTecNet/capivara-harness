import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../../src/domain/types.js';
import { checkInputHash } from '../../src/execution/checks.js';
import { createInspectionIdentity, inspectionStillCurrent } from '../../src/execution/inspection.js';
import { digest } from '../../src/execution/files.js';
import { runBuild } from '../../src/execution/build.js';
import { executeCommand } from '../../src/runtime/command.js';
import type { BuildOptions } from '../../src/execution/types.js';
import type { AgentResult } from '../../src/runtime/types.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
  const workspace=await mkdtemp(join(tmpdir(),'capivara-inspection-'));roots.push(workspace);await mkdir(join(workspace,'src'));
  await writeFile(join(workspace,'src/cli.mjs'),'console.log("alpha");\n');
  await writeFile(join(workspace,'src/config.json'),'{"value":1}');
  await writeFile(join(workspace,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Alpha',summary:'Print alpha',request:'Create a CLI that prints alpha.',modes:['cli'],targets:['portable'],requirements:[{id:'alpha',statement:'Print alpha.',mode:'cli',source:{kind:'request',reference:'request',text:'Create a CLI that prints alpha.'}}],constraints:[],decisions:[],gaps:[]};
  const task:WorkUnit={id:'alpha',title:'Alpha',goal:'Print alpha.',instructions:'Implement the alpha command.',requirementIds:['alpha'],dependsOn:[],environmentIds:['node'],contractIds:[],files:['src/cli.mjs'],inputs:['src/config.json'],criteria:['Print alpha.'],checks:[{id:'alpha-cli',kind:'cli',command:process.execPath,args:['src/cli.mjs'],inputs:['src/cli.mjs'],assertion:{type:'contains',value:'alpha'},requirementIds:['alpha'],requiredCapabilities:[]}],risk:'normal',blockedBy:[]};
  const plan:DevelopmentPlan={schema:'capivara/plan/1',status:'ready',revision:1,briefId:'b',briefRevision:1,environment:[{id:'node',name:'Node',kind:'runtime',identity:{capability:'runtime',kind:'runtime',provider:'selected-node'},dependsOn:[],targets:[],reason:'Execute the CLI.',check:{command:process.execPath,args:['--version']},prepare:[]}],contracts:[],tasks:[task]};
  return{workspace,brief,task,plan};
}

describe('identidade da inspeção independente de receitas mecânicas',()=>{
  it('preserva inspeção quando só o manifesto automático ou a receita muda, mantendo a prova afetada obsoleta',async()=>{
    const f=await fixture();
    const identity=await createInspectionIdentity(f.workspace,f.brief,f.plan,f.task);
    const proof=await checkInputHash(f.workspace,f.plan,f.task,f.task.checks[0]!,f.brief);
    expect(identity.usable).toBe(true);expect(identity.sources['package.json']).toBeUndefined();
    await writeFile(join(f.workspace,'package.json'),JSON.stringify({scripts:{test:'node --test',build:'node build.mjs'}}));
    expect(await checkInputHash(f.workspace,f.plan,f.task,f.task.checks[0]!,f.brief)).not.toBe(proof);
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,f.task)).toBe(true);
    const changed=structuredClone(f.task);changed.checks=[{...changed.checks[0]!,id:'new-instrument',args:['src/cli.mjs','--observable'],assertion:{type:'regex',pattern:'^alpha$'}}];
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,changed)).toBe(true);
    const prepared=structuredClone(f.plan);prepared.environment[0]!.prepare=[{command:'new-provider-installer',args:['--local']}];prepared.environment[0]!.check={command:'new-readiness-probe'};
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,prepared,f.task)).toBe(true);
    prepared.environment[0]!.identity!.provider='different-runtime';
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,prepared,f.task)).toBe(false);
  });

  it('invalida quando fonte inspecionada, leitura explícita ou autoridade material muda',async()=>{
    const f=await fixture(),identity=await createInspectionIdentity(f.workspace,f.brief,f.plan,f.task);
    const criteria=structuredClone(f.task);criteria.criteria.push('Reject invalid input.');
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,criteria)).toBe(false);
    const restricted=structuredClone(f.brief);restricted.constraints.push({id:'no-network',statement:'No network access.',source:{kind:'request',reference:'request',text:'No network access.'},forbiddenCapabilities:['network'],requiredCapabilities:[]});
    expect(await inspectionStillCurrent(identity,f.workspace,restricted,f.plan,f.task)).toBe(false);
    await writeFile(join(f.workspace,'src/config.json'),'{"value":2}');
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,f.task)).toBe(false);
    await writeFile(join(f.workspace,'src/config.json'),'{"value":1}');
    await writeFile(join(f.workspace,'src/cli.mjs'),'console.log("changed alpha");\n');
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,f.task)).toBe(false);
  });

  it('captura membros de diretórios/globs, ausência e arquivos adicionais entregues para foco',async()=>{
    const f=await fixture();
    const task={...f.task,files:['src/**/*.mjs'],inputs:['src/future.json']};
    const identity=await createInspectionIdentity(f.workspace,f.brief,f.plan,task);
    expect(identity.sources['selector:src/future.json']).toBe('missing');
    await writeFile(join(f.workspace,'src/new.mjs'),'export const added = true;');
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,task)).toBe(false);
    await rm(join(f.workspace,'src/new.mjs'));await writeFile(join(f.workspace,'src/future.json'),'{}');
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,task)).toBe(false);
    await rm(join(f.workspace,'src/future.json'));
    await writeFile(join(f.workspace,'focused.mjs'),'export const focused = 1;');
    const focused=await createInspectionIdentity(f.workspace,f.brief,f.plan,f.task,[{path:'focused.mjs',hash:digest('export const focused = 1;')}]);
    expect(focused.usable).toBe(true);expect(await inspectionStillCurrent(focused,f.workspace,f.brief,f.plan,f.task)).toBe(true);
    await writeFile(join(f.workspace,'focused.mjs'),'export const focused = 2;');
    expect(await inspectionStillCurrent(focused,f.workspace,f.brief,f.plan,f.task)).toBe(false);
    await rm(join(f.workspace,'src/cli.mjs'));
    expect(await inspectionStillCurrent(identity,f.workspace,f.brief,f.plan,task)).toBe(false);
  });

  it.skipIf(process.platform==='win32')('não reutiliza identidade legada, recibo stale ou fonte que escapa do workspace',async()=>{
    const f=await fixture();
    expect(await inspectionStillCurrent(undefined,f.workspace,f.brief,f.plan,f.task)).toBe(false);
    const stale=await createInspectionIdentity(f.workspace,f.brief,f.plan,f.task,[{path:'src/cli.mjs',hash:digest('obsolete source')}]);
    expect(stale.usable).toBe(false);expect(await inspectionStillCurrent(stale,f.workspace,f.brief,f.plan,f.task)).toBe(false);
    const outside=await mkdtemp(join(tmpdir(),'capivara-inspection-outside-'));roots.push(outside);await writeFile(join(outside,'external.mjs'),'external source');
    await symlink(join(outside,'external.mjs'),join(f.workspace,'linked.mjs'));
    const unsafe=await createInspectionIdentity(f.workspace,f.brief,f.plan,{...f.task,inputs:['linked.mjs']});
    expect(unsafe.usable).toBe(false);expect(unsafe.sources['linked.mjs']).toBeUndefined();
  });
});

it('reruns a changed manifest proof while preserving inspection, and obtains fresh inspection for changed owned source',async()=>{
  const f=await fixture();await rm(join(f.workspace,'src/cli.mjs'));
  f.task.environmentIds=[];
  f.plan.environment=[];
  let editors=0,reviewers=0,proofs=0;
  const complete=(text=''):AgentResult=>({status:'complete',text,commands:[],changedFiles:[]});
  const options:BuildOptions={workspace:f.workspace,brief:f.brief,plan:f.plan,signal:AbortSignal.timeout(5000),executeCommand:async request=>{
    if(request.executionPolicy?.purpose==='verification')proofs++;
    return executeCommand(request);
  },agent:async request=>{
    if(request.role==='reviewer'){reviewers++;return complete('{"approved":true,"findings":[]}');}
    expect(request.role).toBe('editor');editors++;await writeFile(join(request.workspace,'src/cli.mjs'),'console.log("alpha");\n');return complete();
  }};
  const first=await runBuild(options);
  expect(first.status,JSON.stringify(first.incidents)).toBe('complete');
  expect({editors,reviewers,proofs}).toEqual({editors:1,reviewers:1,proofs:1});
  expect(first.state.tasks.alpha?.reviews?.find(review=>review.assessment.decision==='approved')?.inspection?.usable).toBe(true);
  await writeFile(join(f.workspace,'package.json'),JSON.stringify({scripts:{test:'node --test',docs:'node generate-docs.mjs'}}));
  const second=await runBuild({...options,plan:first.plan,state:JSON.parse(JSON.stringify(first.state)),signal:AbortSignal.timeout(5000)});
  expect(second.status,JSON.stringify(second.incidents)).toBe('complete');
  expect({editors,reviewers,proofs}).toEqual({editors:1,reviewers:1,proofs:2});
  expect(second.state.metrics?.repetitions.some(item=>item.action==='reuse-inspection')).toBe(true);
  await writeFile(join(f.workspace,'src/cli.mjs'),'// This actual owned source has changed.\nconsole.log("alpha");\n');
  const third=await runBuild({...options,plan:second.plan,state:JSON.parse(JSON.stringify(second.state)),signal:AbortSignal.timeout(5000)});
  expect(third.status,JSON.stringify(third.incidents)).toBe('complete');
  expect({editors,reviewers,proofs}).toEqual({editors:1,reviewers:2,proofs:3});
  const changed=structuredClone(third.plan);changed.revision++;changed.tasks[0]!.criteria.push('Output alpha is visible on stdout.');
  const fourth=await runBuild({...options,plan:changed,state:JSON.parse(JSON.stringify(third.state)),signal:AbortSignal.timeout(5000)});
  expect(fourth.status,JSON.stringify(fourth.incidents)).toBe('complete');
  expect({editors,reviewers,proofs}).toEqual({editors:1,reviewers:3,proofs:3});
});
