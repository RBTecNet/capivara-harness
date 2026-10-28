import { EventEmitter } from 'node:events';
import type { ReadStream, WriteStream } from 'node:tty';
import { afterEach, expect, it, vi } from 'vitest';
import type { Question } from '../../src/domain/types.js';
import { DashboardTerminal } from '../../src/dashboard/terminal.js';
import { getPanelScrollLimit } from '../../src/dashboard/screen.js';

class FakeTTY extends EventEmitter {
  isTTY = true;
  isRaw = false;
  readableFlowing: boolean | null = null;
  paused = false;
  columns = 80;
  rows = 24;
  frames: string[] = [];
  failOnWrite = 0;
  setRawMode(value: boolean): this { this.isRaw = value; return this; }
  pause(): this { this.paused = true; this.readableFlowing = false; return this; }
  resume(): this { this.paused = false; this.readableFlowing = true; return this; }
  write(value: string): boolean {
    this.frames.push(value);
    if (this.frames.length === this.failOnWrite) throw new Error('display desconectado');
    return true;
  }
  send(value: string | Buffer): void { this.emit('data', typeof value === 'string' ? Buffer.from(value) : value); }
}
const pair = (): { input: FakeTTY; output: FakeTTY; streams: { input: ReadStream; output: WriteStream; environment: NodeJS.ProcessEnv } } => {
  const input = new FakeTTY(), output = new FakeTTY();
  return { input, output, streams: { input: input as unknown as ReadStream, output: output as unknown as WriteStream, environment: { NO_COLOR: '1' } } };
};
const question: Question = { id: 'format', fact: 'Formato', question: 'Qual formato de exportação?', reason: 'Integração', impact: 'Arquivos exportados', category: 'data', modes: ['cli'], options: ['JSON', 'CSV'], blocks: ['export'] };

afterEach(() => { vi.useRealTimers(); });

it('rola mais de cem linhas, restaura a posição ao fechar overlay e oculta sem cancelar nem deixar input ativo', () => {
  vi.useFakeTimers();
  const { input, output, streams } = pair();
  const cancel = vi.fn(), onClose = vi.fn();
  const terminal = new DashboardTerminal({ ...streams, cancel, onClose });
  try {
    expect(input.readableFlowing).toBeNull();
    expect(terminal.start()).toBe(true);
    expect(output.frames.at(-1)).not.toContain('a responder');
    terminal.observe({ type: 'output', message: Array.from({ length: 160 }, (_, index) => `Registro ${index}`).join('\n') });
    input.send('6');
    expect(output.frames.at(-1)).toContain('Registro 159');
    input.send('\u001b[5~');
    const compactOffset = terminal.viewState.scrollByPanel.log!;
    expect(compactOffset).toBeGreaterThan(100);
    expect(terminal.viewState.followPanels?.log).toBe(false);
    input.send('\r');
    expect(terminal.viewState.expandedPanel).toBe('log');
    expect(terminal.viewState.scrollByPanel.log).toBe(0);
    expect(terminal.viewState.followPanels?.log).toBe(false);
    expect(output.frames.at(-1)).toContain('Registro 0');
    input.send('\u001b[F\u001b[B\u001b[B');
    const limit = getPanelScrollLimit(terminal.snapshot(), terminal.viewState, 'log', output.columns, output.rows - 1);
    expect(terminal.viewState.scrollByPanel.log).toBe(limit);
    input.send('\u001b'); vi.advanceTimersByTime(31);
    expect(terminal.viewState.expandedPanel).toBeUndefined();
    expect(terminal.viewState.scrollByPanel.log).toBe(compactOffset);
    input.send('q');
    expect(terminal.active).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(input.isRaw).toBe(false);
    expect(input.paused).toBe(true);
    expect(input.readableFlowing).toBe(false);
    for (const name of ['data', 'end', 'error']) expect(input.listenerCount(name)).toBe(0);
    for (const name of ['resize', 'error']) expect(output.listenerCount(name)).toBe(0);
    expect(output.frames.at(-1)).toContain('\u001b[?1006l');
    expect(output.frames.at(-1)).toContain('\u001b[?2004l');
    expect(output.frames.at(-1)).toContain('\u001b[?25h');
    expect(output.frames.at(-1)).toContain('\u001b[?1049l');
    expect(vi.getTimerCount()).toBe(0);
  } finally { terminal.close(); }
});

it('entrevista sem perder UTF-8, adia com Esc, recupera falha ao salvar resposta e só Ctrl-C cancela', async () => {
  vi.useFakeTimers();
  const { input, streams } = pair();
  const cancel = vi.fn();
  const onAnswer = vi.fn<(id: string, answer: string) => void>().mockImplementationOnce(() => { throw new Error('banco ocupado'); });
  const terminal = new DashboardTerminal({ ...streams, initial: { pendingQuestion: question, status: 'waiting' }, cancel, onAnswer });
  try {
    terminal.start();
    const answer = terminal.ask(question);
    const bytes = Buffer.from('Olá');
    input.send(bytes.subarray(0, 3)); input.send(bytes.subarray(3)); input.send('\r');
    expect(await answer).toBe('Olá');
    expect(terminal.viewState.expandedPanel).toBeUndefined();
    const deferred = terminal.ask(question);
    input.send('q\u001b'); await vi.advanceTimersByTimeAsync(31);
    expect(await deferred).toBeNull();
    expect(terminal.active).toBe(true);
    input.send('a2\r'); await vi.advanceTimersByTimeAsync(0);
    expect(onAnswer).toHaveBeenCalledWith(question.id, 'CSV');
    expect(terminal.active).toBe(true);
    expect(terminal.snapshot().panels.find(panel => panel.id === 'log')?.lines.join('\n')).toContain('A resposta precisa ser registrada novamente: Error: banco ocupado');
    const interrupted = terminal.ask(question);
    input.send('\u0003');
    expect(await interrupted).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(terminal.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally { terminal.close(); }
});

it('fecha e limpa recursos se o display inicial ou o input falhar, mesmo com observers que lançam erro', () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const onError = vi.fn(() => { throw new Error('observer'); });
  const onClose = vi.fn(() => { throw new Error('observer'); });
  const first = pair(); first.output.failOnWrite = 2;
  const failedStart = new DashboardTerminal({ ...first.streams, cancel, onError, onClose });
  expect(failedStart.start()).toBe(false);
  expect(failedStart.active).toBe(false);
  expect(first.input.isRaw).toBe(false);
  expect(first.input.paused).toBe(true);
  expect(first.input.listenerCount('data')).toBe(0);
  expect(first.output.listenerCount('resize')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  const second = pair();
  const terminal = new DashboardTerminal({ ...second.streams, cancel, onError, onClose });
  expect(terminal.start()).toBe(true);
  expect(() => second.input.emit('error', new Error('input desconectado'))).not.toThrow();
  expect(terminal.active).toBe(false);
  expect(second.input.listenerCount('data')).toBe(0);
  expect(second.output.listenerCount('resize')).toBe(0);
  expect(onError).toHaveBeenCalledTimes(2);
  expect(cancel).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
