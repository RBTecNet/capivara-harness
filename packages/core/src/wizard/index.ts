import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentConfig } from '../runtime/types.js';
import { createTerminalWizardIO } from './terminal.js';
import { WizardBack, WizardCancelled } from './types.js';
import type { Choice, WizardDeps, WizardHistory, WizardIO, WizardResult } from './types.js';
export * from './types.js';
export { createTerminalWizardIO, createLineWizardIO } from './terminal.js';
export { renderWizardScreen } from './screen.js';

const DEFAULT_PROVIDERS: NonNullable<WizardDeps['providers']> = ['codex', 'claude', 'opencode', 'openai', 'anthropic', 'openrouter', 'deepseek', 'minimax', 'custom'].map(id => ({ id, hint: ['codex', 'claude', 'opencode'].includes(id) ? 'usa a CLI instalada nesta máquina' : 'API direta; exige credencial' }));
const CLI = new Set(['codex', 'claude', 'opencode']);
const quote = (value: string): string => /^[A-Za-z0-9._:/=-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
export function wizardArgv(result: Omit<WizardResult, 'argv' | 'command' | 'execute'>): string[] {
  const argv: string[] = [result.stage];
  if (result.requestFile) argv.push('--file', result.requestFile);
  else if (result.dataCenter?.project) argv.push('--mcp', result.dataCenter.url, '--mcp-project', result.dataCenter.project);
  else if (result.dataCenter?.prompt) argv.push('--mcp', result.dataCenter.url, '--mcp-prompt', result.dataCenter.prompt);
  else if (result.request) argv.push(result.request);
  argv.push('--project', result.workspace, '--provider', result.config.provider);
  if (result.config.model) argv.push('--model', result.config.model); else argv.push('--model-default');
  if (result.config.effort) argv.push('--effort', result.config.effort); else argv.push('--effort-default');
  if (result.config.baseUrl) argv.push('--base-url', result.config.baseUrl);
  if (result.config.apiKeyEnv) argv.push('--api-key-env', result.config.apiKeyEnv);
  if (result.reviewer) {
    argv.push('--reviewer-provider', result.reviewer.provider);
    if (result.reviewer.model) argv.push('--reviewer-model', result.reviewer.model); else argv.push('--reviewer-model-default');
    if (result.reviewer.effort) argv.push('--reviewer-effort', result.reviewer.effort); else argv.push('--reviewer-effort-default');
  }
  return argv;
}

/** Prefix and token matches precede arbitrary substrings without hiding valid matches. */
export function filterModels(models: readonly string[], filter: string): string[] {
  const target = filter.trim().toLowerCase();
  const rank = (model: string): number => {
    const name = model.toLowerCase();
    if (name.startsWith(target)) return 0;
    if (name.split(/[/_.-]/).some(part => part.startsWith(target))) return 1;
    return name.includes(target) ? 2 : 3;
  };
  return models.map((model, order) => ({ model, order, rank: rank(model) })).filter(item => item.rank < 3).sort((a, b) => a.rank - b.rank || a.order - b.order).map(item => item.model);
}

interface Answer { id: string; value: string | number; history: WizardHistory; }
/** Answers are replayed on Back; completed callbacks and secrets remain local to this run. */
export async function runWizard(deps: WizardDeps = {}): Promise<WizardResult | null> {
  const io = deps.io ?? createTerminalWizardIO();
  const answers: Answer[] = [];
  const configured = new Map<string, AgentConfig>();
  let cursor = 0;
  const read = async <T extends string | number>(id: string, question: string, obtain: () => Promise<T>, display: (value: T) => string = String): Promise<T> => {
    const index = cursor++;
    if (answers[index]?.id === id) return answers[index]!.value as T;
    answers.splice(index); io.setHistory?.(answers.map(answer => answer.history));
    const value = await obtain();
    answers.push({ id, value, history: { question, answer: display(value) } });
    io.setHistory?.(answers.map(answer => answer.history));
    return value;
  };
  const ask = (id: string, title: string, fallback = ''): Promise<string> => read(id, title, async () => (await io.ask(title, fallback)).trim() || fallback);
  const choose = (id: string, title: string, choices: readonly Choice[], initial = 0): Promise<number> => read(id, title, async () => {
    const value = await io.select(title, choices, initial);
    if (!Number.isInteger(value) || value < 0 || value >= choices.length) throw new Error('Opção inválida no wizard.');
    return value;
  }, value => choices[value]!.label);
  const invalidate = (): void => { answers.splice(cursor - 1); cursor--; };
  const modelFor = async (role: string, provider: string, base?: AgentConfig): Promise<string> => {
    const listed = await deps.listModels?.(provider).catch(error => { io.write(`Não consegui listar os modelos: ${error instanceof Error ? error.message : String(error)}. Informe o nome exato.`); return []; }) ?? [];
    const models = listed.map(model => typeof model === 'string' ? model : model.id);
    if (!models.length) {
      for (;;) {
        const model = await ask(`${role}.model.text`, 'Qual modelo?', base?.model ?? '');
        if (model === '0') throw new WizardBack(`${role}.provider`);
        if (model || CLI.has(provider)) return model;
        io.write('Informe o identificador do modelo para esta API.'); invalidate();
      }
    }
    let candidates = models;
    let iteration = 0;
    for (;;) {
      const id = `${role}.models.${iteration++}`;
      const extras: Choice[] = [{ label: 'filtrar modelos', hint: 'digite parte do nome; vazio restaura todos' }, { label: 'digitar outro nome' }, ...(CLI.has(provider) ? [{ label: 'usar o padrão do provider' }] : []), { label: 'voltar ao provider' }];
      const choices = [...candidates.map(model => ({ label: model, ...(typeof listed[models.indexOf(model)] === 'object' && (listed[models.indexOf(model)] as { name?: string }).name ? { hint: (listed[models.indexOf(model)] as { name: string }).name } : {}) })), ...extras];
      const selected = await choose(id, `Qual modelo?${models.length > 20 ? ` — ${candidates.length} modelos; filtro no fim da lista` : ''}`, choices, Math.max(0, candidates.indexOf(base?.model ?? '')));
      if (selected < candidates.length) return candidates[selected]!;
      if (selected === candidates.length) {
        const filter = await ask(`${id}.filter`, 'Digite parte do nome para filtrar');
        candidates = filterModels(models, filter);
        if (!candidates.length) { io.write(`Nenhum modelo com "${filter}"; mostrando todos.`); candidates = models; }
      } else if (selected === candidates.length + 1) {
        for (;;) {
          const name = await ask(`${id}.name`, 'Nome exato do modelo', base?.model ?? '');
          if (name || CLI.has(provider)) return name;
          io.write('Informe o identificador do modelo para esta API.'); invalidate();
        }
      } else if (CLI.has(provider) && selected === candidates.length + 2) return '';
      else throw new WizardBack(`${role}.provider`);
    }
  };
  const agent = async (role: string, base?: AgentConfig): Promise<AgentConfig> => {
    const providers = deps.providers ?? DEFAULT_PROVIDERS;
    const index = await choose(`${role}.provider`, role === 'agent' ? 'Qual provider usar por padrão?' : 'Qual provider para o revisor?', providers.map(provider => ({ label: provider.label ?? provider.id, ...(provider.hint ? { hint: provider.hint } : {}) })), Math.max(0, providers.findIndex(provider => provider.id === base?.provider)));
    const provider = providers[index]!.id;
    let config: AgentConfig = { ...(base?.provider === provider ? base : {}), provider };
    if (!CLI.has(provider) && deps.configureApi) {
      let setup = configured.get(provider);
      if (!setup) {
        const value = await deps.configureApi(provider, io);
        if (value === false) throw new WizardBack();
        setup = typeof value === 'object' ? value : config;
        configured.set(provider, setup);
      }
      config = { ...config, ...setup, provider };
    }
    const model = await modelFor(role, provider, config);
    if (model) config.model = model; else delete config.model;
    const efforts = model ? await deps.listEfforts?.(provider, model).catch(() => null) : [];
    if (efforts === undefined || efforts === null || efforts.length) {
      const choices = [{ label: 'padrão do modelo' }, ...(efforts ?? ['low', 'medium', 'high']).map(label => ({ label }))];
      const selected = await choose(`${role}.effort`, 'Nível de raciocínio?', choices, Math.max(0, choices.findIndex(choice => choice.label === config.effort)));
      if (selected) config.effort = choices[selected]!.label; else delete config.effort;
    } else delete config.effort;
    return config;
  };
  const request = async (workspace: string): Promise<Pick<WizardResult, 'request' | 'requestFile' | 'dataCenter'>> => {
    const sources = [{ id: 'text', label: 'escrever agora', hint: 'cole ou digite; várias linhas' }, { id: 'file', label: 'ler de um arquivo', hint: 'um .md ou .txt já escrito' }, ...(deps.dataCenter ? [{ id: 'project', label: 'projeto da base documental (MCP)', hint: 'o pedido e as memórias já cadastrados' }, { id: 'prompt', label: 'prompt guardado na base', hint: 'escolha pelo nome entre os prompts salvos' }] : [])];
    const source = sources[await choose('request.source', 'De onde vem o pedido?', sources)]!.id;
    if (source === 'text') {
      for (;;) {
        const text = await read('request.text', 'O que você quer construir?', () => io.multiline('O que você quer construir?'));
        if (text.trim()) return { request: text.trim() };
        io.write('Escreva o pedido antes de continuar.'); invalidate();
      }
    }
    if (source === 'file') {
      for (;;) {
        const path = await ask('request.file', 'Caminho do arquivo');
        try {
          if (!path) throw new Error('Informe o caminho do arquivo.');
          const text = await (deps.readRequestFile ?? (file => readFile(file, 'utf8')))(resolve(workspace, path));
          if (!text.trim()) throw new Error('O arquivo está vazio.');
          return { request: text, requestFile: resolve(workspace, path) };
        } catch (error) { io.write(error instanceof Error ? error.message : String(error)); invalidate(); }
      }
    }
    const dc = deps.dataCenter!;
    for (let attempt = 0; ; attempt++) {
      const id = `request.dc.${attempt}`;
      const url = await ask(`${id}.url`, 'Endereço da base', deps.defaults?.dataCenterUrl ?? process.env.CAPIVARA_MCP_URL ?? process.env.DOC_CENTER_URL ?? 'http://localhost:7777/mcp');
      try {
        io.write('conectando…');
        if (source === 'project') {
          const projects = (await dc.listProjects(url)).filter(project => project.hasRequest !== false);
          if (!projects.length) throw new Error('Esta base não tem projeto com pedido escrito.');
          const selected = projects[await choose(`${id}.project`, 'Qual projeto da base?', projects.map(project => ({ label: project.title ?? project.slug, hint: `${project.slug} · ${project.documents ?? 0} documento(s) selecionado(s)` })))]!;
          const loaded = await dc.loadProject(url, selected.slug);
          const text = typeof loaded === 'string' ? loaded : loaded.request;
          if (!text.trim()) throw new Error('O projeto está sem pedido escrito.');
          return { request: text, dataCenter: { url, project: selected.slug } };
        }
        const prompts = await dc.listPrompts(url);
        if (!prompts.length) throw new Error('Esta base não tem prompt guardado.');
        const selected = prompts[await choose(`${id}.prompt`, 'Qual prompt?', prompts.map(prompt => ({ label: prompt.title || prompt.name, hint: [prompt.description, prompt.name].filter(Boolean).join(' · ') })))]!;
        const text = await dc.readPrompt(url, selected.name);
        if (!text.trim()) throw new Error('Esse prompt está vazio na base.');
        return { request: text, dataCenter: { url, prompt: selected.name } };
      } catch (error) {
        if (error instanceof WizardBack || error instanceof WizardCancelled) throw error;
        io.write(error instanceof Error ? error.message : String(error));
        if (await choose(`${id}.retry`, 'E agora?', [{ label: 'tentar outro endereço' }, { label: 'voltar à origem do pedido' }])) {
          throw new WizardBack('request.source');
        }
      }
    }
  };
  try {
    for (;;) {
      cursor = 0;
      try {
        const workspace = resolve(deps.cwd ?? process.cwd(), await ask('workspace', 'Pasta do projeto', deps.defaults?.workspace ?? deps.cwd ?? process.cwd()));
        const stages = ['init', 'plan', 'build'] as const;
        const selected = await choose('stage', 'O que você quer fazer?', [{ label: 'init', hint: 'entender o pedido e resolver as lacunas' }, { label: 'plan', hint: 'preparar dependências e fragmentos executáveis' }, { label: 'build', hint: 'construir, conferir e recuperar' }], Math.max(0, stages.indexOf(await deps.defaultStage?.(workspace) ?? 'init')));
        const stage = stages[selected]!;
        const source = stage === 'init' || deps.requestRecorded && !await deps.requestRecorded(workspace) ? await request(workspace) : {};
        const config = await agent('agent', deps.defaults?.agent);
        const separate = await choose('reviewer.separate', 'Ajustar o revisor separadamente?', [{ label: 'não', hint: 'usar o mesmo provider, modelo e raciocínio' }, { label: 'sim', hint: 'escolher outro agente para revisar o trabalho' }]);
        const reviewer = separate ? await agent('reviewer', deps.defaults?.reviewer ?? config) : { ...config };
        const result = { stage, workspace, ...source, config, reviewer };
        const argv = wizardArgv(result);
        const command = ['capivara', ...argv].map(quote).join(' ');
        io.write(`Comando equivalente:\n${command}`);
        const execute = await choose('execute', 'Executar agora?', [{ label: 'sim' }, { label: 'não', hint: 'mostrar o comando para executar depois' }]) === 0;
        return { ...result, execute, argv, command };
      } catch (error) {
        if (!(error instanceof WizardBack)) throw error;
        if (!answers.length) return null;
        const target = error.target === undefined ? -1 : answers.findIndex(answer => answer.id === error.target);
        if (target < 0) answers.pop(); else answers.splice(target);
      }
    }
  } catch (error) {
    if (error instanceof WizardCancelled) return null;
    throw error;
  } finally { io.close?.(); }
}
