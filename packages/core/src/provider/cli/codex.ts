/** Codex CLI. */

import type { CliAdapter } from "./types.js";

export const codexAdapter = {
  id: "codex",
  label: "Codex CLI",
  binaryEnv: "CAPIVARA_CODEX_BIN",
  defaultBinary: "codex",
  transcript: "codex-jsonl",
  // Eventos em JSONL, um por acontecimento: dá para ver o trabalho acontecendo.
  streams: true,
  build: ({ projectRoot, model, effort, access }) => {
    /*
     * `--json` não é preferência de formato: é o que torna a chamada observável.
     * Sem ele a CLI fica muda enquanto pensa — indistinguível de travada para o
     * relógio de ocioso —, a resposta precisa ser raspada do relatório de
     * progresso, e o custo em tokens simplesmente não existe.
     */
    const args = [
      "exec",
      "--cd", projectRoot,
      "--skip-git-repo-check",
      "--color", "never",
      "--json",
      "--sandbox", access === "read-only" ? "read-only" : access === "system" ? "danger-full-access" : "workspace-write",
    ];
    if (model) args.push("--model", model);
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
    args.push("-");
    return { args };
  },
  /*
   * Comprovado com codex-cli 0.162.1 (§106): no `workspace-write` o sandbox só
   * bloqueia Unix sockets enquanto a rede está desligada. Com
   * `sandbox_workspace_write.network_access`, um comando alcança o gerenciador
   * do systemd do usuário, e `systemd-run --user` executa fora do sandbox. Sem
   * rede, o executor não instala dependência nenhuma (EAI_AGAIN no piloto-6).
   * As duas metades do contrato não cabem juntas — o build recusa, em vez de
   * escolher uma delas em silêncio.
   */
  workspace: () => ({
    estado: "insuficiente",
    motivo:
      "o sandbox workspace-write do codex só bloqueia Unix sockets com a rede desligada: com rede, um comando " +
      "executa fora do sandbox pelo systemd do usuário; sem rede, o executor não instala dependências",
  }),
} as const satisfies CliAdapter;
