import { describe, expect, it } from "vitest";
import { BUILDER_COMPLETE_MARKER, declarouRoteiroErrado, fixPrompt, implementPrompt, parseVerification, verifierRepairPrompt, verifyPrompt } from "../../src/prompts/index.js";
import { gate3 } from "../../src/loop/gates.js";

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

  // §112: sem sandbox, nenhum comando é recusado pela forma; fica só onde pôr o temporário.
  it("não fala de comando recusado, e diz onde pôr o temporário", () => {
    const prompt = implementPrompt(base);
    expect(prompt).not.toContain("refuse");
    expect(prompt).not.toContain("do not retry it as written");
    expect(prompt).toContain("`.capivara/tmp/`, which never enters a commit");
    expect(prompt).toContain("never at a fixed path under `/tmp`");
  });

  /*
   * §112: no `teste_luna` o executor da P05 escreveu specs de navegador por três
   * ciclos sem rodá-las — "a instrução proíbe outro executor" — e o G3 recusou
   * o que a primeira execução teria mostrado. A P04, que rodou, fechou.
   */
  // §113: quando o manifesto declara `test:e2e`, o prompt o nomeia; o comando do gate não muda.
  it("nomeia o comando de e2e do projeto, quando existe, sem trocar o do gate", () => {
    const prompt = implementPrompt({ ...base, testCommand: "npm test", e2eCommand: "npm run test:e2e" });
    expect(prompt).toContain("The harness independently runs the full suite with:\n\n    npm test");
    expect(prompt).toContain("The project's browser and end-to-end tests run with:\n\n    npm run test:e2e");
    expect(prompt).toContain("inspect the project's scripts before running a duplicate suite");
    expect(fixPrompt({ ...base, testCommand: "npm test", e2eCommand: "npm run test:e2e", gate: "gate 3", cause: "x", previousWroteNothing: false })).toContain("npm run test:e2e");
    expect(implementPrompt({ ...base, testCommand: "npm test" })).not.toContain("end-to-end tests run with");
  });

  it("reaproveita cobertura e deixa novos testes a cargo do validador", () => {
    const prompt = implementPrompt({ ...base, testCommand: "npm test" });
    expect(prompt).not.toContain("Do not use another runner");
    expect(prompt).toContain("This is the exact command the gate uses to validate the phase");
    expect(prompt).toContain("relevant browser or end-to-end tests");
    expect(prompt).toContain("concrete checks requested by the independent validator");
    expect(prompt).not.toContain("Write a browser test and run it");
    expect(prompt).toContain("A test from an earlier phase that contradicts what this phase requires is out of date: update it.");
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

  it("cobra o comportamento real do critério desde a implementação", () => {
    const prompt = implementPrompt(base);
    expect(prompt).toContain("behaviour and failure mode the acceptance criterion actually names");
    expect(prompt).toContain("assert the message");
    expect(prompt).toContain("`route.fulfill()` exercises a different path");
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

  it("recebe a orientação completa sem perder a implementação e o cenário que devem ser preservados", () => {
    const orientacao = "T7.C2: fetch rejeita; src/api.ts:18 devolve TypeError; envolver o await em try/catch e traduzir; testar route.abort e texto português";
    const prompt = fixPrompt({ ...base, gate: "gate 3", cause: orientacao, previousWroteNothing: false });
    expect(prompt).toContain(orientacao);
    expect(prompt).toContain("Use them as your repair plan");
    expect(prompt).toContain("do not recreate the phase from scratch");
    expect(prompt).toContain("HTTP 503 from `route.fulfill()` does not exercise it");
    expect(prompt).toContain("assert the displayed message/language");
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

  it("investiga a dúvida e só bloqueia por evidência material", () => {
    expect(verifyPrompt(context)).toContain("Block on concrete material evidence");
    expect(verifyPrompt(context)).not.toContain("When in doubt, INCOMPLETE");
  });

  it("exige todas as pendências com evidência, alteração localizada e prova de regressão", () => {
    const prompt = verifyPrompt(context);
    expect(prompt).toContain("Inspect EVERY acceptance criterion");
    expect(prompt).toContain("Report ALL");
    expect(prompt).toContain("file, symbol or test");
    expect(prompt).toContain("smallest concrete change");
    expect(prompt).toContain("regression scenario/assertion and command");
    expect(prompt).toContain("You report the repair; you still never perform it here");
  });

  it("distingue a falha real de transporte da resposta HTTP e exige o idioma do alerta", () => {
    const prompt = verifyPrompt(context);
    expect(prompt).toContain("route.abort()");
    expect(prompt).toContain("does NOT prove transport handling");
    expect(prompt).toContain("merely asserting that an alert exists is insufficient");
    expect(prompt).toContain("requirements actually stated");
  });

  it("o validador escolhe a prova sem inventário de nomes prescritos pelo plan", () => {
    const prompt = verifyPrompt(context);
    expect(prompt).toContain("Choose the smallest sufficient verification");
    expect(prompt).not.toContain("NAME NOT FOUND");
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
    expect(parseVerification("TASK 1: DONE; risk noted: criterion may be missing")).toEqual([]);
  });

  it("preserva toda orientação na causa do gate sem quebrar TASK legado", () => {
    const orientacao = "T2.C1: mensagem de rede em português; src/api.ts:18 expõe TypeError; capturar rejeição de fetch e usar mensagem localizada; executar npm run test:e2e -- --grep rede com route.abort e assert do texto; T2.C2: manter retry habilitado";
    const output = `TASK 1: DONE\nTASK 2: INCOMPLETE — ${orientacao}\nTASK 3: INCOMPLETE - falta um teste legado`;
    expect(parseVerification(output)[1]).toEqual({ index: 2, done: false, missing: orientacao });
    const result = gate3(output, 3);
    expect(result.green).toBe(false);
    if (!result.green) {
      expect(result.cause).toContain(orientacao);
      expect(result.cause).toContain("falta um teste legado");
    }
  });
});

describe("reparo pelo validador separado da aprovação", () => {
  const context = {
    language: "pt-BR",
    phaseMarkdown: "## Phase 7: Rede\n- [ ] Mensagem de rede em português",
    cause: "TASK 1: INCOMPLETE — src/api.ts:18; capturar rejeição do fetch; npm run test:e2e -- --grep rede",
    testCommand: "npm test -- --run",
    e2eCommand: "npm run test:e2e",
  };

  it("leva o diagnóstico completo, escopo e comandos reais, sem conceder a própria aprovação", () => {
    const prompt = verifierRepairPrompt(context);
    expect(prompt).toContain(context.phaseMarkdown);
    expect(prompt).toContain(context.cause);
    expect(prompt).toContain(context.testCommand);
    expect(prompt).toContain(context.e2eCommand);
    expect(prompt).toContain("Fix ONLY the listed gaps");
    expect(prompt).toContain("NEW independent read-only verification");
    expect(prompt).toContain("Do not emit TASK verdicts or claim approval");
    expect(prompt).not.toContain(BUILDER_COMPLETE_MARKER);
  });

  it("autoriza código, regressões e dependências locais, sem entregar Git ou especificação", () => {
    const prompt = verifierRepairPrompt(context);
    expect(prompt).toContain("Edit the project's code, tests");
    expect(prompt).toContain("including dependencies the builder could not install");
    expect(prompt).toContain("Do not commit, stage files, change Git branches/refs");
    expect(prompt).toContain("Never edit the specification");
    expect(prompt).toContain("Never delete, skip or disable tests");
    expect(prompt).toContain("cannot replace a transport failure");
  });

  it("amarra instalação e testes ao runtime real do harness", () => {
    const prompt = verifierRepairPrompt(context);
    expect(prompt).toContain(process.execPath);
    expect(prompt).toContain(process.version);
    expect(prompt).toContain(`ABI ${process.versions.modules}`);
    expect(prompt).toContain("Do not activate another Node/NVM version");
  });

  it.each([undefined, false])("sem autorização explícita (%s), não instala pré-requisito de sistema", (systemInstall) => {
    const prompt = verifierRepairPrompt({ ...context, ...(systemInstall !== undefined ? { systemInstall } : {}) });
    expect(prompt).toContain("System installation is NOT enabled");
    expect(prompt).toContain("never install system packages, use sudo or change global");
    expect(prompt).not.toContain("System installation is enabled for this run");
  });

  it("com política de sistema ligada, permite apenas pré-requisito demonstrado no achado", () => {
    const prompt = verifierRepairPrompt({ ...context, systemInstall: true });
    expect(prompt).toContain("System installation is enabled for this run");
    expect(prompt).toContain("demonstrated missing system");
    expect(prompt).not.toContain("System installation is NOT enabled");
  });

  it("sem comando de gate ou e2e, informa a ausência sem inventar comando", () => {
    const { e2eCommand, ...withoutE2e } = context;
    const prompt = verifierRepairPrompt({ ...withoutE2e, cause: "falta dependência", testCommand: null });
    expect(prompt).toContain("No gate test command was resolved");
    expect(prompt).not.toContain("    null");
    expect(prompt).not.toContain("    undefined");
    expect(prompt).not.toContain("also run:");
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
