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

  it("não abre telinha quando não há log a rolar", async () => {
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
