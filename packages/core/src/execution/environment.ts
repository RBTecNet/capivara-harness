import { readFile, stat, readdir, access } from 'node:fs/promises';
import { join, resolve, relative, sep, delimiter, dirname, basename, isAbsolute, extname, matchesGlob } from 'node:path';
import type { CommandRecipe, EnvironmentNode, ProductBrief, ProviderModule, Verification } from '../domain/types.js';
import { allowedCapabilities, inferredCapabilities } from '../domain/authority.js';
import type { CommandRequest, CommandResult, ExecutionConstraints, TerminalRequest } from '../runtime/types.js';
import { runTerminal as realTerminal } from '../runtime/terminal.js';
import type { BuildIncident } from './types.js';
import { dependencyFamilies, DEPENDENCY_MANIFESTS } from './dependencies.js';
import { digest, inputHash, sourceFiles } from './files.js';
import { emitProgress, type ProgressEvent } from '../telemetry/progress.js';
import { inferProviderModule, resolveModuleHost } from '../runtime/provider-observation.js';

export type CommandExecutor = (request: CommandRequest) => Promise<CommandResult>;
export type CapabilityKind = 'cli' | 'library' | 'driver' | 'service' | 'runtime' | 'sdk';
export interface CapabilityInvocation {
  /** One executable and its fixed arguments. Never a list of executable names. */
  command: string[];
  /** Names that explicitly stand for the entire invocation. */
  aliases?: string[];
  /** Original argv prefix; replacing it must not duplicate its fixed arguments. */
  match?: string[];
}
export class OperationalInvocationConflict extends Error {
  readonly kind='instrument';
  constructor(readonly alias:string,readonly invocations:string[][]){super(`Operational alias ${alias} resolves to different provider invocations: ${JSON.stringify(invocations)}. Reconcile the selected capability bindings before invoking its consumer.`);}
}
export interface CapabilityBinding {
  capability: string;
  kind: CapabilityKind;
  provider: string;
  ready?: boolean;
  fingerprint?: string;
  dependencyFamily?: string;
  /** Shared providers keep their operational identity outside private task copies. */
  relocation?: 'workspace' | 'fixed';
  binaryFingerprint?: string;
  derivedFrom?: { kind:'virtual-environment'; binaryFingerprint:string; fingerprint:string; baseFingerprint?:string; baseCapability?:string; baseProvider?:string };
  command?: string[];
  aliases?: string[];
  match?: string[];
  invocations?: CapabilityInvocation[];
  invocationResolution?: { declaration: string; invocations: { command: string[]; aliases?: string[] }[] };
  candidateInvocations?: CapabilityInvocation[];
  transformations?: { kind: string; original: unknown; selected: unknown; reason: string }[];
  env?: Record<string, string>;
  paths?: string[];
  inputs?: string[];
  modules?: ProviderModule[];
}
export interface OperationalEnvironment {
  root?: string;
  env: Record<string, string>;
  bindings: Record<string, CapabilityBinding>;
  revision: string;
}
export interface PreparedEnvironment {
  ready: boolean;
  fingerprint: string;
  operational: OperationalEnvironment;
  failure?: string;
  noProgress?: boolean;
}
export interface PreparationResult { ready: boolean; results: CommandResult[]; incidents: BuildIncident[]; operational: OperationalEnvironment; fingerprint: string; cache: PreparedEnvironment; }
export interface PreparationOptions { allowSystemInstall?: boolean; signal?: AbortSignal; terminal?: (request: TerminalRequest) => Promise<CommandResult>; onEvent?: (event: ProgressEvent) => void; operational?: OperationalEnvironment; previous?: PreparedEnvironment; revalidate?: boolean; inputs?: readonly string[]; checks?: readonly Verification[]; }
/** Capability identity is exact. A driver never satisfies a CLI merely by sharing a name. */
export function capabilitySatisfied(binding: CapabilityBinding | undefined, requirement: { capability: string; kind: CapabilityKind }): boolean {
  return Boolean(binding?.ready && binding.capability === requirement.capability && binding.kind === requirement.kind);
}
function portable(value: unknown, root: string): unknown {
  if (typeof value === 'string') return root ? value.replaceAll(resolve(root), '$WORKSPACE') : value;
  if (Array.isArray(value)) return value.map(item => portable(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item]) => [key,portable(item,root)]));
  return value;
}
function fixedScopes(bindings:Record<string,CapabilityBinding>):string[]{
  return [...new Set(Object.values(bindings).filter(binding=>binding.relocation==='fixed').flatMap(binding=>[
    ...(binding.paths??[]),...(binding.command??[]),...(binding.invocations??[]).flatMap(invocation=>invocation.command),...(binding.modules??[]).flatMap(module=>module.runtimeCommand),...(binding.env?.PATH?.split(delimiter)??[]),
  ]).filter(path=>isAbsolute(path)).map(path=>resolve(path)))];
}
function protectedRootReplace(value:string,from:string,to:string,scopes:readonly string[]):string{
  const root=resolve(from);
  return value.replaceAll(root,(_match,index:number)=>{
    const tail=value.slice(index);
    const fixed=scopes.some(scope=>tail===scope||tail.startsWith(`${scope}${sep}`)||tail.startsWith(`${scope}/`)||tail.startsWith(`${scope}\\`)||tail.startsWith(`${scope}${delimiter}`)||tail.startsWith(`${scope} `)||tail.startsWith(`${scope}'`)||tail.startsWith(`${scope}"`));
    return fixed?root:to;
  });
}
function portableProviderValue(value:unknown,root:string,scopes:readonly string[]):unknown{
  if(typeof value==='string')return root?protectedRootReplace(value,root,'$WORKSPACE',scopes):value;
  if(Array.isArray(value))return value.map(item=>portableProviderValue(item,root,scopes));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,portableProviderValue(item,root,scopes)]));
  return value;
}
function operationalIdentity(root:string,env:Record<string,string>,bindings:Record<string,CapabilityBinding>):unknown{
  if(Object.values(bindings).some(binding=>binding.transformations?.some(item=>item.kind==='product-probe-separated-from-availability')))bindings=Object.fromEntries(Object.entries(bindings).map(([key,binding])=>[key,providerIdentity(binding)]));
  const fixed=Object.values(bindings).filter(binding=>binding.relocation==='fixed');
  // Preserve the previous protocol byte for byte when no shared provider exists.
  if(!fixed.length)return portable({env,bindings},root);
  const scopes=fixedScopes(bindings);
  const variables=Object.fromEntries(Object.entries(env).map(([key,value])=>{
    if(key==='PATH')return[key,value.split(delimiter).map(path=>portableProviderValue(path,root,scopes)).join(delimiter)];
    const owned=fixed.some(binding=>binding.env?.[key]===value);
    return[key,owned?value:portableProviderValue(value,root,scopes)];
  }));
  const providers=Object.fromEntries(Object.entries(bindings).map(([key,binding])=>[key,binding.relocation==='fixed'?portable(binding,''):portableProviderValue(binding,root,scopes)]));
  return portable({env:variables,bindings:providers},'');
}
function operational(root: string, env: Record<string,string>, bindings: Record<string,CapabilityBinding>): OperationalEnvironment {
  const priority=(binding:CapabilityBinding):number=>binding.derivedFrom?0:binding.kind==='library'?1:2;
  const providerPaths=Object.values(bindings).filter(binding=>binding.relocation!=='fixed').sort((a,b)=>priority(a)-priority(b)||a.capability.localeCompare(b.capability)).flatMap(binding=>binding.paths??[]);
  const owned=new Set(providerPaths),normalized={...env};
  if(providerPaths.length){const ambient=(env.PATH??process.env.PATH??'').split(delimiter).filter(path=>!owned.has(path));normalized.PATH=[...new Set([...providerPaths,...ambient])].join(delimiter);}
  return { root, env:normalized, bindings, revision: digest(JSON.stringify(operationalIdentity(root,normalized,bindings))) };
}

