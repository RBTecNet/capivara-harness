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
 *
 * ## E por que num TERMINAL a fila é o contrário disso
 *
 * O que resolve o pipe é veneno na mão de uma pessoa. Num terminal, o que ela
 * digita ENQUANTO o harness pensa — três minutos esperando um modelo — fica na
 * fila e responde a pergunta SEGUINTE, que ela ainda não viu. A pergunta aparece
 * e é respondida no mesmo instante, some da tela, e vira decisão gravada como
 * autoridade.
 *
 * Medido no `assistencia2`: 95 decisões gravadas, todas com a resposta `1`, e
 * **33 delas com menos de meio segundo entre uma e outra** — rajadas de 0,26s.
 * Ninguém lê uma arbitragem e escolhe em 0,26 segundos, oito vezes seguidas. O
 * desenvolvedor tinha saído do terminal; as teclas que ele havia batido antes
 * responderam por ele, em perguntas que nunca esteve na frente.
 *
 * Então a regra passa a depender de QUEM está do outro lado:
 *
 * - **pipe ou arquivo** (`interactive: false`): a fila entrega na ordem, como
 *   sempre. É um roteiro escrito de propósito, e a ordem é a intenção de quem o
 *   escreveu;
 * - **terminal** (`interactive: true`): só conta o que for digitado DEPOIS de a
 *   pergunta estar na tela. O que chegou antes é descartado e o descarte é dito,
 *   porque sumir com a tecla de alguém em silêncio é outra forma do mesmo defeito.
 *
 * Uma resposta é a resposta a uma pergunta que a pessoa podia ver. O resto é ruído
 * de teclado com força de decisão.
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

export interface LineIOOptions {
  /**
   * Há uma pessoa do outro lado?
   *
   * Ausente é `false` — o comportamento de fila, que é o dos pipes e o dos testes.
   * Quem sabe que está falando com um terminal declara, e ganha o descarte do
   * que foi digitado antes da pergunta existir.
   */
  interactive?: boolean;
}

export function createLineIO(source: LineSource, write: (text: string) => void, options: LineIOOptions = {}): LineIO {
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
      if (options.interactive === true && buffered.length > 0) {
        const descartadas = buffered.length;
        buffered.length = 0;
        write(
          `  (ignorei ${descartadas} linha(s) digitada(s) antes desta pergunta aparecer — responda agora, olhando para ela)\n`,
        );
      }

      write(prompt);
      const pronto = buffered.shift();
      if (pronto !== undefined) return Promise.resolve(pronto);
      if (closed) return Promise.reject(new InputEndedError());
      return new Promise<string>((resolve, reject) => waiting.push({ resolve, reject }));
    },
  };
}
