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
  for (const prompt of [phase, skeleton]) {
    expect(prompt).toContain("Testing belongs to the build validator");
    expect(prompt).toContain("Do not prescribe test files, names, counts or test-only phases");
  }
});

it("validador escolhe prova suficiente sem obrigações herdadas de nomes de teste", () => {
  const prompt = verifyPrompt({ language: "pt-BR", taskCount: 1, phaseMarkdown: "entrega observável" });
  expect(prompt).toContain("Choose the smallest sufficient verification");
  expect(prompt).toContain("Legacy test names and test-file requirements in a plan are suggestions");
  expect(prompt).toContain("Reuse passing gate results");
});
