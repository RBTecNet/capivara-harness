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

/**
 * O que a Tech Stack cita e o catálogo não reconhece.
 *
 * Silêncio aqui seria a pior resposta: quem lê um preflight limpo conclui que
 * tudo foi conferido. O catálogo é pequeno de propósito, então ele diz o que
 * deixou de fora em vez de deixar entender que não havia nada.
 */
export function unverifiedTechnologies(projectDescription: string): string[] {
  const section = /^##\s+Tech Stack\s*$([\s\S]*?)(?=^##\s|\Z)/m.exec(projectDescription)?.[1] ?? "";
  const decisoes = [...section.matchAll(/^\|[^|\n]+\|([^|\n]+)\|/gm)]
    .map((linha) => (linha[1] ?? "").trim())
    .filter((valor) => valor !== "" && !/^-+$/.test(valor) && !/^decisão$/i.test(valor));

  return [...new Set(decisoes)].filter((decisao) => !CATALOG.some((entrada) => entrada.pattern.test(decisao)));
}

export type PrerequisiteChoice = "instalar" | "verificar" | "abortar";

export interface ResolutionIO {
  /** Mostra a situação e devolve a escolha do desenvolvedor. */
  choose: (missing: readonly PrerequisiteStatus[]) => Promise<PrerequisiteChoice>;
  /** Uma sessão focada do executor, com escopo de instalar e nada mais. */
  install: (missing: readonly PrerequisiteStatus[]) => Promise<void>;
  announce: (message: string) => void;
}

export type Resolution =
  | { resolved: true; installed: string[] }
  | { resolved: false; reason: string; missing: PrerequisiteStatus[] };

/**
 * Resolve o que falta ANTES de qualquer chamada de modelo do build.
 *
 * Três saídas, e só uma delas segue em frente. A instalação é feita por uma
 * sessão do executor com escopo estreito — instalar, nada mais — e o resultado
 * dela **não vale como prova**: a verificação é refeita com `which`. Agente que
 * diz ter instalado e não instalou é precisamente o caso que este gate existe
 * para pegar, e aceitar a palavra dele seria repetir o erro do gate 1, que
 * confundia "escreveu arquivo" com "fez o trabalho".
 */
export async function resolvePrerequisites(
  statuses: readonly PrerequisiteStatus[],
  io: ResolutionIO,
  maxRounds = 5,
): Promise<Resolution> {
  let atual = [...statuses];
  const instalados: string[] = [];

  for (let rodada = 1; rodada <= maxRounds; rodada += 1) {
    const faltando = atual.filter((status) => !status.present);
    if (faltando.length === 0) return { resolved: true, installed: instalados };

    const escolha = await io.choose(faltando);
    if (escolha === "abortar") {
      return {
        resolved: false,
        reason: "o desenvolvedor optou por não seguir sem os pré-requisitos",
        missing: faltando,
      };
    }

    if (escolha === "instalar") {
      io.announce(`  instalando ${faltando.map((status) => status.technology).join(", ")} numa sessão focada do executor`);
      await io.install(faltando);
    }

    // A palavra de quem instalou não conta: pergunta-se ao sistema.
    const reverificados = await checkPrerequisites(faltando);
    for (const status of reverificados) {
      if (status.present) {
        instalados.push(status.technology);
        io.announce(`  ${status.technology} encontrado em ${status.path}`);
      } else {
        io.announce(`  ${status.technology} continua ausente (${status.binary} não está no PATH)`);
      }
    }
    atual = [...atual.filter((status) => status.present), ...reverificados];
  }

  const faltando = atual.filter((status) => !status.present);
  return {
    resolved: false,
    reason: `os pré-requisitos continuaram ausentes depois de ${maxRounds} tentativas`,
    missing: faltando,
  };
}

/** A tela da decisão, numerada: escolha fechada não se responde em texto livre. */
export function renderPrerequisiteChoice(missing: readonly PrerequisiteStatus[]): string {
  return [
    `A stack decidida exige ${missing.map((status) => `${status.technology} (${status.binary})`).join(", ")},`,
    "ausente(s) nesta máquina. O build não começa sem isso — descobrir na terceira fase",
    "custa três sessões de agente.",
    "",
    "  1) instalar agora, numa sessão do executor com escopo de instalar e nada mais",
    "  2) já instalei em outro terminal; verifique de novo",
    "  3) abortar",
  ].join("\n");
}

/** Lê a escolha numérica; qualquer outra coisa é recusada, nunca adivinhada. */
export function readPrerequisiteChoice(answer: string): PrerequisiteChoice | null {
  const texto = answer.trim();
  if (texto === "1") return "instalar";
  if (texto === "2") return "verificar";
  if (texto === "3") return "abortar";
  return null;
}
