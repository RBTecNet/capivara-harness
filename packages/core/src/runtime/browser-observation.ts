import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSER_OBSERVATION_CONTRACT={schema:'capivara/browser-interaction/1',supportedAdapters:[{runtime:'node',api:'Playwright',observation:'completed public browser launch, content navigation and DOM observation/action on the same browser/context/page'}],readinessIsNotInteraction:true,stdoutIsNotInteraction:true,unsupportedAdapter:'Recover a verification instrument; do not change the product stack or approve missing interaction.'} as const;
export interface BrowserInteractionWitness {
  source:'playwright-public-api';invocationId:string;pid:number;sequence:number;observedAt:string;
  phase:'launch'|'navigation'|'dom';status:'attempted'|'passed'|'failed';operation:string;
  browserId:string;contextId?:string;pageId?:string;url?:string;contentNavigation?:boolean;value?:string|number|boolean|null;error?:string;
}
export interface BrowserObservation {environment:Record<string,string>;diagnostics:string[];finish():Promise<BrowserInteractionWitness[]>;cleanup():Promise<void>;}
function contentURL(value:string|undefined,workspace?:string):boolean{
  try{const url=new URL(value??'');if(['http:','https:'].includes(url.protocol))return true;if(url.protocol!=='file:'||!workspace)return false;const local=relative(resolve(workspace),fileURLToPath(url));return local!==''&&local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local);}catch{return false;}
}
export function browserInteractionAttempted(witnesses:readonly BrowserInteractionWitness[]):boolean{return witnesses.some(item=>item.source==='playwright-public-api'&&(item.phase==='launch'||item.phase==='navigation'));}
export function browserInteractionsObserved(witnesses:readonly BrowserInteractionWitness[]):boolean{
  return witnesses.some(dom=>dom.source==='playwright-public-api'&&dom.phase==='dom'&&dom.status==='passed'&&dom.contextId&&dom.pageId&&witnesses.some(nav=>nav.invocationId===dom.invocationId&&nav.pid===dom.pid&&nav.browserId===dom.browserId&&nav.contextId===dom.contextId&&nav.pageId===dom.pageId&&nav.phase==='navigation'&&nav.status==='passed'&&nav.sequence<dom.sequence&&nav.contentNavigation===true&&witnesses.some(launch=>launch.invocationId===dom.invocationId&&launch.pid===dom.pid&&launch.browserId===dom.browserId&&launch.phase==='launch'&&launch.status==='passed'&&launch.sequence<nav.sequence)));
}

