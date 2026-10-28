import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

function validState(state) {
  if (state === null || typeof state !== 'object'
      || !Number.isSafeInteger(state.lastId) || state.lastId < 0
      || !Array.isArray(state.tasks)) return false;

  const ids = new Set();
  for (const task of state.tasks) {
    if (task === null || typeof task !== 'object'
        || !Number.isSafeInteger(task.id) || task.id <= 0
        || task.id > state.lastId || ids.has(task.id)
        || typeof task.title !== 'string' || task.title.trim() === ''
        || typeof task.done !== 'boolean') return false;
    ids.add(task.id);
  }
  return true;
}

export async function readState(file) {
  let contents;
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { lastId: 0, tasks: [] };
    throw error;
  }

  let state;
  try {
    state = JSON.parse(contents);
  } catch {
    throw new Error(`Arquivo de dados contém JSON inválido: ${file}`);
  }
  if (!validState(state)) {
    throw new Error(`Formato do arquivo de dados inválido: ${file}`);
  }
  return state;
}

async function writeState(file, state) {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = `${directory}/.${basename(file)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function execute(file, command, value) {
  const state = await readState(file);
  if (command === 'list') {
    return state.tasks.sort((a, b) => a.id - b.id);
  }
  if (command === 'add') {
    if (state.lastId === Number.MAX_SAFE_INTEGER) {
      throw new Error('Limite de IDs atingido; não é possível criar outra tarefa.');
    }
    const task = { id: ++state.lastId, title: value, done: false };
    state.tasks.push(task);
    await writeState(file, state);
    return task;
  }

  const index = state.tasks.findIndex((task) => task.id === value);
  if (index === -1) throw new Error(`Tarefa com ID ${value} não existe.`);
  const task = state.tasks[index];
  if (command === 'done') {
    if (!task.done) {
      task.done = true;
      await writeState(file, state);
    }
    return task;
  }
  state.tasks.splice(index, 1);
  await writeState(file, state);
  return { removed: value };
}
