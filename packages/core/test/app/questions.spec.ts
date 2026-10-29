import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdin } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { ProjectStore } from '../../src/app/store.js';
import { questionChannel } from '../../src/app/questions.js';
import type { Question } from '../../src/domain/types.js';

vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }));
const directories: string[] = [], stores: ProjectStore[] = [];
const originalTTY = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (originalTTY) Object.defineProperty(stdin, 'isTTY', originalTTY);
  else Reflect.deleteProperty(stdin, 'isTTY');
  vi.resetAllMocks();
});
function fixture(tty: boolean): ProjectStore {
  const directory = mkdtempSync(join(tmpdir(), 'capivara-question-channel-'));
  directories.push(directory);
  const store = new ProjectStore(directory); stores.push(store);
  Object.defineProperty(stdin, 'isTTY', { value: tty, configurable: true });
  return store;
}
const question: Question = { id: 'retention', fact: 'Retenção', question: 'Por quanto tempo preservar registros?', reason: 'A duração não foi definida.', impact: 'Define a retenção dos dados.', category: 'data', modes: ['cli'], options: ['30 dias', 'Sem prazo'], blocks: [] };

it('falls back to the terminal when presentation closes without cancelling the decision', async () => {
  const store = fixture(true), close = vi.fn(), read = vi.fn().mockResolvedValue('2');
  vi.mocked(createInterface).mockReturnValue({ question: read, close } as unknown as ReturnType<typeof createInterface>);
  const interact = vi.fn().mockResolvedValue(null);
  expect(await questionChannel(store, new AbortController().signal, () => {}, interact)(question)).toBe('Sem prazo');
  expect(interact).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(store.getAnswer(question.id)).toBe('Sem prazo');
  expect(store.read()).toMatchObject({ status: 'working', pendingQuestion: null });
});

it('explains the external answer command and preserves the gap when no terminal is available', async () => {
  const store = fixture(false), announce = vi.fn();
  expect(await questionChannel(store, new AbortController().signal, announce, async () => null)(question)).toBeNull();
  expect(createInterface).not.toHaveBeenCalled(); expect(store.getAnswer(question.id)).toBeUndefined();
  expect(store.read()).toMatchObject({ status: 'waiting', pendingQuestion: question });
  expect(announce.mock.calls.at(-1)?.[0]).toContain(`capivara answer ${question.id}`);
  store.answer(question.id, '90 dias');
  const interact = vi.fn();
  expect(await questionChannel(store, new AbortController().signal, announce, interact)(question)).toBe('90 dias');
  expect(interact).not.toHaveBeenCalled(); expect(store.read().pendingQuestion).toBeNull();
});

it.each([null, '30 dias'])('does not fall back or record input after explicit cancellation (%s)', async answer => {
  const store = fixture(true), controller = new AbortController();
  const interact = vi.fn(async () => { controller.abort(); return answer; });
  expect(await questionChannel(store, controller.signal, () => {}, interact)(question)).toBeNull();
  expect(createInterface).not.toHaveBeenCalled(); expect(store.getAnswer(question.id)).toBeUndefined();
  expect(store.read().pendingQuestion).toEqual(question);
});

it('does not open a presentation channel after an already requested cancellation', async () => {
  const store = fixture(true), controller = new AbortController(); controller.abort();
  const interact = vi.fn();
  expect(await questionChannel(store, controller.signal, () => {}, interact)(question)).toBeNull();
  expect(interact).not.toHaveBeenCalled(); expect(createInterface).not.toHaveBeenCalled();
  expect(store.read().pendingQuestion).toEqual(question);
});

it('reuses an answer saved while presentation closes instead of asking it again', async () => {
  const store = fixture(true);
  expect(await questionChannel(store, new AbortController().signal, () => {}, async () => { store.answer(question.id, '180 dias'); return null; })(question)).toBe('180 dias');
  expect(createInterface).not.toHaveBeenCalled();
  expect(store.read()).toMatchObject({ status: 'working', pendingQuestion: null });
});
