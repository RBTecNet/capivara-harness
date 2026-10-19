/** O que deve estar pronto antes de qualquer implementação. Não é teste do produto. */
export const PLANNING_CONTRACT = "capivara-planning/v2" as const;
export const ENVIRONMENT_CONTRACT = "capivara-environment/v2" as const;
export const PLANNING_UPGRADE = "planejamento incompatível com a Capivara 0.5.0. Gere novamente com `capivara init --fresh` e depois `capivara plan --fresh`. Código, dados e evidências existentes são preservados";

export interface EnvironmentRequirement {
  technology: string;
  binary: string;
  systemLevel: boolean;
  /** Argumentos de uma sonda finita de prontidão, executada sem shell. */
  checkArgs?: string[];
  installHint?: string;
}

export function environmentRequirements(value: unknown): EnvironmentRequirement[] {
  if (!Array.isArray(value)) throw new Error("environment deve ser uma lista de pré-requisitos");
  return value.map((entry: unknown) => {
    const item = entry as Partial<EnvironmentRequirement> | null;
    if (!item || typeof item.technology !== "string" || !item.technology.trim() ||
      typeof item.binary !== "string" || !item.binary.trim() || /[\0\r\n]/.test(item.binary) ||
      typeof item.systemLevel !== "boolean" ||
      (item.checkArgs !== undefined && (!Array.isArray(item.checkArgs) || !item.checkArgs.every(arg => typeof arg === "string" && !arg.includes("\0")))) ||
      (item.installHint !== undefined && typeof item.installHint !== "string")) {
      throw new Error("pré-requisito inválido: declare technology, binary, systemLevel e checkArgs como lista de argumentos");
    }
    return { technology: item.technology.trim(), binary: item.binary.trim(), systemLevel: item.systemLevel,
      ...(item.checkArgs ? { checkArgs: [...item.checkArgs] } : {}), ...(item.installHint ? { installHint: item.installHint } : {}) };
  });
}

export function renderEnvironmentRequirements(requirements: readonly EnvironmentRequirement[]): string[] {
  return requirements.flatMap(item => [
    `- ${item.technology}: ${JSON.stringify([item.binary, ...(item.checkArgs ?? [])])}`,
    ...(item.installHint ? [`  - preparação: ${item.installHint}`] : []),
  ]);
}
