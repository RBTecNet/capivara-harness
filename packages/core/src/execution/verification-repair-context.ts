import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ContextTooLarge } from '../domain/context.js';
import type { ProductBrief, Verification, WorkUnit } from '../domain/types.js';
import { digest } from './files.js';

export async function createVerificationRepairContext(options:{workspace:string;brief:ProductBrief;task:WorkUnit;checks:Verification[];reason:string;limit:number}):Promise<string>{
  const {workspace,brief,task,checks,reason}=options,limit=Math.floor(options.limit);
  if(!Number.isFinite(limit)||limit<=0)throw new RangeError('Verification repair context capacity must be positive.');
  const ids=new Set([...task.requirementIds,...checks.flatMap(check=>check.requirementIds)]);
  const requirements=brief.requirements.filter(requirement=>ids.has(requirement.id));
  // This is an immutable data receipt, not instructions or an approval. Full
  // quotations, predicates, inline programs and the original failure survive.
  const job={schema:'capivara/verification-repair-job/1',project:{name:brief.name,modes:brief.modes,targets:brief.targets},task,requirements,constraints:brief.constraints,checks,reason};
  const content=JSON.stringify(job,null,2)+'\n',sha256=digest(content);
  const directory=join(workspace,'.capivara-verification');
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Verification recovery data needs an independent private workspace directory.');
  const path=`.capivara-verification/recovery-${sha256}.json`,absolute=join(workspace,path);
  try{await writeFile(absolute,content,{flag:'wx',mode:0o600});}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const retained=await lstat(absolute);
    if(!retained.isFile()||retained.isSymbolicLink()||digest(await readFile(absolute))!==sha256)throw new Error('The existing verification recovery receipt does not match its immutable data identity.');
  }
  let text=`VERIFICATION REPAIR JOB ${JSON.stringify({path,sha256,complete:false})}`;
  if(text.length>limit)throw new ContextTooLarge(task.id,text.length,limit);
  const add=(label:string,value:unknown,pointer:string):void=>{
    const full=`\n${label} ${JSON.stringify({complete:true,value})}`;
    const reference=`\n${label} ${JSON.stringify({complete:false,pointer})}`;
    if(text.length+full.length<=limit)text+=full;
    else if(text.length+reference.length<=limit)text+=reference;
  };
  add('TASK',{id:task.id,goal:task.goal,criteria:task.criteria},'/task');
  add('REQUIREMENTS',requirements.map(requirement=>({id:requirement.id,binding:requirement.binding,bindingAuthority:requirement.bindingAuthority})), '/requirements');
  const argument=(value:string,pointer:string):unknown=>value.length>180?{complete:false,pointer,characters:value.length}:value;
  add('INVOCATIONS',checks.map((check,index)=>({id:check.id,kind:check.kind,level:check.level,command:check.command?argument(check.command,`/checks/${index}/command`):undefined,args:check.args?.map((value,arg)=>argument(value,`/checks/${index}/args/${arg}`)),requirementIds:check.requirementIds})), '/checks');
  add('CONSTRAINTS',brief.constraints.map(constraint=>({id:constraint.id,forbiddenCapabilities:constraint.forbiddenCapabilities,requiredCapabilities:constraint.requiredCapabilities})), '/constraints');
  const failure=(characters:number):string=>{
    const complete=characters>=reason.length,head=complete?reason:reason.slice(0,Math.ceil(characters/2)),tail=complete?'':reason.slice(-Math.floor(characters/2)||reason.length);
    return `\nORIGINAL FAILURE ${JSON.stringify({complete,pointer:'/reason',characters:reason.length,omittedCharacters:reason.length-head.length-tail.length,head,...(tail?{tail}:{})})}`;
  };
  let low=0,high=reason.length,best='';
  while(low<=high){const count=Math.floor((low+high)/2),candidate=failure(count);if(text.length+candidate.length<=limit){best=candidate;low=count+1;}else high=count-1;}
  if(best)text+=best;
  return text;
}
