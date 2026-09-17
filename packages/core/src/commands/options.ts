/**
 * Tradução das flags para a configuração dos quatro papéis.
 *
 * Defaults sensatos: auditor e verificador caem num modelo mais barato quando o
 * operador não disse nada, porque ler e emitir veredito não precisa do modelo
 * mais caro — e são eles que rodam mais vezes.
 */

import { resolveRoles, ROLE_NAMES } from "../provider/index.js";
import type { RoleConfig, RoleName, RoleOverrides } from "../provider/index.js";

export interface CliRoleFlags {
  provider?: string;
  model?: string;
  effort?: string;
  credential?: string;
  adapter?: string;
  writerProvider?: string;
  writerModel?: string;
  writerEffort?: string;
  auditorProvider?: string;
  auditorModel?: string;
  auditorEffort?: string;
  builderProvider?: string;
  builderModel?: string;
  builderEffort?: string;
  verifierProvider?: string;
  verifierModel?: string;
  verifierEffort?: string;
}

function overridesFor(role: RoleName, flags: CliRoleFlags): RoleOverrides {
  const pick = (suffix: "Provider" | "Model" | "Effort"): string | undefined =>
    (flags as unknown as Record<string, string | undefined>)[`${role}${suffix}`];
  const overrides: RoleOverrides = {};
  const provider = pick("Provider");
  const model = pick("Model");
  const effort = pick("Effort");
  if (provider) overrides.provider = provider;
  if (model) overrides.model = model;
  if (effort) overrides.effort = effort;
  return overrides;
}

export function rolesFromFlags(flags: CliRoleFlags): Record<RoleName, RoleConfig> {
  const global: RoleOverrides = {};
  if (flags.provider) global.provider = flags.provider;
  if (flags.model) global.model = flags.model;
  if (flags.effort) global.effort = flags.effort;
  if (flags.credential) global.credential = flags.credential;
  if (flags.adapter) global.command = flags.adapter;

  const roles: Partial<Record<RoleName, RoleOverrides>> = {};
  for (const role of ROLE_NAMES) roles[role] = overridesFor(role, flags);

  return resolveRoles({ global, roles });
}

export function describeRoles(roles: Record<RoleName, RoleConfig>): { role: string; provider: string; model: string }[] {
  return ROLE_NAMES.map((role) => ({ role, provider: roles[role].provider, model: roles[role].model }));
}