const preload=String.raw`'use strict';
(()=>{
  const fs=require('node:fs'),path=require('node:path'),url=require('node:url'),crypto=require('node:crypto'),Module=require('node:module');
  const config=__CAPIVARA_BROWSER_CONFIG__,output=path.join(config.directory,'browser-'+process.pid+'-'+crypto.randomUUID()+'.jsonl');
  let sequence=0;
  const append=value=>{try{fs.appendFileSync(output,JSON.stringify({nonce:config.nonce,...value})+'\n',{mode:0o600});}catch{}};
  const diagnostic=error=>append({type:'diagnostic',message:String(error).slice(0,1000)});
  const emit=(phase,status,operation,identity,detail={})=>append({type:'interaction',source:'playwright-public-api',invocationId:config.nonce,pid:process.pid,sequence:++sequence,observedAt:new Date().toISOString(),phase,status,operation,...identity,...detail});
  const patched=new WeakMap(),browsers=new WeakMap(),contexts=new WeakMap(),pages=new WeakMap(),locators=new WeakSet(),owners=new Map();
  const owner=file=>{
    if(!file||!path.isAbsolute(file))return false;
    let folder=path.dirname(file);const visited=[];
    for(;;){
      if(owners.has(folder)){const value=owners.get(folder);for(const item of visited)owners.set(item,value);return value;}
      visited.push(folder);
      try{const name=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8')).name;const value=['playwright','playwright-core','@playwright/test'].includes(name);for(const item of visited)owners.set(item,value);return value;}catch{}
      const parent=path.dirname(folder);if(parent===folder){for(const item of visited)owners.set(item,false);return false;}folder=parent;
    }
  };
  const summarize=value=>typeof value==='string'?value.slice(0,512):typeof value==='number'||typeof value==='boolean'||value===null?value:Buffer.isBuffer(value)?'binary:'+value.length:undefined;
  const wrap=(target,name,callbacks)=>{
    if(!target||typeof target[name]!=='function')return;
    const names=patched.get(target)||new Set();if(names.has(name))return;names.add(name);patched.set(target,names);
    const original=target[name];
    try{Object.defineProperty(target,name,{configurable:true,writable:true,value:function(...args){
      let state;try{state=callbacks.before?.(args,this);}catch(error){diagnostic(error);}
      const passed=value=>{try{callbacks.passed?.(value,args,this,state);}catch(error){diagnostic(error);}return value;};
      const failed=error=>{try{callbacks.failed?.(error,args,this,state);}catch(observationError){diagnostic(observationError);}throw error;};
      let value;try{value=Reflect.apply(original,this,args);}catch(error){return failed(error);}
      return value&&typeof value.then==='function'?value.then(passed,failed):passed(value);
    }});}catch(error){diagnostic(error);}
  };
  const factories=['locator','getByRole','getByText','getByLabel','getByTestId','getByPlaceholder','getByAltText','getByTitle','filter','and','or','first','last','nth','frameLocator'];
  const domMethods=['innerText','textContent','allTextContents','allInnerTexts','count','isVisible','isHidden','isEnabled','isDisabled','isChecked','isEditable','getAttribute','inputValue','boundingBox','screenshot','waitFor','waitForSelector','click','dblclick','fill','type','press','check','uncheck','selectOption','setInputFiles','tap','hover','focus','dragTo','dragAndDrop','dispatchEvent','pressSequentially','selectText','scrollIntoViewIfNeeded','title','content','$eval','$$eval','_expect'];
  const pageURL=page=>{try{return page.url();}catch{return undefined;}};
  const instrumentLocator=(locator,page)=>{
    if(!locator||typeof locator!=='object'||locators.has(locator))return locator;locators.add(locator);
    for(const name of factories)wrap(locator,name,{passed:value=>instrumentLocator(value,page)});
    for(const name of domMethods)wrap(locator,name,{passed:value=>{const identity=pages.get(page);if(identity)emit('dom','passed','locator.'+name,identity,{url:pageURL(page),...(summarize(value)!==undefined?{value:summarize(value)}:{})});}});
    return locator;
  };
  const instrumentPage=(page,context,identity)=>{
    if(!page||pages.has(page))return page;
    const parent=contexts.get(context)||{browserId:identity.browserId,contextId:crypto.randomUUID()};contexts.set(context,parent);
    const own={...parent,pageId:crypto.randomUUID()};pages.set(page,own);
    for(const name of ['goto','reload','goBack','goForward'])wrap(page,name,{
      before:args=>emit('navigation','attempted','page.'+name,own,{url:typeof args[0]==='string'?args[0]:pageURL(page)}),
      passed:()=>emit('navigation','passed','page.'+name,own,{url:pageURL(page)}),
      failed:error=>emit('navigation','failed','page.'+name,own,{url:pageURL(page),error:String(error).slice(0,1000)})});
    for(const name of factories)wrap(page,name,{passed:value=>instrumentLocator(value,page)});
    for(const name of domMethods)wrap(page,name,{passed:value=>emit('dom','passed','page.'+name,own,{url:pageURL(page),...(summarize(value)!==undefined?{value:summarize(value)}:{})})});
    return page;
  };
  const instrumentContext=(context,identity)=>{
    if(!context||contexts.has(context))return context;contexts.set(context,{browserId:identity.browserId,contextId:crypto.randomUUID()});
    wrap(context,'newPage',{passed:page=>instrumentPage(page,context,identity)});
    try{for(const page of context.pages())instrumentPage(page,context,identity);context.on('page',page=>instrumentPage(page,context,identity));}catch(error){diagnostic(error);}
    return context;
  };
  const instrumentBrowser=(browser,identity)=>{
    if(!browser||browsers.has(browser))return browser;browsers.set(browser,identity);
    wrap(browser,'newContext',{passed:context=>instrumentContext(context,identity)});
    wrap(browser,'newPage',{passed:page=>{const context=page.context();instrumentContext(context,identity);instrumentPage(page,context,identity);}});
    try{for(const context of browser.contexts())instrumentContext(context,identity);}catch(error){diagnostic(error);}
    return browser;
  };
  const instrument=(exports,file)=>{
    if(!exports||!['object','function'].includes(typeof exports)||!['chromium','firefox','webkit'].some(name=>typeof exports[name]?.launch==='function')||!owner(file))return;
    for(const name of ['chromium','firefox','webkit']){
      const type=exports[name];
      for(const method of ['launch','launchPersistentContext'])wrap(type,method,{
        before:()=>{const identity={browserId:crypto.randomUUID()};emit('launch','attempted',name+'.'+method,identity);return identity;},
        passed:(value,args,self,identity)=>{emit('launch','passed',name+'.'+method,identity);if(method==='launch')instrumentBrowser(value,identity);else{try{const browser=value.browser();if(browser)instrumentBrowser(browser,identity);}catch{}instrumentContext(value,identity);}},
        failed:(error,args,self,identity)=>emit('launch','failed',name+'.'+method,identity,{error:String(error).slice(0,1000)})});
    }
  };
  globalThis[config.key]=(value,file)=>{try{instrument(value,file);}catch(error){diagnostic(error);}};
  const original=Module._load;
  Module._load=function(specifier,parent,isMain){const value=Reflect.apply(original,this,arguments);try{instrument(value,Module._resolveFilename(specifier,parent,isMain));}catch(error){diagnostic(error);}return value;};
  try{if(typeof Module.registerHooks==='function')Module.registerHooks({load(specifier,context,nextLoad){
    const result=nextLoad(specifier,context);
    try{if(result.format==='commonjs'&&specifier.startsWith('file:')&&owner(url.fileURLToPath(specifier))&&result.source!==null&&result.source!==undefined){const source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');return{...result,source:source+'\n;globalThis['+JSON.stringify(config.key)+']?.(module.exports,'+JSON.stringify(url.fileURLToPath(specifier))+');\n'};}}catch(error){diagnostic(error);}
    return result;
  }});}catch(error){diagnostic(error);}
})();
`;

