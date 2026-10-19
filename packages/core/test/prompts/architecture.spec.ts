/**
 * Os prompts da arquitetura: o arquiteto concentra o raciocínio, o auditor da
 * arquitetura julga pelos eixos que o plano precisa — e nenhum dos dois pede
 * teste.
 */
import { describe, expect, it } from "vitest";
import { architectPrompt, architectureAuditPrompt } from "../../src/prompts/index.js";

const contexto = {
  language: "português do Brasil",
  request: "um sistema de reservas",
  skeleton: "# Pousada — Skeleton\n\n## Stack\n- Linguagem: Node 22",
  decisions: ["PostgreSQL 16"],
  assumptions: [],
  inventory: "vazio",
  maxTasksPerPhase: 15,
  maxCriteriaPerTask: 4,
};

describe("o prompt do arquiteto", () => {
  const prompt = architectPrompt(contexto);

  it("decide componentes, contratos, infraestrutura com autoridade e a divisão de fases", () => {
    for (const trecho of ["1. COMPONENTS", "2. CONTRACTS", "5. INFRASTRUCTURE", "EVERY item carries `basis`", "6. PHASES", "capivara-architecture/v1"]) {
      expect(prompt).toContain(trecho);
    }
  });

  it("pode reorganizar as fases do esqueleto sem perder cobertura nem mudar requisito de negócio", () => {
    expect(prompt).toContain("It is a proposal: split, merge, reorder and");
    expect(prompt).toContain("every story,");
    expect(prompt).toContain("change a business requirement, which is the developer's alone");
  });

  it("dimensiona por complexidade efetiva, com o teto como limite e não como alvo", () => {
    expect(prompt).toContain("Size each phase by EFFECTIVE COMPLEXITY, not by counting tasks");
    expect(prompt).toContain("That ceiling is a limit, never a target");
    expect(prompt).toContain("A phase never needs an architectural decision you did not take");
  });

  it("não inventa versão nem pacote, não prescreve teste e não escreve código", () => {
    expect(prompt).toContain("Never invent a version or a package");
    expect(prompt).toContain("Prescribe tests, test files, test names, validation procedures or a testing strategy");
    expect(prompt).toContain("Write application code");
  });

  it("recebe o esqueleto inteiro, o pedido e as decisões", () => {
    expect(prompt).toContain("## The skeleton — the product this architecture serves");
    expect(prompt).toContain("Linguagem: Node 22");
    expect(prompt).toContain("um sistema de reservas");
    expect(prompt).toContain("- PostgreSQL 16");
  });

  it("a emenda recebe a arquitetura anterior e os achados, e preserva o que não foi citado", () => {
    const emenda = architectPrompt({ ...contexto, previous: { architecture: '{"contract":"x"}', findings: [{ where: "phases · Phase 2", problem: "grande demais", fix: "divida em duas" }] } });
    expect(emenda).toContain("## The audit of your previous architecture found");
    expect(emenda).toContain("phases · Phase 2: grande demais");
    expect(emenda).toContain("## Your previous architecture");
    expect(emenda).toContain("keeps the work already");
  });

  it("os defeitos mecânicos da tentativa anterior chegam nomeados", () => {
    expect(architectPrompt({ ...contexto, defects: ["a fase 2 não cobre nada"] })).toContain("- a fase 2 não cobre nada");
  });
});

describe("o prompt do auditor da arquitetura", () => {
  const prompt = architectureAuditPrompt({ ...contexto, architecture: "# Pousada — Arquitetura" });

  it("julga pelos cinco eixos pedidos", () => {
    for (const eixo of ["1. FIDELITY TO THE PRODUCT", "2. COHERENCE", "3. COMPLETENESS", "4. DEPENDENCIES", "5. SIZING AND FEASIBILITY"]) expect(prompt).toContain(eixo);
  });

  it("pode recomendar dividir, fundir e reordenar fases", () => {
    expect(prompt).toContain("Recommend splitting, merging or reordering phases when that is the defect");
  });

  it("não exige teste, não reprova por gosto, e responde pelo protocolo comum", () => {
    expect(prompt).toContain("Never demand tests, test files or a validation strategy");
    expect(prompt).toContain("When in doubt, approve and remark");
    expect(prompt).toContain("CAPIVARA_AUDIT_STATUS: APPROVED|REJECTED");
    expect(prompt).toContain("CAPIVARA_DECISION is for a PRODUCT decision");
  });

  it("não reaudita o que o harness já conferiu em código", () => {
    expect(prompt).toContain("The mechanical checks already passed");
  });
});
