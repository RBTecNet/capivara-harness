import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_RETURNS,
  formatVerdict,
  nextAuditAction,
  parseAudit,
  persistentFindings,
  renderStandoff,
} from "../../src/audit/index.js";
import type { AuditAttempt, AuditVerdict } from "../../src/audit/index.js";
import { auditorPrompt } from "../../src/prompts/index.js";

const approved = ["CAPIVARA_AUDIT_STATUS: APPROVED", "CAPIVARA_REASON: fiel ao prompt e às decisões aceitas"].join("\n");
const rejected = [
  "CAPIVARA_AUDIT_STATUS: REJECTED",
  "CAPIVARA_FINDING: US-1.2 | o critério \"funciona corretamente\" não é verificável | substitua por uma condição observável com limite numérico",
  "CAPIVARA_REASON: critério não binário em US-1.2",
].join("\n");

describe("protocolo do auditor", () => {
  it("lê uma aprovação", () => {
    const parsed = parseAudit(approved);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verdict.status).toBe("APPROVED");
  });

  it("lê uma devolução com finding de três campos", () => {
    const parsed = parseAudit(rejected);
    if (!parsed.ok) throw new Error(parsed.defects.join("; "));
    expect(parsed.verdict.findings[0]).toMatchObject({ where: "US-1.2" });
    expect(parsed.verdict.findings[0]?.fix).toContain("condição observável");
  });

  it("tolera CRLF e espaços em volta dos valores", () => {
    const parsed = parseAudit("CAPIVARA_AUDIT_STATUS:   APPROVED  \r\nCAPIVARA_REASON:  ok  \r\n");
    expect(parsed.ok).toBe(true);
  });

  it("ignora prosa em volta do bloco", () => {
    expect(parseAudit(`Claro! Aqui vai:\n${approved}\nEspero ter ajudado.`).ok).toBe(true);
  });

  it("faz round-trip com formatVerdict", () => {
    const parsed = parseAudit(rejected);
    if (!parsed.ok) throw new Error("esperava veredito");
    expect(parseAudit(formatVerdict(parsed.verdict))).toEqual(parsed);
  });
});

describe("saída inválida repete só o auditor", () => {
  const defectsOf = (output: string): string[] => {
    const parsed = parseAudit(output);
    return parsed.ok ? [] : parsed.defects;
  };

  it("REJECTED sem finding", () => {
    const defects = defectsOf("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_REASON: ruim");
    expect(defects.join(" ")).toContain("sem nenhum CAPIVARA_FINDING");
  });

  it("finding sem o campo de correção", () => {
    const defects = defectsOf("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: US-1.2 | está errado\nCAPIVARA_REASON: x");
    expect(defects.join(" ")).toContain("três campos");
  });

  it("finding cuja correção apenas repete o problema", () => {
    const defects = defectsOf(
      "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: US-1.2 | critério vago | critério vago\nCAPIVARA_REASON: x",
    );
    expect(defects.join(" ")).toContain("apenas repete o problema");
  });

  it("APPROVED com finding", () => {
    const defects = defectsOf(
      "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_FINDING: a | b | c\nCAPIVARA_REASON: x",
    );
    expect(defects.join(" ")).toContain("APPROVED com CAPIVARA_FINDING");
  });

  it("status ausente, duplicado ou inventado", () => {
    expect(defectsOf("CAPIVARA_REASON: x").join(" ")).toContain("nenhum CAPIVARA_AUDIT_STATUS");
    expect(defectsOf(`${approved}\nCAPIVARA_AUDIT_STATUS: REJECTED`).join(" ")).toContain("exatamente uma");
    expect(defectsOf("CAPIVARA_AUDIT_STATUS: TALVEZ\nCAPIVARA_REASON: x").join(" ")).toContain("status inválido");
  });

  it("razão ausente ou vazia", () => {
    expect(defectsOf("CAPIVARA_AUDIT_STATUS: APPROVED").join(" ")).toContain("CAPIVARA_REASON");
    expect(defectsOf("CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON:   ").join(" ")).toContain("CAPIVARA_REASON");
  });

  it("aprovação com ressalva é válida e não bloqueia", () => {
    const parsed = parseAudit(`CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REMARK: Overview | poderia citar o limite de reservas\nCAPIVARA_REASON: ok`);
    if (!parsed.ok) throw new Error(parsed.defects.join("; "));
    expect(parsed.verdict.remarks).toHaveLength(1);
  });
});

