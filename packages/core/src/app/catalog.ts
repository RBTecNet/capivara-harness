import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES, apiCredential, defaultAPIKeyEnv, normalizedAPIDestination } from '../runtime/api.js';
import { executeCommand } from '../runtime/command.js';
import type { AgentConfig } from '../runtime/types.js';
import { readSettings } from './settings.js';

export interface ModelOption { id: string; name?: string; efforts?: string[]; }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === 'string' ? value : '';

/** Apply an endpoint override without carrying the former destination's stored secrets. */
export function bindCredential(config: AgentConfig, destinationBaseUrl = config.baseUrl, explicitApiKeyEnv?: string): AgentConfig {
  const changed = normalizedAPIDestination(config.provider, config.baseUrl) !== normalizedAPIDestination(config.provider, destinationBaseUrl);
  const result = { ...config, ...(destinationBaseUrl !== undefined ? { baseUrl: destinationBaseUrl } : {}) };
  if (changed) {
    delete result.apiKey;
    delete result.apiKeyEnv;
    if (result.environment) {
      const credentialNames = new Set([defaultAPIKeyEnv(config), 'CAPIVARA_API_KEY', 'GOOGLE_API_KEY', ...Object.values(API_ROUTES).map(route => route.env)]);
      result.environment = Object.fromEntries(Object.entries(result.environment).filter(([name]) => !credentialNames.has(name)));
    }
  }
  if (explicitApiKeyEnv) { delete result.apiKey; result.apiKeyEnv = explicitApiKeyEnv; }
  return result;
}

/** Credentials belong to both the provider and its exact normalized API destination. */
export async function configuredAgent(provider: string, destinationBaseUrl?: string): Promise<AgentConfig> {
  const settings = await readSettings();
  const current = settings.agent?.provider === provider ? settings.agent : settings.reviewer?.provider === provider ? settings.reviewer : undefined;
  const saved = settings.credentials?.[provider];
  const destination = destinationBaseUrl ?? (current ? current.baseUrl : saved?.baseUrl);
  const config = bindCredential({ provider, ...(current ?? {}) }, destination);
  if (!saved || normalizedAPIDestination(provider, saved.baseUrl) !== normalizedAPIDestination(provider, destination)) return config;
  return { ...config, ...saved, ...(destination !== undefined ? { baseUrl: destination } : {}) };
}
export const agentCredential = apiCredential;

/** Only free catalog queries; failure returns manual model entry, never an inference call. */
export function createModelCatalog(workspace: string, signal?: AbortSignal) {
  const pending = new Map<string, Promise<ModelOption[]>>();
  const discover = async (provider: string): Promise<ModelOption[]> => {
    if (provider === 'codex') {
      let data: unknown;
      try { data = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'), 'utf8')); } catch { /* Ask the installed CLI instead. */ }
      if (!array(object(data).models).length) {
        const result = await executeCommand({ cwd: workspace, command: ['codex', 'debug', 'models'], timeoutMs: 10_000, ...(signal ? { signal } : {}) });
        try { data = JSON.parse(result.stdout); } catch { return []; }
      }
      return array(object(data).models).map(object).filter(model => !model.visibility || model.visibility === 'list').map(model => ({ id: string(model.slug), name: string(model.display_name), efforts: array(model.supported_reasoning_levels).map(value => string(object(value).effort)).filter(Boolean) })).filter(model => model.id);
    }
    if (provider === 'opencode') {
      const result = await executeCommand({ cwd: workspace, command: ['opencode', 'api', 'model.list', '--standalone'], timeoutMs: 15_000, ...(signal ? { signal } : {}) });
      try {
        const parsed: unknown = JSON.parse(result.stdout);
        const values = Array.isArray(parsed) ? parsed : array(object(parsed).data ?? object(parsed).models);
        return values.map(object).filter(model => model.enabled !== false).map(model => ({ id: `${string(model.providerID)}/${string(model.id)}`, name: string(model.name), efforts: array(model.variants).map(value => string(object(value).id)).filter(Boolean) })).filter(model => !model.id.startsWith('/') && !model.id.endsWith('/'));
      } catch { return []; }
    }
    if (provider === 'claude') return [{ id: 'sonnet' }, { id: 'opus' }, { id: 'haiku' }];
    const config = await configuredAgent(provider);
    const key = agentCredential(config);
    const route = API_ROUTES[provider];
    if (!route && !config.baseUrl) return [];
    if (!key) return [];
    const base = normalizedAPIDestination(provider, config.baseUrl) ?? '';
    const headers: Record<string, string> = provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { authorization: `Bearer ${key}` };
    try {
      const response = await fetch(`${base}/models`, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000), redirect: 'error' });
      if (!response.ok) return [];
      const data: unknown = await response.json();
      return array(object(data).data).map(object).map(model => ({ id: string(model.id), name: string(model.name ?? model.display_name) })).filter(model => model.id);
    } catch { return []; }
  };
  const listModels = (provider: string): Promise<ModelOption[]> => {
    if (!pending.has(provider)) pending.set(provider, discover(provider));
    return pending.get(provider)!;
  };
  return {
    listModels,
    listEfforts: async (provider: string, model: string): Promise<string[] | null> => {
      const entry = (await listModels(provider)).find(value => value.id === model);
      if (entry?.efforts !== undefined) return entry.efforts;
      // Do not offer a knob that this runtime does not send to that transport.
      return ['openai', 'openrouter', 'codex', 'claude', 'opencode'].includes(provider) ? null : [];
    },
  };
}
