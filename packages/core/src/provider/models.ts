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
import { promisify } from "node:util";
import { CLI_ADAPTERS } from "./cli/index.js";

const run = promisify(execFile);

/** Quanto se espera por uma listagem. Passou disso, o wizard segue sem ela. */
const TIMEOUT_MS = 15_000;

export interface ModelListing {
  /** Como invocar a listagem, quando a CLI tem uma. */
  command: string[];
  /** Transforma a saída bruta nos identificadores que a CLI aceita em `--model`. */
  parse: (stdout: string) => string[];
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
function porSeparador(separador: RegExp): (stdout: string) => string[] {
  return (stdout) =>
    stdout
      .split("\n")
      .map((linha) => linha.trim())
      .filter((linha) => linha !== "" && !linha.startsWith("#"))
      .map((linha) => (linha.split(separador)[0] ?? "").trim())
      .filter((identificador) => IDENTIFICADOR.test(identificador));
}

/** Um identificador de modelo: sem espaço, e não uma frase em prosa. */
const IDENTIFICADOR = /^[a-z0-9][a-z0-9._/-]*$/i;

export const MODEL_LISTINGS: Record<string, ModelListing> = {
  /*
   * O codex responde JSON e marca quais modelos ele quer que apareçam. Respeitar
   * `visibility` é obedecer à própria CLI sobre o que mostrar: dos sete que ela
   * conhece, cinco são para escolher.
   */
  codex: {
    command: ["debug", "models"],
    parse: (stdout) => {
      try {
        const objeto = JSON.parse(stdout) as { models?: { slug?: string; visibility?: string }[] };
        return (objeto.models ?? [])
          .filter((modelo) => modelo.visibility === "list" && typeof modelo.slug === "string")
          .map((modelo) => modelo.slug as string);
      } catch {
        return [];
      }
    },
  },
  claude: { command: [], parse: () => CLAUDE_FAMILIES },
  opencode: { command: ["models"], parse: porSeparador(/\s+/) },
  agy: { command: ["models"], parse: porSeparador(/\t/) },
  cursor: { command: ["models"], parse: porSeparador(/ - /) },
};

/** O binário desta CLI está no PATH? Ausente significa não perguntar nada a ela. */
export async function cliDisponivel(providerId: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const adapter = CLI_ADAPTERS.find((entrada) => entrada.id === providerId);
  if (!adapter || adapter.id === "custom") return false;
  const binary = env[adapter.binaryEnv]?.trim() || adapter.defaultBinary;
  try {
    const { stdout } = await run("which", [binary]);
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
export async function listarModelos(providerId: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const listagem = MODEL_LISTINGS[providerId];
  if (!listagem) return [];
  if (listagem.command.length === 0) return listagem.parse("");
  if (!(await cliDisponivel(providerId, env))) return [];

  const adapter = CLI_ADAPTERS.find((entrada) => entrada.id === providerId);
  const binary = env[adapter?.binaryEnv ?? ""]?.trim() || adapter?.defaultBinary || providerId;

  try {
    const { stdout } = await run(binary, listagem.command, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return [...new Set(listagem.parse(stdout))];
  } catch {
    return [];
  }
}
