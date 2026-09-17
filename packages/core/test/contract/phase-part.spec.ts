import { describe, expect, it } from "vitest";
import { normalizePhasePart, parsePhases } from "../../src/contract/index.js";

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

describe("normalizePhasePart", () => {
  it("corrige Depends on para o que o ledger alocou", () => {
    const normalized = normalizePhasePart(FASE, { phaseNumber: 2, dependsOn: "Phase 1" });
    expect(normalized.markdown).toContain("**Depends on:** Phase 1");
    expect(normalized.markdown).not.toContain("**Depends on:** none");
    expect(normalized.applied.join(" ")).toContain("conforme o ledger");
  });

  it("não mexe quando o Depends on já está certo", () => {
    const certa = FASE.replace("**Depends on:** none", "**Depends on:** Phase 1");
    expect(normalizePhasePart(certa, { phaseNumber: 2, dependsOn: "Phase 1" }).applied).toEqual([]);
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
