/**
 * I-02 — o stamp de inputs e seu frescor.
 *
 * A cadeia documental é encadeada por hash: cada documento grava na linha 3 os
 * 12 primeiros caracteres do sha256 dos arquivos que leu. Um upstream alterado
 * depois muda o hash, e o downstream passa a ser detectável como stale.
 */

import { createHash } from "node:crypto";
import type { ContractError, PhasesDocument } from "./phases.js";

/** Reconhece a linha de stamp. Saber a cara dela é conhecimento do contrato. */
export function isStampLine(line: string): boolean {
  return /^<!-- inputs:/.test(line);
}

/** Os 12 primeiros caracteres do sha256 dos bytes, minúsculos. */
export function sha12(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export interface StampInput {
  name: string;
  content: string;
}

export function buildStamp(inputs: StampInput[]): string {
  const entries = inputs.map((input) => `${input.name}@sha256:${sha12(input.content)}`);
  return `<!-- inputs: ${entries.join(" ")} -->`;
}

/**
 * Compara o stamp gravado com os bytes atuais dos inputs.
 *
 * Divergência é reportada como I-02 porque o documento descreve um upstream que
 * já não existe: seguir em frente implementaria um plano derivado de uma versão
 * anterior das decisões.
 */
export function checkStamp(document: PhasesDocument, inputs: StampInput[]): ContractError[] {
  const errors: ContractError[] = [];
  const stamp = document.stamp;
  if (!stamp) return errors;

  const recorded = new Map(stamp.inputs.map((entry) => [entry.name, entry.sha12]));

  for (const input of inputs) {
    const current = sha12(input.content);
    const registered = recorded.get(input.name);
    if (registered === undefined) {
      errors.push({
        code: "I-02",
        line: stamp.line,
        message: `o stamp não cita ${input.name}`,
        hint: `regenere o stamp incluindo ${input.name}@sha256:${current}`,
      });
      continue;
    }
    if (registered !== current) {
      errors.push({
        code: "I-02",
        line: stamp.line,
        message: `${input.name} mudou depois que este documento foi gerado (stamp ${registered}, atual ${current})`,
        hint: `reabra a fase documental que consome ${input.name}, refaça o documento sobre a versão atual e atualize o stamp`,
      });
    }
  }

  const expected = new Set(inputs.map((input) => input.name));
  for (const entry of stamp.inputs) {
    if (expected.has(entry.name)) continue;
    errors.push({
      code: "I-02",
      line: stamp.line,
      message: `o stamp cita ${entry.name}, que não é um input desta cadeia`,
      hint: "regenere o stamp com exatamente os documentos que este artefato leu",
    });
  }

  return errors;
}
