import { describe, expect, it } from "vitest";
import { applyMaterialityReview, materialityInput, materialityPrompt, type MaterialityInput } from "../../src/audit/materiality.js";
import type { AuditVerdict } from "../../src/audit/protocol.js";
import { parsePhaseFragment } from "../../src/contract/index.js";
import { PHASE_1, PHASE_2 } from "../support/fake-agent.js";

const original: AuditVerdict = {
  status: "REJECTED", findings: [{ where: "P1.T1.C1 vs P2.T1.C1", problem: "estados incompatíveis", fix: "mude o seed" }],
  remarks: [], reason: "conflito", decisions: [{ where: "P1.T1.C1", decision: "função ou classe?", options: ["função", "classe"] }],
};
const input: MaterialityInput = materialityInput(original, { request: "um cadastro de reservas", decisions: [],
  phases: [parsePhaseFragment(PHASE_1)!, parsePhaseFragment(PHASE_2)!] });
const evidence = [{ source: "P2", quote: "Uma reserva nova nasce com status pendente" }];
const advisory = { id: "F1", disposition: "ADVISORY", reason: "O estado inicial pode ser um dos estados do seed.", evidence };
const keep = { id: "D1", disposition: "KEEP" };

describe("revisão fundamentada dos bloqueios do plan", () => {
  it("desclassifica só o ponto fundamentado e conserva a decisão material", () => {
    const result = applyMaterialityReview(original, input, JSON.stringify({ reviews: [advisory, keep] }));
    expect(result.defects).toEqual([]);
    expect(result.advisory).toBe(1);
    expect(result.verdict.findings).toEqual([]);
    expect(result.verdict.decisions).toEqual(original.decisions);
    expect(result.verdict.remarks[0]?.observation).toContain(evidence[0]!.quote);
    expect(original.status).toBe("REJECTED");
    expect(original.findings).toHaveLength(1);
  });
  it("conserva o bloqueio funcional e pode remover apenas a dúvida técnica", () => {
    const result = applyMaterialityReview(original, input, JSON.stringify({ reviews: [
      { id: "F1", disposition: "KEEP" }, { ...advisory, id: "D1" },
    ] }));
    expect(result.verdict.status).toBe("REJECTED");
    expect(result.verdict.findings).toEqual(original.findings);
    expect(result.verdict.decisions).toEqual([]);
  });
  it("citação inválida conserva aquele bloqueio sem descartar a outra revisão fundamentada", () => {
    const result = applyMaterialityReview(original, input, JSON.stringify({ reviews: [
      { ...advisory, evidence: [{ source: "P2", quote: "Uma citação que a fonte não afirma" }] },
      { ...advisory, id: "D1", reason: "Função ou classe implementam o mesmo requisito sem decisão de negócio." },
    ] }));
    expect(result.defects).toHaveLength(1);
    expect(result.verdict.status).toBe("REJECTED");
    expect(result.verdict.findings).toEqual(original.findings);
    expect(result.verdict.decisions).toEqual([]);
    expect(result.advisory).toBe(1);
  });
  it.each([
    ["JSON inválido", "não há defeito"],
    ["omissão", JSON.stringify({ reviews: [advisory] })],
    ["duplicação", JSON.stringify({ reviews: [advisory, advisory] })],
    ["id estranho", JSON.stringify({ reviews: [advisory, { ...keep, id: "D99" }] })],
    ["parecer estranho", JSON.stringify({ reviews: [{ ...advisory, disposition: "SKIP" }, keep] })],
    ["sem razão", JSON.stringify({ reviews: [{ ...advisory, reason: "" }, keep] })],
    ["sem fonte", JSON.stringify({ reviews: [{ ...advisory, evidence: [] }, keep] })],
    ["fonte inventada", JSON.stringify({ reviews: [{ ...advisory, evidence: [{ ...evidence[0], source: "P99" }] }, keep] })],
    ["citação inventada", JSON.stringify({ reviews: [{ ...advisory, evidence: [{ source: "P2", quote: "Nenhuma reserva pode nascer pendente" }] }, keep] })],
    ["citação curta", JSON.stringify({ reviews: [{ ...advisory, evidence: [{ source: "P2", quote: "Uma" }] }, keep] })],
  ])("%s não remove nenhum bloqueio nem decisão", (_name, output) => {
    const result = applyMaterialityReview(original, input, output);
    expect(result.defects.length).toBeGreaterThan(0);
    expect(result.verdict).toBe(original);
  });
  it("envia só as fases referidas e explica escopo/momento sem pedir novos testes", () => {
    const selected = materialityInput({ ...original, findings: [{ ...original.findings[0]!, where: "P1.T1.C1", phase: 1 }], decisions: [] }, {
      request: "cadastro", decisions: [], phases: [parsePhaseFragment(PHASE_1)!, parsePhaseFragment(PHASE_2)!],
    });
    expect(selected.sources.map(source => source.id)).toEqual(["request", "decisions", "P1"]);
    const prompt = materialityPrompt(selected);
    expect(prompt).toContain("204 is compatible with '200 or 204'");
    expect(prompt).toContain("Validation before POST and showing errors after GET");
    expect(prompt).toContain("An empty database fixture and persistence in another test scenario");
    expect(prompt).toContain("Do not demand an extra test for every sentence");
  });
});
