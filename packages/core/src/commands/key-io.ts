/**
 * A entrada tecla a tecla, para quando há uma pessoa no terminal.
 *
 * Duas camadas:
 *
 * - a SESSÃO (`createKeySession`) é dona do terminal em modo raw e só sabe de
 *   teclas: abre uma lista, um campo ou uma pergunta em linha, e chama quem a
 *   abriu a cada tecla para desenhar. Onde desenhar não é com ela — o wizard
 *   desenha na tela dele, a entrevista desenha dentro do painel;
 * - o PROMPTER (`createKeyPrompter`) é o wizard: a sessão mais a tela de
 *   escolhas. Implementa o mesmo `LineIO` — `ask` e `write` — e acrescenta
 *   `select` e `multiline`, que o wizard usa quando existem.
 *
 * Em pipe, arquivo ou teste, quem responde continua sendo o `line-io`. As duas
 * regras dele continuam aqui, por outro caminho:
 *
 * - **tecla batida antes da pergunta não responde a pergunta.** Medido no
 *   `assistencia2`: 33 decisões respondidas em rajadas de 0,26s por teclas que
 *   a pessoa tinha batido antes de sair do terminal. Tecla que chega sem
 *   pergunta aberta é descartada, e o descarte é dito na pergunta seguinte;
 * - **colagem não é escolha.** O terminal marca a colagem, e a lista a recusa.
 *
 * O modo raw tira do terminal o Ctrl-C como sinal. Ele é devolvido à mão: o
 * terminal é restaurado primeiro e o SIGINT é enviado depois, para quem trata a
 * interrupção receber o mesmo que receberia sem este módulo.
 */

import { InputEndedError, PerguntaRetiradaError } from "./line-io.js";
import type { LineIO } from "./line-io.js";
import { createLiveRegion } from "../tui/live.js";
import { BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON, KeyDecoder } from "../tui/keys.js";
import type { Key } from "../tui/keys.js";
import { initialSelect, reduceSelect, renderSelect, type SelectSpec, type SelectState } from "../tui/select.js";
import { box } from "../tui/dashboard.js";
import { wrapKeepingBreaks } from "../tui/interview.js";
import { reduceTextField, type TextFieldSpec, type TextFieldState } from "../tui/text-field.js";
import { cleanPrompt, renderWizardScreen, type WizardPrompt } from "../tui/wizard-screen.js";
import { paint, visibleWidth } from "../tui/ansi.js";
import type { Choice } from "../tui/wizard.js";
import type { Style } from "../tui/ansi.js";

/** O mínimo de um terminal de entrada: serve `process.stdin` e serve um fake. */
export interface KeyInput {
  on: (event: "data", listener: (chunk: string | Buffer) => void) => unknown;
  removeListener: (event: "data", listener: (chunk: string | Buffer) => void) => unknown;
  setRawMode?: (mode: boolean) => unknown;
  setEncoding?: (encoding: BufferEncoding) => unknown;
  resume?: () => unknown;
  pause?: () => unknown;
}

export interface KeySessionOptions {
  input: KeyInput;
  write: (text: string) => void;
  /** Largura do terminal, para a pergunta em linha não quebrar de linha. */
  columns?: () => number;
  /** O que o Ctrl-C faz depois de o terminal ser restaurado. Padrão: SIGINT. */
  interrupt?: () => void;
}

export interface KeySession {
  /**
   * A lista; `render` é chamado ao abrir e a cada tecla, com o estado atual.
   * Devolve `null` só quando a lista é `cancelable` e a pessoa aperta Esc.
   */
  select: (spec: SelectSpec, render: (state: SelectState) => void) => Promise<number | null>;
  /**
   * O campo; `render` como na lista. Ctrl-D num campo vazio é o fim da entrada,
   * e o Esc num campo `cancelable` devolve `null`.
   */
  text: (spec: TextFieldSpec, render: (state: TextFieldState) => void) => Promise<string | null>;
  /**
   * A pergunta em linha, no lugar de um `readline.question`: o prompt e o que se
   * digita ficam numa linha embaixo do que já está na tela. É o `LineIO` da
   * sessão — o mesmo `ask` que o resto do estágio já usa.
   */
  line: LineIO;
  /** Quantas teclas chegaram sem pergunta aberta desde a última vez; zera ao ler. */
  takeEarly: () => number;
  /**
   * Quem atende a tecla quando não há pergunta aberta — os atalhos do build.
   * Devolvendo falso, a tecla conta como batida antes da hora, como sempre.
   */
  onIdle: (handler: ((key: Key) => boolean) | null) => void;
  /**
   * Entrega os bytes crus a outro leitor até o cancelamento devolvido ser
   * chamado — a telinha de rolagem tem o próprio leitor de teclas. O Ctrl-C
   * continua sendo da sessão.
   */
  capture: (listener: (chunk: string) => void) => () => void;
  /** Retira a pergunta aberta, se houver: a leitura pendente rejeita com `PerguntaRetiradaError`. */
  retirar: () => void;
  close: () => void;
  readonly closed: boolean;
}

