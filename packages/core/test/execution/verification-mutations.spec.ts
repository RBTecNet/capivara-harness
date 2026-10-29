import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Verification } from '../../src/domain/types.js';
import { executeCommand } from '../../src/runtime/command.js';
import { createTaskWorkspace } from '../../src/execution/isolation.js';
import { verificationMutationError, VerificationMutationError } from '../../src/execution/verification-mutations.js';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('reports real isolated state mutation as verification debt and preserves a subsequent source mutation as unresolved',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'capivara-verification-mutation-'));roots.push(workspace);
  const product='export const value = 5;\n';await writeFile(join(workspace,'product.mjs'),product);await writeFile(join(workspace,'state.payload'),'original state');
  const area=await createTaskWorkspace(workspace,'consumer','definition',['product.mjs']);
  const check:Verification={id:'consumer',kind:'cli',command:process.execPath,args:['-e',"require('node:fs').writeFileSync('state.payload','observed new state');console.log('real behavior')"],inputs:['product.mjs','state.payload'],requirementIds:[],requiredCapabilities:[]};
  const command=await executeCommand({cwd:area.directory,command:[check.command!,...check.args!]});expect(command.exitCode).toBe(0);
  const inspect=()=>verificationMutationError({workspace,verificationWorkspace:area.directory,check,inputs:check.inputs!,expectedInputHash:'original observation identity',currentInputHash:'current proposal identity'});
  const state=await inspect();
  expect(state).toBeInstanceOf(VerificationMutationError);expect(state.kind).toBe('instrument');expect(state.repairScope).toBe('verification');
  expect(state.changes).toEqual([expect.objectContaining({path:'state.payload',change:'modified',declaredOutput:false})]);
  expect(state.changes[0]!.proposalHash).not.toBe(state.changes[0]!.verificationHash);
  expect(await readFile(join(workspace,'state.payload'),'utf8')).toBe('original state');
  const source=await executeCommand({cwd:area.directory,command:[process.execPath,'-e',"require('node:fs').writeFileSync('product.mjs','export const value = 8;\\n')"]});expect(source.exitCode).toBe(0);
  const changed=await inspect();
  expect(changed.changes.map(item=>item.path)).toEqual(['product.mjs','state.payload']);
  expect(changed.changes.every(item=>!item.declaredOutput)).toBe(true);
  expect(await readFile(join(workspace,'product.mjs'),'utf8')).toBe(product);
  expect(check.inputs).toEqual(['product.mjs','state.payload']);expect(check.outputs).toBeUndefined();
});
