import { expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import type { ReadStream, WriteStream } from 'node:tty';
import { createTerminalWizardIO, filterModels, runWizard, WizardBack, WizardCancelled } from '../../src/wizard/index.js';
import type { Choice, WizardDataCenter, WizardIO } from '../../src/wizard/index.js';
import { KeyDecoder, reduceSelect, reduceText } from '../../src/wizard/keys.js';
import { plain, renderWizardScreen, widthOf } from '../../src/wizard/screen.js';

type Action = { kind: 'ask' | 'select' | 'multiline' | 'secret'; value: string | number | Error };
function scripted(actions: Action[]): WizardIO & { close: Mock<() => void>; write: Mock<(message: string) => void> } {
  const take = async (kind: Action['kind']): Promise<string | number> => {
    const action = actions.shift(); expect(action?.kind).toBe(kind);
    if (action!.value instanceof Error) throw action!.value;
    return action!.value;
  };
  return { ask: async () => await take('ask') as string, select: async () => await take('select') as number, multiline: async () => await take('multiline') as string, secret: async () => await take('secret') as string, write: vi.fn<(message: string) => void>(), close: vi.fn<() => void>() };
}
const ask = (value = ''): Action => ({ kind: 'ask', value });
const select = (value = 0): Action => ({ kind: 'select', value });
const multiline = (value = 'Crie uma CLI de saudação.'): Action => ({ kind: 'multiline', value });
const tail = [select(), ask(), select(), select()];

it('monta init a partir do pedido inteiro, confirma execução e ensina o mesmo argv', async () => {
  const io = scripted([ask(), select(), select(), multiline('Primeira linha\nSegunda linha'), ...tail]);
  const result = await runWizard({ io, cwd: '/tmp/projeto' });
  expect(result).toMatchObject({ stage: 'init', workspace: '/tmp/projeto', request: 'Primeira linha\nSegunda linha', config: { provider: 'codex' }, reviewer: { provider: 'codex' }, execute: true });
  expect(result?.argv).toEqual(['init', 'Primeira linha\nSegunda linha', '--project', '/tmp/projeto', '--provider', 'codex', '--model-default', '--effort-default', '--reviewer-provider', 'codex', '--reviewer-model-default', '--reviewer-effort-default']);
  expect(result?.command).toContain("'Primeira linha\nSegunda linha'");
  expect(io.close).toHaveBeenCalledOnce();
});

it('Esc volta à pergunta anterior e conserva as respostas já dadas', async () => {
  const io = scripted([ask(), select(), select(), multiline(), select(), { kind: 'ask', value: new WizardBack() }, select(1), ask(), select(), select(1)]);
  const result = await runWizard({ io, cwd: '/tmp/projeto' });
  expect(result?.config.provider).toBe('claude');
  expect(result?.request).toBe('Crie uma CLI de saudação.');
  expect(result?.execute).toBe(false);
});

it.each([new WizardBack(), new WizardCancelled()])('cancela na primeira pergunta com limpeza de IO', async error => {
  const io = scripted([{ kind: 'ask', value: error }]);
  expect(await runWizard({ io })).toBeNull();
  expect(io.close).toHaveBeenCalledOnce();
});

it('aceita plan de projeto com pedido registrado sem pedir outro pedido', async () => {
  const io = scripted([ask(), select(1), ...tail]);
  expect(await runWizard({ io, requestRecorded: async () => true })).toMatchObject({ stage: 'plan', execute: true });
});

it('confere o arquivo relativo à pasta do projeto e permite corrigir o caminho', async () => {
  const io = scripted([ask('/tmp/aplicacao'), select(), select(1), ask('ausente.md'), ask('pedido.md'), ...tail]);
  const readRequestFile = vi.fn().mockRejectedValueOnce(new Error('Arquivo ausente')).mockResolvedValueOnce('Pedido do arquivo');
  const result = await runWizard({ io, readRequestFile });
  expect(readRequestFile).toHaveBeenLastCalledWith('/tmp/aplicacao/pedido.md');
  expect(result?.request).toBe('Pedido do arquivo');
  expect(result?.argv.slice(0, 3)).toEqual(['init', '--file', '/tmp/aplicacao/pedido.md']);
});

function dataCenter(): WizardDataCenter {
  return {
    listProjects: vi.fn().mockResolvedValue([{ slug: 'sem-pedido', hasRequest: false }, { slug: 'loja', hasRequest: true, documents: 3 }]),
    loadProject: vi.fn().mockResolvedValue({ request: 'Pedido da loja com documentos' }),
    listPrompts: vi.fn().mockResolvedValue([{ name: 'crud', title: 'CRUD completo', description: 'Cadastros' }]),
    readPrompt: vi.fn().mockResolvedValue('Crie o cadastro de produtos'),
  };
}
it('lista e carrega projeto da base, preservando a origem no comando', async () => {
  const dc = dataCenter();
  const io = scripted([ask(), select(), select(2), ask('https://base.test/mcp'), select(), ...tail]);
  const result = await runWizard({ io, dataCenter: dc });
  expect(dc.loadProject).toHaveBeenCalledWith('https://base.test/mcp', 'loja');
  expect(result).toMatchObject({ request: 'Pedido da loja com documentos', dataCenter: { url: 'https://base.test/mcp', project: 'loja' } });
  expect(result?.argv.slice(0, 5)).toEqual(['init', '--mcp', 'https://base.test/mcp', '--mcp-project', 'loja']);
});
it('lista prompts pelos nomes e lê o texto do prompt selecionado', async () => {
  const dc = dataCenter();
  const io = scripted([ask(), select(), select(3), ask('https://base.test/mcp'), select(), ...tail]);
  const result = await runWizard({ io, dataCenter: dc });
  expect(dc.readPrompt).toHaveBeenCalledWith('https://base.test/mcp', 'crud');
  expect(result).toMatchObject({ request: 'Crie o cadastro de produtos', dataCenter: { prompt: 'crud' } });
});
it('permite sair de uma base indisponível e escrever o pedido', async () => {
  const dc = dataCenter(); dc.listProjects = vi.fn().mockRejectedValue(new Error('Base indisponível'));
  const io = scripted([ask(), select(), select(2), ask('https://fora.test/mcp'), select(1), select(), multiline(), ...tail]);
  expect(await runWizard({ io, dataCenter: dc })).toMatchObject({ request: 'Crie uma CLI de saudação.' });
});
it('filtra o catálogo, seleciona raciocínio suportado e configura um revisor próprio', async () => {
  const models = Array.from({ length: 24 }, (_, i) => `modelo-${i + 1}`);
  const io = scripted([ask(), select(), select(), multiline(), select(), select(24), ask('modelo-22'), select(), select(2), select(1), select(1), select(), select(1), select()]);
  const result = await runWizard({ io, listModels: async provider => provider === 'codex' ? models : ['sonnet'], listEfforts: async () => ['high', 'xhigh'] });
  expect(result?.config).toMatchObject({ provider: 'codex', model: 'modelo-22', effort: 'xhigh' });
  expect(result?.reviewer).toMatchObject({ provider: 'claude', model: 'sonnet', effort: 'high' });
  expect(result?.argv).toContain('--reviewer-effort');
  expect(filterModels(['gemini', 'MiniMax', 'x-mini', 'admini'], 'mini')).toEqual(['MiniMax', 'x-mini', 'gemini', 'admini']);
});
it('cadastra API antes do catálogo e nunca coloca credenciais no comando', async () => {
  const io = scripted([ask(), select(), select(), multiline(), select(3), { kind: 'secret', value: 'sk-segredo-teste' }, select(), select(), select()]);
  const calls: string[] = [];
  const result = await runWizard({ io, configureApi: async (provider, apiIO) => { calls.push('configure'); return { provider, apiKey: await apiIO.secret('Chave da API') }; }, listModels: async () => { calls.push('list'); return ['api-model']; }, listEfforts: async () => [] });
  expect(calls).toEqual(['configure', 'list']);
  expect(result?.config.apiKey).toBe('sk-segredo-teste');
  expect(result?.command).not.toContain('sk-segredo');
});
it('a lista só confirma com Enter e recusa colagem como escolha', () => {
  let state = { cursor: 0, digits: '', message: '' };
  const moved = reduceSelect(state, { type: 'char', text: '2' }, 3);
  expect(moved.chosen).toBeUndefined(); state = moved.state;
  expect(state.cursor).toBe(1);
  expect(reduceSelect(state, { type: 'char', text: 'j' }, 3).state.cursor).toBe(2);
  expect(reduceSelect(state, { type: 'paste', text: '3\ntexto' }, 3).state.message).toContain('cole o pedido');
  expect(reduceSelect(state, { type: 'enter' }, 3).chosen).toBe(1);
});
it('retém paste fragmentado e não transforma suas linhas em confirmação', () => {
  const decoder = new KeyDecoder();
  expect(decoder.feed('\u001b')).toEqual([]);
  expect(decoder.feed('[200~linha 1\r\nlinha 2\u001b[20')).toEqual([]);
  const keys = decoder.feed('1~'); expect(keys).toEqual([{ type: 'paste', text: 'linha 1\nlinha 2' }]);
  const pasted = reduceText('', keys[0]!, true);
  expect(pasted).toEqual({ value: 'linha 1\nlinha 2' });
  expect(reduceText(`${pasted.value}\n.`, { type: 'enter' }, true).submitted).toBe('linha 1\nlinha 2');
  expect(reduceText('', keys[0]!)).toEqual({ value: 'linha 1 linha 2' });
  expect(decoder.feed('\u001b[')).toEqual([]); expect(decoder.feed('A')).toEqual([{ type: 'up' }]);
});
it.each([[36, 12], [80, 24], [120, 40]])('o painel cabe em %sx%s, mantém identidade e oculta segredos', (width, height) => {
  const output = renderWizardScreen({ version: '0.9.0', width, height, color: false, history: [{ question: 'Pasta', answer: '/tmp/projeto' }], notes: [], prompt: { title: 'Chave da API', value: 'sk-segredo', secret: true } });
  expect(output).not.toContain('sk-segredo'); expect(output).toContain('RESPOSTA'); expect(output).toMatch(/CAPIVARA|█/);
  expect(output.split('\n').length).toBeLessThan(height);
  expect(Math.max(...output.split('\n').map(widthOf))).toBeLessThanOrEqual(width);
});

class FakeTerminal extends EventEmitter {
  isTTY = true; isRaw = false; columns = 80; rows = 24; output = ''; paused = true;
  readableFlowing: boolean | null = null;
  isPaused(): boolean { return this.paused; }
  setRawMode(value: boolean): this { this.isRaw = value; return this; }
  pause(): this { this.paused = true; this.readableFlowing = false; return this; }
  resume(): this { this.paused = false; this.readableFlowing = true; return this; }
  write(value: string): boolean { this.output += value; return true; }
}
it('o terminal restaura raw, cursor, paste e listeners depois de Ctrl-C', async () => {
  const input = new FakeTerminal(); const output = new FakeTerminal();
  input.paused = false; // Node stdin can be initially neither paused nor flowing.
  const io = createTerminalWizardIO({ input: input as unknown as ReadStream, output: output as unknown as WriteStream });
  const result = runWizard({ io, cwd: resolve('/tmp/projeto') });
  expect(input.isRaw).toBe(true);
  input.emit('data', Buffer.from('\u0003'));
  expect(await result).toBeNull();
  expect(input.isRaw).toBe(false); expect(input.paused).toBe(true);
  expect(input.listenerCount('data')).toBe(0); expect(output.listenerCount('resize')).toBe(0);
  expect(output.output).toContain('\u001b[?2004l'); expect(output.output).toContain('\u001b[?25h'); expect(output.output).toContain('\u001b[?1049l');
  expect(plain(output.output)).toContain('Pasta do projeto');
});

it('o wizard lê um pipe inteiro em fila, corrige a escolha inválida e preserva o pedido multiline', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  let transcript = ''; output.on('data', (chunk: Buffer) => { transcript += chunk.toString(); });
  const io = createTerminalWizardIO({ input: input as unknown as ReadStream, output: output as unknown as WriteStream });
  const running = runWizard({ io, cwd: '/tmp/projeto' });
  input.end(['', 'pedido colado no menu errado', '1', '1', 'Crie uma aplicação.', 'Preserve esta segunda linha.', '.', '1', '', '1', '2', ''].join('\n'));
  const result = await running;
  expect(result).toMatchObject({ stage: 'init', request: 'Crie uma aplicação.\nPreserve esta segunda linha.', config: { provider: 'codex' }, execute: false });
  expect(transcript).toContain('Responda com um número entre 1 e 3');
  expect(transcript).toContain('Executar agora?'); expect(transcript).not.toContain('\u001b[');
  expect(input.listenerCount('data')).toBe(0);
});

