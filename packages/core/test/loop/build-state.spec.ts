import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild } from "../../src/loop/build.js";
import { readRunState, restoreRun, runPaths } from "../../src/state/index.js";
import { VALID_PHASES } from "../contract/fixture.js";

let projectRoot: string;
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-build-state-"));
  await mkdir(join(projectRoot, ".capivara/init"), { recursive: true });
  await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), VALID_PHASES);
});
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

async function execute(approve: boolean, now: Date) {
  return runBuild({
    projectRoot, language: "pt-BR", engine: "codex", gitInit: false,
    skipAcceptance: true, skipFlows: true, maxCycles: 1,
    environment: {}, now: () => now,
    explicitTestCommand: "node --version",
    roles: { builder: { provider: "codex", model: "luna", effort: "high" } },
    testRunner: async () => ({ exitCode: 0, output: "ok" }),
    call: async (call) => ({
      exitCode: 0, stderr: "", timedOut: null,
      stdout: call.role === "verifier"
        ? Array.from({ length: call.phase.taskCount }, (_, index) => `TASK ${index + 1}: ${approve ? "DONE" : "INCOMPLETE — falta validar os dados; corrigir a validação e executar o teste"}`).join("\n")
        : "feito",
    }),
  });
}

describe("snapshot do build acompanha o desfecho", () => {
  it("grava a conclusão e a origem do plano", async () => {
    const outcome = await execute(true, new Date("2026-10-17T18:00:00Z"));
    expect(outcome.exitCode, outcome.errors.join("\n")).toBe(0);
    const state = await readRunState(projectRoot, outcome.runId);
    expect(state).toMatchObject({ status: "complete", stage: "complete" });
    expect(state?.sources).toEqual([expect.objectContaining({ name: "project-phases.md" })]);
    expect(state?.roles.builder?.model).toBe("luna");
    expect((await restoreRun(projectRoot, outcome.runId))?.state.status).toBe("complete");
  });

  it("registra pausa e preserva a criação do run ao retomar", async () => {
    const first = await execute(false, new Date("2026-10-17T18:00:00Z"));
    expect(first.exitCode).toBe(2);
    expect(await readRunState(projectRoot, first.runId)).toMatchObject({ status: "paused", stage: "implement" });
    await writeFile(join(runPaths(projectRoot, first.runId).logs, "P01.verify-4.log"), "ciclo da tentativa anterior");
    const resumed = await execute(true, new Date("2026-10-17T19:00:00Z"));
    expect(resumed.exitCode, resumed.errors.join("\n")).toBe(0);
    expect(await readRunState(projectRoot, resumed.runId)).toMatchObject({
      status: "complete", createdAt: "2026-10-17T18:00:00.000Z", updatedAt: "2026-10-17T19:00:00.000Z",
    });
    const root = runPaths(projectRoot, resumed.runId).root;
    const attempts = await readdir(join(root, "attempts"));
    expect(attempts).toHaveLength(1);
    const previous = join(root, "attempts", attempts[0]!);
    expect(JSON.parse(await readFile(join(previous, "run.json"), "utf8")).status).toBe("paused");
    expect(await readFile(join(previous, "logs/P01.verify-1.log"), "utf8")).toContain("INCOMPLETE");
    expect(await readFile(join(previous, "logs/P01.verify-4.log"), "utf8")).toContain("tentativa anterior");
    expect(await readFile(join(root, "logs/P01.verify-4.log"), "utf8").catch(() => null)).toBeNull();
    expect(await readFile(join(root, "logs/P01.verify-1.log"), "utf8")).toContain("DONE");
  });
});
