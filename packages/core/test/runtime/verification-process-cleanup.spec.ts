import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeCommand } from '../../src/runtime/command.js';

async function state(pid:number):Promise<{start:string;state:string}|undefined>{try{const raw=await readFile(`/proc/${pid}/stat`,'utf8'),parts=raw.slice(raw.lastIndexOf(')')+2).split(' ');return{start:parts[19]!,state:parts[0]!};}catch{return undefined;}}

it.skipIf(process.platform!=='linux')('cleans a temporary verification server after its runner exits successfully, preserving another session',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-process-'));
  const external=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:workspace,detached:true,stdio:'ignore'});
  let child:{pid:number;start:string}|undefined;
  try{
    const server="const fs=require('node:fs'),http=require('node:http');const s=http.createServer((q,r)=>r.end('ready'));s.listen(0,'127.0.0.1',()=>{const raw=fs.readFileSync('/proc/self/stat','utf8');process.send({pid:process.pid,start:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19],port:s.address().port});});";
    const runner=`const{spawn}=require('node:child_process');const server=spawn(process.execPath,['-e',${JSON.stringify(server)}],{stdio:['ignore','ignore','ignore','ipc']});server.on('message',value=>{process.stdout.write(JSON.stringify(value));server.disconnect();server.unref();});`;
    let output='';
    const result=await executeCommand({cwd:workspace,command:[process.execPath,'-e',runner],inputs:[],timeoutMs:3000,executionPolicy:{purpose:'verification',writeScope:'isolated-workspace'},onOutput:(text,stream)=>{if(stream==='stdout'){output+=text;try{child=JSON.parse(output) as typeof child;}catch{}}}});
    expect(result.exitCode).toBe(0);expect(result.timedOut).toBe(false);expect(result.cancelled).toBe(false);expect(result.issue).toBeUndefined();
    expect(child).toBeDefined();expect([undefined,'Z']).toContain((await state(child!.pid))?.state);
    expect(await state(external.pid!)).toBeDefined();expect(external.exitCode).toBeNull();
  }finally{
    if(external.exitCode===null)external.kill('SIGKILL');
    if(child&&(await state(child.pid))?.start===child.start)try{process.kill(child.pid,'SIGKILL');}catch{}
    await rm(workspace,{recursive:true,force:true});
  }
});