describe("ciclo de devolução", () => {
  const verdict = (status: "APPROVED" | "REJECTED", where = "US-1.2"): AuditVerdict => ({
    status,
    findings: status === "REJECTED" ? [{ where, problem: "critério vago", fix: "use um limite numérico" }] : [],
    remarks: [],
    reason: "r",
  });

  const attempt = (n: number, status: "APPROVED" | "REJECTED", where?: string): AuditAttempt => ({
    attempt: n,
    verdict: verdict(status, where),
    writerSummary: `tentativa ${n}: reescreveu US-1.2`,
  });

  it("aprovado publica", () => {
    const action = nextAuditAction({ document: "user-stories.md", history: [attempt(1, "APPROVED")], maxReturns: 3 });
    expect(action.action).toBe("publish");
  });

  it("devolve ao escritor enquanto houver teto", () => {
    const action = nextAuditAction({ document: "user-stories.md", history: [attempt(1, "REJECTED")], maxReturns: 3 });
    expect(action.action).toBe("return-to-writer");
    if (action.action === "return-to-writer") expect(action.findings[0]?.fix).toContain("limite numérico");
  });

  it("esgotado o teto, pergunta ao desenvolvedor em vez de aceitar ou desistir", () => {
    const history = [attempt(1, "REJECTED"), attempt(2, "REJECTED"), attempt(3, "REJECTED")];
    const action = nextAuditAction({ document: "user-stories.md", history, maxReturns: DEFAULT_MAX_RETURNS });
    expect(action.action).toBe("ask-developer");
    if (action.action !== "ask-developer") return;
    expect(action.standoff.returns).toBe(3);
    expect(action.standoff.writerDid).toHaveLength(3);
  });

  it("o impasse mostra lado a lado a insistência do auditor e o que o escritor fez", () => {
    const history = [attempt(1, "REJECTED", "US-1.2"), attempt(2, "REJECTED", "US-2.1"), attempt(3, "REJECTED", "US-1.2")];
    const action = nextAuditAction({ document: "user-stories.md", history, maxReturns: 3 });
    if (action.action !== "ask-developer") throw new Error("esperava impasse");
    const texto = renderStandoff(action.standoff);
    expect(texto).toContain("O auditor insiste em:");
    expect(texto).toContain("O escritor fez:");
    expect(texto).toContain("gap de entrevista");
  });

  it("findings equivalentes não são contados duas vezes no impasse", () => {
    const history = [attempt(1, "REJECTED", "US-1.2"), attempt(2, "REJECTED", "US-1.2")];
    expect(persistentFindings(history)).toHaveLength(1);
  });

  it("uma aprovação depois de devoluções publica e encerra", () => {
    const history = [attempt(1, "REJECTED"), attempt(2, "APPROVED")];
    expect(nextAuditAction({ document: "x.md", history, maxReturns: 3 }).action).toBe("publish");
  });
});

describe("prompt do auditor", () => {
  const context = {
    language: "português do Brasil",
    document: "user-stories.md",
    executable: false,
    request: "um sistema de reservas",
    decisions: ["Stack: Node"],
    dispositions: ["Q-01 ACCEPTED"],
    upstream: [],
    content: "# X — User Stories",
  };

  it("o eixo de executabilidade só aparece no plano executável", () => {
    expect(auditorPrompt(context)).not.toContain("EXECUTABILITY");
    expect(auditorPrompt({ ...context, document: "project-phases.md", executable: true })).toContain("EXECUTABILITY");
  });

  it("o eixo de executabilidade reprova fase que não cabe numa sessão", () => {
    const prompt = auditorPrompt({ ...context, document: "project-phases.md", executable: true });
    expect(prompt).toContain("exceed one session");
    expect(prompt).toContain("15 tasks");
  });

  it("declara a regra da dúvida: aprova e ressalva", () => {
    expect(auditorPrompt(context)).toContain("When in doubt, approve and remark");
  });

  it("proíbe rejeitar por preferência de escrita", () => {
    expect(auditorPrompt(context)).toContain("would have written differently");
  });

  it("proíbe o auditor de editar o documento", () => {
    expect(auditorPrompt(context)).toContain("cannot edit it");
  });

  it("manda não reauditar o que o parser já provou", () => {
    expect(auditorPrompt(context)).toContain("Do not re-audit the shape the parser owns");
  });

  it("proíbe exigir do DBML o que o DBML não tem sintaxe para expressar", () => {
    const prompt = auditorPrompt({ ...context, document: "database-schema.md" });
    expect(prompt).toContain("demand that DBML express what DBML has no syntax for");
    expect(prompt).toContain("a finding the writer cannot");
    expect(prompt).toContain("structural and conformant");
  });

  it("declara a fronteira entre declarar e implementar", () => {
    const prompt = auditorPrompt(context);
    expect(prompt).toContain("DECLARES what must be true");
    expect(prompt).toContain("belongs to the execution plan");
    expect(prompt).toContain("Never reject a document for not implementing what it correctly declares");
  });

  it("nomeia o que é trabalho e não pertence ao documento", () => {
    const prompt = auditorPrompt(context);
    for (const trabalho of ["Seed migrations", "triggers", "runtime validation", "immutability enforcement"]) {
      expect(prompt).toContain(trabalho);
    }
  });

  it("avisa que um finding impossível de fechar para o run", () => {
    expect(auditorPrompt(context)).toContain("a finding the writer cannot close");
  });

  it("carrega o bloco de idioma resolvido", () => {
    expect(auditorPrompt(context)).toContain("português do Brasil");
  });
});
