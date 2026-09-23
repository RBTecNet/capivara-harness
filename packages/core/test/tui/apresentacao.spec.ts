import { describe, expect, it } from "vitest";

import { apresentarConclusao, apresentarParada } from "../../src/tui/apresentacao.js";
import type { Parada } from "../../src/tui/parada.js";

const PARADA: Parada = {
  natureza: "ambiente",
  oQue: "o runner de testes não está instalado",
  custou: "3 de 8 fase(s) fechada(s)",
  evidencia: [".capivara/runs/x/logs/P04.cycle-3.log"],
  paraSeguir: ["instale o runner", "rode `capivara build`"],
};

function janela(tty: boolean) {
  const escrito: string[] = [];
  let ouvinte: ((chunk: string) => void) | null = null;
  return {
    escrito,
    digitar: (texto: string) => ouvinte?.(texto),
    entrada: {
      isTTY: tty,
      setRawMode: () => undefined,
      resume: () => undefined,
      pause: () => undefined,
      on: (_e: "data", fn: (chunk: string) => void) => {
        ouvinte = fn;
      },
      off: () => {
        ouvinte = null;
      },
    },
    saida: { isTTY: tty, columns: 80, rows: 24, write: (texto: string) => escrito.push(texto) },
  };
}

describe("apresentação da parada", () => {
  it("imprime o texto mesmo sem terminal, e não tenta abrir telinha", async () => {
    const j = janela(false);
    expect(await apresentarParada(PARADA, ["log"], j)).toBe(false);
    expect(j.escrito.join("")).toContain("o runner de testes não está instalado");
    expect(j.escrito.join("")).not.toContain("\u001B[?1049h");
  });

  it("imprime o texto DEPOIS de fechar o modal, para ele sobreviver à tela alternativa", async () => {
    const j = janela(true);
    const promessa = apresentarParada(PARADA, ["linha de log"], j);
    await new Promise((resolve) => setImmediate(resolve));
    j.digitar("q");
    expect(await promessa).toBe(true);

    const tudo = j.escrito.join("");
    expect(tudo.indexOf("\u001B[?1049l")).toBeLessThan(tudo.lastIndexOf("o runner de testes não está instalado"));
  });

  it("o detalhe rola no corpo; o topo fica com as quatro respostas", async () => {
    const j = janela(true);
    const detalhe = Array.from({ length: 40 }, (_, indice) => `linha ${indice} do que o gate devolveu`).join("\n");
    const promessa = apresentarParada({ ...PARADA, detalhe }, ["log do arquivo"], j);
    await new Promise((resolve) => setImmediate(resolve));

    // O que a telinha desenhou, antes de o texto puro sair.
    const desenhado = j.escrito.join("");
    expect(desenhado).toContain("o runner de testes não está instalado");
    expect(desenhado).toContain("para seguir");
    // O detalhe é longo: ele NÃO pode ter empurrado o cabeçalho para fora.
    expect(desenhado).not.toContain("linha 39 do que o gate devolveu");
    expect(desenhado).toContain("linha 0 do que o gate devolveu");

    j.digitar("q");
    await promessa;
  });

  it("abre a telinha só com o detalhe, mesmo sem arquivo de evidência", async () => {
    const j = janela(true);
    const promessa = apresentarParada({ ...PARADA, detalhe: "duas linhas\nde saída" }, [], j);
    await new Promise((resolve) => setImmediate(resolve));
    j.digitar("q");
    expect(await promessa).toBe(true);
  });

  it("não abre telinha quando não há log nem detalhe a rolar", async () => {
    const j = janela(true);
    expect(await apresentarParada(PARADA, [], j)).toBe(false);
    expect(j.escrito.join("")).toContain("para seguir");
  });

  it("respeita quem pediu para não abrir telinha", async () => {
    const j = janela(true);
    expect(await apresentarParada(PARADA, ["log"], { ...j, semModal: true })).toBe(false);
  });

  it("usa o mesmo caminho para a conclusão", async () => {
    const j = janela(false);
    await apresentarConclusao({ oQue: "8 fases fecharam", custou: "8 fase(s)" }, [], j);
    expect(j.escrito.join("")).toContain("CONCLUÍDO");
  });
});
