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
  /**
   * `prompt` casa por trecho, e existe porque o papel `verifier` atende a duas
   * perguntas diferentes: verificar as tasks (gate 3) e redigir o roteiro de um
   * fluxo (gate 4). Sem distinguir as duas, um roteiro responderia à outra.
   */
  match: { role?: "builder" | "verifier"; phase?: string; attempt?: number; prompt?: string; purpose?: string; repair?: boolean };
  /**
   * Arquivos que a sessão escreve, relativos à raiz do projeto. Como função
   * quando o que se escreve depende do que já está na árvore da chamada.
   */
  writes?: { path: string; content: string }[] | ((call: EngineCall) => Promise<{ path: string; content: string }[]>);
  /** `stdout` como função quando a resposta depende do código que a sessão leria. */
  respond: { stdout: string | ((call: EngineCall) => Promise<string>); exitCode?: number; timedOut?: string | null };
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
        if (step.match.prompt !== undefined && !call.prompt.includes(step.match.prompt)) return false;
        if (step.match.purpose !== undefined && step.match.purpose !== call.purpose) return false;
        if (step.match.repair !== undefined && step.match.repair !== (call.repair === true)) return false;
        return true;
      });
      if (index === -1) {
        throw new Error(`chamada sem roteiro: role=${call.role} phase=${call.phase.id} attempt=${call.attempt}`);
      }
      const step = steps[index]!;
      if (step.match.attempt === undefined && step.repeat !== true) used.add(index);

      // No build paralelo a sessão escreve no worktree da fase, não na raiz.
      for (const file of typeof step.writes === "function" ? await step.writes(call) : (step.writes ?? [])) {
        const absolute = join(call.root ?? projectRoot, file.path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, file.content, "utf8");
      }

      return {
        exitCode: step.respond.exitCode ?? 0,
        stdout: typeof step.respond.stdout === "function" ? await step.respond.stdout(call) : step.respond.stdout,
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
