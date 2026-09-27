/**
 * Construção da invocação de cada provider.
 *
 * Funções puras: recebem papel e configuração, devolvem comando, argumentos e
 * ambiente. Nada aqui executa nada, e é por isso que a fronteira mais delicada
 * do produto — qual sandbox cada papel recebe — pode ser testada sem subir um
 * único processo.
 *
 * O prompt viaja SEMPRE por stdin. Passá-lo como argumento o exporia em `ps`
 * para qualquer usuário da máquina e esbarraria no limite de `argv`.
 */

import { ROLES, type RoleConfig, type RoleName } from "./roles.js";
import { decideReasoning, directProvider, isCliProvider, isDirectProvider } from "./registry.js";
import { cliAdapter } from "./cli/index.js";
import type { TranscriptKind } from "./transcript.js";
import type { SupervisorLimits } from "./supervisor.js";

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/;

export interface InvocationContext {
  /** Liga o acesso de sistema do executor. Desligado, ele fica no workspace. */
  systemInstall?: boolean;
  projectRoot: string;
  runId: string;
  stage: string;
  language: string;
  telemetryFile?: string;
  /** Segredo resolvido para providers de API direta. Nunca vira argumento. */
  secret?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface Invocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** O que será escrito no stdin do processo. */
  stdinIsPrompt: true;
  /** Como ler o que a CLI escreveu. Ausente significa texto puro. */
  transcript?: TranscriptKind;
  /** A CLI escreve enquanto trabalha? Decide se o limite de primeira saída vale. */
  streams: boolean;
}

/**
 * Os limites desta chamada.
 *
 * O limite de PRIMEIRA SAÍDA existe para pegar o provider que nunca começou.
 * Numa CLI que só imprime o resultado no fim, "não escreveu nada ainda" é o
 * estado normal de quem está trabalhando, e o limite deixa de medir o que
 * promete: vira um relógio sobre a resposta inteira, e mata a chamada longa que
 * ia dar certo. Foi o que aconteceu na fase 3 do MCP_teste — o executor foi
 * encerrado aos 20 minutos, sem uma linha de saída, e o ciclo de correção foi
 * cobrado como se o código estivesse errado.
 *
 * Quem não transmite fica sob o limite de PAREDE, que mede o que realmente
 * importa nesse caso: a chamada inteira passou do tempo aceitável.
 */
export function limitsFor(invocation: Invocation, limits: SupervisorLimits): SupervisorLimits {
  /*
   * E o de OCIOSO também, pelo mesmo motivo. Ele começa a contar na primeira
   * coisa que o processo escreve — um aviso no stderr basta —, e numa CLI que só
   * responde no fim o silêncio depois disso é o trabalho acontecendo. O survey do
   * cronus3 morreu assim com o claude, lendo um domínio de 56 arquivos: "encerrada
   * por limite do harness (idle)". Tirar só o de primeira saída foi a correção
   * pela metade.
   */
  return invocation.streams ? limits : { ...limits, firstOutputSeconds: 0, idleSeconds: 0 };
}

function safe(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (!SAFE_TOKEN.test(trimmed)) throw new Error(`${field} inválido: ${value}`);
  return trimmed;
}

function baseEnvironment(role: RoleName, config: RoleConfig, context: InvocationContext): NodeJS.ProcessEnv {
  const definition = ROLES[role];
  return {
    ...(context.environment ?? process.env),
    CAPIVARA_ROLE: role,
    CAPIVARA_PROJECT_ROOT: context.projectRoot,
    CAPIVARA_RUN_ID: context.runId,
    CAPIVARA_STAGE: context.stage,
    CAPIVARA_LANGUAGE: context.language,
    CAPIVARA_PROVIDER: config.provider,
    CAPIVARA_MODEL: config.model,
    CAPIVARA_EFFORT: config.effort,
    CAPIVARA_PERMISSION: definition.permission,
    ...(context.telemetryFile ? { CAPIVARA_TELEMETRY_FILE: context.telemetryFile } : {}),
  };
}

export function buildInvocation(role: RoleName, config: RoleConfig, context: InvocationContext): Invocation {
  const definition = ROLES[role];
  const model = safe(config.model, "modelo");
  const effort = safe(config.effort, "effort");
  const env = baseEnvironment(role, config, context);
  const readOnly = definition.permission === "read-only";
  // Acesso de sistema é do executor, e só quando o operador liga.
  const systemAccess = !readOnly && definition.systemInstall && context.systemInstall === true;
  if (systemAccess) env.CAPIVARA_SYSTEM_INSTALL = "1";

  if (isDirectProvider(config.provider)) {
    if (definition.requiresCli) {
      throw new Error(
        `o papel ${role} (${definition.label}) precisa escrever arquivos e rodar comandos, o que exige uma CLI ` +
          `(codex, claude ou opencode) ou um adapter custom; ${config.provider} é uma API direta`,
      );
    }
    const provider = directProvider(config.provider);
    if (model === "") throw new Error(`o provider ${provider.id} exige --${role}-model explícito`);
    const reasoning = decideReasoning(provider, effort);
    return {
      command: process.execPath,
      args: ["--capivara-direct-api"],
      env: {
        ...env,
        CAPIVARA_DIRECT_ENDPOINT: provider.endpoint,
        CAPIVARA_DIRECT_DIALECT: provider.dialect,
        CAPIVARA_DIRECT_REASONING: reasoning.enabled ? (reasoning.effort ?? "") : "",
        ...(context.secret ? { [provider.envKey]: context.secret } : {}),
      },
      stdinIsPrompt: true,
      // A ponte de API direta devolve a resposta de uma vez, como as CLIs de
      // objeto único.
      streams: false,
    };
  }

  if (!isCliProvider(config.provider)) {
    throw new Error(`provider desconhecido: ${config.provider || "(vazio)"}`);
  }

  /*
   * Daqui para baixo quem decide é o adaptador da CLI. Cada uma vive no próprio
   * arquivo sob `cli/`, e acrescentar outra é escrever um arquivo e citá-lo na
   * lista — nada de mais um `if` aqui dentro.
   */
  const adapter = cliAdapter(config.provider);
  const binary = env[adapter.binaryEnv]?.trim() || adapter.defaultBinary;
  const built = adapter.build({
    projectRoot: context.projectRoot,
    model,
    effort,
    access: readOnly ? "read-only" : systemAccess ? "system" : "workspace",
    binary,
    env,
    command: config.command,
  });

  return {
    command: built.command ?? binary,
    args: built.args,
    env: built.env ?? env,
    stdinIsPrompt: true,
    streams: adapter.streams,
    ...(adapter.transcript ? { transcript: adapter.transcript } : {}),
  };
}
