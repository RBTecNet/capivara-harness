import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import type { Verification } from '../domain/types.js';
import { invocationArguments } from './conformance.js';
import { digest, sourceFiles } from './files.js';

interface ScriptInvocation { manager: string; script: string; forwarded: string[]; }
function scriptInvocation(args: string[]): ScriptInvocation | undefined {
  const manager=args[0];
  if(!manager)return undefined;
  const binary=basename(manager).replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase();
  if(!['npm','pnpm','yarn','bun'].includes(binary))return undefined;
  let index=1;
  if(args[index]==='run'||args[index]==='run-script')index+=1;
  else if(binary==='npm'&&!['test','start','stop','restart'].includes(args[index]??''))return undefined;
  const script=args[index];
  if(!script||script.startsWith('-'))return undefined;
  const forwarded=args.slice(index+1);
  return{manager,script,forwarded:forwarded[0]==='--'?forwarded.slice(1):forwarded};
}
function expandedScript(name: string, scripts: Record<string,string>, forwarded: string[] = [], seen = new Set<string>()): string[] | undefined {
  if(seen.has(name))return undefined;
  seen.add(name);
  const command=scripts[name];
  if(typeof command!=='string')return undefined;
  const parsed=invocationArguments(command);
  if(!parsed?.length)return undefined;
  const invocation=scriptInvocation(parsed);
  return invocation?expandedScript(invocation.script,scripts,[...invocation.forwarded,...forwarded],seen):[...parsed,...forwarded];
}
function effectiveHooks(name:string,scripts:Record<string,string>,seen=new Set<string>()):{before:string[];after:string[]}|undefined{
  if(seen.has(name))return undefined;
  seen.add(name);
  const command=scripts[name];
  if(typeof command!=='string')return undefined;
  const args=invocationArguments(command);
  if(!args)return undefined;
  const invocation=scriptInvocation(args);
  const nested=invocation?effectiveHooks(invocation.script,scripts,seen):{before:[],after:[]};
  if(!nested)return undefined;
  const before=scripts[`pre${name}`]?.trim(),after=scripts[`post${name}`]?.trim();
  return{before:[...(before?[before]:[]),...nested.before],after:[...nested.after,...(after?[after]:[])]};
}
function local(root:string,path:string):boolean{const rel=relative(root,path);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);}
async function existingTarget(workspace:string,cwd:string,token:string):Promise<string|undefined>{
  if(!token||token.startsWith('-')||/[\0\n\r*?{}[\]]/.test(token))return undefined;
  const absolute=resolve(cwd,token);
  if(!local(workspace,absolute))return undefined;
  const target=await realpath(absolute).catch(()=>undefined);
  if(!target||!local(workspace,target)||!(await stat(target).catch(()=>undefined))?.isFile())return undefined;
  return target;
}
async function invocationSkeleton(root:string,cwd:string,args:string[],target:string):Promise<string[]>{
  const skeleton:string[]=[];
  const optionValues=new Set(['--import','--require','-r','--loader','--experimental-loader','--conditions','-C','--env-file','--env-file-if-exists','--test-reporter','--test-reporter-destination','--test-name-pattern','--test-skip-pattern','--config','-c','--project','-p']);
  for(let index=0;index<args.length;index++){
    const token=args[index]!;
    // The executable, option names and loader values keep their exact identity.
    // Only an explicit source argument (or a source glob selecting this target)
    // is removed. The malformed forwarded plan arguments are never part of the
    // manifest's baseline in the first place.
    if(index>0&&!token.startsWith('-')&&!optionValues.has(args[index-1]!)){
      const exact=await existingTarget(root,cwd,token);
      const glob=/[*?{}[\]]/.test(token)&&matchesGlob(target,resolve(cwd,token));
      if(exact===target||glob)continue;
    }
    skeleton.push(token);
  }
  return skeleton;
}

/** Select only an unambiguous package interface for the same declared test
 * source. Error prose, project names and script names have no routing authority. */
export async function repositoryRecipeCandidate(workspace:string,check:Verification):Promise<Verification|undefined>{
  if(!check.command)return undefined;
  const original=check.args?[check.command,...check.args]:invocationArguments(check.command);
  if(!original)return undefined;
  const current=scriptInvocation(original);
  if(!current)return undefined;
  const root=resolve(workspace),cwd=resolve(root,check.cwd??'.');
  if(cwd!==root&&!local(root,cwd))return undefined;
  const manifest=resolve(cwd,'package.json');
  const text=await readFile(manifest,'utf8').catch(()=>undefined);
  if(text===undefined)return undefined;
  let scripts:Record<string,string>;
  try{
    const value=JSON.parse(text) as {scripts?:unknown};
    if(!value.scripts||typeof value.scripts!=='object'||Array.isArray(value.scripts))return undefined;
    scripts=Object.fromEntries(Object.entries(value.scripts).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  }catch{return undefined;}
  const owned=new Set<string>();
  for(const path of await sourceFiles(root,check.inputs??[])){const target=await existingTarget(root,root,path);if(target)owned.add(target);}
  const targets=new Set<string>();
  for(const token of current.forwarded){const target=await existingTarget(root,cwd,token);if(target&&owned.has(target))targets.add(target);}
  if(targets.size!==1)return undefined;
  const target=[...targets][0]!;
  const baseline=expandedScript(current.script,scripts);
  const baselineHooks=effectiveHooks(current.script,scripts);
  if(!baseline||!baselineHooks)return undefined;
  const skeleton=await invocationSkeleton(root,cwd,baseline,target);
  const currentExpanded=expandedScript(current.script,scripts,current.forwarded);
  const candidates:{script:string;args:string[]}[]=[];
  for(const script of Object.keys(scripts).sort()){
    if(script===current.script)continue;
    const args=expandedScript(script,scripts);
    if(!args||currentExpanded&&JSON.stringify(args)===JSON.stringify(currentExpanded))continue;
    const hooks=effectiveHooks(script,scripts);
    if(!hooks||JSON.stringify(hooks)!==JSON.stringify(baselineHooks)||JSON.stringify(await invocationSkeleton(root,cwd,args,target))!==JSON.stringify(skeleton))continue;
    const consumed=new Set<string>();
    for(const token of args.slice(1)){const file=await existingTarget(root,cwd,token);if(file)consumed.add(file);}
    if(consumed.has(target))candidates.push({script,args});
  }
  if(candidates.length!==1)return undefined;
  const candidate=candidates[0]!;
  return{...structuredClone(check),command:current.manager,args:['run',candidate.script],recipeCandidate:{kind:'package-script',manifest:relative(root,manifest).replaceAll('\\','/'),manifestHash:digest(text),script:candidate.script,expandedArgv:candidate.args,target:relative(root,target).replaceAll('\\','/'),original:{command:check.command,...(check.args?{args:[...check.args]}:{}),...(check.cwd?{cwd:check.cwd}:{})}}};
}
