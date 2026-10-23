/**
 * §134 — o que o roteirista sabe e diz quando o fluxo não se percorre num
 * navegador: o produto de terminal é percorrido por comandos, e o que vive fora
 * dos dois (janela nativa, dispositivo, biblioteca) é provado pela suíte do
 * próprio projeto, passo a passo, com o teste citado — nunca por compilar ou abrir.
 */

import { describe, expect, it } from "vitest";
import { FORA_DO_NAVEGADOR, PROVA, SEM_PROVA, flowPrompt, lerForaDoNavegador, lerProvas } from "../../src/prompts/index.js";

const workflow = { number: "1", name: "Cadastrar compromisso", steps: ["O usuário informa o título.", "A aplicação salva o compromisso."] };

describe("§134 · a resposta de quem tira o fluxo do navegador traz a prova de cada passo", () => {
  it("lê a prova citada e o passo sem prova, com e sem crases, com travessão ou hífen", () => {
    const resposta = [
      "O produto é uma janela Avalonia.",
      `${FORA_DO_NAVEGADOR}: Interface visual: Avalonia UI para aplicativo desktop`,
      `\`${PROVA}: passo 1 — tests/Agenda.Tests/AgendaInterfaceTests.cs :: CadastroValidoPersisteCompromisso\``,
      `${PROVA}: passo 2 - \`tests/Agenda.Tests/PersistenciaTests.cs\` :: \`RepositorioPreservaCompromisso\``,
      `${PROVA}: passo 2 — tests/Agenda.Tests/AgendaInterfaceTests.cs :: CadastroCombinaDataEHorario`,
      `${SEM_PROVA}: passo 3 — nenhum teste exercita a indicação do dia no calendário.`,
      `${PROVA}: passo x — lixo :: nada`,
    ].join("\n");
    expect(lerProvas(resposta)).toEqual({
      provas: [
        { passo: 1, arquivo: "tests/Agenda.Tests/AgendaInterfaceTests.cs", teste: "CadastroValidoPersisteCompromisso" },
        { passo: 2, arquivo: "tests/Agenda.Tests/PersistenciaTests.cs", teste: "RepositorioPreservaCompromisso" },
        { passo: 2, arquivo: "tests/Agenda.Tests/AgendaInterfaceTests.cs", teste: "CadastroCombinaDataEHorario" },
      ],
      semProva: [{ passo: 3, motivo: "nenhum teste exercita a indicação do dia no calendário." }],
    });
    // A marca continua lida como antes: as linhas de prova não entram no trecho citado.
    expect(lerForaDoNavegador(resposta)).toBe("Interface visual: Avalonia UI para aplicativo desktop");
  });

  it("um roteiro de verdade não traz prova nenhuma", () => {
    expect(lerProvas("```ts\nimport { test } from '@playwright/test';\n```")).toEqual({ provas: [], semProva: [] });
  });
});

describe("§134 · o prompt do roteirista", () => {
  const comSuite = flowPrompt({ language: "pt-BR", workflow, baseUrl: "http://127.0.0.1:47533", suite: "dotnet test tests/Agenda.Tests/Agenda.Tests.csproj" });
  const semSuite = flowPrompt({ language: "pt-BR", workflow, baseUrl: "http://127.0.0.1:47533", suite: null });

  it("fora do navegador e do terminal: pede o teste da suíte que prova cada passo, e diz que compilar ou abrir não prova", () => {
    expect(comSuite).toContain(`${PROVA}: passo <n> — <path of a test file of the project> :: <name of the test>`);
    expect(comSuite).toContain(`${SEM_PROVA}: passo <n> — `);
    expect(comSuite).toContain("`dotnet test tests/Agenda.Tests/Agenda.Tests.csproj`");
    expect(comSuite).toContain("a test that only builds, starts or opens the product proves no step");
    expect(comSuite).toContain("never a pass");
  });

  it("sem suíte que o harness rode, nenhum passo se prova por teste, e o prompt diz isso", () => {
    expect(semSuite).toContain("no suite the harness can run");
    expect(semSuite).not.toContain("dotnet test");
  });

  it("o produto de terminal é percorrido por comandos, sem página e sem servidor", () => {
    expect(comSuite).toContain("## A product used in a terminal");
    expect(comSuite).toContain("walk the flow with `comandoDoProjeto` alone");
    expect(comSuite).toContain("without starting a server or opening a browser");
    // A marca deixa de valer para o programa de terminal: ele tem como ser percorrido.
    const listaDaMarca = comSuite.slice(comSuite.indexOf("## A product used outside the browser"), comSuite.indexOf("## A product used in a terminal"));
    expect(listaDaMarca).toContain("a native desktop window");
    expect(listaDaMarca).not.toContain("a program used in a terminal");
  });

  it("controle web: as instruções do produto servido no navegador continuam as mesmas", () => {
    const web = flowPrompt({ language: "pt-BR", workflow, baseUrl: "http://127.0.0.1:47533" });
    expect(web).toContain("The application is ALREADY RUNNING at http://127.0.0.1:47533 when your script starts");
    expect(web).toContain("When a step needs to start, stop or RESTART the server");
    expect(web).toContain("test('workflow 1 — Cadastrar compromisso', async ({ page }) => {");
    expect(web).toContain("SCOPE YOUR LOCATORS.");
    // Sem a suíte informada (quem chama não sabe), o protocolo da prova aparece sem comando nenhum.
    expect(web).not.toContain("no suite the harness can run");
  });
});
