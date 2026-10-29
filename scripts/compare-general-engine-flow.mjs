/** Identical scripted agents against two engines; native builds and execution, no paid inference. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseline=execFileSync('git',['rev-parse','--verify',`${process.argv[2]??'83cb4a0'}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
const output=resolve(root,process.argv[3]??'docs/rc2-evidence/general-flow-comparison.json');
const temporary=await mkdtemp(join(tmpdir(),'capivara-general-comparison-'));
const test='packages/core/test/app/general-engine-flow.spec.ts';
const hash=value=>createHash('sha256').update(value).digest('hex');
try{
  const before=join(temporary,'before');await mkdir(before);
  const archive=execFileSync('git',['archive',baseline,'packages/core/src'],{cwd:root});
  execFileSync('tar',['-x','-C',before],{input:archive});
  await mkdir(join(before,'packages/core/test/app'),{recursive:true});
  await copyFile(join(root,test),join(before,test));await symlink(join(root,'node_modules'),join(before,'node_modules'),'dir');
  const run=(source,label)=>{
    const report=join(temporary,`${label}.json`);
    const result=spawnSync(join(root,'node_modules/.bin/vitest'),['run','test/app/general-engine-flow.spec.ts','--reporter=json',`--outputFile=${report}`],{cwd:join(source,'packages/core'),encoding:'utf8',maxBuffer:8*1024*1024});
    return{exitCode:result.status,report,diagnostics:result.status===null?result.error?.message:undefined};
  };
  const previous=run(before,'before'),current=run(root,'after');
  const summarize=async run=>{
    const data=JSON.parse(await readFile(run.report,'utf8'));
    return{exitCode:run.exitCode,cases:data.testResults.flatMap(file=>file.assertionResults).map(item=>({name:item.title,status:item.status,durationMs:item.duration,...(item.failureMessages?.length?{failure:item.failureMessages[0].replace(/\u001b\[[0-9;]*m/g,'').slice(0,1800)}:{})}))};
  };
  const beforeResult=await summarize(previous),afterResult=await summarize(current);
  assert.ok(beforeResult.cases.some(item=>item.status==='failed'),'The baseline did not reproduce a regression.');
  assert.equal(afterResult.exitCode,0,'The changed engine must finish every declared scenario.');
  assert.ok(afterResult.cases.every(item=>item.status==='passed'));
  assert.deepEqual(beforeResult.cases.map(item=>item.name),afterResult.cases.map(item=>item.name));
  const paths=['app/workflow.ts','app/questions.ts','domain/types.ts','domain/init.ts','domain/question-policy.ts','domain/bindings.ts','domain/verifications.ts','domain/plan.ts','domain/plan-records.ts','domain/reconcile.ts','domain/requirement-lineage.ts','domain/engineering-context.ts','execution/build.ts','execution/checks.ts','execution/dependencies.ts','execution/environment.ts','execution/conformance.ts','execution/inspection.ts','execution/acceptance-selection.ts','execution/prepared-context.ts','runtime/provider-observation.ts'];
  const sources=await Promise.all(paths.map(async path=>({path:`packages/core/src/${path}`,sha256:hash(await readFile(join(root,'packages/core/src',path)))})));
  const result={schema:'capivara/general-engine-comparison/1',generatedAt:new Date().toISOString(),baseline,test:{path:test,sha256:hash(await readFile(join(root,test)))},sources,before:beforeResult,after:afterResult,
    evidenceScope:{completeWorkflows:['Node.js CLI','Python CLI','TypeScript compiler SDK and generated CLI'],planningWorkflows:['TUI','web'],agentTransport:'injected deterministic responses',productCommands:'real native execution',paidInferenceCalls:0,originalExampleModified:false},
    limits:['Five representative scenarios do not establish reliability for every possible project.','Web and TUI scenarios in this file validate planning; separate PTY pilots cover terminal execution.','Wall time of an interrupted baseline is not a completion-time performance comparison.']};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({output,baseline,before:beforeResult.cases.map(({name,status})=>({name,status})),after:afterResult.cases.map(({name,status})=>({name,status})),paidInferenceCalls:0}));
}finally{await rm(temporary,{recursive:true,force:true});}
