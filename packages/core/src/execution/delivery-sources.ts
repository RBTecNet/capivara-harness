import type { IntegrationTransaction, TaskProgress } from './types.js';
import { isAbsolute, matchesGlob } from 'node:path';
import type { Verification } from '../domain/types.js';
import { verificationOutputs } from '../domain/verifications.js';

/** The editor's observed source changes are delivery ownership. Verification
 * artifacts remain mechanical proof inputs/outputs, not new inspection sources.
 * Legacy/no-op work without a concrete receipt keeps conservative declared scope. */
export function deliveryWriteSet(taskId: string, progress: Pick<TaskProgress, 'changedFiles' | 'generatedFiles'> | undefined, integrations: readonly IntegrationTransaction[] = []): string[] | undefined {
  const observed = progress?.changedFiles;
  const files = Array.isArray(observed) ? observed : integrations.filter(transaction => transaction.taskId === taskId).flatMap(transaction => transaction.files.map(file => file.path));
  const generated=new Set(progress?.generatedFiles??[]);
  const selected = [...new Set(files)].filter(path=>!generated.has(path)).sort();
  return selected.length ? selected : undefined;
}

/** Read dependencies and predicted ownership never replace the delivery's
 * observed source files. Compilation and implicit/empty readsets include those
 * exact files; an explicitly scoped behavior recipe retains its own readset.
 * The caller resolves this set once for both proof identity and clone freshness. */
export function deliveryProofSelectors(check:Verification,selectors:readonly string[],observedWrites:readonly string[]|undefined,level:'syntax'|'build'|'behavior'=check.level??'behavior'):string[]{
  if(!observedWrites?.length||level!=='build'&&Boolean(check.inputs?.length))return[...new Set(selectors)].sort();
  const normalize=(path:string)=>path.replaceAll('\\','/').replace(/^\.\//,'');
  const outputs=verificationOutputs(check).map(normalize);
  const generated=(path:string):boolean=>outputs.some(output=>path===output||matchesGlob(path,output)||matchesGlob(path,`${output.replace(/\/$/,'')}/**`));
  const concrete=observedWrites.map(normalize).filter(path=>path&&path!=='.'&&!path.startsWith('!')&&!isAbsolute(path)&&!/^[A-Za-z]:/.test(path)&&!path.split('/').some(part=>part==='..'||['.git','.capivara-next','.capivara-runtime','.capivara-verification'].includes(part))&&!/[\0*?{}[\]]/.test(path)&&!generated(path));
  return[...new Set([...selectors,...concrete])].sort();
}
