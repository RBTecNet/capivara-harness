/** OpenCode. */

import type { CliAdapter } from "./types.js";

/** Nega tudo o que escreve: o papel somente-leitura não contorna a permissão. */
const SOMENTE_LEITURA = '{"edit":"deny","bash":"deny","task":"deny","external_directory":"deny"}';

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
    return access === "read-only" ? { args, env: { ...env, OPENCODE_PERMISSION: SOMENTE_LEITURA } } : { args };
  },
} as const satisfies CliAdapter;
