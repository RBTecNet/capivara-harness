import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function comDiretorioTemporario(verificar) {
  let diretorio;
  try {
    diretorio = await mkdtemp(join(tmpdir(), 'tarefas-teste-'));
    await verificar(diretorio);
  } finally {
    if (diretorio) await rm(diretorio, { recursive: true, force: true });
  }
}
