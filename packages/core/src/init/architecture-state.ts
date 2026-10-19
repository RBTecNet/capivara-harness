/**
 * A arquitetura guardada entre execuções do `plan`.
 *
 * O `plan` publica `architecture.md` para leitura e grava a forma estruturada
 * ao lado, como o `init` faz com o esqueleto. É por ela que uma retomada sabe
 * que a arquitetura já foi decidida — e sob qual esqueleto e quais decisões —
 * sem repagar a chamada que a produziu.
 *
 * Dois shas, porque o esqueleto publicado muda quando a arquitetura é aplicada
 * a ele (a divisão de fases e as sondas passam a ser as dela): o de ORIGEM é o
 * que o `init` publicou, o APLICADO é o que ficou em disco depois. Qualquer um
 * dos dois em disco significa a mesma arquitetura.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHITECTURE_CONTRACT, type Architecture } from "../contract/index.js";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";

export interface ArchitectureState {
  architecture: Architecture;
  /** sha12 do esqueleto (renderizado) de que a arquitetura foi derivada. */
  sourceSkeletonSha12: string;
  /** sha12 do esqueleto (renderizado) depois de aplicar a arquitetura. */
  appliedSkeletonSha12: string;
  /** sha12 da autoridade — as decisões aceitas — que valia quando ela foi aprovada. */
  authoritySha12: string;
}

function architecturePath(projectRoot: string, runId: string): string {
  return join(artifactPaths(projectRoot).handoffs, `${runId}.architecture-state.json`);
}

export async function writeArchitectureState(projectRoot: string, runId: string, state: ArchitectureState): Promise<void> {
  await writeAtomic(architecturePath(projectRoot, runId), `${JSON.stringify(state, null, 2)}\n`);
}

export async function readArchitectureState(projectRoot: string, runId: string): Promise<ArchitectureState | null> {
  try {
    const parsed = JSON.parse(await readFile(architecturePath(projectRoot, runId), "utf8")) as Partial<ArchitectureState>;
    if (parsed.architecture?.contract !== ARCHITECTURE_CONTRACT) return null;
    if (typeof parsed.sourceSkeletonSha12 !== "string" || typeof parsed.appliedSkeletonSha12 !== "string" || typeof parsed.authoritySha12 !== "string") return null;
    return parsed as ArchitectureState;
  } catch {
    return null;
  }
}
