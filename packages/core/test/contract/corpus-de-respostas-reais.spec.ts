/**
 * O corpus de respostas reais (item 10 de "atacar os pontos frágeis").
 *
 * Cada arquivo de `test/fixtures/respostas-reais/` é uma resposta que um modelo
 * deu num run de verdade, e o `.esperado.json` ao lado diz o que o parser tem de
 * ler dela. Um teste só percorre a pasta: a fragilidade nova de leitura vira um
 * arquivo ali, não uma regra nova — e a regra que a corrigir não pode desfazer
 * a leitura de nenhum dos que já estão.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAudit } from "../../src/audit/index.js";
import { jsonDaResposta } from "../../src/contract/index.js";
import { parseVerification } from "../../src/prompts/verifier.js";

const PASTA = join(import.meta.dirname, "../fixtures/respostas-reais");
const respostas = readdirSync(PASTA).filter((nome) => nome.endsWith(".txt")).sort();

interface Declarado {
  parser: "audit" | "g3" | "json";
  origem: string;
  habito: string;
  esperado: Record<string, unknown>;
}

const declarado = (nome: string): Declarado => JSON.parse(readFileSync(join(PASTA, nome.replace(/\.txt$/u, ".esperado.json")), "utf8")) as Declarado;

/** O que cada parser leu, na forma do `.esperado.json`. */
function leitura(parser: Declarado["parser"], texto: string): Record<string, unknown> {
  if (parser === "audit") {
    const lida = parseAudit(texto);
    if (!lida.ok) return { legivel: false, defeitos: lida.defects };
    return {
      legivel: true,
      status: lida.verdict.status,
      achados: lida.verdict.findings.length,
      classes: lida.verdict.findings.map((finding) => finding.classe ?? null),
      ressalvas: lida.verdict.remarks.length,
      decisoes: (lida.verdict.decisions ?? []).length,
      motivo: lida.verdict.reason,
    };
  }
  if (parser === "g3") return { vereditos: parseVerification(texto).map((veredito) => [veredito.index, veredito.done]) };
  const objeto = jsonDaResposta(texto) as { contract?: string; components?: unknown[]; phases?: unknown[] };
  return { contract: objeto.contract, componentes: objeto.components?.length, fases: objeto.phases?.length };
}

describe("o corpus de respostas reais", () => {
  it("existe, e cada resposta tem o esperado ao lado, com o parser que o nome diz", () => {
    expect(respostas.length).toBeGreaterThan(0);
    for (const nome of respostas) {
      const { parser, origem, habito } = declarado(nome);
      expect(nome.startsWith(`${parser}-`), nome).toBe(true);
      expect(origem.trim(), nome).not.toBe("");
      expect(habito.trim(), nome).not.toBe("");
    }
    const esperados = readdirSync(PASTA).filter((nome) => nome.endsWith(".esperado.json"));
    expect(esperados.map((nome) => nome.replace(/\.esperado\.json$/u, ".txt")).sort()).toEqual(respostas);
  });

  it.each(respostas)("%s é lida como declarado", (nome) => {
    const { parser, esperado } = declarado(nome);
    expect(leitura(parser, readFileSync(join(PASTA, nome), "utf8"))).toMatchObject(esperado);
  });

  it("nenhuma resposta traz chave, segredo ou token", () => {
    const segredo = /sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
    for (const nome of respostas) expect(segredo.test(readFileSync(join(PASTA, nome), "utf8")), nome).toBe(false);
  });
});
