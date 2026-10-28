import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const artifacts=join(root,'docs','rc2-evidence');
const isolated=await mkdtemp(join(tmpdir(),'capivara-rc2-environment-baseline-'));
function run(binary,args,options={}){const result=spawnSync(binary,args,{encoding:'utf8',maxBuffer:16*1024*1024,...options});if(result.error)throw result.error;return result;}
try{
  const archive=run('git',['archive','77a1178','packages/core/src','packages/core/package.json','packages/core/tsconfig.json','package.json'],{cwd:root,encoding:'buffer'});
  if(archive.status!==0)throw new Error(String(archive.stderr));
  const unpacked=run('tar',['-x','-C',isolated],{input:archive.stdout});if(unpacked.status!==0)throw new Error(unpacked.stderr);
  await symlink(join(root,'node_modules'),join(isolated,'node_modules'),process.platform==='win32'?'junction':'dir');
  const fixture=join(isolated,'packages/core/test/execution/environment-proofs.spec.ts');await mkdir(dirname(fixture),{recursive:true});
  await writeFile(fixture,await readFile(join(artifacts,'environment-before.spec.ts.txt')));
  const vitest=join(root,'node_modules/vitest/vitest.mjs');
  const before=run(process.execPath,[vitest,'run','test/execution/environment-proofs.spec.ts','--reporter=json','--outputFile',join(artifacts,'environment-before.json')],{cwd:join(isolated,'packages/core')});
  await writeFile(join(artifacts,'environment-before.log'),before.stdout+before.stderr);
  const after=run(process.execPath,[vitest,'run','test/execution/environment-proofs.spec.ts','--reporter=json','--outputFile',join(artifacts,'environment-after.json')],{cwd:join(root,'packages/core')});
  await writeFile(join(artifacts,'environment-after.log'),after.stdout+after.stderr);
  const prior=JSON.parse(await readFile(join(artifacts,'environment-before.json'),'utf8'));
  const current=JSON.parse(await readFile(join(artifacts,'environment-after.json'),'utf8'));
  if(before.status!==1||prior.numFailedTests!==7||after.status!==0||current.numFailedTests!==0)throw new Error('The reproduced before/after evidence did not match the regression criteria.');
  const apiFixture=join(isolated,'packages/core/test/runtime/api-loop.spec.ts');await mkdir(dirname(apiFixture),{recursive:true});await writeFile(apiFixture,await readFile(join(artifacts,'api-loop-before.spec.ts.txt')));
  const apiBefore=run(process.execPath,[vitest,'run','test/runtime/api-loop.spec.ts','--reporter=json','--outputFile',join(artifacts,'api-loop-before.json')],{cwd:join(isolated,'packages/core')});
  await writeFile(join(artifacts,'api-loop-before.log'),apiBefore.stdout+apiBefore.stderr);
  const apiAfter=run(process.execPath,[vitest,'run','test/runtime/api-loop.spec.ts','--reporter=json','--outputFile',join(artifacts,'api-loop-after.json')],{cwd:join(root,'packages/core')});
  await writeFile(join(artifacts,'api-loop-after.log'),apiAfter.stdout+apiAfter.stderr);
  const apiPrior=JSON.parse(await readFile(join(artifacts,'api-loop-before.json'),'utf8')),apiCurrent=JSON.parse(await readFile(join(artifacts,'api-loop-after.json'),'utf8'));
  if(apiBefore.status!==1||apiPrior.numFailedTests!==2||apiAfter.status!==0||apiCurrent.numFailedTests!==0)throw new Error('API progress guard regression evidence did not match.');
  console.log(JSON.stringify({baseline:'77a1178',environment:{before:{failed:prior.numFailedTests,passed:prior.numPassedTests},after:{failed:current.numFailedTests,passed:current.numPassedTests}},api:{before:{failed:apiPrior.numFailedTests,passed:apiPrior.numPassedTests},after:{failed:apiCurrent.numFailedTests,passed:apiCurrent.numPassedTests}},paidInferenceCalls:0},null,2));
}finally{await rm(isolated,{recursive:true,force:true});}
