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
import { cliProvider, decideReasoning, directProvider, isCliProvider, isDirectProvider } from "./registry.js";

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
  transcript?: "codex-jsonl";
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
    };
  }

  if (!isCliProvider(config.provider)) {
    throw new Error(`provider desconhecido: ${config.provider || "(vazio)"}`);
  }

  if (config.provider === "custom") {
    if (config.command.trim() === "") throw new Error("o provider custom exige o caminho do executável do adapter");
    return { command: config.command.trim(), args: [], env, stdinIsPrompt: true };
  }

  const cli = cliProvider(config.provider);
  const binary = env[cli.binaryEnv]?.trim() || cli.defaultBinary;

  if (config.provider === "codex") {
    /*
     * `--json` não é preferência de formato: é o que torna a chamada observável.
     * Sem ele a CLI fica muda enquanto pensa — indistinguível de travada para o
     * relógio de ocioso —, a resposta precisa ser raspada do relatório de
     * progresso, e o custo em tokens simplesmente não existe.
     */
    const args = [
      "exec",
      "--cd", context.projectRoot,
      "--skip-git-repo-check",
      "--color", "never",
      "--json",
      "--sandbox", readOnly ? "read-only" : systemAccess ? "danger-full-access" : "workspace-write",
    ];
    if (model) args.push("--model", model);
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
    args.push("-");
    return { command: binary, args, env, stdinIsPrompt: true, transcript: "codex-jsonl" };
  }

  if (config.provider === "claude") {
    const args = ["-p", "--output-format", "json", "--permission-mode", readOnly ? "plan" : systemAccess ? "bypassPermissions" : "acceptEdits"];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    const { CLAUDECODE: _ignored, ...withoutMarker } = env;
    return { command: binary, args, env: withoutMarker, stdinIsPrompt: true };
  }

  const args = ["run", "--dir", context.projectRoot, "--format", "json"];
  if (model) args.push("--model", model);
  if (effort) args.push("--variant", effort);
  return {
    command: binary,
    args,
    env: readOnly
      ? { ...env, OPENCODE_PERMISSION: '{"edit":"deny","bash":"deny","task":"deny","external_directory":"deny"}' }
      : env,
    stdinIsPrompt: true,
  };
}
