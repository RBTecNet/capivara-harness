import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { readFile, access, mkdir } from 'node:fs/promises';
import { resolve, delimiter, join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { VERSION } from './version.js';
import { readSettings, saveSettings, settingsPath } from './app/settings.js';
import type { AgentConfig } from './runtime/types.js';

interface Flags {
  project: string; provider?: string; model?: string; effort?: string;
  reviewerProvider?: string; reviewerModel?: string;
  baseUrl?: string; apiKeyEnv?: string; file?: string; systemInstall?: boolean;
  contextTokens?: string; maxOutputTokens?: string; json?: boolean;
}
const PROVIDERS = ['codex', 'claude', 'opencode', 'openai', 'anthropic', 'openrouter', 'deepseek', 'minimax', 'custom'];
const hideSecrets = (key: string, value: unknown): unknown => /api.?key|token|secret|password|access.?key/i.test(key) && typeof value === 'string' ? '[credencial ocultada]' : value;

async function ask(prompt: string): Promise<string> {
  const reader = createInterface({ input: stdin, output: stdout });
  try { return (await reader.question(prompt)).trim(); } finally { reader.close(); }
}

function common(command: Command): Command {
  return command.option('--project <path>', 'Pasta da aplicação', '.')
    .option('--provider <id>', 'Transporte do agente')
    .option('--model <id>', 'Modelo configurado; CLIs podem usar seu padrão')
    .option('--effort <level>', 'Raciocínio quando suportado pelo transporte')
    .option('--reviewer-provider <id>', 'Transporte do parceiro de revisão')
    .option('--reviewer-model <id>', 'Modelo do parceiro; não precisa ser mais caro')
    .option('--base-url <url>', 'Endpoint de API compatível')
    .option('--api-key-env <name>', 'Nome da variável de credencial')
    .option('--context-tokens <n>', 'Capacidade de contexto do modelo')
    .option('--max-output-tokens <n>', 'Reserva de saída por chamada')
    .option('--system-install', 'Permitir preparação com instalação no sistema')
    .option('--file <path>', 'Arquivo contendo o pedido')
    .option('--json', 'Saída final estruturada');
}

function agentFlags(flags: Flags, base?: AgentConfig): AgentConfig | undefined {
  for (const value of [flags.contextTokens, flags.maxOutputTokens]) {
    if (value !== undefined && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) throw new Error('Os limites de tokens precisam ser inteiros positivos.');
  }
  const provider = flags.provider ?? base?.provider ?? process.env.CAPIVARA_PROVIDER;
  if (!provider) return undefined;
  const selected = base?.provider === provider ? base : undefined;
  return {
    ...(selected ?? {}), provider,
    ...(flags.model ? { model: flags.model } : {}),
    ...(flags.effort ? { effort: flags.effort } : {}),
    ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
    ...(flags.apiKeyEnv ? { apiKeyEnv: flags.apiKeyEnv } : {}),
    ...(flags.contextTokens ? { contextTokens: Number(flags.contextTokens) } : {}),
    ...(flags.maxOutputTokens ? { maxOutputTokens: Number(flags.maxOutputTokens) } : {}),
  };
}

function reviewerFlags(flags: Flags, editor: AgentConfig): AgentConfig {
  const provider = flags.reviewerProvider ?? editor.provider;
  return { ...(provider === editor.provider ? editor : {}), provider, ...(flags.reviewerModel ? { model: flags.reviewerModel } : {}) };
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
    let config = agentFlags(flags, current.config ?? settings.agent);
    if (!config && stdin.isTTY) {
      const present = (await Promise.all(['codex', 'claude', 'opencode'].map(async p => await installed(p) ? p : null))).filter(Boolean);
      stdout.write(`Transportes disponíveis: ${PROVIDERS.join(', ')}\nCLIs encontradas: ${present.join(', ') || 'nenhuma'}\n`);
      const provider = await ask('Qual agente usar? ');
      if (provider) config = agentFlags({ ...flags, provider });
    }
    if (!config) throw new Error('Configure um agente com --provider ou capivara config --provider <id>.');
    if (!PROVIDERS.includes(config.provider) && !config.baseUrl) throw new Error(`Transporte desconhecido: ${config.provider}. Use --base-url para API compatível.`);
    const text = flags.file ? await readFile(resolve(flags.file), 'utf8') : request;
    let actualRequest = text ?? current.request;
    if (!actualRequest?.trim() && stdin.isTTY) actualRequest = await ask('O que você quer construir? ');
    if (!actualRequest?.trim()) throw new Error('Informe o pedido como texto ou --file.');
    const reviewer = flags.reviewerProvider || flags.reviewerModel ? reviewerFlags(flags, config) : current.reviewer ?? settings.reviewer;
    const controller = new AbortController();
    const interrupt = (): void => controller.abort();
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      const { runWorkflow } = await import('./app/workflow.js');
      const result = await runWorkflow({ workspace, stage, request: actualRequest, config,
        ...(reviewer ? { reviewer } : {}),
        ...(flags.systemInstall === true ? { allowSystemInstall: true } : {}),
        signal: controller.signal,
        announce: message => { if (!flags.json) stdout.write(`${message}\n`); },
      });
      if (flags.json) stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else stdout.write(`\n${stage}: ${result.status}. Estado: ${workspace}/.capivara-next\n`);
      if (result.status === 'cancelled') process.exitCode = 130;
    } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); }
  };
  for (const stage of ['init', 'plan', 'build', 'run'] as const) {
    common(program.command(stage).description({ init: 'Entende o pedido e resolve apenas lacunas reais', plan: 'Prepara a árvore de dependências e fragmentos', build: 'Constrói, confere e recupera sem reiniciar etapas', run: 'Executa init, plan e build até concluir' }[stage]).argument('[pedido]'))
      .action(async (request: string | undefined, flags: Flags) => execute(stage, request, flags));
  }
  common(program.command('config').description('Configura recursos autorizados para as próximas execuções'))
    .action(async (flags: Flags) => {
      const settings = await readSettings(); const config = agentFlags(flags, settings.agent);
      if (!config) { stdout.write(`${JSON.stringify(settings, hideSecrets, 2)}\n`); return; }
      await saveSettings({ ...settings, agent: config, ...(flags.systemInstall === true ? { allowSystemInstall: true } : {}),
        ...(flags.reviewerProvider || flags.reviewerModel ? { reviewer: reviewerFlags(flags, config) } : {}),
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
  program.action(async () => {
    if (!stdin.isTTY) { program.outputHelp(); return; }
    stdout.write(`Capivara ${VERSION}\n`);
    const project = await ask(`Pasta do projeto [${process.cwd()}]: `) || process.cwd();
    await execute('run', undefined, { project });
  });
  return program;
}
