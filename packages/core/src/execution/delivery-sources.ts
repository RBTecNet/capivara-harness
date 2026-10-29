import type { IntegrationTransaction, TaskProgress } from './types.js';

/** The editor's observed source changes are delivery ownership. Verification
 * artifacts remain mechanical proof inputs/outputs, not new inspection sources.
 * Legacy/no-op work without a concrete receipt keeps conservative declared scope. */
export function deliveryWriteSet(taskId: string, progress: Pick<TaskProgress, 'changedFiles'> | undefined, integrations: readonly IntegrationTransaction[] = []): string[] | undefined {
  const observed = progress?.changedFiles;
  const files = Array.isArray(observed) ? observed : integrations.filter(transaction => transaction.taskId === taskId).flatMap(transaction => transaction.files.map(file => file.path));
  const selected = [...new Set(files)].sort();
  return selected.length ? selected : undefined;
}
