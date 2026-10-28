import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Verification } from '../domain/types.js';
import type { OperationalEnvironment } from '../execution/environment.js';
import { sourceFiles } from '../execution/files.js';
import { executeCommand } from './command.js';

export interface ProviderWitness {
  source: 'node-load-hook';
  execPath: string;
  argv: string[];
  execArgv: string[];
  pid: number;
  observedAt: string;
  /** Hashes have the same content/mode representation as inputSnapshot. Only loaded claimed files appear. */
  inputs: Record<string,string>;
  entryPoint?: string;
}
export interface NativeNodeResolution {
  execPath:string;
  nativeFingerprint:string;
  launcher:{path:string;fingerprint:string;shebang?:string;interpreter:string[]};
}
export interface RuntimeProviderReceipt extends NativeNodeResolution {
  capability:string;
  kind:'runtime';
  provider:string;
  bindingCommand:string[];
  fingerprint?:string;
  observedAt:string;
}
export interface ProviderObservation {
  runtimeProvider?:RuntimeProviderReceipt;
  enabled: boolean;
  environment: Record<string,string>;
  reason?: string;
  diagnostics: string[];
  finish(): Promise<ProviderWitness[]>;
  cleanup(): Promise<void>;
}
const executableFingerprints=new Map<string,{stamp:string;fingerprint:string}>();
async function fileFingerprint(path:string):Promise<string>{
  const info=await stat(path),stamp=`${info.dev}:${info.ino}:${info.size}:${info.mode}:${info.mtimeMs}:${info.ctimeMs}`;
  const previous=executableFingerprints.get(path);if(previous?.stamp===stamp)return previous.fingerprint;
  const file=await open(path,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);
  try{for(;;){const read=await file.read(buffer,0,buffer.length,null);if(!read.bytesRead)break;hash.update(buffer.subarray(0,read.bytesRead));}}finally{await file.close();}
  const fingerprint=createHash('sha256').update(JSON.stringify({mode:info.mode&0o777,content:hash.digest('hex')})).digest('hex');
  executableFingerprints.set(path,{stamp,fingerprint});return fingerprint;
}
async function executable(command:string,cwd:string,environment:Record<string,string>):Promise<string|undefined>{
  const names=process.platform==='win32'&&!/\.[a-z]+$/i.test(command)?[command,...(environment.PATHEXT??process.env.PATHEXT??'.EXE;.CMD;.BAT').split(';').map(value=>command+value.toLowerCase())]:[command];
  const locations=isAbsolute(command)||command.includes('/')||command.includes('\\')?[resolve(cwd,command)]:(environment.PATH??process.env.PATH??'').split(delimiter).flatMap(folder=>names.map(name=>resolve(cwd,folder||'.',name)));
  for(const candidate of locations){try{if(!(await stat(candidate)).isFile())continue;await access(candidate,process.platform==='win32'?0:1);return await realpath(candidate);}catch{}}
  return undefined;
}
function shebangArguments(value:string):string[]|undefined{
  const result:string[]=[];let token='',quote='',escaped=false,started=false;
  for(const character of value){
    if(escaped){token+=character;escaped=false;started=true;continue;}
    if(character==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(character===quote)quote='';else token+=character;started=true;continue;}
    if(character==='"'||character==="'"){quote=character;started=true;continue;}
    if(/\s/.test(character)){if(started){result.push(token);token='';started=false;}continue;}
    token+=character;started=true;
  }
  if(quote||escaped)return undefined;if(started)result.push(token);return result;
}
/** Resolve the executable protocol, not its provider display name. A launcher
 * script and its native interpreter remain distinct identities. */
