/**
 * Reparo estrutural.
 *
 * Defeito de REPRESENTAÇÃO é serialização: o modelo envolveu o documento numa
 * cerca de código, deixou o stamp velho, usou CRLF. Isso o código conserta
 * sozinho, de graça e sem erro.
 *
 * Defeito de SUBSTÂNCIA é decisão: falta uma fase, uma story não é coberta, um
 * critério é vago. Mandar isso para o reparo compra tentativas pagas que só
 * podem falhar, porque o reparo é proibido de mudar substância. Vai direto ao
 * escritor, com o finding.
 */

import { isStampLine } from "../contract/stamps.js";
import type { ContractError, InvariantCode } from "../contract/index.js";

export type DefectClass = "representation" | "substance";

const REPRESENTATION: readonly InvariantCode[] = ["I-01", "I-02", "I-04", "I-05"];

export function classifyDefect(code: InvariantCode): DefectClass {
  return REPRESENTATION.includes(code) ? "representation" : "substance";
}

/** Verdadeiro só quando TODO defeito é de representação. */
export function isRepairable(errors: readonly ContractError[]): boolean {
  return errors.length > 0 && errors.every((error) => classifyDefect(error.code) === "representation");
}

export function substanceDefects(errors: readonly ContractError[]): ContractError[] {
  return errors.filter((error) => classifyDefect(error.code) === "substance");
}

export interface DeterministicRepair {
  content: string;
  /** O que foi consertado, para o log. Vazio significa nada a fazer. */
  applied: string[];
}

/**
 * Conserta em código o que é mecanicamente conhecido.
 *
 * Roda ANTES de qualquer chamada de reparo ao modelo: cada defeito resolvido
 * aqui é uma chamada que não acontece.
 */
export function repairDeterministically(source: string, expectedStamp?: string): DeterministicRepair {
  const applied: string[] = [];
  let content = source;

  // Uma `Design ref` marcada como pendente não é decisão: o diretório de design
  // é opcional e sua ausência nunca é erro (D-18). O piloto 1 provou que pedir
  // isso ao modelo não basta — ele marcou 27 vezes e o desenvolvedor foi
  // interrogado 39 vezes sobre o caminho de um arquivo que não existe. O que se
  // resolve em código não pode depender da disciplina de quem escreve.
  const withoutPendingDesign = content.replace(/^[ \t]*-[ \t]*\*\*Design ref:\*\*[^\n]*\[NEEDS DECISION\][^\n]*\n/gm, "");
  if (withoutPendingDesign !== content) {
    content = withoutPendingDesign;
    applied.push("removeu Design ref pendente: a ausência de artefato de design nunca é decisão aberta");
  }

  // Um [NEEDS DECISION] dentro de uma célula de tabela não carrega afirmação
  // nenhuma: não dá para transformá-lo em pergunta, e ele bloquearia o gate por
  // um acidente de formatação. Vira travessão, e a linha da tabela sobrevive.
  const semMarcadorEmTabela = content
    .split("\n")
    .map((line) => (line.trimStart().startsWith("|") ? line.replace(/\[NEEDS DECISION\][^|]*?(\s*)(?=\||$)/g, "—$1") : line))
    .join("\n");
  if (semMarcadorEmTabela !== content) {
    content = semMarcadorEmTabela;
    applied.push("trocou marcador em célula de tabela por travessão: ali ele não declara decisão nenhuma");
  }

  if (content.includes("\r\n")) {
    content = content.replace(/\r\n/g, "\n");
    applied.push("normalizou CRLF para LF");
  }

  const fenced = /^\s*```(?:markdown|md|json)?\s*\n([\s\S]*?)\n```\s*$/.exec(content);
  if (fenced?.[1]) {
    content = fenced[1];
    applied.push("removeu a cerca de código que envolvia o documento inteiro");
  }

  content = content.replace(/^﻿/, "");

  if (expectedStamp !== undefined) {
    const lines = content.split("\n");
    if (lines[2] !== expectedStamp && isStampLine(lines[2] ?? "")) {
      lines[2] = expectedStamp;
      content = lines.join("\n");
      applied.push("atualizou o stamp de inputs com os hashes atuais");
    } else if (!isStampLine(lines[2] ?? "") && lines.length > 2) {
      lines.splice(2, 0, expectedStamp, "");
      content = lines.join("\n");
      applied.push("inseriu o stamp de inputs ausente");
    }
  }

  if (!content.endsWith("\n")) {
    content += "\n";
    applied.push("acrescentou a quebra de linha final");
  }

  return { content, applied };
}

