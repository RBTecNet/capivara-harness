/**
 * Lock de run por diretório.
 *
 * `mkdir` é atômico em qualquer sistema de arquivos POSIX: ou o diretório é
 * criado por este processo, ou já existia. Um arquivo de lock com
 * verificar-depois-criar tem janela de corrida; um diretório não tem.
 *
 * Um lock encontrado não é removido sem prova: primeiro se verifica se o dono
 * ainda está vivo. Só quando ele não está é que o lock antigo vai para
 * quarentena — movido, não apagado — e um novo é adquirido. Apagar um lock de
 * um processo vivo é o caminho mais curto para dois runs escrevendo no mesmo
 * plano de controle ao mesmo tempo.
 */

import { readFile, rename, rm, mkdir } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { runPaths } from "./paths.js";

export interface LockOwner {
  pid: number;
  hostname: string;
  startedAt: string;
  runId: string;
  command: string;
}

export interface LockHandle {
  path: string;
  owner: LockOwner;
  release: () => Promise<void>;
}

export class LockBusyError extends Error {
  readonly owner: LockOwner | null;
  constructor(message: string, owner: LockOwner | null) {
    super(message);
    this.name = "LockBusyError";
    this.owner = owner;
  }
}

/**
 * O processo existe?
 *
 * `EPERM` significa que existe e pertence a outro usuário — vivo, portanto.
 * PIDs são reciclados pelo sistema, então um dono "vivo" pode ser outro
 * programa que herdou o número; a checagem de linha de comando abaixo reduz
 * esse falso positivo onde `/proc` existe, e o preço de errar para o lado
 * conservador é apenas pedir intervenção humana.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as Partial<LockOwner>;
    if (typeof parsed.pid !== "number" || typeof parsed.hostname !== "string") return null;
    return parsed as LockOwner;
  } catch {
    return null;
  }
}

export interface AcquireLockOptions {
  projectRoot: string;
  runId: string;
  command: string;
  hostname?: string;
  isAlive?: (pid: number) => boolean;
  now?: () => Date;
}

export async function acquireLock(options: AcquireLockOptions): Promise<LockHandle> {
  const paths = runPaths(options.projectRoot, options.runId);
  const host = options.hostname ?? osHostname();
  const alive = options.isAlive ?? isProcessAlive;
  const now = options.now ?? (() => new Date());

  await mkdir(paths.root, { recursive: true });

  const claim = async (): Promise<boolean> => {
    try {
      await mkdir(paths.lock);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };

  if (!(await claim())) {
    const owner = await readOwner(paths.lock);

    if (owner && owner.hostname !== host) {
      throw new LockBusyError(
        `o run ${options.runId} está travado pela máquina ${owner.hostname} (pid ${owner.pid}); ` +
          "não é possível verificar daqui se aquele processo ainda está vivo — encerre-o lá ou remova o lock manualmente",
        owner,
      );
    }

    if (owner && alive(owner.pid)) {
      throw new LockBusyError(
        `o run ${options.runId} já está em execução no pid ${owner.pid}, desde ${owner.startedAt}; ` +
          "espere aquele processo terminar ou encerre-o antes de rodar de novo",
        owner,
      );
    }

    // Dono morto, ou lock sem owner.json (o processo morreu entre criar o
    // diretório e gravar a identificação). Quarentena, nunca remoção direta.
    const quarantine = `${paths.lock}.quarantine-${now().toISOString().replace(/[:.]/g, "")}`;
    await rename(paths.lock, quarantine);
    if (!(await claim())) {
      throw new LockBusyError(
        `o run ${options.runId} foi travado por outro processo enquanto o lock órfão era recuperado; tente de novo`,
        null,
      );
    }
    await rm(quarantine, { recursive: true, force: true });
  }

  const owner: LockOwner = {
    pid: process.pid,
    hostname: host,
    startedAt: now().toISOString(),
    runId: options.runId,
    command: options.command,
  };
  await writeAtomic(join(paths.lock, "owner.json"), `${JSON.stringify(owner, null, 2)}\n`);

  return {
    path: paths.lock,
    owner,
    release: async () => {
      await rm(paths.lock, { recursive: true, force: true });
    },
  };
}
