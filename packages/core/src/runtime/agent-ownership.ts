import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

interface OwnedProcess {pid:number;startTicks:string;parent:number;group:number;session:number;cwd:string;state:string;}
interface OwnershipRecord {schema:'capivara/agent-ownership/1';id:string;invocationId?:string;provider:string;workspace:string;operationKey?:string;role?:string;sessionId?:string;startedAt:string;status:'running'|'closed'|'cleanup-pending';processes:OwnedProcess[];remaining:OwnedProcess[];diagnostics:string[];}
export interface CliOwnershipCleanup {id:string;matched:number;remaining:OwnedProcess[];diagnostics:string[];}
export interface CliProcessOwnership {id:string;environment:Record<string,string>;setSession(sessionId:string):void;cleanup():Promise<CliOwnershipCleanup>;}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const inside=(base:string,path:string):boolean=>{const local=relative(base,path);return local===''||local!=='..'&&!local.startsWith('..'+sep)&&!isAbsolute(local);};
async function processState(pid:number):Promise<{pid:number;startTicks:string;parent:number;group:number;session:number;state:string}|undefined>{
  try{const raw=await readFile(`/proc/${pid}/stat`,'utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');if(!fields[19])return undefined;return{pid,state:fields[0]!,parent:Number(fields[1]),group:Number(fields[2]),session:Number(fields[3]),startTicks:fields[19]};}catch{return undefined;}
}

/** Linux CLI tools may be spawned by a persistent external server. A process
 * group or cwd alone is not ownership. Only this invocation's marker, or its
 * observed provider session, together with UID/cwd/start-time can authorize a
 * targeted signal. Existing processes without this record are never adopted. */
export async function createCliProcessOwnership(options:{workspace:string;provider:string;invocationId?:string;operationKey?:string;role?:string}):Promise<CliProcessOwnership>{
  const workspace=await realpath(resolve(options.workspace));
  const record:OwnershipRecord={schema:'capivara/agent-ownership/1',id:options.invocationId&&uuid.test(options.invocationId)?options.invocationId:randomUUID(),...(options.invocationId?{invocationId:options.invocationId}:{}),provider:options.provider,workspace,...(options.operationKey?{operationKey:options.operationKey}:{}),...(options.role?{role:options.role}:{}),startedAt:new Date().toISOString(),status:'running',processes:[],remaining:[],diagnostics:[]};
  let directory:string|undefined,queue=Promise.resolve();
  try{
    let current=workspace;
    for(const component of ['.capivara-runtime','agent-ownership']){
      current=join(current,component);const info=await lstat(current).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
      if(info&&!info.isDirectory())throw new Error('Process ownership ledger requires an actual private directory.');
      await mkdir(current,{recursive:true,mode:0o700});
      if(!inside(workspace,await realpath(current)))throw new Error('Process ownership ledger cannot escape its workspace.');
    }
    directory=current;
    if(await lstat(join(directory,`${record.id}.json`)).catch(()=>null))record.id=randomUUID();
  }catch(error){record.diagnostics.push(`Ownership persistence unavailable: ${error instanceof Error?error.message:String(error)}`);}
  const persist=():void=>{
    if(!directory)return;
    const snapshot=JSON.stringify(record,null,2),folder=directory;
    queue=queue.then(async()=>{const temporary=join(folder,`${record.id}.${randomUUID()}.tmp`);await writeFile(temporary,snapshot,{mode:0o600,flag:'wx'});await rename(temporary,join(folder,`${record.id}.json`));}).catch(error=>{record.diagnostics.push(`Ownership record could not be persisted: ${error instanceof Error?error.message:String(error)}`);});
  };
  persist();await queue;
  const identify=async(pid:number):Promise<OwnedProcess|undefined>=>{
    if(pid===process.pid)return undefined;
    const before=await processState(pid);if(!before||before.state==='Z')return undefined;
    try{
      if((await stat(`/proc/${pid}`)).uid!==process.getuid?.())return undefined;
      const variables=(await readFile(`/proc/${pid}/environ`)).toString().split('\0');
      const marker=variables.includes(`CAPIVARA_INVOCATION_ID=${record.id}`);
      const session=record.provider==='codex'&&record.sessionId&&variables.some(value=>value===`CODEX_SESSION_ID=${record.sessionId}`||value===`CODEX_THREAD_ID=${record.sessionId}`);
      if(!marker&&!session)return undefined;
      const cwd=await realpath(`/proc/${pid}/cwd`);if(!inside(workspace,cwd))return undefined;
      const after=await processState(pid);if(!after||after.startTicks!==before.startTicks||after.state==='Z')return undefined;
      return{...after,cwd};
    }catch{return undefined;}
  };
  let cleaning:Promise<CliOwnershipCleanup>|undefined;
  return{id:record.id,environment:{CAPIVARA_INVOCATION_ID:record.id},setSession(sessionId){
    if(record.provider!=='codex'||!uuid.test(sessionId))return;
    if(record.sessionId&&record.sessionId!==sessionId){record.diagnostics.push('The provider emitted conflicting session identifiers; no additional session was adopted.');return;}
    if(record.sessionId===sessionId)return;
    record.sessionId=sessionId;persist();
  },cleanup(){
    if(cleaning)return cleaning;
    cleaning=(async()=>{
    await queue;
    if(process.platform!=='linux'){
      record.status='cleanup-pending';record.diagnostics.push('External CLI process ownership scanning is available only through the Linux proc adapter. Managed process-group cleanup remains active.');persist();await queue;
      return{id:record.id,matched:0,remaining:[],diagnostics:[...record.diagnostics]};
    }
    const known=new Map<string,OwnedProcess>();
    const scan=async():Promise<OwnedProcess[]>=>{
      const ids=(await readdir('/proc')).filter(name=>/^\d+$/.test(name));const matches:OwnedProcess[]=[];
      for(let index=0;index<ids.length;index+=16){for(const entry of await Promise.all(ids.slice(index,index+16).map(id=>identify(Number(id)))))if(entry){matches.push(entry);known.set(`${entry.pid}:${entry.startTicks}`,entry);}}
      return matches;
    };
    const signal=async(entry:OwnedProcess,value:NodeJS.Signals):Promise<void>=>{
      const current=await identify(entry.pid);if(!current||current.startTicks!==entry.startTicks)return;
      try{process.kill(entry.pid,value);}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')record.diagnostics.push(`Could not signal owned process ${entry.pid}: ${error instanceof Error?error.message:String(error)}`);}
    };
    try{
      const first=await scan();record.processes=[...known.values()];persist();await queue;
      await Promise.all(first.map(entry=>signal(entry,'SIGTERM')));
      if(first.length)await new Promise(resolveWait=>setTimeout(resolveWait,150));
      const survivors=await scan();await Promise.all(survivors.map(entry=>signal(entry,'SIGKILL')));
      if(survivors.length)await new Promise(resolveWait=>setTimeout(resolveWait,50));
      record.remaining=await scan();record.processes=[...known.values()];
    }catch(error){record.diagnostics.push(`Owned-process cleanup could not be completed: ${error instanceof Error?error.message:String(error)}`);}
    record.status=record.remaining.length||record.diagnostics.length?'cleanup-pending':'closed';persist();await queue;
    return{id:record.id,matched:known.size,remaining:[...record.remaining],diagnostics:[...record.diagnostics]};
    })();
    return cleaning;
  }};
}
