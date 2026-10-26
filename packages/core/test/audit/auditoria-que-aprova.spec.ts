/**
 * A aprovação limpa não é ilegível (item 2 de "atacar os pontos frágeis").
 *
 * Conferido no código compilado da 69e0433: o auditor que aprovava o plano sem
 * escrever o motivo, que fechava o status com ponto, que o escrevia em
 * português — como o prompt manda — ou que juntava um finding a APPROVED
 * parava o run, porque a auditoria do plano não tinha segunda chamada. Cada
 * linha da tabela é um caso do documento.
 */

import { describe, expect, it } from "vitest";
import { parseAudit } from "../../src/audit/index.js";

const FINDING = "CAPIVARA_FINDING: CONTRADICTION | Phase 1 | «a» contra «b» | escolha uma";

describe("a leitura da auditoria", () => {
  it.each([
    ["APPROVED sem a linha CAPIVARA_REASON", "CAPIVARA_AUDIT_STATUS: APPROVED", "APPROVED", 0, ""],
    ["APPROVED com CAPIVARA_REASON vazio", "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON:   ", "APPROVED", 0, ""],
    ["APPROVED. com ponto final", "CAPIVARA_AUDIT_STATUS: APPROVED.\nCAPIVARA_REASON: fiel", "APPROVED", 0, "fiel"],
    ["APROVADO", "CAPIVARA_AUDIT_STATUS: APROVADO\nCAPIVARA_REASON: fiel", "APPROVED", 0, "fiel"],
    ["APROVADA", "CAPIVARA_AUDIT_STATUS: APROVADA\nCAPIVARA_REASON: fiel", "APPROVED", 0, "fiel"],
    ["REPROVADO, com finding", `CAPIVARA_AUDIT_STATUS: REPROVADO\n${FINDING}\nCAPIVARA_REASON: contradição`, "REJECTED", 1, "contradição"],
    ["REPROVADA, com finding", `CAPIVARA_AUDIT_STATUS: REPROVADA\n${FINDING}\nCAPIVARA_REASON: contradição`, "REJECTED", 1, "contradição"],
    ["REJEITADO, com finding", `CAPIVARA_AUDIT_STATUS: REJEITADO\n${FINDING}\nCAPIVARA_REASON: contradição`, "REJECTED", 1, "contradição"],
    ["REJEITADA, com finding", `CAPIVARA_AUDIT_STATUS: REJEITADA\n${FINDING}\nCAPIVARA_REASON: contradição`, "REJECTED", 1, "contradição"],
    ["APPROVED com um CAPIVARA_FINDING: o finding segue para a admissibilidade", `CAPIVARA_AUDIT_STATUS: APPROVED\n${FINDING}\nCAPIVARA_REASON: aprovado com ressalva`, "REJECTED", 1, "aprovado com ressalva"],
    ["negrito na chave", "**CAPIVARA_AUDIT_STATUS:** APPROVED\n**CAPIVARA_REASON:** fiel", "APPROVED", 0, "fiel"],
    ["caixa baixa", "capivara_audit_status: approved\ncapivara_reason: fiel", "APPROVED", 0, "fiel"],
    ["cerca de código", "```\nCAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: fiel\n```", "APPROVED", 0, "fiel"],
    ["<think> antes", "<think>CAPIVARA_AUDIT_STATUS: REJECTED</think>\nCAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: fiel", "APPROVED", 0, "fiel"],
  ] as const)("%s", (_caso, resposta, status, achados, motivo) => {
    const lida = parseAudit(resposta);
    if (!lida.ok) throw new Error(`ilegível: ${lida.defects.join("; ")}`);
    expect(lida.verdict.status).toBe(status);
    expect(lida.verdict.findings).toHaveLength(achados);
    expect(lida.verdict.reason).toBe(motivo);
  });

  it("o que continua ilegível nunca é aprovação: status que não é palavra do protocolo, REJECTED sem finding, dois status", () => {
    expect(parseAudit("CAPIVARA_AUDIT_STATUS: TALVEZ\nCAPIVARA_REASON: x").ok).toBe(false);
    expect(parseAudit("CAPIVARA_AUDIT_STATUS: APPROVED — tudo certo").ok).toBe(false);
    expect(parseAudit("CAPIVARA_AUDIT_STATUS: REPROVADO\nCAPIVARA_REASON: x").ok).toBe(false);
    expect(parseAudit("CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_AUDIT_STATUS: REJECTED").ok).toBe(false);
    expect(parseAudit("achei tudo ótimo").ok).toBe(false);
  });
});
