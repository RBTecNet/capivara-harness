/**
 * A fila de linhas: o que chega antes da pergunta não se perde.
 *
 * `readline.question()` só enxerga o que chega enquanto ele espera. Isso nunca
 * aparece com alguém digitando, e sempre aparece com entrada vinda de arquivo ou
 * pipe — o lote inteiro chega primeiro, o readline fecha no fim dele, e a
 * primeira pergunta estoura em ERR_USE_AFTER_CLOSE.
 *
 * O piloto 5 morreu exatamente assim, na pergunta 1 de 6, depois de já ter pago
 * pelo levantamento inteiro.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { InputEndedError, createLineIO } from "../../src/commands/line-io.js";

function fonte() {
  const emitter = new EventEmitter();
  const escrito: string[] = [];
  const io = createLineIO(emitter as never, (text) => void escrito.push(text));
  return { emitter, escrito, io };
}

describe("fila de linhas", () => {
  it("linha que chega ANTES da pergunta é entregue a ela, não perdida", async () => {
    const { emitter, io } = fonte();
    emitter.emit("line", "use as recomendações");
    expect(await io.ask("> ")).toBe("use as recomendações");
  });

  it("um lote inteiro chegando de uma vez responde as perguntas na ordem", async () => {
    const { emitter, io } = fonte();
    for (const linha of ["1", "2", "3"]) emitter.emit("line", linha);

    expect(await io.ask("a? ")).toBe("1");
    expect(await io.ask("b? ")).toBe("2");
    expect(await io.ask("c? ")).toBe("3");
  });

  it("entrada que fecha depois do lote não invalida o que ainda está na fila", async () => {
    const { emitter, io } = fonte();
    emitter.emit("line", "guardada");
    emitter.emit("close");
    expect(await io.ask("> ")).toBe("guardada");
  });

  it("pergunta feita depois da entrada acabar falha nomeada, nunca com stack trace de readline", async () => {
    const { emitter, io } = fonte();
    emitter.emit("close");
    await expect(io.ask("> ")).rejects.toThrow(InputEndedError);
  });

  it("quem já esperava quando a entrada acabou também é recusado, e não fica pendurado", async () => {
    const { emitter, io } = fonte();
    const pendente = io.ask("> ");
    emitter.emit("close");
    await expect(pendente).rejects.toThrow(InputEndedError);
  });

  it("linha que chega depois acorda quem esperava", async () => {
    const { emitter, io } = fonte();
    const pendente = io.ask("> ");
    emitter.emit("line", "tardia");
    expect(await pendente).toBe("tardia");
  });

  it("o prompt é escrito antes de esperar: pergunta invisível parece travamento", async () => {
    const { emitter, escrito, io } = fonte();
    const pendente = io.ask("  ▸ sua resposta: ");
    expect(escrito).toEqual(["  ▸ sua resposta: "]);
    emitter.emit("line", "x");
    await pendente;
  });
});

/*
 * O que resolve o pipe é veneno na mão de uma pessoa.
 *
 * Medido no `assistencia2`: 95 decisões gravadas como autoridade, todas com a
 * resposta `1`, e 33 delas com menos de meio segundo entre uma e outra — rajadas
 * de 0,26s. O desenvolvedor tinha saído do terminal; as teclas batidas antes
 * responderam perguntas que ele nunca viu, e cada uma virou decisão gravada.
 */
describe("num terminal, só vale o que foi digitado DEPOIS da pergunta", () => {
  function interativo() {
    const escrito: string[] = [];
    const ouvintes: Record<string, ((linha: string) => void)[]> = { line: [], close: [] };
    const source = {
      on: (evento: "line" | "close", ouvinte: (linha: string) => void) => {
        ouvintes[evento]!.push(ouvinte);
        return undefined;
      },
    };
    const io = createLineIO(source as never, (texto) => void escrito.push(texto), { interactive: true });
    return { io, escrito, digitar: (linha: string) => ouvintes.line!.forEach((ouvinte) => ouvinte(linha)) };
  }

  it("descarta o que chegou antes da pergunta, e diz que descartou", async () => {
    const t = interativo();
    // Três teclas batidas enquanto o harness pensava, sem pergunta na tela.
    t.digitar("1");
    t.digitar("1");
    t.digitar("1");

    const resposta = t.io.ask("> ");
    expect(t.escrito.join("")).toContain("ignorei 3 linha(s)");

    // A pergunta continua esperando: ela não foi respondida pelo passado.
    let respondida = false;
    void resposta.then(() => (respondida = true));
    await Promise.resolve();
    expect(respondida).toBe(false);

    t.digitar("2");
    expect(await resposta).toBe("2");
  });

  it("sem nada digitado antes, não avisa nada", async () => {
    const t = interativo();
    const resposta = t.io.ask("> ");
    t.digitar("1");
    expect(await resposta).toBe("1");
    expect(t.escrito.join("")).not.toContain("ignorei");
  });

  /*
   * E o pipe continua exatamente como era: ali a fila é a intenção de quem
   * escreveu o roteiro, e a ordem é o que faz um run não interativo funcionar.
   */
  it("com entrada de pipe, a fila entrega na ordem como sempre", async () => {
    const escrito: string[] = [];
    const ouvintes: ((linha: string) => void)[] = [];
    const source = { on: (evento: string, ouvinte: (linha: string) => void) => void (evento === "line" && ouvintes.push(ouvinte)) };
    const io = createLineIO(source as never, (texto) => void escrito.push(texto));

    ouvintes.forEach((ouvinte) => ouvinte("codex"));
    ouvintes.forEach((ouvinte) => ouvinte("gpt-5"));
    expect(await io.ask("provider> ")).toBe("codex");
    expect(await io.ask("modelo> ")).toBe("gpt-5");
    expect(escrito.join("")).not.toContain("ignorei");
  });
});
