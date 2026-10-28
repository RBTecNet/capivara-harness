import { stdin, stdout } from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import { VERSION } from '../version.js';
import { BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON, KeyDecoder, reduceSelect, reduceText } from './keys.js';
import type { Key, SelectState } from './keys.js';
import { renderWizardScreen } from './screen.js';
import type { ScreenPrompt } from './screen.js';
import { WizardBack, WizardCancelled } from './types.js';
import type { Choice, WizardHistory, WizardIO } from './types.js';

export interface TerminalOptions { input?: ReadStream; output?: WriteStream; environment?: NodeJS.ProcessEnv; }
/** One reader and one iterator retain every line from a pasted or piped chunk. */
export function createLineWizardIO(options: TerminalOptions = {}): WizardIO {
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  const terminal = Boolean(input.isTTY && output.isTTY);
  const wasRaw = input.isRaw;
  let muted = false; let closed = false; let cancelled = false;
  const relay = new Writable({ write(chunk: Buffer, _encoding, done) { if (!muted) output.write(chunk); done(); } });
  Object.defineProperty(relay, 'columns', { get: () => output.columns });
  const reader = createInterface({ input, output: relay, terminal, crlfDelay: Infinity, historySize: 0 });
  const lines = reader[Symbol.asyncIterator]();
  const cancel = (): void => { cancelled = true; reader.close(); };
  reader.on('SIGINT', cancel);
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  const next = async (): Promise<string | undefined> => {
    if (closed || cancelled) throw new WizardCancelled();
    const item = await lines.next();
    if (cancelled) throw new WizardCancelled();
    if (item.done) return undefined;
    if (item.value === '\u0003') throw new WizardCancelled();
    if (item.value === '\u001b') throw new WizardBack();
    return item.value;
  };
  const value = async (prompt: string): Promise<string> => {
    output.write(prompt);
    const line = await next();
    if (!terminal) output.write('\n');
    if (line === undefined) throw new WizardCancelled();
    return line;
  };
  const write = (message: string): void => { output.write(message.endsWith('\n') ? message : `${message}\n`); };
  return {
    ask: async (title, fallback = '') => await value(`${title}${fallback ? ` [${fallback}]` : ''}: `) || fallback,
    select: async (title, choices, defaultIndex = 0) => {
      if (!choices.length) throw new Error('Não há opções disponíveis.');
      const initial = Math.max(0, Math.min(defaultIndex, choices.length - 1));
      write(`\n${title}\n${choices.map((choice, index) => `  ${index + 1}) ${choice.label}${index === initial ? ' (padrão)' : ''}${choice.hint ? ` — ${choice.hint}` : ''}`).join('\n')}`);
      for (;;) {
        const answer = (await value(`Escolha [${initial + 1}]: `)).trim();
        if (!answer) return initial;
        if (/^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= choices.length) return Number(answer) - 1;
        write(`Responda com um número entre 1 e ${choices.length}. Escolha a origem antes de colar o pedido.`);
      }
    },
    multiline: async (title, initial = '') => {
      write(`\n${title}\nCole ou digite várias linhas. Termine com uma linha contendo só um ponto, ou Ctrl-D.`);
      const collected = initial ? initial.split('\n') : [];
      for (;;) {
        output.write('> ');
        const line = await next();
        if (!terminal) output.write('\n');
        if (line === undefined || line.trim() === '.') return collected.join('\n').trim();
        collected.push(line);
      }
    },
    secret: async title => {
      if (!terminal) {
        write('Credenciais não são lidas de pipes. Configure a variável de ambiente da API ou abra um terminal interativo.');
        throw new WizardCancelled();
      }
      muted = true;
      try { return await value(`${title}: `); }
      finally { muted = false; output.write('\n'); }
    },
    write,
    close: () => {
      if (closed) return;
      closed = true; reader.off('SIGINT', cancel); reader.close(); relay.end();
      process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
      if (terminal) input.setRawMode(wasRaw);
    },
  };
}
export function createTerminalWizardIO(options: TerminalOptions = {}): WizardIO {
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  const environment = options.environment ?? process.env;
  if (environment.CAPIVARA_LINE_INPUT === '1' || !input.isTTY || !output.isTTY) return createLineWizardIO(options);
  const decoder = new KeyDecoder(); const utf8 = new StringDecoder('utf8');
  let history: readonly WizardHistory[] = []; let notes: string[] = [];
  let prompt: ScreenPrompt | undefined;
  let active = false; let closed = false;
  const wasRaw = input.isRaw; const wasPaused = input.isPaused(); const wasFlowing = input.readableFlowing;
  let escapeTimer: NodeJS.Timeout | undefined;
  let consume: ((key: Key) => void) | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  const render = (): void => {
    if (!prompt || closed) return;
    const color = environment.NO_COLOR === undefined && environment.TERM !== 'dumb';
    output.write(`\u001b[H\u001b[2J${renderWizardScreen({ version: VERSION, width: output.columns || 80, height: output.rows || 24, color, trueColor: /truecolor|24bit/i.test(environment.COLORTERM ?? '') && environment.CAPIVARA_ASCII_MASCOT !== '1', history, notes, prompt })}`);
  };
  const dispatch = (keys: Key[]): void => { for (const key of keys) { if (!consume) break; consume(key); } };
  const onData = (chunk: Buffer | string): void => {
    clearTimeout(escapeTimer);
    dispatch(decoder.feed(typeof chunk === 'string' ? chunk : utf8.write(chunk)));
    escapeTimer = setTimeout(() => dispatch(decoder.flushEscape()), 30);
  };
  const onEnd = (): void => rejectPending?.(new WizardCancelled());
  const onSignal = (): void => { rejectPending?.(new WizardCancelled()); close(); };
  const start = (): void => {
    if (closed) throw new WizardCancelled();
    if (active) return;
    if (!input.isTTY || !output.isTTY) throw new Error('O wizard exige um terminal interativo. Use capivara --help para os comandos.');
    active = true;
    input.setRawMode(true);
    input.on('data', onData); input.on('end', onEnd); input.on('error', onEnd);
    output.on('resize', render);
    process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
    output.write(`\u001b[?1049h\u001b[?25l${BRACKETED_PASTE_ON}`);
    input.resume();
  };
  const close = (): void => {
    if (closed) return;
    closed = true; clearTimeout(escapeTimer);
    if (!active) return;
    input.off('data', onData); input.off('end', onEnd); input.off('error', onEnd);
    output.off('resize', render);
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    try { input.setRawMode(wasRaw); } finally {
      if (wasPaused || wasFlowing !== true) input.pause();
      output.write(`${BRACKETED_PASTE_OFF}\u001b[?25h\u001b[0m\u001b[?1049l`);
    }
  };
  const read = <T>(spec: ScreenPrompt, step: (key: Key) => { value?: T; done: boolean }): Promise<T> => {
    start(); prompt = spec; render();
    return new Promise<T>((resolve, reject) => {
      const fail = (error: Error): void => { consume = undefined; rejectPending = undefined; reject(error); };
      rejectPending = fail;
      consume = key => {
        if (key.type === 'ctrl-c') { fail(new WizardCancelled()); return; }
        if (key.type === 'escape') { fail(new WizardBack()); return; }
        if (key.type === 'ctrl-d' && !spec.multiline && !spec.value) { fail(new WizardCancelled()); return; }
        const result = step(key);
        if (result.done) { consume = undefined; rejectPending = undefined; notes = []; resolve(result.value as T); }
        else render();
      };
    });
  };
  const field = async (title: string, fallback = '', multiline = false, secret = false, initial = ''): Promise<string> => {
    const spec: ScreenPrompt = { title, value: initial, fallback, multiline, secret };
    return read<string>(spec, key => {
      const result = reduceText(spec.value ?? '', key, multiline); spec.value = result.value;
      return result.submitted === undefined ? { done: false } : { done: true, value: result.submitted || fallback };
    });
  };
  return {
    ask: (title, fallback) => field(title, fallback),
    secret: title => field(title, '', false, true),
    multiline: (title, initial) => field(title, '', true, false, initial),
    select: async (title: string, choices: readonly Choice[], defaultIndex = 0): Promise<number> => {
      if (!choices.length) throw new Error('Não há opções disponíveis.');
      let state: SelectState = { cursor: Math.max(0, Math.min(defaultIndex, choices.length - 1)), digits: '', message: '' };
      const spec: ScreenPrompt = { title, choices, selection: state };
      return read<number>(spec, key => {
        const result = reduceSelect(state, key, choices.length); state = result.state; spec.selection = state;
        return result.chosen === undefined ? { done: false } : { done: true, value: result.chosen };
      });
    },
    write: message => { notes.push(message); notes = notes.slice(-4); render(); },
    setHistory: value => { history = value; }, close,
  };
}
