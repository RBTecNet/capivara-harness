import type { DevelopmentPlan, WorkUnit } from '../domain/types.js';
import type { OperationalEnvironment } from './environment.js';

/** Context-only view of concrete ready providers. Preparation and authoritative
 * plan data remain untouched; no environment values enter the model packet. */
export function preparedContextPlan(plan: DevelopmentPlan, task: WorkUnit, operational: OperationalEnvironment): DevelopmentPlan {
  const ids = new Set(task.environmentIds);
  for (;;) {
    const before = ids.size;
    for (const node of plan.environment) if (ids.has(node.id)) for (const dependency of node.dependsOn) ids.add(dependency);
    if (ids.size === before) break;
  }
  let changed = false;
  const environment = plan.environment.map(node => {
    if (!ids.has(node.id)) return node;
    const capability = node.identity?.capability ?? node.id;
    const binding = operational.bindings[capability];
    if (!binding?.ready || binding.capability !== capability
      || node.identity && (binding.kind !== node.identity.kind || binding.provider !== node.identity.provider)) return node;
    const provides = { ...node.provides };
    delete provides.command;
    delete provides.modules;
    if (binding.command?.length) provides.command = [...binding.command];
    if (binding.modules?.length) provides.modules = binding.modules.map(module => ({ ...module, runtimeCommand: [...module.runtimeCommand] }));
    changed = true;
    return { ...node, provides };
  });
  return changed ? { ...plan, environment } : plan;
}
