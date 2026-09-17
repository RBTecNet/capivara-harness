/**
 * Pré-requisitos de sistema da stack decidida.
 *
 * Descobrir na terceira fase que não há banco de dados custa três sessões de
 * agente. Descobrir no preflight custa uma chamada a `which`.
 *
 * O mapa é deliberadamente pequeno e explícito: reconhece o que aparece de fato
 * numa seção de Tech Stack. O que ele não reconhece simplesmente não é
 * verificado — um falso negativo custa o que custava antes, enquanto um falso
 * positivo bloquearia um build perfeitamente válido.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Prerequisite {
  /** Como a tecnologia aparece na documentação. */
  technology: string;
  /** Executável que prova a presença dela. */
  binary: string;
  /** Verdadeiro quando é um serviço de sistema, não um pacote do projeto. */
  systemLevel: boolean;
}

const CATALOG: { pattern: RegExp; prerequisite: Prerequisite }[] = [
  { pattern: /\bpostgres(?:ql)?\b/i, prerequisite: { technology: "PostgreSQL", binary: "psql", systemLevel: true } },
  { pattern: /\bmysql\b|\bmariadb\b/i, prerequisite: { technology: "MySQL/MariaDB", binary: "mysql", systemLevel: true } },
  { pattern: /\bmongo(?:db)?\b/i, prerequisite: { technology: "MongoDB", binary: "mongod", systemLevel: true } },
  { pattern: /\bredis\b/i, prerequisite: { technology: "Redis", binary: "redis-server", systemLevel: true } },
  { pattern: /\bsqlite\b/i, prerequisite: { technology: "SQLite", binary: "sqlite3", systemLevel: true } },
  { pattern: /\bdocker\b/i, prerequisite: { technology: "Docker", binary: "docker", systemLevel: true } },
  { pattern: /\bnode(?:\.js)?\b/i, prerequisite: { technology: "Node.js", binary: "node", systemLevel: false } },
  { pattern: /\bpython\b|\bdjango\b|\bfastapi\b|\bflask\b/i, prerequisite: { technology: "Python", binary: "python3", systemLevel: false } },
  { pattern: /\bphp\b|\blaravel\b/i, prerequisite: { technology: "PHP", binary: "php", systemLevel: false } },
  { pattern: /\bruby\b|\brails\b/i, prerequisite: { technology: "Ruby", binary: "ruby", systemLevel: false } },
  { pattern: /\bgolang\b|\bgo\s+1\.\d+/i, prerequisite: { technology: "Go", binary: "go", systemLevel: false } },
  { pattern: /\brust\b|\bcargo\b/i, prerequisite: { technology: "Rust", binary: "cargo", systemLevel: false } },
  { pattern: /\bjava\b|\bspring\b/i, prerequisite: { technology: "Java", binary: "java", systemLevel: false } },
];

/** Lê a seção `## Tech Stack` do project-description e deduz o que precisa existir. */
export function detectPrerequisites(projectDescription: string): Prerequisite[] {
  const section = /^##\s+Tech Stack\s*$([\s\S]*?)(?=^##\s|\Z)/m.exec(projectDescription)?.[1] ?? projectDescription;
  const found = new Map<string, Prerequisite>();
  for (const entry of CATALOG) {
    if (entry.pattern.test(section)) found.set(entry.prerequisite.binary, entry.prerequisite);
  }
  return [...found.values()];
}

export interface PrerequisiteStatus extends Prerequisite {
  present: boolean;
  path: string | null;
}

export async function checkPrerequisites(prerequisites: readonly Prerequisite[]): Promise<PrerequisiteStatus[]> {
  const statuses: PrerequisiteStatus[] = [];
  for (const prerequisite of prerequisites) {
    const path = await run("which", [prerequisite.binary])
      .then(({ stdout }) => stdout.trim() || null)
      .catch(() => null);
    statuses.push({ ...prerequisite, present: path !== null, path });
  }
  return statuses;
}

export function describeMissing(statuses: readonly PrerequisiteStatus[], systemInstallAllowed: boolean): string {
  const missing = statuses.filter((status) => !status.present);
  if (missing.length === 0) return "";
  const list = missing.map((status) => `${status.technology} (${status.binary})`).join(", ");
  return systemInstallAllowed
    ? `a stack decidida exige ${list}, ausente(s) nesta máquina; o executor tem permissão de sistema e vai instalar`
    : `a stack decidida exige ${list}, ausente(s) nesta máquina. Instale, ou rode com --allow-system-install para o executor instalar`;
}
