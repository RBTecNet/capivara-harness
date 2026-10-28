import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
export interface ProviderObservation {
  enabled: boolean;
  environment: Record<string,string>;
  reason?: string;
  diagnostics: string[];
  finish(): Promise<ProviderWitness[]>;
  cleanup(): Promise<void>;
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
  const binary=binding?.command?.[0];
  if(!binary)return disabled('The selected runtime has no concrete executable binding.');
  // Confirm the selected executable itself, without assuming a provider from its
  // display name. Other runtimes keep their existing invocation-based evidence.
  const probe=await executeCommand({cwd:workspace,command:[binary,'--input-type=module','-e','const m=await import("node:module");process.stdout.write(JSON.stringify({runtime:process.release?.name,hooks:typeof m.registerHooks,execPath:process.execPath}))'],environment:{...operational.env},timeoutMs:3000,inputs:[]});
  let identity:{runtime?:unknown;hooks?:unknown;execPath?:unknown};
  try{identity=JSON.parse(probe.stdout) as typeof identity;}catch{return disabled('The concrete provider does not expose Node module-load observation.');}
  if(probe.exitCode!==0||probe.cancelled||probe.timedOut||identity.runtime!=='node'||identity.hooks!=='function'||typeof identity.execPath!=='string')return disabled('The concrete provider does not expose Node module-load observation.');
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
  return{enabled:true,environment,diagnostics,finish:async()=>{
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
