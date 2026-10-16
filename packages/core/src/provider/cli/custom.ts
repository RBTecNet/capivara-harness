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
  // Executável de terceiro: não temos como prometer que ele transmite.
  streams: false,
  build: ({ command }) => {
    if (command.trim() === "") throw new Error("o provider custom exige o caminho do executável do adapter");
    return { command: command.trim(), args: [] };
  },
  // Quem isola é o adapter do operador, e o harness não o vê por dentro.
  workspace: () => ({
    estado: "nao-verificado",
    motivo: "o adapter custom decide sozinho o isolamento e a rede do executor",
  }),
} as const satisfies CliAdapter;
