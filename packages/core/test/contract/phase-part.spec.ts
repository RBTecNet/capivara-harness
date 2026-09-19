import { describe, expect, it } from "vitest";
import { assemblePhase, canonicalDependsOn, repairInlineCriteria, repairMissingBullets, canonicalWorkflowTraces, extractTasks, joinPhaseMetadata, normalizePhasePart, parsePhaseFragment, parsePhases } from "../../src/contract/index.js";

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

  /*
   * Esta regra mudou depois do piloto 6, e a anterior ficava aqui: um heading com
   * o número errado era devolvido como veio. O custo apareceu com um escritor mais
   * fraco — três das sete fases vieram numeradas erradas, o documento foi montado
   * fora de ordem e o parser gastou uma rodada de auditoria com I-03.
   *
   * O número certo não é palpite: quem pediu a parte sabe qual ela é. O que
   * continua valendo é a preocupação que gerou a regra antiga — nunca esvaziar o
   * conteúdo no escuro —, e é isso que os casos abaixo protegem.
   */
  it("heading com número errado é corrigido, e o conteúdo sobrevive", () => {
    const outra = FASE.replace("## Phase 2:", "## Phase 9:");
    const normalized = normalizePhasePart(outra, { phaseNumber: 2, dependsOn: "none" });
    expect(normalized.markdown).toContain("## Phase 2:");
    expect(normalized.markdown).toContain("**Task:**");
    expect(normalized.applied.join(" ")).toContain("veio 9, esta parte é a 2");
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

describe("metadados da fase numa linha só", () => {
  /* O piloto real escreveu assim — três linhas, com quebra de markdown no fim —
   * e o parser recusou a fase inteira: I-03. Duas quebras de linha derrubando o
   * run é exatamente o que o runtime tem obrigação de consertar sozinho. */
  const separado = [
    "## Phase 1: Estrutura da interface",
    "",
    "**Goal:** Construir a composição visual responsiva.  ",
    "**Depends on:** Phase 1, Phase 2  ",
    "**Covers:** preferencias, US-1.10, workflow 1",
    "",
    "- [ ] **Task:** Montar a paleta",
    "  - **Acceptance criteria:**",
    "    - a paleta existe num arquivo só",
    "  - **Feature tests:** paleta → existe",
    "  - **Traces:** US-1.10",
    "",
  ].join("\n");

  it("junta as três linhas na forma que o contrato exige", () => {
    const { content, applied } = joinPhaseMetadata(separado);
    expect(applied).toBe(true);
    expect(content).toContain("**Goal:** Construir a composição visual responsiva. · **Depends on:** Phase 1, Phase 2 · **Covers:** preferencias, US-1.10, workflow 1");
  });

  it("e aí a fase volta a ser legível pelo parser", () => {
    expect(parsePhaseFragment(separado)).toBeNull();
    expect(parsePhaseFragment(joinPhaseMetadata(separado).content)?.number).toBe(1);
  });

  it("o que já está numa linha não é tocado", () => {
    const certo = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base · **Depends on:** none · **Covers:** statuses",
      "",
    ].join("\n");
    expect(joinPhaseMetadata(certo).applied).toBe(false);
  });

  it("sem Depends on ou Covers logo abaixo, não inventa nada", () => {
    const incompleto = ["## Phase 1: F", "", "**Goal:** algo", ""].join("\n");
    expect(joinPhaseMetadata(incompleto).applied).toBe(false);
  });

  it("a normalização inteira aplica a junção e avisa", () => {
    const { markdown, applied } = normalizePhasePart(separado, { phaseNumber: 1, dependsOn: "none" });
    expect(applied.join(" ")).toContain("numa linha só");
    expect(parsePhaseFragment(markdown)?.tasks).toHaveLength(1);
  });
});

describe("rótulo traduzido em Covers", () => {
  it("Covers também volta ao canônico, não só Traces", () => {
    // "fluxo 1" sobrevivia em Covers até o documento publicado.
    const linha = "**Goal:** g · **Depends on:** none · **Covers:** preferencias, fluxo 1, fluxo 6";
    const { content, applied } = canonicalWorkflowTraces(linha);
    expect(applied).toBe(true);
    expect(content).toContain("workflow 1");
    expect(content).toContain("workflow 6");
    expect(content).not.toContain("fluxo");
  });
});

describe("fase certa, número errado", () => {
  const corpo = [
    "**Goal:** migrations existem · **Depends on:** none · **Covers:** reservas",
    "",
    "- [ ] **Task:** Criar a migration",
    "  - **Acceptance criteria:**",
    "    - A tabela existe",
    "  - **Feature tests:** migra → a tabela existe",
    "  - **Traces:** reservas",
  ].join("\n");

  it("o número do heading é corrigido pelo número que foi pedido", () => {
    const parte = normalizePhasePart(`## Phase 4: Fundação\n\n${corpo}`, { phaseNumber: 1, dependsOn: "none" });
    expect(parte.markdown).toContain("## Phase 1: Fundação");
    expect(parte.markdown).not.toContain("## Phase 4");
    expect(parte.applied.join(" ")).toContain("veio 4, esta parte é a 1");
  });

  it("o conteúdo da fase sobrevive inteiro à correção", () => {
    const parte = normalizePhasePart(`## Phase 7: Fundação\n\n${corpo}`, { phaseNumber: 2, dependsOn: "Phase 1" });
    expect(parte.markdown).toContain("**Task:** Criar a migration");
    expect(parte.markdown).toContain("**Traces:** reservas");
  });

  it("com o número certo, nada é anunciado como corrigido", () => {
    const parte = normalizePhasePart(`## Phase 1: Fundação\n\n${corpo}`, { phaseNumber: 1, dependsOn: "none" });
    expect(parte.applied.join(" ")).not.toContain("corrigiu o número");
  });

  it("com vários headings de fase, devolve como veio: qual seria a pedida é palpite", () => {
    const duas = `## Phase 4: Uma\n\n${corpo}\n\n## Phase 5: Outra\n\n${corpo}`;
    const parte = normalizePhasePart(duas, { phaseNumber: 1, dependsOn: "none" });
    expect(parte.applied.join(" ")).toContain("devolvida sem normalizar");
  });

  it("sem heading de fase nenhum, continua devolvendo como veio", () => {
    const parte = normalizePhasePart(`# Documento\n\n${corpo}`, { phaseNumber: 1, dependsOn: "none" });
    expect(parte.applied.join(" ")).toContain("devolvida sem normalizar");
  });
});

describe("o envelope é do harness, as tasks são do modelo", () => {
  const envelope = {
    number: 3,
    title: "Consulta e Busca",
    goal: "o acervo é pesquisável",
    dependsOn: "Phase 2",
    covers: ["US-1.2", "workflow 10"],
  };
  const tasks = [
    "- [ ] **Task:** Implementar a busca por título",
    "  - **Acceptance criteria:**",
    "    - A busca ignora maiúsculas e acentos",
    "  - **Feature tests:** busca_titulo → encontra ignorando caixa",
    "  - **Traces:** US-1.2",
  ].join("\n");

  it("monta a fase inteira do que o esqueleto já sabia", () => {
    const fase = assemblePhase(envelope, tasks);
    expect(fase).toContain("## Phase 3: Consulta e Busca");
    expect(fase).toContain("**Goal:** o acervo é pesquisável · **Depends on:** Phase 2 · **Covers:** US-1.2, workflow 10");
    expect(fase).toContain("**Task:** Implementar a busca por título");
  });

  it("o resultado passa no parser, que é quem decide", () => {
    const documento = [
      "# Biblioteca — Project Phases",
      "",
      "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
      "",
      "## Overview",
      "",
      "x",
      "",
      assemblePhase({ ...envelope, number: 1, dependsOn: "none" }, tasks),
    ].join("\n");
    const lido = parsePhases(documento);
    expect(lido.ok, lido.ok ? "" : lido.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
  });

  it("heading que o modelo escreveu apesar de tudo é descartado, não corrigido", () => {
    // Não importa que número ele tenha posto: aquela linha não é usada.
    const comLixo = `Claro! Aqui vai:\n\n## Phase 9: Nome Errado\n\n**Goal:** errado\n\n${tasks}`;
    const { tasks: extraidas, applied } = extractTasks(comLixo);
    expect(extraidas).not.toContain("Phase 9");
    expect(extraidas).not.toContain("Goal");
    expect(extraidas.startsWith("- [ ] **Task:**")).toBe(true);
    expect(applied.join(" ")).toContain("antes da primeira task");
  });

  it("sub-fase é início válido de tasks e sobrevive", () => {
    const comSub = `### Phase 3.1: Busca\n\n${tasks}`;
    expect(extractTasks(comSub).tasks.startsWith("### Phase 3.1:")).toBe(true);
  });

  it("nível 2 escrito no meio é descartado: ele encerraria a captura da fase", () => {
    const { tasks: extraidas } = extractTasks(`${tasks}\n\n## Open Questions\n\nfalta decidir a stack\n`);
    expect(extraidas).not.toContain("Open Questions");
    expect(extraidas).not.toContain("falta decidir");
  });

  it("sem task nenhuma, devolve o que veio em vez de esvaziar em silêncio", () => {
    const { tasks: extraidas, applied } = extractTasks("o modelo divagou e não escreveu task");
    expect(extraidas).toBe("o modelo divagou e não escreveu task");
    expect(applied.join(" ")).toContain("não achei task nenhuma");
  });
});

describe("critérios colados na linha do rótulo", () => {
  it("o ponto e vírgula que a lista usou vira a quebra dos itens", () => {
    const { content, applied } = repairInlineCriteria(
      "- **Acceptance criteria:** a tabela existe; o índice existe; o seed roda",
    );
    expect(applied).toBe(1);
    expect(content.split("\n")).toEqual([
      "  - **Acceptance criteria:**",
      "    - a tabela existe",
      "    - o índice existe",
      "    - o seed roda",
    ]);
  });

  it("sem ponto e vírgula, vira um critério só — que é o que foi escrito", () => {
    const { content } = repairInlineCriteria("- **Acceptance criteria:** a tabela existe");
    expect(content.split("\n")).toEqual(["  - **Acceptance criteria:**", "    - a tabela existe"]);
  });

  it("o rótulo já sozinho não é tocado", () => {
    const certo = "  - **Acceptance criteria:**\n    - a tabela existe";
    expect(repairInlineCriteria(certo)).toEqual({ content: certo, applied: 0 });
  });

  it("depois do reparo, a task passa no parser — que é quem decide", () => {
    const tasks = [
      "- [ ] **Task:** Criar a migration",
      "- **Acceptance criteria:** a tabela existe; o seed roda",
      "- **Traces:** reservas",
    ].join("\n");

    const documento = [
      "# X — Project Phases",
      "",
      "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
      "",
      "## Overview",
      "",
      "x",
      "",
      assemblePhase({ number: 1, title: "Base", goal: "g", dependsOn: "none", covers: ["reservas"] }, extractTasks(tasks).tasks),
    ].join("\n");

    const lido = parsePhases(documento);
    expect(lido.ok, lido.ok ? "" : lido.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
    if (lido.ok) expect(lido.document.phases[0]?.tasks[0]?.acceptanceCriteria).toEqual(["a tabela existe", "o seed roda"]);
  });

  it("a extração anuncia o reparo, para não consertar em silêncio", () => {
    const { applied } = extractTasks("- [ ] **Task:** X\n- **Acceptance criteria:** a; b\n- **Traces:** y");
    expect(applied.join(" ")).toContain("vieram colados na linha do rótulo");
  });
});

describe("rótulo de task escrito sem o traço", () => {
  it("o traço volta, e o rótulo passa a ser o item de lista que o parser casa", () => {
    const { content, applied } = repairMissingBullets("  **Traces:** US-1.1");
    expect(applied).toBe(1);
    expect(content).toBe("  - **Traces:** US-1.1");
  });

  it("vale para os quatro rótulos de task", () => {
    for (const rotulo of ["Acceptance criteria", "Feature tests", "Traces", "Design ref"]) {
      expect(repairMissingBullets(`  **${rotulo}:** x`).content.trim().startsWith("- ")).toBe(true);
    }
  });

  it("o que já tem traço não é tocado", () => {
    const certo = "  - **Traces:** US-1.1";
    expect(repairMissingBullets(certo)).toEqual({ content: certo, applied: 0 });
  });

  it("a indentação original é preservada", () => {
    expect(repairMissingBullets("    **Traces:** x").content).toBe("    - **Traces:** x");
  });

  it("os dois reparos juntos levam a task do jeito do modelo ao jeito do contrato", () => {
    // Como o haiku escreveu no piloto 6: rótulo na margem, critérios colados.
    const cru = [
      "- [ ] **Task:** Implementar persistência de operador",
      "  **Acceptance criteria:** dados vão para sessionStorage; dados voltam após recarregar",
      "  **Traces:** US-2.3",
    ].join("\n");

    const documento = [
      "# X — Project Phases",
      "",
      "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
      "",
      "## Overview",
      "",
      "x",
      "",
      assemblePhase({ number: 1, title: "Base", goal: "g", dependsOn: "none", covers: ["US-2.3"] }, extractTasks(cru).tasks),
    ].join("\n");

    const lido = parsePhases(documento);
    expect(lido.ok, lido.ok ? "" : lido.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
    if (lido.ok) {
      const task = lido.document.phases[0]?.tasks[0];
      expect(task?.acceptanceCriteria).toHaveLength(2);
      expect(task?.traces).toEqual(["US-2.3"]);
    }
  });
});
