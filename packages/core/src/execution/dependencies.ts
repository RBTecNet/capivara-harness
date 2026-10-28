import { readFile, stat, realpath } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, matchesGlob } from 'node:path';
import type { DevelopmentPlan, Verification, WorkUnit } from '../domain/types.js';
import { inside, sourceFiles } from './files.js';

export const DEPENDENCY_MANIFESTS:Record<string,string[]>={
  javascript:['package.json','package-lock.json','pnpm-lock.yaml','pnpm-workspace.yaml','yarn.lock','bun.lock','bun.lockb','.npmrc','.yarnrc.yml','tsconfig.json','jsconfig.json'],
  python:['pyproject.toml','requirements.txt','poetry.lock','uv.lock','setup.cfg','setup.py'],
  rust:['Cargo.toml','Cargo.lock','.cargo/config.toml'],go:['go.mod','go.sum'],
  dotnet:['global.json','Directory.Build.props','Directory.Build.targets','Directory.Packages.props','NuGet.Config'],
};
function family(path:string):string|undefined{
  const name=path.replaceAll('\\','/').split('/').at(-1)??path;
  for(const [language,manifests] of Object.entries(DEPENDENCY_MANIFESTS))if(manifests.some(manifest=>manifest.split('/').at(-1)===name))return language;
  const extension=extname(path).toLowerCase();
  if(/\.[cm]?[jt]sx?$/.test(path))return 'javascript';
  if(extension==='.py')return 'python';if(extension==='.rs')return 'rust';if(extension==='.go')return 'go';if(['.cs','.fs','.vb','.csproj','.fsproj','.sln'].includes(extension))return 'dotnet';
  return undefined;
}
/** Stack adapters describe manifest protocols, not project-name exceptions. */
export function dependencyFamilies(inputs:readonly string[],checks:readonly Pick<Verification,'command'|'args'>[]=[]):string[]{
  const families=new Set(inputs.map(family).filter((value):value is string=>Boolean(value)));
  for(const check of checks){
    const command=(check.command??'').trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean)??'';
    const binary=command.replaceAll('\\','/').split('/').at(-1)?.replace(/\.(?:exe|cmd|bat)$/i,'')??'';
    if(/^(?:node|npm|pnpm|yarn|bun|deno|tsc|vite|webpack|esbuild)$/.test(binary))families.add('javascript');
    if(/^(?:python[\d.]*|py|pip[\d.]*)$/.test(binary))families.add('python');
    if(/^(?:cargo|rustc)$/.test(binary))families.add('rust');
    if(binary==='go')families.add('go');if(binary==='dotnet')families.add('dotnet');
  }
  return [...families].sort();
}
const exists=async(path:string):Promise<boolean>=>Boolean(await stat(path).catch(()=>null));
async function resolveImport(workspace:string,file:string,name:string):Promise<string|undefined>{
  if(!name.startsWith('.')&&!name.startsWith('/'))return undefined;
  const absolute=resolve(dirname(join(workspace,file)),name);
  const local=relative(resolve(workspace),absolute).replaceAll('\\','/');
  if(local==='..'||local.startsWith('../'))return undefined;
  const variants=[local,...['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.py','.rs'].map(extension=>local+extension),...['index.ts','index.tsx','index.js','index.mjs','__init__.py','mod.rs'].map(index=>`${local}/${index}`)];
  if(/\.js$/.test(local))variants.push(local.replace(/\.js$/,'.ts'),local.replace(/\.js$/,'.tsx'));
  for(const candidate of variants){const info=await stat(inside(workspace,candidate)).catch(()=>null);if(info?.isFile())return candidate;}
  return undefined;
}

