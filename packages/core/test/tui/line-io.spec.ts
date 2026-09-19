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
