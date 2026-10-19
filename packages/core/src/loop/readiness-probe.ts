import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { EnvironmentRequirement } from "../contract/environment.js";

/** Adapta apenas o destino inválido conhecido; a captura e o navegador continuam reais. */
export async function prepareReadinessProbe(requirement: EnvironmentRequirement): Promise<{ args: string[]; cleanup: () => Promise<void>; annotation: string }> {
  const args = [...(requirement.checkArgs ?? [])];
  if (basename(requirement.binary) !== "playwright" || args[0] !== "screenshot" || args.at(-1) !== "/dev/null") {
    return { args, cleanup: async () => undefined, annotation: "" };
  }
  const temporary = await mkdtemp(join(tmpdir(), "capivara-browser-ready-"));
  args[args.length - 1] = join(temporary, "ready.png");
  return { args, cleanup: () => rm(temporary, { recursive: true, force: true }),
    annotation: `Sonda de captura: /dev/null substituído por PNG temporário, removido após verificar. Argumentos efetivos: ${JSON.stringify(args)}\n` };
}
