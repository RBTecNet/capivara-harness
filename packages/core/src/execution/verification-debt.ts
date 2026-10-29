import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Verification, WorkUnit } from '../domain/types.js';
import { invocationArguments } from './conformance.js';
import { digest, sourceFiles } from './files.js';
import { pathScopesConflict } from './isolation.js';

/** Existing repository interfaces are candidates, never synthetic approvals. */
export async function repositoryVerificationCandidates(workspace:string,task:WorkUnit,requiredKind?:Verification['kind'],integrated=false):Promise<Verification[]>{
  const text=await readFile(join(workspace,'package.json'),'utf8').catch(()=>undefined);if(!text)return[];
  let scripts:Record<string,string>,manager='npm';try{const value=JSON.parse(text) as {scripts?:Record<string,unknown>;packageManager?:string};scripts=Object.fromEntries(Object.entries(value.scripts??{}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));manager=value.packageManager?.match(/^(npm|pnpm|yarn|bun)(?:@|$)/)?.[1]??'npm';}catch{return[];}
  const expand=(name:string,seen=new Set<string>()):string[]|undefined=>{
    if(seen.has(name))return undefined;seen.add(name);
    const argv=invocationArguments(scripts[name]??'');if(!argv?.length)return undefined;
    const binary=basename(argv[0]!).replace(/\.(?:cmd|exe)$/i,'');
    if(['npm','pnpm','yarn','bun'].includes(binary)&&argv[1]==='run'&&argv[2])return expand(argv[2],seen);
    return argv;
  };
  const candidates:Verification[]=[];
  for(const name of Object.keys(scripts).sort()){
    const argv=expand(name);if(!argv)continue;
    let tool=argv;
    if(['npx','pnpx','bunx'].includes(basename(tool[0]??''))){tool=tool.slice(1);while(tool[0]?.startsWith('-'))tool=tool.slice(1);}
    const binary=basename(tool[0]??'').replace(/\.(?:cmd|exe)$/i,'');
    let kind:Verification['kind']|undefined,assertion:Verification['assertion'];
    if(binary==='playwright'&&tool[1]==='test'){kind='web';assertion={type:'regex',source:'stdout',pattern:'\\b[1-9]\\d* passed\\b'};}
    else if(['node','nodejs'].includes(binary)&&tool.includes('--test')){kind='command';assertion={type:'all',assertions:[{type:'regex',source:'stdout',pattern:'(?:^|\\n)# tests [1-9]\\d*(?:\\n|$)'},{type:'regex',source:'stdout',pattern:'(?:^|\\n)# fail 0(?:\\n|$)'}]};}
    else continue;
    if(requiredKind&&kind!==requiredKind)continue;
    const testInputs=tool.slice(1).filter(value=>!value.startsWith('-')&&/\.[cm]?[jt]sx?(?::\d+)?$/.test(value)).map(value=>value.replace(/:\d+(?::\d+)?$/,''));
    if(!integrated&&(!testInputs.length||testInputs.some(path=>!task.files.some(scope=>pathScopesConflict(scope,path)))))continue;
    candidates.push({id:`${task.id}-repository-${digest(name).slice(0,10)}`,kind,command:manager,args:['run',name],level:'behavior',assertion,expected:'The existing repository runner executes its actual scenarios successfully.',requirementIds:[...task.requirementIds],requiredCapabilities:kind==='web'?['browser']:[],inputs:[...task.inputs??task.files,...testInputs,'package.json']});
  }
  return candidates;
}

/** A bounded source index supports a different technical operation after an
 * invalid recipe answer. It contains no project-wide prompt or product rewrite. */
export async function verificationSurfaces(workspace:string,task:WorkUnit):Promise<{files:{path:string;bytes:number}[];manifest?:unknown;probe?:{command:string;args:string[]}}>{
  const files=[];
  for(const path of (await sourceFiles(workspace,task.inputs??task.files)).slice(0,80))files.push({path,bytes:(await stat(join(workspace,path))).size});
  let manifest:unknown;try{const value=JSON.parse(await readFile(join(workspace,'package.json'),'utf8')) as {scripts?:Record<string,unknown>;bin?:unknown};manifest={scripts:Object.fromEntries(Object.entries(value.scripts??{}).slice(0,24).map(([name,command])=>[name,typeof command==='string'?command.slice(0,800):command])),bin:value.bin};}catch{/* A manifest is optional for an arbitrary interface. */}
  const programs=files.filter(file=>/\.(?:[cm]?js|py)$/.test(file.path)&&!/(?:^|\/)(?:test|tests|node_modules)\//.test(file.path));
  const program=programs.length===1?programs[0]!.path:undefined;
  return{files,...(manifest?{manifest}:{}),...(program?{probe:{command:program.endsWith('.py')?process.platform==='win32'?'py':'python3':process.execPath,args:[program,'--help']}}:{})};
}
