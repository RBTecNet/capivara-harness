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
it.skipIf(process.platform==='win32')('resolves the native Node interpreter of a real npm consumer binding without aliasing npm to Node',async()=>{
  const {prepareEnvironmentNode}=await import('../../src/execution/environment.js');
  const root=await workspace();await mkdir(join(root,'src'));await writeFile(join(root,'src/product.mjs'),'export const answer=42;');await writeFile(join(root,'verify.mjs'),'import {answer} from "./src/product.mjs";if(answer!==42)process.exit(7);console.log("verified")');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{verify:`"${process.execPath}" verify.mjs`}}));
  const brief={schema:'capivara/product/1' as const,status:'ready' as const,id:'b',revision:1,name:'Fixture',summary:'Fixture',request:'Verify the actual runtime.',modes:['cli' as const],targets:['portable' as const],requirements:[],constraints:[],decisions:[],gaps:[]};
  const prepared=await prepareEnvironmentNode(root,{id:'runtime',name:'Selected launcher',kind:'runtime',identity:{capability:'product-runtime',kind:'runtime',provider:'selected-node'},dependsOn:[],targets:['portable'],reason:'Consumer launcher',check:{command:'npm',args:['--version']},prepare:[],provides:{command:['npm'],aliases:['npm']}},brief,executeCommand);expect(prepared.ready).toBe(true);
  const binding=prepared.operational.bindings['product-runtime']!,observation=await startProviderObservation(root,check,prepared.operational);expect(observation.enabled,observation.reason).toBe(true);
  expect(observation.runtimeProvider?.bindingCommand).toEqual(binding.command);expect(observation.runtimeProvider?.fingerprint).toBe(binding.fingerprint);expect(observation.runtimeProvider?.launcher.shebang).toBe('#!/usr/bin/env node');expect(observation.runtimeProvider?.execPath).toBe(process.execPath);expect(binding.aliases).toEqual(['npm']);
  const result=await executeCommand({cwd:root,command:[...binding.command!,'run','verify'],environment:{...prepared.operational.env,...observation.environment}});expect(result.exitCode).toBe(0);const witnesses=await observation.finish();expect(witnesses.some(witness=>witness.execPath===observation.runtimeProvider!.execPath&&witness.inputs['src/product.mjs'])).toBe(true);await observation.cleanup();
});
it.skipIf(process.platform==='win32')('resolves env shebang interpreters from the actual request PATH rather than assuming the harness runtime',async()=>{
  const {chmod,realpath}=await import('node:fs/promises');const {delimiter}=await import('node:path');
  const root=await workspace(),environment=operational(root);const {resolveNativeNode}=await import('../../src/runtime/provider-observation.js');
  const real=await resolveNativeNode(root,['npm'],environment.env);expect(real).toBeDefined();
  const bin=join(root,'different-runtime');await mkdir(bin);await writeFile(join(bin,'node'),'#!/bin/sh\nexit 7\n');await chmod(join(bin,'node'),0o755);
  environment.bindings.runtime!.command=[real!.launcher.path];environment.bindings.runtime!.aliases=['npm'];environment.env.PATH=`${bin}${delimiter}${process.env.PATH??''}`;
  const observation=await startProviderObservation(root,check,environment);expect(observation.enabled).toBe(false);expect(await observation.finish()).toEqual([]);expect(await realpath(real!.execPath)).toBe(process.execPath);
});
it.skipIf(process.platform!=='linux')('preserves real env split-string flags and refuses an invalid non-split shebang',async()=>{
  const {chmod}=await import('node:fs/promises');const {resolveNativeNode}=await import('../../src/runtime/provider-observation.js');const root=await workspace();
  const valid=join(root,'launcher.cjs'),invalid=join(root,'invalid.cjs');await writeFile(valid,'#!/usr/bin/env -S node --no-warnings\nprocess.stdout.write(process.execPath);');await chmod(valid,0o755);await writeFile(invalid,'#!/usr/bin/env node --no-warnings\nprocess.stdout.write(process.execPath);');await chmod(invalid,0o755);
  const actual=await executeCommand({cwd:root,command:[valid]});expect(actual.exitCode).toBe(0);const native=await resolveNativeNode(root,[valid],{});expect(native?.execPath).toBe(actual.stdout);expect(native?.launcher.interpreter.slice(1)).toEqual(['--no-warnings']);expect(await resolveNativeNode(root,[invalid],{})).toBeUndefined();expect((await executeCommand({cwd:root,command:[invalid]})).exitCode).not.toBe(0);
});
