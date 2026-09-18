/**
 * Tradução das flags para a configuração dos quatro papéis.
 *
 * Nenhum papel tem default: rodar modelo custa dinheiro e a escolha é de quem
 * paga. O que existe aqui é só a tradução das flags.
 *
 * Sobre a tentação de baratear o auditor e o verificador por eles serem
 * somente-leitura: eles julgam o trabalho de outro modelo. Um juiz abaixo do
 * autor não reprova menos — ele carimba, porque não enxerga o defeito para
 * reprovar. E as regras da dúvida deste harness dependem disso: "na dúvida,
 * aprove e ressalve" vindo de um modelo fraco é aprovação automática; "na
 * dúvida, INCOMPLETE" vindo de um modelo fraco é ciclo de correção queimado
 * contra código que estava certo.
 *
 * O piloto 3 é a evidência: foi o auditor quem viu que a regra de enviar cartão
 * novo para "A fazer" usava o nome da coluna, que outra story permite renomear.
 * Isso é inferência entre dois documentos, não conferência de forma.
 */

import { CLI_PROVIDERS, DIRECT_PROVIDERS, resolveRoles, ROLE_NAMES } from "../provider/index.js";
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

/** Papéis que cada comando realmente chama. O init não constrói; o build não escreve. */
export const INIT_ROLES = ["writer", "auditor", "verifier"] as const satisfies readonly RoleName[];
export const BUILD_ROLES = ["builder", "verifier"] as const satisfies readonly RoleName[];

/** Papéis necessários ao comando que ficaram sem provider resolvido. */
export function unresolvedRoles(roles: Record<RoleName, RoleConfig>, needed: readonly RoleName[]): RoleName[] {
  return needed.filter((role) => roles[role].provider.trim() === "");
}

/**
 * O que dizer quando falta provider.
 *
 * O piloto 3 tropeçou aqui: o splash escreveu "não configurado" quatro vezes, a
 * ferramenta seguiu em frente assim mesmo, leu o projeto, começou a entrevista e
 * só então morreu com um stack trace do Node. Diagnóstico que aparece depois do
 * trabalho começar é diagnóstico tarde demais, e stack trace não é mensagem.
 */
export function renderUnresolved(command: string, missing: readonly RoleName[]): string {
  return [
    `capivara ${command} não tem provider para: ${missing.join(", ")}`,
    "",
    "Nenhum papel tem provider por padrão — rodar modelo custa dinheiro, e a escolha é sua.",
    "Diga qual usar, de uma das duas formas:",
    "",
    `    capivara ${command} ... --provider codex`,
    `    capivara ${command} ... ${missing.map((role) => `--${role}-provider codex`).join(" ")}`,
    "",
    `CLI instalada na máquina: ${CLI_PROVIDERS.join(", ")}`,
    `API direta, exige credencial: ${DIRECT_PROVIDERS.join(", ")}`,
    "",
    "`capivara doctor` diz quais estão mesmo disponíveis aqui.",
  ].join("\n");
}
