/**
 * As dependências do próprio projeto estão instaladas?
 *
 * O preflight sempre conferiu os binários de SISTEMA — node, psql, docker — e
 * nunca o que o projeto declara para si. A diferença aparece no primeiro build
 * de um projeto cujo `init` rodou noutra máquina, ou cujo `node_modules` nunca
 * existiu: o manifesto pede `tsx`, o `npm test` morre sem achá-lo, e o gate 2
 * devolve a fase ao executor.
 *
 * Aí a coisa fica cara. O executor lê "a suíte falhou", tenta `npm install`, e
 * descobre que a CLI dele não pode: a permissão de shell é de quem invocou. No
 * `MCP_teste2` isso consumiu os três ciclos da fase 1 — "O shell foi bloqueado.
 * Vou tentar de novo pedindo permissão para instalar as dependências" — e o
 * executor, cercado, foi reescrever o comando de teste do projeto para não
 * precisar do pacote. Um defeito de ambiente virou mudança de produto, que é
 * exatamente o que o §34.8 existe para impedir.
 *
 * A conclusão NÃO é que alguém deva rodar `npm install` antes. O objetivo do
 * harness é dar munição para o executor conseguir sozinho — se ele precisa de
 * uma dependência instalada, instalar faz parte do trabalho dele, e a permissão
 * para isso é o que o harness tem que garantir (§41.3). O que este aviso faz é
 * dizer o que vai acontecer na primeira sessão, e qual é o remédio na hora em
 * que a CLI não deixar.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface DependenciaAusente {
  /** O manifesto que declara as dependências. */
  manifesto: string;
  /** A pasta que provaria que elas foram instaladas. */
  pasta: string;
  /** O comando que resolve. */
  comando: string;
}

/**
 * Os ecossistemas em que "instalado" é uma pasta que dá para ver.
 *
 * Deliberadamente curto. Go guarda módulos num cache global, Rust compila sob
 * demanda, Python instala em virtualenv que pode estar em qualquer lugar: nesses
 * a ausência da pasta não prova nada, e um falso positivo bloquearia um build
 * perfeitamente válido — o mesmo critério do catálogo de pré-requisitos.
 */
const ECOSSISTEMAS = [
  { manifesto: "package.json", pasta: "node_modules", comando: "npm install", campos: ["dependencies", "devDependencies"] },
  { manifesto: "composer.json", pasta: "vendor", comando: "composer install", campos: ["require", "require-dev"] },
] as const;

async function existe(caminho: string): Promise<boolean> {
  return await stat(caminho).then(() => true).catch(() => false);
}

/** O manifesto declara alguma dependência? Manifesto sem nenhuma não precisa de instalação. */
async function declaraDependencia(caminho: string, campos: readonly string[]): Promise<boolean> {
  try {
    const lido = JSON.parse(await readFile(caminho, "utf8")) as Record<string, unknown>;
    return campos.some((campo) => Object.keys((lido[campo] ?? {}) as Record<string, unknown>).length > 0);
  } catch {
    // Manifesto ilegível não vira bloqueio: quem decide sobre ele é outro gate.
    return false;
  }
}

export async function dependenciasAusentes(projectRoot: string): Promise<DependenciaAusente[]> {
  const ausentes: DependenciaAusente[] = [];

  for (const ecossistema of ECOSSISTEMAS) {
    const manifesto = join(projectRoot, ecossistema.manifesto);
    if (!(await existe(manifesto))) continue;
    if (!(await declaraDependencia(manifesto, ecossistema.campos))) continue;
    if (await existe(join(projectRoot, ecossistema.pasta))) continue;

    ausentes.push({ manifesto: ecossistema.manifesto, pasta: ecossistema.pasta, comando: ecossistema.comando });
  }

  return ausentes;
}

/**
 * A mensagem do preflight: o que falta, quem resolve, e o que fazer se não der.
 *
 * Aviso, nunca bloqueio. Instalar o que o projeto declara é trabalho do
 * executor, e pedir que o desenvolvedor prepare o ambiente antes seria trocar o
 * problema de lugar: o harness existe para que o executor consiga sozinho.
 */
export function descreverDependencias(ausentes: readonly DependenciaAusente[]): string {
  if (ausentes.length === 0) return "";

  return [
    `as dependências declaradas em ${ausentes.map((item) => `\`${item.manifesto}\``).join(" e ")} não estão instaladas: ` +
      `não existe ${ausentes.map((item) => `\`${item.pasta}/\``).join(" nem ")}.`,
    "",
    `O executor instala na primeira sessão — ${ausentes.map((item) => `\`${item.comando}\``).join(", ")} — e a suíte só roda depois disso.`,
    "Se a CLI dele recusar o comando, o gate 2 vai reprovar por falta de pacote, e não por defeito do código:",
    "aí o remédio é instalar à mão, ou usar uma CLI cujo executor possa executar.",
  ].join("\n");
}

/**
 * O runner de fluxos, que é ferramenta do HARNESS e mora no projeto.
 *
 * O gate 4 abre a aplicação com `@playwright/test`, resolvido a partir do
 * projeto — é o que faz o roteiro rodar com as dependências que o produto
 * realmente tem. A consequência é que o projeto precisa declará-lo, mesmo quando
 * a suíte dele usa outro runner.
 *
 * No `MCP_teste2` isso só apareceu no gate 4 da fase 2, e custou um ciclo: a
 * aplicação estava pronta, o roteiro escrito, e a passagem morreu em "Cannot
 * find package '@playwright/test'". O preflight tinha como saber disso antes da
 * primeira chamada de modelo — o esqueleto declara os fluxos, e o manifesto diz
 * o que está instalado.
 */
export async function faltaORunnerDeFluxos(projectRoot: string, esqueleto: string): Promise<boolean> {
  // Sem fluxo declarado, o gate 4 não roda e o runner não faz falta.
  if (!/^###\s+workflow\s+/m.test(esqueleto)) return false;
  return !(await existe(join(projectRoot, "node_modules", "@playwright", "test")));
}

export const AVISO_DO_RUNNER = [
  "o gate 4 abre a aplicação com `@playwright/test`, e ele não está instalado neste projeto.",
  "",
  "O executor instala quando o gate pedir, e isso custa um ciclo da fase em que acontecer.",
  "Para evitá-lo, declare `@playwright/test` como dependência de desenvolvimento antes de começar",
  "— ou rode com `--no-flows`, se não quiser que a aplicação seja aberta.",
].join("\n");
