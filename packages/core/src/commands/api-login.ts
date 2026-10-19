import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import type { Readable, Writable } from "node:stream";
import { DIRECT_CATALOG, directProvider, isDirectProvider } from "../provider/registry.js";
import { credentialsPath, readCredentials, saveCredential, selectCredential } from "../provider/credentials.js";
import { InputEndedError, type LineIO } from "./line-io.js";
import { createPrivateLineInput } from "./private-input.js";
import type { Choice } from "../tui/wizard.js";
import { checkOpenRouterKey } from "../provider/openrouter-key.js";

export type ApiLoginIO = LineIO & {
  secret?: (prompt: string) => Promise<string>;
  select?: (title: string, choices: readonly Choice[], defaultIndex: number) => Promise<number>;
};

export interface ApiLoginOptions {
  environment?: NodeJS.ProcessEnv;
  credentialsFile?: string;
  force?: boolean;
}

async function choose(io: ApiLoginIO, title: string, choices: readonly Choice[]): Promise<number> {
  if (io.select) return io.select(title, choices, 0);
  io.write(`\n${title}\n${choices.map((c, i) => `  ${i + 1}) ${c.label}`).join("\n")}\n`);
  for (;;) {
    const answer = (await io.ask("Escolha [1]: ")).trim() || "1";
    if (/^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= choices.length) return Number(answer) - 1;
    io.write(`Escolha de 1 a ${choices.length}.\n`);
  }
}

/** Falha de rede não obriga trocar a chave: permite repetir só a consulta. */
async function checkKey(provider: string, secret: string, io: ApiLoginIO): Promise<{ status: "valid" | "invalid" | "cancelled"; reason: string }> {
  if (provider !== "openrouter") return { status: "valid", reason: "" };
  for (;;) {
    io.write("OpenRouter: verificando se a chave permite geração…\n");
    const result = await checkOpenRouterKey(secret);
    if (result.status === "valid") return { status: "valid", reason: result.reason };
    io.write(`${result.reason}\n`);
    if (result.status === "invalid") return { status: "invalid", reason: result.reason };
    if (await choose(io, "Verificar a chave do OpenRouter?", [{ label: "tentar novamente" }, { label: "voltar ao provider" }]) === 1) return { status: "cancelled", reason: "" };
  }
}

/** Configura antes da listagem; nunca pede segredo num campo que tenha eco. */
export async function ensureApiCredential(provider: string, io: ApiLoginIO, options: ApiLoginOptions = {}): Promise<boolean> {
  if (!isDirectProvider(provider)) return true;
  const environment = options.environment ?? process.env;
  const file = options.credentialsFile ?? credentialsPath(undefined, environment);
  const definition = directProvider(provider);
  const saved = selectCredential(await readCredentials(file), provider, "");
  const currentKey = (typeof saved?.secret === "string" ? saved.secret.trim() : "") || environment[definition.envKey]?.trim();
  const rejected = new Map<string, string>();
  if (!options.force && currentKey) {
    const check = await checkKey(provider, currentKey, io);
    if (check.status === "valid") return true;
    if (check.status === "cancelled") return false;
    rejected.set(currentKey, check.reason);
  }
  if (!options.force) {
    io.write(`\n${definition.label}: ${currentKey ? "a chave configurada não permite geração" : "nenhuma chave de API configurada"}.\n`);
    if (await choose(io, "Configurar esta API?", [{ label: currentKey ? "substituir chave de API" : "configurar chave de API" }, { label: "voltar ao provider" }]) === 1) return false;
  }
  if (!io.secret) {
    io.write("Entrada oculta indisponível; configure com capivara login e tente novamente.\n");
    return false;
  }
  let secret: string;
  for (;;) {
    if (provider === "openrouter") io.write("Use uma chave de API para geração (não de gerenciamento):\nhttps://openrouter.ai/settings/keys\n");
    secret = (await io.secret(`Chave de API de ${definition.label} (oculta; vazio cancela): `)).trim();
    if (secret === "") return false;
    if (!/^[!-~]+$/.test(secret)) {
      io.write("A chave deve conter apenas caracteres imprimíveis, sem espaços.\n");
    } else {
      const previousReason = rejected.get(secret);
      if (previousReason !== undefined) {
        io.write(`Esta chave já foi recusada nesta configuração.\n${previousReason}\n`);
      } else {
        const check = await checkKey(provider, secret, io);
        if (check.status === "valid") break;
        if (check.status === "cancelled") return false;
        rejected.set(secret, check.reason);
      }
    }
    if (await choose(io, `${definition.label}: Chave recusada — como continuar?`, [
      { label: "voltar ao provider", hint: "a chave anterior será preservada" },
      { label: "digitar outra chave", hint: "informe uma chave diferente da que foi recusada" },
    ]) === 0) return false;
  }
  try {
    await saveCredential({ id: saved?.id ?? `${provider}-${randomUUID()}`, label: saved?.label ?? "principal", provider, secret, default: true, createdAt: saved?.createdAt ?? new Date().toISOString() }, file);
  } catch {
    io.write("Não foi possível salvar a chave de API. Confira as permissões da pasta de configuração.\n");
    return false;
  }
  io.write(`${definition.label}: chave salva para as próximas execuções.\n`);
  return true;
}

export async function configureApiWithIO(io: ApiLoginIO, options: ApiLoginOptions = {}, provider?: string): Promise<void> {
  const selected = provider ?? DIRECT_CATALOG[await choose(io, "Qual API configurar?", DIRECT_CATALOG.map((p) => ({ label: p.id })))]?.id;
  if (!selected || !isDirectProvider(selected)) {
    io.write(`API desconhecida. Escolha: ${DIRECT_CATALOG.map((p) => p.id).join(", ")}.\n`);
    process.exitCode = 2;
    return;
  }
  if (!(await ensureApiCredential(selected, io, { ...options, force: true }))) process.exitCode = 2;
}

export async function configureApi(provider: string | undefined, options: ApiLoginOptions & { input?: Readable; output?: Writable } = {}): Promise<void> {
  const entry = createPrivateLineInput(options.input ?? process.stdin, options.output ?? process.stdout);
  try {
    await configureApiWithIO(entry.io, options, provider);
  } catch (error) {
    if (!(error instanceof InputEndedError)) throw error;
    entry.io.write("Configuração de API cancelada; nenhuma chave foi salva.\n");
  } finally { entry.close(); }
}

export function registerApiLogin(program: Command): void {
  program.command("login [provider]").description("Configura uma chave de API com entrada oculta")
    .action(async (provider?: string) => { await configureApi(provider); });
}