interface Pending {
  onKey: (key: Key) => void;
  reject: (error: Error) => void;
}

export function createKeySession(options: KeySessionOptions): KeySession {
  const { input, write } = options;
  const decoder = new KeyDecoder();
  let pending: Pending | null = null;
  let idle: ((key: Key) => boolean) | null = null;
  let captured: ((chunk: string) => void) | null = null;
  let early = 0;
  let closed = false;

  const settle = (): void => {
    pending = null;
  };

  const interromper = (): void => {
    session.close();
    (options.interrupt ?? (() => process.kill(process.pid, "SIGINT")))();
  };

  const onData = (chunk: string | Buffer): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (captured) {
      if (text.includes("\u0003")) return interromper();
      captured(text);
      return;
    }
    for (const key of decoder.feed(text)) {
      if (closed) return;
      if (key.type === "ctrl-c") return interromper();
      if (pending) pending.onKey(key);
      else if (!(idle?.(key) ?? false)) early += 1;
    }
  };

  input.setEncoding?.("utf8");
  input.setRawMode?.(true);
  input.on("data", onData);
  input.resume?.();
  write(BRACKETED_PASTE_ON);
  /*
   * Saída que não passa pelo `close` — exceção não tratada, `process.exit` de
   * outro lugar. O modo do TTY o Node restaura sozinho ao sair; a marcação de
   * colagem não, e o shell seguinte receberia cada colagem cercada de lixo.
   */
  const onExit = (): void => write(BRACKETED_PASTE_OFF);
  process.once("exit", onExit);

  const open = <T>(start: (resolve: (value: T) => void, reject: (error: Error) => void) => (key: Key) => void): Promise<T> => {
    if (closed) return Promise.reject(new InputEndedError());
    return new Promise<T>((resolve, reject) => {
      const onKey = start(
        (value) => {
          settle();
          resolve(value);
        },
        (error) => {
          settle();
          reject(error);
        },
      );
      pending = { onKey, reject };
    });
  };

  const session: KeySession = {
    get closed() {
      return closed;
    },
    takeEarly: () => {
      const count = early;
      early = 0;
      return count;
    },
    onIdle: (handler) => {
      idle = handler;
    },
    capture: (listener) => {
      captured = listener;
      return () => {
        if (captured === listener) captured = null;
      };
    },
    select: (spec, render) =>
      open<number | null>((resolve, reject) => {
        let state = initialSelect(spec);
        render(state);
        return (key) => {
          if (key.type === "ctrl-d") return reject(new InputEndedError());
          const step = reduceSelect(spec, state, key);
          state = step.state;
          if (step.cancelled) return resolve(null);
          if (step.chosen !== undefined) return resolve(step.chosen);
          render(state);
        };
      }),
    text: (spec, render) =>
      open<string | null>((resolve, reject) => {
        let state: TextFieldState = { value: "" };
        render(state);
        return (key) => {
          const step = reduceTextField(spec, state, key);
          state = step.state;
          if (step.ended) return reject(new InputEndedError());
          if (step.cancelled) return resolve(null);
          if (step.submitted !== undefined) return resolve(step.submitted);
          render(state);
        };
      }),
    retirar: () => {
      if (!pending) return;
      const current = pending;
      pending = null;
      current.reject(new PerguntaRetiradaError());
    },
    line: {
      write: (text) => write(text),
      ask: (prompt, signal) => {
        if (signal?.aborted) return Promise.reject(new PerguntaRetiradaError());
        signal?.addEventListener("abort", () => session.retirar(), { once: true });
        const descartadas = session.takeEarly();
        if (descartadas > 0) {
          write(`  (ignorei ${descartadas} tecla(s) batida(s) antes desta pergunta aparecer — responda agora, olhando para ela)\n`);
        }
        const room = (): number => Math.max(8, (options.columns?.() ?? 100) - visibleWidth(prompt) - 2);
        let first = true;
        return session
          .text({ label: prompt }, (state) => {
            // Só o fim do texto cabe na linha; quebrar de linha estragaria o redesenho.
            const shown = state.value.length > room() ? `…${state.value.slice(-(room() - 1))}` : state.value;
            write(`${first ? "" : "\r\u001B[2K"}${prompt}${shown}`);
            first = false;
          })
          .then(
            (value) => {
              write("\n");
              return value ?? "";
            },
            (error: unknown) => {
              write("\n");
              throw error;
            },
          );
      },
    },
    close: () => {
      if (closed) return;
      closed = true;
      process.removeListener("exit", onExit);
      input.removeListener("data", onData);
      input.setRawMode?.(false);
      input.pause?.();
      write(BRACKETED_PASTE_OFF);
      if (pending) {
        const current = pending;
        pending = null;
        current.reject(new InputEndedError());
      }
    },
  };

  return session;
}

