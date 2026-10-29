import { afterEach, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProductBrief, Verification, WorkUnit } from '../../src/domain/types.js';
import { digest } from '../../src/execution/files.js';
import { createVerificationRepairContext } from '../../src/execution/verification-repair-context.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
it('keeps a complete immutable verification job while fitting a bounded operational packet',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-recipe-context-'));roots.push(workspace);
  const quote='The application must retain all actual records after restarting.';
  const brief:ProductBrief={schema:'capivara/product/1',id:'b',revision:1,status:'ready',name:'Product',summary:quote,request:quote,modes:['web'],targets:['portable'],requirements:[{id:'persistence',statement:quote,source:{kind:'request',reference:'request',text:quote},mode:'web',binding:{capability:'store',kind:'driver',provider:'Selected database'}}],constraints:[],decisions:[],gaps:[]};
  const checks:Verification[]=Array.from({length:8},(_,index)=>({id:`check-${index}`,kind:'command',command:'node',args:['-e',`console.log(${JSON.stringify('actual-program-'.repeat(2000))});`],assertion:{type:'contains',value:'actual-program'},requirementIds:['persistence'],requiredCapabilities:[],level:'behavior'}));
  const task:WorkUnit={id:'$acceptance',title:'Final verification',goal:quote,instructions:'Retain the actual requirement.',requirementIds:['persistence'],dependsOn:[],environmentIds:[],contractIds:[],files:[],criteria:[quote],checks,risk:'normal',blockedBy:[]};
  const reason='Original runtime failure: '+ 'observed detail\n'.repeat(4000)+'REAL ERROR AT THE END';
  expect(JSON.stringify({task,checks,reason}).length).toBeGreaterThan(26761);
  const text=await createVerificationRepairContext({workspace,brief,task,checks,reason,limit:24000});
  expect(text.length).toBeLessThanOrEqual(24000);expect(text).toContain(quote);expect(text).toContain('Selected database');
  expect(text).toContain('Original runtime failure');expect(text).toContain('REAL ERROR AT THE END');expect(text).not.toContain(checks[0]!.args![1]!);
  const receipt=JSON.parse(text.split('\n')[0]!.slice('VERIFICATION REPAIR JOB '.length)) as {path:string;sha256:string;complete:boolean};
  const bytes=await readFile(join(workspace,receipt.path)),job=JSON.parse(bytes.toString());
  expect(digest(bytes)).toBe(receipt.sha256);expect(receipt.complete).toBe(false);
  expect(job.task).toEqual(task);expect(job.requirements).toEqual(brief.requirements);expect(job.checks).toEqual(checks);expect(job.reason).toBe(reason);
  const failure=JSON.parse(text.split('\n').find(line=>line.startsWith('ORIGINAL FAILURE '))!.slice('ORIGINAL FAILURE '.length));
  expect(failure.complete).toBe(false);expect(failure.omittedCharacters).toBeGreaterThan(0);
  if(process.platform!=='win32'){expect((await lstat(join(workspace,receipt.path))).mode&0o777).toBe(0o600);expect((await lstat(join(workspace,'.capivara-verification'))).mode&0o777).toBe(0o700);}
  const compact=await createVerificationRepairContext({workspace,brief,task,checks,reason,limit:512});expect(compact.length).toBeLessThanOrEqual(512);expect(compact).toContain(receipt.path);
});
