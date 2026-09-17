/**
 * `capivara providers list` — o catálogo e o estado de configuração de cada um.
 *
 * A listagem é dados; a renderização é da CLI. Assim o teste pergunta ao dado e
 * não ao texto formatado.
 */

import { CLI_CATALOG, DIRECT_CATALOG } from "../provider/registry.js";
import { ROLES, ROLE_NAMES } from "../provider/roles.js";
import { readCredentials, toSafe, type SafeCredential } from "../provider/credentials.js";

export type ProviderKind = "cli" | "direct-api" | "custom-adapter";
export type ConfigurationState = "login-externo" | "configurado" | "sem-credencial" | "por-comando";

export interface ProviderListing {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Papéis que este provider pode assumir. */
  roles: string[];
  configuration: ConfigurationState;
  credentials: SafeCredential[];
}

const READ_ONLY_ROLES = ROLE_NAMES.filter((role) => !ROLES[role].requiresCli);

export async function listProviders(credentialsFile?: string): Promise<ProviderListing[]> {
  const stored = await readCredentials(credentialsFile);

  const cli: ProviderListing[] = CLI_CATALOG.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: provider.id === "custom" ? "custom-adapter" : "cli",
    roles: [...ROLE_NAMES],
    configuration: provider.id === "custom" ? "por-comando" : "login-externo",
    credentials: [],
  }));

  const direct: ProviderListing[] = DIRECT_CATALOG.map((provider) => {
    const credentials = stored.filter((record) => record.provider === provider.id).map(toSafe);
    return {
      id: provider.id,
      label: provider.label,
      kind: "direct-api",
      // O executor exige CLI: API direta não escreve arquivo nem roda comando.
      roles: [...READ_ONLY_ROLES],
      configuration: credentials.length > 0 ? "configurado" : "sem-credencial",
      credentials,
    };
  });

  return [...cli, ...direct];
}

export function renderProviderList(providers: ProviderListing[]): string {
  const lines: string[] = [];
  lines.push("PROVIDER      TIPO             CONFIGURAÇÃO      PAPÉIS");
  for (const provider of providers) {
    lines.push(
      [
        provider.id.padEnd(13),
        provider.kind.padEnd(16),
        provider.configuration.padEnd(17),
        provider.roles.join(", "),
      ].join(""),
    );
    for (const credential of provider.credentials) {
      lines.push(`  └─ ${credential.label} (${credential.id})${credential.default ? " · default" : ""} ${credential.preview}`);
    }
  }
  return lines.join("\n");
}
