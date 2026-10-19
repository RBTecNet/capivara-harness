/**
 * A ponte entre um papel e um processo de verdade.
 *
 * Os orquestradores recebem esta função por parâmetro; nos testes ela é
 * substituída por um roteiro. É o que permite exercitar init e build inteiros
 * sem tocar em provider real, e o que mantém o custo do desenvolvimento honesto.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withApiCredentials } from "../provider/credentials.js";
import { withOpenRouterOutputLimit } from "../provider/cli/opencode-limits.js";
import {
  buildInvocation,
  createLineSplitter,
  limitsFor,
  readCredentials,
  readTranscript,
  runProvider,
  selectCredential,
  summarizeCodexEvent,
  summarizeOpencodeEvent,
  redact,
} from "../provider/index.js";
import type { FlowReviewPurpose, RoleConfig, RoleName, SupervisorLimits, TokenUsage } from "../provider/index.js";
import { sanitizarTerminal } from "../tui/sanitize.js";

export interface AgentBridgeOptions {
  projectRoot: string;
  runId: string;
  language: string;
  roles: Record<RoleName, RoleConfig>;
  limits: SupervisorLimits;
  credentialsFile?: string;
  /** Permite ao executor instalar pré-requisitos de sistema. */
  systemInstall?: boolean;
  environment?: Record<string, string>;
}

export interface BridgeRequest {
  role: RoleName;
  purpose?: FlowReviewPurpose;
  /** Sessão de reparo explícita do verificador, separada da avaliação somente leitura. */
  repair?: boolean;
  stage: string;
  prompt: string;
  /** Uma linha por acontecimento, enquanto a chamada acontece. */
  onActivity?: (line: string) => void;
  /**
   * Os bytes crus da sessão, assim que chegam, com o fluxo de cada um. É o que
   * o log de cada agente do build paralelo mostra e grava; quem recebe é
   * responsável por sanitizar antes de pôr na tela.
   */
  onOutput?: (chunk: string, stream: "out" | "err") => void;
}

export interface BridgeResponse {
  /** Evidência de geração incompleta; nunca é stdout válido. */
  partialOutput?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: string | null;
  /** Tokens da chamada, quando a CLI os reporta. */
  usage?: TokenUsage;
  /**
   * A CLI emitiu um resultado legível? Ausente quando ela não tem envelope.
   *
   * Isto sobe junto com o texto porque é aqui — e só aqui — que se sabe. Quem
   * recebe o transcrito já desembrulhado não tem como redescobrir o fato lendo
   * o resultado: o envelope ficou para trás. O gate 0 tentava, por regex, e
   * reprovava toda chamada bem-sucedida do claude; foi o que travou o `cron5`
   * na fase 1 com o executor tendo feito o trabalho certo.
   */
  resultRead?: boolean;
  /** A CLI declarou a volta como erro, em vez de simplesmente não responder. */
  engineError?: boolean;
  providerFailure?: "quota" | "configuration";
  /**
   * O que a sessão recusou por permissão, só ferramenta e programa (§106).
   * Ausente quando nada foi recusado, ou quando a CLI não conta.
   */
  negacoes?: string[];
}

const run = promisify(execFile);

/** O diretório comum do Git, absoluto; null fora de um repositório. */
async function diretorioDoGit(raiz: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: raiz });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Onde nasce o `TMPDIR` de uma chamada que o pede: no cache da capivara, fora
 * de `/tmp`. O sandbox do Claude torna `/tmp` ilegível (é onde vivem sockets
 * de outras sessões, do X11 e do acesso remoto), e um temporário lá dentro
 * ficaria inalcançável para o próprio executor (§106).
 */
function pastaDosTemporarios(ambiente: NodeJS.ProcessEnv): string {
  const cache = ambiente.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(cache, "capivara", "tmp");
}

