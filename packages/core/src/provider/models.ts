/**
 * Os modelos que cada CLI oferece, perguntados a ela.
 *
 * Existe para o wizard poder numerar opções em vez de exigir que o desenvolvedor
 * saiba o identificador de cor. Cada adaptador diz COMO perguntar — e quem não
 * sabe responder simplesmente não declara nada, como já acontece com o leitor de
 * transcrito.
 *
 * Duas regras governam este módulo, e as duas vêm de como ele vai ser usado:
 *
 * 1. **Falhar aqui nunca derruba quem chamou.** A CLI pode não estar instalada,
 *    pode estar desatualizada, pode mudar o formato da saída amanhã. Qualquer uma
 *    dessas devolve lista vazia, e o wizard volta a pedir o nome digitado — que é
 *    o que ele fazia antes de existir listagem.
 * 2. **Só se pergunta a quem está instalado.** Perguntar a uma CLI ausente é
 *    esperar um erro de processo para descobrir o que `which` responde na hora.
 */

import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { CLI_ADAPTERS } from "./cli/index.js";
import { directProvider, effortsDoModelo, isDirectProvider, raciocinioDoModelo } from "./registry.js";
import { raciocinioNoOpenCode, withDocumentedEffortVariants } from "./cli/opencode-limits.js";
import { credentialsPath, readCredentials, selectCredential, withApiCredentials } from "./credentials.js";

const run = promisify(execFile);

/** Quanto se espera por uma listagem. Passou disso, o wizard segue sem ela. */
const TIMEOUT_MS = 15_000;

export interface ModelListing {
  /** Como invocar a listagem, quando a CLI tem uma. */
  command: string[];
  /** Transforma a saída bruta nos identificadores que a CLI aceita em `--model`. */
  parse: (stdout: string) => string[];
  /**
   * Os níveis de raciocínio que CADA modelo aceita, quando a CLI informa.
   *
   * Existe porque oferecer um nível que o modelo recusa não é um detalhe: a
   * chamada morre com código 1 e uma mensagem de API. O wizard oferecia
   * `minimal` para todo mundo, e nenhum modelo atual do codex aceita esse valor
   * — o run terminava em "o papel writer falhou com código 1 em skeleton",
   * sem que o desenvolvedor tivesse feito nada além de escolher uma opção que
   * lhe foi apresentada.
   */
  efforts?: (stdout: string) => Record<string, string[]>;
  /**
   * Uma dica curta por modelo, quando a saída diz algo que quem escolhe precisa
   * saber: no codex, o modelo que ele esconde do seletor dele.
   */
  dicas?: (stdout: string) => Record<string, string>;
}

/**
 * O Claude resolve a família para a versão corrente sozinho.
 *
 * `--model opus` chega ao Opus atual sem que ninguém precise saber o sufixo de
 * data. Listar as famílias é mais útil do que listar as versões: é o que a pessoa
 * tem em mente, e não envelhece.
 */
export const CLAUDE_FAMILIES = ["opus", "sonnet", "haiku", "fable"];

/**
 * Cada CLI separa o identificador da descrição de um jeito, e a diferença
 * importa: lida errado, a linha de cabeçalho vira um modelo chamado "Available".
 *
 *     cursor:   gpt-5.3-codex-low - Codex 5.3 Low     (hífen cercado de espaço)
 *     agy:      gemini-3.8-flash-high\tGemini 3.8…     (tabulação)
 *     opencode: opencode/big-pickle                    (só o identificador)
 *
 * `separador` é o que divide identificador de descrição naquela CLI. Quando ele
 * não aparece na linha, a linha inteira precisa ser um identificador válido —
 * é isso que descarta "Available models" e "Fetching available models…".
 */
function porSeparador(separador?: RegExp): (stdout: string) => string[] {
  return (stdout) =>
    stripVTControlCharacters(stdout)
      .split("\n")
      .map((linha) => linha.trim())
      .filter((linha) => linha !== "" && !linha.startsWith("#"))
      .map((linha) => separador ? (linha.split(separador)[0] ?? "").trim() : linha)
      .filter((identificador) => IDENTIFICADOR.test(identificador));
}

/** Um identificador de modelo: sem espaço, e não uma frase em prosa. */
const IDENTIFICADOR = /^[a-z0-9][a-z0-9._:/-]*$/i;

interface CodexModel {
  slug: string;
  visibility?: string;
}

/** Contrato observado no codex-cli 0.163.0: debug models. */
function codexModels(stdout: string): CodexModel[] {
  try {
    const objeto = JSON.parse(stdout) as { models?: { slug?: unknown; visibility?: string }[] };
    return (objeto.models ?? []).filter((modelo): modelo is CodexModel => typeof modelo.slug === "string");
  } catch {
    return [];
  }
}

