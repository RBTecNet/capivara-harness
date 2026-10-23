/**
 * §133 — o que os prompts do BUILD pedem ao roteirista, à triagem, ao verificador
 * e ao executor quando o pedido esbarra no meio de verificação, e não no produto.
 *
 * Os casos vêm de dois runs reais: no Astra (codex, `build-082c825927b3`) o
 * roteirista do G4 recusou sete vezes em oito porque "ler arquivos depende de
 * executar comandos, que você proibiu"; no Luna (`build-521a72e8dbb5`, desktop
 * Avalonia) o executor foi mandado criar um `start` HTTP e o verificador pediu
 * para "confirmar visualmente" uma janela que nenhuma sessão do loop abre.
 */

import { describe, expect, it } from "vitest";
import { FORA_DO_NAVEGADOR, flowPrompt, implementPrompt, lerForaDoNavegador, triagePrompt, verifyPrompt } from "../../src/prompts/index.js";
import { stackDoSkeleton } from "../../src/prompts/acceptance-policy.js";

const workflow = { number: "1", name: "Cadastrar compromisso", steps: ["abre o calendário", "cadastra um compromisso"] };
const autor = flowPrompt({ language: "pt-BR", workflow, baseUrl: "http://127.0.0.1:47533" });
const triagem = triagePrompt({ language: "pt-BR", phaseMarkdown: "requisitos", workflow, script: "roteiro", failure: "falhou", snapshot: "", serverErrors: [] });

describe("§133 · quem lê o produto pode ler (Astra)", () => {
  it.each([
    ["roteirista", autor],
    ["triagem", triagem],
  ])("%s pode ler o código com comandos que não mudam nada, como o verificador", (_papel, prompt) => {
    expect(prompt).toContain("You may run commands that change nothing");
    expect(prompt).not.toContain("Do not run commands,");
  });

  it.each([
    ["roteirista", autor],
    ["triagem", triagem],
  ])("%s continua proibido de rodar teste, servidor, sonda de navegador, instalação e de escrever", (_papel, prompt) => {
    expect(prompt).toContain("Do not run tests, servers, builds, browser probes or installations");
    expect(prompt).toMatch(/never write, edit, create(,| or) delete/);
  });
});

describe("§133 · o produto fora do navegador (Luna)", () => {
  it("o roteirista sabe dizer que o fluxo não se percorre num navegador, citando o contrato", () => {
    expect(autor).toContain(`${FORA_DO_NAVEGADOR}: <`);
    expect(autor).toContain("never a pass");
    // Passo de terminal num produto web continua sendo roteiro: não é a saída.
    expect(autor).toContain("comandoDoProjeto");
  });

  it("lê a marca e o trecho, e nada fora dela", () => {
    expect(lerForaDoNavegador(`${FORA_DO_NAVEGADOR}: Interface visual: Avalonia UI para aplicativo desktop`)).toBe("Interface visual: Avalonia UI para aplicativo desktop");
    expect(lerForaDoNavegador(`Não dá.\n\n\`${FORA_DO_NAVEGADOR}: «Aplicativo desktop instalável»\``)).toBe("Aplicativo desktop instalável");
    expect(lerForaDoNavegador("```ts\nimport { test } from '@playwright/test';\n```")).toBeNull();
    expect(lerForaDoNavegador(`${FORA_DO_NAVEGADOR}:   `)).toBeNull();
    // A pontuação de fim de frase e as aspas tipográficas não fazem parte da citação.
    expect(lerForaDoNavegador(`${FORA_DO_NAVEGADOR}: “Aplicativo desktop compatível com Windows e Linux”.`)).toBe("Aplicativo desktop compatível com Windows e Linux");
  });

  it("o contrato que vale para a citação é só a Stack do skeleton", () => {
    const skeleton = "# Agenda\n\n## Stack\n- Interface visual: Avalonia UI para aplicativo desktop\n\n## Fluxos\n### workflow 1 — Cadastrar\n- abre no navegador\n\n## Regras transversais\n- usado no navegador";
    expect(stackDoSkeleton(skeleton)).toBe("## Stack\n- Interface visual: Avalonia UI para aplicativo desktop");
  });

  it("o executor de um produto fora do navegador não é mandado criar servidor HTTP só para o gate", () => {
    const prompt = implementPrompt({ language: "pt-BR", phaseMarkdown: "fase", testCommand: null, containerized: false, temFluxos: true, entrypointAusente: true });
    expect(prompt).toContain("If the product is used through a browser, create it in this session");
    expect(prompt).toContain("do not create a manifest, an HTTP server or a `start` entry only for this gate");
  });
});

describe("§133 · o verificador não bloqueia pelo que nenhuma sessão observa (Luna)", () => {
  const prompt = verifyPrompt({ language: "pt-BR", phaseMarkdown: "fase", taskCount: 1 });

  it("observação impossível não é defeito do produto; continua exigindo a evidência do código", () => {
    expect(prompt).toContain("No session of this loop can open a native window");
    expect(prompt).toContain("If the code does not establish the behaviour, it is INCOMPLETE as before");
    // O que já era regra continua: nada se aprova sem examinar evidência, e todos os achados vêm juntos.
    expect(prompt).toContain("Do not approve missing functionality or assume an essential behaviour works without examining evidence");
    expect(prompt).toContain("Report ALL");
  });

  it("critério que prescreve o procedimento de verificação é julgado pelo comportamento que ele protege", () => {
    expect(prompt).toContain("prescribes HOW the product is verified");
    const comFluxos = verifyPrompt({ language: "pt-BR", phaseMarkdown: "fase", taskCount: 1, temFluxos: true });
    expect(comFluxos).toContain("the flow gate, which reports what it could not walk");
    // Sem gate de fluxos (fase sem fluxo, `--no-flows`), ninguém relata o percurso: a frase não aparece.
    expect(prompt).not.toContain("the flow gate, which reports what it could not walk");
  });
});

describe("§133 · o verificador sabe o que o harness exige para o G4 (Astra)", () => {
  it("com fluxos, PORT e HOST são exigência do harness, não desvio do plano", () => {
    const comFluxos = verifyPrompt({ language: "pt-BR", phaseMarkdown: "fase", taskCount: 1, temFluxos: true });
    expect(comFluxos).toContain("Honouring\n`PORT` and `HOST`");
    expect(comFluxos).toContain("never ask to create a manifest, an HTTP server or a `start` entry only for the flow gate");
    expect(comFluxos).toContain("never ask to remove it");
    // A porta do plano continua valendo como padrão: o desvio dela segue sendo achado.
    expect(comFluxos).toContain("A default that contradicts the plan is still a finding");
  });

  it("sem fluxos, o bloco não aparece", () => {
    expect(verifyPrompt({ language: "pt-BR", phaseMarkdown: "fase", taskCount: 1 })).not.toContain("How the harness starts the product");
  });
});
