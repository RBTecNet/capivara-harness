import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'tarefas-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'nested', 'tasks.json');
  function run(args, selectedFile = file) {
    const env = { ...process.env };
    delete env.TASKS_FILE;
    if (selectedFile !== null) env.TASKS_FILE = selectedFile;
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: directory, env, encoding: 'utf8', timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return result;
  }
  function success(args, selectedFile) {
    const result = run(args, selectedFile);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  }
  return { directory, file, run, success };
}

function failure(result, message) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, message);
}

test('listar arquivo ausente retorna [] sem criar arquivo ou diretórios', (t) => {
  const { success, directory } = fixture(t);
  assert.deepEqual(success(['list']), []);
  assert.deepEqual(readdirSync(directory), []);
});

test('fluxo essencial persiste em processos separados e preserva os IDs', (t) => {
  const { success } = fixture(t);
  assert.deepEqual(success(['list']), []);
  const first = { id: 1, title: 'Comprar pão', done: false };
  const second = { id: 2, title: 'Ler um livro', done: false };
  assert.deepEqual(success(['add', '  Comprar pão\t']), first);
  assert.deepEqual(success(['add', second.title]), second);
  assert.deepEqual(success(['list']), [first, second]);
  assert.deepEqual(success(['done', '1']), { ...first, done: true });
  assert.deepEqual(success(['list']), [{ ...first, done: true }, second]);
  assert.deepEqual(success(['remove', '2']), { removed: 2 });
  assert.deepEqual(success(['list']), [{ ...first, done: true }]);
  assert.deepEqual(success(['add', 'Terceira']), { id: 3, title: 'Terceira', done: false });
});

test('remover todas as tarefas não reinicia o contador', (t) => {
  const { success } = fixture(t);
  success(['add', 'Primeira']);
  success(['add', 'Segunda']);
  success(['remove', '1']);
  success(['remove', '2']);
  assert.deepEqual(success(['list']), []);
  assert.deepEqual(success(['add', 'Terceira']), { id: 3, title: 'Terceira', done: false });
});

test('conclusão repetida é idempotente, inclusive no arquivo', (t) => {
  const { success, file } = fixture(t);
  success(['add', 'Estudar']);
  const done = success(['done', '1']);
  const before = readFileSync(file);
  assert.deepEqual(success(['done', '1']), done);
  assert.deepEqual(readFileSync(file), before);
});

const rejected = [
  { args: [], message: /Comando desconhecido/ },
  { args: ['unknown'], message: /Comando desconhecido/ },
  { args: ['list', 'extra'], message: /Uso: list/ },
  ...[[], [''], [' \t\n '], ['título', 'extra']].map((args) => ({
    args: ['add', ...args], message: /título não vazio/,
  })),
  ...['done', 'remove'].flatMap((command) => [
    ...[[], ['0'], ['-1'], ['1.5'], ['1e0'], ['abc'], [''], ['Infinity'],
      ['NaN'], [' 1 '], ['9007199254740992'], ['1', 'extra']].map((args) => ({
      args: [command, ...args], message: /ID inválido/,
    })),
    { args: [command, '999'], message: /não existe/ },
  ]),
];

test('entradas recusadas deixam os dados existentes byte a byte inalterados', (t) => {
  const { success, run, file } = fixture(t);
  success(['add', 'Preservar']);
  const before = readFileSync(file);
  for (const { args, message } of rejected) {
    failure(run(args), message);
    assert.deepEqual(readFileSync(file), before, JSON.stringify(args));
  }
  assert.deepEqual(success(['add', 'Seguinte']), { id: 2, title: 'Seguinte', done: false });
});

test('entradas recusadas não criam arquivo nem diretórios', (t) => {
  const { run, directory } = fixture(t);
  for (const { args, message } of rejected) failure(run(args), message);
  assert.deepEqual(readdirSync(directory), []);
});

