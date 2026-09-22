/**
 * A ponte entre um papel e um processo de verdade.
 *
 * Os orquestradores recebem esta função por parâmetro; nos testes ela é
 * substituída por um roteiro. É o que permite exercitar init e build inteiros
 * sem tocar em provider real, e o que mantém o custo do desenvolvimento honesto.
 */

import {
  buildInvocation,
  createLineSplitter,
  limitsFor,
  readCredentials,
  readTranscript,
  runProvider,
  selectCredential,
  summarizeCodexEvent,
} from "../provider/index.js";
import type { RoleConfig, RoleName, SupervisorLimits, TokenUsage } from "../provider/index.js";

export interface AgentBridgeOptions {
  projectRoot: string;
  runId: string;
  language: string;
  roles: Record<RoleName, RoleConfig>;
  limits: SupervisorLimits;
  credentialsFile?: string;
  /** Permite ao executor instalar pré-requisitos de sistema. */
  systemInstall?: boolean;
}

export interface BridgeRequest {
  role: RoleName;
  stage: string;
  prompt: string;
  /** Uma linha por acontecimento, enquanto a chamada acontece. */
  onActivity?: (line: string) => void;
}

export interface BridgeResponse {
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
}

export function createAgentBridge(options: AgentBridgeOptions): (request: BridgeRequest) => Promise<BridgeResponse> {
  return async (request) => {
    const config = options.roles[request.role];
    const stored = await readCredentials(options.credentialsFile);
    const credential = selectCredential(stored, config.provider, config.credential);

    const invocation = buildInvocation(request.role, config, {
      projectRoot: options.projectRoot,
      runId: options.runId,
      stage: request.stage,
      language: options.language,
      ...(options.systemInstall !== undefined ? { systemInstall: options.systemInstall } : {}),
      ...(credential ? { secret: credential.secret } : {}),
    });

    /*
     * A atividade é transmitida enquanto a chamada corre, não no fim. Só faz
     * sentido para CLI que fala em eventos; para as demais, não há o que contar
     * antes do resultado.
     */
    const observador =
      request.onActivity && invocation.transcript === "codex-jsonl"
        ? createLineSplitter((line) => {
            const resumo = summarizeCodexEvent(line);
            if (resumo) request.onActivity?.(resumo);
          })
        : null;

    const result = await runProvider({
      invocation,
      prompt: request.prompt,
      // Quem não transmite não pode ser medido pelo relógio da primeira saída.
      limits: limitsFor(invocation, options.limits),
      ...(observador ? { onOutput: (chunk: string, stream: "out" | "err") => stream === "out" && observador(chunk) } : {}),
    });

    // O transcrito é lido aqui para que os orquestradores continuem recebendo
    // texto: quem chama não precisa saber que a CLI fala em eventos.
    const transcript = invocation.transcript ? readTranscript(invocation.transcript, result.stdout) : null;

    return {
      exitCode: result.exitCode,
      stdout: transcript ? transcript.text : result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      ...(transcript?.usage ? { usage: transcript.usage } : {}),
      ...(transcript ? { resultRead: !transcript.raw } : {}),
      ...(transcript?.error === true ? { engineError: true } : {}),
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
