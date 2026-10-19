/**
 * Armazenamento local de credenciais.
 *
 * O arquivo é criado com permissão 0600 e o segredo nunca aparece em argumento
 * de processo, em log ou na tela: ele viaja apenas pelo ambiente da invocação.
 */

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "../state/atomic.js";
import { mask } from "./redact.js";
import { DIRECT_CATALOG, opencodeProviderId } from "./registry.js";

export const CREDENTIALS_CONTRACT = "capivara-credentials/v1" as const;

export interface CredentialRecord {
  id: string;
  label: string;
  provider: string;
  secret: string;
  default: boolean;
  createdAt: string;
}

/** O que pode ser exibido: tudo menos o segredo. */
export interface SafeCredential {
  id: string;
  label: string;
  provider: string;
  default: boolean;
  createdAt: string;
  preview: string;
}

interface CredentialFile {
  contract: typeof CREDENTIALS_CONTRACT;
  credentials: CredentialRecord[];
}

export function credentialsPath(home = homedir(), environment: NodeJS.ProcessEnv = process.env): string {
  return join(environment.CAPIVARA_CONFIG_DIR?.trim() || join(home, ".config", "capivara"), "credentials.json");
}

export async function readCredentials(path = credentialsPath()): Promise<CredentialRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<CredentialFile>;
    if (parsed.contract !== CREDENTIALS_CONTRACT || !Array.isArray(parsed.credentials)) return [];
    return parsed.credentials;
  } catch {
    return [];
  }
}

export async function writeCredentials(records: CredentialRecord[], path = credentialsPath()): Promise<void> {
  const file: CredentialFile = { contract: CREDENTIALS_CONTRACT, credentials: records };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function saveCredential(record: CredentialRecord, path = credentialsPath()): Promise<void> {
  const existing = await readCredentials(path);
  const others = existing.filter((entry) => entry.id !== record.id);
  const records = record.default
    ? [...others.map((entry) => (entry.provider === record.provider ? { ...entry, default: false } : entry)), record]
    : [...others, record];
  await writeCredentials(records, path);
}

export async function removeCredential(id: string, path = credentialsPath()): Promise<boolean> {
  const existing = await readCredentials(path);
  const remaining = existing.filter((entry) => entry.id !== id);
  if (remaining.length === existing.length) return false;
  await writeCredentials(remaining, path);
  return true;
}

export async function forgetAll(path = credentialsPath()): Promise<void> {
  await rm(path, { force: true });
}

export function toSafe(record: CredentialRecord): SafeCredential {
  return {
    id: record.id,
    label: record.label,
    provider: record.provider,
    default: record.default,
    createdAt: record.createdAt,
    preview: mask(record.secret),
  };
}

/** Resolve por id, por label, ou o default do provider. */
export function selectCredential(
  records: CredentialRecord[],
  provider: string,
  selector: string,
): CredentialRecord | null {
  const ofProvider = records.filter((record) => record.provider === provider);
  if (selector.trim() !== "") {
    return ofProvider.find((record) => record.id === selector || record.label === selector) ?? null;
  }
  return ofProvider.find((record) => record.default) ?? ofProvider[0] ?? null;
}

/** Ambiente de um subprocesso OpenCode; não grava nem altera o ambiente do harness. */
export function withApiCredentials(
  records: CredentialRecord[],
  environment: NodeJS.ProcessEnv,
  providers: readonly string[] = DIRECT_CATALOG.map((provider) => provider.id),
  selector = "",
): NodeJS.ProcessEnv {
  const env = { ...environment };
  for (const provider of DIRECT_CATALOG) {
    if (!providers.includes(provider.id) && !providers.includes(opencodeProviderId(provider.id))) continue;
    if (!selector && env[provider.envKey]?.trim()) continue;
    const credential = selectCredential(records, provider.id, selector);
    if (typeof credential?.secret === "string" && credential.secret.trim()) env[provider.envKey] = credential.secret;
  }
  return env;
}