it('EOF entrega o texto acumulado no campo multiline e cancela a pergunta seguinte', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  const io = createTerminalWizardIO({ input: input as unknown as ReadStream, output: output as unknown as WriteStream });
  input.end('Primeira linha\nSegunda linha');
  try {
    expect(await io.multiline('Pedido')).toBe('Primeira linha\nSegunda linha');
    await expect(io.ask('Outra resposta')).rejects.toBeInstanceOf(WizardCancelled);
  } finally { io.close?.(); }
});

it('recusa ler segredos de pipe sem mostrar o valor recebido', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  let transcript = ''; output.on('data', (chunk: Buffer) => { transcript += chunk.toString(); });
  const io = createTerminalWizardIO({ input: input as unknown as ReadStream, output: output as unknown as WriteStream });
  input.end('sk-nao-mostrar\n');
  try {
    await expect(io.secret('Chave')).rejects.toBeInstanceOf(WizardCancelled);
    expect(transcript).toContain('variável de ambiente'); expect(transcript).not.toContain('sk-nao-mostrar');
  } finally { io.close?.(); }
});

it('CAPIVARA_LINE_INPUT usa leitura por linha em TTY e oculta a credencial digitada', async () => {
  const input = new FakeTerminal(); const output = new FakeTerminal();
  const io = createTerminalWizardIO({ input: input as unknown as ReadStream, output: output as unknown as WriteStream, environment: { CAPIVARA_LINE_INPUT: '1' } });
  try {
    const pending = io.secret('Chave da API');
    input.emit('data', Buffer.from('sk-segredo-nao-ecoar\r'));
    expect(await pending).toBe('sk-segredo-nao-ecoar');
    expect(output.output).toContain('Chave da API'); expect(output.output).not.toContain('sk-segredo-nao-ecoar');
    expect(output.output).not.toContain('\u001b[?1049h');
  } finally { io.close?.(); }
  expect(input.isRaw).toBe(false);
});

it('0 em modelo digitado volta à escolha do provider', async () => {
  const io = scripted([ask(), select(), select(), multiline(), select(), ask('0'), select(1), ask(), select(), select(1)]);
  expect(await runWizard({ io })).toMatchObject({ config: { provider: 'claude' }, execute: false });
});
