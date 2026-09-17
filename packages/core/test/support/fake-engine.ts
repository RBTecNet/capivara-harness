/**
 * Provider falso do lado do loop.
 *
 * Diferente do falso documental, este precisa MATERIALIZAR ARQUIVOS: é assim
 * que o gate 1 vê a árvore mudar, o gate 2 tem o que rodar e o gate 3 tem
 * código real para ler. Um falso que só devolve texto exercitaria o parser dos
 * gates, não os gates.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EngineCall, EngineResult } from "../../src/loop/index.js";

export interface EngineStep {
  match: { role?: "builder" | "verifier"; phase?: string; attempt?: number };
  /** Arquivos que a sessão escreve, relativos à raiz do projeto. */
  writes?: { path: string; content: string }[];
  respond: { stdout: string; exitCode?: number; timedOut?: string | null };
  repeat?: boolean;
}

export interface FakeEngine {
  call: (call: EngineCall) => Promise<EngineResult>;
  calls: EngineCall[];
}

export function fakeEngine(projectRoot: string, steps: EngineStep[]): FakeEngine {
  const used = new Set<number>();
  const engine: FakeEngine = {
    calls: [],
    call: async (call) => {
      engine.calls.push(call);
      const index = steps.findIndex((step, position) => {
        if (used.has(position) && step.match.attempt === undefined && step.repeat !== true) return false;
        if (step.match.role !== undefined && step.match.role !== call.role) return false;
        if (step.match.phase !== undefined && step.match.phase !== call.phase.id) return false;
        if (step.match.attempt !== undefined && step.match.attempt !== call.attempt) return false;
        return true;
      });
      if (index === -1) {
        throw new Error(`chamada sem roteiro: role=${call.role} phase=${call.phase.id} attempt=${call.attempt}`);
      }
      const step = steps[index]!;
      if (step.match.attempt === undefined && step.repeat !== true) used.add(index);

      for (const file of step.writes ?? []) {
        const absolute = join(projectRoot, file.path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, file.content, "utf8");
      }

      return {
        exitCode: step.respond.exitCode ?? 0,
        stdout: step.respond.stdout,
        stderr: "",
        timedOut: step.respond.timedOut ?? null,
      };
    },
  };
  return engine;
}

/** Todas as tasks DONE, na quantidade que a fase declara. */
export function allDone(taskCount: number): string {
  return Array.from({ length: taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n");
}

export function someIncomplete(taskCount: number, missingIndex: number, missing: string): string {
  return Array.from({ length: taskCount }, (_, index) =>
    index + 1 === missingIndex ? `TASK ${index + 1}: INCOMPLETE — ${missing}` : `TASK ${index + 1}: DONE`,
  ).join("\n");
}