interface OpenCodeModel {
  id: string;
  providerID: string;
  enabled?: boolean;
  variants?: { id?: unknown }[];
}

/** Contrato observado no OpenCode 2.0.32: api model.list --standalone. */
function opencodeModels(stdout: string): OpenCodeModel[] | null {
  try {
    const body: unknown = JSON.parse(stdout);
    const data = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return null;
    return data.filter((model): model is OpenCodeModel => typeof model?.id === "string" && typeof model?.providerID === "string" && model.enabled !== false && IDENTIFICADOR.test(model.id) && IDENTIFICADOR.test(model.providerID));
  } catch { return null; }
}

export const MODEL_LISTINGS: Record<string, ModelListing> = {
  /*
   * O codex responde JSON e marca, em `visibility`, os modelos que o seletor
   * dele mostra. Os outros ele aceita em `--model` do mesmo jeito: nada na saída
   * diz que os recusa. Vêm todos — primeiro os que ele mostra, depois os outros,
   * com a dica —, na ordem em que ele os devolve.
   */
  codex: {
    command: ["debug", "models"],
    parse: (stdout) => {
      const modelos = codexModels(stdout);
      return [...modelos.filter((modelo) => modelo.visibility === "list"), ...modelos.filter((modelo) => modelo.visibility !== "list")].map((modelo) => modelo.slug);
    },
    dicas: (stdout) => Object.fromEntries(codexModels(stdout).filter((modelo) => modelo.visibility !== "list").map((modelo) => [modelo.slug, "o codex o esconde da própria lista"])),
    efforts: (stdout) => {
      try {
        const objeto = JSON.parse(stdout) as {
          models?: { slug?: string; supported_reasoning_levels?: { effort?: string }[] }[];
        };
        const mapa: Record<string, string[]> = {};
        for (const modelo of objeto.models ?? []) {
          if (typeof modelo.slug !== "string") continue;
          if (!Array.isArray(modelo.supported_reasoning_levels)) continue;
          mapa[modelo.slug] = (modelo.supported_reasoning_levels ?? [])
            .map((nivel) => nivel.effort)
            .filter((nivel): nivel is string => typeof nivel === "string");
        }
        return mapa;
      } catch {
        return {};
      }
    },
  },
  claude: { command: [], parse: () => CLAUDE_FAMILIES },
  // A linha inteira é o identificador; separar por espaço aceitava avisos
  // como "Available models" como se "Available" fosse um modelo.
  opencode: {
    command: ["api", "model.list", "--standalone"],
    parse: (stdout) => {
      const models = opencodeModels(stdout);
      return models ? models.map((model) => `${model.providerID}/${model.id}`) : porSeparador()(stdout);
    },
    efforts: (stdout) => Object.fromEntries((opencodeModels(stdout) ?? []).filter((model) => Array.isArray(model.variants)).map((model) => [
      `${model.providerID}/${model.id}`,
      [...new Set(model.variants!.map((variant) => variant?.id).filter((id): id is string => typeof id === "string" && IDENTIFICADOR.test(id)))],
    ])),
  },
  agy: { command: ["models"], parse: porSeparador(/\t/) },
  cursor: { command: ["models"], parse: porSeparador(/ - /) },
};

/** O binário desta CLI está no PATH? Ausente significa não perguntar nada a ela. */
export async function cliDisponivel(providerId: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const adapter = CLI_ADAPTERS.find((entrada) => entrada.id === providerId);
  if (!adapter || adapter.id === "custom") return false;
  const binary = env[adapter.binaryEnv]?.trim() || adapter.defaultBinary;
  try {
    const { stdout } = await run("which", [binary], { env });
    return stdout.trim() !== "";
  } catch {
    return false;
  }
}

/**
 * Os modelos deste provider, ou lista vazia quando não dá para saber.
 *
 * Vazio não é erro: é a resposta honesta para "esta CLI não sabe listar", "não
 * está instalada" ou "respondeu algo que não entendo". Quem chamou decide o que
 * fazer, e no caso do wizard é voltar a pedir o nome digitado.
 */
