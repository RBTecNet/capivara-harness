import { describe, expect, it } from "vitest";
import { QUESTIONS_CONTRACT, parseQuestionBatch } from "../../src/interview/index.js";

const question = (overrides: Record<string, unknown> = {}) => ({
  id: "Q-01",
  topic: "stack",
  evidence: "O diretório está vazio; nada indica linguagem nem framework.",
  decision: "Qual stack o projeto usa?",
  why: "Define os comandos de build e teste e a forma de todas as fases.",
  options: [
    { label: "Node + Vitest", consequence: "Suíte rápida; ecossistema que você já usa." },
    { label: "Python + pytest", consequence: "Melhor para processamento de dados; outro runner." },
  ],
  recommended: "Node + Vitest",
  recommendationBasis: "É a stack do restante dos seus projetos.",
  ...overrides,
});

const batch = (questions: unknown[]) => JSON.stringify({ contract: QUESTIONS_CONTRACT, questions });

describe("parseQuestionBatch", () => {
  it("aceita um lote bem formado", () => {
    const result = parseQuestionBatch(batch([question()]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.questions[0]?.id).toBe("Q-01");
  });

  it("aceita lote vazio — nem todo documento tem gap material", () => {
    const result = parseQuestionBatch(batch([]));
    expect(result.ok).toBe(true);
  });

  it("aceita pergunta aberta, sem opções", () => {
    const result = parseQuestionBatch(batch([question({ options: [], recommended: "", recommendationBasis: "" })]));
    expect(result.ok).toBe(true);
  });

  it("tolera cerca de código em volta do JSON", () => {
    const result = parseQuestionBatch("```json\n" + batch([question()]) + "\n```");
    expect(result.ok).toBe(true);
  });

  it("rejeita resposta que não é JSON", () => {
    const result = parseQuestionBatch("claro, aqui vão as perguntas:");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defects[0]?.problem).toContain("JSON");
  });

  it("rejeita contrato ausente", () => {
    const result = parseQuestionBatch(JSON.stringify({ questions: [] }));
    expect(result.ok).toBe(false);
  });
});

describe("uma pergunta incompleta nunca chega à tela", () => {
  const defectsFor = (overrides: Record<string, unknown>): string[] => {
    const result = parseQuestionBatch(batch([question(overrides)]));
    return result.ok ? [] : result.defects.map((defect) => defect.problem);
  };

  it("sem evidência", () => {
    expect(defectsFor({ evidence: "" })).toContain("sem evidência");
  });

  it("sem a decisão que falta", () => {
    expect(defectsFor({ decision: "" })).toContain("sem a decisão que falta");
  });

  it("sem o motivo", () => {
    expect(defectsFor({ why: "" })).toContain("sem o motivo");
  });

  it("com opções e sem recomendação", () => {
    expect(defectsFor({ recommended: "" })).toContain("opções sem recomendação");
  });

  it("com recomendação que não é uma das opções", () => {
    expect(defectsFor({ recommended: "Go + testing" })).toContain("a recomendação não é uma das opções");
  });

  it("com opção sem consequência", () => {
    expect(defectsFor({ options: [{ label: "A", consequence: "" }, { label: "B", consequence: "x" }] })).toContain("opção sem consequência");
  });

  it("com uma única opção, que não é escolha", () => {
    expect(defectsFor({ options: [{ label: "A", consequence: "x" }], recommended: "A" })).toContain("uma única opção não é uma escolha");
  });

  it("com id fora do formato", () => {
    expect(defectsFor({ id: "pergunta1" })).toContain("id fora do formato");
  });

  it("todo defeito traz a orientação de correção", () => {
    const result = parseQuestionBatch(batch([question({ evidence: "", why: "" })]));
    if (result.ok) throw new Error("esperava defeitos");
    for (const defect of result.defects) expect(defect.hint.length).toBeGreaterThan(15);
  });

  it("rejeita ids repetidos no mesmo lote", () => {
    const result = parseQuestionBatch(batch([question(), question()]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defects.map((d) => d.problem)).toContain("id repetido");
  });
});
