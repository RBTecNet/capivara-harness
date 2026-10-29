import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, matchesGlob } from 'node:path';
import { ContextTooLarge, contextForTask, packetText } from '../domain/context.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from '../domain/types.js';
import { digest, inside, sourceFiles } from './files.js';

export interface TaskSourceCoverage {
  path: string;
  /** SHA256 of the complete raw file, never of just the displayed excerpt. */
  hash: string | null;
  bytes: number;
  characters: number;
  lines: number;
  complete: boolean;
  status: 'complete' | 'excerpt' | 'omitted' | 'missing' | 'unreadable' | 'binary';
  ranges: { startLine: number; endLine: number }[];
  startLine?: number;
  endLine?: number;
  reason?: string;
}
export interface AssembledTaskContext { text: string; coverage: TaskSourceCoverage[]; }
interface Focus { path: string; startLine?: number; endLine?: number; }
interface Source { coverage: TaskSourceCoverage; text: string | null; }

function focusAt(workspace: string, value: string): Focus {
  const location = value.match(/^(.*?)(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)$/);
  const given = location?.[1] ?? value;
  const path = (isAbsolute(given) ? relative(resolve(workspace),given) : given).replaceAll('\\','/').replace(/^\.\//,'');
  inside(workspace,path);
  if(!location)return{path};
  const startLine=Math.max(1,Number(location[2]??location[4]));
  return{path,startLine,endLine:Math.max(startLine,Number(location[3]??location[5]??startLine))};
}
function block(source: Source, content = ''): string {
  const receipt = source.coverage;
  // The shared delivery guidance already explains omission. Repeating that
  // paragraph and the same reason for every indexed file can overflow a unit
  // whose complete obligations fit; retain every receipt and its real ranges.
  const {reason,...identity}=receipt;
  return `SOURCE ${JSON.stringify(receipt.status==='omitted'?identity:receipt)}\n${content ? `${content}\nEND SOURCE ${receipt.path}\n` : ''}`;
}
const guidance = 'SOURCE DELIVERY: Each SOURCE header records the full-file hash, size and exact coverage. complete=false means omitted source remains available on disk, not evidence that code is absent or defective. Request the named file/range or inspect it before alleging a defect outside supplied coverage.\n';

async function retain(workspace:string,kind:string,value:unknown):Promise<{path:string;sha256:string;complete:false}>{
  const bytes=JSON.stringify(value,null,2)+'\n',sha256=digest(bytes),folder=resolve(workspace,'.capivara-verification');
  await mkdir(folder,{recursive:true,mode:0o700});const info=await lstat(folder);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Context receipts require a private independent directory.');
  const path=`.capivara-verification/${kind}-${sha256}.json`,absolute=resolve(workspace,path);
  try{await writeFile(absolute,bytes,{flag:'wx',mode:0o600});}catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const retained=await lstat(absolute);if(!retained.isFile()||retained.isSymbolicLink()||digest(await readFile(absolute))!==sha256)throw new Error('Context receipt identity changed.');
  }
  return{path,sha256,complete:false};
}

async function boundedFacts(brief:ProductBrief,plan:DevelopmentPlan,task:WorkUnit,workspace:string,capacity:number,extra:string):Promise<string>{
  try{const full=packetText(contextForTask(brief,plan,task,capacity));if(full.length<=capacity*.65)return full;}
  catch(error){if(!(error instanceof ContextTooLarge))throw error;}
  const packet=contextForTask(brief,plan,task,Number.MAX_SAFE_INTEGER);
  const reference=await retain(workspace,'task-data',{schema:'capivara/task-data/1',packet,extra});
  let text=`TASK DATA ${JSON.stringify(reference)}\nWork unit ${task.id}: ${task.title}\n`;
  const budget=Math.floor(capacity*.65);
  for(const [key,value] of Object.entries(packet)){
    const full=`\n${key} ${JSON.stringify({complete:true,value})}`;
    const pointer=`\n${key} ${JSON.stringify({complete:false,pointer:'/packet/'+key})}`;
    text+=text.length+full.length<=budget?full:pointer;
  }
  return text;
}

/** Assemble facts and actual source against one global budget. Never hide a
 * per-file cut or a final string.slice behind an apparently complete FILE label. */
