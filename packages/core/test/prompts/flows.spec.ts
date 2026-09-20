/**
 * O prompt de quem redige o roteiro do fluxo.
 *
 * Duas coisas importam aqui: o que ele exige (e que o gate confere depois, no
 * mesmo vocabulário) e o que ele consegue ler de volta de uma resposta que veio
 * com prosa em volta — que é o caso comum, não a exceção.
 */

import { describe, expect, it } from "vitest";
import { extractFlowScript, flowPrompt, stepLabel } from "../../src/prompts/index.js";
import { checkFlowScript } from "../../src/loop/index.js";
import type { SkeletonWorkflow } from "../../src/contract/index.js";

const workflow: SkeletonWorkflow = {
  number: "3",
  name: "Gerar linha cron com IA",
  steps: ["abre a aba Gerar com IA", "descreve o agendamento em português", "recebe a linha e a explicação"],
};

const prompt = flowPrompt({ language: "português do Brasil", workflow, baseUrl: "http://127.0.0.1:47533" });

describe("o prompt do roteiro", () => {
  it("leva o fluxo inteiro, passo a passo", () => {
    for (const step of workflow.steps) expect(prompt).toContain(step);
    expect(prompt).toContain("Gerar linha cron com IA");
  });

  /*
   * O rótulo do passo é estrutural: o gate conta por ele. Se o prompt pedir de
   * um jeito e a conferência procurar de outro, todo roteiro nasce reprovado —
   * e a culpa pareceria ser do modelo.
   */
  it("pede o rótulo do passo exatamente como o gate o procura", () => {
    expect(prompt).toContain(stepLabel(0, workflow.steps[0] ?? ""));
    expect(prompt).toContain("passo <n>: ");
  });

  it("proíbe o que a conferência recusa", () => {
    expect(prompt).toContain("test.skip");
    expect(prompt).toContain("Never intercept or stub the product's own backend");
    expect(prompt).toContain("At least one `expect(...)` inside each step");
  });

  it("não vaza provider, modelo nem CLI", () => {
    for (const termo of ["codex", "claude", "opencode", "anthropic", "--model"]) {
      expect(prompt.toLowerCase()).not.toContain(termo);
    }
  });

  it("a recusa anterior volta ao autor, para ele corrigir o que foi apontado", () => {
    const segunda = flowPrompt({
      language: "português do Brasil",
      workflow,
      baseUrl: "http://127.0.0.1:47533",
      rejected: ["o passo 2 não aparece como test.step — escreva await test.step(…)"],
    });
    expect(segunda).toContain("The previous attempt was rejected");
    expect(segunda).toContain("o passo 2 não aparece");
  });
});

describe("ler o roteiro de dentro da resposta", () => {
  const script = "import { test } from '@playwright/test';\ntest('x', async () => {});";

  it("aceita o bloco cercado, com ou sem prosa em volta", () => {
    expect(extractFlowScript("```ts\n" + script + "\n```")).toBe(script);
    expect(extractFlowScript("Segue o roteiro:\n\n```typescript\n" + script + "\n```\n\nEspero que sirva.")).toBe(script);
  });

  it("com dois blocos, fica com o último — o antes e o depois", () => {
    expect(extractFlowScript("```ts\nvelho\n```\ndepois:\n```ts\n" + script + "\n```")).toBe(script);
  });

  it("sem bloco nenhum devolve vazio, e o gate decide o que fazer", () => {
    expect(extractFlowScript("não consegui escrever o roteiro")).toBe("");
    expect(checkFlowScript("", workflow).map((defect) => defect.problem).join(" ")).toContain("vazio");
  });
});