export async function listarModelos(
  providerId: string,
  env: NodeJS.ProcessEnv = process.env,
  credentialsFile?: string,
  onDiagnostic?: (message: string) => void,
): Promise<string[]> {
  if (isDirectProvider(providerId)) {
    const provider = directProvider(providerId);
    const secret = selectCredential(await readCredentials(credentialsFile ?? credentialsPath(undefined, env)), providerId, "")?.secret || env[provider.envKey];
    if (!secret) {
      onDiagnostic?.(`${providerId}: nenhuma chave encontrada nesta configuração. Use capivara login ${providerId}.`);
      return [];
    }
    const endpoint = provider.modelsEndpoint ?? provider.endpoint.replace(/(?:chat\/completions|messages)$/, "models");
    const headers: Record<string, string> = provider.dialect === "anthropic-messages"
      ? { "x-api-key": secret, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${secret}` };
    try {
      const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
      if (!response.ok) {
        const reason = response.status === 401 || response.status === 403 ? "a API recusou a credencial ou o acesso" : response.status === 429 ? "a API limitou as consultas; tente novamente depois" : "a API não conseguiu retornar os modelos";
        onDiagnostic?.(`${providerId}: HTTP ${response.status} ao listar modelos — ${reason}.`);
        return [];
      }
      const body = await response.json() as { data?: { id?: unknown }[] };
      if (!Array.isArray(body?.data)) {
        onDiagnostic?.(`${providerId}: a API respondeu sem uma lista de modelos reconhecível.`);
        return [];
      }
      return [...new Set(body.data.map((m) => m?.id).filter((id): id is string => typeof id === "string" && IDENTIFICADOR.test(id)))];
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      onDiagnostic?.(`${providerId}: ${timeout ? "o tempo de consulta dos modelos esgotou" : "não foi possível consultar os modelos; verifique a conexão e tente novamente"}.`);
      return [];
    }
  }
  const listagem = MODEL_LISTINGS[providerId];
  if (!listagem) return [];
  if (listagem.command.length === 0) return listagem.parse("");
  if (!(await cliDisponivel(providerId, env))) return [];

  const adapter = CLI_ADAPTERS.find((entrada) => entrada.id === providerId);
  const binary = env[adapter?.binaryEnv ?? ""]?.trim() || adapter?.defaultBinary || providerId;

  try {
    const childEnv = providerId === "opencode" ? withApiCredentials(await readCredentials(credentialsFile ?? credentialsPath(undefined, env)), env) : env;
    const { stdout } = await run(binary, listagem.command, { env: childEnv, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return [...new Set(listagem.parse(stdout))];
  } catch {
    return [];
  }
}

/** As dicas por modelo desta CLI; vazio quando ela não diz nada ou não responde. */
export async function listarDicas(providerId: string, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const listagem = MODEL_LISTINGS[providerId];
  if (!listagem?.dicas || listagem.command.length === 0 || !(await cliDisponivel(providerId, env))) return {};
  const adapter = CLI_ADAPTERS.find((entrada) => entrada.id === providerId);
  const binary = env[adapter?.binaryEnv ?? ""]?.trim() || adapter?.defaultBinary || providerId;
  try {
    const { stdout } = await run(binary, listagem.command, { env, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return listagem.dicas(stdout);
  } catch {
    return {};
  }
}

/**
 * null significa informação indisponível; [] é um modelo conhecido sem variantes.
 */
export async function listarEfforts(
  providerId: string,
  modelo: string,
  env: NodeJS.ProcessEnv = process.env,
  credentialsFile?: string,
): Promise<string[] | null> {
  // API direta: a listagem dela não diz capacidade; vale o que a documentação do provider declara (§131).
  if (isDirectProvider(providerId)) {
    const documentado = raciocinioDoModelo(directProvider(providerId), modelo);
    return documentado ? effortsDoModelo(documentado) : null;
  }
  const listagem = MODEL_LISTINGS[providerId];
  if (!listagem?.efforts || listagem.command.length === 0) return null;
  /*
   * Os níveis que a chamada injeta no OpenCode (§131) valem mesmo quando a CLI
   * não responde à consulta: sem eles, o wizard cairia na lista genérica, cujo
   * "desligado" é, para o M3.1-Flash, o `max` da API.
   */
  const niveis = providerId === "opencode" ? raciocinioNoOpenCode(modelo)?.raciocinio.niveis ?? [] : [];
  const injetados = niveis.length > 0 ? [...niveis] : null;
  if (!(await cliDisponivel(providerId, env))) return injetados;

  const adapter = CLI_ADAPTERS.find((entrada) => entrada.id === providerId);
  const binary = env[adapter?.binaryEnv ?? ""]?.trim() || adapter?.defaultBinary || providerId;

  let childEnv: NodeJS.ProcessEnv;
  try {
    // A mesma configuração que a chamada recebe: o OpenCode lista as variantes que de fato aceitaria.
    childEnv = providerId === "opencode" ? withDocumentedEffortVariants(modelo, withApiCredentials(await readCredentials(credentialsFile ?? credentialsPath(undefined, env)), env, [modelo.split("/")[0] ?? ""])) : env;
  } catch {
    // Configuração do OpenCode ilegível: a chamada também a recusaria, e nada se oferece.
    return null;
  }
  try {
    const { stdout } = await run(binary, listagem.command, { env: childEnv, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return listagem.efforts(stdout)[modelo] ?? injetados;
  } catch {
    return injetados;
  }
}
