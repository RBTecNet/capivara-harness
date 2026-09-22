/**
 * Os testes nomeados pela fase, procurados na árvore de verdade.
 *
 * Esta é a metade mecânica do gate 3, e ela existe porque a outra metade varia:
 * na fase 4 do MCP_teste o mesmo verificador aprovou a task 6 no ciclo 1 e a
 * reprovou no ciclo 2, sobre o mesmo código, enquanto o ciclo 1 reprovava a
 * task 8. Dois buracos reais, presentes desde o começo, achados a conta-gotas —
 * dois ciclos gastos para descobrir o que uma busca por nome acha de uma vez.
 *
 * O resultado NÃO é veredito. O nome pode estar coberto por um teste que se
 * chama outra coisa, e quem decide isso é quem lê o código. O que o inventário
 * garante é que o verificador comece sabendo de todos, em vez de achar um por
 * vez conforme a atenção dele cair.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { NamedFeatureTest } from "../contract/index.js";

/** Pastas que nunca contêm teste do projeto e custam caro para varrer. */
const IGNORADAS = new Set(["node_modules", ".git", ".next", ".capivara", "dist", "build", "coverage", ".venv", "__pycache__", "vendor", "target"]);

/** Arquivos grandes demais para serem código de teste. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface FeatureTestSearch extends NamedFeatureTest {
  found: boolean;
}

async function arquivos(raiz: string, profundidade = 0): Promise<string[]> {
  if (profundidade > 8) return [];
  const entradas = await readdir(raiz, { withFileTypes: true }).catch(() => []);
  const achados: string[] = [];

  for (const entrada of entradas) {
    if (entrada.name.startsWith(".") && entrada.name !== ".") continue;
    const caminho = join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      if (IGNORADAS.has(entrada.name)) continue;
      achados.push(...(await arquivos(caminho, profundidade + 1)));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|php|cs|ex|exs)$/.test(entrada.name)) achados.push(caminho);
  }

  return achados;
}

/**
 * Procura cada nome, literalmente, em todo arquivo de código do projeto.
 *
 * Literal de propósito: um nome que o plano escreveu e ninguém usou não aparece
 * em lugar nenhum, e é disso que se trata. Procurar "parecido" devolveria
 * qualquer coisa e o inventário perderia o sentido.
 */
export async function procurarTestesNomeados(
  projectRoot: string,
  nomes: readonly NamedFeatureTest[],
): Promise<FeatureTestSearch[]> {
  if (nomes.length === 0) return [];

  const encontrados = new Set<string>();
  for (const caminho of await arquivos(projectRoot)) {
    if (encontrados.size === nomes.length) break;
    const tamanho = await stat(caminho).then((info) => info.size).catch(() => Number.MAX_SAFE_INTEGER);
    if (tamanho > MAX_BYTES) continue;

    const conteudo = await readFile(caminho, "utf8").catch(() => "");
    if (conteudo === "") continue;
    for (const { name } of nomes) {
      if (!encontrados.has(name) && conteudo.includes(name)) encontrados.add(name);
    }
  }

  return nomes.map((nome) => ({ ...nome, found: encontrados.has(nome.name) }));
}
