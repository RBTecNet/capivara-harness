import { matchesGlob } from 'node:path';
import type { Verification } from '../domain/types.js';
import { verificationOutputs } from '../domain/verifications.js';
import { inputSnapshot } from './files.js';

export interface VerificationInputMutation {
  path:string;
  proposalHash:string|null;
  verificationHash:string|null;
  change:'created'|'modified'|'deleted';
  /** A declared producer artifact is metadata, never inferred from extension or content. */
  declaredOutput:boolean;
}
export interface VerificationMutationReport {
  schema:'capivara/verification-input-mutation/1';
  checkId:string;
  expectedInputHash:string;
  currentInputHash:string;
  /** Compared states are current proposal/current verifier, not an invented pre-execution snapshot. */
  compared:{proposal:string;verification:string};
  changes:VerificationInputMutation[];
}

/** Identity drift after a successful command is an instrument/effect contract
 * incident. It cannot authorize editing the product or publishing fixture data. */
export class VerificationMutationError extends Error {
  readonly kind='instrument' as const;
  readonly repairScope='verification' as const;
  constructor(readonly report:VerificationMutationReport){
    super(`Verification ${report.checkId} has different input state in its isolated execution. Recover its read/write and temporary-state contract without approving mutated product inputs.`);
    this.name='VerificationMutationError';
  }
  get checkId():string{return this.report.checkId;}
  get changes():readonly VerificationInputMutation[]{return this.report.changes;}
}

function declared(path:string,output:string):boolean{
  const normalize=(value:string)=>value.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/$/,'');
  const selector=normalize(output),given=normalize(path);
  return given===selector||matchesGlob(given,selector)||matchesGlob(given,`${selector}/**`);
}

/** Observe exact mismatching paths before requesting scoped instrument repair.
 * No file is excluded, restored, published or reclassified as temporary here. */
export async function verificationMutationError(options:{workspace:string;verificationWorkspace:string;check:Verification;inputs:readonly string[];expectedInputHash:string;currentInputHash:string}):Promise<VerificationMutationError>{
  const [proposal,verification]=await Promise.all([inputSnapshot(options.workspace,options.inputs),inputSnapshot(options.verificationWorkspace,options.inputs)]);
  const outputs=verificationOutputs(options.check),changes:VerificationInputMutation[]=[];
  for(const path of [...new Set([...Object.keys(proposal),...Object.keys(verification)])].sort()){
    if(path.startsWith('selector:'))continue;
    const before=proposal[path]??null,after=verification[path]??null;
    if(before===after)continue;
    changes.push({path,proposalHash:before,verificationHash:after,change:before===null?'created':after===null?'deleted':'modified',declaredOutput:outputs.some(output=>declared(path,output))});
  }
  return new VerificationMutationError({schema:'capivara/verification-input-mutation/1',checkId:options.check.id,expectedInputHash:options.expectedInputHash,currentInputHash:options.currentInputHash,compared:{proposal:options.workspace,verification:options.verificationWorkspace},changes});
}
