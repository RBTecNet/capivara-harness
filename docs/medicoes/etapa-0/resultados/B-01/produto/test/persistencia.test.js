import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gravarEstado, lerEstado, resolverArquivo } from '../src/persistencia.js';
import { comDiretorioTemporario } from './apoio.js';

test('resolve o arquivo padrão, caminhos relativos e caminhos absolutos', () => {
  const base = resolve('base-isolada');
  assert.equal(resolverArquivo(undefined, base), join(base, 'data', 'tasks.json'));
  assert.equal(resolverArquivo('outro/tarefas.json', base), join(base, 'outro/tarefas.json'));
  const absoluto = resolve('arquivo-absoluto.json');
  assert.equal(resolverArquivo(absoluto, base), absoluto);
});

test('retorna o estado inicial sem criar diretórios e propaga erros de leitura e JSON', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const pai = join(diretorio, 'ausente');
    assert.deepEqual(await lerEstado(join(pai, 'tarefas.json')), { proximoId: 1, tarefas: [] });
    await assert.rejects(stat(pai), { code: 'ENOENT' });
    await assert.rejects(lerEstado(diretorio), { code: 'EISDIR' });
    const invalido = join(diretorio, 'invalido.json');
    await writeFile(invalido, '{');
    await assert.rejects(lerEstado(invalido), SyntaxError);
    const arquivo = join(diretorio, 'arquivo');
    await writeFile(arquivo, 'conteúdo');
    await assert.rejects(lerEstado(join(arquivo, 'tarefas.json')), { code: 'ENOTDIR' });
  });
});

test('grava o documento completo, restringe os campos e mantém arquivos independentes', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'novo', 'tarefas.json');
    const outro = join(diretorio, 'outro.json');
    await gravarEstado(outro, { proximoId: 8, tarefas: [] });
    const originalDoOutro = await readFile(outro, 'utf8');
    await gravarEstado(caminho, {
      proximoId: 12,
      extra: 'ignorado',
      tarefas: [{ id: 11, title: 'Estudar', done: false, extra: 'ignorado' }],
    });
    assert.deepEqual(await lerEstado(caminho), {
      proximoId: 12,
      tarefas: [{ id: 11, title: 'Estudar', done: false }],
    });
    await gravarEstado(caminho, { proximoId: 12, tarefas: [] });
    assert.deepEqual(await lerEstado(caminho), { proximoId: 12, tarefas: [] });
    assert.equal(await readFile(outro, 'utf8'), originalDoOutro);
    assert.deepEqual(await readdir(join(diretorio, 'novo')), ['tarefas.json']);
  });
});

test('uma substituição recusada preserva o destino e limpa o arquivo temporário', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const destino = join(diretorio, 'destino');
    await mkdir(destino);
    await writeFile(join(destino, 'preservado'), 'conteúdo preservado');
    await assert.rejects(gravarEstado(destino, { proximoId: 1, tarefas: [] }));
    assert.equal(await readFile(join(destino, 'preservado'), 'utf8'), 'conteúdo preservado');
    assert.deepEqual(await readdir(diretorio), ['destino']);
  });
});
