/** O Core registra apenas o bootstrap mínimo declarado pelo probe, nunca código. */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { EnvironmentRequirement } from "../contract/environment.js";
import { commitAdmitido, lerStatus } from "./admissao.js";
import { packagesInReadinessProbe, probeManifests } from "./prerequisite-workspace.js";

const run = promisify(execFile);
const dependencyKeys = ["dependencies", "devDependencies", "optionalDependencies"];
const allowedKeys = new Set([...dependencyKeys, "name", "version", "private", "type", "description", "license"]);

function dependencies(value: Record<string, unknown>): Record<string, unknown> {
  return Object.assign({}, ...dependencyKeys.map(key => value[key]));
}

export async function adoptPreparedDependencies(root: string, requirements: readonly EnvironmentRequirement[]): Promise<boolean> {
  const packages = [...new Set(requirements.flatMap(packagesInReadinessProbe))];
  if (!packages.length) return false;
  // Cada manifesto precisa de ao menos um pacote sondado, não de todos eles.
  const manifests = new Map((await Promise.all(packages.map(name => probeManifests(root, [name])))).flat().map(item => [item.path, item]));
  const eligible = new Set<string>();
  for (const manifest of manifests.values()) {
    const declared = dependencies(manifest.data);
    if (Object.keys(manifest.data).some(key => !allowedKeys.has(key)) ||
        Object.keys(declared).length === 0 || Object.keys(declared).some(name => !packages.includes(name))) continue;
    eligible.add(relative(root, manifest.path));
    try {
      const lockPath = join(manifest.directory, "package-lock.json");
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as { packages?: Record<string, Record<string, unknown>> };
      const locked = dependencies(lock.packages?.[""] ?? {});
      if (Object.keys(locked).length === Object.keys(declared).length && Object.entries(declared).every(([name, version]) => locked[name] === version)) eligible.add(relative(root, lockPath));
    } catch { /* Lock ausente ou incompatível não é adotado. */ }
  }
  if (!eligible.size) return false;

  // Exclusão local padrão: não modifica o .gitignore nem oculta fonte rastreada.
  const exclude = resolve(root, (await run("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root })).stdout.trim());
  const previous = await readFile(exclude, "utf8").catch(() => "");
  if (!previous.split(/\r?\n/).includes("node_modules/")) {
    await mkdir(dirname(exclude), { recursive: true });
    await writeFile(exclude, `${previous}${previous.endsWith("\n") || previous === "" ? "" : "\n"}node_modules/\n`);
  }
  const pending = await lerStatus(root);
  if (!pending.length || pending.some(item => !item.naoVersionado || !eligible.has(item.caminho))) return false;
  const result = await commitAdmitido(root, { caminhos: pending.map(item => item.caminho), mensagem: "chore(capivara): prepara dependências do ambiente" });
  return result.status === "commitado";
}
