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
