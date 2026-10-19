/** Só um plano aprovado nesta geração pode entrar no build. Sem fallback legado. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ENVIRONMENT_CONTRACT, PLANNING_CONTRACT, PLANNING_UPGRADE, SKELETON_CONTRACT, environmentRequirements, renderSkeleton, sha12, type Skeleton } from "../contract/index.js";
import type { Prerequisite } from "./prerequisites.js";
import { VERSION } from "../version.js";

export function plannedRequirements(skeleton: Skeleton): Prerequisite[] {
  if (skeleton.contract !== SKELETON_CONTRACT) throw new Error(PLANNING_UPGRADE);
  return environmentRequirements(skeleton.environment);
}

/**
 * O que o `plan` acrescenta ao metadado desde a geração v3 (§116): a
 * arquitetura que o plano leu e a infraestrutura declarada. O build lê só o que
 * sempre leu — contrato, geração, hashes e sondas —, e o resto viaja para quem
 * vier depois (o `change` o preserva ao republicar).
 */
export interface EnvironmentPlanExtras {
  architectureSha12?: string;
  infrastructure?: unknown;
}

export function renderEnvironmentPlan(skeleton: Skeleton, plan: string, extras: EnvironmentPlanExtras = {}): string {
  return JSON.stringify({ contract: ENVIRONMENT_CONTRACT, planningContract: PLANNING_CONTRACT, harnessVersion: VERSION,
    skeletonSha12: sha12(renderSkeleton(skeleton)), planSha12: sha12(plan),
    ...(extras.architectureSha12 ? { architectureSha12: extras.architectureSha12 } : {}),
    requirements: plannedRequirements(skeleton),
    ...(extras.infrastructure !== undefined ? { infrastructure: extras.infrastructure } : {}) }, null, 2) + "\n";
}

/** Os campos que o `change` precisa carregar de um metadado para o seguinte. */
export async function readEnvironmentPlanExtras(root: string): Promise<EnvironmentPlanExtras> {
  const source = await readFile(join(root, ".capivara/init/environment.json"), "utf8").catch(() => null);
  if (source === null) return {};
  try {
    const value = JSON.parse(source) as { architectureSha12?: unknown; infrastructure?: unknown };
    return {
      ...(typeof value.architectureSha12 === "string" ? { architectureSha12: value.architectureSha12 } : {}),
      ...(value.infrastructure !== undefined ? { infrastructure: value.infrastructure } : {}),
    };
  } catch {
    return {};
  }
}

export async function readEnvironmentPlan(root: string, skeleton: string, plan: string): Promise<Prerequisite[]> {
  const file = join(root, ".capivara/init/environment.json");
  const source = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (source === null) throw new Error(`${PLANNING_UPGRADE}. Falta .capivara/init/environment.json`);
  let value: { contract?: unknown; planningContract?: unknown; planSha12?: unknown; skeletonSha12?: unknown; requirements?: unknown } | null;
  try { value = JSON.parse(source) as typeof value; }
  catch { throw new Error(`${PLANNING_UPGRADE}. environment.json não é JSON válido`); }
  if (value?.contract !== ENVIRONMENT_CONTRACT || value.planningContract !== PLANNING_CONTRACT ||
      value.skeletonSha12 !== sha12(skeleton) || value.planSha12 !== sha12(plan)) {
    throw new Error(`${PLANNING_UPGRADE}. environment.json é antigo ou não corresponde aos documentos atuais`);
  }
  try { return environmentRequirements(value.requirements); }
  catch (error) { throw new Error(`${PLANNING_UPGRADE}. ${error instanceof Error ? error.message : String(error)}`); }
}
