import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AgentConfig } from '../runtime/types.js';
import { API_ROUTES } from '../runtime/api.js';
import { createDataCenterClient } from '../data-center/index.js';
import { createTerminalWizardIO, runWizard } from '../wizard/index.js';
import type { WizardIO, WizardResult } from '../wizard/index.js';
import { agentCredential, configuredAgent, createModelCatalog } from './catalog.js';
import { dataCenterEndpoint, dataCenterValue } from './data-source.js';
import { readSettings, saveSettings } from './settings.js';
import type { SavedProject } from './store.js';

/** Menu defaults must not create project state before the developer chooses to execute. */
export async function inspectProject(workspace: string): Promise<SavedProject> {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(workspace, '.capivara-next/project.sqlite'), { readOnly: true });
    const row = db.prepare('SELECT body FROM project WHERE id=1').get() as { body: string } | undefined;
    return row ? JSON.parse(row.body) as SavedProject : {};
  } catch {
    try { const value = JSON.parse(await readFile(join(workspace, '.capivara-next/project.snapshot.json'), 'utf8')) as { project?: SavedProject }; return value.project ?? {}; }
    catch { return {}; }
  } finally { db?.close(); }
}

export async function configureWizardApi(provider: string, io: WizardIO): Promise<AgentConfig | false> {
  const config = await configuredAgent(provider);
  if (!API_ROUTES[provider] && !config.baseUrl) {
    for (;;) {
      const url = (await io.ask('Endpoint da API compatível, sem /chat/completions')).trim();
      if (!url) return false;
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid');
        config.baseUrl = parsed.href.replace(/\/$/, ''); break;
      } catch { io.write('Informe um endpoint HTTP/HTTPS sem credenciais na URL. Vazio volta ao provider.'); }
    }
  }
  if (agentCredential(config)) return config;
  const variable = config.apiKeyEnv ?? API_ROUTES[provider]?.env ?? 'CAPIVARA_API_KEY';
  if (await io.select('Configurar esta API?', [{ label: 'configurar chave', hint: `ou disponibilize ${variable} no ambiente` }, { label: 'voltar ao provider' }], 0)) return false;
  const secret = (await io.secret(`Chave da API ${provider}`)).trim();
  if (!secret) return false;
  config.apiKey = secret;
  config.apiKeyEnv = variable;
  const settings = await readSettings();
  await saveSettings({ ...settings, credentials: { ...settings.credentials, [provider]: { apiKey: secret, apiKeyEnv: variable, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) } } });
  io.write('Credencial salva para este provider; ela não aparece no comando equivalente.');
  return config;
}

export async function openStartupWizard(options: { workspace?: string; mcp?: string; providers: readonly string[] }): Promise<WizardResult | null> {
  const io = createTerminalWizardIO();
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
  const settings = await readSettings();
  const endpoint = await dataCenterEndpoint(options.mcp).catch(() => ({ url: options.mcp || 'http://localhost:7777/mcp' }));
  const catalog = createModelCatalog(process.cwd(), controller.signal);
  const client = async (url: string) => createDataCenterClient(await dataCenterEndpoint(url), { signal: controller.signal });
  const result = await runWizard({
    io, cwd: process.cwd(), defaults: { ...(options.workspace ? { workspace: options.workspace } : {}), ...(settings.agent ? { agent: settings.agent } : {}), ...(settings.reviewer ? { reviewer: settings.reviewer } : {}), dataCenterUrl: endpoint.url },
    providers: options.providers.map(id => ({ id, hint: ['codex', 'claude', 'opencode'].includes(id) ? 'usa a CLI instalada nesta máquina' : 'API direta com ferramentas do motor' })),
    ...catalog,
    configureApi: configureWizardApi,
    requestRecorded: async workspace => { const state = await inspectProject(workspace); return !!(state.request?.trim() || state.dataCenter?.request.trim()); },
    defaultStage: async workspace => { const state = await inspectProject(workspace); return state.plan?.status === 'ready' ? 'build' : state.brief ? 'plan' : 'init'; },
    dataCenter: {
      listProjects: async url => dataCenterValue(await (await client(url)).discoverProjects()).map(project => ({ ...project, title: project.name || project.slug })),
      loadProject: async (url, project) => ({ request: dataCenterValue(await (await client(url)).loadProject(project)).request }),
      listPrompts: async url => dataCenterValue(await (await client(url)).listPrompts()),
      readPrompt: async (url, name) => dataCenterValue(await (await client(url)).readPrompt(name)),
    },
  });
  if (result?.execute) {
    const current = await readSettings();
    await saveSettings({ ...current, agent: result.config, ...(result.reviewer ? { reviewer: result.reviewer } : {}) });
  }
  return result;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    io.close?.();
  }
}
