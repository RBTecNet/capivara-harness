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
} as const satisfies CliAdapter;
