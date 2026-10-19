/** Dados de migração/G2 pertencem à passagem, nunca ao banco local do usuário. */
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { bancosDeclarados } from "./passagem.js";
import type { TestRunner } from "./gates.js";

export async function criarBancosDeTeste(root: string, runner: TestRunner): Promise<{ runner: TestRunner; environment: Record<string, string>; limpar: () => Promise<void> }> {
  const declared = Object.entries(await bancosDeclarados(root));
  if (declared.length === 0) return { runner, environment: {}, limpar: async () => {} };
  const directory = await mkdtemp(join(tmpdir(), "capivara-g2-"));
  const environment: Record<string, string> = {};
  try {
    for (const [index, [key, value]] of declared.entries()) {
      const parent = join(directory, String(index));
      await mkdir(parent);
      environment[key] = join(parent, basename(value));
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    environment,
    runner: (command, cwd, extra) => runner(command, cwd, { ...extra, ...environment }),
    limpar: () => rm(directory, { recursive: true, force: true }),
  };
}

export async function comBancosDeTeste<T>(root: string, runner: TestRunner, execute: (isolated: TestRunner) => Promise<T>): Promise<T> {
  const scope = await criarBancosDeTeste(root, runner);
  try { return await execute(scope.runner); }
  finally { await scope.limpar(); }
}
