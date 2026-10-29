import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Verification } from '../../src/domain/types.js';
import { emptyOperationalEnvironment } from '../../src/execution/environment.js';
import { inputSnapshot } from '../../src/execution/files.js';
import { executeCommand } from '../../src/runtime/command.js';
import { startProviderObservation } from '../../src/runtime/provider-observation.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

it('observes descriptor writes after close or final process flush without recording instrument reads or unsafe paths',async()=>{
  const fixture=await mkdtemp(join(tmpdir(),'capivara-fd-write-'));roots.push(fixture);
  const root=join(fixture,'product');await mkdir(root);await mkdir(join(root,'node_modules'));
  await writeFile(join(root,'source.txt'),'actual source');
  await writeFile(join(root,'sync.payload'),'previous output');
  await writeFile(join(root,'writer.mjs'),`import fs from 'node:fs';
const fd=fs.openSync('sync.payload','w');fs.writeSync(fd,'first');fs.writeSync(fd,' second');fs.mkdirSync('subdir');process.chdir('subdir');fs.closeSync(fd);process.chdir('..');
await new Promise((resolve,reject)=>fs.open('async.payload','w',(error,fd)=>{if(error)return reject(error);fs.write(fd,'async final',(error)=>{if(error)return reject(error);fs.close(fd,error=>error?reject(error):resolve());});}));
const pending=fs.openSync('pending.payload','w');fs.writeSync(pending,'final process value');
for(const file of ['../escaped.payload','node_modules/changed.payload']){const fd=fs.openSync(file,'w');fs.writeSync(fd,'excluded');fs.closeSync(fd);}
const readonly=fs.openSync('source.txt','r');try{fs.writeSync(readonly,'forbidden');}catch{}finally{fs.closeSync(readonly);}
console.log('descriptor writes completed');
`);
  const paths=['source.txt','writer.mjs','sync.payload','async.payload','pending.payload'];
  const check:Verification={id:'descriptor-build',kind:'command',level:'build',command:process.execPath,args:['writer.mjs'],inputs:paths,requirementIds:[],requiredCapabilities:[]};
  const environment=emptyOperationalEnvironment(root),observation=await startProviderObservation(root,check,environment);
  expect(observation.enabled).toBe(true);
  try{
    const result=await executeCommand({cwd:root,command:[process.execPath,'writer.mjs'],environment:{...environment.env,...observation.environment}});
    expect(result.exitCode,result.stderr).toBe(0);
    const writes=await observation.finishWrites!(),snapshot=await inputSnapshot(root,paths);
    expect(writes.map(write=>write.path).sort()).toEqual(['async.payload','pending.payload','sync.payload']);
    for(const write of writes)expect(write.hash).toBe(snapshot[write.path]);
    expect((await observation.finishConsumptions!()).filter(read=>writes.some(write=>write.path===read.path))).toEqual([]);
    expect(observation.diagnostics).toEqual([]);
  }finally{await observation.cleanup();}
});
