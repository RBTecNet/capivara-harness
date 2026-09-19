/**
 * Criação da árvore de artefatos.
 *
 * Escreve `.capivara/.gitignore` ignorando `runs/` e `handoffs/`: o plano de
 * controle é
 * estado do run, não do produto, e não pertence ao histórico do repositório de
 * quem chamou. As exclusões por pathspec no loop já garantem isso mecanicamente;
 * o arquivo evita que a pasta apareça como ruído para quem roda `git status`.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { artifactPaths } from "./paths.js";

/*
 * `handoffs/` entra junto com `runs/`.
 *
 * O commit da especificação já dizia, em comentário, que nem um nem outro
 * pertencem ao histórico — mas só `runs/` estava aqui. O efeito apareceu no
 * piloto 6: o `plan` terminava, deixava os handoffs por rastrear, e o `build`
 * recusava começar porque a árvore não estava limpa. O desenvolvedor que
 * seguisse os dois estágios na ordem certa era barrado no terceiro.
 */
export const CONTROL_PLANE_IGNORE = [
  "# Estado dos runs: plano de controle, não pertence ao histórico.",
  "runs/",
  "handoffs/",
  "",
].join("\n");

export async function ensureArtifactTree(projectRoot: string): Promise<void> {
  const paths = artifactPaths(projectRoot);
  await mkdir(paths.init, { recursive: true });
  await mkdir(paths.handoffs, { recursive: true });
  await mkdir(paths.runs, { recursive: true });
  await writeAtomic(join(paths.root, ".gitignore"), CONTROL_PLANE_IGNORE);
}
