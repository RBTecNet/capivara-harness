import { isBuiltin } from "node:module";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
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

export interface ProbedPackage { name: string; version: string; directory: string; engine: string | null }

async function readPackage(directory: string): Promise<ProbedPackage | null> {
  try {
    const data = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: unknown; version?: unknown; engines?: { node?: unknown } };
    if (typeof data.name !== "string") return null;
    return { name: data.name, version: typeof data.version === "string" ? data.version : "", directory, engine: typeof data.engines?.node === "string" ? data.engines.node : null };
  } catch { return null; }
}

/**
 * O pacote por trás de uma sonda `./node_modules/.bin/<ferramenta>` (§131).
 *
 * O nome da ferramenta não diz o pacote — `tsc` é do `typescript`, `playwright`
 * pode ser do `@playwright/test` —, mas o link que o npm criou diz: ele aponta
 * para dentro da pasta do pacote instalado. Sonda que não é esse link, ou link
 * quebrado, não tem pacote.
 */
export async function packageBehindBinary(cwd: string, binary: string): Promise<ProbedPackage | null> {
  if (!/(?:^|[/\\])node_modules[/\\]\.bin[/\\][^/\\]+$/.test(binary)) return null;
  let directory: string;
  let modules: string;
  try {
    const link = resolve(cwd, binary);
    directory = dirname(await realpath(link));
    modules = await realpath(dirname(dirname(link)));
  } catch { return null; }
  // O pacote mora no node_modules que guarda o `.bin`: link para fora dele não diz pacote nenhum.
  if (!directory.startsWith(modules + sep)) return null;
  // A pasta do pacote é a primeira cujo pai é um node_modules (ou um @escopo dentro dele).
  for (;;) {
    const parent = dirname(directory);
    if (parent.length < modules.length) return null;
    if (basename(parent) === "node_modules" || (basename(parent).startsWith("@") && basename(dirname(parent)) === "node_modules")) break;
    directory = parent;
  }
  return readPackage(directory);
}

/** Os pacotes que uma sonda comprova: o do link em `.bin` ou os do `require` do script, como o Node os resolveria de cada pasta. */
export async function probedPackages(requirement: EnvironmentRequirement, directories: readonly string[]): Promise<ProbedPackage[]> {
  const found: ProbedPackage[] = [];
  for (const directory of directories) {
    const behind = await packageBehindBinary(directory, requirement.binary);
    if (behind) found.push(behind);
    for (const name of packagesInReadinessProbe(requirement)) {
      for (let from = resolve(directory); ; from = dirname(from)) {
        const installed = await readPackage(join(from, "node_modules", name));
        if (installed) { found.push(installed); break; }
        if (dirname(from) === from) break;
      }
    }
  }
  return found;
}

/**
 * Os pacotes que o lockfile da pasta registra com `engines.node`: a árvore
 * inteira, que o `npm ci --engine-strict` confere — menos os opcionais, que o
 * npm pula em vez de recusar. Sem lockfile v2/v3 legível, nada.
 */
export async function lockedPackages(directory: string): Promise<ProbedPackage[]> {
  try {
    const lock = JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8")) as { packages?: Record<string, { name?: unknown; version?: unknown; engines?: unknown; optional?: unknown }> };
    return Object.entries(lock.packages ?? {}).flatMap(([caminho, entrada]) => {
      if (caminho === "" || entrada?.optional === true) return [];
      const engines = entrada.engines;
      const node = engines !== null && typeof engines === "object" && !Array.isArray(engines) ? (engines as { node?: unknown }).node : undefined;
      if (typeof node !== "string") return [];
      const name = typeof entrada.name === "string" ? entrada.name : caminho.slice(caminho.lastIndexOf("node_modules/") + "node_modules/".length);
      return [{ name, version: typeof entrada.version === "string" ? entrada.version : "", directory: join(directory, caminho), engine: node }];
    });
  } catch { return []; }
}

