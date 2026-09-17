/**
 * Criação da árvore de artefatos.
 *
 * Escreve `.capivara/.gitignore` ignorando `runs/`: o plano de controle é
 * estado do run, não do produto, e não pertence ao histórico do repositório de
 * quem chamou. As exclusões por pathspec no loop já garantem isso mecanicamente;
 * o arquivo evita que a pasta apareça como ruído para quem roda `git status`.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { artifactPaths } from "./paths.js";

export const CONTROL_PLANE_IGNORE = ["# Estado dos runs: plano de controle, não pertence ao histórico.", "runs/", ""].join("\n");

export async function ensureArtifactTree(projectRoot: string): Promise<void> {
  const paths = artifactPaths(projectRoot);
  await mkdir(paths.init, { recursive: true });
  await mkdir(paths.handoffs, { recursive: true });
  await mkdir(paths.runs, { recursive: true });
  await writeAtomic(join(paths.root, ".gitignore"), CONTROL_PLANE_IGNORE);
}
