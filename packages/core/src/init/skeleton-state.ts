/**
 * O esqueleto guardado entre os dois estágios.
 *
 * O `init` publica `skeleton.md` para leitura e grava a forma estruturada ao
 * lado: o `plan` precisa das listas, não do markdown, e reparsear texto que a
 * ferramenta acabou de gerar seria reconstruir o que ela já tinha.
 *
 * Fica junto dos handoffs, com o mesmo id de run — o pedido decide o run, e um
 * pedido diferente não herda o esqueleto de outro.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SKELETON_CONTRACT, type Skeleton } from "../contract/index.js";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";

function skeletonPath(projectRoot: string, runId: string): string {
  return join(artifactPaths(projectRoot).handoffs, `${runId}.skeleton.json`);
}

export async function writeSkeletonState(projectRoot: string, runId: string, skeleton: Skeleton): Promise<void> {
  await writeAtomic(skeletonPath(projectRoot, runId), `${JSON.stringify(skeleton, null, 2)}\n`);
}

export async function readSkeletonState(projectRoot: string, runId: string): Promise<Skeleton | null> {
  try {
    const parsed = JSON.parse(await readFile(skeletonPath(projectRoot, runId), "utf8")) as Partial<Skeleton>;
    return parsed.contract === SKELETON_CONTRACT ? (parsed as Skeleton) : null;
  } catch {
    return null;
  }
}