async function resolvePackage(workspace:string,file:string,name:string):Promise<string[]>{
  if(isBuiltin(name)||name.startsWith('.')||name.startsWith('/')||name.includes('://'))return[];
  const parts=name.split('/'),packageName=name.startsWith('@')?parts.slice(0,2).join('/'):parts[0]!;
  if(!packageName)return[];
  let folder=dirname(join(workspace,file));
  for(;;){
    const module=join(folder,'node_modules',packageName);
    if(await exists(join(module,'package.json'))){
      const actualModule=await realpath(module);
      const actualRelative=relative(resolve(workspace),actualModule).replaceAll('\\','/');
      const relativeModule=actualRelative==='..'||actualRelative.startsWith('../')?relative(resolve(workspace),module).replaceAll('\\','/'):actualRelative||'.';
      const result=new Set<string>([`${relativeModule}/package.json`]);
      try{const resolved=createRequire(join(workspace,file)).resolve(name);const subpath=relative(actualModule,resolved).replaceAll('\\','/');if(subpath!=='..'&&!subpath.startsWith('../'))result.add(`${relativeModule}/${subpath}`);}catch{/* Import-only exports are observed below, without pretending require conditions are sufficient. */}
      let pkg:{main?:string;module?:string;exports?:unknown}={};try{pkg=JSON.parse(await readFile(join(module,'package.json'),'utf8')) as typeof pkg;}catch{/* Its invalid bytes remain an input; the runtime reports the concrete product failure. */}
      const suffix=parts.slice(name.startsWith('@')?2:1).join('/');
      const exported=(value:unknown):string[]=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(exported):[];
      const targets=[...(suffix?[suffix]:[pkg.main??'index.js',...(pkg.module?[pkg.module]:[])]),...exported(pkg.exports)];
      for(const target of targets){
        if(target.includes('*'))continue;
        const candidate=await resolveImport(workspace,`${relativeModule}/__resolve__.js`,`./${target.replace(/^\.\//,'')}`);if(candidate)result.add(candidate);
      }
      return [...result];
    }
    if(folder===resolve(workspace))break;const parent=dirname(folder);if(parent===folder||!parent.startsWith(resolve(workspace)))break;folder=parent;
  }
  return[];
}

