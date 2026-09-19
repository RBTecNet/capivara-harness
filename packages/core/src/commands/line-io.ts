/**
 * Leitura de linhas do desenvolvedor, enfileirada.
 *
 * `readline.question()` só enxerga o que chega ENQUANTO ele espera. Num terminal
 * de verdade isso nunca aparece, porque a pessoa digita depois da pergunta. Com a
 * entrada vindo de um arquivo ou de um pipe, tudo chega de uma vez, antes da
 * primeira pergunta: o readline lê o lote inteiro, encontra o fim da entrada,
 * fecha — e a primeira `question()` estoura em `ERR_USE_AFTER_CLOSE`, com stack
 * trace de Node no lugar de um diagnóstico.
 *
 * Foi assim que o piloto 5 morreu na pergunta 1 de 6, depois de já ter pago pelo
 * levantamento inteiro. O wizard já resolvia isto desde que a mesma falha comeu
 * uma colagem de pedido; o `init`, o `plan` e o `build` continuaram no caminho
 * cru até aquele run mostrar que a correção tinha ficado pela metade.
 *
 * A fila guarda o que chegou cedo e entrega na ordem. Quando a entrada acaba de
 * verdade, quem chamou recebe `InputEndedError` — um erro nomeado, para virar o
 * diagnóstico de quem sabe o contexto, nunca um stack trace.
 */

/** O mínimo que o leitor de linhas precisa: serve readline e serve um fake. */
export interface LineSource {
  on: (event: "line" | "close", listener: (line: string) => void) => unknown;
}

export interface LineIO {
  ask: (prompt: string) => Promise<string>;
  write: (text: string) => void;
}

export class InputEndedError extends Error {
  constructor() {
    super("a entrada terminou");
    this.name = "InputEndedError";
  }
}

export function createLineIO(source: LineSource, write: (text: string) => void): LineIO {
  const buffered: string[] = [];
  const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  let closed = false;

  source.on("line", (line) => {
    const next = waiting.shift();
    if (next) next.resolve(line);
    else buffered.push(line);
  });
  source.on("close", () => {
    closed = true;
    while (waiting.length > 0) waiting.shift()?.reject(new InputEndedError());
  });

  return {
    write,
    ask: (prompt) => {
      write(prompt);
      const pronto = buffered.shift();
      if (pronto !== undefined) return Promise.resolve(pronto);
      if (closed) return Promise.reject(new InputEndedError());
      return new Promise<string>((resolve, reject) => waiting.push({ resolve, reject }));
    },
  };
}
