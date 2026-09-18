/**
 * Adapter próprio.
 *
 * O executável é do operador e recebe o prompt pelo stdin, com a configuração do
 * papel no ambiente. Serve de escape enquanto uma CLI nova não tem adaptador —
 * e de prova de que o contrato de adaptador é pequeno o bastante para caber num
 * script.
 */

import type { CliAdapter } from "./types.js";

export const customAdapter = {
  id: "custom",
  label: "Adapter custom",
  binaryEnv: "CAPIVARA_CUSTOM_BIN",
  defaultBinary: "",
  build: ({ command }) => {
    if (command.trim() === "") throw new Error("o provider custom exige o caminho do executável do adapter");
    return { command: command.trim(), args: [] };
  },
} as const satisfies CliAdapter;
