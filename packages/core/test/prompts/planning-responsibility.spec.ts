import { expect, it } from "vitest";
import { tasksBlock } from "../../src/contract/index.js";
import { phaseFromSlicePrompt, skeletonPrompt, verifyPrompt } from "../../src/prompts/index.js";

it("o planejamento descreve comportamento sem prescrever testes", () => {
  const grammar = tasksBlock(1);
  const phase = phaseFromSlicePrompt({ language: "pt-BR", request: "três CRUDs", slice: "stack e contratos", phaseNumber: 1,
    totalPhases: 1, grammar, maxCriteriaPerTask: 4, maxTasksPerPhase: 15 });
  const skeleton = skeletonPrompt({ language: "pt-BR", request: "três CRUDs", decisions: [], assumptions: [], inventory: "vazio",
    maxTasksPerPhase: 15, maxCriteriaPerTask: 4 });
  expect(grammar).not.toContain("Feature tests");
  expect(phase).not.toContain("names are IDENTIFIERS");
  expect(phase).not.toContain("feature tests");
  for (const prompt of [phase, skeleton]) {
    expect(prompt).toContain("Tests are not part of it, in any form");
    // §129: o pedido de testes é do build, e a infraestrutura lista as dependências de teste.
    expect(prompt).toContain("is an instruction to the BUILD");
    expect(prompt).toContain("the test ones included");
    expect(prompt).toContain("Describing expected functional behaviour is not a test");
    expect(prompt).not.toContain("Legacy test prescriptions");
  }
  expect(phase).toContain("Writing for an economical executor");
  expect(phase).toContain("never asks the executor to choose a library");
});

it("a fatia da arquitetura chega ao escritor e à emenda da fase quando existe, e não quando não existe", async () => {
  const { amendPhasePrompt } = await import("../../src/prompts/index.js");
  const base = { language: "pt-BR", request: "três CRUDs", slice: "stack e contratos", phaseNumber: 1, totalPhases: 1, grammar: tasksBlock(1), maxCriteriaPerTask: 4, maxTasksPerPhase: 15 };
  expect(phaseFromSlicePrompt(base)).not.toContain("## This phase's architecture slice");
  const comArquitetura = phaseFromSlicePrompt({ ...base, architecture: "### api\n- POST /clientes → 201" });
  expect(comArquitetura).toContain("## This phase's architecture slice");
  expect(comArquitetura).toContain("POST /clientes → 201");
  const emenda = amendPhasePrompt({ language: "pt-BR", current: "- [ ] **Task:** x", findings: [], architecture: "### api\n- POST /clientes → 201" });
  expect(emenda).toContain("## This phase's architecture slice");
  expect(emenda).not.toContain("feature tests");
});

it("validador escolhe prova suficiente sem obrigações herdadas de nomes de teste", () => {
  const prompt = verifyPrompt({ language: "pt-BR", taskCount: 1, phaseMarkdown: "entrega observável" });
  expect(prompt).toContain("Choose the smallest sufficient verification");
  expect(prompt).toContain("Legacy test names and test-file requirements in a plan are suggestions");
  expect(prompt).toContain("Reuse passing gate results");
});
