/**
 * Persistência da entrevista.
 *
 * Gravada ANTES de cada nova rodada. Ctrl+C no meio de uma entrevista longa não
 * pode custar as respostas já dadas: perguntar duas vezes a mesma coisa é a
 * forma mais rápida de perder a confiança de quem responde.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import type { Handoff } from "./types.js";

export const HANDOFF_CONTRACT = "capivara-handoff/v1" as const;

export function handoffPath(projectRoot: string, runId: string, document: string): string {
  const slug = document.replace(/[^a-z0-9.-]+/gi, "-");
  return join(artifactPaths(projectRoot).handoffs, `${runId}.${slug}.json`);
}

export async function writeHandoff(projectRoot: string, handoff: Handoff): Promise<void> {
  const path = handoffPath(projectRoot, handoff.runId, handoff.document);
  await writeAtomic(path, `${JSON.stringify(handoff, null, 2)}\n`);
}

export async function readHandoff(projectRoot: string, runId: string, document: string): Promise<Handoff | null> {
  try {
    const parsed = JSON.parse(await readFile(handoffPath(projectRoot, runId, document), "utf8")) as Partial<Handoff>;
    if (parsed.contract !== HANDOFF_CONTRACT) return null;
    return parsed as Handoff;
  } catch {
    return null;
  }
}
