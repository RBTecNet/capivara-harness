import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { comDiretorioTemporario } from './apoio.js';

const executar = promisify(execFile);
const entrada = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function executarComando(diretorio, argumentos, arquivo, porta) {
  const ambiente = { ...process.env };
  delete ambiente.TASKS_FILE;
  delete ambiente.PORT;
  if (arquivo !== undefined) ambiente.TASKS_FILE = arquivo;
  if (porta !== undefined) ambiente.PORT = porta;
  try {
    const { stdout, stderr } = await executar(process.execPath, [entrada, ...argumentos], {
      cwd: diretorio,
      env: ambiente,
      timeout: 10000,
    });
    return { codigo: 0, stdout, stderr };
  } catch (erro) {
    if (typeof erro.code !== 'number') throw erro;
    return { codigo: erro.code, stdout: erro.stdout, stderr: erro.stderr };
  }
}

function verificarSucesso(resposta, esperado) {
  assert.deepEqual(resposta, {
    codigo: 0, stdout: `${JSON.stringify(esperado)}\n`, stderr: '',
  });
}

async function comServidor(diretorio, arquivo, verificar) {
  let processo;
  let encerrado;
  let limite;
  let saida = '';
  let erros = '';
  try {
    processo = spawn(process.execPath, [entrada], {
      cwd: diretorio,
      env: { ...process.env, PORT: process.env.E2E_PORT ?? '0', TASKS_FILE: arquivo },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    encerrado = new Promise((resolver) => processo.once('close', resolver));
    processo.stderr.on('data', (dados) => { erros += dados; });
    const endereco = await new Promise((resolver, rejeitar) => {
      processo.once('error', rejeitar);
      processo.once('exit', () => rejeitar(new Error(`O servidor encerrou antes de iniciar: ${erros}`)));
      processo.stdout.on('data', (dados) => {
        saida += dados;
        const resultado = saida.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (resultado) resolver(resultado[0]);
      });
      limite = setTimeout(() => rejeitar(new Error('O servidor não iniciou no prazo de 10 segundos.')), 10000);
    });
    clearTimeout(limite);
    if (process.env.E2E_PORT && process.env.E2E_PORT !== '0') {
      assert.equal(new URL(endereco).port, process.env.E2E_PORT);
    }
    await verificar(endereco);
    assert.equal(erros, '');
  } finally {
    clearTimeout(limite);
    if (processo) {
      if (processo.exitCode === null && processo.signalCode === null) {
        processo.kill('SIGTERM');
      }
      const forcarEncerramento = setTimeout(() => processo.kill('SIGKILL'), 3000);
      try {
        await encerrado;
      } finally {
        clearTimeout(forcarEncerramento);
      }
    }
  }
}

test('com PORT, mantém HTTP ativo, consulta TASKS_FILE e recupera tarefas após reiniciar', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const arquivo = join(diretorio, 'selecionado', 'tarefas.json');
    const tarefa = { id: 1, title: 'Persistida pelo terminal', done: false };
    await comServidor(diretorio, arquivo, async (endereco) => {
      const resposta = await fetch(endereco, { signal: AbortSignal.timeout(5000) });
      assert.equal(resposta.status, 200);
      assert.match(resposta.headers.get('content-type'), /application\/json/);
      assert.deepEqual(await resposta.json(), []);
      await assert.rejects(stat(join(diretorio, 'selecionado')), { code: 'ENOENT' });
      verificarSucesso(await executarComando(diretorio, ['add', tarefa.title], arquivo, new URL(endereco).port), tarefa);
      const posterior = await fetch(endereco, { signal: AbortSignal.timeout(5000) });
      assert.deepEqual(await posterior.json(), [tarefa]);
    });
    const antes = await readFile(arquivo, 'utf8');
    await comServidor(diretorio, arquivo, async (endereco) => {
      const resposta = await fetch(endereco, { signal: AbortSignal.timeout(5000) });
      assert.equal(resposta.status, 200);
      assert.deepEqual(await resposta.json(), [tarefa]);
    });
    assert.equal(await readFile(arquivo, 'utf8'), antes);
    await assert.rejects(stat(join(diretorio, 'data')), { code: 'ENOENT' });
  });
});

