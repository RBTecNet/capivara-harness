import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ProjectStore } from '../../src/app/store.js';
import { recoverOperation, RecoverySuspended } from '../../src/app/recovery.js';

describe('estado e continuidade novos', () => {
  it('publica o JSON autoritativo sem reinterpretar seus valores e inclui respostas atuais', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capivara-raw-snapshot-'));
    const store = new ProjectStore(dir), directory = join(dir, '.capivara-next');
    const writer = new DatabaseSync(join(directory, 'project.sqlite'));
    try {
      store.answer('early', 'Resposta antes do projeto');
      expect(JSON.parse(readFileSync(join(directory, 'project.snapshot.json'), 'utf8')).project).toEqual({});
      const body = '{"request":"ação \\n \\"citada\\"","counter":9007199254740993,"nested":{"raw":"\\u0061"}}';
      writer.prepare('INSERT INTO project VALUES(1,?)').run(body);
      store.answer('quoted', 'Resposta "atual"\ncom quebra');
      const snapshot = readFileSync(join(directory, 'project.snapshot.json'), 'utf8');
      expect(snapshot).toContain('"counter":9007199254740993');
      expect(snapshot).toContain('"raw":"\\u0061"');
      expect(JSON.parse(snapshot)).toEqual({ schema: 'capivara/recovery/1', project: JSON.parse(body), answers: [{ id: 'early', body: 'Resposta antes do projeto' }, { id: 'quoted', body: 'Resposta "atual"\ncom quebra' }] });
    } finally { writer.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('conserva a última cópia válida quando o corpo autoritativo deixa de ser um objeto JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capivara-invalid-snapshot-'));
    const store = new ProjectStore(dir), directory = join(dir, '.capivara-next');
    store.update({ request: 'Projeto preservado' });
    const valid = readFileSync(join(directory, 'project.snapshot.json'), 'utf8');
    const writer = new DatabaseSync(join(directory, 'project.sqlite'));
    try {
      for (const body of ['[]', 'null', 'false', '42', '"literal"', '{"broken"']) {
        writer.prepare('UPDATE project SET body=? WHERE id=1').run(body);
        store.answer('durable-answer', body);
        expect(store.getAnswer('durable-answer')).toBe(body);
        expect(readFileSync(join(directory, 'project.snapshot.json'), 'utf8')).toBe(valid);
      }
    } finally { writer.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
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
    let resource = 0;
    const result = await recoverOperation(async () => { if (++calls < 3) throw new Error('dependência indisponível'); completed.push('segundo fragmento'); return 'pronto'; }, { announce: () => {}, recover: async()=>{resource++;}, progressKey:()=>String(resource), wait: async () => {} });
    expect(result).toBe('pronto');
    expect(completed).toEqual(['primeiro fragmento', 'segundo fragmento']);
  });
  it('não repete uma operação sem alteração do estado necessário à recuperação',async()=>{
    let calls=0;
    await expect(recoverOperation(async()=>{calls++;throw new Error('same failure');},{announce:()=>{},wait:async()=>{}})).rejects.toBeInstanceOf(RecoverySuspended);
    expect(calls).toBe(1);
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
