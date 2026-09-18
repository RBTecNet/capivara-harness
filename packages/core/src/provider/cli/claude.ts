/** Claude Code. */

import type { CliAdapter } from "./types.js";

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  binaryEnv: "CAPIVARA_CLAUDE_BIN",
  defaultBinary: "claude",
  transcript: "claude-json",
  build: ({ model, effort, access, env }) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--permission-mode", access === "read-only" ? "plan" : access === "system" ? "bypassPermissions" : "acceptEdits",
    ];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    // O marcador de sessão faz a CLI se comportar como se estivesse aninhada em
    // outra; a chamada aqui é independente e precisa nascer limpa.
    const { CLAUDECODE: _ignorado, ...semMarcador } = env;
    return { args, env: semMarcador };
  },
} as const satisfies CliAdapter;
