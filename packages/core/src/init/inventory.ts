/**
 * Inventário determinístico do projeto.
 *
 * Existe para não perguntar o que dá para descobrir. É limitado de propósito:
 * o modelo receberia um repositório inteiro e passaria a chamada investigando
 * a própria ferramenta em vez de escrever os documentos pedidos — foi um sintoma
 * real e caro do harness anterior.
 *
 * Arquivos de segredo nunca são lidos: a existência é registrada, o conteúdo não.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface InventoryEntry {
  path: string;
  bytes: number;
}

export interface Inventory {
  empty: boolean;
  files: InventoryEntry[];
  /** Manifestos reconhecidos, com conteúdo, porque revelam a stack. */
  manifests: { path: string; content: string }[];
  /** Arquivos de segredo: registrados pela existência, nunca pelo conteúdo. */
  secretsPresent: string[];
  truncated: boolean;
}

const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "target", "__pycache__",
  ".venv", "venv", ".next", ".nuxt", ".cache", "coverage", ".capivara",
]);

const MANIFESTS = new Set([
  "package.json", "composer.json", "pyproject.toml", "go.mod", "Cargo.toml",
  "Gemfile", "pom.xml", "requirements.txt", "docker-compose.yml", "Dockerfile",
  "AGENTS.md", "CAPIVARA.md", "README.md",
]);

const SECRET_NAMES = /^\.env(?!\.example$|\.sample$|\.template$)/;
const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

export const INVENTORY_LIMITS = { maxFiles: 2000, maxManifestBytes: 64 * 1024, maxDepth: 6 };

export async function inspectProject(projectRoot: string): Promise<Inventory> {
  const files: InventoryEntry[] = [];
  const manifests: { path: string; content: string }[] = [];
  const secretsPresent: string[] = [];
  let truncated = false;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > INVENTORY_LIMITS.maxDepth || truncated) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      const relativePath = relative(projectRoot, absolute);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      if (SECRET_NAMES.test(entry.name) || SECRET_EXTENSIONS.has(extname(entry.name))) {
        secretsPresent.push(relativePath);
        continue;
      }

      if (files.length >= INVENTORY_LIMITS.maxFiles) {
        truncated = true;
        return;
      }

      const info = await stat(absolute).catch(() => null);
      if (!info) continue;
      files.push({ path: relativePath, bytes: info.size });

      if (MANIFESTS.has(entry.name) && info.size <= INVENTORY_LIMITS.maxManifestBytes) {
        manifests.push({ path: relativePath, content: await readFile(absolute, "utf8").catch(() => "") });
      }
    }
  };

  await walk(projectRoot, 0);
  files.sort((left, right) => left.path.localeCompare(right.path));

  return { empty: files.length === 0, files, manifests, secretsPresent, truncated };
}

/** Resumo compacto para o prompt. O modelo recebe o mapa, não o repositório. */
export function summarizeInventory(inventory: Inventory): string {
  if (inventory.empty) return "O diretório do projeto está vazio: não há stack, código nem convenção a descobrir.";
  const lines = [`${inventory.files.length} arquivo(s)${inventory.truncated ? " (listagem truncada)" : ""}.`];
  if (inventory.manifests.length > 0) {
    lines.push("Manifestos encontrados:");
    for (const manifest of inventory.manifests) lines.push(`- ${manifest.path}`);
  }
  if (inventory.secretsPresent.length > 0) {
    lines.push(`Arquivos de segredo presentes (conteúdo NÃO lido): ${inventory.secretsPresent.join(", ")}`);
  }
  return lines.join("\n");
}
