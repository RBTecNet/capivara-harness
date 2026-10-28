import { resolve } from 'node:path';
import { execute } from './tasks.js';

function parseArguments(args) {
  const [command, argument] = args;
  if (!['list', 'add', 'done', 'remove'].includes(command)) {
    throw new Error('Comando desconhecido. Use: list, add TITULO, done ID ou remove ID.');
  }
  if (command === 'list') {
    if (args.length !== 1) throw new Error('Uso: list (sem argumentos).');
    return { command };
  }
  if (command === 'add') {
    if (args.length !== 2 || argument.trim() === '') {
      throw new Error('Informe um título não vazio. Uso: add "TITULO".');
    }
    return { command, value: argument.trim() };
  }
  if (args.length !== 2 || !/^\d+$/.test(argument)
      || !Number.isSafeInteger(Number(argument)) || Number(argument) <= 0) {
    throw new Error(`ID inválido: informe um inteiro positivo. Uso: ${command} ID.`);
  }
  return { command, value: Number(argument) };
}

try {
  const { command, value } = parseArguments(process.argv.slice(2));
  const file = resolve(process.env.TASKS_FILE ?? './data/tasks.json');
  const result = await execute(file, command, value);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
}
