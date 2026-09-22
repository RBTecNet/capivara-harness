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
 * Descobrir isto no preflight custa um `stat`.
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

/** A mensagem do preflight: o que falta, por que importa, e o que fazer. */
export function descreverDependencias(ausentes: readonly DependenciaAusente[]): string {
  if (ausentes.length === 0) return "";

  return [
    `as dependências declaradas em ${ausentes.map((item) => `\`${item.manifesto}\``).join(" e ")} não estão instaladas: ` +
      `não existe ${ausentes.map((item) => `\`${item.pasta}/\``).join(" nem ")}.`,
    "",
    "O gate 2 roda a suíte do projeto, e ela vai falhar por falta de pacote — não por defeito do código.",
    "O executor tenta instalar e quase sempre não pode: a permissão de shell é de quem invocou a CLI dele.",
    "",
    "Resolva antes de gastar um ciclo:",
    ...ausentes.map((item) => `  ${item.comando}`),
  ].join("\n");
}
