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
import type { CliAdapter, ContratoDaRetomada, ContratoDoWorkspace } from "./types.js";

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

/** O contrato do nível `workspace` do executor neste provider (§106); null fora das CLIs. */
export function contratoDoWorkspace(id: string, platform: NodeJS.Platform = process.platform): ContratoDoWorkspace | null {
  return isCliProvider(id) ? cliAdapter(id).workspace(platform) : null;
}

/**
 * Como o provider retoma uma sessão gravada (§125 E); null quando não retoma —
 * API direta, adaptador custom, ou CLI que não declara. Nunca simular.
 */
export function contratoDaRetomada(id: string): ContratoDaRetomada | null {
  return isCliProvider(id) ? cliAdapter(id).retomada ?? null : null;
}

export type { AccessLevel, CliAdapter, CliInvocation, CliInvocationInput, ContratoDaRetomada, ContratoDoWorkspace } from "./types.js";
