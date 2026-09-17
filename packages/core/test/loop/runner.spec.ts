import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPhase, splitPhases } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseSession } from "../../src/loop/index.js";
import { readEvents, runPaths } from "../../src/state/index.js";
import { VALID_PHASES } from "../contract/fixture.js";

const run = promisify(execFile);
let projectRoot = "";
const RUN = "build-abc123abc123";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-runner-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function session(): PhaseSession {
  const split = splitPhases(VALID_PHASES, projectRoot, RUN);
  if (!split.ok) throw new Error("plano inválido");
  return split.sessions[0]!;
}

const ok = (stdout = "feito"): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });

interface Scenario {
  builder?: (call: EngineCall) => Promise<EngineResult>;
  verifier?: (call: EngineCall) => Promise<EngineResult>;
  testExit?: number[];
  commits?: boolean;
  maxCycles?: number;
}

async function phase(scenario: Scenario) {
  const calls: EngineCall[] = [];
  let testRun = 0;
  const target = session();

  const outcome = await runPhase({
    projectRoot,
    runId: RUN,
    language: "pt-BR",
    engine: "codex",
    session: target,
    testCommand: { command: "npm test", source: "teste", containerized: false },
    commitsEnabled: scenario.commits ?? false,
    maxCycles: scenario.maxCycles ?? 3,
    sleep: async () => undefined,
    call: async (call) => {
      calls.push(call);
      if (call.role === "verifier") {
        return scenario.verifier
          ? scenario.verifier(call)
          : ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"));
      }
      // O executor escreve algo, para o gate 1 sinalizar mudança.
      await writeFile(join(projectRoot, `fase-${call.attempt}.ts`), `export const x = ${call.attempt};`, "utf8");
      return scenario.builder ? scenario.builder(call) : ok();
    },
    testRunner: async () => {
      const exit = scenario.testExit?.[testRun] ?? 0;
      testRun += 1;
      return { exitCode: exit, output: exit === 0 ? "2 passed" : "FAIL reserva.spec.ts\n  esperava 409, recebeu 500" };
    },
  });

  return { outcome, calls, target };
}

describe("ciclo de fase — caminho verde", () => {
  it("fecha a fase quando os quatro gates ficam verdes", async () => {
    const { outcome } = await phase({});
    expect(outcome.status).toBe("complete");
  });

  it("grava o prompt e o log de cada ciclo, auditáveis", async () => {
    const { target } = await phase({});
    const paths = runPaths(projectRoot, RUN);
    expect((await readFile(join(paths.prompts, `${target.id}.cycle-1.txt`), "utf8")).length).toBeGreaterThan(100);
    expect(await readFile(join(paths.logs, `${target.id}.verify-1.log`), "utf8")).toContain("TASK 1: DONE");
  });

  it("registra eventos que permitem retomar", async () => {
    await phase({});
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.at(-1)).toMatchObject({ subject: "P01", status: "complete" });
  });
});

describe("a palavra do agente nunca supera um gate", () => {
  it("executor declara COMPLETE mas a suíte está vermelha: reprova mesmo assim", async () => {
    const { outcome } = await phase({
      builder: async () => ok("pronto\nCAPIVARA_BUILDER_STATUS: COMPLETE"),
      testExit: [1, 1, 1],
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.gate).toBe("gate 2 — suíte do projeto");
  });

  it("executor declara COMPLETE mas o verificador vê task incompleta: reprova", async () => {
    const { outcome } = await phase({
      builder: async () => ok("CAPIVARA_BUILDER_STATUS: COMPLETE"),
      verifier: async () => ok("TASK 1: DONE\nTASK 2: INCOMPLETE — falta o seed"),
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.cause).toContain("falta o seed");
  });
});

describe("ciclos de correção", () => {
  it("a segunda tentativa recebe a causa REAL da falha", async () => {
    const { calls } = await phase({ testExit: [1, 0] });
    const correcao = calls.find((call) => call.role === "builder" && call.attempt === 2);
    expect(correcao?.prompt).toContain("esperava 409, recebeu 500");
    expect(correcao?.prompt).toContain("gate 2");
  });

  it("converge quando o ciclo seguinte conserta", async () => {
    const { outcome } = await phase({ testExit: [1, 0] });
    expect(outcome.status).toBe("complete");
    if (outcome.status === "complete") expect(outcome.cycles).toBe(2);
  });

  it("esgotados os ciclos, PARA e reporta — não segue para a próxima fase", async () => {
    const { outcome, calls } = await phase({ testExit: [1, 1, 1], maxCycles: 3 });
    expect(outcome.status).toBe("failed");
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(3);
  });

  it("G0 vermelho também vira ciclo de correção com a saída do engine", async () => {
    const { outcome } = await phase({ builder: async () => ({ exitCode: 3, stdout: "erro de sintaxe na linha 4", stderr: "", timedOut: null }) });
    if (outcome.status !== "failed") throw new Error("deveria falhar");
    expect(outcome.gate).toBe("gate 0 — engine");
    expect(outcome.cause).toContain("erro de sintaxe");
  });
});

describe("fase já implementada", () => {
  it("sessão que não escreve nada, com gates verdes, fecha sem commit", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const target = session();
    const outcome = await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: target,
      testCommand: null,
      commitsEnabled: true,
      sleep: async () => undefined,
      call: async (call) =>
        call.role === "verifier"
          ? ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"))
          : ok("nada a fazer: já está implementado"),
    });

    expect(outcome.status).toBe("already-implemented");
  });
});

describe("commit por fase", () => {
  it("fase verde com árvore suja gera um commit", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const { outcome } = await phase({ commits: true });
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    expect(outcome.committed).toBe(true);
    const { stdout } = await run("git", ["log", "--format=%s", "-1"], { cwd: projectRoot });
    expect(stdout.trim()).toBe("feat(phase-1): Fundação de dados");
  });

  it("sem git, roda e apenas registra", async () => {
    const { outcome } = await phase({ commits: false });
    if (outcome.status !== "complete") throw new Error("deveria completar");
    expect(outcome.committed).toBe(false);
  });
});

describe("limite de uso", () => {
  it("espera e repete a MESMA fase sem consumir ciclo", async () => {
    let tentativa = 0;
    const target = session();
    const builderCalls: number[] = [];

    const outcome = await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: target,
      testCommand: null,
      commitsEnabled: false,
      maxCycles: 2,
      sleep: async () => undefined,
      call: async (call) => {
        if (call.role === "verifier") {
          return ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"));
        }
        builderCalls.push(call.attempt);
        tentativa += 1;
        await writeFile(join(projectRoot, `f${tentativa}.ts`), "x", "utf8");
        return tentativa === 1 ? ok("trabalhando\nrate limit reached") : ok("feito");
      },
    });

    expect(outcome.status).toBe("complete");
    // Duas chamadas ao executor, ambas no ciclo 1: a espera não consumiu ciclo.
    expect(builderCalls).toEqual([1, 1]);
  });
});
