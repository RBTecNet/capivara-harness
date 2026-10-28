import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pid } from 'node:process';

let sequenciaTemporaria = 0;

export function resolverArquivo(valor, diretorioAtual) {
  return resolve(diretorioAtual, valor === undefined ? './data/tasks.json' : valor);
}

export async function lerEstado(caminho) {
  let documento;
  try {
    documento = await readFile(caminho, 'utf8');
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      return { proximoId: 1, tarefas: [] };
    }
    throw erro;
  }
  return JSON.parse(documento);
}

export async function gravarEstado(caminho, estado) {
  const documento = JSON.stringify({
    proximoId: estado.proximoId,
    tarefas: estado.tarefas.map(({ id, title, done }) => ({ id, title, done })),
  });
  const diretorio = dirname(caminho);
  await mkdir(diretorio, { recursive: true });
  const temporario = join(
    diretorio,
    `.${basename(caminho)}.${pid}.${Date.now()}.${++sequenciaTemporaria}.tmp`,
  );
  const arquivo = await open(temporario, 'wx');
  try {
    try {
      await arquivo.writeFile(`${documento}\n`, 'utf8');
    } finally {
      await arquivo.close();
    }
    await rename(temporario, caminho);
  } finally {
    await unlink(temporario).catch((erro) => {
      if (erro.code !== 'ENOENT') throw erro;
    });
  }
}