export async function assembleTaskContext(brief: ProductBrief, plan: DevelopmentPlan, task: WorkUnit, workspace: string, limit: number, extra = '', focusPaths: string[] = [], deliveryFiles?:readonly string[]): Promise<AssembledTaskContext> {
  const capacity=Math.floor(limit);
  if(!Number.isFinite(capacity)||capacity<=0)throw new RangeError('Task context capacity must be positive.');
  const rejectedFocus:{reference:string;reason:string}[]=[];
  const focus=focusPaths.flatMap(value=>{try{return[focusAt(workspace,value)];}catch(error){rejectedFocus.push({reference:value,reason:error instanceof Error?error.message:String(error)});return[];}});
  // Planned write permissions are not the observed delivery. A retained editor
  // may have used a different valid layout; inspect its actual changed files
  // and explicit read dependencies instead of injecting missing draft paths.
  const selectors=[...new Set([...(deliveryFiles?.length?deliveryFiles:task.files),...task.inputs??[],...focus.map(item=>item.path)])];
  const paths=new Set(await sourceFiles(workspace,selectors));
  // A named missing output is different from a file omitted by the delivery budget.
  for(const path of selectors.filter(value=>!/[!*?{}[\]]/.test(value)))if(!await stat(inside(workspace,path)).catch(()=>null))paths.add(path.replaceAll('\\','/').replace(/^\.\//,''));
  const sources:Source[]=[];
  for(const path of [...paths].sort()){
    const coverage:TaskSourceCoverage={path,hash:null,bytes:0,characters:0,lines:0,complete:false,status:'missing',ranges:[]};
    let text:string|null=null;
    try{
      const target=await realpath(inside(workspace,path));
      const rel=relative(resolve(workspace),target);
      if(rel==='..'||rel.startsWith(`..${sep}`))throw new Error('The source target is outside this workspace.');
      const bytes=await readFile(target);
      coverage.hash=digest(bytes);coverage.bytes=bytes.length;
      if(bytes.includes(0)){coverage.status='binary';coverage.reason='Binary source is indexed but is not injected as text.';}
      else{text=bytes.toString('utf8');coverage.characters=text.length;coverage.lines=text.split('\n').length;coverage.status='omitted';coverage.reason='The complete file has not been supplied within this context budget.';}
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT'){coverage.status='unreadable';coverage.reason=error instanceof Error?error.message:String(error);}
    }
    sources.push({coverage,text});
  }
  // Focus can name an owned file, a dependency, or an exact line range from a
  // finding. Reordering only affects which complete sources fit; it changes no code.
  const owned=new Set(task.files.filter(scope=>!/[!*?{}[\]]/.test(scope)).map(scope=>scope.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'')));
  const patterns=task.files.filter(scope=>/[*?{}[\]]/.test(scope));
  const ranks=new Map(sources.map(source=>{
    const path=source.coverage.path,index=focus.findIndex(item=>item.path===path);
    let ancestor=path,selected=owned.has('.');
    for(;;){if(owned.has(ancestor)){selected=true;break;}const slash=ancestor.lastIndexOf('/');if(slash<0)break;ancestor=ancestor.slice(0,slash);}
    return[path,index>=0?index:selected||patterns.some(scope=>matchesGlob(path,scope))?focus.length:focus.length+1] as const;
  }));
  sources.sort((left,right)=>{
    const rank=(path:string):number=>ranks.get(path)!;
    return rank(left.coverage.path)-rank(right.coverage.path)||left.coverage.path.localeCompare(right.coverage.path);
  });
  const packet=await boundedFacts(brief,plan,task,workspace,capacity,extra);
  const extraLimit=Math.max(0,Math.min(extra.length,Math.floor(capacity*.3)));
  const extraStart=extra.length-extraLimit;
  const note=extra ? `\nOPERATION DETAILS ${JSON.stringify({complete:extraStart===0,startCharacter:extraStart,endCharacter:extra.length,characters:extra.length})}\n${extra.slice(extraStart)}` : '';
  let prefix=`${packet}\n\n${guidance}${rejectedFocus.length?`UNRESOLVED SOURCE REFERENCES ${JSON.stringify(rejectedFocus)}\n`:''}`;
  const blocks=sources.map(source=>block(source));
  const size=():number=>prefix.length+blocks.filter(Boolean).join('\n').length+note.length;
  // Index growth is a delivery problem, not evidence that the engineering unit
  // needs decomposition. Keep every original receipt retrievable by identity.
  if(size()>capacity){
    const inventory=await retain(workspace,'source-index',{schema:'capivara/source-inventory/1',sources:sources.map(source=>source.coverage)});
    prefix+=`SOURCE INVENTORY ${JSON.stringify({...inventory,entries:sources.length})}\n`;
    blocks.fill('');
    for(let index=0;index<sources.length;index++){
      const candidate=block(sources[index]!);
      if(size()+candidate.length<=capacity-Math.min(1000,Math.floor(capacity*.2)))blocks[index]=candidate;
    }
  }
  if(size()>capacity)throw new ContextTooLarge(task.id,size(),capacity);
  for(let index=0;index<sources.length;index++){
    const source=sources[index]!;
    if(source.text===null)continue;
    const omitted=source.coverage;
    const complete:TaskSourceCoverage={...omitted,complete:true,status:'complete',ranges:[{startLine:1,endLine:omitted.lines}],startLine:1,endLine:omitted.lines};
    delete complete.reason;
    let candidate=block({coverage:complete,text:source.text},source.text);
    if(size()-blocks[index]!.length+candidate.length<=capacity){source.coverage=complete;blocks[index]=candidate;continue;}
    const selected=focus.find(item=>item.path===omitted.path);
    if(!selected)continue;
    const lines=source.text.split('\n');
    const start=Math.min(lines.length,selected.startLine??1),end=Math.min(lines.length,selected.endLine??start);
    let best:{coverage:TaskSourceCoverage;block:string}|undefined;
    // Include the exact requested range first, then expand around it while the
    // actual serialized context still fits. No arbitrary character cap applies.
    let low=0,high=lines.length;
    while(low<=high){
      const margin=Math.floor((low+high)/2),first=Math.max(1,start-margin),last=Math.min(lines.length,end+margin);
      const receipt:TaskSourceCoverage={...omitted,status:'excerpt',ranges:[{startLine:first,endLine:last}],startLine:first,endLine:last,reason:`Only lines ${first}-${last} of ${lines.length} are supplied. Other lines are omitted context, not absent code.`};
      const excerpt=lines.slice(first-1,last).map((line,offset)=>`${first+offset}: ${line}`).join('\n');
      candidate=block({coverage:receipt,text:source.text},excerpt);
      if(size()-blocks[index]!.length+candidate.length<=capacity){best={coverage:receipt,block:candidate};low=margin+1;}else high=margin-1;
    }
    if(best){source.coverage=best.coverage;blocks[index]=best.block;}
  }
  const text=`${prefix}${blocks.filter(Boolean).join('\n')}${note}`;
  return{text,coverage:sources.map(source=>source.coverage)};
}
