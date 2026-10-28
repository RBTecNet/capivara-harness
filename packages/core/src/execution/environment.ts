import { readFile, stat, readdir, access } from 'node:fs/promises';
import { join, resolve, relative, sep, delimiter, dirname, basename, isAbsolute, extname } from 'node:path';
import type { CommandRecipe, EnvironmentNode, ProductBrief, Verification } from '../domain/types.js';
import { allowedCapabilities } from '../domain/authority.js';
import type { CommandRequest, CommandResult, ExecutionConstraints, TerminalRequest } from '../runtime/types.js';
import { runTerminal as realTerminal } from '../runtime/terminal.js';
import type { BuildIncident } from './types.js';
import { dependencyFamilies, DEPENDENCY_MANIFESTS } from './dependencies.js';
import { digest, inputHash, sourceFiles } from './files.js';
import { emitProgress, type ProgressEvent } from '../telemetry/progress.js';

export type CommandExecutor = (request: CommandRequest) => Promise<CommandResult>;
export type CapabilityKind = 'cli' | 'library' | 'driver' | 'service' | 'runtime' | 'sdk';
export interface CapabilityBinding {
  capability: string;
  kind: CapabilityKind;
  provider: string;
  ready?: boolean;
  fingerprint?: string;
  dependencyFamily?: string;
  binaryFingerprint?: string;
  derivedFrom?: { kind:'virtual-environment'; binaryFingerprint:string; fingerprint:string; baseFingerprint?:string; baseCapability?:string; baseProvider?:string };
  command?: string[];
  aliases?: string[];
  env?: Record<string, string>;
  paths?: string[];
  inputs?: string[];
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
function operational(root: string, env: Record<string,string>, bindings: Record<string,CapabilityBinding>): OperationalEnvironment {
  const priority=(binding:CapabilityBinding):number=>binding.derivedFrom?0:binding.kind==='library'?1:2;
  const providerPaths=Object.values(bindings).sort((a,b)=>priority(a)-priority(b)||a.capability.localeCompare(b.capability)).flatMap(binding=>binding.paths??[]);
  const owned=new Set(providerPaths),normalized={...env};
  if(providerPaths.length){const ambient=(env.PATH??process.env.PATH??'').split(delimiter).filter(path=>!owned.has(path));normalized.PATH=[...new Set([...providerPaths,...ambient])].join(delimiter);}
  return { root, env:normalized, bindings, revision: digest(JSON.stringify(portable({env:normalized,bindings}, root))) };
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
  const replace=(item:unknown):unknown=> typeof item==='string'?item.replaceAll(resolve(from),resolve(to)):Array.isArray(item)?item.map(replace):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,replace(entry)])):item;
  const relocated=replace(value) as OperationalEnvironment;
  return operational(resolve(to),relocated.env,relocated.bindings);
}
function quote(value:string):string { return process.platform==='win32'?`"${value.replaceAll('"','""')}"`:`'${value.replaceAll("'", "'\\''")}'`; }
function firstToken(value:string):string { return value.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/)?.slice(1).find(Boolean) ?? ''; }
export function applyOperationalEnvironment<T extends CommandRequest>(request:T, value?:OperationalEnvironment):T {
  if(!value) return request;
  let command=request.command;
  const first=typeof command==='string'?firstToken(command):command[0];
  const binding=Object.values(value.bindings).find(item=>item.command?.length&&item.aliases?.includes(first??''));
  if(binding?.command){
    if(typeof command==='string') {
      const token=command.trimStart().match(/^(?:"[^"]+"|'[^']+'|[^\s;&|]+)/)?.[0]??'';
      command=binding.command.map(quote).join(' ')+command.trimStart().slice(token.length);
    } else command=[...binding.command,...command.slice(1)];
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
      if(entry.isDirectory()&&depth<6&&!['.git','.capivara-next','.project-inputs','__pycache__'].includes(entry.name))queue.push([path,depth+1]);
    }
  }
  return undefined;
}
async function invocation(workspace:string,node:EnvironmentNode,base:OperationalEnvironment):Promise<CapabilityBinding>{
  const chosen=node.provides?.command?.length?[...node.provides.command]:node.check.args?[node.check.command]:[firstToken(node.check.command)];
  const original=chosen[0]??'';
  const aliases=[...new Set([firstToken(node.check.command),original,basename(original)].filter(Boolean))];
  const executableKind=['cli','runtime','sdk'].includes(defaultKind(node));
  if(original&&executableKind){
    const path=isAbsolute(original)?original:original.includes('/')||original.includes('\\')?resolve(workspace,original):undefined;
    const explicitPaths=(node.provides?.paths??[]).map(folder=>resolve(workspace,folder));
    const provided=Boolean(node.provides?.command?.length);
    const available=await (async()=>{
      for(const folder of explicitPaths)for(const name of executableNames(basename(original))){const candidate=join(folder,name);if(await executable(candidate))return candidate;}
      if(!provided){const local=await localExecutable(workspace,basename(original));if(local)return local;}
      if(path)return await executable(path)?path:undefined;
      for(const folder of (base.env.PATH??process.env.PATH??'').split(delimiter))for(const name of executableNames(original)){const candidate=join(folder,name);if(await executable(candidate))return candidate;}
      return provided?undefined:localExecutable(workspace,original);
    })();
    if(available)chosen[0]=available;
  }
  const paths=[...new Set([...(node.provides?.paths??[]).map(folder=>resolve(workspace,folder)),...(chosen[0]&&isAbsolute(chosen[0])?[dirname(chosen[0])]:[])])];
  return {capability:node.identity?.capability??node.id,kind:defaultKind(node),provider:node.identity?.provider??node.id,...(executableKind?{command:chosen,aliases}:{}),...(node.provides?.env?{env:{...node.provides.env}}:{}),...(paths.length?{paths}:{}),...(node.provides?.inputs?{inputs:[...node.provides.inputs]}:{})};
}
async function bindNode(workspace:string,node:EnvironmentNode,base?:OperationalEnvironment):Promise<OperationalEnvironment>{
  const previous=base??emptyOperationalEnvironment(workspace), binding=await invocation(workspace,node,previous);
  const env={...previous.env,...binding.env};
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
  return digest(JSON.stringify({node:portable(node,workspace),provider:portable(binding,workspace),executableIdentity,inputs:await inputHash(workspace,node.provides?.inputs??[]),platform:process.platform,variables:portable(variables,workspace)}));
}
/** Fingerprint only providers and installation inventories consumed by this proof. */
export function projectDependencyScope(inputs?:readonly string[],checks:readonly Verification[]=[]):string{return inputs===undefined?'all':dependencyFamilies(inputs,checks).join('+')||'none';}
export function selectOperationalEnvironment(value:OperationalEnvironment,inputs:readonly string[],checks:readonly Verification[]=[]):OperationalEnvironment{
  const families=dependencyFamilies(inputs,checks);
  const commands=checks.map(check=>firstToken(check.command??''));
  const selected=Object.fromEntries(Object.entries(value.bindings).filter(([key,binding])=>{
    if(key==='project-dependencies')return false; // Superseded by typed per-family inventories.
    if(!binding.dependencyFamily)return true;
    return families.includes(binding.dependencyFamily)||commands.some(command=>Boolean(binding.aliases?.includes(command)));
  }));
  const ownedKeys=new Set(Object.values(value.bindings).flatMap(binding=>Object.keys(binding.env??{})));
  const ownedPaths=new Set(Object.values(value.bindings).flatMap(binding=>binding.paths??[]));
  const env=Object.fromEntries(Object.entries(value.env).filter(([key])=>key!=='PATH'&&!ownedKeys.has(key)));
  Object.assign(env,...Object.values(selected).map(binding=>binding.env??{}));
  const ambient=(value.env.PATH??'').split(delimiter).filter(path=>path&&!ownedPaths.has(path));
  const paths=[...new Set([...Object.values(selected).flatMap(binding=>binding.paths??[]),...ambient])];
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
export async function prepareEnvironmentNode(workspace:string,node:EnvironmentNode,brief:ProductBrief,execute:CommandExecutor,options:PreparationOptions={}):Promise<PreparationResult>{
  const results:CommandResult[]=[];
  let current=await bindNode(workspace,node,options.operational);
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
  const previous=options.previous;
  const unchangedPrevious=previous?.fingerprint===initialFingerprint;
  const dynamicProvider=['library','driver','service'].includes(defaultKind(node));
  if(unchangedPrevious){
    if(previous.ready&&!options.revalidate&&!dynamicProvider)return finish(true);
    if(previous.noProgress&&!options.revalidate&&!dynamicProvider)return finish(false,[issue(node.id,'Preparation already produced no progress for these exact inputs.',previous.failure??'No capability or invocation changed. Change the provider, recipe or relevant environment before trying again.')],true);
  }
  emitProgress(options.onEvent,{id:`environment:node:${node.id}`,label:node.name,status:'running',stage:'build'});
  const run=async(recipe:CommandRecipe):Promise<CommandResult>=>{
    current=await bindNode(workspace,node,current);
    const result=await runRecipe(workspace,recipe,brief,execute,{...options,operational:current});results.push(result);return result;
  };
  const probe=await run(node.check);
  if(okay(probe))return finish(true);
  if(unchangedPrevious&&previous?.noProgress)return finish(false,[issue(node.id,'The readiness probe still fails after an ineffective preparation.',`${probe.command}\n${probe.stderr}\n${probe.stdout}`)],true);
  for(const recipe of node.prepare){
    if(options.signal?.aborted)break;
    if(recipe.system&&!options.allowSystemInstall)return finish(false,[issue(node.id,'This provider needs unauthorized system access; select a usable local provider.',recipe.command,true)]);
    const result=await run(recipe);
    if(!okay(result)){
      const alternative=installationAlternative(result.command,`${result.stdout}\n${result.stderr}`);
      if(alternative){const {args:_args,...withoutArgs}=recipe;const replacement=await run({...withoutArgs,command:alternative});if(okay(replacement))continue;}
      const readiness=await run(node.check);if(okay(readiness))return finish(true);
      const fingerprint=await environmentFingerprint(workspace,node,current);
      return finish(false,[issue(node.id,`Environment ${node.name} is not ready.`,`${result.command}\n${result.stderr}\n${result.stdout}`,Boolean(result.issue?.recoverable))],fingerprint===initialFingerprint);
    }
  }
  const readiness=await run(node.check);
  if(okay(readiness))return finish(true);
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
