/**
 * O que pode devolver o plano, julgado pelo Core.
 *
 * O auditor do plano acha; quem decide se o achado bloqueia é o Core, sem
 * modelo. Antes havia uma triagem de materialidade — outra chamada, outro
 * modelo — e um auditor com sete eixos de caça a lacunas contido por exceções
 * no prompt. Agora só três classes bloqueiam, e cada uma traz o que se confere
 * em código:
 *
 * - CONTRADICTION: duas passagens que não podem valer juntas, citadas entre
 *   « » — as duas têm de existir, letra por letra, nos documentos. O modelo
 *   acha a incompatibilidade lendo; o Core confere que as passagens existem.
 * - INTERFACE: um nome, uma chave ou uma rota citada entre « » — tem de existir
 *   dos dois lados: em dois documentos, ou em duas fases do plano.
 * - DEPENDENCY: um pacote citado entre « » — tem de aparecer nos documentos e
 *   faltar em `infrastructure.dependencies`.
 *
 * O resto — e o achado de classe certa que não passa na conferência — vira
 * observação do relatório final: sem rodada extra, sem pergunta.
 */

import type { Finding } from "./protocol.js";

export const CLASSES_QUE_BLOQUEIAM = ["CONTRADICTION", "INTERFACE", "DEPENDENCY"] as const;

/** Um lugar onde uma citação pode estar: um documento, ou uma fase do plano. */
export interface Lugar {
  nome: string;
  texto: string;
}

export type Admissao = { bloqueia: true } | { bloqueia: false; motivo: string };

/** O texto como se compara: sem negrito nem crase, com o espaço normalizado. */
function normalizar(texto: string): string {
  return texto.replace(/[*`]/gu, "").replace(/\s+/gu, " ").trim();
}

/** As passagens citadas entre « », “ ” ou aspas duplas, na ordem, sem repetição. */
export function citacoes(texto: string): string[] {
  const achadas = [...texto.matchAll(/«([^»]+)»|“([^”]+)”|"([^"]+)"/gu)]
    .map((citacao) => normalizar(citacao[1] ?? citacao[2] ?? citacao[3] ?? ""))
    .filter((citacao) => citacao.length >= 2);
  return [...new Set(achadas)];
}

function ondeEsta(citacao: string, lugares: readonly Lugar[]): string[] {
  return lugares.filter((lugar) => normalizar(lugar.texto).includes(citacao)).map((lugar) => lugar.nome);
}

export function admitir(finding: Finding, lugares: readonly Lugar[], dependencias: readonly string[]): Admissao {
  const classe = finding.classe ?? "";
  if (!(CLASSES_QUE_BLOQUEIAM as readonly string[]).includes(classe)) {
    return { bloqueia: false, motivo: classe === "" ? "o achado não declara classe" : `a classe ${classe} não bloqueia o plano` };
  }
  const citadas = citacoes(`${finding.where} ${finding.problem}`);

  if (classe === "CONTRADICTION") {
    const encontradas = citadas.filter((citacao) => ondeEsta(citacao, lugares).length > 0);
    return encontradas.length >= 2
      ? { bloqueia: true }
      : { bloqueia: false, motivo: `a contradição precisa de duas passagens citadas que existam nos documentos; ${encontradas.length} de ${citadas.length} citação(ões) encontrada(s)` };
  }

  if (classe === "INTERFACE") {
    return citadas.some((citacao) => new Set(ondeEsta(citacao, lugares)).size >= 2)
      ? { bloqueia: true }
      : { bloqueia: false, motivo: "nenhum nome, chave ou rota citada existe dos dois lados" };
  }

  const declaradas = new Set(dependencias.map((nome) => nome.trim().toLowerCase()));
  return citadas.some((citacao) => ondeEsta(citacao, lugares).length > 0 && !declaradas.has(citacao.toLowerCase()))
    ? { bloqueia: true }
    : { bloqueia: false, motivo: "nenhum pacote citado aparece nos documentos fora de infrastructure.dependencies" };
}
