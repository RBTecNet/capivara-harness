/**
 * Escrita durável.
 *
 * Nenhum arquivo de estado é escrito no lugar: o conteúdo vai para um temporário
 * no mesmo diretório, é sincronizado no disco e só então entra por `rename`, que
 * é atômico dentro do mesmo sistema de arquivos. Um `kill -9` no meio de uma
 * escrita deixa o alvo intacto — com o conteúdo anterior ou ausente, nunca pela
 * metade. Queda de energia não pode transformar evidência em lixo.
 */

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

async function syncDirectory(directory: string): Promise<void> {
  // Garante que o próprio rename chegou ao disco. Nem todo sistema de arquivos
  // permite abrir um diretório; onde não permite, a falha é benigna.
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* sem suporte: o rename continua atômico, apenas sem a garantia extra */
  }
}

export async function writeAtomic(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Acrescenta uma linha a um log append-only, sincronizando antes de retornar. */
export async function appendLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`, "utf8");
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Remove temporários órfãos deixados por uma interrupção anterior.
 *
 * Eles nunca são visíveis como estado — o alvo só existe depois do rename —,
 * mas acumulam e confundem quem inspeciona o diretório de um run.
 */
export async function sweepTemporaries(directory: string): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(".") || !entry.endsWith(".tmp")) continue;
    await unlink(join(directory, entry)).catch(() => undefined);
    removed += 1;
  }
  return removed;
}
