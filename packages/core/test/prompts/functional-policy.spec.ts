import { describe, expect, it } from "vitest";
import { fixPrompt, flowPrompt, implementPrompt, triagePrompt, verifierRepairPrompt, verifyPrompt } from "../../src/prompts/index.js";

const base = { language: "pt-BR", phaseMarkdown: "requisitos atuais", testCommand: "npm test", e2eCommand: "npm run test:e2e" };
const workflow = { number: "1", name: "Cadastro", steps: ["carrega e cadastra"] };

describe("aceitação funcional e custo proporcional", () => {
  it.each([
    ["executor", () => implementPrompt({ ...base, containerized: false })],
    ["correção", () => fixPrompt({ ...base, containerized: false, gate: "gate 3", cause: "defeito real", previousWroteNothing: false })],
    ["reparador", () => verifierRepairPrompt({ ...base, cause: "defeito real" })],
  ])("%s prioriza regressão focada e não exige repetir suíte completa já coberta", (_role, render) => {
    const prompt = render();
    expect(prompt).toContain("Prefer focused regression checks");
    expect(prompt).toContain("The harness runs the complete gate command independently");
    expect(prompt).toContain("Do not repeat an unchanged passing suite");
    expect(prompt).toContain("same command already includes");
    expect(prompt).not.toContain("3. Run the suite with the project's test command.");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("npm run test:e2e");
  });

  it("verificador separa observação de defeito comprovado e julga a URL final", () => {
    const prompt = verifyPrompt({ ...base, taskCount: 2 });
    expect(prompt).toContain("DONE — ADVISORY:");
    expect(prompt).toContain("final request URL");
    expect(prompt).toContain("Missing test names alone");
    expect(prompt).toContain("data loss, security, validation");
    expect(prompt).not.toContain("When in doubt, INCOMPLETE");
    expect(prompt).toContain("observable failure");
  });

  it("roteirista e triagem não exigem atrasar produto para capturar um carregamento transitório", () => {
    const author = flowPrompt({ language: "pt-BR", workflow, baseUrl: "http://127.0.0.1:4000" });
    const triage = triagePrompt({ ...base, workflow, script: "roteiro", failure: "loading not found", snapshot: "lista pronta", serverErrors: [] });
    for (const prompt of [author, triage]) {
      expect(prompt).toContain("Never add artificial latency to the product");
      expect(prompt).toContain("page.goto");
      expect(prompt).toContain("focused test");
    }
    expect(triage).toContain("classify this as ROTEIRO");
    expect(author).toContain("Never fabricate the product backend's responses");
  });
});