export function createAgentBridge(options: AgentBridgeOptions): (request: BridgeRequest) => Promise<BridgeResponse> {
  return async (request) => {
    if (request.purpose && (request.role !== "verifier" || request.repair)) {
      throw new Error("a revisão do G4 só se aplica ao verificador somente leitura");
    }
    const config = options.roles[request.role];
    const stored = await readCredentials(options.credentialsFile);
    const credential = selectCredential(stored, config.provider, config.credential);

    /*
     * A pasta de trabalho existe ANTES da chamada.
     *
     * O codex recebe `--cd <raiz>`, e com uma pasta que não existe ele responde
     * "Error: No such file or directory" e sai com código ZERO. O survey passa a
     * pasta de SAÍDA como raiz, e ela só era criada depois do mapa: o survey do
     * cronus3 com o codex foi recusado três vezes como "JSON inválido" sem que
     * o modelo tivesse chegado a rodar. Para init, plan e build a pasta já existe
     * e isto não faz nada. E é também o `cwd` do processo (§105): sem a pasta,
     * o `spawn` falharia antes de a CLI começar. E vem antes de montar a
     * invocação, que pergunta ao Git onde está o repositório.
     */
    await mkdir(options.projectRoot, { recursive: true });
    const scopedEnvironment = options.environment ? { ...process.env, ...options.environment } : process.env;
    const environment = config.provider === "opencode"
      ? await withOpenRouterOutputLimit(config.model, withApiCredentials(stored, scopedEnvironment, [config.model.split("/")[0] ?? ""], config.credential), options.projectRoot)
      : options.environment ? scopedEnvironment : undefined;
    const invocation = buildInvocation(request.role, config, {
      projectRoot: options.projectRoot,
      gitDir: await diretorioDoGit(options.projectRoot),
      runId: options.runId,
      stage: request.stage,
      language: options.language,
      ...(environment ? { environment } : {}),
      ...(request.repair === true ? { verifierRepair: true } : {}),
      ...(options.systemInstall !== undefined ? { systemInstall: options.systemInstall } : {}),
      ...(credential ? { secret: credential.secret } : {}),
    });

    /*
     * A atividade é transmitida enquanto a chamada corre, não no fim. Só faz
     * sentido para CLI que fala em eventos; para as demais, não há o que contar
     * antes do resultado.
     */
    const resumir = invocation.transcript === "codex-jsonl" ? summarizeCodexEvent
      : invocation.transcript === "opencode-jsonl" ? summarizeOpencodeEvent : null;
    const observador =
      request.onActivity && resumir
        ? createLineSplitter((line) => {
            const resumo = resumir(line);
            if (resumo) request.onActivity?.(sanitizarTerminal(redact(resumo, invocation.env)).replace(/\n/g, " ").slice(0, 240));
          })
        : null;

    let temporario: string | null = null;
    if (invocation.tmpPrivado) {
      const base = pastaDosTemporarios(invocation.env);
      await mkdir(base, { recursive: true });
      temporario = await mkdtemp(join(base, "chamada-"));
    }

    const result = await runProvider({
      invocation: temporario ? { ...invocation, env: { ...invocation.env, TMPDIR: temporario } } : invocation,
      prompt: request.prompt,
      // Quem não transmite não pode ser medido pelo relógio da primeira saída.
      limits: limitsFor(invocation, options.limits),
      ...(observador || request.onOutput
        ? {
            onOutput: (chunk: string, stream: "out" | "err") => {
              request.onOutput?.(chunk, stream);
              if (stream === "out") observador?.(chunk);
            },
          }
        : {}),
    }).finally(async () => {
      // O que a sessão deixou no temporário não é do projeto e não sobrevive a ela.
      if (temporario) await rm(temporario, { recursive: true, force: true }).catch(() => undefined);
    });

    // O transcrito é lido aqui para que os orquestradores continuem recebendo
    // texto: quem chama não precisa saber que a CLI fala em eventos.
    const transcript = invocation.transcript ? readTranscript(invocation.transcript, result.stdout) : null;

    return {
      exitCode: result.exitCode === 0 && transcript?.error ? 1 : result.exitCode,
      stdout: transcript ? transcript.text : result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      ...(transcript?.usage ? { usage: transcript.usage } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.partialOutput ? { partialOutput: result.partialOutput } : {}),
      ...(result.resultRead !== undefined ? { resultRead: result.resultRead } : {}),
      ...(result.engineError ? { engineError: true } : {}),
      ...(transcript ? { resultRead: !transcript.raw } : {}),
      ...(transcript?.error === true ? { engineError: true } : {}),
      ...(transcript?.providerFailure ? { providerFailure: transcript.providerFailure } : {}),
      ...(transcript?.negacoes ? { negacoes: transcript.negacoes } : {}),
    };
  };
}

export const DEFAULT_LIMITS: SupervisorLimits = {
  /*
   * Uma CLI que não transmite nada antes de terminar transforma este limite num
   * relógio sobre a resposta inteira. O piloto 3 morreu em 300s no levantamento
   * de user-stories.md, com o provider ainda pensando — não travado.
   */
  firstOutputSeconds: 1200,
  idleSeconds: 600,
  wallSeconds: 3600,
  maxOutputBytes: 8 * 1024 * 1024,
};
