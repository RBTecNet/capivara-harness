/**
 * Staging e publicação atômica.
 *
 * Nada chega a `.capivara/init/` antes de passar em tudo: o documento é escrito
 * numa área do run, validado lá, e só então publicado. Interrupção no meio
 * nunca deixa meio documento na árvore final, e um documento reprovado nunca
 * chega a existir onde o loop iria procurá-lo.
 */

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { artifactPaths, runPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";

export interface StagedDocument {
  /** Nome do arquivo dentro de `.capivara/init/`. Nunca um caminho. */
  name: string;
  content: string;
}

export class DocumentNameError extends Error {
  constructor(name: string) {
    super(`nome de documento inválido: ${name}. Use apenas o nome do arquivo, sem diretórios nem caminho relativo.`);
    this.name = "DocumentNameError";
  }
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertDocumentName(name: string): void {
  if (!SAFE_NAME.test(name) || name.includes("..")) throw new DocumentNameError(name);
}

export function stagingRoot(projectRoot: string, runId: string): string {
  return join(runPaths(projectRoot, runId).root, "staging");
}

export async function stage(projectRoot: string, runId: string, documents: StagedDocument[]): Promise<string> {
  const root = stagingRoot(projectRoot, runId);
  for (const document of documents) {
    assertDocumentName(document.name);
    await writeAtomic(join(root, document.name), document.content);
  }
  return root;
}

export async function readStaged(projectRoot: string, runId: string, name: string): Promise<string | null> {
  assertDocumentName(name);
  try {
    return await readFile(join(stagingRoot(projectRoot, runId), name), "utf8");
  } catch {
    return null;
  }
}

/** Publica na árvore final. Só documentos já aprovados chegam aqui. */
export async function publish(projectRoot: string, documents: StagedDocument[]): Promise<string[]> {
  const init = artifactPaths(projectRoot).init;
  const published: string[] = [];
  for (const document of documents) {
    assertDocumentName(document.name);
    const target = join(init, document.name);
    await writeAtomic(target, document.content);
    published.push(target);
  }
  return published;
}

export async function discardStaging(projectRoot: string, runId: string): Promise<void> {
  await rm(stagingRoot(projectRoot, runId), { recursive: true, force: true });
}
