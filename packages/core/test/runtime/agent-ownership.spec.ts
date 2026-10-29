import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../src/runtime/agent.js';

async function state(pid:number):Promise<{start:string;state:string}|undefined>{
  try{const raw=await readFile(`/proc/${pid}/stat`,'utf8'),parts=raw.slice(raw.lastIndexOf(')')+2).split(' ');return{start:parts[19]!,state:parts[0]!};}catch{return undefined;}
}

it.skipIf(process.platform!=='linux')('bounds timeout despite unowned inherited stdout, cleaning only the identified invocation processes',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-cli-ownership-')),outside=await mkdtemp(join(tmpdir(),'capivara-cli-outside-')),id=randomUUID();
  const control=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:workspace,stdio:'ignore',detached:true});
  let orphan:{pid:number;start:string}|undefined;
  let unowned:{pid:number;start:string}|undefined;
  try{
    const script=join(workspace,'fixture-cli.mjs');
    await writeFile(script,"import{spawn}from'node:child_process';const options={env:process.env,detached:true};const owned=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,cwd:process.cwd(),stdio:'ignore'});const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,cwd:process.env.FIXTURE_OUTSIDE_CWD,stdio:'inherit'});owned.unref();external.unref();setTimeout(()=>{console.log(JSON.stringify({orphan:owned.pid,unowned:external.pid,cli:process.pid}));},80);");
    const messages:string[]=[],started=Date.now();
    const result=await runAgent({workspace,invocationId:id,role:'editor',config:{provider:'fixture-cli',command:process.execPath,args:[script]},environment:{FIXTURE_OUTSIDE_CWD:outside},instruction:'Exercise process ownership without inference.',timeoutMs:250,onEvent:event=>{if(event.message)messages.push(event.message);}});
    expect(Date.now()-started).toBeLessThan(3000);
    expect(result.status).toBe('partial');expect(result.issue?.kind).toBe('transport');
    const spawned=JSON.parse(result.text) as {orphan:number;unowned:number;cli:number};
    const external=await state(spawned.unowned);if(external)unowned={pid:spawned.unowned,start:external.start};
    const ledger=JSON.parse(await readFile(join(workspace,'.capivara-runtime','agent-ownership',`${id}.json`),'utf8')) as {id:string;status:string;processes:{pid:number;parent:number;group:number;startTicks:string}[];remaining:unknown[]};
    const owned=ledger.processes.find(entry=>entry.pid===spawned.orphan)!;
    if(owned)orphan={pid:owned.pid,start:owned.startTicks};
    expect(owned).toBeDefined();expect(owned.group).toBe(spawned.orphan);expect(owned.parent).not.toBe(spawned.cli);
    expect(ledger.status).toBe('closed');expect(ledger.remaining).toEqual([]);
    expect([undefined,'Z']).toContain((await state(spawned.orphan))?.state);
    expect(ledger.processes.some(entry=>entry.pid===control.pid)).toBe(false);
    expect(ledger.processes.some(entry=>entry.pid===spawned.unowned)).toBe(false);
    expect(external).toBeDefined();expect(external!.state).not.toBe('Z');
    expect(messages.some(message=>message.includes('Processos fora da propriedade comprovada'))).toBe(true);
    expect(await state(control.pid!)).toBeDefined();expect(control.exitCode).toBeNull();
  }finally{
    if(control.exitCode===null)control.kill('SIGKILL');
    if(orphan&&(await state(orphan.pid))?.start===orphan.start)try{process.kill(orphan.pid,'SIGKILL');}catch{}
    if(unowned&&(await state(unowned.pid))?.start===unowned.start)try{process.kill(unowned.pid,'SIGKILL');}catch{}
    await rm(workspace,{recursive:true,force:true});
    await rm(outside,{recursive:true,force:true});
  }
});
