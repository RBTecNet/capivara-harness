import { describe, expect, it } from "vitest";
import { BUILDER_COMPLETE_MARKER, fixPrompt, implementPrompt, parseVerification, verifyPrompt } from "../../src/prompts/index.js";

const base = { language: "português do Brasil", testCommand: "npm test", containerized: false, phaseMarkdown: "## Phase 1: X" };

describe("prompt de implementação", () => {
  it("é auto-contido: descoberta, comando de teste e a fase inteira", () => {
    const prompt = implementPrompt(base);
    expect(prompt).toContain("Assume nothing");
    expect(prompt).toContain("npm test");
    expect(prompt).toContain("## Phase 1: X");
  });

  it("declara a autoridade que o executor não pode tocar", () => {
    const prompt = implementPrompt(base);
    expect(prompt).toContain(".capivara/init/ is read-only specification");
    expect(prompt).toContain("Writing there invalidates this attempt");
  });

  it("libera rede para instalar dependências, mas proíbe stack nova", () => {
    const prompt = implementPrompt(base);
    expect(prompt).toContain("You may install dependencies");
    expect(prompt).toContain("Never add a new stack");
  });

  it("avisa sobre o container quando a suíte roda dentro de um", () => {
    expect(implementPrompt({ ...base, containerized: true })).toContain("inside a container");
  });

  it("sem comando de teste, o bloco simplesmente não existe", () => {
    const prompt = implementPrompt({ ...base, testCommand: null });
    expect(prompt).not.toContain("This project's test command");
  });

  it("pede o marcador de conclusão", () => {
    expect(implementPrompt(base)).toContain(BUILDER_COMPLETE_MARKER);
  });
});

describe("prompt de correção", () => {
  const causa = "FAIL tests/reserva.spec.ts > recusa datas sobrepostas\n  esperava 409, recebeu 500";

  it("carrega a causa real, nunca uma frase genérica", () => {
    const prompt = fixPrompt({ ...base, gate: "gate 2 — suíte do projeto", cause: causa, previousWroteNothing: false });
    expect(prompt).toContain("esperava 409, recebeu 500");
    for (const generica of ["os testes falharam", "a verificação falhou", "tente novamente"]) {
      expect(prompt.toLowerCase()).not.toContain(generica);
    }
  });

  it("diz que a sessão é nova e manda ler o código antes de mudar", () => {
    const prompt = fixPrompt({ ...base, gate: "g", cause: causa, previousWroteNothing: false });
    expect(prompt).toContain("NEW session with no memory");
    expect(prompt).toContain("Read the current code before changing");
  });

  it("manda corrigir só o que falta", () => {
    expect(fixPrompt({ ...base, gate: "g", cause: causa, previousWroteNothing: false })).toContain("Fix ONLY what is missing");
  });

  it("informa quando a sessão anterior não escreveu nada", () => {
    const prompt = fixPrompt({ ...base, gate: "g", cause: causa, previousWroteNothing: true });
    expect(prompt).toContain("previous session ended without changing any file");
  });
});

describe("prompt e protocolo do verificador", () => {
  const context = { language: "pt-BR", phaseMarkdown: "## Phase 1: X", taskCount: 3 };

  it("proíbe escrever e manda não rodar a suíte inteira", () => {
    const prompt = verifyPrompt(context);
    expect(prompt).toContain("never write, edit, create, delete, move or commit");
    expect(prompt).toContain("Do not run the full test suite");
  });

  it("permite comandos que não alteram nada", () => {
    expect(verifyPrompt(context)).toContain("run commands that change nothing");
  });

  it("diz quantas linhas TASK são esperadas", () => {
    expect(verifyPrompt(context)).toContain("This phase has 3");
  });

  it("na dúvida, INCOMPLETE", () => {
    expect(verifyPrompt(context)).toContain("When in doubt, INCOMPLETE");
  });

  it("lê as linhas TASK ignorando prosa e indentação", () => {
    const output = ["Vou verificar:", "  TASK 1: DONE", "TASK 2: INCOMPLETE — falta o teste de sobreposição", "pronto."].join("\n");
    expect(parseVerification(output)).toEqual([
      { index: 1, done: true, missing: "" },
      { index: 2, done: false, missing: "falta o teste de sobreposição" },
    ]);
  });

  it("aceita travessão e hífen como separador", () => {
    expect(parseVerification("TASK 1: INCOMPLETE - falta X")[0]?.missing).toBe("falta X");
  });

  it("ignora linha que não é um veredito", () => {
    expect(parseVerification("TASK um: DONE\nTASK 1: TALVEZ")).toEqual([]);
  });
});
