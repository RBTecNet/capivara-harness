import { cp, link, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Verification } from '../domain/types.js';
import { applyOperationalEnvironment, type OperationalEnvironment } from '../execution/environment.js';
import { invocationArguments } from '../execution/conformance.js';
import type { CommandRequest, CommandResult } from './types.js';
import { executeCommand } from './command.js';

export interface BrowserResourceOptions { resourceRoot:string; caches?:string[]; signal?:AbortSignal; execute?:(request:CommandRequest)=>Promise<CommandResult>; }
export interface BrowserInvocation {
  command:string; args:string[]; cwd:string;
  audit:{original:{command?:string;args?:string[];cwd?:string};removedPreparations:{command:string;args:string[];cwd:string}[];reason:string};
}
export interface BrowserResourceResult { invocation?:BrowserInvocation; applicable:boolean; environment:Record<string,string>; ready:boolean; changed:boolean; details:string; identity:string; inputs?:string[]; fingerprint?:string; executable?:string; }
interface RawInvocation { command:string;args:string[];cwd:string; }
interface Tool { root:string; packageJson:string; cli:string; args:string[]; cwd:string; normalized?:boolean; preparations?:RawInvocation[]; definitions?:string[]; }
interface Target { browser:string; channel?:string; executablePath?:string; args?:string[]; }
interface Discovery { packageVersion:string; coreVersion:string; catalogue:{name:string;revision:string;revisionOverrides?:Record<string,string>}[]; targets:Target[]; executables:string[]; inputs?:string[]; }
const flights=new Map<string,Promise<BrowserResourceResult>>();
const hash=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const inside=(root:string,path:string):boolean=>{const value=relative(resolve(root),resolve(path));return value!== '..'&&!value.startsWith(`..${sep}`)&&!isAbsolute(value);};
const packageNames=new Set(['playwright','@playwright/test','playwright-core']);
async function json(path:string):Promise<Record<string,unknown>|undefined>{try{return JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;}catch{return undefined;}}
async function locateExecutable(command:string,cwd:string,environment:Record<string,string>):Promise<string|undefined>{
  if(isAbsolute(command)||command.includes('/')||command.includes('\\')){const path=resolve(cwd,command);return (await stat(path).catch(()=>null))?.isFile()?path:undefined;}
  let folder=resolve(cwd);
  for(;;){for(const suffix of process.platform==='win32'?['','.cmd','.exe']:['']){const path=join(folder,'node_modules','.bin',command+suffix);if((await stat(path).catch(()=>null))?.isFile())return path;}const parent=dirname(folder);if(parent===folder)break;folder=parent;}
  for(const folder of (environment.PATH??process.env.PATH??'').split(delimiter)){const path=join(folder,command);if((await stat(path).catch(()=>null))?.isFile())return path;}
  return undefined;
}
async function owner(cli:string):Promise<{root:string;packageJson:string;cli:string}|undefined>{
  const actual=await realpath(cli).catch(()=>cli);let folder=dirname(actual);
  for(;;){const file=join(folder,'package.json'),pkg=await json(file);
    if(pkg&&typeof pkg.name==='string'&&packageNames.has(pkg.name)){
      const bins=typeof pkg.bin==='string'?[pkg.bin]:pkg.bin&&typeof pkg.bin==='object'?Object.values(pkg.bin as Record<string,unknown>).filter((value):value is string=>typeof value==='string'):[];
      if(bins.some(bin=>resolve(folder,bin)===actual))return{root:folder,packageJson:file,cli:actual};
    }
    const parent=dirname(folder);if(parent===folder)break;folder=parent;
  }
  return undefined;
}
/** This is an allowlist of conjunctions, not a general shell interpreter. */
function conjunctions(value:string):string[]|undefined{
  const commands:string[]=[];let start=0,quote:string|undefined,escaped=false;
  for(let index=0;index<value.length;index++){
    const character=value[index]!;
    if(escaped){escaped=false;continue;}
    if(character==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(character===quote)quote=undefined;continue;}
    if(character==='"'||character==="'"){quote=character;continue;}
    if(character==='&'&&value[index+1]==='&'){commands.push(value.slice(start,index).trim());start=index+2;index++;continue;}
    if(/[;&|<>`\n\r]/.test(character))return undefined;
  }
  if(quote||escaped)return undefined;
  commands.push(value.slice(start).trim());return commands.every(Boolean)?commands:undefined;
}
/** Expand actual simple wrappers and manager scripts. A bootstrap may be removed
 * only when every prefix is the same concrete Playwright CLI installing browsers. */
async function selectedTool(workspace:string,check:Verification,environment:Record<string,string>,nodeBinary:string):Promise<Tool|undefined>{
  const cwd=resolve(workspace,check.cwd??'.');if(!inside(workspace,cwd))return undefined;
  const visit=async(argv:string[],directory:string,ancestors:Set<string>,depth:number):Promise<Tool|undefined>=>{
    if(!argv.length||depth>12)return undefined;
    const signature=JSON.stringify({directory,argv});if(ancestors.has(signature))return undefined;
    const seen=new Set(ancestors);seen.add(signature);
    const body=async(program:string,location:string):Promise<Tool|undefined>=>{
      const commands=conjunctions(program);if(!commands)return undefined;
      const parsed=commands.map(command=>invocationArguments(command));if(parsed.some(command=>!command))return undefined;
      if(commands.length===1)return visit(parsed[0]!,location,seen,depth+1);
      const tools=await Promise.all(parsed.map(command=>visit(command!,location,seen,depth+1)));
      const last=tools.at(-1);if(!last||!['test','screenshot','pdf','open','codegen'].includes(last.args[0]??''))return undefined;
      if(!tools.slice(0,-1).every(tool=>tool&&tool.cli===last.cli&&tool.args[0]==='install'))return undefined;
      return{...last,normalized:true,definitions:[...new Set(tools.flatMap(tool=>tool?.definitions??[]))],preparations:[...tools.slice(0,-1).flatMap((tool,index)=>[...tool?.preparations??[],{command:parsed[index]![0]!,args:parsed[index]!.slice(1),cwd:location}]),...last.preparations??[]]};
    };
    const name=basename(argv[0]!).replace(/\.(?:cmd|exe)$/i,'');
    if(['sh','bash','dash','zsh'].includes(name)&&argv.length===3&&['-c','-lc','-cl'].includes(argv[1]!)){
      const tool=await body(argv[2]!,directory);return tool?{...tool,normalized:true}:undefined;
    }
    if(['npm','pnpm','yarn','bun'].includes(name)){
      const args=argv.slice(1).filter(value=>!['--silent','-s'].includes(value));
      if(args[0]==='exec'||args[0]==='x')return visit(args.slice(1).filter((value,index)=>index!==0||value!=='--'),directory,seen,depth+1);
      const run=args[0]==='run'||args[0]==='run-script';const script=run?args[1]:name==='yarn'?args[0]:undefined;
      if(script){let location=directory,pkg:Record<string,unknown>|undefined;for(;;){pkg=await json(join(location,'package.json'));if(pkg)break;const parent=dirname(location);if(parent===location)break;location=parent;}
        const scripts=pkg?.scripts as Record<string,unknown>|undefined,program=scripts?.[script];if(typeof program!=='string')return undefined;
        const extra=args.slice(run?2:1);if(extra[0]==='--')extra.shift();
        const tool=await body(program,location);if(!tool)return undefined;
        return{...tool,args:[...tool.args,...extra],definitions:[...new Set([join(location,'package.json'),...tool.definitions??[]])]};
      }
    }
    if(['npx','pnpx','bunx'].includes(name)){const args=argv.slice(1);while(args[0]&&['--','--yes','-y','--no-install','--no'].includes(args[0]))args.shift();return visit(args,directory,seen,depth+1);}
    const executable=await locateExecutable(argv[0]!,directory,environment);
    if(executable){const tool=await owner(executable);if(tool)return{...tool,args:argv.slice(1),cwd:directory};}
    if(argv[1]&&executable&&await realpath(executable).catch(()=>executable)===await realpath(nodeBinary).catch(()=>nodeBinary)){const tool=await owner(resolve(directory,argv[1]));if(tool)return{...tool,args:argv.slice(2),cwd:directory};}
    return undefined;
  };
  const argv=check.command?(check.args?[check.command,...check.args]:invocationArguments(check.command)):null;
  return argv?visit(argv,cwd,new Set(),0):undefined;
}
const providerProgram=String.raw`
const {createRequire}=require('node:module'),fs=require('node:fs'),path=require('node:path');
const input=JSON.parse(process.argv[1]),req=createRequire(input.packageJson),pkg=req(input.packageJson);
(async()=>{
  const api=req(path.dirname(input.packageJson));
  let coreFile;try{coreFile=req.resolve('playwright-core/package.json')}catch{coreFile=input.packageJson}
  const core=JSON.parse(fs.readFileSync(coreFile,'utf8'));
  const catalogue=JSON.parse(fs.readFileSync(path.join(path.dirname(coreFile),'browsers.json'),'utf8')).browsers;
  if(input.action==='discover'){
    const values=input.args,option=name=>{const index=values.indexOf(name);return index>=0?values[index+1]:values.find(value=>value.startsWith(name+'='))?.slice(name.length+1)};
    const explicit=option('--browser');let targets,configFile;const sourceInputs=new Set();
    if(explicit)targets=(explicit==='all'?['chromium','firefox','webkit']:explicit.split(',')).map(browser=>({browser}));
    if(values[0]==='test'){
      let loader;for(const name of ['playwright/lib/common','playwright/lib/common/configLoader']){try{const mod=req(name);loader=mod.configLoader||mod;if(typeof loader.loadConfigFromFile==='function')break;}catch{}}
      if(loader&&typeof loader.loadConfigFromFile==='function'){
        const loaded=await loader.loadConfigFromFile(option('--config')||option('-c'),undefined,values.includes('--no-deps'));configFile=loaded.config?.configFile||loaded.configFile;
        if(typeof configFile==='string')sourceInputs.add(configFile);
        const patterns=values.flatMap((value,index)=>value==='--project'?[values[index+1]]:value.startsWith('--project=')?[value.slice(10)]:[]).filter(Boolean);
        const projects=loaded.projects||loaded.config?.projects||[];
        let projectUtils;for(const name of ['playwright/lib/runner','playwright/lib/runner/projectUtils']){try{const mod=req(name),candidate=mod.projectUtils||mod;if(typeof candidate.collectFilesForProject==='function'){projectUtils=candidate;break;}}catch{}}
        if(!projectUtils)throw Error('The installed Playwright configuration exposes projects but not its non-executing test-source collector. Declare an explicit compatible source-discovery instrument; opaque configured tests cannot produce reusable proofs.');
        if(patterns.length&&typeof projectUtils.filterProjects!=='function')throw Error('The installed Playwright does not expose its configured project-selection protocol. Project filters cannot be guessed.');
        const selected=typeof projectUtils.filterProjects==='function'?projectUtils.filterProjects(projects,patterns.length?patterns:undefined):projects.filter(project=>project.default!==false);
        const closure=typeof projectUtils.buildProjectsClosure==='function'?[...projectUtils.buildProjectsClosure(selected).keys()]:(()=>{const result=new Set(),visit=project=>{if(result.has(project))return;result.add(project);if(!values.includes('--no-deps')){for(const dependency of project.deps||[])visit(dependency);if(project.teardown)visit(project.teardown);}};for(const project of selected)visit(project);return[...result];})();
        for(const project of closure){
          if(typeof project.project?.testDir!=='string')throw Error('The installed Playwright project has no concrete resolved testDir/source-discovery contract.');
          if(project.respectGitIgnore)sourceInputs.add(path.join(project.project.testDir,'.gitignore'));
          // This is Playwright's own filesystem collector. It applies its real
          // testMatch/testIgnore RegExp/glob and gitignore rules without loading
          // or running test modules. grep filters titles only after those files
          // are loaded, so every configured matching source is a proof input.
          const files=await projectUtils.collectFilesForProject(project);
          if(!Array.isArray(files)||files.some(file=>typeof file!=='string'))throw Error('The installed Playwright returned an opaque configured test-source set.');
          for(const file of files){const absolute=path.resolve(file),relative=path.relative(input.workspace,absolute);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('A selected test source lies outside the isolated workspace and cannot be tracked by this proof: '+file);sourceInputs.add(absolute);if(project.respectGitIgnore){for(let directory=path.dirname(absolute);;directory=path.dirname(directory)){sourceInputs.add(path.join(directory,'.gitignore'));if(directory===path.resolve(project.project.testDir)||path.dirname(directory)===directory)break;}}}
        }
        if(!targets)targets=closure.map(value=>value.project||value).map(project=>{const use=project.use||{},launch=use.launchOptions||{};return{browser:use.browserName||'chromium',...(use.channel?{channel:use.channel}:{}),...(launch.executablePath?{executablePath:launch.executablePath}:{}),...(launch.args?{args:launch.args}:{})}});
      }else{
        const configured=option('--config')||option('-c')||fs.readdirSync(process.cwd()).some(name=>/^playwright\.config\.[cm]?[jt]s$/.test(name));
        if(configured)throw Error('The installed Playwright does not expose a configuration loader for its declared browser selection.');
      }
    }
    targets=targets||[{browser:'chromium'}];targets=[...new Map(targets.map(target=>[JSON.stringify(target),target])).values()];if(!targets.length)throw Error('No configured browser project matches the selected invocation.');
    for(const target of targets)if(!api[target.browser]||typeof api[target.browser].launch!=='function')throw Error('The selected browser has no concrete Playwright browser API.');
    process.stdout.write('\nCAPIVARA_BROWSER_RESULT='+JSON.stringify({packageVersion:pkg.version,coreVersion:core.version,catalogue,targets,inputs:[...sourceInputs].sort(),executables:targets.map(target=>target.executablePath||api[target.browser].executablePath())})+'\n');
  }else{
    const executables=[],versions=[];
    for(const target of input.targets){const browser=await api[target.browser].launch({headless:true,...(target.channel?{channel:target.channel}:{}),...(target.executablePath?{executablePath:target.executablePath}:{}),...(target.args?{args:target.args}:{})});versions.push({browser:target.browser,channel:target.channel||null,version:typeof browser.version==='function'?await browser.version():null});const executable=target.executablePath||(!target.channel?api[target.browser].executablePath():null);if(executable&&fs.existsSync(executable))executables.push(executable);await browser.close();}
    process.stdout.write('\nCAPIVARA_BROWSER_RESULT='+JSON.stringify({ready:true,executables,versions})+'\n');
  }
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exitCode=1});
`;
function resultValue(result:CommandResult):Record<string,unknown>|undefined{if(result.exitCode!==0||result.cancelled||result.timedOut||result.issue)return undefined;const line=result.stdout.split('\n').findLast(line=>line.startsWith('CAPIVARA_BROWSER_RESULT='));try{return line?JSON.parse(line.slice('CAPIVARA_BROWSER_RESULT='.length)) as Record<string,unknown>:undefined;}catch{return undefined;}}
async function acquire(path:string,signal?:AbortSignal):Promise<()=>Promise<void>>{
  const start=Date.now(),token=randomUUID(),owner=join(dirname(path),`lock-owner-${token}.json`);
  // Publish a complete owner record atomically. A crash can leave an owned lock,
  // never a lock directory with no PID that future processes cannot recover.
  await writeFile(owner,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
  const dead=(value:Record<string,unknown>):boolean=>{try{process.kill(value.pid as number,0);return false;}catch(error){return(error as NodeJS.ErrnoException).code==='ESRCH';}};
  const reclaim=async(lock:string,previous:Record<string,unknown>):Promise<boolean>=>{
    if(typeof previous.token!=='string')throw new Error('A stale browser resource lock has no ownership token.');
    const claim=join(dirname(path),`reclaim-${hash({lock,token:previous.token})}.lock`);
    try{await link(owner,claim);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const holder=await json(claim);if(holder&&typeof holder.pid==='number'&&dead(holder))await reclaim(claim,holder);
      return false;
    }
    try{
      const current=await json(lock);
      // Only one reclaimer for this exact old token may remove it. A process
      // acquiring a newer lock cannot be unlinked by a second stale observer.
      if(current?.token===previous.token&&typeof current.pid==='number'&&dead(current)){await unlink(lock).catch(()=>undefined);return true;}
      return false;
    }finally{const holder=await json(claim);if(holder?.token===token)await unlink(claim).catch(()=>undefined);}
  };
  try{
    for(;;){
      signal?.throwIfAborted();
      try{
        await link(owner,path);
        return async()=>{const current=await json(path);if(current?.token===token)await unlink(path).catch(()=>undefined);};
      }catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      const info=await json(path);
      if(typeof info?.pid!=='number')throw new Error('The browser resource lock has no valid atomic ownership record; its corrupt entry must be preserved and reconciled before publication.');
      if(dead(info)&&await reclaim(path,info))continue;
      if(Date.now()-start>180000)throw new Error('A live browser-provider preparation still owns the shared resource lock.');
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(done,100);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason??new Error('Browser preparation cancelled.'));}signal?.addEventListener('abort',abort,{once:true});});
    }
  }finally{await unlink(owner).catch(()=>undefined);}
}
/** Shared immutable provider generations. Product copies use the returned absolute
 * cache path unchanged; it must never be relocated into another verification area. */
export async function prepareBrowserResources(workspace:string,check:Verification,operational:OperationalEnvironment,options:BrowserResourceOptions):Promise<BrowserResourceResult>{
  const bound=applyOperationalEnvironment({cwd:workspace,command:['node']},operational);
  const node=typeof bound.command==='string'?[bound.command]:[...bound.command];
  if(node[0]==='node')node[0]=await locateExecutable('node',workspace,operational.env)??'node';
  const tool=await selectedTool(workspace,check,operational.env,node[0]!);
  if(!tool||!['test','screenshot','pdf','open','codegen'].includes(tool.args[0]??''))return{applicable:false,environment:{},ready:true,changed:false,details:'The actual invocation is not a browser-consuming Playwright command.',identity:''};
  const execute=options.execute??executeCommand;
  const run=async(action:string,cache:string,targets?:Target[]):Promise<CommandResult>=>execute({cwd:tool.cwd,command:[...node,'-e',providerProgram,JSON.stringify({action,workspace:resolve(workspace),packageJson:tool.packageJson,args:tool.args,...(targets?{targets}:{})})],environment:{...operational.env,PLAYWRIGHT_BROWSERS_PATH:cache},timeoutMs:action==='discover'?15000:30000,inputs:[],...(options.signal?{signal:options.signal}:{})});
  const discoveryResult=await run('discover',join(resolve(options.resourceRoot),'.discovery'));
  const discovery=resultValue(discoveryResult) as Discovery|undefined;
  if(!discovery||!Array.isArray(discovery.targets)||!Array.isArray(discovery.catalogue))return{applicable:true,environment:{},ready:false,changed:false,details:`The concrete browser requirement could not be discovered.\n${discoveryResult.stderr}`,identity:''};
  const identity=hash({packageVersion:discovery.packageVersion,coreVersion:discovery.coreVersion,catalogue:discovery.catalogue,targets:discovery.targets,platform:process.platform,arch:process.arch});
  const root=join(resolve(options.resourceRoot),'playwright',identity),key=root;
  const finish=(value:BrowserResourceResult):BrowserResourceResult=>({...value,inputs:[...new Set([...(discovery.inputs??[]),...(tool.definitions??[])])].filter(file=>inside(workspace,file)).map(file=>relative(workspace,file).replaceAll('\\','/')),...(value.ready&&tool.normalized?{invocation:{command:node[0]!,args:[...node.slice(1),inside(workspace,tool.cli)?relative(tool.cwd,tool.cli).replaceAll('\\','/'):tool.cli,...tool.args],cwd:relative(workspace,tool.cwd).replaceAll('\\','/')||'.',audit:{original:{...(check.command?{command:check.command}:{}),...(check.args?{args:[...check.args]}:{}),...(check.cwd?{cwd:check.cwd}:{})},removedPreparations:(tool.preparations??[]).map(item=>({...item,cwd:relative(workspace,item.cwd).replaceAll('\\','/')||'.'})),reason:'Unwrapped a transparent known-tool shell/manager invocation. Browser-only installation prefixes are now owned by the prepared shared capability; the same concrete test CLI and arguments prove product behavior.'}}}:{})});
  const existing=flights.get(key);if(existing)return finish(await existing);
  const flight=(async():Promise<BrowserResourceResult>=>{
    await mkdir(root,{recursive:true});const release=await acquire(join(root,'preparation.lock'),options.signal);
    try{
      const ready=async(cache:string):Promise<{ready:boolean;executable?:string;fingerprint?:string;details:string}>=>{
        const result=await run('ready',cache,discovery.targets),value=resultValue(result);
        const executables=Array.isArray(value?.executables)?value.executables.filter((item):item is string=>typeof item==='string'):[];
        const files=await Promise.all(executables.map(async path=>{const info=await stat(path).catch(()=>null);return info?.isFile()?{path:path.replaceAll(cache,'$BROWSER_CACHE'),mode:info.mode&0o777,size:info.size,modified:info.mtimeMs,changed:info.ctimeMs}:null;}));
        return{ready:value?.ready===true,...(executables[0]?{executable:executables[0]}:{}),...(value?.ready===true?{fingerprint:hash({identity,versions:value.versions,files})}:{}),details:result.stderr||result.stdout};
      };
      const current=await json(join(root,'current.json'));
      if(typeof current?.directory==='string'&&inside(join(root,'generations'),current.directory)){
        const test=await ready(current.directory);if(test.ready)return{applicable:true,ready:true,changed:false,environment:{PLAYWRIGHT_BROWSERS_PATH:current.directory},details:'A current immutable browser resource passed a real headless launch.',identity,...(test.fingerprint?{fingerprint:test.fingerprint}:{}),...(test.executable?{executable:test.executable}:{})};
      }
      const attempt=await json(join(root,'attempt.json'));
      const previousDirectory=typeof attempt?.directory==='string'&&inside(join(root,'generations'),attempt.directory)&&attempt.directory!==current?.directory?attempt.directory:undefined;
      const generation=previousDirectory??join(root,'generations',randomUUID(),'browsers');await mkdir(generation,{recursive:true});
      const installInputs=hash({node,environment:Object.fromEntries(Object.entries(operational.env).filter(([key])=>!['PATH','PLAYWRIGHT_BROWSERS_PATH','TMPDIR','TMP','TEMP','XDG_CACHE_HOME','npm_config_cache','PIP_CACHE_DIR','GOCACHE','GRADLE_USER_HOME','DOTNET_CLI_HOME'].includes(key)).map(([key,value])=>[key,value.replaceAll(resolve(workspace),'$WORKSPACE')]))});
      const attemptedInstall=Boolean(previousDirectory&&attempt?.installationAttempted===true&&attempt.status==='complete'&&attempt.installInputs===installInputs);
      const required=new Set(discovery.targets.map(target=>target.browser));if(required.has('chromium'))required.add('chromium-headless-shell');required.add('ffmpeg');
      const directories=new Set(discovery.catalogue.filter(item=>required.has(item.name)).flatMap(item=>[item.revision,...Object.values(item.revisionOverrides??{})].map(revision=>`${item.name.replaceAll('-','_')}-${revision}`)));
      let adopted=false;
      for(const cache of [...new Set(options.caches??[])]){
        if(resolve(cache)===generation||!(await stat(cache).catch(()=>null))?.isDirectory())continue;
        // Prefer a cache whose exact selected provider already launches. A corrupt
        // earlier candidate must not hide a usable later cache or force a download.
        const usable=await ready(cache);if(!usable.ready)continue;
        for(const name of await readdir(cache).catch(()=>[]))if(directories.has(name)){
          const destination=join(generation,name);
          await cp(join(cache,name),destination,{recursive:true,dereference:true,mode:constants.COPYFILE_FICLONE});adopted=true;
        }
        break;
      }
      let test=await ready(generation);
      if(!test.ready){
        if(discovery.targets.some(target=>target.channel||target.executablePath))return{applicable:true,ready:false,changed:adopted,environment:{PLAYWRIGHT_BROWSERS_PATH:generation},identity,details:`The explicitly configured browser/channel failed headless readiness; installing another browser would not satisfy it.\n${test.details}`};
        if(attemptedInstall)return{applicable:true,ready:false,changed:adopted,environment:{PLAYWRIGHT_BROWSERS_PATH:generation},identity,details:`This exact browser installation already failed to provide headless readiness. The existing resource was revalidated; repeating its unchanged installer cannot repair host dependencies or a failed provider. Change the concrete environment/provider or supply a usable cache.\n${test.details}`};
        const recordAttempt=async(status:'running'|'complete'|'interrupted'):Promise<void>=>{const pending=join(root,`attempt-${randomUUID()}.json`);await writeFile(pending,JSON.stringify({directory:generation,identity,installationAttempted:true,installInputs,status,pid:process.pid}));await rename(pending,join(root,'attempt.json'));};
        await recordAttempt('running');
        let install:CommandResult;
        try{install=await execute({cwd:tool.cwd,command:[...node,tool.cli,'install',...[...new Set(discovery.targets.map(target=>target.browser))]],environment:{...operational.env,PLAYWRIGHT_BROWSERS_PATH:generation},timeoutMs:180000,inputs:[],...(options.signal?{signal:options.signal}:{})});}
        catch(error){await recordAttempt('interrupted');throw error;}
        // Cancellation, timeout and a process that never produced an exit status
        // leave an incomplete operation, not a conclusive ineffective installation.
        await recordAttempt(install.cancelled||install.timedOut||install.exitCode===null?'interrupted':'complete');
        if(install.exitCode!==0||install.issue||install.cancelled||install.timedOut)return{applicable:true,ready:false,changed:adopted,environment:{PLAYWRIGHT_BROWSERS_PATH:generation},identity,details:`The selected local Playwright CLI could not prepare its own browser resource.\n${install.stderr}\n${install.stdout}`};
        test=await ready(generation);
      }
      if(!test.ready)return{applicable:true,ready:false,changed:adopted,environment:{PLAYWRIGHT_BROWSERS_PATH:generation},identity,details:`The browser resource remains unusable after preparation; this is an environment capability failure.\n${test.details}`};
      const pointer=join(root,`current-${randomUUID()}.json`);await writeFile(pointer,JSON.stringify({directory:generation,identity}));await rename(pointer,join(root,'current.json'));
      return{applicable:true,ready:true,changed:true,environment:{PLAYWRIGHT_BROWSERS_PATH:generation},identity,details:adopted?'Adopted existing browser binaries and proved a real headless launch; no download was required.':'Prepared the selected browser once and proved a real headless launch.',...(test.fingerprint?{fingerprint:test.fingerprint}:{}),...(test.executable?{executable:test.executable}:{})};
    }finally{await release();}
  })().catch((error:unknown):BrowserResourceResult=>({applicable:true,ready:false,changed:false,environment:{},identity,details:`Browser resource coordination failed: ${error instanceof Error?error.message:String(error)}`}));
  flights.set(key,flight);try{return finish(await flight);}finally{if(flights.get(key)===flight)flights.delete(key);}
}