test('arquivos diferentes têm tarefas e contadores independentes', (t) => {
  const { success, file, directory } = fixture(t);
  const otherFile = join(directory, 'other.json');
  const first = success(['add', 'Arquivo A'], file);
  const other = success(['add', 'Arquivo B'], otherFile);
  assert.equal(first.id, 1);
  assert.equal(other.id, 1);
  success(['remove', '1'], file);
  assert.deepEqual(success(['list'], otherFile), [other]);
  assert.equal(success(['add', 'Novo A'], file).id, 2);
  assert.equal(success(['add', 'Novo B'], otherFile).id, 2);
});

test('caminho padrão é relativo ao diretório de trabalho', (t) => {
  const { directory, success } = fixture(t);
  const defaultFile = join(directory, 'data', 'tasks.json');
  assert.deepEqual(success(['list'], null), []);
  assert.equal(existsSync(join(directory, 'data')), false);
  const task = success(['add', 'Padrão'], null);
  assert.equal(existsSync(defaultFile), true);
  assert.deepEqual(success(['list'], null), [task]);
});

test('TASKS_FILE relativo usa o diretório de trabalho e suporta espaços', (t) => {
  const { directory, success } = fixture(t);
  const relative = 'minhas tarefas/lista.json';
  const task = success(['add', 'Acentos, "aspas" e 🙂'], relative);
  assert.equal(existsSync(join(directory, relative)), true);
  assert.deepEqual(success(['list'], relative), [task]);
  assert.equal(existsSync(join(directory, 'data')), false);
});

test('listagem ordena por ID sem modificar o arquivo', (t) => {
  const { directory, success } = fixture(t);
  const file = join(directory, 'ordered.json');
  const tasks = [10, 2, 1].map((id) => ({ id, title: `Tarefa ${id}`, done: false }));
  writeFileSync(file, JSON.stringify({ lastId: 10, tasks }));
  const before = readFileSync(file);
  assert.deepEqual(success(['list'], file).map((task) => task.id), [1, 2, 10]);
  assert.deepEqual(readFileSync(file), before);
});

test('JSON corrompido ou estado inválido é recusado sem sobrescrever', (t) => {
  const { directory, run } = fixture(t);
  const file = join(directory, 'invalid.json');
  const task = { id: 1, title: 'Preservar', done: false };
  const invalidContents = [
    '{', '', 'null', '[]', '{}',
    JSON.stringify({ lastId: 0, tasks: [task] }),
    JSON.stringify({ lastId: 1, tasks: [task, task] }),
    JSON.stringify({ lastId: 1, tasks: [{ ...task, done: 'false' }] }),
    JSON.stringify({ lastId: 1, tasks: [{ ...task, title: ' ' }] }),
    JSON.stringify({ lastId: -1, tasks: [] }),
  ];
  for (const contents of invalidContents) {
    writeFileSync(file, contents);
    for (const args of [['list'], ['add', 'Nova'], ['done', '1'], ['remove', '1']]) {
      failure(run(args, file), /inválido/);
      assert.equal(readFileSync(file, 'utf8'), contents);
    }
  }
  assert.deepEqual(readdirSync(directory), ['invalid.json']);
});

test('limite de inteiro seguro recusa criação e preserva o estado', (t) => {
  const { directory, run } = fixture(t);
  const file = join(directory, 'limit.json');
  const contents = JSON.stringify({ lastId: Number.MAX_SAFE_INTEGER, tasks: [] });
  writeFileSync(file, contents);
  failure(run(['add', 'Sem ID disponível'], file), /Limite de IDs/);
  assert.equal(readFileSync(file, 'utf8'), contents);
});

test('erro de acesso ao arquivo retorna erro explicativo no stderr', (t) => {
  const { directory, run } = fixture(t);
  failure(run(['add', 'Tarefa'], directory), /Erro:/);
  assert.deepEqual(readdirSync(directory), []);
});
