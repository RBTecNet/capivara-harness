/** Reconcile the same saved model answers; no inference, product commands or project writes. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const database=resolve(process.argv[2]??'/tmp/capivara-plan-efficiency-before-20261028/project.sqlite');
const baseline=process.argv[3]??'fc5f1da';
const output=resolve(root,process.argv[4]??'docs/rc2-evidence/plan-reconciliation.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const unique=values=>[...new Set(values)];
const temporary=await mkdtemp(join(tmpdir(),'capivara-plan-reconciliation-'));
function command(executable,args,options={}){
  const result=spawnSync(executable,args,{cwd:root,maxBuffer:32*1024*1024,...options});
  if(result.status!==0)throw new Error(`${executable}: ${String(result.stderr)}`);
  return result.stdout;
}
async function loadApi(source,label){
  const module=join(temporary,`${label}.mjs`);
  await build({entryPoints:[join(source,'packages/core/src/domain/index.ts')],outfile:module,bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',logLevel:'silent'});
  return import(pathToFileURL(module).href);
}
function normalizeOutline(api,answer,project){
  return api.normalizeTasks(answer.tasks,project.brief,project.plan.environment,project.plan.contracts,[]);
}
function proposal(api,answers,project){
  return {...structuredClone(project.plan),tasks:answers.flatMap(answer=>normalizeOutline(api,answer,project))};
}

try{
  const originalDatabaseHash=sha(await readFile(database));
  const db=new DatabaseSync(database,{readOnly:true});
  let project,eventCount;
  try{
    project=JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
    eventCount=db.prepare('SELECT count(*) AS count FROM events').get().count;
  }finally{db.close();}
  const calls=Object.entries(project.domainCalls??{}).sort(([,left],[,right])=>left.at.localeCompare(right.at));
  const outlineCalls=calls.filter(([,call])=>call.operation==='outline'&&call.status==='complete');
  assert.equal(outlineCalls.length,2,'This comparison requires exactly the two saved outline answers.');
  const answers=outlineCalls.map(([,call])=>JSON.parse(call.result));
  const beforeSource=join(temporary,'before');await mkdir(beforeSource);
  const archive=command('git',['archive',baseline,'packages/core/src']);
  command('tar',['-x','-C',beforeSource],{input:archive});
  const before=await loadApi(beforeSource,'before'),after=await loadApi(root,'after');
  let baselineFailure;
  try{before.reconcilePlan(project.brief,proposal(before,answers,project));}
  catch(error){baselineFailure={name:error.name,code:error.code,message:error.message};}
  assert.ok(baselineFailure?.message.includes('duas entregas diferentes'),'Baseline must reproduce the material recorded failure.');
  const reconciled=after.reconcilePlan(project.brief,proposal(after,answers,project));
  const covered=unique(reconciled.tasks.flatMap(task=>task.requirementIds));
  assert.equal(reconciled.tasks.length,7);assert.equal(covered.length,project.brief.requirements.length);
  const apiProofs=['tasks-module','categories-module','notes-module'].map(id=>{
    const initial=answers.flatMap(answer=>normalizeOutline(after,answer,project)).filter(task=>task.id===id);
    const final=reconciled.tasks.find(task=>task.id===id);
    const criteria=unique(initial.flatMap(task=>task.criteria));
    const descriptions=initial.flatMap(task=>task.checks).map(check=>check.expected).filter(Boolean);
    const predicate=after.verificationAssertionStatus(final.checks[0]);
    assert.equal(final.checks.length,1);assert.ok(criteria.every(criterion=>final.criteria.includes(criterion)));
    assert.ok(descriptions.every(description=>final.checks[0].expected.includes(description)));
    assert.ok(initial.every(task=>JSON.stringify(after.verificationAssertionStatus(task.checks[0]).assertion)===JSON.stringify(predicate.assertion)));
    const oldChecks=answers.flatMap(answer=>normalizeOutline(before,answer,project)).filter(task=>task.id===id).flatMap(task=>task.checks);
    return{id,checksBefore:before.reconcileChecks(oldChecks).length,checksAfter:final.checks.length,criteriaAfter:final.criteria.length,allCriteriaPreserved:true,allDescriptionsPreserved:true,effectivePredicatePreserved:predicate.status==='ready'};
  });
  const cachedCalls=[],uncachedCalls=[],stop=new Error('Stop after adopting cached slices, before further repairs.');
  const callKey=request=>sha(JSON.stringify({operation:request.operation,prompt:request.prompt,config:project.config}));
  const cached=request=>{const call=project.domainCalls[callKey(request)];return call?.status==='complete'&&typeof call.result==='string'&&!!call.result.trim();};
  let adopted;
  try{
    await after.runPlan({brief:structuredClone(project.brief),existing:structuredClone(project.plan),contextChars:24000,hasCachedCall:cached,agent:async request=>{
      const key=callKey(request);
      if(!cached(request)){uncachedCalls.push({operation:request.operation,key});throw new Error('An uncached model call is forbidden in this reproduction.');}
      cachedCalls.push({operation:request.operation,key});return project.domainCalls[key].result;
    },save:async patch=>{
      if(patch.plan?.planning?.groups.every(group=>group.outlineComplete)){adopted=structuredClone(patch.plan);throw stop;}
    }});
  }catch(error){if(error!==stop)throw error;}
  assert.ok(adopted);assert.equal(cachedCalls.length,1);assert.equal(cachedCalls[0].key,outlineCalls[1][0]);
  assert.deepEqual(adopted.environment,project.plan.environment);assert.deepEqual(adopted.tasks,reconciled.tasks);
  assert.equal(sha(await readFile(database)),originalDatabaseHash,'Read-only evidence database changed.');
  const sourceFiles=['plan.ts','reconcile.ts','types.ts'];
  const report={
    schema:'capivara/plan-reconciliation-comparison/1',generatedAt:new Date().toISOString(),
    input:{databaseSHA256:originalDatabaseHash,eventCount,status:project.status,stage:project.stage,hasExecution:!!project.execution,recordedCalls:calls.length,completeCalls:calls.filter(([,call])=>call.status==='complete').length,outlineResponses:outlineCalls.length,requirements:project.brief.requirements.length},
    baseline:{commit:command('git',['rev-parse',baseline],{encoding:'utf8'}).trim(),failure:baselineFailure},
    after:{sourceSHA256:sha(JSON.stringify(await Promise.all(sourceFiles.map(async file=>[file,sha(await readFile(join(root,'packages/core/src/domain',file)))])))),tasks:reconciled.tasks.length,taskIds:reconciled.tasks.map(task=>task.id),coveredRequirements:covered.length,apiProofs},
    resume:{cachedCalls,uncachedCalls:uncachedCalls.length,tasks:adopted.tasks.length,environmentUnchanged:true,stoppedBeforeFurtherRepairs:true,ready:false},
    safety:{paidInferenceCalls:0,productCommands:0,projectWrites:0,databaseUnchanged:true},
  };
  await mkdir(dirname(output),{recursive:true});await writeFile(output,`${JSON.stringify(report,null,2)}\n`);
  console.log(JSON.stringify({output,baselineFailed:true,tasks:reconciled.tasks.length,coverage:`${covered.length}/${project.brief.requirements.length}`,apiProofCounts:apiProofs.map(proof=>[proof.checksBefore,proof.checksAfter]),cachedCalls,paidInferenceCalls:0,ready:false}));
}finally{await rm(temporary,{recursive:true,force:true});}
