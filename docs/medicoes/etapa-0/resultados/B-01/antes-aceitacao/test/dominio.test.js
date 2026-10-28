import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { adicionar, concluir, ErroDeEntrada, listar, remover } from '../src/dominio.js';
import { gravarEstado, lerEstado } from '../src/persistencia.js';
import { comDiretorioTemporario } from './apoio.js';

const executar = promisify(execFile);
const moduloDominio = new URL('../src/dominio.js', import.meta.url).href;

async function emOutroProcesso(operacao, caminho, valor) {
  const codigo = `
    const dominio = await import(${JSON.stringify(moduloDominio)});
    const [operacao, caminho, valor] = JSON.parse(process.argv[1]);
    console.log(JSON.stringify(await dominio[operacao](caminho, valor)));
  `;
  const { stdout, stderr } = await executar(process.execPath, [
    '--input-type=module', '--eval', codigo, JSON.stringify([operacao, caminho, valor]),
  ]);
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

test('lista sem criar o arquivo e ordena numericamente sem alterar o documento', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const pai = join(diretorio, 'ausente');
    assert.deepEqual(await listar(join(pai, 'tarefas.json')), []);
    await assert.rejects(stat(pai), { code: 'ENOENT' });
    const caminho = join(diretorio, 'tarefas.json');
    await gravarEstado(caminho, {
      proximoId: 11,
      tarefas: [
        { id: 10, title: 'Dez', done: false },
        { id: 2, title: 'Dois', done: true },
      ],
    });
    const antes = await readFile(caminho, 'utf8');
    assert.deepEqual(await listar(caminho), [
      { id: 2, title: 'Dois', done: true },
      { id: 10, title: 'Dez', done: false },
    ]);
    assert.equal(await readFile(caminho, 'utf8'), antes);
  });
});

test('recusa títulos vazios, identificadores inválidos e tarefas inexistentes sem alterar dados', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'tarefas.json');
    await adicionar(caminho, 'Preservar');
    const antes = await readFile(caminho, 'utf8');
    await assert.rejects(adicionar(caminho, ' \t\n '), ErroDeEntrada);
    for (const operacao of [concluir, remover]) {
      for (const id of ['', '0', '-1', '1.5', 'abc', '1e0', 'Infinity', '9007199254740993', undefined]) {
        await assert.rejects(operacao(caminho, id), {
          name: 'ErroDeEntrada', message: 'O identificador deve ser um inteiro positivo.',
        });
      }
      await assert.rejects(operacao(caminho, '2'), {
        name: 'ErroDeEntrada', message: 'Não existe tarefa com o identificador 2.',
      });
    }
    assert.equal(await readFile(caminho, 'utf8'), antes);
    const pai = join(diretorio, 'ausente');
    const ausente = join(pai, 'tarefas.json');
    await assert.rejects(adicionar(ausente, '  '), ErroDeEntrada);
    await assert.rejects(concluir(ausente, '1'), ErroDeEntrada);
    await assert.rejects(remover(ausente, '1'), ErroDeEntrada);
    await assert.rejects(stat(pai), { code: 'ENOENT' });
  });
});

test('repetir a conclusão retorna a tarefa sem regravar o documento', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'tarefas.json');
    const tarefa = { id: 1, title: 'Concluída', done: true };
    const documento = JSON.stringify({ proximoId: 2, tarefas: [tarefa] }, null, 4);
    await writeFile(caminho, documento);
    const antes = await stat(caminho, { bigint: true });
    assert.deepEqual(await concluir(caminho, '1'), tarefa);
    assert.equal(await readFile(caminho, 'utf8'), documento);
    const depois = await stat(caminho, { bigint: true });
    assert.equal(depois.ino, antes.ino);
    assert.equal(depois.mtimeNs, antes.mtimeNs);
  });
});

test('preserva operações e sequência entre processos e mantém arquivos independentes', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'principal.json');
    const outro = join(diretorio, 'outro.json');
    assert.deepEqual(await emOutroProcesso('adicionar', caminho, '  Primeira  '), {
      id: 1, title: 'Primeira', done: false,
    });
    assert.deepEqual(await emOutroProcesso('adicionar', caminho, 'Segunda'), {
      id: 2, title: 'Segunda', done: false,
    });
    assert.deepEqual(await emOutroProcesso('listar', caminho), [
      { id: 1, title: 'Primeira', done: false },
      { id: 2, title: 'Segunda', done: false },
    ]);
    assert.deepEqual(await emOutroProcesso('concluir', caminho, '1'), {
      id: 1, title: 'Primeira', done: true,
    });
    assert.deepEqual(await emOutroProcesso('listar', caminho), [
      { id: 1, title: 'Primeira', done: true },
      { id: 2, title: 'Segunda', done: false },
    ]);
    assert.deepEqual(await emOutroProcesso('remover', caminho, '2'), { removed: 2 });
    assert.deepEqual(await emOutroProcesso('listar', caminho), [
      { id: 1, title: 'Primeira', done: true },
    ]);
    assert.deepEqual(await emOutroProcesso('remover', caminho, '1'), { removed: 1 });
    assert.deepEqual(await lerEstado(caminho), { proximoId: 3, tarefas: [] });
    assert.deepEqual(await emOutroProcesso('listar', caminho), []);
    assert.deepEqual(await emOutroProcesso('adicionar', caminho, 'Terceira'), {
      id: 3, title: 'Terceira', done: false,
    });
    assert.deepEqual(await emOutroProcesso('adicionar', outro, 'Independente'), {
      id: 1, title: 'Independente', done: false,
    });
    assert.deepEqual(await emOutroProcesso('listar', caminho), [
      { id: 3, title: 'Terceira', done: false },
    ]);
  });
});
