import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { digest, snapshotWorkspace, projectPath, changedPaths } from './files.js';
import type { AgentRequest, ApiProgressDiagnostics } from './types.js';

interface ProgressCheckpoint {
  schema: 1;
  scope: string;
  stateFingerprint: string;
  artifacts: string[];
  observations: string[];
  diagnostics: ApiProgressDiagnostics;
}
const STAGNANT_ACTIONS=3;
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,canonical(entry)]));
  return value;
}
function outcome(result:object):unknown{
  const volatile=new Set(['durationMs','fingerprint','pid','id','sessionId','createdAt','updatedAt','startedAt','timestamp','at']);
  return canonical(Object.fromEntries(Object.entries(result).filter(([key])=>!volatile.has(key))));
}

/** History compaction, call IDs and fresh prose are not changes in the work or in observed facts. */
export class ApiProgressGuard {
  private readonly scope:string;
  private readonly path:string;
  private readonly artifacts=new Set<string>();
  private readonly artifactBaseline=new Map<string,string>();
  private readonly seen=new Set<string>();
  private initial=new Map<string,string>();
  private currentFingerprint='';
  private persistent=true;
  private stopped=false;
  private actionLimit=1024;
  readonly diagnostics:ApiProgressDiagnostics={kind:'api-progress',stateFingerprint:'',toolRounds:0,toolActions:0,informationalObservations:0,mutations:0,stagnantActions:0};
  constructor(private readonly request:AgentRequest){
    this.scope=digest(JSON.stringify({role:request.role,instruction:request.instruction,provider:request.config.provider,model:request.config.model,readOnly:request.readOnly===true,operationKey:request.operationKey}));
    this.path=join(request.workspace,'.capivara-next','api-progress',`${this.scope}.json`);
  }
  private async artifact(path:string):Promise<string>{
    try{const absolute=await projectPath(this.request.workspace,path);const info=await stat(absolute);return info.isFile()?digest(JSON.stringify({mode:info.mode&0o777,content:digest(await readFile(absolute))})):'directory';}
    catch{return 'missing-or-unavailable';}
  }
  private async state():Promise<{fingerprint:string;files:Map<string,string>}>{
    const files=await snapshotWorkspace(this.request.workspace);
    for(const [path,content] of files){const mode=await stat(join(this.request.workspace,path)).then(info=>info.mode&0o777).catch(()=>null);files.set(path,digest(JSON.stringify({content,mode})));}
    const outputs:Record<string,string>={};for(const path of [...this.artifacts].sort())outputs[path]=await this.artifact(path);
    const fingerprint=digest(JSON.stringify(canonical({files:[...files].sort(([a],[b])=>a.localeCompare(b)),outputs,environment:{...this.request.config.environment,...this.request.environment}})));
    return{fingerprint,files};
  }
  async start():Promise<boolean>{
    let previous:ProgressCheckpoint|undefined;
    try{const value=JSON.parse(await readFile(this.path,'utf8')) as ProgressCheckpoint;if(value.schema===1&&value.scope===this.scope){previous=value;for(const path of value.artifacts??[])this.artifacts.add(path);}}catch{/* A missing or damaged auxiliary checkpoint cannot erase product files. */}
    const state=await this.state();this.initial=state.files;this.currentFingerprint=state.fingerprint;this.diagnostics.stateFingerprint=state.fingerprint;
    for(const path of this.artifacts)this.artifactBaseline.set(path,await this.artifact(path));
    if(previous?.stateFingerprint===state.fingerprint&&previous.diagnostics.stoppedBecause){
      Object.assign(this.diagnostics,previous.diagnostics,{replayedStop:true});this.stopped=true;return false;
    }
    await this.persist();return true;
  }
  async before(name:string,input:unknown):Promise<string>{
    if(['write_file','edit_file'].includes(name)&&input&&typeof input==='object'&&'path' in input&&typeof input.path==='string'){
      this.artifacts.add(input.path);if(!this.artifactBaseline.has(input.path))this.artifactBaseline.set(input.path,await this.artifact(input.path));
    }
    const state=await this.state();
    if(state.fingerprint!==this.currentFingerprint){this.seen.clear();this.diagnostics.stagnantActions=0;this.currentFingerprint=state.fingerprint;}
    return state.fingerprint;
  }
  async observe(before:string,name:string,input:unknown,result:object,valid:boolean):Promise<{stop:boolean;changedFiles:string[]}>{
    this.diagnostics.toolActions++;
    const state=await this.state();
    const changed=state.fingerprint!==before;
    if(changed){this.seen.clear();this.diagnostics.mutations++;this.diagnostics.stagnantActions=0;}
    const signature=digest(JSON.stringify(canonical({name,input,result:outcome(result)})));
    if(changed||valid&&!this.seen.has(signature)){
      if(!changed)this.diagnostics.informationalObservations++;
      this.diagnostics.stagnantActions=0;
    }else this.diagnostics.stagnantActions++;
    this.seen.add(signature);this.currentFingerprint=state.fingerprint;this.diagnostics.stateFingerprint=state.fingerprint;
    if(this.diagnostics.toolActions>=this.actionLimit){this.diagnostics.stoppedBecause='round-limit';this.stopped=true;}
    if(this.diagnostics.stagnantActions>=STAGNANT_ACTIONS){this.diagnostics.stoppedBecause='no-progress';this.diagnostics.repeatedAction=`${name}:${signature.slice(0,16)}`;this.stopped=true;}
    const changedFiles=new Set(changedPaths(this.initial,state.files));
    for(const path of this.artifacts)if(this.artifactBaseline.get(path)!==await this.artifact(path))changedFiles.add(path);
    await this.persist();return{stop:this.stopped,changedFiles:[...changedFiles].sort()};
  }
  async beginRound(maximum:number):Promise<boolean>{
    this.actionLimit=maximum*16;
    if(this.diagnostics.toolRounds>=maximum){this.diagnostics.stoppedBecause='round-limit';this.stopped=true;await this.persist();return false;}
    this.diagnostics.toolRounds++;return true;
  }
  async finish():Promise<void>{await this.persist();}
  private async persist():Promise<void>{
    const checkpoint:ProgressCheckpoint={schema:1,scope:this.scope,stateFingerprint:this.currentFingerprint,artifacts:[...this.artifacts].sort(),observations:[...this.seen].slice(-1024),diagnostics:{...this.diagnostics,persistence:this.persistent?'written':'unavailable'}};
    try{await mkdir(dirname(this.path),{recursive:true,mode:0o700});const temporary=`${this.path}.tmp`;await writeFile(temporary,JSON.stringify(checkpoint),{mode:0o600});await rename(temporary,this.path);this.diagnostics.persistence='written';}
    catch{this.persistent=false;this.diagnostics.persistence='unavailable';}
  }
}