/** Declared read sets are authoritative; relative imports add the files actually consumed by source. */
export function declaredTaskInputs(_plan:DevelopmentPlan,task:WorkUnit):string[]{return [...new Set(task.inputs??task.files)];}
export function declaredCheckInputs(plan:DevelopmentPlan,task:WorkUnit,check:Verification):string[]{
  const outputs=check.outputs??[];
  const explicit=check.inputs??declaredTaskInputs(plan,task);
  return [...new Set([...explicit,...(check.inputs===undefined?outputs.map(output=>`!${output}`):[])])];
}
/** Parse only literal argv. Compound shell programs require explicit read sets. */
function inputArguments(check:Verification):string[]|undefined{
  if(check.args)return[check.command??'',...check.args];
  const result:string[]=[];let token='',quote='',escaped=false,started=false;
  for(const character of check.command??''){
    if(escaped){token+=character;escaped=false;started=true;continue;}
    if(character==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(character===quote)quote='';else token+=character;started=true;continue;}
    if(character==='"'||character==="'"){quote=character;started=true;continue;}
    if(/[;&|<>`$\n\r]/.test(character))return undefined;
    if(/\s/.test(character)){if(started){result.push(token);token='';started=false;}continue;}
    token+=character;started=true;
  }
  if(quote||escaped)return undefined;if(started)result.push(token);return result.length?result:undefined;
}
interface PathArgument { value:string; missing:boolean; }
const outputOptions=new Set(['-o','--output','--out','--out-dir','--outdir','--output-dir','--output-directory']);
function readArguments(argv:readonly string[],depth=0):PathArgument[]{
  if(!argv.length||depth>8)return[];
  const binary=basename(argv[0]??'').replace(/\.(?:exe|cmd|bat)$/i,'').toLowerCase();
  let args=argv.slice(1);
  if(['npm','pnpm','yarn','bun'].includes(binary)){
    while(args[0]&&['--silent','-s'].includes(args[0]))args=args.slice(1);
    if(args[0]==='exec'||args[0]==='x')return readArguments(args.slice(1).filter((value,index)=>index!==0||value!=='--'),depth+1);
    if(args[0]==='run'||args[0]==='run-script')args=args.slice(2);
    else args=args.slice(1); // Package-manager operation/script identifiers are metadata.
    if(args[0]==='--')args=args.slice(1);
  }else if(['npx','pnpx','bunx'].includes(binary)){
    while(args[0]&&['--','--yes','-y','--no-install','--no'].includes(args[0]))args=args.slice(1);
    return readArguments(args,depth+1);
  }
  const reader=['rg','grep','egrep','fgrep'].includes(binary);
  const allPaths=['cat','head','tail','wc','stat','less','more'].includes(binary);
  const result:PathArgument[]=[];let pattern=reader&&!args.includes('--files'),positional=false;
  const genericValues=new Set(['-e','--eval','-p','--print','-c','--command','-m','--module','--grep','--grep-invert','--reporter','--project','--target','--format','--name']);
  const readerValues=new Set(['-g','--glob','--iglob','-t','--type','-T','--type-not','--type-add','--type-clear','-A','--after-context','-B','--before-context','-C','--context','--context-separator','-m','--max-count','--max-depth','--maxdepth','--max-filesize','--threads','-j','--encoding','--engine','-r','--replace','--sort','--sortr','--path-separator']);
  const displayValues=new Set(['-n','--lines','-c','--bytes','--format','--printf']);
  for(let index=0;index<args.length;index++){
    const value=args[index]!;
    if(!positional&&value==='--'){positional=true;continue;}
    if(!positional&&value.startsWith('-')){
      const equal=value.indexOf('='),option=equal>=0?value.slice(0,equal):value;
      const next=():string|undefined=>equal>=0?value.slice(equal+1):args[++index];
      if(outputOptions.has(option)){next();continue;}
      if(reader&&(option==='-e'||option==='--regexp')){next();pattern=false;continue;}
      if(reader&&(option==='-f'||option==='--file')){const file=next();if(file)result.push({value:file,missing:true});pattern=false;continue;}
      if(reader&&value.startsWith('-e')&&!value.startsWith('--')&&value.length>2){pattern=false;continue;}
      if(reader&&value.startsWith('-f')&&!value.startsWith('--')&&value.length>2){result.push({value:value.slice(2),missing:true});pattern=false;continue;}
      if(reader&&readerValues.has(option)||allPaths&&displayValues.has(option)||!reader&&!allPaths&&genericValues.has(option)){next();continue;}
      if(equal>=0)result.push({value:value.slice(equal+1),missing:false});
      continue;
    }
    if(pattern){pattern=false;continue;}
    result.push({value,missing:reader||allPaths});
  }
  return result;
}
async function localReadSelector(workspace:string,cwd:string,argument:PathArgument):Promise<string|undefined>{
  const value=argument.value;if(!value||/[\0\n\r]/.test(value)||/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value))return undefined;
  const root=resolve(workspace),absolute=resolve(cwd,value),path=relative(root,absolute).replaceAll('\\','/');
  if(path==='..'||path.startsWith('../')||isAbsolute(path))return undefined;
  const info=await stat(absolute).catch(()=>null);
  const explicit=argument.missing||value==='.'||value==='..'||/[/\\]/.test(value)||/^\.?[^\s]+\.[A-Za-z0-9_-]+$/.test(value);
  if(!info&&!explicit)return undefined;
  if(info&&!info.isFile()&&!info.isDirectory())return undefined;
  // A path below a symlink is still outside when that nearest existing ancestor
  // resolves outside the workspace. Do not infer an external or control read set.
  let ancestor=absolute;
  for(;;){
    const actual=await realpath(ancestor).catch(()=>undefined);
    if(actual){const rel=relative(root,actual).replaceAll('\\','/');if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))return undefined;break;}
    const parent=dirname(ancestor);if(parent===ancestor)break;ancestor=parent;
  }
  const selected=path||'.';if(selected.split('/').some(part=>['.git','.capivara-next','.capivara-runtime','.capivara-verification'].includes(part)))return undefined;
  return selected;
}
/** Declared selectors plus concrete CLI read operands. Bare directories and missing
 * reader operands retain identity so creation can invalidate an earlier failure. */
export async function verificationInputSelectors(workspace:string,plan:DevelopmentPlan,task:WorkUnit,check:Verification):Promise<string[]>{
  const root=resolve(workspace),cwd=resolve(root,check.cwd??'.'),cwdRelative=relative(root,cwd).replaceAll('\\','/');
  if(cwdRelative==='..'||cwdRelative.startsWith('../')||isAbsolute(cwdRelative))throw new Error(`Verification cwd escapes its workspace: ${check.cwd}`);
  const outputs=check.outputs??[];
  const isOutput=(path:string):boolean=>outputs.some(output=>matchesGlob(path,output)||matchesGlob(path,`${output.replace(/\/$/,'')}/**`));
  const inferred=await Promise.all(readArguments(inputArguments(check)??[]).map(argument=>localReadSelector(root,cwd,argument)));
  return [...new Set([...declaredCheckInputs(plan,task,check),...inferred.filter((path):path is string=>Boolean(path&&!isOutput(path)))])].sort();
}
export async function resolveVerificationInputs(workspace:string,plan:DevelopmentPlan,task:WorkUnit,check:Verification):Promise<string[]>{
  return resolveInputDependencies(workspace,await verificationInputSelectors(workspace,plan,task,check));
}

export async function resolveInputDependencies(workspace:string,selectors:readonly string[]):Promise<string[]>{
  const root=resolve(workspace),result=new Set(selectors),queue=await sourceFiles(root,selectors),seen=new Set<string>();
  // These inventories belong to one read-set traversal only. A later proof
  // re-reads its current files and manifests, including previously missing ones.
  const manifestFolders=new Set<string>(),queued=new Set(queue);
  const importCache=new Map<string,Promise<string|undefined>>(),packageCache=new Map<string,Promise<string[]>>();
  const enqueue=(path:string):void=>{if(!queued.has(path)){queued.add(path);queue.push(path);}};
  const imported=(file:string,name:string):Promise<string|undefined>=>{const key=JSON.stringify([dirname(file),name]);let value=importCache.get(key);if(!value){value=resolveImport(root,file,name);importCache.set(key,value);}return value;};
  const packaged=(file:string,name:string):Promise<string[]>=>{const key=JSON.stringify([dirname(file),name]);let value=packageCache.get(key);if(!value){value=resolvePackage(root,file,name);packageCache.set(key,value);}return value;};
  for(let index=0;index<queue.length;index++){
    const requested=queue[index]!,actual=await realpath(join(root,requested)).catch(()=>join(root,requested)),rel=relative(root,actual).replaceAll('\\','/');
    const file=rel==='..'||rel.startsWith('../')?requested:rel;
    if(seen.has(actual))continue;seen.add(actual);result.add(file);
    const language=family(file);
    if(language){
      let folder=dirname(join(root,file));
      for(;;){
        const key=JSON.stringify([language,folder]);
        if(manifestFolders.has(key))break;
        manifestFolders.add(key);
        for(const manifest of DEPENDENCY_MANIFESTS[language]??[]){const candidate=join(folder,manifest);if(await exists(candidate))result.add(relative(root,candidate).replaceAll('\\','/'));}
        if(folder===root)break;const parent=dirname(folder);if(parent===folder||!parent.startsWith(root))break;folder=parent;
      }
    }
    if(!/\.(?:[cm]?[jt]sx?|py|rs|go|[ch](?:pp)?|cs|fs)$/.test(file))continue;
    const text=await readFile(join(root,file),'utf8').catch(()=>'');
    const imports=new Set<string>();
    for(const match of text.matchAll(/(?:\b(?:import|export)\s+(?:[^'"\n]+?\s+from\s*)?|\b(?:require|import)\s*\()\s*['"]([^'"]+)['"]|#\s*include\s*"([^"]+)"/g))imports.add(match[1]??match[2]??'');
    if(language==='python'){
      for(const match of text.matchAll(/^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/gm)){
        const module=match[1]??match[2]??'';const levels=module.match(/^\.+/)?.[0].length??0;
        const base=levels?`${'../'.repeat(Math.max(0,levels-1))}${module.slice(levels).replaceAll('.','/')}`:module.replaceAll('.','/');
        imports.add(`./${base}`);
      }
    }
    if(language==='rust')for(const match of text.matchAll(/\bmod\s+([a-zA-Z_]\w*)\s*;/g))imports.add(`./${match[1]}`);
    for(const name of imports){const resolved=await imported(file,name);if(resolved)enqueue(resolved);else if(language==='javascript'&&!name.startsWith('.'))for(const dependency of await packaged(file,name))enqueue(dependency);}
  }
  return [...result].sort();
}
