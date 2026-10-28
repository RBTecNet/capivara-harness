import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const artifacts=join(root,'docs/rc2-evidence');
const temporary=await mkdtemp(join(tmpdir(),'capivara-review-comparison-'));
const fixture=`import {expect,it} from 'vitest';
import {interpretReview} from '../../src/execution/ENTRY.js';
it('retains a material runtime defect despite an advisory label',()=>{
 const text=JSON.stringify({approved:false,findings:[{material:false,severity:'style',file:'app.ts',expected:'Export persists data',observed:'Export fails with EROFS',evidence:'The actual export command returned EROFS',fix:'Use the writable destination required by the original request'}]});
 const result=interpretReview(text);expect(result.findings).toHaveLength(1);expect(result.approved).toBe(false);expect(result.original).toBe(text);
});
it('represents rejection without findings as unresolved and preserves the original',()=>{
 const text='{"approved":false,"findings":[]}';const result=interpretReview(text);expect(result.decision).toBe('unresolved');expect(result.original).toBe(text);
});
`;
function run(binary,args,options={}){const result=spawnSync(binary,args,{encoding:'utf8',maxBuffer:16*1024*1024,...options});if(result.error)throw result.error;return result;}
try{
 const before=join(temporary,'before');await mkdir(before);
 const archive=run('git',['archive','77a1178','packages/core/src','packages/core/package.json','packages/core/tsconfig.json','package.json'],{cwd:root,encoding:'buffer'});
 if(archive.status!==0)throw new Error(String(archive.stderr));
 const extracted=run('tar',['-x','-C',before],{input:archive.stdout});if(extracted.status!==0)throw new Error(extracted.stderr);
 const after=join(temporary,'after');await mkdir(join(after,'packages/core'),{recursive:true});
 await cp(join(root,'packages/core/src'),join(after,'packages/core/src'),{recursive:true});
 await cp(join(root,'packages/core/package.json'),join(after,'packages/core/package.json'));
 for(const [label,workspace,entry] of [['before',before,'build'],['after',after,'review']]){
  await symlink(join(root,'node_modules'),join(workspace,'node_modules'),process.platform==='win32'?'junction':'dir');
  const file=join(workspace,'packages/core/test/execution/review-comparison.spec.ts');await mkdir(dirname(file),{recursive:true});await writeFile(file,fixture.replace('ENTRY',entry));
  const result=run(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run','test/execution/review-comparison.spec.ts','--reporter=json','--outputFile',join(artifacts,`review-${label}.json`)],{cwd:join(workspace,'packages/core')});
  await writeFile(join(artifacts,`review-${label}.log`),result.stdout+result.stderr);
  const report=JSON.parse(await readFile(join(artifacts,`review-${label}.json`),'utf8'));
  if(label==='before'?(result.status!==1||report.numFailedTests!==2):(result.status!==0||report.numPassedTests!==2))throw new Error(`Unexpected ${label} result`);
 }
 await writeFile(join(artifacts,'review-comparison-fixture.spec.ts.txt'),fixture);
 console.log(JSON.stringify({baseline:'77a1178',before:{failed:2,passed:0},after:{failed:0,passed:2},paidInferenceCalls:0}));
}finally{await rm(temporary,{recursive:true,force:true});}
