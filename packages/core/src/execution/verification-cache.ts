import { isDeepStrictEqual } from 'node:util';
import type { Verification } from '../domain/types.js';
import { verificationOutputs } from '../domain/verifications.js';
import { inputSnapshot } from './files.js';
import { interfaceEvidenceUsable, verificationLevel, type VerificationIdentity, type VerificationOutcome } from './checks.js';
import type { VerificationEvidence } from './types.js';

export interface PositiveVerificationCacheOptions {
  workspace:string;
  taskId:string;
  checks:readonly Verification[];
  evidence:readonly VerificationEvidence[];
  invalidatedEvidenceIds?:ReadonlySet<string>;
  /** The coordinator resolves the same observed delivery read-set used by verification. */
  identity:(check:Verification)=>Promise<VerificationIdentity>;
  /** Revalidate concrete resources before computing their operational identity. */
  resource:(check:Verification)=>Promise<{ready:boolean}>;
}

/** Avoid a disposable verification fork only when the entire batch already has
 * current positive observations. This is neither predicate reinterpretation nor
 * partial reuse: a single uncertain receipt returns to ordinary verification.
 * No proof, timestamp, artifact or provider identity is manufactured here. */
export async function cachedPositiveVerifications(options:PositiveVerificationCacheOptions):Promise<VerificationOutcome[]|undefined>{
  if(!options.checks.length)return undefined;
  const results:VerificationOutcome[]=[];
  try{
    for(const check of options.checks){
      if(!(await options.resource(check)).ready)return undefined;
      const identity=await options.identity(check);
      // A later negative/cancelled observation with this exact identity must
      // never be bypassed by selecting an older successful result.
      const recorded=options.evidence.findLast(item=>item.taskId===options.taskId&&item.checkId===check.id&&item.inputHash===identity.inputHash&&item.kind===check.kind&&item.level===verificationLevel(check));
      if(!recorded?.passed||options.invalidatedEvidenceIds?.has(recorded.id)||recorded.classification||!Array.isArray(recorded.inputs)||!recorded.observation||recorded.observation.cancelled||recorded.observation.timedOut||recorded.observation.issue||recorded.environmentRevision!==identity.environmentRevision||!interfaceEvidenceUsable(check,recorded))return undefined;
      const outputs=verificationOutputs(check);
      if(outputs.length&&!isDeepStrictEqual(recorded.artifacts,await inputSnapshot(options.workspace,outputs)))return undefined;
      results.push({evidence:{...structuredClone(recorded),level:verificationLevel(check),inputs:[...recorded.inputs]},result:null,classification:null,needsInstrument:false});
    }
  }catch{
    // This optional optimization cannot prevent the ordinary isolated path
    // from diagnosing a changed/missing source, artifact or runtime resource.
    return undefined;
  }
  return results;
}