/**
 * Remove marcadores cuja decisão JÁ FOI TOMADA.
 *
 * Quando o desenvolvedor responde um gap, o escritor deveria apagar o marcador
 * na reescrita. Nem sempre apaga — e o marcador então atravessa a cadeia inteira
 * e bloqueia o gate por uma decisão que já existe. O piloto 1 terminou NOT READY
 * exibindo, lado a lado, "PostgreSQL 16" como decisão confirmada e "SQLite,
 * faltam versões" como pendência.
 *
 * Apagar é seguro porque a pendência deixou de existir: a decisão está no
 * relatório e nos documentos.
 */
export function stripResolvedMarkers(content: string, resolved: readonly string[]): DeterministicRepair {
  const applied: string[] = [];
  let next = content;

  for (const marker of resolved) {
    const trimmed = marker.trim();
    if (trimmed === "") continue;
    const lines = next.split("\n");
    const kept = lines.filter((line) => !(line.includes("[NEEDS DECISION]") && line.includes(trimmed)));
    if (kept.length !== lines.length) {
      next = kept.join("\n");
      applied.push(`removeu marcador já decidido: ${trimmed.slice(0, 60)}`);
    }
  }

  return { content: next, applied };
}

/**
 * O plano sem os marcadores, para quem precisa da ESTRUTURA dele.
 *
 * Um `[NEEDS DECISION]` faz `parsePhases` recusar o documento (I-13), e essa
 * recusa tinha um efeito que ninguém tinha visto: a auditoria do plano só roda
 * fase por fase quando o documento parseia, então UM marcador derrubava as treze
 * chamadas paralelas, a aprovação por fase e a memória por task, e a auditoria
 * virava uma leitura do documento inteiro. No `assistencia2` foram onze
 * marcadores, quatro tentativas, e cada volta apontou fases diferentes — 1, 3, 4,
 * 9, 10, depois 5, 12, 10, depois 4, 5, 8, 9. Amostragem pura, com o mecanismo
 * que existe para evitá-la desligado em silêncio.
 *
 * O marcador continua bloqueando o que ele existe para bloquear: a PRONTIDÃO tem
 * um gate só para ele, e é ao desenvolvedor que ele fala. O que ele não pode é
 * decidir como o documento é auditado — e, de quebra, tirá-lo da vista do auditor
 * é o certo: a correção que um marcador pede é "resolva a decisão na entrevista",
 * coisa que quem reescreve a fase não pode fazer (§49).
 */
export function stripAllMarkers(content: string): DeterministicRepair {
  const lines = content.split("\n");
  const kept = lines.filter((line) => !line.includes("[NEEDS DECISION]"));
  return {
    content: kept.join("\n"),
    applied: kept.length === lines.length ? [] : [`ocultou ${lines.length - kept.length} marcador(es) de decisão pendente para auditar a estrutura`],
  };
}

/**
 * Referência de design que aponta para arquivo inexistente.
 *
 * O diretório de design é manual e quase sempre não existe (D-18), mas a
 * gramática mostra o campo — e mostrar um campo sem dizer que ele é dispensável
 * é convite para preenchê-lo. O piloto 4 voltou com 24 tasks apontando para
 * `design/fase-1/*.md` inventados, e as 24 viraram findings de auditoria: um
 * defeito só, repetido, consumindo o ciclo inteiro.
 *
 * Referência para arquivo que não existe é morta por definição, e o gate a
 * recusa de qualquer forma. Removê-la é estritamente melhor do que reprovar o
 * documento por causa dela — e é verificável em código, então não se pede ao
 * modelo.
 */
export function stripDeadDesignRefs(content: string, exists: (relativePath: string) => boolean): { content: string; applied: string[] } {
  const mortas: string[] = [];
  const limpo = content
    .split("\n")
    .filter((line) => {
      const referencia = /^[ \t]*-[ \t]*\*\*Design ref:\*\*[ \t]*(.+?)[ \t]*$/.exec(line);
      if (!referencia) return true;
      const caminho = (referencia[1] ?? "").replace(/^`|`$/g, "").trim();
      if (caminho === "" || exists(caminho)) return true;
      mortas.push(caminho);
      return false;
    })
    .join("\n");

  return {
    content: limpo,
    applied: mortas.length === 0 ? [] : [`removeu ${mortas.length} Design ref para arquivo inexistente (${mortas.slice(0, 3).join(", ")}${mortas.length > 3 ? "…" : ""})`],
  };
}
