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
import { basename } from "node:path";
import { promisify } from "node:util";
import { renderEscolhaNumerada, type EscolhaNumerada } from "./escolha.js";
import type { EnvironmentRequirement } from "../contract/environment.js";
import { runtimeEnvironment } from "../provider/runtime-env.js";
import { lockedPackages, packagesInReadinessProbe, probedPackages, probeManifests, satisfiesNodeRange } from "./prerequisite-workspace.js";
import { prepareReadinessProbe } from "./readiness-probe.js";

const run = promisify(execFile);

export interface Prerequisite extends EnvironmentRequirement {
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

/**
 * A seção de stack do esqueleto; o documento inteiro serve de reserva.
 *
 * O fim da seção é a próxima `##` OU o fim do texto. Escrever esse "ou o fim do
 * texto" como `\Z` é um reflexo de quem vem de outra linguagem: em JavaScript
 * `\Z` não é âncora nenhuma, é a letra Z literal. O efeito era silencioso e só
 * aparecia num esqueleto cuja Stack fosse a última seção — ali a leitura
 * devolvia vazio, o catálogo não reconhecia nada, e o preflight passava sem ter
 * conferido pré-requisito nenhum.
 */
function stackSection(skeleton: string): string {
  return /^##\s+Stack\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(skeleton)?.[1] ?? "";
}

/** Lê a seção `## Stack` do esqueleto e deduz o que precisa existir na máquina. */
export function detectPrerequisites(skeleton: string): Prerequisite[] {
  const section = stackSection(skeleton) || skeleton;
  const found = new Map<string, Prerequisite>();
  for (const entry of CATALOG) {
    if (entry.pattern.test(section)) found.set(entry.prerequisite.binary, entry.prerequisite);
  }
  return [...found.values()];
}

export interface PrerequisiteStatus extends Prerequisite {
  present: boolean;
  path: string | null;
  evidence?: string;
  /** Onde a sonda de prontidão foi executada; não é o caminho do executável. */
  cwd?: string;
}

export async function checkPrerequisites(prerequisites: readonly Prerequisite[], options: { cwd?: string; environment?: NodeJS.ProcessEnv } = {}): Promise<PrerequisiteStatus[]> {
  const statuses: PrerequisiteStatus[] = [];
  for (const prerequisite of prerequisites) {
    const settings = { ...(options.cwd ? { cwd: options.cwd } : {}), env: runtimeEnvironment({ ...process.env, ...options.environment }), timeout: 5_000, maxBuffer: 64 * 1024 };
    const path = await run("which", [prerequisite.binary], settings)
      .then(({ stdout }) => stdout.trim() || null)
      .catch(() => null);
    if (path !== null && (prerequisite.checkArgs?.length ?? 0) > 0) {
      const owners = await probeManifests(options.cwd ?? process.cwd(), packagesInReadinessProbe(prerequisite));
      const directories = owners.length ? owners.map(owner => owner.directory) : [options.cwd ?? process.cwd()];
      const checks = [];
      for (const cwd of directories) {
        const probe = await prepareReadinessProbe(prerequisite);
        try {
          const checked = await run(path, probe.args, { ...settings, cwd })
            .then(({ stdout, stderr }) => ({ present: true, evidence: `${stdout}${stderr}`.trim() }))
            .catch((error: unknown) => ({ present: false, evidence: error instanceof Error ? error.message : String(error) }));
          checks.push({ ...checked, cwd, evidence: `${probe.annotation}${checked.evidence}` });
        } finally {
          await probe.cleanup();
        }
      }
      /*
       * A sonda passou, mas o pacote que ela comprova aceita este Node? (§131)
       *
       * `vitest --version` responde mesmo quando o `engines` do pacote recusa o
       * runtime — o npm comum só avisa. O build instala com `--engine-strict`
       * no worktree e na integração, e lá a recusa é erro: aprovar aqui era
       * deixar a falha para depois da primeira fase pronta.
       */
      /*
       * E a árvore que o lockfile da pasta registra, porque o `--engine-strict`
       * confere todos os pacotes, não só o sondado: o Vitest aceito com uma
       * dependência que recusa o Node falharia do mesmo jeito, depois.
       */
      const sondados = checks.every(check => check.present) ? await probedPackages(prerequisite, directories) : [];
      const conferidos = sondados.length > 0 ? [...sondados, ...(await Promise.all(directories.map(lockedPackages))).flat()] : [];
      const vistos = new Set<string>();
      const recusados = conferidos.filter(pacote => {
        const chave = `${pacote.name}@${pacote.version}`;
        if (vistos.has(chave) || pacote.engine === null || satisfiesNodeRange(pacote.engine, process.version) !== false) return false;
        vistos.add(chave);
        return true;
      });
      const recusa = recusados.slice(0, 8).map(pacote =>
        `${pacote.name}@${pacote.version} declara engines.node "${pacote.engine}", e o Node que roda o harness e o projeto é ${process.version}: ` +
        `a instalação estrita do build (npm --engine-strict) recusa esta versão. Escolha, dentro do que o plano declara, versões cuja árvore de dependências aceite ${process.version}.`);
      if (recusados.length > 8) recusa.push(`e mais ${recusados.length - 8} pacote(s) com engines.node que recusa ${process.version}.`);
      statuses.push({ ...prerequisite, path, present: checks.every(check => check.present) && recusa.length === 0,
        ...(directories.length === 1 ? { cwd: directories[0]! } : {}),
        evidence: [...checks.map(check => `cwd: ${check.cwd}\n${check.evidence}`), ...recusa].join("\n\n") });
    } else statuses.push({ ...prerequisite, present: path !== null, path });
  }
  return statuses;
}

/**
 * A sonda confere só o runtime que o próprio harness fornece — o Node dele e o
 * npm que ele resolve —, e nada do projeto? `node --version`, `npm --version`,
 * ou um `node -e` que só lê `process.version(s)`. A sonda que lê pacote
 * (`require`, `import`, `npm exec`) só passa depois de a preparação do build
 * instalar o que o plano declara, e não é desta conta.
 */
export function sondaDoRuntimeDoHarness(requisito: EnvironmentRequirement): boolean {
  const binario = basename(requisito.binary);
  const args = requisito.checkArgs ?? [];
  if (binario !== "node" && binario !== "npm") return false;
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return true;
  if (binario !== "node" || args.length !== 2 || !["-e", "--eval", "-p", "--print"].includes(args[0]!)) return false;
  return /\bprocess\.versions?\b/u.test(args[1]!) && !/\brequire\s*\(|\bimport\b|\bcreateRequire\b/u.test(args[1]!);
}

/**
 * As sondas do runtime do harness que falham nesta máquina, rodadas como o
 * build as roda (o Node do harness à frente do PATH). Nenhum build satisfaz uma
 * delas: o build não troca o Node nem o npm que o harness usa.
 */
export async function sondasDoRuntimeQueFalham(requisitos: readonly EnvironmentRequirement[], options: { cwd?: string } = {}): Promise<PrerequisiteStatus[]> {
  const doRuntime = requisitos.filter(sondaDoRuntimeDoHarness);
  if (doRuntime.length === 0) return [];
  return (await checkPrerequisites(doRuntime, options)).filter((status) => !status.present);
}

export function describeMissing(statuses: readonly PrerequisiteStatus[], systemInstallAllowed: boolean): string {
  const missing = statuses.filter((status) => !status.present);
  if (missing.length === 0) return "";
  const list = missing.map((status) => `${status.technology} (${status.binary})`).join(", ");
  return systemInstallAllowed
    ? `a stack decidida exige ${list}, ausente(s) ou sem prontidão nesta máquina; preparar antes de iniciar o desenvolvimento`
    : `a stack decidida exige ${list}, ausente(s) ou sem prontidão nesta máquina. Instale, ou rode com --allow-system-install para preparar antes do desenvolvimento`;
}

/**
 * O que a Tech Stack cita e o catálogo não reconhece.
 *
 * Silêncio aqui seria a pior resposta: quem lê um preflight limpo conclui que
 * tudo foi conferido. O catálogo é pequeno de propósito, então ele diz o que
 * deixou de fora em vez de deixar entender que não havia nada.
 */
export function unverifiedTechnologies(skeleton: string): string[] {
  /*
   * `- <componente>: <decisão>`, que é como o esqueleto escreve a stack.
   *
   * A decisão do esqueleto é uma frase, não um nome de produto: onde a tabela em
   * prosa trazia "React 18", aqui vem "Sistema visual próprio enxuto com tokens
   * de cor centralizados, escala de espaçamento, tipografia definida, estados
   * de…". Despejar isso inteiro num aviso produziu, no piloto 5, um parágrafo de
   * quatro linhas que ninguém lê — e um aviso que ninguém lê não avisa.
   *
   * Então a frase é cortada no primeiro limite de cláusula e truncada. O que o
   * aviso precisa entregar é o reconhecimento de que ali há uma decisão que o
   * catálogo não sabe conferir, não a decisão inteira: essa está no esqueleto.
   */
  const decisoes = [...stackSection(skeleton).matchAll(/^-\s*[^:\n]+:\s*(.+)$/gm)]
    .map((linha) => (linha[1] ?? "").trim())
    .map((valor) => resumir(valor))
    .filter((valor) => valor !== "");

  return [...new Set(decisoes)].filter((decisao) => !CATALOG.some((entrada) => entrada.pattern.test(decisao)));
}

/** A decisão em tamanho de aviso: primeira cláusula, no máximo 48 caracteres. */
function resumir(decisao: string): string {
  const primeira = (decisao.split(/\s+(?:com|para|em|usando)\s+|[,;(]/)[0] ?? "").trim();
  const base = primeira === "" ? decisao : primeira;
  return base.length <= 48 ? base : `${base.slice(0, 47).trimEnd()}…`;
}

export type PrerequisiteChoice = "instalar" | "verificar" | "abortar";

export interface ResolutionIO {
  verify?: (requirements: readonly Prerequisite[]) => Promise<PrerequisiteStatus[]>;
  /** Mostra a situação e devolve a escolha do desenvolvedor. */
  choose: (missing: readonly PrerequisiteStatus[]) => Promise<PrerequisiteChoice>;
  /** Uma sessão focada do executor, com escopo de instalar e nada mais. */
  install: (missing: readonly PrerequisiteStatus[]) => Promise<void>;
  announce: (message: string) => void;
}

export type Resolution =
  | { resolved: true; installed: string[]; statuses: PrerequisiteStatus[] }
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
    if (faltando.length === 0) return { resolved: true, installed: instalados, statuses: atual };

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
    const reverificados = await (io.verify ?? checkPrerequisites)(faltando);
    for (const status of reverificados) {
      if (status.present) {
        instalados.push(status.technology);
        io.announce(`  ${status.technology} encontrado em ${status.path}`);
      } else {
        io.announce(status.path
          ? `  ${status.technology}: executável encontrado em ${status.path}, mas a prontidão falhou${status.cwd ? ` em ${status.cwd}` : ""}`
          : `  ${status.technology} continua ausente (${status.binary} não está no PATH)`);
        if (status.path && status.evidence) io.announce(`    ${status.evidence}`);
      }
    }
    atual = [...atual.filter((status) => status.present), ...reverificados];
  }

  const faltando = atual.filter((status) => !status.present);
  if (faltando.length === 0) return { resolved: true, installed: instalados, statuses: atual };
  return {
    resolved: false,
    reason: `os pré-requisitos continuaram ausentes depois de ${maxRounds} tentativas`,
    missing: faltando,
  };
}

/** A decisão, como dado: escolha fechada não se responde em texto livre. */
export function prerequisiteChoice(missing: readonly PrerequisiteStatus[]): EscolhaNumerada {
  return {
    texto: [
      `A stack decidida exige ${missing.map((status) => `${status.technology} (${status.binary})`).join(", ")},`,
      "ausente(s) nesta máquina. O build não começa sem isso — descobrir na terceira fase",
      "custa três sessões de agente.",
    ],
    opcoes: [
      "instalar agora, numa sessão do executor com escopo de instalar e nada mais",
      "já instalei em outro terminal; verifique de novo",
      "abortar",
    ],
  };
}

/** A tela da decisão, numerada. */
export function renderPrerequisiteChoice(missing: readonly PrerequisiteStatus[]): string {
  return renderEscolhaNumerada(prerequisiteChoice(missing));
}

/** Lê a escolha numérica; qualquer outra coisa é recusada, nunca adivinhada. */
export function readPrerequisiteChoice(answer: string): PrerequisiteChoice | null {
  const texto = answer.trim();
  if (texto === "1") return "instalar";
  if (texto === "2") return "verificar";
  if (texto === "3") return "abortar";
  return null;
}
