/**
 * Os quatro papéis.
 *
 * Eles não têm a mesma exigência técnica: escritor, auditor e verificador só
 * leem e devolvem texto, enquanto o executor escreve arquivos e roda comandos.
 * Essa diferença é declarada aqui e não pode ser deduzida no ponto de chamada,
 * porque é ela que decide o sandbox de cada invocação.
 */

export const ROLE_NAMES = ["writer", "auditor", "builder", "verifier"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export type Permission = "read-only" | "workspace-write";

export interface RoleDefinition {
  name: RoleName;
  label: string;
  permission: Permission;
  /** O executor precisa escrever e rodar comandos; via API direta isso exigiria
   *  um tool loop próprio, que ficou fora da primeira entrega. */
  requiresCli: boolean;
  /** Só o executor instala dependências e baixa scaffolding. */
  network: boolean;
  description: string;
}

export const ROLES: Readonly<Record<RoleName, RoleDefinition>> = {
  writer: {
    name: "writer",
    label: "escritor documental",
    permission: "read-only",
    requiresCli: false,
    network: false,
    description: "lê o projeto e devolve o texto dos documentos",
  },
  auditor: {
    name: "auditor",
    label: "auditor documental",
    permission: "read-only",
    requiresCli: false,
    network: false,
    description: "lê os documentos e devolve aprovação ou devolução com orientação",
  },
  builder: {
    name: "builder",
    label: "executor do loop",
    permission: "workspace-write",
    requiresCli: true,
    network: true,
    description: "implementa a fase: escreve arquivos, instala dependências e roda a suíte",
  },
  verifier: {
    name: "verifier",
    label: "verificador independente",
    permission: "read-only",
    requiresCli: false,
    network: false,
    description: "lê o código real e emite TASK <n>: DONE|INCOMPLETE",
  },
};

export interface RoleConfig {
  provider: string;
  model: string;
  effort: string;
  credential: string;
  /** Executável do adapter custom, quando o provider é `custom`. */
  command: string;
}

export interface RoleOverrides {
  provider?: string;
  model?: string;
  effort?: string;
  credential?: string;
  command?: string;
}

export interface RoleResolution {
  /** Fallback global aplicado a todo papel sem configuração própria. */
  global: RoleOverrides;
  roles: Partial<Record<RoleName, RoleOverrides>>;
}

const EMPTY: RoleConfig = { provider: "", model: "", effort: "", credential: "", command: "" };

/** Resolve os quatro papéis: configuração própria vence o fallback global. */
export function resolveRoles(resolution: RoleResolution): Record<RoleName, RoleConfig> {
  const resolved = {} as Record<RoleName, RoleConfig>;
  for (const name of ROLE_NAMES) {
    const own = resolution.roles[name] ?? {};
    resolved[name] = {
      ...EMPTY,
      provider: own.provider ?? resolution.global.provider ?? "",
      model: own.model ?? resolution.global.model ?? "",
      effort: own.effort ?? resolution.global.effort ?? "",
      credential: own.credential ?? resolution.global.credential ?? "",
      command: own.command ?? resolution.global.command ?? "",
    };
  }
  return resolved;
}