export function emptyOperationalEnvironment(workspace = ''): OperationalEnvironment { return operational(workspace, {}, {}); }
export function mergeOperationalEnvironments(workspace: string, ...items: (OperationalEnvironment | undefined)[]): OperationalEnvironment {
  const env:Record<string,string>={}, bindings:Record<string,CapabilityBinding>={};
  for (const item of items) if (item) { Object.assign(env,item.env); Object.assign(bindings,item.bindings); }
  // Retain all candidates until identity checks resolve a runtime/derived-environment collision.
  const candidates=items.flatMap(item=>Object.values(item?.bindings??{}));
  const derivedPaths:string[]=[];
  for(const derived of candidates.filter(binding=>binding.derivedFrom)){
    const base=candidates.find(binding=>binding.kind==='runtime'&&!binding.derivedFrom&&binding.aliases?.some(alias=>derived.aliases?.includes(alias)));
    if(!base)continue;
    if(!base.binaryFingerprint||base.binaryFingerprint!==derived.derivedFrom!.binaryFingerprint)throw new Error(`The project virtual environment does not derive from the selected runtime capability ${base.capability}; prepare that environment with its declared provider before consuming it.`);
    const merged:CapabilityBinding={...derived,capability:base.capability,provider:base.provider,ready:Boolean(base.ready&&derived.ready),aliases:[...new Set([...(base.aliases??[]),...(derived.aliases??[])])],paths:[...new Set([...(derived.paths??[]),...(base.paths??[])])],env:{...base.env,...derived.env},derivedFrom:{...derived.derivedFrom!,...(base.fingerprint?{baseFingerprint:base.fingerprint}:{}),baseCapability:base.capability,baseProvider:base.provider},fingerprint:digest(JSON.stringify({base:base.fingerprint,derived:derived.derivedFrom!.fingerprint}))};
    if(!base.dependencyFamily)delete merged.dependencyFamily;
    if(derived.capability!==base.capability)delete bindings[derived.capability];bindings[base.capability]=merged;
    Object.assign(env,merged.env??{});derivedPaths.push(...merged.paths??[]);
  }
  const paths=[...new Set([...derivedPaths,...items.flatMap(item => item?.env.PATH?.split(delimiter) ?? [])])];
  if(paths.length) env.PATH=paths.join(delimiter);
  return operational(workspace,env,bindings);
}
export function relocateOperationalEnvironment(value: OperationalEnvironment, from: string, to: string): OperationalEnvironment {
  const fixed=Object.values(value.bindings).filter(binding=>binding.relocation==='fixed');
  if(fixed.length){
    const scopes=fixedScopes(value.bindings);
    const replace=(item:unknown):unknown=>typeof item==='string'?protectedRootReplace(item,from,resolve(to),scopes):Array.isArray(item)?item.map(replace):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,replace(entry)])):item;
    const env=Object.fromEntries(Object.entries(value.env).map(([key,entry])=>{
      if(key==='PATH')return[key,entry.split(delimiter).map(path=>replace(path) as string).join(delimiter)];
      return[key,fixed.some(binding=>binding.env?.[key]===entry)?entry:replace(entry) as string];
    }));
    const bindings=Object.fromEntries(Object.entries(value.bindings).map(([key,binding])=>[key,binding.relocation==='fixed'?structuredClone(binding):replace(binding) as CapabilityBinding]));
    return operational(resolve(to),env,bindings);
  }
  const replace=(item:unknown):unknown=> typeof item==='string'?item.replaceAll(resolve(from),resolve(to)):Array.isArray(item)?item.map(replace):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,replace(entry)])):item;
  const relocated=replace(value) as OperationalEnvironment;
  return operational(resolve(to),relocated.env,relocated.bindings);
}
function quote(value:string):string { return process.platform==='win32'?`"${value.replaceAll('"','""')}"`:`'${value.replaceAll("'", "'\\''")}'`; }
function firstToken(value:string):string { return value.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/)?.slice(1).find(Boolean) ?? ''; }
/** A deliberately small argv lexer. Shell operators are not executable arguments. */
function words(value:string):{value:string;end:number}[]{
  const result:{value:string;end:number}[]=[];
  const expression=/\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s;&|<>]+))/gy;
  while(expression.lastIndex<value.length){const found=expression.exec(value);if(!found)break;result.push({value:found[1]?.replace(/\\(["\\])/g,'$1')??found[2]??found[3]??'',end:expression.lastIndex});}
  return result;
}
function providerIdentity(binding:CapabilityBinding):CapabilityBinding{
  if(!binding.transformations?.some(item=>item.kind==='product-probe-separated-from-availability'))return binding;
  const {transformations,...identity}=binding,selected=transformations.filter(item=>item.kind!=='product-probe-separated-from-availability');
  return{...identity,...(selected.length?{transformations:selected}:{})};
}
function probeArgv(recipe:CommandRecipe):string[]|undefined{
  if(recipe.args)return[recipe.command,...recipe.args];
  const value=recipe.command.trim(),parsed=words(value);
  return parsed.length&&parsed.at(-1)!.end===value.length?parsed.map(item=>item.value):undefined;
}
function interpreter(name:string):'node'|'python'|'java'|undefined{
  const binary=basename(name).replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase();
  return['node','nodejs'].includes(binary)?'node':/^python(?:\d+(?:\.\d+)*)?$/.test(binary)||binary==='py'?'python':binary==='java'?'java':undefined;
}
/** A compiler launched through an interpreter includes its actual program. */
function sdkPrefix(recipe:CommandRecipe):string[]|undefined{
  const argv=probeArgv(recipe);if(!argv?.length)return undefined;
  const kind=interpreter(argv[0]!);if(!kind)return undefined;
  if(kind==='java')return argv[1]==='-jar'&&argv[2]?[...argv.slice(0,3)]:undefined;
  for(let index=1;index<argv.length;index++){
    const arg=argv[index]!;
    if(kind==='python'&&arg==='-m')return argv[index+1]?argv.slice(0,index+2):undefined;
    if(arg==='--')return argv[index+1]?argv.slice(0,index+2):undefined;
    if(!arg.startsWith('-'))return argv.slice(0,index+1);
    if(kind==='node'&&['-r','--require','--import','--loader','--experimental-loader','--conditions','-C'].includes(arg)){if(!argv[++index])return undefined;continue;}
    if(kind==='node'&&/^(?:--require|--import|--loader|--experimental-loader|--conditions)=/.test(arg))continue;
    if(kind==='node'&&['--no-warnings','--enable-source-maps','--experimental-strip-types','--experimental-transform-types'].includes(arg))continue;
    if(kind==='python'&&['-I','-B','-E','-S','-s','-u'].includes(arg))continue;
    return undefined;
  }
  return undefined;
}
/** Shared by command execution and agent wrapper publication. */
export function operationalInvocations(value:OperationalEnvironment,options:{readyOnly?:boolean}={}):CapabilityInvocation[]{
  const invocations=Object.values(value.bindings).filter(binding=>!options.readyOnly||binding.ready).flatMap(binding=>[
    ...(binding.command?.length?[{command:binding.command,aliases:binding.aliases??[],...(binding.match?{match:binding.match}:{})}]:[]),
    ...(binding.invocations??[]),
  ]);
  const aliases=new Map<string,string[]>();
  for(const invocation of invocations)for(const alias of [...invocation.aliases??[],...(invocation.match?.length?[`argv:${JSON.stringify(invocation.match)}`]:[])]){
    const previous=aliases.get(alias);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(invocation.command))throw new OperationalInvocationConflict(alias,[previous,invocation.command]);
    aliases.set(alias,invocation.command);
  }
  return invocations;
}
export function applyOperationalEnvironment<T extends CommandRequest>(request:T, value?:OperationalEnvironment):T {
  if(!value) return request;
  let command=request.command;
  const tokens=typeof command==='string'?words(command):command.map((part,index)=>({value:part,end:index+1}));
  const candidates=operationalInvocations(value).map(invocation=>{
    const exact=invocation.match?.length&&invocation.match.every((part,index)=>tokens[index]?.value===part);
    const count=exact?invocation.match!.length:invocation.aliases?.includes(tokens[0]?.value??'')?1:0;
    return{invocation,count};
  }).filter(item=>item.count).sort((a,b)=>b.count-a.count);
  const selected=candidates[0];
  if(selected){
    if(typeof command==='string') command=selected.invocation.command.map(quote).join(' ')+command.slice(tokens[selected.count-1]!.end);
    else command=[...selected.invocation.command,...command.slice(selected.count)];
  }
  return {...request,command,environment:{...value.env,...request.environment}};
}
function defaultKind(node:EnvironmentNode):CapabilityKind {
  return node.identity?.kind ?? (node.kind==='tool'?'cli':node.kind==='package'?'library':node.kind==='database'?'service':node.kind==='sdk'?'sdk':node.kind==='runtime'?'runtime':'service');
}
export function validateEnvironmentNodeIdentity(node:EnvironmentNode):string[] {
  const problems:string[]=[];
  if(node.kind==='database'&&!node.identity)problems.push('A database capability must explicitly distinguish its CLI, driver or service identity.');
  if(node.identity && (!node.identity.capability.trim()||!node.identity.provider.trim())) problems.push('Capability and provider identities must be explicit.');
  if(['cli','runtime','sdk'].includes(defaultKind(node)) && !(node.provides?.command?.length||node.check.command.trim())) problems.push('An executable capability needs a concrete invocation and readiness probe.');
  return problems;
}
async function executable(path:string):Promise<boolean>{
  try{const info=await stat(path);if(!info.isFile())return false;await access(path,process.platform==='win32'?0:1);return true;}catch{return false;}
}
function executableNames(name:string):string[]{return process.platform==='win32'&&!extname(name)?[name,...(process.env.PATHEXT??'.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map(suffix=>name+suffix.toLowerCase())]:[name];}
async function localExecutable(workspace:string,name:string):Promise<string|undefined>{
  const names=executableNames(name);
  for(const folder of ['.tools/bin','.local/bin','tools/bin','.venv/bin','.venv/Scripts','node_modules/.bin','.bin','bin'])for(const candidate of names){const path=join(workspace,folder,candidate);if(await executable(path))return path;}
  // Recovery can install into any project-local provider. Identity is still the exact requested executable.
  const queue:[string,number][]=[[resolve(workspace),0]];
  for(let index=0;index<queue.length&&index<10000;index++){
    const [folder,depth]=queue[index]!;
    const entries=await readdir(folder,{withFileTypes:true}).catch(()=>[]);
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const path=join(folder,entry.name);
      if(names.some(candidate=>process.platform==='win32'?candidate.toLowerCase()===entry.name.toLowerCase():candidate===entry.name)&&await executable(path))return path;
      if(entry.isDirectory()&&depth<6&&!['.git','.capivara-next','.capivara-runtime','.capivara-verification','.project-inputs','__pycache__'].includes(entry.name))queue.push([path,depth+1]);
    }
  }
  return undefined;
}
/** Provider exports need a declared consumer. Product configuration belongs in the
 * product's configuration contract, not in every process that happens to use Node. */
export function unverifiedEnvironmentExports(node:EnvironmentNode):string[]{
  const recipes=[node.check,...node.prepare].map(recipe=>[recipe.command,...recipe.args??[]].join(' ')).join('\n');
  const providerSearch=new Set(['PATH','PATHEXT','LD_LIBRARY_PATH','DYLD_LIBRARY_PATH','PYTHONPATH','JAVA_HOME','VIRTUAL_ENV','NODE_PATH']);
  return Object.keys(node.provides?.env??{}).filter(key=>{
    if(providerSearch.has(key))return false;
    const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const reference=new RegExp(`(?:\\$\\{?${escaped}\\b|%${escaped}%|(?:process\\.env|os\\.environ|environ|env)\\s*(?:\\.\\s*${escaped}\\b|\\[\\s*['"]${escaped}['"])|(?:getenv|env::var|environ\\.get)\\s*\\(\\s*['"]${escaped}['"])`);
    return !reference.test(recipes);
  });
}
async function resolveExecutable(workspace:string,original:string,node:EnvironmentNode,base:OperationalEnvironment,provided=true):Promise<string|undefined>{
  const path=isAbsolute(original)?original:original.includes('/')||original.includes('\\')?resolve(workspace,original):undefined;
  for(const folder of node.provides?.paths??[])for(const name of executableNames(basename(original))){const candidate=join(resolve(workspace,folder),name);if(await executable(candidate))return candidate;}
  if(!provided){const local=await localExecutable(workspace,basename(original));if(local)return local;}
  if(path)return await executable(path)?path:undefined;
  for(const folder of (base.env.PATH??process.env.PATH??'').split(delimiter)){
    const relativePath=relative(resolve(workspace),resolve(folder));
    if(['.capivara-runtime','.capivara-verification','.capivara-next'].some(prefix=>relativePath===prefix||relativePath.startsWith(`${prefix}${sep}`)))continue;
    for(const name of executableNames(original)){const candidate=join(folder,name);if(await executable(candidate))return candidate;}
  }
  return provided?undefined:localExecutable(workspace,original);
}
async function invocation(workspace:string,node:EnvironmentNode,base:OperationalEnvironment):Promise<CapabilityBinding>{
  const executableKind=['cli','runtime','sdk'].includes(defaultKind(node));
  const transformations:NonNullable<CapabilityBinding['transformations']>=[];
  const declaration=JSON.stringify(node.provides??null);
  const previous=base.bindings[node.identity?.capability??node.id];
  transformations.push(...previous?.transformations?.filter(item=>item.kind==='product-probe-separated-from-availability'&&item.original&&typeof item.original==='object'&&'declaration' in item.original&&item.original.declaration===JSON.stringify(node.check))??[]);
  const accepted=previous?.invocationResolution?.declaration===declaration?previous.invocationResolution:undefined;
  if(accepted)transformations.push(...previous?.transformations?.filter(item=>item.kind==='separated-executable-list')??[]);
  const declared=node.provides?.command?.length?[...node.provides.command]:node.provides?.invocations?.[0]?.command?.length?[...node.provides.invocations[0].command]:defaultKind(node)==='sdk'&&sdkPrefix(node.check)?sdkPrefix(node.check)!:node.check.args?[node.check.command]:[firstToken(node.check.command)];
  let definitions:{command:string[];aliases?:string[]}[]=[{command:declared,...(node.provides?.aliases?{aliases:node.provides.aliases}:{})},...(node.provides?.invocations??[]).filter(item=>JSON.stringify(item.command)!==JSON.stringify(declared))];
  const provided=Boolean(node.provides?.command?.length||node.provides?.invocations?.length);
  let candidateDefinitions:{command:string[];aliases?:string[]}[]|undefined;
  if(executableKind&&provided&&!node.provides?.invocations?.length&&!node.provides?.aliases?.length&&declared.length>1){
    const independent=await Promise.all(declared.map(async part=>{
      const direct=await resolveExecutable(workspace,part,node,base);
      if(direct)return[part];
      const parsed=words(part);if(!parsed.length||parsed.at(-1)?.end!==part.length)return undefined;
      const tokens=parsed.map(token=>token.value);return await resolveExecutable(workspace,tokens[0]!,node,base)?tokens:undefined;
    }));
    const matchingProbe=basename(firstToken(node.check.command))===basename(declared[0]!);
    const explicitCommandStrings=declared.every(part=>words(part).length>1);
    if(independent.every((item):item is string[]=>Boolean(item))&&(matchingProbe||explicitCommandStrings)){
      candidateDefinitions=independent.map(command=>({command}));
    }
  }
  if(accepted)definitions=accepted.invocations;
  const resolveInvocations=async(items:typeof definitions):Promise<CapabilityInvocation[]>=>{
  const resolved:CapabilityInvocation[]=[];
  for(const definition of items){
    const original=definition.command[0]??'';
    const selected=[...definition.command];
    if(original&&executableKind){const available=await resolveExecutable(workspace,original,node,base,provided);if(available)selected[0]=available;}
    // A compound invocation must never replace its interpreter globally (node script.js != node).
    const aliases=definition.aliases??(definition.command.length===1?[...new Set([original,basename(original)].filter(Boolean))]:[]);
    resolved.push({command:selected,aliases,match:definition.command});
  }return resolved;};
  const invocations=await resolveInvocations(definitions),candidates=!accepted&&candidateDefinitions?await resolveInvocations(candidateDefinitions):undefined;
  const selected=invocations[0]!;
  const candidatePaths=[...new Set([...(node.provides?.paths??[]).map(folder=>resolve(workspace,folder)),...invocations.flatMap(item=>item.command[0]&&isAbsolute(item.command[0])?[dirname(item.command[0])]:[])])];
  const paths:string[]=[];
  for(const path of candidatePaths){
    const info=await stat(path).catch(()=>null);
    if(!info?.isDirectory()){
      if(info)transformations.push({kind:'discarded-non-directory-path',original:path,selected:null,reason:'PATH entries must be executable directories; product source files belong in inputs.'});
      continue;
    }
    const implicit=invocations.some(item=>item.command[0]&&isAbsolute(item.command[0])&&dirname(item.command[0])===path);
    let usable=implicit;
    if(!usable)for(const name of await readdir(path).catch(()=>[])){if(await executable(join(path,name))){usable=true;break;}}
    if(usable)paths.push(path);
    else if((node.provides?.paths??[]).some(folder=>resolve(workspace,folder)===path))transformations.push({kind:'discarded-non-executable-path',original:path,selected:null,reason:'This directory contains no executable provider entries. It is not an executable search path.'});
  }
  const unverified=new Set(unverifiedEnvironmentExports(node));
  const exported=Object.fromEntries(Object.entries(node.provides?.env??{}).filter(([key])=>!unverified.has(key)));
  for(const key of unverified)transformations.push({kind:'unverified-environment-export',original:{key,value:node.provides?.env?.[key]},selected:null,reason:'No provider readiness or preparation recipe declares this environment variable as an input. Do not inject an unverified application setting into unrelated tools.'});
  let modules=node.provides?.modules?.map(module=>({...module,runtimeCommand:[...module.runtimeCommand]}));
  if(!modules?.length&&['library','driver'].includes(defaultKind(node))){
    const argv=probeArgv(node.check),inferred=argv&&await inferProviderModule(recipeCwd(workspace,node.check.cwd),argv,{...base.env,...exported});
    if(inferred){modules=[inferred];transformations.push({kind:'literal-module-readiness-protocol',original:structuredClone(node.check),selected:inferred,reason:'The readiness recipe contains exactly one literal import and its concrete host confirms the declared module protocol. This declares observation only; readiness never proves product usage.'});}
  }
  return {capability:node.identity?.capability??node.id,kind:defaultKind(node),provider:node.identity?.provider??node.id,...(executableKind?{command:selected.command,aliases:selected.aliases,match:selected.match,...(invocations.length>1?{invocations:invocations.slice(1)}:{}),...(candidates?{candidateInvocations:candidates}:{}),...(accepted?{invocationResolution:accepted}:{})}:{}),...(modules?.length?{modules}:{}),...(node.provides?.env?{env:exported}:{}),...(paths.length?{paths}:{}),...(node.provides?.inputs?{inputs:[...node.provides.inputs]}:{}),...(transformations.length?{transformations}:{})};
}
async function bindNode(workspace:string,node:EnvironmentNode,base?:OperationalEnvironment):Promise<OperationalEnvironment>{
  const previous=base??emptyOperationalEnvironment(workspace), binding=await invocation(workspace,node,previous);
  const env={...previous.env};
  // A corrected binding replaces its former exports; deleting an invalid export must
  // actually remove it from a resumed operational environment as well.
  for(const key of new Set([...Object.keys(previous.bindings[binding.capability]?.env??{}),...Object.keys(node.provides?.env??{})]))delete env[key];
  Object.assign(env,binding.env);
  const oldPaths=new Set([...(previous.bindings[binding.capability]?.paths??[]),...(node.provides?.paths??[]).map(folder=>resolve(workspace,folder))]);
  if(env.PATH)env.PATH=env.PATH.split(delimiter).filter(path=>!oldPaths.has(path)).join(delimiter);
  if(binding.paths?.length)env.PATH=[...new Set([...binding.paths,...(env.PATH??process.env.PATH??'').split(delimiter)])].join(delimiter);
  return operational(workspace,env,{...previous.bindings,[binding.capability]:binding});
}
const executableHashes=new Map<string,{stamp:string,hash:string}>();
async function binaryFingerprint(path:string):Promise<string|undefined>{
  const info=await stat(path).catch(()=>null);if(!info?.isFile())return undefined;
  const stamp=`${info.size}:${info.mtimeMs}:${info.mode}`;let cached=executableHashes.get(path);
  if(cached?.stamp!==stamp){cached={stamp,hash:digest(await readFile(path))};executableHashes.set(path,cached);}
  return digest(JSON.stringify({mode:info.mode&0o777,content:cached.hash}));
}
export async function environmentFingerprint(workspace:string,node:EnvironmentNode,value?:OperationalEnvironment):Promise<string>{
  const resolved=await bindNode(workspace,node,value), binding=resolved.bindings[node.identity?.capability??node.id]!;
  const command=binding.command?.[0]??firstToken(node.check.command);
  const info=command?await stat(command).catch(()=>null):null;
  let executableIdentity:unknown=null;
  if(info&&info.isFile()){
    const stamp=`${info.size}:${info.mtimeMs}:${info.mode}`;let cached=executableHashes.get(command);
    if(cached?.stamp!==stamp){cached={stamp,hash:digest(await readFile(command))};executableHashes.set(command,cached);}
    executableIdentity={path:portable(command,workspace),mode:info.mode,content:cached.hash};
  }
  const {PATH:_path,...variables}=resolved.env;
  const fixedFiles=[];
  for(const argument of binding.command?.slice(1)??[]){
    if(argument.startsWith('-')||!argument.includes('/')&&!argument.includes('\\')&&!extname(argument))continue;
    const path=resolve(workspace,argument);fixedFiles.push({path:portable(path,workspace),hash:await binaryFingerprint(path)??null});
  }
  const moduleHosts=[];
  for(const module of binding.modules??[]){const host=await resolveModuleHost(recipeCwd(workspace,node.check.cwd),module,resolved.env).catch(()=>undefined);moduleHosts.push({module,host:host??null});}
  return digest(JSON.stringify({node:portable(node,workspace),provider:portable(providerIdentity(binding),workspace),executableIdentity,...(fixedFiles.length?{fixedFiles}:{}),...(moduleHosts.length?{moduleHosts:portable(moduleHosts,workspace)}:{}),inputs:await inputHash(workspace,node.provides?.inputs??[]),platform:process.platform,variables:portable(variables,workspace)}));
}
/** Fingerprint only providers and installation inventories consumed by this proof. */
export function projectDependencyScope(inputs?:readonly string[],checks:readonly Verification[]=[]):string{return inputs===undefined?'all':dependencyFamilies(inputs,checks).join('+')||'none';}
export function selectOperationalEnvironment(value:OperationalEnvironment,inputs:readonly string[],checks:readonly Verification[]=[]):OperationalEnvironment{
  const families=dependencyFamilies(inputs,checks);
  const commands=checks.map(check=>firstToken(check.command??''));
  const browser=checks.some(check=>check.kind==='web'||check.requiredCapabilities.some(capability=>capability==='browser'||capability==='web-browser')||inferredCapabilities(`${check.command??''} ${(check.args??[]).join(' ')}`).includes('browser'));
  const selected=Object.fromEntries(Object.entries(value.bindings).filter(([key,binding])=>{
    if(key==='project-dependencies')return false; // Superseded by typed per-family inventories.
    if(binding.dependencyFamily==='browser')return browser;
    if(!binding.dependencyFamily)return true;
    return families.includes(binding.dependencyFamily)||commands.some(command=>Boolean(binding.aliases?.includes(command)));
  }));
  const ownedKeys=new Set(Object.values(value.bindings).flatMap(binding=>Object.keys(binding.env??{})));
  const ownedPaths=new Set(Object.values(value.bindings).flatMap(binding=>[...(binding.paths??[]),...(binding.relocation==='fixed'?binding.env?.PATH?.split(delimiter)??[]:[])]));
  const env=Object.fromEntries(Object.entries(value.env).filter(([key])=>key!=='PATH'&&!ownedKeys.has(key)));
  Object.assign(env,...Object.values(selected).map(binding=>binding.env??{}));
  const ambient=(value.env.PATH??'').split(delimiter).filter(path=>path&&!ownedPaths.has(path));
  const paths=[...new Set([...Object.values(selected).filter(binding=>binding.relocation!=='fixed').flatMap(binding=>binding.paths??[]),...Object.values(selected).filter(binding=>binding.relocation==='fixed').flatMap(binding=>binding.env?.PATH?.split(delimiter)??[]),...ambient])];
  if(paths.length)env.PATH=paths.join(delimiter);
  return operational(value.root??'',env,selected);
}
export function verificationOperationalRevision(value:OperationalEnvironment,inputs:readonly string[],check:Verification):string{return selectOperationalEnvironment(value,inputs,[check]).revision;}
export const forbiddenCapabilities = (brief: ProductBrief): string[] => [...new Set(brief.constraints.flatMap(value=>value.forbiddenCapabilities))];
export function executionConstraints(brief: ProductBrief, allowSystemInstall = false): ExecutionConstraints {
  const implicit=['http-server','browser'].filter(capability=>!allowedCapabilities(brief,[capability]));
  return {forbiddenCapabilities:[...new Set([...forbiddenCapabilities(brief),...implicit])],allowSystemInstall};
}
export function recipeCwd(workspace: string, cwd?: string): string {
  if (!cwd || cwd === '.') return resolve(workspace);
  const root = resolve(workspace), resolved = resolve(root,cwd), path = relative(root,resolved);
  if (path === '..' || path.startsWith(`..${sep}`)) throw new Error(`Recipe escapes the project: ${cwd}`);
  return resolved;
}
export function recipeCommand(recipe: CommandRecipe): string | readonly string[] {
  return recipe.args ? [recipe.command,...recipe.args] : recipe.command;
}
function issue(subject: string, message: string, evidence: string, external = false): BuildIncident {
  return {id:digest(`${subject}:${message}`).slice(0,16),kind:'environment',subject,message,evidence,action:'Prepare a compatible local environment, verify readiness and continue the consumer.',external};
}
function okay(result: CommandResult): boolean { return result.exitCode === 0 && !result.timedOut && !result.cancelled && !result.issue; }
export async function runRecipe(workspace: string, recipe: CommandRecipe, brief: ProductBrief, execute: CommandExecutor, options: PreparationOptions = {}): Promise<CommandResult> {
  const request: CommandRequest = applyOperationalEnvironment({cwd:recipeCwd(workspace,recipe.cwd),command:recipeCommand(recipe),constraints:executionConstraints(brief,options.allowSystemInstall),capabilities:recipe.capabilities??[],...(recipe.timeoutMs?{timeoutMs:recipe.timeoutMs}:{}),...(options.signal?{signal:options.signal}:{})},options.operational);
  const needsTerminal = recipe.capabilities?.some(capability => /^(?:pty|terminal|interactive-terminal|pseudoterminal)$/i.test(capability));
  const progress = { id: `environment:command:${digest(JSON.stringify({ cwd: request.cwd, command: request.command })).slice(0, 16)}`, label: `Preparação: ${recipe.command}`, stage: 'build' };
  emitProgress(options.onEvent, { ...progress, status: 'running' });
  // Readiness of a terminal is an actual PTY operation, never a pipes-based process probe.
  const result = await (needsTerminal ? (options.terminal ?? realTerminal)(request) : execute(request));
  emitProgress(options.onEvent, { ...progress, status: okay(result) ? 'complete' : 'waiting' });
  return result;
}
/** Reconcile a lock mismatch in the same project rather than treating installer preference as a failure. */
export function installationAlternative(command: string, output: string): string | null {
  const lockMismatch = /(?:EUSAGE|ENOLOCK|out.of.sync|lockfile.*(?:missing|outdated|not|frozen)|package.lock|npm ci can only|frozen.lockfile|immutable|yarn.lock.*(?:missing|modified))/i.test(output);
  if (!lockMismatch) return null;
  if (/\bnpm\s+ci\b/.test(command)) return command.replace(/\bnpm\s+ci\b/,'npm install');
  if (/\bpnpm\s+install\b/.test(command) && /--frozen-lockfile/.test(command)) return command.replace(/\s+--frozen-lockfile\b/g,' --no-frozen-lockfile');
  if (/\byarn\s+install\b/.test(command)) return command.replace(/\s+--(?:immutable|frozen-lockfile)\b/g,'');
  return null;
}
function availabilityRecipe(workspace:string,node:EnvironmentNode,probe:CommandRecipe,binding:CapabilityBinding,options:PreparationOptions):CommandRecipe|undefined{
  if(!['runtime','sdk','cli'].includes(defaultKind(node))||!binding.command?.length)return undefined;
  const argv=probeArgv(probe);if(!argv)return undefined;
  // A failed version requirement or inline assertion must never become a
  // successful availability check of the same interpreter.
  if(argv.slice(1).some(arg=>/^(?:--(?:[\w-]*-)?version(?:$|=|-)|-[vV]$|version$)/i.test(arg.replace(/([a-z])([A-Z])/g,'$1-$2'))))return undefined;
  const runtime=interpreter(argv[0]!);
  const program=sdkPrefix(probe),interpreterArgs=program?argv.slice(1,program.length-1):argv.slice(1);
  if(runtime==='node'&&interpreterArgs.some(arg=>['-e','--eval','-p','--print'].includes(arg)||/^(?:--eval|--print)=/.test(arg)))return undefined;
  if(runtime==='python'&&interpreterArgs.includes('-c'))return undefined;
  if(defaultKind(node)==='sdk'&&runtime&&binding.command.length===1)return undefined;
  if(probe.capabilities?.some(capability=>/^(?:pty|terminal|interactive-terminal|pseudoterminal)$/i.test(capability)))return undefined;
  const hints=[...options.inputs??[],...(options.checks??[]).flatMap(check=>[...check.inputs??[],...check.conformance?.productInputs??[]])];
  const cwd=recipeCwd(workspace,probe.cwd),root=resolve(workspace),fixed=new Set([...(binding.match?.slice(1)??[]),...binding.command.slice(1)]);
  const productArgument=(argument:string):boolean=>{
    const value=argument.startsWith('-')&&argument.includes('=')?argument.slice(argument.indexOf('=')+1):argument;
    if(!value||value.startsWith('-')||fixed.has(value)||/^[a-z]+:\/\//i.test(value))return false;
    const path=resolve(cwd,value),local=relative(root,path).replaceAll('\\','/');
    if(local==='..'||local.startsWith('../')||isAbsolute(local)||/^(?:node_modules|\.venv|\.tools|\.local|\.capivara-next|\.capivara-runtime)(?:\/|$)/.test(local))return false;
    if(hints.some(scope=>{const selector=isAbsolute(scope)?relative(root,scope).replaceAll('\\','/'):scope.replace(/^\.\//,'').replace(/\/$/,'');return local===selector||matchesGlob(local,selector)||!/[?*{[]/.test(selector)&&local.startsWith(`${selector}/`);}))return true;
    return /^[^\d-].*\.[a-z][a-z\d]*$/i.test(value)||value==='.'&&hints.length>0;
  };
  const product=argv.slice(1).some(productArgument)||hints.length>0&&argv.slice(1).some(arg=>['build','check','test','run'].includes(arg));
  if(!product)return undefined;
  return{command:binding.command[0]!,args:[...binding.command.slice(1),'--version'],...(probe.cwd?{cwd:probe.cwd}:{}),timeoutMs:Math.min(probe.timeoutMs??10_000,10_000),capabilities:[]};
}
export async function prepareEnvironmentNode(workspace:string,node:EnvironmentNode,brief:ProductBrief,execute:CommandExecutor,options:PreparationOptions={}):Promise<PreparationResult>{
  const results:CommandResult[]=[];
  let current=await bindNode(workspace,node,mergeOperationalEnvironments(workspace,options.previous?.operational,options.operational));
  const initialFingerprint=await environmentFingerprint(workspace,node,current);
  const finish=async(ready:boolean,incidents:BuildIncident[]=[],noProgress=false):Promise<PreparationResult>=>{
    current=await bindNode(workspace,node,current);
    const fingerprint=await environmentFingerprint(workspace,node,current);
    const capability=node.identity?.capability??node.id;
    const binary=current.bindings[capability]?.command?.[0];
    const binaryIdentity=binary?await binaryFingerprint(binary):undefined;
    current=operational(workspace,current.env,{...current.bindings,[capability]:{...current.bindings[capability]!,ready,fingerprint,...(binaryIdentity?{binaryFingerprint:binaryIdentity}:{})}});
    const cache:PreparedEnvironment={ready,fingerprint,operational:current,...(incidents.length?{failure:incidents.map(item=>item.evidence||item.message).join('\n')}:{}),...(noProgress?{noProgress:true}:{})};
    emitProgress(options.onEvent,{id:`environment:node:${node.id}`,label:node.name,status:ready?'complete':'waiting',stage:'build'});
    return{ready,results,incidents,operational:current,fingerprint,cache};
  };
  const invalid=validateEnvironmentNodeIdentity(node);
  if(invalid.length)return finish(false,[issue(node.id,'The dependency identity is not executable.',invalid.join('\n'))]);
  const unverified=unverifiedEnvironmentExports(node);
  if(unverified.length)return finish(false,[{...issue(node.id,'Provider environment exports have no declared consumer.',JSON.stringify({keys:unverified,exports:node.provides?.env,check:node.check,prepare:node.prepare})),kind:'planning',action:'Remove product configuration descriptions from the provider exports, or declare a real provider readiness operation consuming the concrete values. Then revalidate and continue.'}],true);
  const previous=options.previous;
  const unchangedPrevious=previous?.fingerprint===initialFingerprint;
  const dynamicProvider=['library','driver','service'].includes(defaultKind(node));
  const availabilityAttempted=current.bindings[node.identity?.capability??node.id]?.transformations?.some(item=>item.kind==='product-probe-separated-from-availability');
  const availabilityApplicable=Boolean(availabilityRecipe(workspace,node,node.check,current.bindings[node.identity?.capability??node.id]!,options));
  if(unchangedPrevious){
    if(previous.ready&&!options.revalidate&&!dynamicProvider)return finish(true);
    if(previous.noProgress&&!options.revalidate&&!dynamicProvider&&(!availabilityApplicable||availabilityAttempted))return finish(false,[issue(node.id,'Preparation already produced no progress for these exact inputs.',previous.failure??'No capability or invocation changed. Change the provider, recipe or relevant environment before trying again.')],true);
  }
  emitProgress(options.onEvent,{id:`environment:node:${node.id}`,label:node.name,status:'running',stage:'build'});
  const run=async(recipe:CommandRecipe):Promise<CommandResult>=>{
    current=await bindNode(workspace,node,current);
    const result=await runRecipe(workspace,recipe,brief,execute,{...options,operational:current});results.push(result);return result;
  };
  const binding=current.bindings[node.identity?.capability??node.id]!;
  const checkArgs=node.check.args??words(node.check.command).slice(1).map(token=>token.value);
  const checkExecutable=node.check.args?node.check.command:firstToken(node.check.command);
  const compound=binding.command&&binding.command.length>1&&basename(binding.match?.[0]??binding.command[0]!)===basename(checkExecutable)&&!binding.match?.slice(1).every((part,index)=>checkArgs[index]===part);
  // A readiness probe must exercise the published invocation. Otherwise `node --version`
  // could approve an unusable `node npm` provider without executing it at all.
  const probeRecipe=compound?{...node.check,command:binding.command![0]!,args:[...binding.command!.slice(1),...checkArgs]}:node.check;
  const available=async(failed:CommandResult):Promise<boolean>=>{
    if(okay(failed)||failed.cancelled||options.signal?.aborted)return false;
    const selected=current.bindings[node.identity?.capability??node.id]!,replacement=availabilityRecipe(workspace,node,probeRecipe,selected,options);
    if(!replacement)return false;
    const observed=await run(replacement);
    const published=current.bindings[selected.capability]!;
    const usable=okay(observed)&&Boolean(published.command?.[0]&&await executable(published.command[0]));
    const result=(value:CommandResult)=>({command:value.command,exitCode:value.exitCode,stdout:value.stdout,stderr:value.stderr,timedOut:value.timedOut,cancelled:value.cancelled,...(value.issue?{issue:value.issue}:{})});
    const transformation={kind:'product-probe-separated-from-availability',original:{declaration:JSON.stringify(node.check),request:recipeCommand(probeRecipe),result:result(failed)},selected:{request:recipeCommand(replacement),result:result(observed)},reason:usable?'The declared readiness operation consumes product inputs. Its failure is preserved; the distinct concrete provider invocation is available. This records availability only, never product verification.':'The declared readiness operation consumes product inputs. The distinct availability probe also failed; both observations are preserved and no product verification or readiness is claimed.'};
    current=operational(workspace,current.env,{...current.bindings,[published.capability]:{...published,transformations:[...(published.transformations??[]).filter(item=>item.kind!==transformation.kind),transformation]}});
    return usable;
  };
  const probe=await run(probeRecipe);
  const primaryExecutable=binding.command?.[0]&&await executable(binding.command[0]);
  if(binding.candidateInvocations?.length&&(!okay(probe)||!primaryExecutable)){
    const [primary,...additional]=binding.candidateInvocations;
    const candidate:CapabilityBinding={...binding,command:primary!.command,aliases:primary!.aliases??[],match:primary!.match??primary!.command,invocations:additional};
    delete candidate.candidateInvocations;
    const alternative=operational(workspace,current.env,{...current.bindings,[binding.capability]:candidate});
    const readiness=await runRecipe(workspace,node.check,brief,execute,{...options,operational:alternative});results.push(readiness);
    if(okay(readiness)){
      const resolution={declaration:JSON.stringify(node.provides??null),invocations:[primary!,...additional].map(item=>({command:item.match??item.command,...(item.aliases?{aliases:item.aliases}:{})}))};
      candidate.invocationResolution=resolution;
      candidate.transformations=[...binding.transformations??[],{kind:'separated-executable-list',original:node.provides?.command,selected:resolution.invocations,reason:`The published invocation was unusable (${probe.command}; exit ${probe.exitCode}). Every alternative resolves to its own executable and the selected readiness probe succeeded (${readiness.command}). Original declaration and both command results are preserved.`}];
      current=operational(workspace,alternative.env,{...alternative.bindings,[binding.capability]:candidate});
      return finish(true);
    }
  }
  if(okay(probe)&&primaryExecutable!==false)return finish(true);
  if(await available(probe))return finish(true);
  if(unchangedPrevious&&previous?.noProgress)return finish(false,[issue(node.id,'The readiness probe still fails after an ineffective preparation.',`${probe.command}\n${probe.stderr}\n${probe.stdout}`)],true);
  if(!node.prepare.length)return finish(false,[issue(node.id,`Environment ${node.name} has no usable invocation and no preparation recipe.`,`${probe.command}\n${probe.stderr}\n${probe.stdout}\nPublished invocation: ${JSON.stringify(binding.command??null)}`)],true);
  const readinessOkay=async(result:CommandResult):Promise<boolean>=>{
    const published=current.bindings[node.identity?.capability??node.id]?.command?.[0];
    return okay(result)&&(!published||await executable(published));
  };
  for(const recipe of node.prepare){
    if(options.signal?.aborted)break;
    if(recipe.system&&!options.allowSystemInstall)return finish(false,[issue(node.id,'This provider needs unauthorized system access; select a usable local provider.',recipe.command,true)]);
    const result=await run(recipe);
    if(!okay(result)){
      const alternative=installationAlternative(result.command,`${result.stdout}\n${result.stderr}`);
      if(alternative){const {args:_args,...withoutArgs}=recipe;const replacement=await run({...withoutArgs,command:alternative});if(okay(replacement))continue;}
      const readiness=await run(probeRecipe);if(await readinessOkay(readiness)||await available(readiness))return finish(true);
      const fingerprint=await environmentFingerprint(workspace,node,current);
      return finish(false,[issue(node.id,`Environment ${node.name} is not ready.`,`${result.command}\n${result.stderr}\n${result.stdout}`,Boolean(result.issue?.recoverable))],fingerprint===initialFingerprint);
    }
  }
  const readiness=await run(probeRecipe);
  if(await readinessOkay(readiness)||await available(readiness))return finish(true);
  const unchanged=await environmentFingerprint(workspace,node,current)===initialFingerprint;
  return finish(false,[issue(node.id,`Environment ${node.name} did not provide the required ${defaultKind(node)} capability.`,`${readiness.command}\n${readiness.stderr}\n${readiness.stdout}`)],unchanged);
}
async function exists(path: string): Promise<boolean> { return stat(path).then(()=>true).catch(()=>false); }
export interface ProjectRecipe extends CommandRecipe { dependencyFamily:string; }
export async function manifestRecipes(workspace: string): Promise<ProjectRecipe[]> {
  const pkg = JSON.parse(await readFile(join(workspace,'package.json'),'utf8').catch(()=>'null')) as {packageManager?:string;dependencies?:Record<string,string>;devDependencies?:Record<string,string>} | null;
  const recipes: CommandRecipe[]=[];
  if (pkg && (Object.keys(pkg.dependencies??{}).length || Object.keys(pkg.devDependencies??{}).length)) {
    const manager = pkg.packageManager?.split('@')[0];
    if (manager === 'pnpm' || await exists(join(workspace,'pnpm-lock.yaml'))) recipes.push({command:await exists(join(workspace,'pnpm-lock.yaml'))?'pnpm install --frozen-lockfile':'pnpm install'});
    else if (manager === 'yarn' || await exists(join(workspace,'yarn.lock'))) recipes.push({command:'yarn install'});
    else if (manager === 'bun' || await exists(join(workspace,'bun.lock')) || await exists(join(workspace,'bun.lockb'))) recipes.push({command:'bun install'});
    else recipes.push({command:await exists(join(workspace,'package-lock.json'))?'npm ci --no-audit --no-fund':'npm install --no-audit --no-fund'});
  }
  if (await exists(join(workspace,'Cargo.toml'))) recipes.push({command:'cargo fetch'});
  if (await exists(join(workspace,'go.mod'))) recipes.push({command:'go mod download'});
  const pythonProject=await readFile(join(workspace,'pyproject.toml'),'utf8').catch(()=>'');
  if (await exists(join(workspace,'requirements.txt')) || /^\s*\[(?:project|build-system|tool\.poetry)\]\s*$/m.test(pythonProject)) {
    const python = process.platform==='win32'?'.venv\\Scripts\\python.exe':'.venv/bin/python';
    if (!await exists(join(workspace,python))) recipes.push({command:process.platform==='win32'?'py -m venv .venv':'python3 -m venv .venv'});
    recipes.push({command:await exists(join(workspace,'requirements.txt'))?`${python} -m pip install -r requirements.txt`:`${python} -m pip install -e .`});
  }
  const entries = await readdir(workspace).catch(()=>[]);
  if (entries.some(name=>/\.(?:sln|slnx|csproj|fsproj)$/.test(name))) recipes.push({command:'dotnet restore'});
  return recipes.map(recipe=>({...recipe,dependencyFamily:dependencyFamilies([],[recipe])[0]??'unknown'}));
}
const PROJECT_FAMILY_INPUTS:Record<string,string[]>={
  javascript:[...DEPENDENCY_MANIFESTS.javascript!,'node_modules/.package-lock.json','.pnp.cjs'],
  python:[...DEPENDENCY_MANIFESTS.python!,'.venv/pyvenv.cfg','.venv/bin/python','.venv/Scripts/python.exe','.venv/lib/python*/site-packages/*.dist-info/METADATA','.venv/Lib/site-packages/*.dist-info/METADATA'],
  rust:DEPENDENCY_MANIFESTS.rust!,go:DEPENDENCY_MANIFESTS.go!,
  dotnet:[...DEPENDENCY_MANIFESTS.dotnet!,'*.csproj','*.fsproj','*.sln','*.slnx','obj/project.assets.json'],
};
async function projectFamilyFingerprints(workspace:string):Promise<Record<string,string>>{
  const result:Record<string,string>={};
  for(const [family,selectors] of Object.entries(PROJECT_FAMILY_INPUTS)){
    const manifests=family==='dotnet'?[...DEPENDENCY_MANIFESTS.dotnet!,'*.csproj','*.fsproj','*.sln','*.slnx']:DEPENDENCY_MANIFESTS[family]??[];
    if((await sourceFiles(workspace,manifests)).length)result[family]=await inputHash(workspace,selectors);
  }
  return result;
}
function selectedProjectFamilies(fingerprints:Record<string,string>,inputs?:readonly string[],checks:readonly Verification[]=[]):string[]{
  return(inputs===undefined?Object.keys(fingerprints):dependencyFamilies(inputs,checks)).filter(family=>family in fingerprints).sort();
}
export async function projectDependenciesFingerprint(workspace:string,inputs?:readonly string[],checks:readonly Verification[]=[]):Promise<string>{
  const fingerprints=await projectFamilyFingerprints(workspace), families=selectedProjectFamilies(fingerprints,inputs,checks);
  return digest(JSON.stringify(Object.fromEntries(families.map(family=>[family,fingerprints[family]]))));
}
async function projectOperationalEnvironment(workspace:string,base?:OperationalEnvironment):Promise<OperationalEnvironment>{
  let current=base??emptyOperationalEnvironment(workspace);
  const nodeBin=join(workspace,'node_modules','.bin');
  if(await exists(nodeBin))current=operational(workspace,{...current.env,PATH:[...new Set([nodeBin,...(current.env.PATH??process.env.PATH??'').split(delimiter)])].join(delimiter)},current.bindings);
  const python=join(workspace,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(await executable(python)){
    const cfg=await readFile(join(workspace,'.venv','pyvenv.cfg'),'utf8').catch(()=>'');
    const basePath=cfg.match(/^executable\s*=\s*(.+)$/m)?.[1]?.trim();
    const baseBinary=await binaryFingerprint(basePath??python);
    const parent=Object.values(current.bindings).find(binding=>binding.kind==='runtime'&&binding.aliases?.some(alias=>['python','python3','py'].includes(alias)));
    if(parent?.binaryFingerprint&&baseBinary&&parent.binaryFingerprint!==baseBinary)throw new Error(`The virtual environment does not derive from selected runtime ${parent.capability}.`);
    const derivedFingerprint=digest(JSON.stringify({base:baseBinary,configuration:await inputHash(workspace,['.venv/pyvenv.cfg'])}));
    const baseFingerprint=parent?.derivedFrom?.baseFingerprint??(parent&&!parent.derivedFrom?parent.fingerprint:undefined);
    const capability=parent?.derivedFrom?.baseCapability??parent?.capability??'python';
    const provider=parent?.derivedFrom?.baseProvider??(parent&&!parent.derivedFrom?parent.provider:'project-virtual-environment');
    const folder=dirname(python),env={...current.env,...parent?.env,VIRTUAL_ENV:join(workspace,'.venv'),PATH:[...new Set([folder,...(current.env.PATH??process.env.PATH??'').split(delimiter)])].join(delimiter)};
    const binding:CapabilityBinding={capability,kind:'runtime',provider,ready:parent?parent.ready!==false:true,...(parent&&!parent.dependencyFamily?{}:{dependencyFamily:'python'}),...(baseBinary?{binaryFingerprint:baseBinary,derivedFrom:{kind:'virtual-environment',binaryFingerprint:baseBinary,fingerprint:derivedFingerprint,...(baseFingerprint?{baseFingerprint,baseCapability:capability,baseProvider:provider}:{})}}:{}),fingerprint:baseFingerprint?digest(JSON.stringify({base:baseFingerprint,derived:derivedFingerprint})):derivedFingerprint,command:[python],aliases:[...new Set([...(parent?.aliases??[]),'python','python3','py'])],paths:[...new Set([folder,...parent?.paths??[]])],env:{...parent?.env,VIRTUAL_ENV:join(workspace,'.venv')},inputs:['.venv/pyvenv.cfg']};
    const bindings={...current.bindings};if(capability!=='python')delete bindings.python;bindings[capability]=binding;
    current=operational(workspace,env,bindings);
  }
  return current;
}
export async function prepareProjectDependencies(workspace:string,brief:ProductBrief,execute:CommandExecutor,options:PreparationOptions={}):Promise<PreparationResult>{
  const initialFamilies=await projectFamilyFingerprints(workspace);
  const selected=selectedProjectFamilies(initialFamilies,options.inputs,options.checks);
  const initialFingerprint=await projectDependenciesFingerprint(workspace,options.inputs,options.checks);
  let current=await projectOperationalEnvironment(workspace,mergeOperationalEnvironments(workspace,options.previous?.operational,options.operational));
  const failedFamilies=new Set<string>();
  const finish=async(ready:boolean,results:CommandResult[],incidents:BuildIncident[]):Promise<PreparationResult>=>{
    current=await projectOperationalEnvironment(workspace,current);
    const fingerprints=await projectFamilyFingerprints(workspace),bindings={...current.bindings};delete bindings['project-dependencies'];
    for(const [family,fingerprint] of Object.entries(fingerprints)){
      const key=`project-dependencies:${family}`,previous=options.previous?.operational.bindings[key];
      const usable=selected.includes(family)?!failedFamilies.has(family):Boolean(previous?.ready&&previous.fingerprint===fingerprint);
      const nodeBin=join(workspace,'node_modules','.bin');
      bindings[key]={capability:key,kind:'library',provider:'project-manifest-adapter',ready:usable,fingerprint,dependencyFamily:family,...(family==='javascript'&&await exists(nodeBin)?{paths:[nodeBin]}:{})};
    }
    current=operational(workspace,current.env,bindings);
    const fingerprint=await projectDependenciesFingerprint(workspace,options.inputs,options.checks);
    const noProgress=!ready&&fingerprint===initialFingerprint;
    return{ready,results,incidents,operational:current,fingerprint,cache:{ready,fingerprint,operational:current,...(noProgress?{noProgress:true}:{}),...(incidents.length?{failure:incidents.map(item=>item.evidence).join('\n')}:{})}};
  };
  const previous=options.previous;
  if(previous?.fingerprint===initialFingerprint){
    if(previous.ready&&!options.revalidate)return finish(true,[],[]);
    if(previous.noProgress&&!options.revalidate){for(const family of selected)failedFamilies.add(family);return finish(false,[],[issue('dependencies','An identical preparation already produced no progress.',previous.failure??'Change the relevant dependency inputs or provider before retrying.')]);}
  }
  const progress={id:'environment:dependencies',label:'Dependências do projeto',stage:'build',unit:'receitas'};
  emitProgress(options.onEvent,{...progress,status:'running'});
  let recipes:ProjectRecipe[];
  try{recipes=(await manifestRecipes(workspace)).filter(recipe=>selected.includes(recipe.dependencyFamily));}
  catch(error){for(const family of selected)failedFamilies.add(family);emitProgress(options.onEvent,{...progress,status:'waiting'});return finish(false,[],[issue('manifest','A dependency manifest is unreadable.',String(error))]);}
  // Each adapter reuses only its own completed installation; an unrelated stack cannot force a reinstall.
  recipes=recipes.filter(recipe=>{const cached=previous?.operational.bindings[`project-dependencies:${recipe.dependencyFamily}`];return options.revalidate||!cached?.ready||cached.fingerprint!==initialFamilies[recipe.dependencyFamily];});
  const results:CommandResult[]=[];let completed=0;
  const report=(status:ProgressEvent['progress']['status']):void=>emitProgress(options.onEvent,{...progress,completed,total:recipes.length,status});
  report(recipes.length?'running':'complete');
  for(const recipe of recipes){
    const result=await runRecipe(workspace,recipe,brief,execute,{...options,operational:current});results.push(result);
    if(okay(result)){completed++;report(completed===recipes.length?'complete':'running');continue;}
    const alternative=installationAlternative(typeof recipeCommand(recipe)==='string'?recipe.command:[recipe.command,...recipe.args??[]].join(' '),`${result.stdout}\n${result.stderr}`);
    if(alternative){const repaired=await execute(applyOperationalEnvironment({cwd:workspace,command:alternative,constraints:executionConstraints(brief,options.allowSystemInstall),...(options.signal?{signal:options.signal}:{})},current));results.push(repaired);if(okay(repaired)){completed++;report(completed===recipes.length?'complete':'running');continue;}}
    failedFamilies.add(recipe.dependencyFamily);report('waiting');return finish(false,results,[issue('dependencies','Project dependencies need recovery.',`${result.command}\n${result.stderr}\n${result.stdout}`,Boolean(result.issue?.recoverable))]);
  }
  return finish(true,results,[]);
}