export async function resolveNativeNode(cwd:string,bindingCommand:readonly string[],environment:Record<string,string>):Promise<NativeNodeResolution|undefined>{
  const command=bindingCommand[0];if(!command)return undefined;
  const launcher=await executable(command,cwd,environment);if(!launcher)return undefined;
  const file=await open(launcher,'r'),buffer=Buffer.alloc(4096);let header='';
  try{const read=await file.read(buffer,0,buffer.length,0);header=buffer.subarray(0,read.bytesRead).toString('utf8').split(/\r?\n/,1)[0]??'';}finally{await file.close();}
  let interpreter=[launcher],shebang:string|undefined;
  if(header.startsWith('#!')){
    shebang=header;const tokens=shebangArguments(header.slice(2).trim());if(!tokens?.length)return undefined;
    if(tokens[0]==='/usr/bin/env'||tokens[0]==='/bin/env'){
      const split=header.slice(2).trim().slice(tokens[0].length).trim().match(/^(?:-S\s+|--split-string(?:=|\s+))(.+)$/);
      const argumentsOfEnv=split?shebangArguments(split[1]!)??[]:tokens.slice(1);
      // Without -S the kernel passes one literal optional argument to env;
      // `env node --flag` is not the same launch protocol as `env -S node --flag`.
      if(!split&&argumentsOfEnv.length!==1)return undefined;
      // Environment mutation in an env shebang needs its own explicit adapter;
      // never guess an interpreter from a provider name or silently drop flags.
      if(!argumentsOfEnv[0]||argumentsOfEnv[0].startsWith('-')||argumentsOfEnv[0].includes('='))return undefined;
      const binary=await executable(argumentsOfEnv[0],cwd,environment);if(!binary)return undefined;interpreter=[binary,...argumentsOfEnv.slice(1)];
    }else{
      if(!isAbsolute(tokens[0]!))return undefined;
      const binary=await executable(tokens[0]!,cwd,environment);if(!binary)return undefined;const optional=header.slice(2).trim().slice(tokens[0]!.length).trim();interpreter=[binary,...(optional?[optional]:[])];
    }
  }
  const probe=await executeCommand({cwd,command:[...interpreter,'--input-type=module','-e','const m=await import("node:module");process.stdout.write("\\nCAPIVARA_NATIVE_RUNTIME="+JSON.stringify({runtime:process.release?.name,hooks:typeof m.registerHooks,execPath:process.execPath})+"\\n")'],environment:{...environment},timeoutMs:3000,inputs:[]});
  if(probe.exitCode!==0||probe.cancelled||probe.timedOut||probe.issue)return undefined;
  const line=probe.stdout.split('\n').findLast(line=>line.startsWith('CAPIVARA_NATIVE_RUNTIME='));
  let identity:{runtime?:unknown;hooks?:unknown;execPath?:unknown};try{identity=JSON.parse(line?.slice('CAPIVARA_NATIVE_RUNTIME='.length)??'null') as typeof identity;}catch{return undefined;}
  if(!identity||identity.runtime!=='node'||identity.hooks!=='function'||typeof identity.execPath!=='string')return undefined;
  const native=await realpath(identity.execPath).catch(()=>undefined);if(!native)return undefined;
  return{execPath:native,nativeFingerprint:await fileFingerprint(native),launcher:{path:launcher,fingerprint:await fileFingerprint(launcher),...(shebang?{shebang}:{}),interpreter}};
}
const preload=String.raw`'use strict';
(() => {
  const fs=require('node:fs'),path=require('node:path'),url=require('node:url'),crypto=require('node:crypto');
  const {registerHooks}=require('node:module');
  const config=__CAPIVARA_OBSERVATION_CONFIG__;
  const output=path.join(config.output,'process-'+process.pid+'-'+crypto.randomUUID()+'.jsonl');
  const append=value=>{try{fs.appendFileSync(output,JSON.stringify(value)+'\n',{mode:0o600});}catch{}};
  let entryPoint;
  if(process.argv[1]){try{entryPoint=fs.realpathSync(path.resolve(process.argv[1]));}catch{}}
  append({type:'process',source:'node-load-hook',execPath:process.execPath,argv:process.argv,execArgv:process.execArgv,pid:process.pid,observedAt:new Date().toISOString(),...(entryPoint?{entryPoint}:{} )});
  const observed=new Set();
  if(typeof registerHooks!=='function'){append({type:'instrument-error',message:'This Node runtime has no synchronous module load hooks.'});return;}
  registerHooks({load(specifier,context,nextLoad){
    const result=nextLoad(specifier,context);
    try{
      if(!specifier.startsWith('file:'))return result;
      const file=fs.realpathSync(url.fileURLToPath(specifier));
      const claimed=config.files[file];if(!claimed||observed.has(file))return result;
      const info=fs.statSync(file);if(!info.isFile())return result;
      const content=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const hash=crypto.createHash('sha256').update(JSON.stringify({mode:info.mode&0o777,content})).digest('hex');
      observed.add(file);append({type:'load',paths:claimed,hash});
    }catch(error){append({type:'instrument-error',message:String(error)});}
    return result;
  }});
})();
`;
function disabled(reason:string,environment:Record<string,string>={}):ProviderObservation{return{enabled:false,environment,reason,diagnostics:[],finish:async()=>[],cleanup:async()=>{}};}
/** Opt-in observation for a runtime conformance check. A descendant process only
 * qualifies after actually loading a claimed product file. Merely launching npm,
 * printing a runtime version, resolving an import or naming a source is no proof.
 * This is instrumentation for cooperative verification, not a security sandbox. */