/**
 * Uma escolha fechada embaixo do que já está na tela.
 *
 * É a forma do build e do impasse: o painel fica em cima, parado durante a
 * pergunta. O texto da pergunta é escrito UMA vez, como texto comum — ele pode
 * ser longo, como a lista do que o auditor insiste, e redesenhado a cada tecla
 * empurraria a sobra duplicada para o histórico do terminal. Só a lista, numa
 * moldura, se redesenha. Ao escolher, a moldura fica com a opção marcada: o que
 * foi decidido tem de continuar legível depois.
 *
 * Devolve o índice da opção escolhida, a partir de zero.
 */
export async function chooseInBox(
  session: KeySession,
  options: {
    title: string;
    text: readonly string[];
    choices: readonly Choice[];
    defaultIndex?: number;
    write: (text: string) => void;
    dimensions: () => { columns: number; rows: number };
    style: Style;
  },
): Promise<number> {
  const { style } = options;
  const region = createLiveRegion(options.write, true, options.dimensions);
  const spec: SelectSpec = { title: options.title, choices: options.choices, defaultIndex: options.defaultIndex ?? 0 };
  const largura = (): number => Math.min(110, Math.max(30, options.dimensions().columns));
  const inner = largura() - 4;

  const texto = options.text.flatMap((line) => {
    if (line.trim() === "") return [""];
    // O recuo é parte do texto: os itens com "·" ficam embaixo do que listam.
    const recuo = /^\s*/.exec(line)![0];
    return wrapKeepingBreaks(line, inner - recuo.length).map((part) => `  ${recuo}${part}`);
  });
  const descartadas = session.takeEarly();
  options.write(
    [
      "",
      paint(options.title, "cyan", style),
      "",
      ...texto,
      ...(descartadas > 0 ? ["", paint(`(ignorei ${descartadas} tecla(s) batida(s) antes desta pergunta aparecer)`, "yellow", style)] : []),
      "",
    ].join("\n"),
  );

  const dica = paint(" ↑ ↓ move · número leva à opção · Enter confirma", "gray", style);
  const indice =
    (await session.select(spec, (state) => {
      const rows = Math.max(4, options.dimensions().rows - 4);
      region.draw(box("ESCOLHA", [...renderSelect(spec, state, largura() - 2, rows, style), "", dica], largura(), style).join("\n"));
    })) ?? spec.defaultIndex;
  region.draw(box("ESCOLHA", [` ${paint("✓", "green", style)} ${options.choices[indice]?.label ?? ""}`], largura(), style).join("\n"));
  region.release();
  return indice;
}

export interface KeyPrompter extends LineIO {
  secret: (prompt: string) => Promise<string>;
  /** A lista com cursor; devolve o índice escolhido, ou `defaultIndex` na linha de manter. */
  select: (title: string, choices: readonly Choice[], defaultIndex: number, keepLabel?: string) => Promise<number>;
  /** O campo de várias linhas; termina com uma linha só com `.` ou Ctrl-D. */
  multiline: (title: string) => Promise<string>;
  /** Devolve o terminal como estava e deixa na tela o que foi decidido. */
  close: () => void;
}

export interface KeyPrompterOptions {
  input: KeyInput;
  write: (text: string) => void;
  dimensions: () => { columns: number; rows: number };
  style: Style;
  version: string;
  subtitle: string;
  environment?: NodeJS.ProcessEnv;
  /** Assina o redimensionamento do terminal; devolve o cancelamento. */
  onResize?: (listener: () => void) => () => void;
  /** O que o Ctrl-C faz depois de o terminal ser restaurado. Padrão: SIGINT. */
  interrupt?: () => void;
}

