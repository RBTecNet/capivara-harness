import { identity } from './authority.js';
import type { DevelopmentPlan, ProductBrief, WorkUnit } from './types.js';

export function taskDependsOn(plan: DevelopmentPlan, task: WorkUnit, prerequisite: string, seen = new Set<string>()): boolean {
  if (seen.has(task.id)) return false;
  seen.add(task.id);
  return task.dependsOn.some(id => id === prerequisite || !!plan.tasks.find(candidate => candidate.id === id && taskDependsOn(plan, candidate, prerequisite, seen)));
}

export function preferredProofOwner(plan: DevelopmentPlan, requirementId: string): WorkUnit | undefined {
  const consumers = plan.tasks.filter(task => task.requirementIds.includes(requirementId));
  return consumers.filter(task => !consumers.some(other => other.id !== task.id && taskDependsOn(plan, other, task.id))).sort((left, right) => {
    const weight = (task: WorkUnit): number => consumers.filter(other => other.id !== task.id && taskDependsOn(plan, task, other.id)).length;
    return weight(right) - weight(left) || plan.tasks.indexOf(right) - plan.tasks.indexOf(left);
  })[0];
}

export const criterionIdentity = (taskId: string, statement: string): string => identity('criterion', JSON.stringify({ taskId, statement }));
export interface ScopeContribution {
  taskId: string;
  localCriteria: { id: string; statement: string }[];
  requirements: { requirementId: string; contribution: 'partial' | 'final'; finalOwnerTaskId?: string; downstreamTaskIds: string[] }[];
}

/** Data about this unit's place in the actual DAG, never new acceptance policy
 * or a copy of the full plan. Existing literal requirements stay authoritative. */
export function scopeContribution(brief: ProductBrief, plan: DevelopmentPlan, task: WorkUnit): ScopeContribution {
  return {
    taskId: task.id,
    localCriteria: task.criteria.map(statement => ({ id: criterionIdentity(task.id, statement), statement })),
    requirements: brief.requirements.filter(requirement => task.requirementIds.includes(requirement.id)).map(requirement => {
      const owner = preferredProofOwner(plan, requirement.id);
      const downstreamTaskIds = plan.tasks.filter(candidate => candidate.id !== task.id && candidate.requirementIds.includes(requirement.id) && taskDependsOn(plan, candidate, task.id)).map(candidate => candidate.id);
      return { requirementId: requirement.id, contribution: downstreamTaskIds.length ? 'partial' : 'final', ...(owner ? { finalOwnerTaskId: owner.id } : {}), downstreamTaskIds };
    }),
  };
}