test('o servidor informa falhas de leitura sem sobrescrever dados nem encerrar', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const arquivo = join(diretorio, 'tarefas.json');
    await writeFile(arquivo, '{');
    await comServidor(diretorio, arquivo, async (endereco) => {
      const resposta = await fetch(endereco, { signal: AbortSignal.timeout(5000) });
      assert.equal(resposta.status, 500);
      assert.deepEqual(await resposta.json(), {
        erro: 'Não foi possível ler as tarefas. Verifique o arquivo de dados e as permissões de acesso.',
      });
      assert.equal(await readFile(arquivo, 'utf8'), '{');
      await writeFile(arquivo, JSON.stringify({ proximoId: 1, tarefas: [] }));
      const recuperada = await fetch(endereco, { signal: AbortSignal.timeout(5000) });
      assert.equal(recuperada.status, 200);
      assert.deepEqual(await recuperada.json(), []);
    });
  });
});

test('recusa PORT inválida com mensagem explicativa em português', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    assert.deepEqual(await executarComando(diretorio, [], undefined, 'inválida'), {
      codigo: 1, stdout: '', stderr: 'PORT deve ser um inteiro entre 0 e 65535.\n',
    });
  });
});

test('sem comando, lista tarefas sem criar nem alterar dados e respeita TASKS_FILE', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    verificarSucesso(await executarComando(diretorio, []), []);
    await assert.rejects(stat(join(diretorio, 'data')), { code: 'ENOENT' });

    const padrao = { id: 1, title: 'Padrão', done: false };
    verificarSucesso(await executarComando(diretorio, ['add', padrao.title]), padrao);
    const caminhoPadrao = join(diretorio, 'data', 'tasks.json');
    const antesPadrao = await readFile(caminhoPadrao, 'utf8');
    verificarSucesso(await executarComando(diretorio, []), [padrao]);
    assert.equal(await readFile(caminhoPadrao, 'utf8'), antesPadrao);

    const selecionado = 'selecionado/tarefas.json';
    verificarSucesso(await executarComando(diretorio, [], selecionado), []);
    await assert.rejects(stat(join(diretorio, 'selecionado')), { code: 'ENOENT' });
    const tarefa = { id: 1, title: 'Selecionada', done: false };
    verificarSucesso(await executarComando(diretorio, ['add', tarefa.title], selecionado), tarefa);
    const caminhoSelecionado = join(diretorio, selecionado);
    const antesSelecionado = await readFile(caminhoSelecionado, 'utf8');
    verificarSucesso(await executarComando(diretorio, [], selecionado), [tarefa]);
    assert.equal(await readFile(caminhoSelecionado, 'utf8'), antesSelecionado);
    assert.equal(await readFile(caminhoPadrao, 'utf8'), antesPadrao);
  });
});

test('executa o fluxo completo em processos separados e preserva a sequência após remoções', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const arquivo = 'selecionado/tarefas.json';
    const executarAqui = (...argumentos) => executarComando(diretorio, argumentos, arquivo);
    verificarSucesso(await executarAqui('list'), []);
    await assert.rejects(stat(join(diretorio, 'selecionado')), { code: 'ENOENT' });
    const primeira = { id: 1, title: 'Comprar pão', done: false };
    const segunda = { id: 2, title: 'Estudar', done: false };
    verificarSucesso(await executarAqui('add', '  Comprar pão  '), primeira);
    verificarSucesso(await executarAqui('add', 'Estudar'), segunda);
    verificarSucesso(await executarAqui('list'), [primeira, segunda]);
    const concluida = { ...primeira, done: true };
    verificarSucesso(await executarAqui('done', '1'), concluida);
    verificarSucesso(await executarAqui('done', '1'), concluida);
    verificarSucesso(await executarAqui('list'), [concluida, segunda]);
    verificarSucesso(await executarAqui('remove', '2'), { removed: 2 });
    verificarSucesso(await executarAqui('list'), [concluida]);
    verificarSucesso(await executarAqui('remove', '1'), { removed: 1 });
    verificarSucesso(await executarAqui('list'), []);
    verificarSucesso(await executarAqui('add', 'Nova'), { id: 3, title: 'Nova', done: false });
    verificarSucesso(await executarComando(diretorio, ['add', 'Independente'], 'outro.json'), {
      id: 1, title: 'Independente', done: false,
    });
    verificarSucesso(await executarAqui('list'), [{ id: 3, title: 'Nova', done: false }]);
  });
});

