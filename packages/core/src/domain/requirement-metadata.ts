import { jsonObject, object, string } from './json.js';

type Metadata = Record<string, unknown>;
interface RecordedResponse { operation:string; result:string; }
export interface RecordedRequirementMetadata {
  patches:Map<number,Metadata>;
  /** Conflicting answers remain available for an explicit resolution. */
  conflicts:{index:number;variants:Metadata[]}[];
}
type ResolveQuote = (raw:string,quote:string)=>string|undefined;

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item:unknown)=>object(item)?Object.fromEntries(Object.entries(item).sort(([left],[right])=>left.localeCompare(right))):item);
function signature(patch:Metadata):string{
  const comparable={...patch};
  // Ordering a set of declarations differently is not a conflicting answer.
  for(const key of ['bindings','outcomes'])if(Array.isArray(comparable[key]))comparable[key]=[...new Set(comparable[key].map(canonical))].sort();
  return canonical(comparable);
}

/** Reuse classification already paid for only when both the original candidate
 * and the recorded patch name the same unique, contiguous literal source.
 * The caller still validates providers, outcomes and authority before adoption.
 * A local array index, technology name or paraphrased statement is insufficient. */
export function recordedRequirementMetadata(raw:string,candidates:readonly Metadata[],responses:readonly RecordedResponse[],resolveQuote:ResolveQuote):RecordedRequirementMetadata{
  const source=(value:Metadata):string|undefined=>{
    const nested=object(value.source)?value.source:{};
    const quote=string(value.quote,string(nested.text));
    const literal=quote?resolveQuote(raw,quote):undefined;
    if(!literal||raw.indexOf(literal)<0||raw.indexOf(literal)!==raw.lastIndexOf(literal))return undefined;
    return literal;
  };
  const originals=candidates.map(source),variants=new Map<number,Map<string,Metadata>>();
  for(const response of responses){
    if(response.operation!=='repair')continue;
    const parsed=jsonObject(response.result);
    if(!parsed||!Array.isArray(parsed.requirements))continue;
    for(const update of parsed.requirements){
      if(!object(update)||!Number.isInteger(update.index)||Number(update.index)<0||Number(update.index)>=candidates.length)continue;
      const index=Number(update.index),literal=source(update);
      if(!literal||literal!==originals[index])continue;
      const patch:Metadata={index,quote:literal};
      if(Array.isArray(update.bindings))patch.bindings=structuredClone(update.bindings);
      else if(object(update.binding))patch.bindings=[structuredClone(update.binding)];
      if(update.outcomes!==undefined)patch.outcomes=structuredClone(update.outcomes);
      if(update.unsupported===true){patch.unsupported=true;if(typeof update.reason==='string')patch.reason=update.reason;}
      const existing=variants.get(index)??new Map<string,Metadata>();
      if(!existing.has(signature(patch)))existing.set(signature(patch),patch);
      variants.set(index,existing);
    }
  }
  const result:RecordedRequirementMetadata={patches:new Map(),conflicts:[]};
  for(const [index,options] of variants){
    if(options.size===1)result.patches.set(index,options.values().next().value!);
    else result.conflicts.push({index,variants:[...options.values()]});
  }
  return result;
}
