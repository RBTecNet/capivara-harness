import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentConfig } from '../runtime/types.js';
import type { DataCenterEndpoint } from '../data-center/types.js';

export interface Settings {
  agent?: AgentConfig;
  reviewer?: AgentConfig;
  allowSystemInstall?: boolean;
  credentials?: Record<string, { apiKey: string; apiKeyEnv?: string; baseUrl?: string }>;
  dataCenter?: DataCenterEndpoint;
}
export function settingsPath(): string {
  return join(process.env.CAPIVARA_CONFIG_DIR || join(homedir(), '.config', 'capivara'), 'settings.json');
}
export async function readSettings(): Promise<Settings> {
  try { return JSON.parse(await readFile(settingsPath(), 'utf8')) as Settings; }
  catch { return {}; }
}
export async function saveSettings(settings: Settings): Promise<void> {
  const path = settingsPath(); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}`;
  await writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600, flush: true });
  await rename(temp, path);
}
