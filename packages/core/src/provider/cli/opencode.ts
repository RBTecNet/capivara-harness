/** OpenCode. */

import type { CliAdapter } from "./types.js";

/** Nega tudo o que escreve: o papel somente-leitura não contorna a permissão. */
const SOMENTE_LEITURA = '{"edit":"deny","bash":"deny","task":"deny","external_directory":"deny"}';

/*
 * O executor precisa das permissões declaradas, não herdadas.
 *
 * Sem `OPENCODE_PERMISSION`, a CLI usa o default dela — que nega diretório
 * externo. E ferramenta de build normal usa diretório externo o tempo todo: npm
 * escreve cache em `~/.npm`, Vite e tsc usam `/tmp`. O piloto 6-mimo morreu
 * exatamente assim, na primeira linha da sessão:
 *
 *     Iniciando a configuração do projeto Vite + React 19 + TypeScript.
 *     ! permission requested: external_directory (/tmp/*); auto-rejecting
 *
 * A sessão encerrou sem escrever nada, e o gate 1 relatou "a sessão não escreveu
 * nada" — verdade que escondia a causa. Quem executa recebe o que executar exige,
 * dito por extenso.
 */
const EXECUTOR = '{"edit":"allow","bash":"allow","task":"allow","external_directory":"allow"}';

export const opencodeAdapter = {
  id: "opencode",
  label: "OpenCode",
  binaryEnv: "CAPIVARA_OPENCODE_BIN",
  defaultBinary: "opencode",
  transcript: "opencode-jsonl",
  build: ({ projectRoot, model, effort, access, env }) => {
    const args = ["run", "--dir", projectRoot, "--format", "json"];
    if (model) args.push("--model", model);
    if (effort) args.push("--variant", effort);
    return { args, env: { ...env, OPENCODE_PERMISSION: access === "read-only" ? SOMENTE_LEITURA : EXECUTOR } };
  },
} as const satisfies CliAdapter;
