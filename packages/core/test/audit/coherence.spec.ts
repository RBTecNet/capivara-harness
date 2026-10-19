import { describe, expect, it } from "vitest";
import { CoherenceMemory } from "../../src/audit/coherence.js";
import type { AuditVerdict } from "../../src/audit/protocol.js";

const criteria = [
  { address: "P1.T1.C1", text: "request lança ApiError", taskTitle: "cliente" },
  { address: "P2.T1.C1", text: "listTarefas usa request", taskTitle: "serviço" },
  { address: "P2.T2.C1", text: "página provisória", taskTitle: "página" },
];
const approved: AuditVerdict = { status: "APPROVED", findings: [], remarks: [], reason: "coerente" };
const reject = (where: string): AuditVerdict => ({
  status: "REJECTED", findings: [{ where, problem: "contradição alegada", fix: "mude o cliente" }], remarks: [], reason: "conflito",
});
describe("memória de coerência sob a mesma autoridade", () => {
  it("aprovação prévia cobre critérios e tasks idênticos; diagnóstico fica como observação", () => {
    const memory = new CoherenceMemory();
    memory.reconcile(approved, criteria, "decisões A");
    const changed = [...criteria.slice(0, 2), { ...criteria[2]!, text: "página definitiva" }];
    expect(memory.changed(changed, "decisões A")).toEqual(["P2.T2.C1"]);
    const verdict = memory.reconcile(reject("P1.T1.C1 vs P2.T1"), changed, "decisões A");
    expect(verdict.status).toBe("APPROVED");
    expect(verdict.findings).toEqual([]);
    expect(verdict.remarks[0]?.observation).toContain("coerência já aprovada");
  });
  it.each(["critério", "decisão", "sem base", "desconhecido", "sem par", "novo critério", "critério removido"])("mantém bloqueio real ou não resolvido: %s", cause => {
    const memory = new CoherenceMemory();
    if (cause !== "sem base") memory.reconcile(approved, criteria, "A");
    let current = criteria;
    if (cause === "critério") current = [{ ...criteria[0]!, text: "request lança string" }, ...criteria.slice(1)];
    if (cause === "novo critério") current = [...criteria, { ...criteria[1]!, address: "P2.T1.C2", text: "outro resultado" }];
    if (cause === "critério removido") current = criteria.slice(1);
    const verdict = reject(cause === "desconhecido" ? "P1.T1.C1 vs P99.T1.C1" : cause === "sem par" ? "P1.T1.C1" : "P1.T1 vs P2.T1");
    const authority = cause === "decisão" ? "B" : "A";
    expect(memory.reconcile(verdict, current, authority).status).toBe("REJECTED");
    if (cause === "decisão") expect(memory.changed(current, authority)).toBeUndefined();
  });
  it("em veredito misto, só a relação intacta vira ressalva", () => {
    const memory = new CoherenceMemory();
    memory.reconcile(approved, criteria, "A");
    const current = [...criteria.slice(0, 2), { ...criteria[2]!, text: "request lança string" }];
    const stable = reject("P1.T1.C1 vs P2.T1.C1").findings;
    const changed = reject("P1.T1.C1 vs P2.T2.C1").findings;
    const result = memory.reconcile({ ...approved, status: "REJECTED", findings: [...stable, ...changed] }, current, "A");
    expect(result.status).toBe("REJECTED");
    expect(result.findings).toEqual(changed);
    expect(result.remarks).toHaveLength(1);
  });
});
