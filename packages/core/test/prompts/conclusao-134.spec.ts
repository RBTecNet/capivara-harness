/**
 * §134 — o que o roteirista sabe e diz quando o fluxo não se percorre num
 * navegador: o produto de terminal é percorrido por comandos, e o que vive fora
 * dos dois (janela nativa, dispositivo, biblioteca) fica NÃO percorrido — na
 * aceitação final, verificação inconclusiva, nunca prova (etapa 4 da redução).
 */

import { describe, expect, it } from "vitest";
import { FORA_DO_NAVEGADOR, flowPrompt, lerForaDoNavegador } from "../../src/prompts/index.js";

const workflow = { number: "1", name: "Cadastrar compromisso", steps: ["O usuário informa o título.", "A aplicação salva o compromisso."] };

describe("§134 · a resposta de quem tira o fluxo do navegador", () => {
  it("a marca é lida com o trecho, e as outras linhas da resposta não entram nele", () => {
    const resposta = ["O produto é uma janela Avalonia.", `${FORA_DO_NAVEGADOR}: Interface visual: Avalonia UI para aplicativo desktop`, "nada mais a dizer"].join("\n");
    expect(lerForaDoNavegador(resposta)).toBe("Interface visual: Avalonia UI para aplicativo desktop");
  });
});

describe("§134 · o prompt do roteirista", () => {
  const prompt = flowPrompt({ language: "pt-BR", workflow, baseUrl: "http://127.0.0.1:47533" });

  it("fora do navegador e do terminal: só a marca, e o fluxo fica não percorrido, nunca aprovado", () => {
    expect(prompt).toContain(`${FORA_DO_NAVEGADOR}: <the line of the contract's Stack`);
    expect(prompt).toContain("never a pass");
    expect(prompt).not.toContain("CAPIVARA_PROVA");
  });

  it("o produto de terminal é percorrido por comandos, sem página e sem servidor", () => {
    expect(prompt).toContain("## A product used in a terminal");
    expect(prompt).toContain("walk the flow with `comandoDoProjeto` alone");
    expect(prompt).toContain("without starting a server or opening a browser");
    // A marca deixa de valer para o programa de terminal: ele tem como ser percorrido.
    const listaDaMarca = prompt.slice(prompt.indexOf("## A product used outside the browser"), prompt.indexOf("## A product used in a terminal"));
    expect(listaDaMarca).toContain("a native desktop window");
    expect(listaDaMarca).not.toContain("a program used in a terminal");
  });

  it("controle web: as instruções do produto servido no navegador continuam as mesmas", () => {
    expect(prompt).toContain("The application is ALREADY RUNNING at http://127.0.0.1:47533 when your script starts");
    expect(prompt).toContain("When a step needs to start, stop or RESTART the server");
    expect(prompt).toContain("test('workflow 1 — Cadastrar compromisso', async ({ page }) => {");
    expect(prompt).toContain("SCOPE YOUR LOCATORS.");
  });
});
