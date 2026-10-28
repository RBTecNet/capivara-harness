import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflow } from '../../src/app/workflow.js';
import { ProjectStore } from '../../src/app/store.js';
import { recoverOperation } from '../../src/app/recovery.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

it('persists a domain transport suspension and probes again only on an explicit retry',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-domain-ledger-'));temporary.push(workspace);let calls=0;
  const options={workspace,stage:'init' as const,request:'Create a CLI that prints alpha.',config:{provider:'injected-test'},signal:AbortSignal.timeout(2000),agent:async()=>{calls++;return{status:'unavailable' as const,text:'',commands:[],changedFiles:[],issue:{kind:'authentication' as const,message:'Credential is unavailable.',recoverable:true}};}};
  expect((await runWorkflow(options)).status).toBe('waiting');expect(calls).toBe(1);
  expect((await runWorkflow(options)).status).toBe('waiting');expect(calls).toBe(1);
  expect((await runWorkflow({...options,retrySuspended:true})).status).toBe('waiting');expect(calls).toBe(2);
  const store=new ProjectStore(workspace);
  try{expect(store.read().lastFailure?.kind).toBe('no-progress');expect(Object.values(store.read().domainCalls??{})).toHaveLength(1);}finally{store.close();}
});

it('does not cut off recovery while each step proves a new necessary state',async()=>{
  let resource=0,calls=0;
  const result=await recoverOperation(async()=>{calls++;if(resource<4)throw new Error(`missing stage ${resource}`);return 'ready';},{announce:()=>{},progressKey:()=>String(resource),recover:async()=>{resource++;}});
  expect(result).toBe('ready');expect(calls).toBe(5);
});
