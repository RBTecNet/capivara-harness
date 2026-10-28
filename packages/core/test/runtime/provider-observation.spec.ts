import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startProviderObservation } from '../../src/runtime/provider-observation.js';
import { executeCommand } from '../../src/runtime/command.js';
import { emptyOperationalEnvironment, type OperationalEnvironment } from '../../src/execution/environment.js';
import { inputSnapshot } from '../../src/execution/files.js';
import type { Verification } from '../../src/domain/types.js';
const temporary:string[]=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function workspace():Promise<string>{const root=await mkdtemp(join(tmpdir(),'capivara provider observation '));temporary.push(root);return root;}
function operational(root:string):OperationalEnvironment{return{...emptyOperationalEnvironment(root),env:{NODE_OPTIONS:'--no-warnings'},bindings:{runtime:{capability:'product-runtime',kind:'runtime',provider:'selected-node',ready:true,command:[process.execPath],aliases:['node']}}};}
const check:Verification={id:'conformance',kind:'cli',command:'npm',args:['run','verify'],requirementIds:['r'],requiredCapabilities:[],conformance:{requirementId:'r',kind:'runtime',capability:'product-runtime',provider:'selected-node',productInputs:['src']}};
it('observes npm descendants loading current product files while preserving options and paths containing spaces',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','product.mjs'),'export const value=42;');await writeFile(join(root,'src','unused.mjs'),'export const value=0;');await writeFile(join(root,'verify.mjs'),'import {value} from "./src/product.mjs";if(value!==42)process.exit(7);console.log("verified")');await writeFile(join(root,'setup.mjs'),'export {};');
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{verify:`"${process.execPath}" --import ./setup.mjs ./verify.mjs`}}));
  const environment=operational(root),observation=await startProviderObservation(root,check,environment);expect(observation.enabled).toBe(true);expect(observation.environment.NODE_OPTIONS).toContain('--no-warnings');
  const result=await executeCommand({cwd:root,command:['npm','run','verify'],environment:{...environment.env,...observation.environment}});expect(result.exitCode).toBe(0);expect(result.stdout).toContain('verified');
  const witnesses=await observation.finish();expect(witnesses).toHaveLength(1);const witness=witnesses[0]!;
  expect(witness.execPath).toBe(process.execPath);expect(witness.argv[1]).toBe(join(root,'verify.mjs'));expect(witness.entryPoint).toBe(join(root,'verify.mjs'));
  expect(witness.inputs).toEqual({'src/product.mjs':(await inputSnapshot(root,['src/product.mjs']))['src/product.mjs']});expect(observation.diagnostics).toEqual([]);
  await observation.cleanup();expect(await readdir(join(root,'.capivara-verification'))).toEqual([]);
});
it('observes TypeScript product imports through a registered loader and ignores the verification instrument',async()=>{
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','product.ts'),'export const value: number=42;');await writeFile(join(root,'verify.ts'),'import {value} from "./src/product.ts";if(value!==42)process.exit(7);console.log("typed-verified")');
  await writeFile(join(root,'setup.mjs'),'import {register} from "node:module";register("./loader.mjs",import.meta.url);');await writeFile(join(root,'loader.mjs'),'export async function load(url,context,nextLoad){return nextLoad(url,context)}');
  const environment=operational(root),observation=await startProviderObservation(root,check,environment);
  const result=await executeCommand({cwd:root,command:[process.execPath,'--import','./setup.mjs','verify.ts'],environment:{...environment.env,...observation.environment}});expect(result.exitCode).toBe(0);expect(result.stdout).toContain('typed-verified');
  const witnesses=await observation.finish();expect(witnesses.length).toBeGreaterThan(0);
  const expected=(await inputSnapshot(root,['src/product.ts']))['src/product.ts'];expect(witnesses.some(witness=>witness.inputs['src/product.ts']===expected)).toBe(true);expect(witnesses.every(witness=>!('verify.ts' in witness.inputs))).toBe(true);
  await observation.cleanup();
});
it('does not treat npm startup, a runtime version, or resolution without loading as product usage',async()=>{
  for(const invocation of [['npm','run','verify'],[process.execPath,'--version'],[process.execPath,'--input-type=module','-e','import.meta.resolve("./src/product.mjs");console.log("ok")']]){
    const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src','product.mjs'),'export const value=42;');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{verify:'printf ok'}}));
    const environment=operational(root),observation=await startProviderObservation(root,check,environment);
    expect((await executeCommand({cwd:root,command:invocation,environment:{...environment.env,...observation.environment}})).exitCode).toBe(0);
    expect(await observation.finish()).toEqual([]);await observation.cleanup();
  }
});
it.skipIf(process.platform==='win32')('does not enable the Node adapter for a different actual runtime',async()=>{
  const root=await workspace(),environment=operational(root);environment.bindings.runtime!.command=['/bin/sh'];
  const observation=await startProviderObservation(root,check,environment);expect(observation.enabled).toBe(false);expect(await observation.finish()).toEqual([]);
});