test('usa o caminho padrão relativo ao diretório de trabalho e aceita seleção absoluta', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    verificarSucesso(await executarComando(diretorio, ['list']), []);
    await assert.rejects(stat(join(diretorio, 'data')), { code: 'ENOENT' });
    const tarefa = { id: 1, title: 'Padrão', done: false };
    verificarSucesso(await executarComando(diretorio, ['add', 'Padrão']), tarefa);
    const caminho = join(diretorio, 'data', 'tasks.json');
    assert.deepEqual(JSON.parse(await readFile(caminho, 'utf8')), {
      proximoId: 2, tarefas: [tarefa],
    });
    verificarSucesso(await executarComando(diretorio, ['list'], caminho), [tarefa]);
  });
});

test('lista por ordem numérica e imprime apenas os campos públicos sem alterar o arquivo', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'tarefas.json');
    const dez = { id: 10, title: 'Dez', done: false };
    const dois = { id: 2, title: 'Dois', done: true };
    const documento = JSON.stringify({ proximoId: 11, tarefas: [dez, dois] });
    await writeFile(caminho, documento);
    verificarSucesso(await executarComando(diretorio, ['list'], caminho), [dois, dez]);
    assert.equal(await readFile(caminho, 'utf8'), documento);
  });
});

test('recusa entradas com código 1 e mensagem do domínio sem alterar nem criar dados', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'tarefas.json');
    verificarSucesso(await executarComando(diretorio, ['add', 'Preservar'], caminho), {
      id: 1, title: 'Preservar', done: false,
    });
    const antes = await readFile(caminho, 'utf8');
    const recusas = [
      [['desconhecido'], 'Comando desconhecido. Use list, add, done ou remove.'],
      [['add'], 'O título da tarefa não pode ficar vazio.'],
      [['add', ' \t '], 'O título da tarefa não pode ficar vazio.'],
    ];
    for (const comando of ['done', 'remove']) {
      for (const argumentos of [[comando], ...['0', '-1', '1.5', 'abc', '1e0'].map((id) => [comando, id])]) {
        recusas.push([argumentos, 'O identificador deve ser um inteiro positivo.']);
      }
      recusas.push([[comando, '99'], 'Não existe tarefa com o identificador 99.']);
    }
    for (const arquivo of [caminho, join(diretorio, 'ausente', 'tarefas.json')]) {
      for (const [argumentos, mensagem] of recusas) {
        assert.deepEqual(await executarComando(diretorio, argumentos, arquivo), {
          codigo: 1, stdout: '', stderr: `${mensagem}\n`,
        });
        assert.equal(await readFile(caminho, 'utf8'), antes);
      }
    }
    await assert.rejects(stat(join(diretorio, 'ausente')), { code: 'ENOENT' });
  });
});

test('recusa comando desconhecido antes de ler dados e apresenta falhas de arquivo em português', async () => {
  await comDiretorioTemporario(async (diretorio) => {
    const caminho = join(diretorio, 'invalido.json');
    await writeFile(caminho, '{');
    assert.deepEqual(await executarComando(diretorio, ['desconhecido'], caminho), {
      codigo: 1, stdout: '', stderr: 'Comando desconhecido. Use list, add, done ou remove.\n',
    });
    assert.deepEqual(await executarComando(diretorio, ['list'], caminho), {
      codigo: 1,
      stdout: '',
      stderr: 'Não foi possível executar o comando. Verifique o arquivo de dados e as permissões de acesso.\n',
    });
    assert.equal(await readFile(caminho, 'utf8'), '{');
  });
});
