import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
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
  sources.sort((left,right)=>{
    const rank=(path:string):number=>{const index=focus.findIndex(item=>item.path===path);return index<0?focus.length:index;};
    return rank(left.coverage.path)-rank(right.coverage.path)||left.coverage.path.localeCompare(right.coverage.path);
  });
  const packet=packetText(contextForTask(brief,plan,task,capacity));
  const extraLimit=Math.max(0,Math.min(extra.length,Math.floor(capacity*.3)));
  const extraStart=extra.length-extraLimit;
  const note=extra ? `\nOPERATION DETAILS ${JSON.stringify({complete:extraStart===0,startCharacter:extraStart,endCharacter:extra.length,characters:extra.length})}\n${extra.slice(extraStart)}` : '';
  const prefix=`${packet}\n\n${guidance}${rejectedFocus.length?`UNRESOLVED SOURCE REFERENCES ${JSON.stringify(rejectedFocus)}\n`:''}`;
  const blocks=sources.map(source=>block(source));
  const size=():number=>prefix.length+blocks.join('\n').length+note.length;
  // Even metadata must fit honestly; the planner must split an oversized unit
  // rather than discard its authority or source coverage receipt.
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
  const text=`${prefix}${blocks.join('\n')}${note}`;
  return{text,coverage:sources.map(source=>source.coverage)};
}
