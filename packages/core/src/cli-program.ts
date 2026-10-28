import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { readFile, access, mkdir } from 'node:fs/promises';
import { resolve, delimiter, join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { VERSION } from './version.js';
import { readSettings, saveSettings, settingsPath } from './app/settings.js';
import { configuredAgent, bindCredential } from './app/catalog.js';
import { dataCenterEndpoint, loadProjectInput } from './app/data-source.js';
import { validateDataCenterEndpoint } from './data-center/index.js';
import { waitForRecovery } from './app/recovery.js';
import type { AgentConfig } from './runtime/types.js';

interface Flags {
  project: string; provider?: string; model?: string; effort?: string;
  reviewerProvider?: string; reviewerModel?: string; reviewerEffort?: string;
  baseUrl?: string; apiKeyEnv?: string; file?: string; systemInstall?: boolean;
  contextTokens?: string; maxOutputTokens?: string; json?: boolean;
  modelDefault?: boolean; effortDefault?: boolean; reviewerModelDefault?: boolean; reviewerEffortDefault?: boolean;
  mcp?: string; mcpProject?: string; mcpPrompt?: string; mcpTokenEnv?: string;
}
const PROVIDERS = ['codex', 'claude', 'opencode', 'openai', 'anthropic', 'gemini', 'openrouter', 'deepseek', 'minimax', 'custom'];
const hideSecrets = (key: string, value: unknown): unknown => !/Env$/.test(key) && /api.?key|token|secret|password|access.?key|authorization|cookie/i.test(key) && typeof value === 'string' ? '[credencial ocultada]' : value;

async function ask(prompt: string): Promise<string> {
  const reader = createInterface({ input: stdin, output: stdout });
  try { return (await reader.question(prompt)).trim(); } finally { reader.close(); }
}

function common(command: Command): Command {
  return command.option('--project <path>', 'Pasta da aplicação', '.')
    .option('--provider <id>', 'Transporte do agente')
    .option('--model <id>', 'Modelo configurado; CLIs podem usar seu padrão')
    .option('--model-default', 'Usar o modelo padrão da CLI, sem herdar o modelo salvo')
    .option('--effort <level>', 'Raciocínio quando suportado pelo transporte')
    .option('--effort-default', 'Usar o raciocínio padrão, sem herdar intensidade salva')
    .option('--reviewer-provider <id>', 'Transporte do parceiro de revisão')
    .option('--reviewer-model <id>', 'Modelo do parceiro; não precisa ser mais caro')
    .option('--reviewer-effort <level>', 'Raciocínio do parceiro de revisão')
    .option('--reviewer-model-default', 'Usar o modelo padrão da CLI do revisor')
    .option('--reviewer-effort-default', 'Usar o raciocínio padrão do revisor')
    .option('--base-url <url>', 'Endpoint de API compatível')
    .option('--api-key-env <name>', 'Nome da variável de credencial')
    .option('--context-tokens <n>', 'Capacidade de contexto do modelo')
    .option('--max-output-tokens <n>', 'Reserva de saída por chamada')
    .option('--system-install', 'Permitir preparação com instalação no sistema')
    .option('--file <path>', 'Arquivo contendo o pedido')
    .option('--mcp <url>', 'Endereço da base documental MCP/data-center')
    .option('--mcp-project <slug>', 'Usar pedido e documentos selecionados desse projeto')
    .option('--mcp-prompt <name>', 'Usar um prompt guardado na base documental')
    .option('--mcp-token-env <name>', 'Configurar a credencial da base a partir desta variável')
    .option('--json', 'Saída final estruturada');
}

function agentFlags(flags: Flags, base?: AgentConfig): AgentConfig | undefined {
  for (const value of [flags.contextTokens, flags.maxOutputTokens]) {
    if (value !== undefined && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) throw new Error('Os limites de tokens precisam ser inteiros positivos.');
  }
  const provider = flags.provider ?? base?.provider ?? process.env.CAPIVARA_PROVIDER;
  if (!provider) return undefined;
  const matching = base?.provider === provider ? base : undefined;
  const selected = bindCredential(matching ?? { provider }, flags.baseUrl ?? matching?.baseUrl, flags.apiKeyEnv);
  const config: AgentConfig = {
    ...selected, provider,
    ...(flags.model ? { model: flags.model } : {}),
    ...(flags.effort ? { effort: flags.effort } : {}),
    ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
    ...(flags.apiKeyEnv ? { apiKeyEnv: flags.apiKeyEnv } : {}),
    ...(flags.contextTokens ? { contextTokens: Number(flags.contextTokens) } : {}),
    ...(flags.maxOutputTokens ? { maxOutputTokens: Number(flags.maxOutputTokens) } : {}),
  };
  if (flags.modelDefault) delete config.model;
  if (flags.effortDefault) delete config.effort;
  return config;
}

function reviewerFlags(flags: Flags, editor: AgentConfig): AgentConfig {
  const provider = flags.reviewerProvider ?? editor.provider;
  const reviewer: AgentConfig = { ...(provider === editor.provider ? editor : {}), provider, ...(flags.reviewerModel ? { model: flags.reviewerModel } : {}), ...(flags.reviewerEffort ? { effort: flags.reviewerEffort } : {}) };
  if (flags.reviewerModelDefault) delete reviewer.model;
  if (flags.reviewerEffortDefault) delete reviewer.effort;
  return reviewer;
}

async function credentialsFor(config: AgentConfig, explicitApiKeyEnv?: string): Promise<AgentConfig> {
  const saved = await configuredAgent(config.provider, config.baseUrl);
  const result = bindCredential(config, config.baseUrl ?? saved.baseUrl, explicitApiKeyEnv);
  if (saved.apiKey) result.apiKey = saved.apiKey;
  if (saved.apiKeyEnv && !explicitApiKeyEnv) result.apiKeyEnv = saved.apiKeyEnv;
  return bindCredential(result, result.baseUrl, explicitApiKeyEnv);
}

async function installed(binary: string): Promise<boolean> {
  for (const path of (process.env.PATH ?? '').split(delimiter)) {
    try { await access(join(path, binary + (process.platform === 'win32' ? '.exe' : ''))); return true; } catch { /* next */ }
  }
  return false;
}

export function createProgram(): Command {
  const program = new Command().name('capivara').description('Do pedido à aplicação por fragmentos pequenos, com recuperação contínua.').version(VERSION, '-v, --version');
  const execute = async (stage: 'init' | 'plan' | 'build' | 'run', request: string | undefined, flags: Flags): Promise<void> => {
    const workspace = resolve(flags.project);
    await mkdir(workspace, { recursive: true });
    const { ProjectStore } = await import('./app/store.js');
    const inspection = new ProjectStore(workspace); const current = inspection.read(); inspection.close();
    const settings = await readSettings();
    const defaults = flags.provider ? await configuredAgent(flags.provider, flags.baseUrl) : current.config ?? settings.agent;
    let config = agentFlags(flags, defaults);
    if (!config && stdin.isTTY) {
      const present = (await Promise.all(['codex', 'claude', 'opencode'].map(async p => await installed(p) ? p : null))).filter(Boolean);
      stdout.write(`Transportes disponíveis: ${PROVIDERS.join(', ')}\nCLIs encontradas: ${present.join(', ') || 'nenhuma'}\n`);
      const provider = await ask('Qual agente usar? ');
      if (provider) config = agentFlags({ ...flags, provider });
    }
    if (!config) throw new Error('Configure um agente com --provider ou capivara config --provider <id>.');
    config = await credentialsFor(config, flags.apiKeyEnv);
    if (!PROVIDERS.includes(config.provider) && !config.baseUrl) throw new Error(`Transporte desconhecido: ${config.provider}. Use --base-url para API compatível.`);
    const text = flags.file ? await readFile(resolve(flags.file), 'utf8') : request;
    let actualRequest = text ?? current.request;
    const baseReviewer = flags.reviewerProvider || flags.reviewerModel || flags.reviewerEffort || flags.reviewerModelDefault || flags.reviewerEffortDefault ? reviewerFlags(flags, config) : current.reviewer ?? settings.reviewer;
    const reviewer = baseReviewer ? await credentialsFor(baseReviewer) : undefined;
    const controller = new AbortController();
    let executionStore: typeof inspection | undefined;
    const interrupt = (): void => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      if (flags.mcpProject && flags.mcpPrompt) throw new Error('Escolha projeto ou prompt da base; não ambos.');
      const explicitLocal = flags.file !== undefined || request !== undefined;
      const explicitRemote = flags.mcpProject !== undefined || flags.mcpPrompt !== undefined;
      if (explicitLocal && explicitRemote) throw new Error('Escolha uma única origem: texto/arquivo, projeto da base ou prompt guardado.');
      const selection = explicitRemote ? {
        url: flags.mcp ?? (await dataCenterEndpoint()).url,
        ...(flags.mcpProject ? { project: flags.mcpProject } : { prompt: flags.mcpPrompt! }),
      } : !explicitLocal && current.dataCenter ? { ...current.dataCenter.selection, ...(flags.mcp ? { url: flags.mcp } : {}) } : undefined;
      if (flags.mcp && !selection && !explicitLocal) throw new Error('Informe --mcp-project ou --mcp-prompt, ou escolha uma origem no wizard.');
      const announce = (message: string): void => { if (!flags.json) stdout.write(`${message}\n`); };
      executionStore = new ProjectStore(workspace);
      if (!executionStore.claim()) {
        announce('Outra execução trabalha neste projeto; aguardando antes de atualizar seus insumos.');
        do { await waitForRecovery(2000, controller.signal); } while (!executionStore.claim());
      }
      const input = selection ? await loadProjectInput({ workspace, selection, ...(current.dataCenter ? { cached: current.dataCenter } : {}), signal: controller.signal, announce }) : undefined;
      if (input) actualRequest = input.request;
      if (!actualRequest?.trim() && stdin.isTTY) actualRequest = await ask('O que você quer construir? ');
      if (!actualRequest?.trim()) throw new Error('Informe o pedido como texto, --file ou projeto/prompt da base documental.');
      if (explicitLocal && current.dataCenter) {
        const change = new ProjectStore(workspace); try { change.update({ dataCenter: null }); } finally { change.close(); }
      }
      const { runWorkflow } = await import('./app/workflow.js');
      const result = await runWorkflow({ workspace, stage, request: actualRequest, config,
        store: executionStore,
        documents: input?.documents ?? [],
        ...(reviewer ? { reviewer } : {}),
        ...(flags.systemInstall === true ? { allowSystemInstall: true } : {}),
        signal: controller.signal, announce,
      });
      if (flags.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else stdout.write(`\n${stage}: ${result.status}. Estado: ${workspace}/.capivara-next\n`);
      if (result.status === 'cancelled') process.exitCode = 130;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      stdout.write('Interrupção solicitada; materiais e trabalho preservados.\n'); process.exitCode = 130;
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); executionStore?.close(); }
  };
  for (const stage of ['init', 'plan', 'build', 'run'] as const) {
    common(program.command(stage).description({ init: 'Entende o pedido e resolve apenas lacunas reais', plan: 'Prepara a árvore de dependências e fragmentos', build: 'Constrói, confere e recupera sem reiniciar etapas', run: 'Executa init, plan e build até concluir' }[stage]).argument('[pedido]'))
      .action(async (request: string | undefined, flags: Flags) => execute(stage, request, flags));
  }
  common(program.command('config').description('Configura recursos autorizados para as próximas execuções'))
    .action(async (flags: Flags) => {
      const settings = await readSettings(); const defaults = flags.provider ? await configuredAgent(flags.provider, flags.baseUrl) : settings.agent;
      const selected = agentFlags(flags, defaults); const config = selected ? await credentialsFor(selected, flags.apiKeyEnv) : undefined;
      let dataCenter = settings.dataCenter;
      if (flags.mcp || flags.mcpTokenEnv) {
        dataCenter = await dataCenterEndpoint(flags.mcp);
        if (flags.mcpTokenEnv) {
          const token = process.env[flags.mcpTokenEnv];
          if (!token?.trim()) throw new Error(`A variável ${flags.mcpTokenEnv} está vazia.`);
          dataCenter = validateDataCenterEndpoint({ url: dataCenter.url, headers: { ...dataCenter.headers, authorization: `Bearer ${token.trim()}` } });
        }
      }
      if (!flags.provider && !flags.model && !flags.effort && !flags.modelDefault && !flags.effortDefault && !flags.baseUrl && !flags.apiKeyEnv && !flags.reviewerProvider && !flags.reviewerModel && !flags.reviewerEffort && !flags.reviewerModelDefault && !flags.reviewerEffortDefault && !flags.mcp && !flags.mcpTokenEnv && flags.systemInstall !== true) { stdout.write(`${JSON.stringify(settings, hideSecrets, 2)}\n`); return; }
      await saveSettings({ ...settings, ...(config ? { agent: config } : {}), ...(dataCenter ? { dataCenter } : {}), ...(flags.systemInstall === true ? { allowSystemInstall: true } : {}),
        ...(config && (flags.reviewerProvider || flags.reviewerModel || flags.reviewerEffort || flags.reviewerModelDefault || flags.reviewerEffortDefault) ? { reviewer: reviewerFlags(flags, config) } : {}),
      });
      stdout.write(`Configuração salva em ${settingsPath()}\n`);
    });
  program.command('status').description('Lê o trabalho e decisões pendentes sem interromper a execução')
    .option('--project <path>', 'Pasta da aplicação', '.').option('--json')
    .action(async (flags: Flags) => {
      const { ProjectStore } = await import('./app/store.js'); const store = new ProjectStore(flags.project);
      try {
        const state = store.read();
        stdout.write(flags.json ? `${JSON.stringify(state, hideSecrets, 2)}\n` : `${state.stage ?? 'sem execução'}: ${state.status ?? 'novo'}\n${state.pendingQuestion ? `${state.pendingQuestion.id}: ${state.pendingQuestion.question}\n` : ''}`);
      } finally { store.close(); }
    });
  program.command('answer <id> <resposta>').description('Resolve uma lacuna de execução ativa ou preservada')
    .option('--project <path>', 'Pasta da aplicação', '.')
    .action(async (id: string, answer: string, flags: Flags) => {
      const { ProjectStore } = await import('./app/store.js'); const store = new ProjectStore(flags.project);
      try {
        if (!store.read().brief?.gaps.some(gap => gap.id === id)) throw new Error(`Lacuna desconhecida: ${id}. Consulte capivara status --json para os identificadores do projeto.`);
        store.answer(id, answer); stdout.write('Resposta registrada; a execução ativa a incorpora automaticamente.\n');
      } finally { store.close(); }
    });
  program.command('providers').description('Lista transportes e CLIs instaladas')
    .action(async () => {
      for (const id of PROVIDERS) stdout.write(`${id}${['codex', 'claude', 'opencode'].includes(id) ? await installed(id) ? ' · CLI instalada' : ' · CLI ausente' : ' · API/ferramentas do harness'}\n`);
    });
  const wizard = async (flags: { project?: string; mcp?: string } = {}): Promise<void> => {
    const { openStartupWizard } = await import('./app/wizard.js');
    const result = await openStartupWizard({ ...(flags.project ? { workspace: flags.project } : {}), ...(flags.mcp ? { mcp: flags.mcp } : {}), providers: PROVIDERS });
    if (!result) { stdout.write('Wizard encerrado. Nada foi executado.\n'); return; }
    if (stdin.isTTY && stdout.isTTY && process.env.CAPIVARA_LINE_INPUT !== '1') stdout.write(`Comando equivalente:\n${result.command}\n`);
    if (!result.execute) { stdout.write('Nada foi executado. O comando acima faz o mesmo quando você quiser.\n'); return; }
    await program.parseAsync(result.argv, { from: 'user' });
  };
  program.command('wizard').description('Monta o comando interativamente e executa')
    .option('--project <path>', 'Pasta sugerida para o projeto')
    .option('--mcp <url>', 'Base documental sugerida')
    .action(wizard);
  program.action(async () => wizard());
  return program;
}
