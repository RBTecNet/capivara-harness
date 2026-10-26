/**
 * A plataforma do aplicativo desktop é decidida no `init`, não descoberta no `build`.
 *
 * O pedido de um aplicativo de janela de outra plataforma — WinForms ou WPF num
 * Linux — terminava o build em "verificação inconclusiva: plataforma". É uma
 * lacuna: o inventário diz o sistema operacional, o Core reconhece a pilha pelo
 * pedido, sem modelo, e o `init` pergunta — manter o alvo, ou trocar para uma
 * pilha que roda aqui (a recomendação). A resposta vira regra do esqueleto.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/init/index.js";
import { summarizeInventory } from "../../src/init/inventory.js";
import { readSkeletonState } from "../../src/init/skeleton-state.js";
import { EXECUCAO_NAO_PROVADA, ID_DA_PLATAFORMA, ID_DO_BANCO, alvoMantidoNoEsqueleto, desktopDeOutraPlataforma } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { runIdFor } from "../../src/state/index.js";
import { fakeAgent, skeletonPath } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-plataforma-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const language = "português do Brasil";

async function init(pedido: string, sistema: NodeJS.Platform, plataforma: string) {
  const request = { text: pedido, origin: "text" as const, path: null, sha12: "plataforma01" };
  const perguntas: Question[] = [];
  const ask = async (question: Question) => {
    perguntas.push(question);
    return question.id === ID_DO_BANCO ? "1" : question.id === ID_DA_PLATAFORMA ? plataforma : "use as recomendações";
  };
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(skeletonPath()).call, ask, announce: () => undefined, sistema });
  const esqueleto = await readSkeletonState(projectRoot, runIdFor("init", request.sha12));
  return { perguntas, esqueleto, publicado: await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8") };
}

describe("o inventário diz o sistema operacional", () => {
  it("ao lado do Node e do npm do harness", () => {
    const resumo = summarizeInventory({ empty: true, files: [], manifests: [], secretsPresent: [], truncated: false, runtime: { node: "25.9.0", npm: "11.12.1", sistema: "linux" } });
    expect(resumo).toContain("o harness roda Node.js 25.9.0 e npm 11.12.1, em Linux");
  });
});

describe("o aplicativo de janela de outra plataforma é uma lacuna do init", () => {
  it("um pedido WinForms num Linux gera a pergunta, com a troca como recomendação; respondida, a troca vira regra do esqueleto", async () => {
    const { perguntas, esqueleto, publicado } = await init("um aplicativo WinForms para cadastrar clientes da loja", "linux", "1");

    const pergunta = perguntas.find((question) => question.id === ID_DA_PLATAFORMA);
    expect(pergunta, perguntas.map((question) => question.id).join(", ")).toBeDefined();
    expect(pergunta!.evidence).toContain("Windows Forms");
    expect(pergunta!.evidence).toContain("esta máquina é Linux");
    expect(pergunta!.options.map((opcao) => opcao.label)).toEqual([
      "Trocar para Avalonia, multiplataforma: o build compila, executa e prova o aplicativo nesta máquina",
      "Manter Windows Forms (alvo Windows): o build compila, mas não executa nem prova o aplicativo nesta máquina",
    ]);
    expect(pergunta!.recommended).toBe(pergunta!.options[0]!.label);
    expect(esqueleto?.rules).toContainEqual(expect.objectContaining({ subject: "plataforma do aplicativo", statement: expect.stringContaining("usa Avalonia, multiplataforma, e não Windows Forms") }));
    expect(publicado).toContain("usa Avalonia, multiplataforma, e não Windows Forms");
    expect(alvoMantidoNoEsqueleto(esqueleto?.rules ?? [])).toBe(false);
  });

  it("manter o alvo Windows vira a regra que diz, com essas palavras, que a execução não é provada aqui por decisão do desenvolvedor", async () => {
    const { esqueleto } = await init("um aplicativo WPF de agenda", "linux", "2");
    const regra = esqueleto?.rules.find((cada) => cada.subject === "plataforma do aplicativo");
    expect(regra?.statement).toContain("-p:EnableWindowsTargeting=true");
    expect(regra?.statement).toContain(EXECUCAO_NAO_PROVADA);
    expect(alvoMantidoNoEsqueleto(esqueleto?.rules ?? [])).toBe(true);
  });

  it("o mesmo pedido no Windows não pergunta nada; nem o pedido web", async () => {
    expect((await init("um aplicativo WinForms para cadastrar clientes da loja", "win32", "1")).perguntas.some((question) => question.id === ID_DA_PLATAFORMA)).toBe(false);
    await rm(join(projectRoot, ".capivara"), { recursive: true, force: true });
    expect((await init("um sistema web de reservas para uma pousada", "linux", "1")).perguntas.some((question) => question.id === ID_DA_PLATAFORMA)).toBe(false);
  });

  it("o reconhecimento é pelo pedido, sem modelo: a pilha e o alvo", () => {
    expect(desktopDeOutraPlataforma("app em Windows Forms", "linux")).toEqual({ pilha: "Windows Forms", alvo: "windows" });
    expect(desktopDeOutraPlataforma("uma interface WPF", "darwin")).toEqual({ pilha: "WPF", alvo: "windows" });
    expect(desktopDeOutraPlataforma("uma interface WPF", "win32")).toBeNull();
    expect(desktopDeOutraPlataforma("um app AppKit para macOS", "linux")).toEqual({ pilha: "AppKit", alvo: "macos" });
    expect(desktopDeOutraPlataforma("um app Avalonia de agenda", "linux")).toBeNull();
  });
});