export async function startProviderObservation(workspace:string,check:Verification,operational:OperationalEnvironment):Promise<ProviderObservation>{
  const claim=check.conformance;
  if(claim?.kind!=='runtime')return disabled('The check has no runtime conformance claim.');
  const binding=Object.values(operational.bindings).find(item=>item.ready&&item.capability===claim.capability&&item.kind===claim.kind&&item.provider===claim.provider);
  if(!binding?.command?.length)return disabled('The selected runtime has no concrete executable binding.');
  let native:NativeNodeResolution|undefined;
  try{native=await resolveNativeNode(resolve(workspace,check.cwd??'.'),binding.command,operational.env);}catch(error){return disabled(`The concrete runtime binding could not be inspected: ${error instanceof Error?error.message:String(error)}`);}
  if(!native)return disabled('The concrete provider or its exact shebang interpreter does not expose Node module-load observation.');
  const runtimeProvider:RuntimeProviderReceipt={...native,capability:binding.capability,kind:'runtime',provider:binding.provider,bindingCommand:[...binding.command],...(binding.fingerprint?{fingerprint:binding.fingerprint}:{}),observedAt:new Date().toISOString()};
  const files:Record<string,string[]>={};
  for(const file of await sourceFiles(workspace,claim.productInputs)){
    const absolute=await realpath(join(workspace,file));(files[absolute]??=[]).push(file);
  }
  if(!Object.keys(files).length)return disabled('No current claimed product files exist to observe.');
  const root=join(resolve(workspace),'.capivara-verification');
  const info=await lstat(root).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(info&&!info.isDirectory())throw new Error('Provider observation directory is not a private directory; refusing to follow a file or symbolic link.');
  await mkdir(root,{recursive:true});
  const directory=await mkdtemp(join(root,'provider-observation-'));
  const path=join(directory,'preload.cjs');
  await writeFile(path,preload.replace('__CAPIVARA_OBSERVATION_CONFIG__',JSON.stringify({output:directory,files})),{mode:0o600,flag:'wx'});
  const inherited=operational.env.NODE_OPTIONS??process.env.NODE_OPTIONS??'';
  const environment={NODE_OPTIONS:`${inherited}${inherited?' ':''}--require ${JSON.stringify(path)}`};
  const diagnostics:string[]=[];
  return{enabled:true,environment,diagnostics,runtimeProvider,finish:async()=>{
    const witnesses:ProviderWitness[]=[];
    for(const file of (await readdir(directory)).filter(name=>/^process-\d+-[a-f0-9-]+\.jsonl$/.test(name))){
      const entry=join(directory,file),info=await lstat(entry);if(!info.isFile()||info.size>8*1024*1024){diagnostics.push(`Invalid provider observation record: ${file}`);continue;}
      let witness:ProviderWitness|undefined;
      for(const line of (await readFile(entry,'utf8')).split('\n').filter(Boolean)){
        let record:Record<string,unknown>;try{record=JSON.parse(line) as Record<string,unknown>;}catch{diagnostics.push(`Incomplete provider observation record: ${file}`);continue;}
        if(record.type==='process'&&typeof record.execPath==='string'&&Array.isArray(record.argv)&&Array.isArray(record.execArgv)&&typeof record.pid==='number'&&typeof record.observedAt==='string'){
          witness={source:'node-load-hook',execPath:record.execPath,argv:record.argv.filter((value):value is string=>typeof value==='string'),execArgv:record.execArgv.filter((value):value is string=>typeof value==='string'),pid:record.pid,observedAt:record.observedAt,inputs:{},...(typeof record.entryPoint==='string'?{entryPoint:record.entryPoint}:{})};
        }else if(record.type==='load'&&witness&&Array.isArray(record.paths)&&typeof record.hash==='string'&&/^[a-f0-9]{64}$/.test(record.hash)){
          for(const input of record.paths)if(typeof input==='string'&&Object.values(files).some(paths=>paths.includes(input)))witness.inputs[input]=record.hash;
        }else if(record.type==='instrument-error'&&typeof record.message==='string')diagnostics.push(record.message);
      }
      if(witness&&Object.keys(witness.inputs).length)witnesses.push(witness);
    }
    return witnesses;
  },cleanup:async()=>{await rm(directory,{recursive:true,force:true});}};
}