/** O wizard: a sessão de teclas desenhando na tela de escolhas. */
export function createKeyPrompter(options: KeyPrompterOptions): KeyPrompter {
  const { write, style } = options;
  const session = createKeySession({
    input: options.input,
    write,
    columns: () => options.dimensions().columns,
    ...(options.interrupt !== undefined ? { interrupt: options.interrupt } : {}),
  });
  const live = createLiveRegion(write, true, options.dimensions);
  const history: { question: string; answer: string }[] = [];
  let notes: string[] = [];
  /** O que estava na tela junto com a última pergunta respondida. */
  let answeredNotes: string[] = [];
  let current: WizardPrompt | null = null;
  let finished = false;

  const draw = (): void => {
    if (!current || session.closed) return;
    const { columns, rows } = options.dimensions();
    live.draw(
      renderWizardScreen({
        version: options.version,
        subtitle: options.subtitle,
        history,
        notes,
        prompt: current,
        width: columns,
        height: rows,
        style,
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
      }),
    );
  };
  const stopResize = options.onResize?.(() => draw()) ?? (() => undefined);

  /** Abre a pergunta, registra a resposta e devolve a tela ao estado de espera. */
  const ask = async <T>(question: string, run: () => Promise<T>, describe: (value: T) => string): Promise<T> => {
    const descartadas = session.takeEarly();
    if (descartadas > 0) {
      notes.push(`(ignorei ${descartadas} tecla(s) batida(s) antes desta pergunta aparecer — responda agora, olhando para ela)`);
    }
    try {
      const value = await run();
      history.push({ question, answer: describe(value) });
      answeredNotes = notes;
      notes = [];
      return value;
    } finally {
      current = null;
    }
  };

  const prompter: KeyPrompter = {
    secret: (prompt) => {
      const spec: TextFieldSpec = { label: prompt, secret: true };
      return ask(prompt, async () => (await session.text(spec, (state) => {
        current = { kind: "text", spec, state };
        draw();
      })) ?? "", () => "(oculto)");
    },
    write: (text) => {
      if (finished) {
        write(text);
        return;
      }
      notes.push(text);
      draw();
    },
    ask: (prompt) => {
      const placeholder = /\[([^\]]*)\]\s*:?\s*$/.exec(prompt.trim())?.[1];
      const spec: TextFieldSpec = { label: prompt, ...(placeholder !== undefined ? { placeholder } : {}) };
      return ask(
        prompt,
        async () =>
          (await session.text(spec, (state) => {
            current = { kind: "text", spec, state };
            draw();
          })) ?? "",
        (value) => (value === "" ? (placeholder ?? "(vazio)") : value),
      );
    },
    multiline: (title) => {
      const spec: TextFieldSpec = { label: title, multiline: true };
      return ask(
        title,
        async () =>
          (await session.text(spec, (state) => {
            current = { kind: "text", spec, state };
            draw();
          })) ?? "",
        (value) => {
          const lines = value.split("\n");
          return lines.length > 1 ? `${lines[0]} … (${lines.length} linhas)` : value;
        },
      );
    },
    select: (title, choices, defaultIndex, keepLabel) => {
      const spec: SelectSpec = { title, choices, defaultIndex, ...(keepLabel !== undefined ? { keepLabel } : {}) };
      return ask(
        title,
        async () =>
          (await session.select(spec, (state) => {
            current = { kind: "select", spec, state };
            draw();
          })) ?? spec.defaultIndex,
        (value) => (value < 0 ? (keepLabel ?? "padrão") : (choices[value]?.label ?? String(value))),
      );
    },
    close: () => {
      if (finished) return;
      finished = true;
      stopResize();
      session.close();

      /*
       * A moldura sai e fica, no histórico do terminal, o que foi decidido e o
       * que o wizard disse por último — é ali que está o comando equivalente,
       * que existe justamente para ser copiado depois.
       */
      live.draw("");
      live.release();
      const resumo = history.map((item) => `  ${cleanPrompt(item.question)}: ${item.answer}`);
      const restante = [...answeredNotes, ...notes].join("");
      write([...resumo, ""].join("\n") + (restante === "" ? "" : `${restante.endsWith("\n") ? restante : `${restante}\n`}`));
    },
  };

  return prompter;
}
