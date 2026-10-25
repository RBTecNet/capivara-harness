import { describe, expect, it } from "vitest";
import { acceptancePrompt, fixPrompt, implementPrompt, verifierRepairPrompt, verifyPrompt } from "../../src/prompts/index.js";
import { testPolicyBlock } from "../../src/prompts/test-policy.js";

/*
 * Uma política de teste só, lida por quem escreve e por quem julga. As
 * obrigações antigas — par positivo/negativo por critério, prova do modo de
 * falha, desconfiança da suíte verde — saíram dos dois prompts, e nenhuma volta
 * com outras palavras ao lado da política.
 */
describe("a política de teste", () => {
  const base = { language: "pt-BR", phaseMarkdown: "## Phase 1: X", testCommand: "npm test", containerized: false };
  const prompts = {
    executor: implementPrompt(base),
    correção: fixPrompt({ ...base, gate: "gate 3", cause: "defeito", previousWroteNothing: false }),
    aceitação: acceptancePrompt({ ...base, cause: "não subiu", attempt: 1 }),
    verificador: verifyPrompt({ language: "pt-BR", phaseMarkdown: "## Phase 1: X", taskCount: 1 }),
    "reparo do verificador": verifierRepairPrompt({ language: "pt-BR", phaseMarkdown: "## Phase 1: X", cause: "defeito", testCommand: "npm test" }),
  };

  it.each(Object.entries(prompts))("%s recebe o mesmo bloco, uma vez", (_papel, prompt) => {
    expect(prompt.split(testPolicyBlock()).length - 1).toBe(1);
  });

  it.each(Object.entries(prompts))("%s não fala das obrigações revogadas fora da política", (_papel, prompt) => {
    const fora = prompt.replace(testPolicyBlock(), "");
    for (const antiga of ["positive and negative", "failure mode", "green suite is not proof", "route.abort", "regression check for the actual finding"]) {
      expect(fora).not.toContain(antiga);
    }
  });
});
