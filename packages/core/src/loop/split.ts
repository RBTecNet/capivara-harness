/**
 * Divisor de fases.
 *
 * Consome `parsePhases` — o MESMO módulo que o init usou para validar — e lê
 * `PhaseBlock.markdown`, o recorte que o parser já produziu. Não existe regex
 * de fase aqui, e um teste de arquitetura falha se alguém escrever uma: é
 * exatamente assim que o harness e o loop voltariam a divergir.
 */

import { join } from "node:path";
import { parsePhases } from "../contract/index.js";
import type { ContractError, PhaseBlock } from "../contract/index.js";
import { writeAtomic } from "../state/atomic.js";
import { runPaths } from "../state/paths.js";

export interface PhaseSession {
  /** `P01`, `P02`, … o assunto do run e o nome do arquivo. */
  id: string;
  number: number;
  title: string;
  taskCount: number;
  markdown: string;
  file: string;
  /**
   * As áreas que a fase declara, como vieram do plano.
   *
   * Vazio em plano escrito antes do campo existir — e aí a fase recebe só as
   * skills gerais, que é a degradação certa: nada quebra, e o que é universal
   * continua chegando.
   */
  areas: string;
}

export type SplitResult =
  | { ok: true; sessions: PhaseSession[] }
  | { ok: false; errors: ContractError[] };

export function phaseId(phaseNumber: number): string {
  return `P${String(phaseNumber).padStart(2, "0")}`;
}

export function splitPhases(source: string, projectRoot: string, runId: string): SplitResult {
  const parsed = parsePhases(source);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const directory = runPaths(projectRoot, runId).phases;
  const sessions = parsed.document.phases.map((phase: PhaseBlock) => ({
    id: phaseId(phase.number),
    number: phase.number,
    title: phase.title,
    taskCount: phase.tasks.length,
    markdown: phase.markdown,
    file: join(directory, `${phaseId(phase.number)}.md`),
    areas: phase.areas,
  }));

  return { ok: true, sessions };
}

/** Materializa uma sessão por arquivo, para o operador poder inspecionar. */
export async function materializeSessions(sessions: readonly PhaseSession[]): Promise<void> {
  for (const session of sessions) await writeAtomic(session.file, session.markdown);
}