export async function startBrowserObservation(workspace:string,environment:Record<string,string>={}):Promise<BrowserObservation>{
  const diagnostics:string[]=[];let directory:string|undefined;
  try{
    const root=join(resolve(workspace),'.capivara-verification'),info=await lstat(root).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    if(info&&!info.isDirectory())throw new Error('Browser observation requires a private directory, without a symbolic link.');
    await mkdir(root,{recursive:true,mode:0o700});directory=await mkdtemp(join(root,'browser-observation-'));
    const nonce=randomUUID(),key='__capivara_browser_'+nonce.replaceAll('-',''),script=join(directory,'preload.cjs');
    await writeFile(script,preload.replace('__CAPIVARA_BROWSER_CONFIG__',JSON.stringify({directory,nonce,key})),{mode:0o600,flag:'wx'});
    const inherited=environment.NODE_OPTIONS??process.env.NODE_OPTIONS??'';
    const folder=directory;
    return{environment:{NODE_OPTIONS:`${inherited}${inherited?' ':''}--require ${JSON.stringify(script)}`},diagnostics,async finish(){
      const witnesses:BrowserInteractionWitness[]=[];
      for(const name of(await readdir(folder)).filter(name=>/^browser-\d+-[a-f0-9-]+\.jsonl$/.test(name))){
        const path=join(folder,name),info=await lstat(path);if(!info.isFile()||info.size>2*1024*1024){diagnostics.push(`Invalid bounded browser observation record: ${name}`);continue;}
        for(const line of(await readFile(path,'utf8')).split('\n').filter(Boolean)){
          let value:Record<string,unknown>;try{value=JSON.parse(line) as typeof value;}catch{diagnostics.push('Incomplete browser observation record.');continue;}
          if(value.nonce!==nonce)continue;
          if(value.type==='diagnostic'){if(typeof value.message==='string')diagnostics.push(value.message);continue;}
          if(value.type!=='interaction'||value.source!=='playwright-public-api'||value.invocationId!==nonce||value.pid!==Number(name.split('-')[1])||!Number.isInteger(value.sequence)||Number(value.sequence)<1||typeof value.observedAt!=='string'||!['launch','navigation','dom'].includes(String(value.phase))||!['attempted','passed','failed'].includes(String(value.status))||typeof value.browserId!=='string'||typeof value.operation!=='string')continue;
          if(value.phase==='navigation'&&value.status==='passed'){
            let content=typeof value.url==='string'&&contentURL(value.url,workspace);
            if(content&&String(value.url).startsWith('file:')){
              const [root,actual]=await Promise.all([realpath(resolve(workspace)),realpath(fileURLToPath(String(value.url))).catch(()=>undefined)]);
              const local=actual?relative(root,actual):'..';content=Boolean(actual&&local!==''&&local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local));
            }
            value.contentNavigation=content;
          }
          const {nonce:_nonce,type:_type,...witness}=value;witnesses.push(witness as unknown as BrowserInteractionWitness);
        }
      }
      return witnesses;
    },async cleanup(){await rm(folder,{recursive:true,force:true});}};
  }catch(error){diagnostics.push(`Browser interaction observer is unavailable: ${error instanceof Error?error.message:String(error)}`);if(directory)await rm(directory,{recursive:true,force:true}).catch(()=>{});return{environment:{},diagnostics,finish:async()=>[],cleanup:async()=>{}};}
}
