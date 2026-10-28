import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeCommand } from '../../src/runtime/command.js';
import { executionRestriction } from '../../src/runtime/isolation.js';
import { withVerificationWorkspace } from '../../src/runtime/verification.js';
import { runAgent } from '../../src/runtime/agent.js';
import { AgentTools } from '../../src/runtime/tools.js';

const directories: string[] = [];
async function workspace(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'capivara-review-proof-')); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('ambiente de verificação independente', () => {
  it('propaga bindings operacionais para CLI, ferramentas de comando, PTY e processos sem expor segredos', async () => {
    const source = await workspace();
    await writeFile(join(source, 'provider.cjs'), 'console.log(process.env.OPERATIONAL_VALUE);');
    const environment = { OPERATIONAL_VALUE: 'prepared-local-provider', CAPIVARA_TEST_API_TOKEN: 'private-operational-token' };
    const cli = await runAgent({ workspace: source, config: { provider: 'offline-command', command: process.execPath, args: ['provider.cjs'], environment: { OPERATIONAL_VALUE: 'old-provider' } }, environment, role: 'editor', instruction: 'Report the prepared provider.' });
    expect(cli).toMatchObject({ status: 'complete', text: 'prepared-local-provider' });
    const tools = new AgentTools({ workspace: source, config: { provider: 'offline-api', environment: { OPERATIONAL_VALUE: 'old-provider' } }, environment, role: 'editor', instruction: 'Use the prepared provider.' });
    const quotedNode = `'${process.execPath.replace(/'/g, `'\\''`)}'`;
    try {
      const command = await tools.execute('run_command', { command: `${quotedNode} provider.cjs` });
      expect(command).toMatchObject({ exitCode: 0, stdout: 'prepared-local-provider\n' });
      if (process.platform === 'linux') {
        const terminal = await tools.execute('run_terminal', { command: `${quotedNode} provider.cjs`, steps: [{ waitFor: 'prepared-local-provider' }], timeoutMs: 2000 });
        expect(terminal).toMatchObject({ terminal: true, exitCode: 0 });
        expect((terminal as { stdout: string }).stdout).toContain('prepared-local-provider');
      }
      const started = await tools.execute('start_process', { command: `${quotedNode} provider.cjs`, capability: 'process' }) as { id: string };
      await vi.waitFor(async () => {
        expect(await tools.execute('read_process', { id: started.id })).toMatchObject({ stdout: 'prepared-local-provider\n', exitCode: 0 });
      }, { timeout: 2000, interval: 10 });
      const confidential = await executeCommand({ cwd: source, command: [process.execPath, '-e', 'console.log(process.env.CAPIVARA_TEST_API_TOKEN)'], environment });
      expect(confidential.stdout).toBe('[segredo oculto]\n');
    } finally { tools.close(); }
  });

  it('executa prova que grava temporários e artefatos sem alterar o produto inspecionado', async () => {
    const source = await workspace();
    await writeFile(join(source, 'application.cjs'), 'const fs=require("node:fs");fs.writeFileSync("database.sqlite", "observed artifact");fs.writeFileSync(require("node:path").join(require("node:os").tmpdir(), "proof.tmp"), "temporary artifact");console.log("saved");');
    await chmod(join(source, 'application.cjs'), 0o444);
    let disposable = '';
    const result = await withVerificationWorkspace(source, async area => {
      disposable = area.workspace;
      const proof = await executeCommand({ cwd: area.workspace, command: [process.execPath, 'application.cjs'], environment: area.environment, executionPolicy: { purpose: 'verification', writeScope: 'isolated-workspace' } });
      expect(await readFile(join(area.environment.TMPDIR!, 'proof.tmp'), 'utf8')).toBe('temporary artifact');
      expect(await readFile(join(area.workspace, 'database.sqlite'), 'utf8')).toBe('observed artifact');
      return proof;
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'saved\n' });
    await expect(access(join(source, 'database.sqlite'))).rejects.toThrow();
    await expect(access(disposable)).rejects.toThrow();
    expect(await readFile(join(source, 'application.cjs'), 'utf8')).toContain('database.sqlite');
  });

  it.skipIf(process.platform === 'win32')('copia o alvo de links e limpa a área mesmo quando a prova falha', async () => {
    const source = await workspace(), outside = await workspace();
    await writeFile(join(outside, 'data.txt'), 'source preserved');
    await symlink(join(outside, 'data.txt'), join(source, 'linked.txt'));
    let disposable = '';
    await expect(withVerificationWorkspace(source, async area => {
      disposable = area.workspace;
      await writeFile(join(area.workspace, 'linked.txt'), 'private change');
      throw new Error('behavioral proof failed');
    })).rejects.toThrow('behavioral proof failed');
    expect(await readFile(join(outside, 'data.txt'), 'utf8')).toBe('source preserved');
    await expect(access(disposable)).rejects.toThrow();
  });

  it('mantém EROFS como evidência e só o atribui ao instrumento quando existe política de isolamento', async () => {
    const source = await workspace();
    const command = [process.execPath, '-e', 'process.stderr.write("EROFS: read-only file system");process.exitCode=1'];
    const ordinary = await executeCommand({ cwd: source, command });
    expect(ordinary.issue).toBeUndefined();
    expect(ordinary.stderr).toContain('EROFS');
    const restricted = await executeCommand({ cwd: source, command, executionPolicy: { purpose: 'inspection', writeScope: 'read-only' } });
    expect(restricted.issue?.kind).toBe('instrument');
    expect(restricted.stderr).toBe(ordinary.stderr);
    expect(executionRestriction({}, ordinary, false)).toBeUndefined();
  });
});
