import { isBuiltin } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EnvironmentRequirement } from "../contract/environment.js";

export function packagesInReadinessProbe(requirement: EnvironmentRequirement): string[] {
  if (!/(?:^|[/\\])node(?:js|\.exe)?$/i.test(requirement.binary)) return [];
  const args = requirement.checkArgs ?? [];
  const index = args.findIndex(arg => ["-e", "--eval", "-p", "--print"].includes(arg));
  const script = index < 0 ? "" : args[index + 1] ?? "";
  const functions = new Set(["require", "import"]);
  for (const match of script.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*[^;\n]*?\bcreateRequire\s*\(/g)) functions.add(match[1]!);
  const packages = new Set<string>();
  for (const match of script.matchAll(/\b([\w$]+)\s*\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    const name = match[3]!;
    if (!functions.has(match[1]!) || isBuiltin(name) || name.startsWith(".") || name.startsWith("/")) continue;
    packages.add(name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]!);
  }
  return [...packages];
}

export interface ProbeManifest { directory: string; path: string; data: Record<string, unknown> }

/** Descobre donos declarados; ferramentas privadas e dependências não viram workspaces. */
export async function probeManifests(root: string, packages: readonly string[]): Promise<ProbeManifest[]> {
  if (packages.length === 0) return [];
  const found: ProbeManifest[] = [];
  let budget = 128;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (budget-- <= 0) return;
    try {
      const path = join(directory, "package.json");
      const data = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const declared = Object.assign({}, data.dependencies, data.devDependencies, data.optionalDependencies) as Record<string, unknown>;
      if (packages.every(name => typeof declared[name] === "string")) found.push({ directory, path, data });
    } catch { /* Pasta sem manifesto não é erro de prontidão. */ }
    if (depth === 0) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || ["node_modules", "vendor", "dist", "build", "coverage", "target"].includes(entry.name)) continue;
      await walk(join(directory, entry.name), depth - 1);
    }
  };
  await walk(resolve(root), 3);
  return found;
}
