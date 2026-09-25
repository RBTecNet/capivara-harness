import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntervalPartError, assertSinglePhasePart, classifyDefect, discardStaging, isRepairable, partId, publish, readStaged, repairDeterministically, stage, stripAllMarkers, stripResolvedMarkers, substanceDefects } from "../../src/authoring/index.js";
import { assemblePhasesDocument, parsePhases } from "../../src/contract/index.js";
import type { ContractError } from "../../src/contract/index.js";

describe("partes — uma fase por parte", () => {
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

  it("remove Design ref pendente: a ausência de design nunca é decisão aberta", () => {
    const fase = [
      "- [ ] **Task:** Construir a tela de reservas",
      "  - **Acceptance criteria:**",
      "    - A tela lista os oito quartos",
      "  - **Design ref:** [NEEDS DECISION] qual o caminho do artefato de design",
      "  - **Traces:** US-1.1",
      "",
    ].join("\n");
    const repair = repairDeterministically(fase);
    expect(repair.content).not.toContain("Design ref");
    expect(repair.content).not.toContain("NEEDS DECISION");
    expect(repair.content).toContain("**Traces:** US-1.1");
    expect(repair.applied.join(" ")).toContain("nunca é decisão aberta");
  });

  it("preserva Design ref que aponta para um caminho de verdade", () => {
    const fase = "  - **Design ref:** .capivara/init/design/reservas.png\n";
    expect(repairDeterministically(fase).content).toContain("design/reservas.png");
  });

  it("remove marcador cuja decisão já foi tomada", () => {
    const documento = [
      "# Pousada — Project Description",
      "",
      "## Open Questions",
      "",
      "[NEEDS DECISION] Stack escolhida: TypeScript, Node.js e SQLite; faltam as versões",
      "[NEEDS DECISION] qual o provedor de email",
      "",
    ].join("\n");

    const repair = stripResolvedMarkers(documento, ["Stack escolhida: TypeScript, Node.js e SQLite; faltam as versões"]);
    expect(repair.content).not.toContain("SQLite");
    expect(repair.content).toContain("provedor de email");
    expect(repair.applied.join(" ")).toContain("já decidido");
  });

  it("não remove nada quando nenhum marcador foi decidido", () => {
    const documento = "[NEEDS DECISION] qual o provedor de email\n";
    expect(stripResolvedMarkers(documento, ["outra coisa"]).applied).toEqual([]);
  });

  it("marcador dentro de célula de tabela vira travessão e a linha sobrevive", () => {
    const apendice = [
      "## Appendix: User Story Status",
      "",
      "| ID | Story | Priority | Status |",
      "|----|-------|----------|--------|",
      "| US-1.1 | Ler o CSV | [NEEDS DECISION] | [NEEDS DECISION] |",
      "",
      "[NEEDS DECISION] qual o provedor de email",
      "",
    ].join("\n");

    const repair = repairDeterministically(apendice);
    expect(repair.content).toContain("| US-1.1 | Ler o CSV | — | — |");
    // O marcador de verdade, fora da tabela, continua lá para virar pergunta.
    expect(repair.content).toContain("[NEEDS DECISION] qual o provedor de email");
    expect(repair.applied.join(" ")).toContain("célula de tabela");
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

/*
 * Um marcador vivo fazia `parsePhases` recusar o documento, e a recusa desligava a
 * auditoria POR FASE em silêncio: uma chamada sobre o documento inteiro em vez de
 * treze paralelas, sem aprovação por fase e sem memória por task. A estrutura
 * passou a ser lida sem os marcadores; eles continuam no documento e continuam
 * bloqueando a prontidão, que é o gate que fala com o desenvolvedor.
 */
describe("stripAllMarkers", () => {
  it("remove toda linha de marcador e conta quantas foram", () => {
    const antes = [
      "- [ ] **Task:** Criar a migration",
      "  - **Acceptance criteria:**",
      "    - A tabela existe",
      "    [NEEDS DECISION] o status inicial",
      "    [NEEDS DECISION] o fuso da data de corte",
      "  - **Traces:** statuses",
    ].join("\n");

    const depois = stripAllMarkers(antes);
    expect(depois.content).not.toContain("[NEEDS DECISION]");
    expect(depois.content).toContain("A tabela existe");
    expect(depois.content).toContain("**Traces:** statuses");
    expect(depois.applied[0]).toContain("2 marcador(es)");
  });

  it("documento sem marcador volta intacto e sem conserto declarado", () => {
    const limpo = "- [ ] **Task:** Criar a migration\n  - **Traces:** statuses";
    const depois = stripAllMarkers(limpo);
    expect(depois.content).toBe(limpo);
    expect(depois.applied).toEqual([]);
  });
});
