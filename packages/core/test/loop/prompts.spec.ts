import { describe, expect, it } from "vitest";
import { BUILDER_COMPLETE_MARKER, declarouRoteiroErrado, fixPrompt, implementPrompt, parseVerification, verifyPrompt } from "../../src/prompts/index.js";

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

  /*
   * O inventário entra como FATO sobre nomes, não como veredito: um nome
   * ausente pode estar coberto por um teste com outro nome. O que ele resolve é
   * a ordem de descoberta — a fase 4 do MCP_teste gastou um ciclo por buraco,
   * com os dois presentes desde o primeiro.
   */
  it("leva o inventário dos testes nomeados, dizendo quais não existem", () => {
    const prompt = verifyPrompt({
      ...context,
      featureTests: [
        { task: 6, name: "consulta_sem_sessao", found: false },
        { task: 8, name: "consulta_vazia_e_falha", found: true },
      ],
    });

    expect(prompt).toContain("consulta_sem_sessao");
    expect(prompt).toContain("NAME NOT FOUND");
    expect(prompt).toContain("may still be covered by a test written under another name");
  });

  it("sem inventário, o prompt é o de sempre — nada de seção vazia", () => {
    expect(verifyPrompt(context)).not.toContain("Mechanical check");
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

/**
 * O mesmo desleixo, no verificador do build.
 *
 * Ele ainda não apareceu num run — a auditoria e o ensaio morreram antes —, mas
 * o parser tinha a mesma meia tolerância, e a forma de defeito já se provou
 * três vezes (§40).
 */
describe("o verificador com a chave colada na prosa", () => {
  it("lê os vereditos de uma linha só", () => {
    const grudado = "Vou conferir cada task.TASK 1: DONE TASK 2: INCOMPLETE — falta o teste de sessão";
    expect(parseVerification(grudado)).toEqual([
      { index: 1, done: true, missing: "" },
      { index: 2, done: false, missing: "falta o teste de sessão" },
    ]);
  });
});

/**
 * A saída que o executor não tinha.
 *
 * Contra um gate 4 vermelho, a única resposta possível era mexer no produto —
 * e na fase 4 do MCP_teste2 isso moveu um título para dentro de um `form`
 * porque o seletor o procurava ali. O marcador dá a outra saída, e só aparece
 * quando o gate que reprovou foi o 4.
 */
describe("contestar o roteiro em vez de remodelar o produto", () => {
  const base = { language: "pt-BR", testCommand: "npm test", containerized: false, phaseMarkdown: "## Phase 1: X" };

  it("o prompt de correção do gate 4 oferece o marcador", () => {
    const prompt = fixPrompt({ ...base, gate: "gate 4 — fluxos na aplicação", cause: "um passo falhou", previousWroteNothing: false });

    expect(prompt).toContain("CAPIVARA_ROTEIRO_ERRADO");
    expect(prompt).toContain("DO NOT reshape the product to satisfy it");
    // E diz por que o escape não é atalho: o roteiro novo é de outra sessão.
    expect(prompt).toContain("the new script fails too");
  });

  it("nos outros gates ele não aparece: ali não há roteiro para contestar", () => {
    const prompt = fixPrompt({ ...base, gate: "gate 2 — suíte do projeto", cause: "a suíte falhou", previousWroteNothing: false });
    expect(prompt).not.toContain("CAPIVARA_ROTEIRO_ERRADO");
  });

  it("lê o motivo que o executor deu, com ou sem negrito", () => {
    expect(declarouRoteiroErrado("CAPIVARA_ROTEIRO_ERRADO: o título é irmão do form")).toBe("o título é irmão do form");
    expect(declarouRoteiroErrado("**CAPIVARA_ROTEIRO_ERRADO:** o seletor exige o que a fase não pede")).toBe(
      "o seletor exige o que a fase não pede",
    );
    expect(declarouRoteiroErrado("terminei tudo certo")).toBeNull();
  });

  it("sem motivo, ainda conta como contestação — mas o log diz que faltou", () => {
    expect(declarouRoteiroErrado("CAPIVARA_ROTEIRO_ERRADO")).toBe("o executor não explicou o motivo");
  });
});
