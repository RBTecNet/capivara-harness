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
      /*
       * O executor roda sem sandbox e sem aprovação (§112). Com
       * `danger-full-access` a CLI ainda recusava comandos pela regra de
       * aprovação: no `teste_luna` um `rm -f` de limpeza voltou "rejected: rm -f
       * style command". O somente-leitura dos papéis que julgam não muda.
       */
      ...(access === "read-only" ? ["--sandbox", "read-only"] : ["--dangerously-bypass-approvals-and-sandbox"]),
    ];
    if (model) args.push("--model", model);
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
    args.push("-");
    return { args };
  },
  // Sem sandbox, o nível workspace não confina nada (§112): a limitação é dita, e o build segue.
  workspace: () => ({
    estado: "nao-verificado",
    motivo:
      "o executor codex roda com --dangerously-bypass-approvals-and-sandbox: tem acesso amplo ao sistema, à rede e " +
      "aos arquivos do usuário, sem sandbox (§112)",
  }),
} as const satisfies CliAdapter;
