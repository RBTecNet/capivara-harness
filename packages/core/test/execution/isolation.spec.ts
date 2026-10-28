import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, stat, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTaskWorkspace, prepareIntegration, publishIntegration, IntegrationConflict } from '../../src/execution/isolation.js';

const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace(){const path=await mkdtemp(join(tmpdir(),'capivara-integration-'));temporary.push(path);return path;}

it('recovers a partially published transaction idempotently without replaying its editor',async()=>{
  const root=await workspace();
  await writeFile(join(root,'a.txt'),'old a');await writeFile(join(root,'b.txt'),'old b');
  const checkpoint=await createTaskWorkspace(root,'unit','hash',['a.txt','b.txt']);
  await writeFile(join(checkpoint.directory,'a.txt'),'new a');await writeFile(join(checkpoint.directory,'b.txt'),'new b');
  const transaction=await prepareIntegration(root,'unit',checkpoint,['a.txt','b.txt']);
  await writeFile(join(root,'a.txt'),'new a'); // process died after publishing only its first path
  await publishIntegration(root,JSON.parse(JSON.stringify(transaction)));
  await publishIntegration(root,transaction);
  expect(await readFile(join(root,'a.txt'),'utf8')).toBe('new a');
  expect(await readFile(join(root,'b.txt'),'utf8')).toBe('new b');
});

it('validates the complete write set before publication and preserves both sides of a conflict',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src/shared.txt'),'base');
  const checkpoint=await createTaskWorkspace(root,'unit','hash',['src']);
  await writeFile(join(checkpoint.directory,'src/shared.txt'),'private change');
  await writeFile(join(checkpoint.directory,'src/independent.txt'),'must not publish partially');
  const transaction=await prepareIntegration(root,'unit',checkpoint,['src']);
  await writeFile(join(root,'src/shared.txt'),'concurrent user change');
  await expect(publishIntegration(root,transaction)).rejects.toBeInstanceOf(IntegrationConflict);
  expect(await readFile(join(root,'src/shared.txt'),'utf8')).toBe('concurrent user change');
  expect(await readFile(join(checkpoint.directory,'src/shared.txt'),'utf8')).toBe('private change');
  await expect(readFile(join(root,'src/independent.txt'))).rejects.toMatchObject({code:'ENOENT'});
});

it('publishes a mode-only executable change and preserves it through restart',async()=>{
  if(process.platform==='win32')return;
  const root=await workspace();await writeFile(join(root,'tool.sh'),'#!/bin/sh\necho ready\n',{mode:0o644});
  const checkpoint=await createTaskWorkspace(root,'tool','hash',['tool.sh']);
  await chmod(join(checkpoint.directory,'tool.sh'),0o755);
  const transaction=await prepareIntegration(root,'tool',checkpoint,['tool.sh']);
  expect(transaction.files).toHaveLength(1);
  await publishIntegration(root,JSON.parse(JSON.stringify(transaction)));
  await publishIntegration(root,transaction);
  expect((await stat(join(root,'tool.sh'))).mode&0o777).toBe(0o755);
});

it('refuses a canonical parent replaced by a symlink and leaves the external directory untouched',async()=>{
  if(process.platform==='win32')return;
  const root=await workspace(),outside=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src/shared.txt'),'base');
  const checkpoint=await createTaskWorkspace(root,'unit','hash',['src']);await writeFile(join(checkpoint.directory,'src/shared.txt'),'new');
  const transaction=await prepareIntegration(root,'unit',checkpoint,['src']);
  await rename(join(root,'src'),join(outside,'actual'));await symlink(join(outside,'actual'),join(root,'src'),'dir');
  await expect(publishIntegration(root,transaction)).rejects.toThrow();
  expect(await readFile(join(outside,'actual/shared.txt'),'utf8')).toBe('base');
});

it('validates every staged image before publishing any of them',async()=>{
  const root=await workspace();await writeFile(join(root,'a.txt'),'old a');await writeFile(join(root,'b.txt'),'old b');
  const checkpoint=await createTaskWorkspace(root,'unit','hash',['a.txt','b.txt']);
  await writeFile(join(checkpoint.directory,'a.txt'),'new a');await writeFile(join(checkpoint.directory,'b.txt'),'new b');
  const transaction=await prepareIntegration(root,'unit',checkpoint,['a.txt','b.txt']);await writeFile(join(checkpoint.directory,'b.txt'),'corrupted after preparation');
  await expect(publishIntegration(root,transaction)).rejects.toThrow();
  expect(await readFile(join(root,'a.txt'),'utf8')).toBe('old a');expect(await readFile(join(root,'b.txt'),'utf8')).toBe('old b');
});

it('preserves internal module aliases as links so verification sees the same module identity',async()=>{
  if(process.platform==='win32')return;
  const root=await workspace();await writeFile(join(root,'core.mjs'),'export const instance={};\n');
  await symlink(join(root,'core.mjs'),join(root,'alias.mjs'),'file');
  await writeFile(join(root,'entry.mjs'),"import {instance as first} from './core.mjs';import {instance as second} from './alias.mjs';console.log(first===second?'same':'different');\n");
  const checkpoint=await createTaskWorkspace(root,'unit','hash',['entry.mjs','core.mjs']);
  const result=await promisify(execFile)(process.execPath,['entry.mjs'],{cwd:checkpoint.directory});
  expect(result.stdout.trim()).toBe('same');
  await writeFile(join(checkpoint.directory,'core.mjs'),'export const instance={updated:true};\n');
  const transaction=await prepareIntegration(root,'unit',checkpoint,['entry.mjs','core.mjs']);
  expect(transaction.files.map(item=>item.path)).toEqual(['core.mjs']);
  await publishIntegration(root,transaction);
  expect(await readFile(join(root,'core.mjs'),'utf8')).toContain('updated');
});
