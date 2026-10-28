import { readFile, stat, realpath } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { dirname, extname, join, relative, resolve, matchesGlob } from 'node:path';
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
  const isOutput=(path:string):boolean=>outputs.some(output=>matchesGlob(path,output)||matchesGlob(path,`${output.replace(/\/$/,'')}/**`));
  const explicit=check.inputs??declaredTaskInputs(plan,task);
  const argumentsWithPaths=(check.args??[]).filter(value=>!value.startsWith('-')&&!value.includes('\n')&&!isOutput(value)&&(/[/\\]/.test(value)||/\.(?:[cm]?[jt]sx?|py|rs|go|json|toml|ya?ml|csproj|fsproj|sln)$/.test(value)));
  return [...new Set([...explicit,...argumentsWithPaths,...(check.inputs===undefined?outputs.map(output=>`!${output}`):[])])];
}
export async function resolveInputDependencies(workspace:string,selectors:readonly string[]):Promise<string[]>{
  const root=resolve(workspace),result=new Set(selectors),queue=await sourceFiles(root,selectors),seen=new Set<string>();
  for(let index=0;index<queue.length;index++){
    const requested=queue[index]!,actual=await realpath(join(root,requested)).catch(()=>join(root,requested)),rel=relative(root,actual).replaceAll('\\','/');
    const file=rel==='..'||rel.startsWith('../')?requested:rel;
    if(seen.has(actual))continue;seen.add(actual);result.add(file);
    const language=family(file);
    if(language){
      let folder=dirname(join(root,file));
      for(;;){
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
    for(const name of imports){const resolved=await resolveImport(root,file,name);if(resolved&&!seen.has(resolved))queue.push(resolved);else if(language==='javascript'&&!name.startsWith('.'))for(const dependency of await resolvePackage(root,file,name))if(!seen.has(dependency))queue.push(dependency);}
  }
  return [...result].sort();
}
