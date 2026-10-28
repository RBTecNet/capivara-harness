import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ProjectStore } from '../../src/app/store.js';
import { recoverOperation } from '../../src/app/recovery.js';

describe('estado e continuidade novos', () => {
  it('persiste resposta imediatamente e mantém posse exclusiva sem outro dono liberar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capivara-state-'));
    const first = new ProjectStore(dir), second = new ProjectStore(dir);
    try {
      expect(first.claim()).toBe(true);
      expect(second.claim()).toBe(false);
      second.release();
      expect(second.claim()).toBe(false);
      first.answer('product-gap', 'TUI offline');
      first.update({ request: 'Gerenciador TUI', status: 'working' });
      expect(second.getAnswer('product-gap')).toBe('TUI offline');
      expect(second.read().request).toBe('Gerenciador TUI');
      first.release();
      expect(second.claim()).toBe(true);
    } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('incidente transitório é recuperado sem reiniciar trabalho concluído', async () => {
    const completed = ['primeiro fragmento']; let calls = 0;
    const result = await recoverOperation(async () => { if (++calls < 3) throw new Error('dependência indisponível'); completed.push('segundo fragmento'); return 'pronto'; }, { announce: () => {}, wait: async () => {} });
    expect(result).toBe('pronto');
    expect(completed).toEqual(['primeiro fragmento', 'segundo fragmento']);
  });
  it('não confunde bloqueio SQLite com corrupção nem divide o estado de uma execução ativa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capivara-active-state-'));
    const initial = new ProjectStore(dir);
    initial.update({ request: 'pedido confirmado anteriormente' }); initial.close();
    const directory = join(dir, '.capivara-next');
    const writer = new DatabaseSync(join(directory, 'project.sqlite'));
    try {
      writer.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;');
      writer.prepare('UPDATE project SET body=? WHERE id=1').run(JSON.stringify({ request: 'avanço da execução ativa' }));
      expect(() => new ProjectStore(dir)).toThrow(/locked|busy/i);
      expect(readdirSync(directory).filter(name => name.includes('.damaged-'))).toEqual([]);
      writer.exec('COMMIT'); writer.close();
      const recovered = new ProjectStore(dir);
      try { expect(recovered.read().request).toBe('avanço da execução ativa'); } finally { recovered.close(); }
    } finally { try { writer.close(); } catch { /* Already closed after the committed state was checked. */ } rmSync(dir, { recursive: true, force: true }); }
  });
  it('recupera pedido e resposta recém-recebida após corrupção comprovada do banco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capivara-corrupt-state-'));
    try {
      const initial = new ProjectStore(dir);
      initial.update({ request: 'Aplicação TUI offline', status: 'waiting' });
      initial.answer('pending-real-gap', 'Exportar JSON e CSV');
      initial.close();
      writeFileSync(join(dir, '.capivara-next', 'project.sqlite'), Buffer.alloc(4096, 35));
      const recovered = new ProjectStore(dir);
      try {
        expect(recovered.read().request).toBe('Aplicação TUI offline');
        expect(recovered.getAnswer('pending-real-gap')).toBe('Exportar JSON e CSV');
        recovered.update({ status: 'working' });
        expect(recovered.read().status).toBe('working');
      } finally { recovered.close(); }
      expect(readdirSync(join(dir, '.capivara-next')).some(name => name.includes('.damaged-'))).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
