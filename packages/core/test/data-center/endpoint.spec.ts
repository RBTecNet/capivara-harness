import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataCenterEndpoint, validateDataCenterEndpoint } from '../../src/data-center/index.js';

describe('configuração nova da base e importação antiga', () => {
  it('importa a conexão antiga sem gravar e mantém tokens ligados à URL exata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capivara-data-config-'));
    try {
      const path = join(dir, 'config.json');
      const contents = JSON.stringify({ version: 1, mcp: { defaultUrl: 'http://configured.example:7777/mcp', servers: [{ url: 'http://configured.example:7777/mcp', port: 7777, token: 'saved-private-token' }] } });
      writeFileSync(path, contents, { mode: 0o600 });
      const imported = resolveDataCenterEndpoint(undefined, {}, { legacyConfigPath: path });
      expect(imported.ok && imported.value).toEqual({ url: 'http://configured.example:7777/mcp', headers: { authorization: 'Bearer saved-private-token' } });
      const another = resolveDataCenterEndpoint('https://other.example/mcp', {}, { legacyConfigPath: path });
      expect(another.ok && another.value).toEqual({ url: 'https://other.example/mcp' });
      const mismatch = resolveDataCenterEndpoint('https://other.example/mcp', { DOC_CENTER_URL: 'https://original.example/mcp', DOC_CENTER_TOKEN: 'environment-private-token' }, { legacyConfigPath: path });
      expect(mismatch.ok).toBe(false); expect(mismatch.availability.status).toBe('invalid-config');
      expect(JSON.stringify(mismatch)).not.toContain('environment-private-token');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('prioriza configuração explícita completa e informa configuração ausente como dado', () => {
    const missing = join(tmpdir(), `missing-data-config-${process.pid}`, 'config.json');
    const explicit = resolveDataCenterEndpoint({ url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer explicit-token', 'X-Account': 'account' } }, { DOC_CENTER_URL: 'https://other.example/mcp', DOC_CENTER_TOKEN: 'unrelated-token' }, { legacyConfigPath: missing });
    expect(explicit.ok && explicit.value).toEqual({ url: 'https://docs.example/mcp', headers: { authorization: 'Bearer explicit-token', 'x-account': 'account' } });
    const empty = resolveDataCenterEndpoint(undefined, {}, { legacyConfigPath: missing });
    expect(empty.ok && empty.value).toBeNull(); expect(empty.availability.status).toBe('unconfigured');
  });

  it.each(['https://user:secret@docs.example/mcp', 'https://docs.example/mcp?token=secret', 'https://docs.example/mcp#secret', 'file:///tmp/secret', 'https://docs.example/mcp\r\n'])('recusa endereço inseguro sem expor seu conteúdo: %s', (url) => {
    expect(() => validateDataCenterEndpoint({ url })).toThrow();
    try { validateDataCenterEndpoint({ url }); } catch (error) { expect(String(error)).not.toContain('secret'); }
  });

  it('recusa injeção de cabeçalho e arquivo de credenciais que seja link', () => {
    expect(() => validateDataCenterEndpoint({ url: 'https://docs.example/mcp', headers: { authorization: 'Bearer secret\r\nX-Injected: true' } })).toThrow(/caracteres/);
    expect(() => validateDataCenterEndpoint({ url: 'https://docs.example/mcp', headers: { 'mcp-session-id': 'override' } })).toThrow(/reservado/);
    const dir = mkdtempSync(join(tmpdir(), 'capivara-data-link-'));
    try {
      mkdirSync(join(dir, 'source')); writeFileSync(join(dir, 'source', 'config.json'), '{"version":1,"mcp":{"servers":[]}}');
      symlinkSync(join(dir, 'source', 'config.json'), join(dir, 'config.json'));
      const linked = resolveDataCenterEndpoint(undefined, {}, { legacyConfigPath: join(dir, 'config.json') });
      expect(linked.ok).toBe(false); expect(linked.availability.status).toBe('invalid-config');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
