/**
 * As CLIs que a capivara sabe chamar.
 *
 * Para acrescentar uma: copie o adaptador mais parecido, ajuste os argumentos e
 * o leitor de transcrito, e cite-o aqui. O resto da ferramenta descobre sozinha
 * — `doctor`, wizard, listagem de providers e validação de flags leem desta
 * lista, e o teste de arquitetura recusa id ou variável de binário repetidos.
 */

import { agyAdapter } from "./agy.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import { customAdapter } from "./custom.js";
import { opencodeAdapter } from "./opencode.js";
import type { CliAdapter } from "./types.js";

export const CLI_ADAPTERS = [codexAdapter, claudeAdapter, opencodeAdapter, agyAdapter, cursorAdapter, customAdapter] as const;

export type CliProviderId = (typeof CLI_ADAPTERS)[number]["id"];

export function isCliProvider(id: string): id is CliProviderId {
  return CLI_ADAPTERS.some((adapter) => adapter.id === id);
}

export function cliAdapter(id: CliProviderId): CliAdapter {
  const found = CLI_ADAPTERS.find((adapter) => adapter.id === id);
  if (!found) throw new Error(`adaptador de CLI desconhecido: ${id}`);
  return found;
}

export type { AccessLevel, CliAdapter, CliInvocation, CliInvocationInput } from "./types.js";
