/** Publicação explícita da fixture na geração atual; testes legados não usam este helper. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ENVIRONMENT_CONTRACT, PLANNING_CONTRACT, sha12 } from "../../src/contract/index.js";
import { detectPrerequisites } from "../../src/loop/prerequisites.js";
import type { EnvironmentRequirement } from "../../src/contract/index.js";

export async function certifyCurrentPlan(root: string, requirements?: EnvironmentRequirement[], extras: { architectureSha12?: string } = {}): Promise<void> {
  const dir = join(root, ".capivara/init");
  const plan = await readFile(join(dir, "project-phases.md"), "utf8");
  const skeleton = await readFile(join(dir, "skeleton.md"), "utf8").catch(() => "# Fixture — Skeleton\n");
  await writeFile(join(dir, "skeleton.md"), skeleton);
  await writeFile(join(dir, "environment.json"), JSON.stringify({ contract: ENVIRONMENT_CONTRACT, planningContract: PLANNING_CONTRACT,
    harnessVersion: "0.5.0", skeletonSha12: sha12(skeleton), planSha12: sha12(plan),
    ...(extras.architectureSha12 ? { architectureSha12: extras.architectureSha12 } : {}),
    requirements: requirements ?? detectPrerequisites(skeleton) }, null, 2) + "\n");
}
