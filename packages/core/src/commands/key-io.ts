/**
 * A entrada tecla a tecla, para quando há uma pessoa no terminal.
 *
 * O wizard de linha pergunta e lê uma linha; este desenha a pergunta dentro da
 * moldura do painel e lê teclas: a escolha é uma lista com cursor, o texto é um
 * campo que aceita colagem inteira. Ele implementa o mesmo `LineIO` — `ask` e
 * `write` — e acrescenta `select` e `multiline`, que o wizard usa quando
 * existem. Em pipe, arquivo ou teste, quem responde continua sendo o `line-io`.
 *
 * As duas regras do `line-io` continuam aqui, por outro caminho:
 *
 * - **tecla batida antes da pergunta não responde a pergunta.** Medido no
 *   `assistencia2`: 33 decisões respondidas em rajadas de 0,26s por teclas que
 *   a pessoa tinha batido antes de sair do terminal. Tecla que chega sem
 *   pergunta na tela é descartada, e o descarte é dito na pergunta seguinte;
 * - **colagem não é escolha.** O terminal marca a colagem, e a lista a recusa.
 *
 * O modo raw tira do terminal o Ctrl-C como sinal. Ele é devolvido à mão: o
 * terminal é restaurado primeiro e o SIGINT é enviado depois, para quem trata a
 * interrupção receber o mesmo que receberia sem este módulo.
 */

import { InputEndedError } from "./line-io.js";
import type { LineIO } from "./line-io.js";
import { createLiveRegion } from "../tui/live.js";
import { BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON, KeyDecoder } from "../tui/keys.js";
import type { Key } from "../tui/keys.js";
import { initialSelect, reduceSelect, type SelectSpec } from "../tui/select.js";
import { reduceTextField, type TextFieldSpec } from "../tui/text-field.js";
import { cleanPrompt, renderWizardScreen, type WizardPrompt } from "../tui/wizard-screen.js";
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

export interface KeyPrompter extends LineIO {
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

interface Active {
  prompt: WizardPrompt;
  question: string;
  resolve: (value: string | number) => void;
  reject: (error: Error) => void;
  /** Como a resposta aparece em "SUAS ESCOLHAS". */
  describe: (value: string | number) => string;
}

export function createKeyPrompter(options: KeyPrompterOptions): KeyPrompter {
  const { input, write, style } = options;
  const live = createLiveRegion(write, true, options.dimensions);
  const decoder = new KeyDecoder();
  const history: { question: string; answer: string }[] = [];
  let notes: string[] = [];
  /** O que estava na tela junto com a última pergunta respondida. */
  let answeredNotes: string[] = [];
  let active: Active | null = null;
  let early = 0;
  let closed = false;

  const draw = (): void => {
    if (!active || closed) return;
    const { columns, rows } = options.dimensions();
    live.draw(
      renderWizardScreen({
        version: options.version,
        subtitle: options.subtitle,
        history,
        notes,
        prompt: active.prompt,
        width: columns,
        height: rows,
        style,
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
      }),
    );
  };

  const finish = (value: string | number): void => {
    const current = active!;
    active = null;
    history.push({ question: current.question, answer: current.describe(value) });
    answeredNotes = notes;
    notes = [];
    current.resolve(value);
  };

  const onKey = (key: Key): void => {
    if (key.type === "ctrl-c") {
      prompter.close();
      (options.interrupt ?? (() => process.kill(process.pid, "SIGINT")))();
      return;
    }
    if (!active) {
      early += 1;
      return;
    }
    if (active.prompt.kind === "select") {
      if (key.type === "ctrl-d") {
        const current = active;
        active = null;
        current.reject(new InputEndedError());
        return;
      }
      const step = reduceSelect(active.prompt.spec, active.prompt.state, key);
      active.prompt = { ...active.prompt, state: step.state };
      if (step.chosen !== undefined) return finish(step.chosen);
    } else {
      const step = reduceTextField(active.prompt.spec, active.prompt.state, key);
      active.prompt = { ...active.prompt, state: step.state };
      if (step.ended) {
        const current = active;
        active = null;
        current.reject(new InputEndedError());
        return;
      }
      if (step.submitted !== undefined) return finish(step.submitted);
    }
    draw();
  };

  const onData = (chunk: string | Buffer): void => {
    for (const key of decoder.feed(typeof chunk === "string" ? chunk : chunk.toString("utf8"))) {
      if (closed) return;
      onKey(key);
    }
  };

  input.setEncoding?.("utf8");
  input.setRawMode?.(true);
  input.on("data", onData);
  input.resume?.();
  write(BRACKETED_PASTE_ON);
  const stopResize = options.onResize?.(() => draw()) ?? (() => undefined);

  const open = <T extends string | number>(prompt: WizardPrompt, question: string, describe: (value: string | number) => string): Promise<T> => {
    if (closed) return Promise.reject(new InputEndedError());
    if (early > 0) {
      notes.push(`(ignorei ${early} tecla(s) batida(s) antes desta pergunta aparecer — responda agora, olhando para ela)`);
      early = 0;
    }
    return new Promise<T>((resolve, reject) => {
      active = { prompt, question, resolve: resolve as (value: string | number) => void, reject, describe };
      draw();
    });
  };

  const prompter: KeyPrompter = {
    write: (text) => {
      if (closed) {
        write(text);
        return;
      }
      notes.push(text);
      draw();
    },
    ask: (prompt) => {
      const placeholder = /\[([^\]]*)\]\s*:?\s*$/.exec(prompt.trim())?.[1];
      const spec: TextFieldSpec = { label: prompt, ...(placeholder !== undefined ? { placeholder } : {}) };
      return open<string>({ kind: "text", spec, state: { value: "" } }, prompt, (value) =>
        value === "" ? (placeholder ?? "(vazio)") : String(value),
      );
    },
    multiline: (title) =>
      open<string>({ kind: "text", spec: { label: title, multiline: true }, state: { value: "" } }, title, (value) => {
        const text = String(value);
        const lines = text.split("\n").length;
        return lines > 1 ? `${text.split("\n")[0]} … (${lines} linhas)` : text;
      }),
    select: (title, choices, defaultIndex, keepLabel) => {
      const spec: SelectSpec = { title, choices, defaultIndex, ...(keepLabel !== undefined ? { keepLabel } : {}) };
      return open<number>({ kind: "select", spec, state: initialSelect(spec) }, title, (value) =>
        Number(value) < 0 ? (keepLabel ?? "padrão") : (choices[Number(value)]?.label ?? String(value)),
      );
    },
    close: () => {
      if (closed) return;
      closed = true;
      stopResize();
      input.removeListener("data", onData);
      input.setRawMode?.(false);
      input.pause?.();
      write(BRACKETED_PASTE_OFF);

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

      if (active) {
        const current = active;
        active = null;
        current.reject(new InputEndedError());
      }
    },
  };

  return prompter;
}
