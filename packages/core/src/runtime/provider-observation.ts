import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { ProviderModule, Verification } from '../domain/types.js';
import type { OperationalEnvironment } from '../execution/environment.js';
import { sourceFiles } from '../execution/files.js';
import { executeCommand } from './command.js';

/** Mechanical observation identity. These versions describe executable
 * instruments, independently from model prompts, inspection and user criteria. */
export const PROVIDER_OBSERVATION_PROTOCOL={runtime:'node-load-hook/2',modules:'provider-module-import/2',consumptions:'bounded-file-consumption/1',processes:'loaded-provider-entrypoint/1'} as const;

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
export interface ModuleProviderReceipt extends ProviderModule, NativeNodeResolution {
  capability:string;
  kind:'library'|'driver'|'sdk';
  provider:string;
  fingerprint?:string;
  observedAt:string;
}
export interface ModuleProviderWitness {
  source:'node-module-hook'|'python-audit-hook';
  protocol:ProviderModule['protocol'];
  execPath:string;
  argv:string[];
  execArgv:string[];
  pid:number;
  observedAt:string;
  inputs:Record<string,string>;
  modules:{specifier:string;origin:string;hash?:string;importedBy?:Record<string,string>;observation?:'load'|'cached-import'}[];
}
export interface ProviderConsumption {
  method:'file-read'|'module-load';
  protocol:ProviderModule['protocol'];
  execPath:string;
  nativeFingerprint:string;
  execArgv?:string[];
  pid:number;
  observedAt:string;
  path:string;
  hash:string;
}
export interface ProviderProcessWitness {
  protocol:ProviderModule['protocol'];execPath:string;nativeFingerprint:string;argv:string[];execArgv:string[];pid:number;observedAt:string;cwd?:string;
  entryPoint:{path:string;hash:string};
}
export interface ProviderObservation {
  runtimeProvider?:RuntimeProviderReceipt;
  moduleProviders?:ModuleProviderReceipt[];
  enabled: boolean;
  environment: Record<string,string>;
  reason?: string;
  diagnostics: string[];
  finish(): Promise<ProviderWitness[]>;
  finishModules?():Promise<ModuleProviderWitness[]>;
  finishConsumptions?():Promise<ProviderConsumption[]>;
  finishProcesses?():Promise<ProviderProcessWitness[]>;
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
/** Protocol is confirmed by the executable itself, never by its display name. */
export async function resolveModuleHost(cwd:string,module:ProviderModule,environment:Record<string,string>):Promise<NativeNodeResolution|undefined>{
  if(module.protocol==='node')return resolveNativeNode(cwd,module.runtimeCommand,environment);
  const launcher=module.runtimeCommand[0]&&await executable(module.runtimeCommand[0],cwd,environment);if(!launcher)return undefined;
  const probe=await executeCommand({cwd,command:[...module.runtimeCommand,'-c','import sys,json;print("CAPIVARA_MODULE_HOST="+json.dumps({"protocol":"python","execPath":sys.executable,"audit":hasattr(sys,"addaudithook"),"profile":hasattr(sys,"setprofile")}))'],environment,timeoutMs:3000,inputs:[]});
  if(probe.exitCode!==0||probe.issue||probe.cancelled||probe.timedOut)return undefined;
  let identity:{protocol?:unknown;execPath?:unknown;audit?:unknown;profile?:unknown};
  try{identity=JSON.parse(probe.stdout.split('\n').findLast(line=>line.startsWith('CAPIVARA_MODULE_HOST='))?.slice('CAPIVARA_MODULE_HOST='.length)??'null') as typeof identity;}catch{return undefined;}
  if(!identity||identity.protocol!=='python'||typeof identity.execPath!=='string'||identity.audit!==true||identity.profile!==true)return undefined;
  const native=await realpath(identity.execPath).catch(()=>undefined);if(!native)return undefined;
  return{execPath:native,nativeFingerprint:await fileFingerprint(native),launcher:{path:launcher,fingerprint:await fileFingerprint(launcher),interpreter:[native,...module.runtimeCommand.slice(1)]}};
}
/** A legacy readiness probe may declare one literal module. Multiple imports,
 * computed specifiers and shell recipes need an explicit modules declaration. */
export async function inferProviderModule(cwd:string,argv:readonly string[],environment:Record<string,string>):Promise<ProviderModule|undefined>{
  const index=argv.findIndex((value,index)=>index>0&&['-e','--eval','-c'].includes(value));
  if(index<1||index+2!==argv.length)return undefined;
  const code=argv[index+1]!,candidates:ProviderModule[]=[];
  const nodeImports=[...code.matchAll(/\b(?:require|import)\s*\(\s*(['"])([^'"\\\n]+)\1\s*\)|\bimport\s+(?:[^;'"\n]*?\s+from\s+)?(['"])([^'"\\\n]+)\3/g)].map(match=>match[2]??match[4]!);
  const nodeCalls=[...code.matchAll(/\b(?:require|import)\s*\(/g)].length;
  if(nodeImports.length===1&&nodeCalls<=1)candidates.push({protocol:'node',specifier:nodeImports[0]!,runtimeCommand:argv.slice(0,index)});
  const pythonImports:string[]=[];
  for(const match of code.matchAll(/(?:^|[;\n])\s*(?:from\s+([\w.]+)\s+import\s+[^;\n]+|import\s+([^;\n]+))/g)){
    if(match[1])pythonImports.push(match[1]);
    else for(const name of match[2]!.split(',')){const value=name.trim().match(/^([A-Za-z_]\w*(?:\.\w+)*)(?:\s+as\s+\w+)?$/)?.[1];if(!value)return undefined;pythonImports.push(value);}
  }
  if(pythonImports.length===1)candidates.push({protocol:'python',specifier:pythonImports[0]!,runtimeCommand:argv.slice(0,index)});
  if(candidates.length!==1)return undefined;
  const candidate=candidates[0]!;return await resolveModuleHost(cwd,candidate,environment)?candidate:undefined;
}
/** Literal syntax only. Comments and strings containing example imports do not
 * establish a source edge. Resolution and execution are separate observations. */
export function literalProviderImports(text:string):string[]{
  const imports:string[]=[];
  for(let index=0;index<text.length;){
    const character=text[index]!;
    if(character==='/'&&text[index+1]==='/'){index=text.indexOf('\n',index+2);if(index<0)break;continue;}
    if(character==='/'&&text[index+1]==='*'){const end=text.indexOf('*/',index+2);if(end<0)break;index=end+2;continue;}
    if(character==='"'||character==="'"||character==='`'){
      const quote=character;index++;while(index<text.length){const next=text[index++]!;if(next==='\\')index++;else if(next===quote)break;}continue;
    }
    if(/[A-Za-z_$]/.test(character)){
      const start=index;while(index<text.length&&/[\w$]/.test(text[index]!))index++;
      const word=text.slice(start,index);if(!['require','import','export'].includes(word)||text[start-1]==='.')continue;
      const source=text.slice(start),dynamic=source.match(/^(?:require|import)\s*\(\s*(['"])([^'"\\\n]+)\1\s*[,)]/);
      const declaration=word==='import'?source.match(/^import\s+(?:[^;'"\n]*?\s+from\s*)?(['"])([^'"\\\n]+)\1/):word==='export'?source.match(/^export\s+[^;'"\n]*?\s+from\s*(['"])([^'"\\\n]+)\1/):null;
      if(dynamic)imports.push(dynamic[2]!);else if(declaration)imports.push(declaration[2]!);
      continue;
    }
    index++;
  }
  return [...new Set(imports)];
}
export async function providerConsumptionCurrent(workspace:string,observedWorkspace:string,consumption:ProviderConsumption,expectedHash:string):Promise<boolean>{
  if(consumption.hash!==expectedHash)return false;
  if(consumption.protocol==='node'&&consumption.execArgv?.some(arg=>['--check','-c','--version','--help'].includes(arg)))return false;
  try{
    if(await fileFingerprint(consumption.execPath)!==consumption.nativeFingerprint)return false;
    return await fileFingerprint(resolve(workspace,consumption.path))===expectedHash;
  }catch{return false;}
}
export async function resolveProviderProgram(cwd:string,command:readonly string[],environment:Record<string,string>):Promise<{path:string;hash:string;arguments:string[]}|undefined>{
  let target=[...command];
  const name=(target[0]??'').replaceAll('\\','/').split('/').at(-1)?.replace(/\.(?:cmd|exe)$/i,'');
  if(['npx','pnpx','bunx'].includes(name??'')){target=target.slice(1);while(target[0]&&['--yes','-y','--no-install','--no','--'].includes(target[0]))target.shift();}
  else if(['npm','pnpm','yarn','bun'].includes(name??'')&&['exec','x'].includes(target[1]??'')){target=target.slice(2);while(target[0]&&['--yes','-y','--no-install','--no','--'].includes(target[0]))target.shift();}
  const direct=target[0]&&await executable(target[0],cwd,{...environment,PATH:[resolve(cwd,'node_modules/.bin'),environment.PATH??process.env.PATH??''].join(delimiter)});
  if(!direct)return undefined;
  // A native interpreter followed by a concrete script is one provider argv,
  // rather than two executable names. Confirm that interpretation operationally.
  if(target[1]&&!target[1].startsWith('-')){
    const script=resolve(cwd,target[1]);
    if((await stat(script).catch(()=>null))?.isFile()&&(await resolveModuleHost(cwd,{protocol:'node',specifier:'',runtimeCommand:[direct]},environment).catch(()=>undefined)||await resolveModuleHost(cwd,{protocol:'python',specifier:'',runtimeCommand:[direct]},environment).catch(()=>undefined)))return{path:await realpath(script),hash:await fileFingerprint(script),arguments:target.slice(2)};
  }
  return{path:direct,hash:await fileFingerprint(direct),arguments:target.slice(1)};
}
export async function providerProcessCurrent(workspace:string,observedWorkspace:string,witness:ProviderProcessWitness,program:{path:string;hash:string;arguments:string[]}):Promise<boolean>{
  if(witness.entryPoint.hash!==program.hash||witness.protocol==='node'&&witness.execArgv.some(arg=>['--check','-c','--version','--help'].includes(arg)))return false;
  try{
    const source=relative(observedWorkspace,witness.entryPoint.path),path=source==='..'||source.startsWith('../')||isAbsolute(source)?witness.entryPoint.path:resolve(workspace,source);
    if(await realpath(path)!==await realpath(program.path)||await fileFingerprint(path)!==program.hash||await fileFingerprint(witness.execPath)!==witness.nativeFingerprint)return false;
    const args=witness.argv.slice(2);return program.arguments.every((arg,index)=>arg===args[index]||arg.replaceAll(resolve(workspace),'$WORKSPACE')===args[index]?.replaceAll(resolve(observedWorkspace),'$WORKSPACE'));
  }catch{return false;}
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
const fileReadPreload=String.raw`
  const originalRead=fs.readFileSync.bind(fs),originalAsyncRead=fsp.readFile.bind(fsp),originalCallbackRead=fs.readFile.bind(fs),originalStream=fs.createReadStream.bind(fs);
  const selectedRead=input=>{try{const file=input instanceof URL?url.fileURLToPath(input):typeof input==='string'?input:null;return file?config.reads[path.resolve(file)]:undefined;}catch{return undefined;}};
  const recordedReads=new Set();
  const recordRead=(input,data,options)=>{
    const paths=selectedRead(input);if(!paths)return;
    try{
      const encoding=typeof options==='string'?options:options?.encoding;
      const bytes=Buffer.isBuffer(data)?data:typeof data==='string'?Buffer.from(data,encoding||'utf8'):null;
      if(!bytes)return;
      const info=fs.statSync(input);if(!info.isFile())return;
      const hash=crypto.createHash('sha256').update(JSON.stringify({mode:info.mode&0o777,content:crypto.createHash('sha256').update(bytes).digest('hex')})).digest('hex');
      const identity=JSON.stringify([paths,hash]);if(recordedReads.has(identity))return;recordedReads.add(identity);
      append({type:'read',method:'file-read',paths,hash,observedAt:new Date().toISOString()});
    }catch(error){append({type:'instrument-error',message:String(error)});}
  };
  fs.readFileSync=function(input,options){const data=originalRead(input,options);recordRead(input,data,options);return data;};
  fs.readFile=function(...args){const callback=args.pop(),input=args[0],options=args[1];if(typeof callback!=='function')return originalCallbackRead(...args,callback);return originalCallbackRead(...args,(error,data)=>{if(!error)recordRead(input,data,options);callback(error,data);});};
  fsp.readFile=async function(input,options){const data=await originalAsyncRead(input,options);recordRead(input,data,options);return data;};
  fs.createReadStream=function(input,options){const stream=originalStream(input,options);if(selectedRead(input)){const chunks=[],push=stream.push;stream.push=function(chunk,encoding){if(chunk!==null)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,encoding||options?.encoding||'utf8'));else recordRead(input,Buffer.concat(chunks),undefined);return Reflect.apply(push,this,arguments);};}return stream;};
  Module.syncBuiltinESMExports();
`;
const modulePreload=String.raw`'use strict';
(() => {
  const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),url=require('node:url'),crypto=require('node:crypto'),Module=require('node:module');
  const config=__CAPIVARA_OBSERVATION_CONFIG__;
  const output=path.join(config.output,'process-'+process.pid+'-'+crypto.randomUUID()+'.jsonl');
  const append=value=>{try{fs.appendFileSync(output,JSON.stringify(value)+'\n',{mode:0o600});}catch{}};
  const sourceRead=fs.readFileSync.bind(fs);
  const hash=file=>{const info=fs.statSync(file);return crypto.createHash('sha256').update(JSON.stringify({mode:info.mode&0o777,content:crypto.createHash('sha256').update(sourceRead(file)).digest('hex')})).digest('hex');};
  append({type:'process',source:'node-module-hook',protocol:'node',execPath:process.execPath,argv:process.argv,execArgv:process.execArgv,cwd:process.cwd(),pid:process.pid,observedAt:new Date().toISOString()});
  const observed=new Set(),resolved=new Map(),targets=new Set(config.modules),loadedURLs=new Set();
  let mainPath;try{if(process.argv[1])mainPath=fs.realpathSync(path.resolve(process.argv[1]));}catch{}
  const literalImports=__CAPIVARA_LITERAL_IMPORT_PARSER__;
  const importedBy=origin=>{
    const result={},seen=new Set(),pending=[origin];
    while(pending.length&&seen.size<128){
      const current=pending.pop();if(seen.has(current))continue;seen.add(current);
      for(const edge of resolved.get(current)||[]){
        if(!edge.parent||!edge.parent.startsWith('file:')||!loadedURLs.has(edge.parent))continue;
        try{
          const file=fs.realpathSync(url.fileURLToPath(edge.parent)),text=sourceRead(file,'utf8');
          const imported=literalImports(text).includes(edge.specifier);
          if(!imported)continue;
          const paths=config.files[file];if(paths)for(const path of paths)result[path]=hash(file);
          pending.push(edge.parent);
        }catch{}
      }
    }
    return result;
  };
  const moduleLoaded=(specifier,origin,parent,observation='load')=>{
    if(!targets.has(specifier))return;
    try{
      const builtin=origin.startsWith('node:')||Module.isBuiltin(origin);
      const file=builtin?origin:fs.realpathSync(origin.startsWith('file:')?url.fileURLToPath(origin):origin);
      const parents=importedBy(origin);
      if(parent){try{const actual=fs.realpathSync(parent);for(const path of config.files[actual]||[])parents[path]=hash(actual);}catch{}}
      append({type:'module',specifier,origin:builtin?'builtin:'+origin:file,...(!builtin?{hash:hash(file)}:{}),importedBy:parents,observation});
    }catch(error){append({type:'instrument-error',message:String(error)});}
  };
  if(typeof Module.registerHooks!=='function'){append({type:'instrument-error',message:'This Node runtime has no synchronous module load hooks.'});return;}
  Module.registerHooks({resolve(specifier,context,nextResolve){
    const result=nextResolve(specifier,context);
    if(targets.size){const edges=resolved.get(result.url)||[];edges.push({specifier,parent:context.parentURL});resolved.set(result.url,edges);}
    if(targets.has(specifier)&&context.parentURL?.startsWith('file:')&&loadedURLs.has(context.parentURL)){
      const builtin=Module.isBuiltin(result.url)&&process.moduleLoadList.includes('NativeModule '+result.url.replace(/^node:/,''));
      if(loadedURLs.has(result.url)||builtin){try{const parent=fs.realpathSync(url.fileURLToPath(context.parentURL));if(literalImports(sourceRead(parent,'utf8')).includes(specifier))moduleLoaded(specifier,result.url,parent,'cached-import');}catch{}}
    }
    return result;
  },load(specifier,context,nextLoad){
    const result=nextLoad(specifier,context);
    if(targets.size)loadedURLs.add(specifier);
    for(const edge of resolved.get(specifier)||[])moduleLoaded(edge.specifier,specifier);
    try{
      if(specifier.startsWith('file:')){
        const candidate=url.fileURLToPath(specifier);
        if(!config.files[candidate]&&!config.reads[candidate]&&candidate!==mainPath)return result;
        const file=fs.realpathSync(candidate),claimed=config.files[file];
        if(file===mainPath)append({type:'entrypoint',path:file,hash:hash(file)});
        if(claimed&&!observed.has(file)){observed.add(file);append({type:'load',paths:claimed,hash:hash(file)});}
        const reads=config.reads[file];if(reads)append({type:'read',method:'module-load',paths:reads,hash:hash(file),observedAt:new Date().toISOString()});
      }
    }catch(error){append({type:'instrument-error',message:String(error)});}
    return result;
  }});
  // A cached CommonJS builtin is still a real import when requested by the
  // product after instrumentation starts. Instrument imports above never count.
  const original=Module._load;
  if(targets.size)Module._load=function(specifier,parent,isMain){
    const result=Reflect.apply(original,this,arguments);
    if(targets.has(specifier)){try{moduleLoaded(specifier,Module._resolveFilename(specifier,parent,isMain),parent?.filename);}catch(error){append({type:'instrument-error',message:String(error)});}}
    return result;
  };
  __CAPIVARA_FILE_READ_OBSERVATION__
})();
`;
const pythonPreload=String.raw`import sys,os,json,hashlib,uuid,atexit,builtins,base64
_cv_config=json.loads(base64.b64decode(__CAPIVARA_OBSERVATION_CONFIG__))
_cv_targets=set(_cv_config['modules'])
_cv_imported=set()
_cv_inputs={}
_cv_seen={}
_cv_reads={}
_cv_importers={}
_cv_internal=0
_cv_entrypoint=None
_cv_main=os.path.realpath(sys.argv[0])
_cv_cwd=os.getcwd()
_cv_diagnostics=[]
_cv_now=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
def _cv_hash(file):
    global _cv_internal
    _cv_internal+=1
    try:
        with open(file,'rb') as stream: content=hashlib.sha256(stream.read()).hexdigest()
        value=json.dumps({'mode':os.stat(file).st_mode&0o777,'content':content},separators=(',',':'))
        return hashlib.sha256(value.encode()).hexdigest()
    finally: _cv_internal-=1
def _cv_profile(frame,event,arg):
    global _cv_entrypoint
    if _cv_internal: return
    if event=='c_return' and getattr(arg,'__name__','') in ('read','read1','readall','readline','readlines','readinto','readinto1'):
        name=getattr(getattr(arg,'__self__',None),'name',None)
        if isinstance(name,str):
            file=os.path.abspath(name)
            paths=_cv_config['reads'].get(file)
            if paths:
                try:
                    value=_cv_hash(file)
                    for path in paths: _cv_reads[path]={'method':'file-read','hash':value}
                except Exception as error: _cv_diagnostics.append(str(error))
    if event!='call': return
    name=frame.f_code.co_filename
    if name.startswith('<'): return
    if name not in _cv_seen: _cv_seen[name]=os.path.realpath(name)
    file=_cv_seen[name]
    if file==_cv_main and _cv_entrypoint is None:
        try: _cv_entrypoint={'path':file,'hash':_cv_hash(file)}
        except Exception as error: _cv_diagnostics.append(str(error))
    paths=_cv_config['files'].get(file)
    reads=_cv_config['reads'].get(file)
    if reads and reads[0] not in _cv_reads:
        try:
            value=_cv_hash(file)
            for path in reads: _cv_reads[path]={'method':'module-load','hash':value}
        except Exception as error: _cv_diagnostics.append(str(error))
    if paths and paths[0] not in _cv_inputs:
        try:
            value=_cv_hash(file)
            for path in paths: _cv_inputs[path]=value
        except Exception as error: _cv_diagnostics.append(str(error))
def _cv_importer(specifier):
    parents=_cv_importers.setdefault(specifier,{})
    frame=sys._getframe(1)
    while frame:
        name=frame.f_code.co_filename
        file=_cv_seen.get(name)
        if file is None and not name.startswith('<'): file=os.path.realpath(name)
        for path in _cv_config['files'].get(file,[]):
            try: parents[path]=_cv_hash(file)
            except Exception as error: _cv_diagnostics.append(str(error))
        frame=frame.f_back
def _cv_audit(event,args):
    if event=='import' and args and args[0] in _cv_targets:
        _cv_imported.add(args[0])
        _cv_importer(args[0])
_cv_original_import=builtins.__import__
def _cv_import(name,*args,**kwargs):
    result=_cv_original_import(name,*args,**kwargs)
    if name in _cv_targets and name in sys.modules:
        _cv_imported.add(name)
        _cv_importer(name)
    return result
def _cv_finish():
    try:
        modules=[]
        for specifier in _cv_imported:
            module=sys.modules.get(specifier)
            if module is None: continue
            origin=getattr(getattr(module,'__spec__',None),'origin',None)
            if origin in ('built-in','frozen'):
                modules.append({'specifier':specifier,'origin':'builtin:'+origin,'importedBy':_cv_importers.get(specifier,{})})
            elif isinstance(origin,str) and os.path.isfile(origin):
                file=os.path.realpath(origin)
                modules.append({'specifier':specifier,'origin':file,'hash':_cv_hash(file),'importedBy':_cv_importers.get(specifier,{})})
        record={'type':'witness','source':'python-audit-hook','protocol':'python','execPath':os.path.realpath(sys.executable),'argv':getattr(sys,'orig_argv',sys.argv),'execArgv':[],'cwd':_cv_cwd,'pid':os.getpid(),'observedAt':_cv_now,'inputs':_cv_inputs,'modules':modules,'reads':_cv_reads,'entryPoint':_cv_entrypoint,'diagnostics':_cv_diagnostics}
        path=os.path.join(_cv_config['output'],'process-'+str(os.getpid())+'-'+str(uuid.uuid4())+'.jsonl')
        descriptor=os.open(path,os.O_CREAT|os.O_WRONLY|os.O_EXCL,0o600)
        with os.fdopen(descriptor,'w') as stream: stream.write(json.dumps(record)+'\n')
    except Exception: pass
sys.addaudithook(_cv_audit)
builtins.__import__=_cv_import
sys.setprofile(_cv_profile)
atexit.register(_cv_finish)
`;

async function startModuleObservation(workspace:string,check:Verification,operational:OperationalEnvironment):Promise<ProviderObservation>{
  const claim=check.conformance!;
  const binding=Object.values(operational.bindings).find(item=>item.ready&&item.capability===claim.capability&&item.kind===claim.kind&&item.provider===claim.provider);
  if(!binding?.modules?.length||!['library','driver','sdk'].includes(binding.kind))return disabled('The selected library, driver or SDK has no declared module load protocol.');
  const receipts:ModuleProviderReceipt[]=[];
  for(const module of binding.modules){
    const host=await resolveModuleHost(resolve(workspace,check.cwd??'.'),module,operational.env).catch(()=>undefined);
    if(!host)return disabled(`The declared ${module.protocol} module host could not be confirmed for ${module.specifier}.`);
    receipts.push({...module,...host,capability:binding.capability,kind:binding.kind as 'library'|'driver'|'sdk',provider:binding.provider,...(binding.fingerprint?{fingerprint:binding.fingerprint}:{}),observedAt:new Date().toISOString()});
  }
  return observeProcesses(workspace,check,operational,receipts);
}
async function observeProcesses(workspace:string,check:Verification,operational:OperationalEnvironment,receipts:ModuleProviderReceipt[]=[]):Promise<ProviderObservation>{
  const claim=check.conformance;
  const files:Record<string,string[]>={};
  for(const file of await sourceFiles(workspace,claim?.productInputs??[])){const absolute=await realpath(join(workspace,file));(files[absolute]??=[]).push(file);}
  const reads:Record<string,string[]>={};
  const selected=claim&&Object.values(operational.bindings).find(item=>item.ready&&item.capability===claim.capability&&item.kind===claim.kind&&item.provider===claim.provider);
  const providerPrograms:string[]=[];
  for(const argument of selected?.command??[]){
    if(argument.startsWith('-'))continue;
    const absolute=resolve(workspace,argument),path=relative(resolve(workspace),absolute).replaceAll('\\','/');
    if(path==='..'||path.startsWith('../')||isAbsolute(path))continue;
    if((await stat(absolute).catch(()=>null))?.isFile())providerPrograms.push(path);
  }
  for(const file of await sourceFiles(workspace,[...(check.inputs??[]),...(claim?.productInputs??[]),...(claim?.providerInputs??[]),...(selected?.inputs??[]),...providerPrograms])){
    const lexical=resolve(workspace,file),absolute=await realpath(lexical);
    for(const path of new Set([lexical,absolute]))(reads[path]??=[]).push(file);
  }
  if(!Object.keys(files).length&&!Object.keys(reads).length)return disabled('No current relevant input files exist to observe.');
  const root=join(resolve(workspace),'.capivara-verification'),info=await lstat(root).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(info&&!info.isDirectory())throw new Error('Provider observation directory is not a private directory.');
  await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'module-observation-'));
  const environment:Record<string,string>={},diagnostics:string[]=[];
  const node=receipts.filter(item=>item.protocol==='node'),python=receipts.filter(item=>item.protocol==='python');
  if(node.length||!receipts.length){
    const path=join(directory,'preload.cjs');await writeFile(path,modulePreload.replace('__CAPIVARA_OBSERVATION_CONFIG__',JSON.stringify({output:directory,files,reads,modules:node.map(item=>item.specifier)})).replace('__CAPIVARA_LITERAL_IMPORT_PARSER__',`(${literalProviderImports.toString()})`).replace('__CAPIVARA_FILE_READ_OBSERVATION__',fileReadPreload),{mode:0o600,flag:'wx'});
    const inherited=operational.env.NODE_OPTIONS??process.env.NODE_OPTIONS??'';environment.NODE_OPTIONS=`${inherited}${inherited?' ':''}--require ${JSON.stringify(path)}`;
  }
  if(python.length||!receipts.length){
    await writeFile(join(directory,'sitecustomize.py'),pythonPreload.replace('__CAPIVARA_OBSERVATION_CONFIG__',JSON.stringify(Buffer.from(JSON.stringify({output:directory,files,reads,modules:python.map(item=>item.specifier)})).toString('base64'))),{mode:0o600,flag:'wx'});
    const inherited=operational.env.PYTHONPATH??process.env.PYTHONPATH??'';environment.PYTHONPATH=`${directory}${inherited?delimiter+inherited:''}`;
    environment.PYTHONDONTWRITEBYTECODE='1';
  }
  return{enabled:true,environment,diagnostics,moduleProviders:receipts,finish:async()=>[],finishModules:async()=>{
    const witnesses:ModuleProviderWitness[]=[];
    for(const name of (await readdir(directory)).filter(name=>/^process-\d+-[a-f0-9-]+\.jsonl$/.test(name))){
      const path=join(directory,name),info=await lstat(path);if(!info.isFile()||info.size>8*1024*1024){diagnostics.push(`Invalid module observation record: ${name}`);continue;}
      let witness:ModuleProviderWitness|undefined;
      for(const line of (await readFile(path,'utf8')).split('\n').filter(Boolean)){
        let value:Record<string,unknown>;try{value=JSON.parse(line) as Record<string,unknown>;}catch{diagnostics.push(`Incomplete module observation record: ${name}`);continue;}
        if((value.type==='process'||value.type==='witness')&&(value.source==='node-module-hook'||value.source==='python-audit-hook')&&(value.protocol==='node'||value.protocol==='python')&&typeof value.execPath==='string'&&typeof value.pid==='number'&&typeof value.observedAt==='string'&&Array.isArray(value.argv)&&Array.isArray(value.execArgv)){
          witness={source:value.source,protocol:value.protocol,execPath:value.execPath,argv:value.argv.filter((item):item is string=>typeof item==='string'),execArgv:value.execArgv.filter((item):item is string=>typeof item==='string'),pid:value.pid,observedAt:value.observedAt,inputs:{},modules:[]};
          if(value.type==='witness'){
            for(const [path,hash] of Object.entries(value.inputs as Record<string,unknown>??{}))if(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&Object.values(files).some(paths=>paths.includes(path)))witness.inputs[path]=hash;
            for(const entry of Array.isArray(value.modules)?value.modules:[])if(entry&&typeof entry==='object'&&typeof entry.specifier==='string'&&typeof entry.origin==='string'&&receipts.some(item=>item.protocol===witness!.protocol&&item.specifier===entry.specifier)&&(!entry.hash||typeof entry.hash==='string'&&/^[a-f0-9]{64}$/.test(entry.hash)))witness.modules.push(entry);
            if(Array.isArray(value.diagnostics))diagnostics.push(...value.diagnostics.filter((item):item is string=>typeof item==='string'));
          }
        }else if(value.type==='load'&&witness&&Array.isArray(value.paths)&&typeof value.hash==='string'&&/^[a-f0-9]{64}$/.test(value.hash)){
          for(const path of value.paths)if(typeof path==='string'&&Object.values(files).some(paths=>paths.includes(path)))witness.inputs[path]=value.hash;
        }else if(value.type==='module'&&witness&&typeof value.specifier==='string'&&typeof value.origin==='string'&&receipts.some(item=>item.protocol===witness!.protocol&&item.specifier===value.specifier)&&(!value.hash||typeof value.hash==='string'&&/^[a-f0-9]{64}$/.test(value.hash))){
          witness.modules.push({specifier:value.specifier,origin:value.origin,...(typeof value.hash==='string'?{hash:value.hash}:{}),...(value.importedBy&&typeof value.importedBy==='object'?{importedBy:value.importedBy as Record<string,string>}:{}),...(value.observation==='load'||value.observation==='cached-import'?{observation:value.observation}:{})});
        }else if(value.type==='instrument-error'&&typeof value.message==='string')diagnostics.push(value.message);
      }
      if(witness&&Object.keys(witness.inputs).length&&witness.modules.length)witnesses.push(witness);
    }
    return witnesses;
  },finishConsumptions:async()=>{
    const result:ProviderConsumption[]=[];
    for(const name of (await readdir(directory)).filter(name=>/^process-\d+-[a-f0-9-]+\.jsonl$/.test(name))){
      const path=join(directory,name),info=await lstat(path);if(!info.isFile()||info.size>8*1024*1024)continue;
      let processRecord:{protocol:'node'|'python';execPath:string;nativeFingerprint:string;execArgv?:string[];pid:number;observedAt:string}|undefined;
      const add=(paths:unknown,hash:unknown,method:unknown,observedAt:unknown):void=>{
        if(!processRecord||!Array.isArray(paths)||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||(method!=='file-read'&&method!=='module-load'))return;
        for(const input of paths)if(typeof input==='string'&&Object.values(reads).some(items=>items.includes(input)))result.push({...processRecord,method,path:input,hash,...(typeof observedAt==='string'?{observedAt}:{})});
      };
      for(const line of (await readFile(path,'utf8')).split('\n').filter(Boolean)){
        let value:Record<string,unknown>;try{value=JSON.parse(line) as Record<string,unknown>;}catch{continue;}
        if((value.type==='process'||value.type==='witness')&&(value.protocol==='node'||value.protocol==='python')&&typeof value.execPath==='string'&&typeof value.pid==='number'&&typeof value.observedAt==='string'){
          try{const execPath=await realpath(value.execPath);processRecord={protocol:value.protocol,execPath,nativeFingerprint:await fileFingerprint(execPath),pid:value.pid,observedAt:value.observedAt,...(Array.isArray(value.execArgv)?{execArgv:value.execArgv.filter((arg):arg is string=>typeof arg==='string')}:{})};}catch{continue;}
          if(value.type==='witness'&&value.reads&&typeof value.reads==='object')for(const [input,read] of Object.entries(value.reads)){if(read&&typeof read==='object'&&'hash' in read&&'method' in read)add([input],read.hash,read.method,value.observedAt);}
        }else if(value.type==='read')add(value.paths,value.hash,value.method,value.observedAt);
      }
    }
    return result;
  },finishProcesses:async()=>{
    const result:ProviderProcessWitness[]=[];
    for(const name of (await readdir(directory)).filter(name=>/^process-\d+-[a-f0-9-]+\.jsonl$/.test(name))){
      const path=join(directory,name),info=await lstat(path);if(!info.isFile()||info.size>8*1024*1024)continue;
      let processRecord:Omit<ProviderProcessWitness,'entryPoint'>|undefined;
      for(const line of (await readFile(path,'utf8')).split('\n').filter(Boolean)){
        let value:Record<string,unknown>;try{value=JSON.parse(line) as Record<string,unknown>;}catch{continue;}
        if((value.type==='process'||value.type==='witness')&&(value.protocol==='node'||value.protocol==='python')&&typeof value.execPath==='string'&&typeof value.pid==='number'&&typeof value.observedAt==='string'&&Array.isArray(value.argv)&&Array.isArray(value.execArgv)){
          try{const execPath=await realpath(value.execPath);processRecord={protocol:value.protocol,execPath,nativeFingerprint:await fileFingerprint(execPath),pid:value.pid,observedAt:value.observedAt,argv:value.argv.filter((item):item is string=>typeof item==='string'),execArgv:value.execArgv.filter((item):item is string=>typeof item==='string'),...(typeof value.cwd==='string'?{cwd:value.cwd}:{})};}catch{continue;}
          const entry=value.entryPoint;if(entry&&typeof entry==='object'&&'path' in entry&&typeof entry.path==='string'&&'hash' in entry&&typeof entry.hash==='string')result.push({...processRecord,entryPoint:{path:entry.path,hash:entry.hash}});
        }else if(value.type==='entrypoint'&&processRecord&&typeof value.path==='string'&&typeof value.hash==='string')result.push({...processRecord,entryPoint:{path:value.path,hash:value.hash}});
      }
    }
    return result;
  },cleanup:async()=>{await rm(directory,{recursive:true,force:true});}};
}
function disabled(reason:string,environment:Record<string,string>={}):ProviderObservation{return{enabled:false,environment,reason,diagnostics:[],finish:async()=>[],cleanup:async()=>{}};}
/** Opt-in observation for a runtime conformance check. A descendant process only
 * qualifies after actually loading a claimed product file. Merely launching npm,
 * printing a runtime version, resolving an import or naming a source is no proof.
 * This is instrumentation for cooperative verification, not a security sandbox. */
async function startRuntimeObservation(workspace:string,check:Verification,operational:OperationalEnvironment):Promise<ProviderObservation>{
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
export async function startProviderObservation(workspace:string,check:Verification,operational:OperationalEnvironment):Promise<ProviderObservation>{
  let specific:ProviderObservation;
  try{
    specific=check.conformance&&['library','driver','sdk'].includes(check.conformance.kind)?await startModuleObservation(workspace,check,operational):await startRuntimeObservation(workspace,check,operational);
    if(specific.finishConsumptions)return specific;
    const reads=await observeProcesses(workspace,check,{...operational,env:{...operational.env,...specific.environment}});
    if(!reads.enabled)return specific;
    return{enabled:true,environment:{...specific.environment,...reads.environment},diagnostics:specific.diagnostics,...(specific.reason?{reason:specific.reason}:{}),...(specific.runtimeProvider?{runtimeProvider:specific.runtimeProvider}:{}),finish:()=>specific.finish(),finishModules:()=>reads.finishModules?.()??Promise.resolve([]),finishConsumptions:()=>reads.finishConsumptions?.()??Promise.resolve([]),finishProcesses:()=>reads.finishProcesses?.()??Promise.resolve([]),cleanup:async()=>{try{await specific.cleanup();}finally{await reads.cleanup();}specific.diagnostics.push(...reads.diagnostics);}};
  }catch(error){return disabled(`Provider observation could not be prepared: ${error instanceof Error?error.message:String(error)}`);}
}
