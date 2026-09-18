/**
 * A ponte entre um papel e um processo de verdade.
 *
 * Os orquestradores recebem esta função por parâmetro; nos testes ela é
 * substituída por um roteiro. É o que permite exercitar init e build inteiros
 * sem tocar em provider real, e o que mantém o custo do desenvolvimento honesto.
 */

import { buildInvocation, readCredentials, runProvider, selectCredential } from "../provider/index.js";
import type { RoleConfig, RoleName, SupervisorLimits } from "../provider/index.js";

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
}

export interface BridgeResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: string | null;
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

    const result = await runProvider({ invocation, prompt: request.prompt, limits: options.limits });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
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
