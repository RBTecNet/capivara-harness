import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IntervalPartError,
  LEDGER_CONTRACT,
  MAX_TASKS_PER_PHASE,
  allocateParts,
  assertSinglePhasePart,
  classifyDefect,
  discardStaging,
  isRepairable,
  parseLedger,
  partId,
  publish,
  readStaged,
  repairDeterministically,
  stage,
  substanceDefects,
} from "../../src/authoring/index.js";
import { assemblePhasesDocument, parsePhases } from "../../src/contract/index.js";
import type { ContractError } from "../../src/contract/index.js";

const ledgerSource = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    contract: LEDGER_CONTRACT,
    phases: [
      { number: 1, title: "Fundação de dados", goal: "migrations e seeds existem", dependsOn: "none", covers: ["users"], taskCount: 8 },
      { number: 2, title: "Cadastro", goal: "visitante se cadastra", dependsOn: "Phase 1", covers: ["US-1.1"], taskCount: 6 },
    ],
    mvpCutPhase: 2,
    coverage: { stories: { "US-1.1": [2] }, entities: { users: [1] }, workflows: { "1": [2] } },
    ...overrides,
  });

describe("ledger", () => {
  it("aceita um ledger bem formado", () => {
    const result = parseLedger(ledgerSource());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ledger.phases).toHaveLength(2);
  });

  it("recusa fase acima do teto de uma sessão", () => {
    const result = parseLedger(ledgerSource({ phases: [{ number: 1, title: "t", goal: "g", dependsOn: "none", covers: [], taskCount: MAX_TASKS_PER_PHASE + 1 }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defects[0]?.hint).toContain("divida em mais fases");
  });

  it("recusa numeração fora de ordem", () => {
    const result = parseLedger(ledgerSource({ phases: [{ number: 3, title: "t", goal: "g", dependsOn: "none", covers: [], taskCount: 2 }] }));
    expect(result.ok).toBe(false);
  });

  it("exige o mapa de cobertura nas três dimensões", () => {
    const result = parseLedger(ledgerSource({ coverage: { stories: {} } }));
    if (result.ok) throw new Error("esperava defeitos");
    const problemas = result.defects.map((d) => d.problem).join(" ");
    expect(problemas).toContain("entities");
    expect(problemas).toContain("workflows");
  });

  it("recusa fase sem task", () => {
    const result = parseLedger(ledgerSource({ phases: [{ number: 1, title: "t", goal: "g", dependsOn: "none", covers: [], taskCount: 0 }] }));
    expect(result.ok).toBe(false);
  });
});

describe("partes — uma fase por parte", () => {
  it("aloca uma parte por fase do ledger", () => {
    const result = parseLedger(ledgerSource());
    if (!result.ok) throw new Error("ledger inválido");
    const parts = allocateParts(result.ledger);
    expect(parts.map((part) => part.id)).toEqual(["phase-p01", "phase-p02"]);
    expect(parts[0]?.purpose).toContain("Fundação de dados");
  });

  it("recusa parte nomeada por intervalo — o runtime, não a disciplina do modelo", () => {
    for (const nome of ["phases-p01-p04", "phases-1-4", "p01..p04", "fases-1 a 4", "phases-p02-to-p05"]) {
      expect(() => assertSinglePhasePart(nome), nome).toThrow(IntervalPartError);
    }
  });

  it("a mensagem explica por que o intervalo é proibido", () => {
    try {
      assertSinglePhasePart("phases-p01-p04");
    } catch (error) {
      expect((error as Error).message).toContain("estoura o contexto");
    }
  });

  it("aceita o nome de uma fase só", () => {
    for (let phase = 1; phase <= 12; phase += 1) expect(() => assertSinglePhasePart(partId(phase))).not.toThrow();
  });
});

describe("classificação de defeito", () => {
  it("representação é serialização", () => {
    for (const code of ["I-01", "I-02", "I-04", "I-05"] as const) expect(classifyDefect(code)).toBe("representation");
  });

  it("substância é decisão", () => {
    for (const code of ["I-03", "I-07", "I-08", "I-09", "I-10", "I-11", "I-12", "I-13", "I-14"] as const) {
      expect(classifyDefect(code)).toBe("substance");
    }
  });

  const error = (code: ContractError["code"]): ContractError => ({ code, line: 1, message: "m", hint: "h" });

  it("só repara quando TODO defeito é de representação", () => {
    expect(isRepairable([error("I-01"), error("I-02")])).toBe(true);
    expect(isRepairable([error("I-01"), error("I-10")])).toBe(false);
    expect(isRepairable([])).toBe(false);
  });

  it("defeito de substância volta ao escritor, não ao reparo", () => {
    expect(substanceDefects([error("I-01"), error("I-10")]).map((e) => e.code)).toEqual(["I-10"]);
  });
});

describe("reparo determinístico — o que não custa chamada de modelo", () => {
  it("remove a cerca de código que envolve o documento inteiro", () => {
    const repair = repairDeterministically("```markdown\n# Projeto — Project Phases\n```");
    expect(repair.content.startsWith("# Projeto")).toBe(true);
    expect(repair.applied.join(" ")).toContain("cerca de código");
  });

  it("normaliza CRLF", () => {
    const repair = repairDeterministically("linha 1\r\nlinha 2\r\n");
    expect(repair.content).not.toContain("\r");
  });

  it("atualiza um stamp desatualizado", () => {
    const stamp = "<!-- inputs: a.md@sha256:111111111111 -->";
    const repair = repairDeterministically("# T — Project Phases\n\n<!-- inputs: a.md@sha256:000000000000 -->\n", stamp);
    expect(repair.content.split("\n")[2]).toBe(stamp);
    expect(repair.applied.join(" ")).toContain("atualizou o stamp");
  });

  it("insere o stamp ausente", () => {
    const stamp = "<!-- inputs: a.md@sha256:111111111111 -->";
    const repair = repairDeterministically("# T — Project Phases\n\n## Overview\n", stamp);
    expect(repair.content.split("\n")[2]).toBe(stamp);
  });

  it("não inventa reparo quando não há o que fazer", () => {
    expect(repairDeterministically("# T — Project Phases\n").applied).toEqual([]);
  });
});

describe("staging e publicação", () => {
  let projectRoot = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-staging-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("o documento em staging não aparece na árvore final", async () => {
    await stage(projectRoot, "init-abc", [{ name: "project-description.md", content: "rascunho" }]);
    expect(await readStaged(projectRoot, "init-abc", "project-description.md")).toBe("rascunho");
    await expect(readFile(join(projectRoot, ".capivara/init/project-description.md"), "utf8")).rejects.toThrow();
  });

  it("publicar leva o documento aprovado para a árvore final", async () => {
    const published = await publish(projectRoot, [{ name: "project-phases.md", content: "aprovado\n" }]);
    expect(published[0]).toContain(".capivara/init/project-phases.md");
    expect(await readFile(published[0]!, "utf8")).toBe("aprovado\n");
  });

  it("recusa nome de documento que seja caminho", async () => {
    for (const nome of ["../fora.md", "sub/dir.md", "/etc/passwd", ".."]) {
      await expect(publish(projectRoot, [{ name: nome, content: "x" }])).rejects.toThrow(/inválido/);
    }
  });

  it("descartar o staging não toca na árvore final", async () => {
    await publish(projectRoot, [{ name: "project-phases.md", content: "final\n" }]);
    await stage(projectRoot, "init-abc", [{ name: "project-phases.md", content: "rascunho" }]);
    await discardStaging(projectRoot, "init-abc");
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).toBe("final\n");
  });
});

describe("montagem do documento em código", () => {
  it("o documento montado passa no próprio parser", () => {
    const phase = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base pronta · **Depends on:** none · **Covers:** users",
      "",
      "- [ ] **Task:** Criar a migration de users",
      "  - **Acceptance criteria:**",
      "    - A tabela users existe com email único",
      "  - **Traces:** US-1.1, users",
    ].join("\n");

    const document = assemblePhasesDocument({
      projectName: "Exemplo",
      stamp: "<!-- inputs: project-description.md@sha256:aaaaaaaaaaaa -->",
      overview: "Fundação primeiro.",
      phases: [phase],
      openQuestions: [],
    });

    const parsed = parsePhases(document);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
  });

  it("as open questions entram como seção própria e encerram a captura", () => {
    const document = assemblePhasesDocument({
      projectName: "Exemplo",
      stamp: "<!-- inputs: a.md@sha256:aaaaaaaaaaaa -->",
      overview: "x",
      phases: ["## Phase 1: F\n\n**Goal:** g · **Depends on:** none · **Covers:** c\n\n- [ ] **Task:** t\n  - **Acceptance criteria:**\n    - c\n  - **Traces:** US-1.1"],
      openQuestions: ["falta decidir o provedor de email"],
    });
    expect(document).toContain("## Open Questions");
    const parsed = parsePhases(document);
    if (!parsed.ok) throw new Error("documento montado deveria ser válido");
    expect(parsed.document.phases[0]?.markdown).not.toContain("Open Questions");
  });
});
