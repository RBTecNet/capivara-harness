import { ordered } from '../domain/context.js';
import type { Verification } from '../domain/types.js';

export interface VerificationGraphEntry { check:Verification; inputs:string[]; }
export class VerificationGraphError extends Error {
  constructor(readonly code:'missing'|'ambiguous'|'cycle',readonly checkIds:string[],message:string){super(message);this.name='VerificationGraphError';}
}
const contract=(check:Verification):string=>{
  const{id:_id,expected:_description,requirementIds:_requirements,constraintIds:_constraints,...operation}=check;
  return JSON.stringify(operation,(_key,value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right))):value);
};

/** Bring explicitly referenced producer recipes into the local verification
 * batch before ordering it. Importing is never proof reuse: the caller must
 * execute or validate a current receipt under the preserved owner's read set. */
export function closeVerificationGraph(checks:readonly Verification[],registry:readonly VerificationGraphEntry[]):{checks:Verification[];imported:string[]}{
  const selected=new Map<string,Verification>(),imported:string[]=[];
  for(const check of checks){
    const earlier=selected.get(check.id);
    if(earlier&&contract(earlier)!==contract(check))throw new VerificationGraphError('ambiguous',[check.id],`Local verification identity ${check.id} has incompatible executable definitions.`);
    if(!earlier)selected.set(check.id,structuredClone(check));
  }
  const queue=[...selected.values()];
  for(let index=0;index<queue.length;index++)for(const id of queue[index]!.dependsOn??[]){
    if(selected.has(id))continue;
    const candidates=registry.filter(entry=>entry.check.id===id).map(entry=>({...structuredClone(entry.check),inputs:[...(entry.check.inputs??entry.inputs)]}));
    if(!candidates.length)throw new VerificationGraphError('missing',[id],`Verification ${queue[index]!.id} requires an unavailable producer recipe ${id}.`);
    if(new Set(candidates.map(contract)).size!==1)throw new VerificationGraphError('ambiguous',[id],`Verification producer ${id} has incompatible executable definitions or owner input scopes; select its actual owner explicitly.`);
    const producer=candidates[0]!;selected.set(id,producer);queue.push(producer);imported.push(id);
  }
  const result=ordered([...selected.values()].map(check=>({...check,dependsOn:check.dependsOn??[]})));
  if(result.unresolved.length)throw new VerificationGraphError('cycle',result.unresolved.map(check=>check.id),`Verification dependencies remain cyclic: ${result.unresolved.map(check=>check.id).join(', ')}.`);
  return{checks:result.ready.map(check=>selected.get(check.id)!),imported};
}
