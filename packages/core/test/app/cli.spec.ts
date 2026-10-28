import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgram } from '../../src/cli-program.js';
import { saveSettings, readSettings } from '../../src/app/settings.js';
import { ProjectStore } from '../../src/app/store.js';
import { runWorkflow } from '../../src/app/workflow.js';

vi.mock('../../src/app/workflow.js', () => ({ runWorkflow: vi.fn(async () => ({ status: 'complete' })) }));
let directory: string | undefined;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); if (directory) await rm(directory, { recursive: true, force: true }); });

it('o comando equivalente limpa defaults antigos e não transporta a chave para outro endpoint', async () => {
  directory = await mkdtemp(join(tmpdir(), 'capivara-command-'));
  vi.stubEnv('CAPIVARA_CONFIG_DIR', join(directory, 'settings'));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const config = { provider: 'codex', model: 'old-model', effort: 'high' };
  await saveSettings({ agent: config, reviewer: config });
  const workspace = join(directory, 'product');
  const store = new ProjectStore(workspace);
  store.update({ request: 'Crie uma CLI local.', config, reviewer: config }); store.close();
  await createProgram().exitOverride().parseAsync(['build', '--project', workspace, '--provider', 'codex', '--model-default', '--effort-default', '--reviewer-provider', 'codex', '--reviewer-model-default', '--reviewer-effort-default'], { from: 'user' });
  const call = vi.mocked(runWorkflow).mock.calls.at(-1)![0];
  expect(call.config).toEqual({ provider: 'codex' });
  expect(call.reviewer).toEqual({ provider: 'codex' });

  await saveSettings({ agent: { provider: 'openai', apiKey: 'old-private-key', model: 'example' }, credentials: { openai: { apiKey: 'old-private-key' } } });
  await createProgram().exitOverride().parseAsync(['config', '--provider', 'openai', '--base-url', 'https://alternate.invalid/v1'], { from: 'user' });
  const changed = await readSettings();
  expect(changed.agent?.baseUrl).toBe('https://alternate.invalid/v1');
  expect(changed.agent?.apiKey).toBeUndefined();
  expect(changed.credentials?.openai?.apiKey).toBe('old-private-key');
});
