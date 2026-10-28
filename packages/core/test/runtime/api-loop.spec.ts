import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runApiAgent } from '../../src/runtime/api.js';
import type { AgentRequest } from '../../src/runtime/types.js';
const temporary:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function request():Promise<AgentRequest>{const workspace=await mkdtemp(join(tmpdir(),'capivara-api-progress-'));temporary.push(workspace);return{workspace,role:'editor',instruction:'Implement this unit using the actual files.',config:{provider:'openai',model:'offline-fixture',apiKey:'fixture-key'}};}
const tool=(id:number,name:string,input:unknown)=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:`call-${id}`,type:'function',function:{name,arguments:JSON.stringify(input)}}]},finish_reason:'tool_calls'}]}));
const final=()=>new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Complete.'},finish_reason:'stop'}]}));
it('stops an unproductive alternating read loop despite new call IDs and persists the stop',async()=>{
  const req=await request();req.readOnly=true;req.config.contextTokens=2000;req.config.maxOutputTokens=500;await writeFile(join(req.workspace,'a.txt'),'alpha'.repeat(2000));await writeFile(join(req.workspace,'b.txt'),'beta'.repeat(2000));let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>++calls<=20?tool(calls,'read_file',{path:calls%2?'a.txt':'b.txt'}):final()));
  const result=await runApiAgent(req);expect(result.status).toBe('partial');expect(result.issue?.kind).toBe('instrument');expect(calls).toBeLessThan(10);
  const stoppedAt=calls;const resumed=await runApiAgent(req);expect(resumed.status).toBe('partial');expect(calls).toBe(stoppedAt);
  await writeFile(join(req.workspace,'a.txt'),'new evidence');vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return final();}));
  expect((await runApiAgent(req)).status).toBe('complete');expect(calls).toBe(stoppedAt+1);
});
it('counts real mutations but rejects repeated identical writes and preserves their effects',async()=>{
  const req=await request();let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls<=20?tool(calls,'write_file',{path:'implemented.txt',content:'preserved implementation'}):final()));
  const result=await runApiAgent(req);expect(result.status).toBe('partial');expect(result.changedFiles).toContain('implemented.txt');expect(calls).toBeLessThan(10);
  expect(await readFile(join(req.workspace,'implemented.txt'),'utf8')).toBe('preserved implementation');
});

it('permits new relevant reads and actual implementation instead of treating tool use itself as a loop',async()=>{
  const req=await request();for(let index=0;index<8;index++)await writeFile(join(req.workspace,`file-${index}.txt`),`Fact ${index}`);let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return calls<=8?tool(calls,'read_file',{path:`file-${calls-1}.txt`}):calls===9?tool(calls,'write_file',{path:'completed.txt',content:'all relevant facts processed'}):final();}));
  const result=await runApiAgent(req);expect(result.status).toBe('complete');expect(result.changedFiles).toContain('completed.txt');expect(result.diagnostics?.informationalObservations).toBe(8);expect(result.diagnostics?.mutations).toBe(1);expect(calls).toBe(10);
});
it('bounds a stream of unique actions honestly when the configured round capacity is exhausted',async()=>{
  const req=await request();req.config.maxToolRounds=3;for(let index=0;index<3;index++)await writeFile(join(req.workspace,`fact-${index}.txt`),`${index}`);let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>tool(++calls,'read_file',{path:`fact-${calls-1}.txt`})));
  const result=await runApiAgent(req);expect(result.status).toBe('partial');expect(result.diagnostics?.stoppedBecause).toBe('round-limit');expect(result.diagnostics?.informationalObservations).toBe(3);expect(calls).toBe(3);
});

it('preserves a stopped operation but permits a distinct ledgered recovery strategy',async()=>{
  const req=await request();req.readOnly=true;req.operationKey='persisted-targeted-action';await writeFile(join(req.workspace,'fact.txt'),'same source');let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>tool(++calls,'read_file',{path:'fact.txt'})));
  expect((await runApiAgent(req)).issue?.kind).toBe('instrument');
  const before=calls;await runApiAgent(req);expect(calls).toBe(before);
  req.operationKey='persisted-diagnosed-action';
  vi.stubGlobal('fetch',vi.fn(async()=>{calls++;return final();}));
  expect((await runApiAgent(req)).status).toBe('complete');expect(calls).toBe(before+1);
});