const VERSION = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

/**
 * O Node `version` atende ao intervalo `engines.node`? null quando o intervalo
 * usa algo que esta leitura não cobre: sem veredito, nada é recusado por ele.
 *
 * É o subconjunto do semver que os `engines` usam — `||`, comparadores, `^`,
 * `~`, curingas e hífen —, sem pré-lançamento.
 */
export function satisfiesNodeRange(range: string, version: string): boolean | null {
  const current = VERSION.exec(version.trim());
  if (!current || current[2] === undefined || current[3] === undefined) return null;
  const node = [Number(current[1]), Number(current[2]), Number(current[3])] as const;
  const compare = (a: readonly number[], b: readonly number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  /** O menor e o primeiro acima de uma versão parcial: `1.2` vai de 1.2.0 até antes de 1.3.0. */
  const bounds = (text: string): { low: number[]; high: number[] | null; parts: number } | null => {
    if (text === "" || text === "*" || /^[xX]$/.test(text)) return { low: [0, 0, 0], high: null, parts: 0 };
    const match = VERSION.exec(text);
    if (!match) return null;
    const parts = [match[1], match[2], match[3]].filter((part) => part !== undefined && !/^[xX*]$/.test(part)).length;
    const numbers = [Number(match[1]), Number(match[2] ?? 0) || 0, Number(match[3] ?? 0) || 0];
    if (parts === 3) return { low: numbers, high: null, parts };
    const high = parts === 1 ? [numbers[0]! + 1, 0, 0] : [numbers[0]!, numbers[1]! + 1, 0];
    return { low: parts === 1 ? [numbers[0]!, 0, 0] : [numbers[0]!, numbers[1]!, 0], high, parts };
  };
  const comparator = (token: string): boolean | null => {
    const match = /^(>=|<=|>|<|=|\^|~>?)?(.*)$/.exec(token);
    const operator = match?.[1] ?? "";
    const limits = bounds(match?.[2] ?? "");
    if (!limits) return null;
    const { low, high, parts } = limits;
    const below = (limit: number[]): boolean => compare(node, limit) < 0;
    const atLeast = (limit: number[]): boolean => compare(node, limit) >= 0;
    switch (operator) {
      case "": case "=": return parts === 3 ? compare(node, low) === 0 : atLeast(low) && (high === null || below(high));
      case ">=": return atLeast(low);
      case ">": return parts === 3 ? compare(node, low) > 0 : high === null ? false : atLeast(high);
      case "<": return below(low);
      case "<=": return parts === 3 ? compare(node, low) <= 0 : high === null ? true : below(high);
      case "^": {
        const [major, minor, patch] = low as [number, number, number];
        const ceiling = major > 0 || parts === 1 ? [major + 1, 0, 0] : minor > 0 || parts === 2 ? [0, minor + 1, 0] : [0, 0, patch + 1];
        return atLeast(low) && below(parts === 0 ? [Infinity, 0, 0] : ceiling);
      }
      default: { // ~ e ~>
        const ceiling = parts >= 2 ? [low[0]!, low[1]! + 1, 0] : [low[0]! + 1, 0, 0];
        return atLeast(low) && below(parts === 0 ? [Infinity, 0, 0] : ceiling);
      }
    }
  };
  let unknown = false;
  for (const alternative of range.split("||")) {
    const text = alternative.trim().replace(/(>=|<=|>|<|=|\^|~>?)\s+/g, "$1");
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    const tokens = hyphen ? [`>=${hyphen[1]}`, `<=${hyphen[2]}`] : text === "" ? [""] : text.split(/\s+/);
    const results = tokens.map(comparator);
    // Um comparador falso derruba a alternativa, mesmo ao lado de outro ilegível.
    if (results.some((result) => result === false)) continue;
    if (results.some((result) => result === null)) { unknown = true; continue; }
    return true;
  }
  return unknown ? null : false;
}
