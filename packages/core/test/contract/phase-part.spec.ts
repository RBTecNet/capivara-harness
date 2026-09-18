import { describe, expect, it } from "vitest";
import { canonicalDependsOn, canonicalWorkflowTraces, normalizePhasePart, parsePhases } from "../../src/contract/index.js";

const FASE = [
  "## Phase 2: Cadastro de hóspedes",
  "",
  "**Goal:** o hóspede é cadastrado · **Depends on:** none · **Covers:** US-1.1",
  "",
  "- [ ] **Task:** Criar o formulário",
  "  - **Acceptance criteria:**",
  "    - O formulário aceita nome e contato",
  "  - **Traces:** US-1.1",
].join("\n");

describe("canonicalDependsOn", () => {
  it("o ledger devolve o que o modelo escreveu; o documento recebe a forma canônica", () => {
    for (const cru of ["1", "Phase 1", "phase 1", "P01", "fase 1"]) {
      expect(canonicalDependsOn(cru), cru).toBe("Phase 1");
    }
  });

  it("vazio e nenhuma variação de 'nenhum' viram none", () => {
    for (const cru of ["", "  ", "none", "None", "nenhuma", "nenhum"]) {
      expect(canonicalDependsOn(cru), cru).toBe("none");
    }
  });

  it("várias fases viram uma lista ordenada e sem repetição", () => {
    expect(canonicalDependsOn("Phase 3, 1, P01")).toBe("Phase 1, Phase 3");
  });
});

describe("normalizePhasePart", () => {
  it("corrige Depends on para o que o ledger alocou, na forma canônica", () => {
    const normalized = normalizePhasePart(FASE, { phaseNumber: 2, dependsOn: "1" });
    expect(normalized.markdown).toContain("**Depends on:** Phase 1");
    expect(normalized.markdown).not.toContain("**Depends on:** none");
    expect(normalized.applied.join(" ")).toContain("conforme o ledger");
  });

  it("não mexe quando o Depends on já está certo", () => {
    const certa = FASE.replace("**Depends on:** none", "**Depends on:** Phase 1");
    expect(normalizePhasePart(certa, { phaseNumber: 2, dependsOn: "Phase 1" }).applied).toEqual([]);
  });

  it("nunca publica o valor cru do ledger", () => {
    const normalized = normalizePhasePart(FASE, { phaseNumber: 2, dependsOn: "2" });
    expect(normalized.markdown).toContain("**Depends on:** Phase 2");
    expect(normalized.markdown).not.toMatch(/\*\*Depends on:\*\* \d/);
  });

  it("remove seção de nível 2 escrita dentro da fase, que encerraria a captura", () => {
    const suja = `${FASE}\n\n## Open Questions\n\nA stack usa SQLite e faltam versões.\n`;
    const normalized = normalizePhasePart(suja, { phaseNumber: 2, dependsOn: "Phase 1" });
    expect(normalized.markdown).not.toContain("Open Questions");
    expect(normalized.markdown).not.toContain("SQLite");
    expect(normalized.applied.join(" ")).toContain("encerraria a captura");
  });

  it("remove preâmbulo escrito antes do heading da fase", () => {
    const suja = `Claro! Aqui vai a fase:\n\n${FASE}`;
    const normalized = normalizePhasePart(suja, { phaseNumber: 2, dependsOn: "none" });
    expect(normalized.markdown.startsWith("## Phase 2:")).toBe(true);
  });

  it("preserva as sub-fases, que são nível 3", () => {
    const comSub = FASE.replace("- [ ] **Task:**", "### Phase 2.1: Formulário\n\n- [ ] **Task:**");
    const normalized = normalizePhasePart(comSub, { phaseNumber: 2, dependsOn: "none" });
    expect(normalized.markdown).toContain("### Phase 2.1:");
  });

  it("parte sem o heading esperado é devolvida intacta, não esvaziada", () => {
    const outra = FASE.replace("## Phase 2:", "## Phase 9:");
    const normalized = normalizePhasePart(outra, { phaseNumber: 2, dependsOn: "none" });
    expect(normalized.markdown).toContain("## Phase 9:");
    expect(normalized.markdown).toContain("**Task:**");
    expect(normalized.applied.join(" ")).toContain("sem normalizar");
  });

  it("o resultado continua passando no parser", () => {
    const suja = `preâmbulo\n\n${FASE.replace("## Phase 2:", "## Phase 1:")}\n\n## Open Questions\n\nlixo\n`;
    const normalized = normalizePhasePart(suja, { phaseNumber: 1, dependsOn: "none" });
    const documento = [
      "# Exemplo — Project Phases",
      "",
      "<!-- inputs: a.md@sha256:aaaaaaaaaaaa -->",
      "",
      "## Overview",
      "",
      "x",
      "",
      normalized.markdown,
    ].join("\n");
    const parsed = parsePhases(documento);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.map((e) => e.message).join("; ")).toBe(true);
  });
});

describe("rótulo de workflow nos Traces", () => {
  it("devolve ao canônico o que o documento traduziu", () => {
    const { content, applied } = canonicalWorkflowTraces("  - **Traces:** US-1.1 / fluxo 1 / fluxo 9 / `cartoes`");
    expect(applied).toBe(true);
    expect(content).toContain("workflow 1");
    expect(content).toContain("workflow 9");
    expect(content).not.toContain("fluxo");
  });

  it("não mexe em prosa: fluxo dentro de um critério continua sendo fluxo", () => {
    const criterio = "    - O fluxo 1 exibe o quadro restaurado.";
    expect(canonicalWorkflowTraces(criterio).content).toBe(criterio);
    expect(canonicalWorkflowTraces(criterio).applied).toBe(false);
  });

  it("o que já está canônico não conta como correção", () => {
    const linha = "  - **Traces:** US-1.1 / workflow 1";
    expect(canonicalWorkflowTraces(linha).applied).toBe(false);
  });

  it("zeros à esquerda e plural também voltam ao canônico", () => {
    expect(canonicalWorkflowTraces("  - **Traces:** flujos 03").content).toContain("workflow 3");
  });
});
