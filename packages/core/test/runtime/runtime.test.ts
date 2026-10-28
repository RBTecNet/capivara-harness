import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgent } from '../../src/runtime/agent.js';
import { executeCommand } from '../../src/runtime/command.js';
import { runTerminal } from '../../src/runtime/terminal.js';
import { AgentTools } from '../../src/runtime/tools.js';
import { bindCredential, configuredAgent, createModelCatalog } from '../../src/app/catalog.js';
import { saveSettings } from '../../src/app/settings.js';
import type { AgentRequest } from '../../src/runtime/types.js';

const directories: string[] = [];
async function workspace(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'capivara-runtime-test-')); directories.push(path); return path; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('new runtime execution', () => {
  it('keeps saved and environment credentials at their API destination and shares the Gemini alias with discovery', async () => {
    const cwd = await workspace();
    vi.stubEnv('CAPIVARA_CONFIG_DIR', await workspace());
    vi.stubEnv('OPENAI_API_KEY', 'offline-openai-environment-key');
    vi.stubEnv('CAPIVARA_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', 'offline-google-alias');
    try {
      await saveSettings({ agent: { provider: 'openai', apiKey: 'offline-saved-key' }, credentials: { openai: { apiKey: 'offline-saved-key' } } });
      const saved = await configuredAgent('openai', 'https://api.openai.com:443/v1/');
      expect(saved.apiKey).toBe('offline-saved-key');
      const alternate = await configuredAgent('openai', 'https://alternate.invalid/v1');
      expect(alternate.apiKey).toBeUndefined();
      expect(alternate.baseUrl).toBe('https://alternate.invalid/v1');
      expect(bindCredential(saved, alternate.baseUrl).apiKey).toBeUndefined();
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).endsWith('/models')
        ? Response.json({ data: [{ id: 'offline-catalog-model' }] })
        : Response.json({ choices: [{ message: { role: 'assistant', content: 'Offline result.' }, finish_reason: 'stop' }] }));
      const request = { workspace: cwd, role: 'analyst', readOnly: true, instruction: 'Inspect a small fragment.' };
      const blocked = await runAgent({ ...request, config: { ...alternate, model: 'offline-model' } });
      expect(blocked.issue?.kind).toBe('authentication');
      expect(fetch).not.toHaveBeenCalled();
      const explicit = bindCredential(saved, alternate.baseUrl, 'OPENAI_API_KEY');
      expect((await runAgent({ ...request, config: { ...explicit, model: 'offline-model' } })).status).toBe('complete');
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer offline-openai-environment-key');
      expect(await createModelCatalog(cwd).listModels('gemini')).toEqual([{ id: 'offline-catalog-model', name: '' }]);
      expect((await runAgent({ ...request, config: { provider: 'gemini', model: 'offline-model' } })).status).toBe('complete');
      expect(fetch.mock.calls.slice(1).every(([, init]) => new Headers(init?.headers).get('authorization') === 'Bearer offline-google-alias')).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it('retains process output and reports timeout/cancellation without starting a cancelled command', async () => {
    const cwd = await workspace();
    const normal = await executeCommand({ cwd, command: [process.execPath, '-e', 'process.stdout.write(process.cwd());process.stderr.write("diagnostic");process.exitCode=3'] });
    expect(normal).toMatchObject({ exitCode: 3, stdout: cwd, stderr: 'diagnostic', timedOut: false, cancelled: false });
    expect(normal.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const constraints = { forbiddenCapabilities: ['http-server', 'browser'] };
    const observation = await executeCommand({ cwd, command: [process.execPath, '-e', 'console.log("serve playwright")'], constraints });
    expect(observation).toMatchObject({ exitCode: 0, stdout: 'serve playwright\n' });
    const forbiddenServer = await executeCommand({ cwd, command: ['npx', 'serve'], constraints });
    expect(forbiddenServer.issue?.kind).toBe('constraint');
    const partial = await executeCommand({ cwd, command: [process.execPath, '-e', 'console.log("work preserved");setInterval(()=>{},1000)'], timeoutMs: 200 });
    expect(partial.timedOut).toBe(true);
    expect(partial.stdout).toContain('work preserved');
    const control = new AbortController(); control.abort();
    const cancelled = await executeCommand({ cwd, command: [process.execPath, '-e', 'require("node:fs").writeFileSync("should-not-exist","bad")'], signal: control.signal });
    expect(cancelled.cancelled).toBe(true);
    await expect(readFile(join(cwd, 'should-not-exist'))).rejects.toThrow();
  });

  it('confines file tools including symlink paths and removes write tools from read-only tasks', async () => {
    const cwd = await workspace(), outside = await workspace();
    await writeFile(join(outside, 'private.txt'), 'outside');
    await symlink(outside, join(cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const request: AgentRequest = { workspace: cwd, config: { provider: 'openai' }, role: 'editor', instruction: 'fragment' };
    const tools = new AgentTools(request);
    expect(await tools.execute('read_file', { path: 'escape/private.txt' })).toHaveProperty('error');
    expect(await tools.execute('write_file', { path: '../escaped.txt', content: 'bad' })).toHaveProperty('error');
    expect(await tools.execute('write_file', { path: '.capivara-next/state.json', content: 'bad' })).toHaveProperty('error');
    expect(await tools.execute('write_file', { path: 'src/answer.ts', content: 'export const answer = 42;' })).toEqual({ written: 'src/answer.ts' });
    const review = new AgentTools({ ...request, readOnly: true });
    expect(await review.execute('write_file', { path: 'src/answer.ts', content: 'broken' })).toHaveProperty('error');
    expect(await readFile(join(cwd, 'src/answer.ts'), 'utf8')).toBe('export const answer = 42;');
    tools.close(); review.close();
  });

  it('drives real terminal keys and rejects an application that exits before the expected interaction', async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, 'tui.cjs'), 'process.stdin.setRawMode(true);process.stdin.resume();console.log("TTY="+process.stdin.isTTY);process.stdin.on("data", b=>{if(b.toString()==="\\u001b[B") console.log("selected second");if(b.toString()==="q") process.exit(0)})');
    const terminal = await runTerminal({ cwd, command: [process.execPath, 'tui.cjs'], timeoutMs: 5000, steps: [{ waitFor: 'TTY=true' }, { input: '\u001b[B', waitFor: 'selected second' }], closeInput: 'q' });
    expect(terminal).toMatchObject({ terminal: true, exitCode: 0, timedOut: false });
    expect(terminal.issue).toBeUndefined();
    const early = await runTerminal({ cwd, command: [process.execPath, '-e', 'console.log("exited")'], timeoutMs: 2000, steps: [{ waitFor: 'exited' }, { input: '\u001b[B', waitFor: 'selected second', timeoutMs: 100 }] });
    expect(early.issue?.kind).toBe('tool');
  });

  it('gives API models actual edit/command tools and continues until their final response', async () => {
    const cwd = await workspace();
    const payloads: Record<string, unknown>[] = [];
    const responses = [
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'answer.cjs', content: 'console.log(42)' }) } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
      { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'check', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: `${JSON.stringify(process.execPath)} answer.cjs` }) } }] }, finish_reason: 'tool_calls' }] },
      { choices: [{ message: { role: 'assistant', content: 'Implemented; command printed 42.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 6 } },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => { payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return Response.json(responses.shift()); });
    const result = await runAgent({ workspace: cwd, config: { provider: 'openai', model: 'configured-model', apiKey: 'offline-secret-value' }, role: 'editor', instruction: 'Create a tiny program that prints 42.' });
    expect(result.status).toBe('complete');
    expect(result.changedFiles).toEqual(['answer.cjs']);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]).toMatchObject({ exitCode: 0, stdout: '42\n' });
    expect(result.usage).toMatchObject({ inputTokens: 30, outputTokens: 11 });
    expect(payloads.every(payload => payload.model === 'configured-model')).toBe(true);
    expect(payloads).toHaveLength(3);
    expect(JSON.stringify(payloads[2]?.messages)).toContain('42');
  });

  it('preserves edits and rate-limit information so the coordinator can continue without restarting work', async () => {
    const cwd = await workspace();
    const call = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'write', type: 'function', function: { name: 'write_file', arguments: '{"path":"preserved.txt","content":"completed local work"}' } }] }, finish_reason: 'tool_calls' }] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json(call)).mockResolvedValueOnce(Response.json({ error: { message: 'rate limited' } }, { status: 429, headers: { 'retry-after': '2' } }));
    const result = await runAgent({ workspace: cwd, config: { provider: 'openrouter', model: 'configured-model', apiKey: 'offline-secret-value' }, role: 'editor', instruction: 'Small fragment.' });
    expect(result.issue).toMatchObject({ kind: 'rate-limit', recoverable: true, retryAfterMs: 2000 });
    expect(result.changedFiles).toEqual(['preserved.txt']);
    expect(await readFile(join(cwd, 'preserved.txt'), 'utf8')).toBe('completed local work');
  });

  it('executes Anthropic native tool-use messages with matching tool results', async () => {
    const cwd = await workspace();
    await writeFile(join(cwd, 'existing.txt'), `The current contract.\n${'Large source line with relevant details. '.repeat(2000)}`);
    const payloads: Record<string, unknown>[] = [];
    const responses = [
      { content: [{ type: 'tool_use', id: 'native-read', name: 'read_file', input: { path: 'existing.txt' } }], stop_reason: 'tool_use', usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 4 } },
      { content: [{ type: 'text', text: 'Existing contract observed.' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3 } },
    ];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => { payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return Response.json(responses.shift()); });
    const result = await runAgent({ workspace: cwd, config: { provider: 'anthropic', model: 'configured-model', apiKey: 'offline-native-key', contextTokens: 2048, maxOutputTokens: 256 }, role: 'reviewer', readOnly: true, instruction: 'Inspect the existing contract.' });
    expect(result).toMatchObject({ status: 'complete', changedFiles: [], usage: { inputTokens: 9, outputTokens: 5, cachedInputTokens: 4 } });
    const toolResult = JSON.stringify(payloads[1]?.messages);
    expect(toolResult).toContain('native-read');
    expect(toolResult).toContain('The current contract.');
    expect(toolResult).toContain('originalChars');
    expect(toolResult).toContain('truncated');
    expect(toolResult.length).toBeLessThanOrEqual((2048 - 256) * 3);
  });

  it.skipIf(process.platform === 'win32')('uses Codex structured usage and final-message file, and never approves empty CLI output', async () => {
    const cwd = await workspace(), bin = await workspace();
    const script = join(bin, 'fake-codex');
    await writeFile(script, '#!/usr/bin/env node\nconst fs=require("node:fs");process.stdin.resume();process.stdin.on("end",()=>{const i=process.argv.indexOf("--output-last-message");fs.writeFileSync(process.argv[i+1],"Final fragment answer");console.log(JSON.stringify({type:"thread.started",thread_id:"offline-session"}));console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:12,output_tokens:5,cached_input_tokens:3}}));});');
    await chmod(script, 0o755);
    const config = { provider: 'codex', command: script, model: 'configured-model' };
    const result = await runAgent({ workspace: cwd, config, role: 'editor', instruction: 'A small fragment.' });
    expect(result).toMatchObject({ status: 'complete', text: 'Final fragment answer', sessionId: 'offline-session', usage: { inputTokens: 12, outputTokens: 5, cachedInputTokens: 3 } });
    await writeFile(script, '#!/usr/bin/env node\nprocess.stdin.resume();');
    const empty = await runAgent({ workspace: cwd, config, role: 'editor', instruction: 'A small fragment.' });
    expect(empty.status).toBe('unavailable');
    expect(empty.issue?.message).toContain('saída vazia');
  });
});
