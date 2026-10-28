import { chmod, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verificationEnvironment } from '../runtime/verification.js';
import { operationalInvocations, type OperationalEnvironment } from './environment.js';

export interface InstrumentRepair { path:string; quarantined?:string; reason:string; action?:'quarantine'|'omit-optional-alias'; alias?:string; invocation?:string[]; }
const quote=(text:string):string=>`'${text.replaceAll("'","'\\''")}'`;
/** Repair coordinator-owned files without following a corrupt runtime link into the product or another directory. */
export async function prepareInvocationInstrument(workspace:string,operational:OperationalEnvironment):Promise<{environment:Record<string,string>;repairs:InstrumentRepair[]}>{
  const invocations=operationalInvocations(operational,{readyOnly:true});
  const repairs:InstrumentRepair[]=[];
  const directory=async(path:string):Promise<void>=>{
    const info=await lstat(path).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    if(info&&!info.isDirectory()){
      const parent=join(workspace,'.capivara-next','instrument-quarantine');await mkdir(parent,{recursive:true});
      const quarantined=join(parent,randomUUID());await rename(path,quarantined);
      repairs.push({path,quarantined,action:'quarantine',reason:'A coordinator directory was replaced by a file or symbolic link. Preserved that entry and recreated a private writable directory.'});
    }else if(info&&(info.mode&0o700)!==0o700)await chmod(path,(info.mode&0o777)|0o700);
    await mkdir(path,{recursive:true});
  };
  const runtime=join(workspace,'.capivara-runtime');await directory(runtime);
  for(const entry of ['tmp','cache','bin'])await directory(join(runtime,entry));
  const environment=await verificationEnvironment(workspace,operational.env);
  const bin=join(runtime,'bin');await rm(bin,{recursive:true,force:true});await mkdir(bin,{recursive:true});
  for(const invocation of invocations)if(invocation.command[0]&&(isAbsolute(invocation.command[0])||invocation.command[0].includes('/')))for(const alias of invocation.aliases??[]){
    const omit=(path:string,reason:string):void=>{repairs.push({path,action:'omit-optional-alias',alias,invocation:[...invocation.command],reason});};
    if(!/^[a-zA-Z0-9._+-]+$/.test(alias)||alias==='.'||alias==='..'){
      omit(bin,'This optional alias is not a safe executable filename. Its original name is retained in the audit; the concrete provider invocation remains available.');continue;
    }
    const path=join(bin,process.platform==='win32'?`${alias}.cmd`:alias);
    try{
      await writeFile(path,process.platform==='win32'?`@echo off\r\n${invocation.command.map(part=>`"${part.replaceAll('"','""')}"`).join(' ')} %*\r\n`:`#!/bin/sh\nexec ${invocation.command.map(quote).join(' ')} "$@"\n`);await chmod(path,0o755);
    }catch(error){
      // A model-supplied alias cannot make an otherwise usable provider fail.
      // Restrict this recovery to an unusable filename, not permissions, storage
      // failures or the writable execution directories needed by the product.
      if((error as NodeJS.ErrnoException).code!=='ENAMETOOLONG')throw error;
      omit(path,'ENAMETOOLONG: this optional executable alias exceeds the filesystem naming limit. The concrete provider invocation is unchanged and development can continue.');
    }
  }
  environment.PATH=`${bin}${delimiter}${environment.PATH??process.env.PATH??''}`;
  return{environment,repairs};
}
