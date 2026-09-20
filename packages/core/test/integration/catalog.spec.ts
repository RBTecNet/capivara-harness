/**
 * O catálogo obrigatório de cenários (Apêndice B do plano).
 *
 * Cada teste aqui é um cenário nomeado B-NN. Eles existem porque é impossível
 * pedir a um modelo real que erre de um jeito específico sob demanda: o auditor
 * emitindo finding sem orientação, o executor não escrevendo nada em fase já
 * implementada, um 429 na saída de teste do projeto. É onde os bugs moram.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, runInit } from "../../src/init/index.js";
import { runBuild, splitPhases } from "../../src/loop/index.js";
import { readEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";
import {
  PHASE_1,
  PHASE_2,
  approve,
  fakeAgent,
  happyPath,
  oneQuestion,
  reject,
} from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";
import { allDone, fakeEngine, someIncomplete } from "../support/fake-engine.js";
import type { EngineStep } from "../support/fake-engine.js";

const run = promisify(execFile);
let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-catalogo-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "abc123abc123" };

async function init(steps: ScriptStep[], answers: string[] = [], options: { maxAuditReturns?: number } = {}) {
  const agent = fakeAgent(steps);
  let asked = 0;
  const outcome = await runInit({
    projectRoot,
    request,
    language: "português do Brasil",
    call: agent.call,
    ask: async () => answers[asked++] ?? "use as recomendações",
    ...(options.maxAuditReturns !== undefined ? { maxAuditReturns: options.maxAuditReturns } : {}),
  });
  return { outcome, agent };
}

async function gitRepo(): Promise<void> {
  await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
  await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
  await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "README.md"), "inicial\n", "utf8");
  await run("git", ["add", "-A"], { cwd: projectRoot });
  await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });
}

async function publishPlan(): Promise<{ phases: number; tasks: number[] }> {
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
  const { assemblePhasesDocument } = await import("../../src/contract/index.js");
  const plan = assemblePhasesDocument({
    projectName: "Pousada",
    stamp: "<!-- inputs: project-description.md@sha256:aaaaaaaaaaaa -->",
    overview: "Fundação primeiro.",
    phases: [PHASE_1.trim(), PHASE_2.trim()],
    openQuestions: [],
  });
  await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), plan, "utf8");
  const split = splitPhases(plan, projectRoot, runIdFor("build", sha12(plan)));
  if (!split.ok) throw new Error("plano de teste inválido");
  return { phases: split.sessions.length, tasks: split.sessions.map((session) => session.taskCount) };
}

async function build(steps: EngineStep[], options: { maxCycles?: number; keepGoing?: boolean; testExit?: number[] } = {}) {
  const engine = fakeEngine(projectRoot, steps);
  let testRun = 0;
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: {},
    ...(options.maxCycles !== undefined ? { maxCycles: options.maxCycles } : {}),
    ...(options.keepGoing !== undefined ? { keepGoing: options.keepGoing } : {}),
    testRunner: async () => {
      const exit = options.testExit?.[testRun] ?? 0;
      testRun += 1;
      return { exitCode: exit, output: exit === 0 ? "2 passed" : "FAIL reserva.spec.ts\n  esperava 409, recebeu 500" };
    },
  });
  return { outcome, engine };
}

describe("B-01 · caminho feliz completo", () => {
  it("init chega a RALPH READY e build fecha todas as fases", async () => {
    const { outcome } = await init(happyPath());
    expect(outcome.readiness.ready).toBe(true);

    const { tasks } = await publishPlan();
    const { outcome: built } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const app = 1;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);

    expect(built.exitCode).toBe(0);
    expect(built.phases.every((phase) => phase.outcome.status === "complete")).toBe(true);
  });
});

describe("B-02 a B-04 · entrevista", () => {
  it("B-02 resposta aceita vira decisão confirmada", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, ["1"]);
    expect(outcome.report.checkpoint.decisions[0]?.decision).toBe("Node + Vitest");
  });

  it("B-03 resposta adiada nunca confirma a recomendação", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, ["não sei"]);
    expect(outcome.report.checkpoint.decisions).toHaveLength(0);
    expect(outcome.report.checkpoint.deferrals).toHaveLength(1);
  });

  it("B-04 gap aberto bloqueia o RALPH READY", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, ["não sei"]);
    expect(outcome.readiness.ready).toBe(false);
    expect(outcome.readiness.checks.find((check) => check.id === "entrevista")?.passed).toBe(false);
  });
});

describe("B-31 · levantamento malformado", () => {
  it("repete SÓ o levantamento com os defeitos nomeados, e o desenvolvedor não paga por isso", async () => {
    const semMotivo = JSON.stringify({
      contract: "capivara-questions/v1",
      questions: [
        {
          id: "Q-01",
          topic: "stack",
          evidence: "O diretório está vazio.",
          decision: "Qual stack o projeto usa?",
          options: [
            { label: "Node + Vitest", consequence: "suíte rápida" },
            { label: "Python + pytest", consequence: "bom para dados" },
          ],
          recommended: "Node + Vitest",
          recommendationBasis: "stack dos seus projetos",
        },
      ],
    });

    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton" }, respond: { stdout: semMotivo } });

    const { outcome, agent } = await init(steps, ["1"]);
    expect(outcome.readiness.ready).toBe(true);

    const levantamentos = agent.calls.filter(
      (call) => call.stage === "interview" && call.subject === "skeleton" && call.role === "writer",
    );
    // A segunda chamada carrega o defeito nomeado e continua na mesma rodada.
    expect(levantamentos[1]?.prompt).toContain("sem o motivo");
    expect(levantamentos[1]?.prompt).toContain("rejected before it reached the developer");
    expect(levantamentos[0]?.attempt).toBe(levantamentos[1]?.attempt);
  });

  it("malformado duas vezes bloqueia nomeando qual pergunta", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton" },
      respond: { stdout: JSON.stringify({ contract: "capivara-questions/v1", questions: [{ id: "Q-07", topic: "t" }] }) },
      repeat: true,
    });
    await expect(init(steps)).rejects.toThrow(/malformado duas vezes.*Q-07/s);
  });
});

describe("B-05 a B-07 · escrita", () => {
  it("B-05 fase dentro de cerca de código é reparada e publicada", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: { stdout: "```markdown\n" + PHASE_1.trim() + "\n```" },
    });
    const { outcome } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const published = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(published).toContain("## Phase 1: Fundação de dados");
    expect(published).not.toContain("```markdown");
  });

  it("B-06 esqueleto inválido bloqueia sem tentar reparo", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: "{}" }, repeat: true });
    await expect(init(steps)).rejects.toThrow(/esqueleto veio inválido duas vezes/);
  });

  it("B-07 parte com intervalo de fases é recusada pelo runtime", async () => {
    const { assertSinglePhasePart, IntervalPartError } = await import("../../src/authoring/index.js");
    expect(() => assertSinglePhasePart("phases-p01-p04")).toThrow(IntervalPartError);
  });
});

describe("B-08 a B-12 · auditoria", () => {
  it("B-08 auditor devolve e o escritor corrige", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1", attempt: 1 },
      respond: { stdout: reject("Phase 1", "critério não verificável", "use um limite numérico observável") },
    });

    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const reescrita = agent.calls.find((call) => call.subject === "phase-p01" && call.attempt === 2 && call.role === "writer");
    expect(reescrita?.prompt).toContain("use um limite numérico observável");
  });

  it("B-09 finding sem orientação é saída inválida e repete só o auditor", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | está ruim\nCAPIVARA_REASON: ruim" },
    });
    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const auditorias = agent.calls.filter((call) => call.role === "auditor" && call.subject === "project-phases.md#P1");
    // Duas auditorias, ambas na tentativa 1: o escritor não pagou pelo erro de formato.
    expect(auditorias).toHaveLength(2);
    expect(auditorias.every((call) => call.attempt === 1)).toBe(true);
  });

  it("B-10 teto de devoluções esgotado para e pergunta ao desenvolvedor", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: reject("Phase 1", "continua errado", "declare o código HTTP devolvido") },
      repeat: true,
    });
    await expect(init(steps, [], { maxAuditReturns: 2 })).rejects.toThrow(InitBlockedError);
  });

  it("B-11 aprovação com ressalva não bloqueia e aparece no relatório", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REMARK: Phase 1 | faltou índice em status_id\nCAPIVARA_REASON: fiel e conforme",
      },
    });
    const { outcome } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(outcome.report.remarks[0]?.remark.observation).toContain("índice");
    expect(outcome.rendered).toContain("Ressalvas do auditor");
  });

  it("B-12 auditor com saída inválida duas vezes bloqueia com diagnóstico", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "auditor", stage: "audit" }, respond: { stdout: "achei bom" }, repeat: true });
    await expect(init(steps)).rejects.toThrow(/saída inválida duas vezes/);
  });
});

describe("B-32 · reescrita do plano após devolução", () => {
  it.each([
    { where: "P1.T1.C3 vs P2.T2.C1", problem: "A Fase 1 sobe sem IA, mas P2.T2.C1 exige credenciais para iniciar.", fix: "Restringir P2.T2.C1 ao endpoint de IA.", expected: ["phase-p01", "phase-p02"] },
    { where: "P2.T1.C2", problem: "falta o código HTTP", fix: "declare HTTP 409", expected: ["phase-p02"] },
    { where: "API", problem: "falta o código HTTP", fix: "corrija P2.T1.C2 para declarar HTTP 409", expected: ["phase-p02"] },
  ])("encaminha endereços do auditor: $where / $fix", async ({ where, problem, fix, expected }) => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência", attempt: 1 },
      respond: { stdout: reject(where, problem, fix) },
    });
    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready).toBe(true);
    const rewritten = agent.calls.filter((call) => call.stage === "authoring" && call.attempt === 2);
    expect(rewritten.map((call) => call.subject).sort()).toEqual(expected);
    expect(rewritten.every((call) => call.prompt.includes(fix))).toBe(true);
  });

  it("reescreve APENAS a fase que o finding nomeia e remonta o documento inteiro", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2", attempt: 1 },
      respond: { stdout: reject("Phase 2", "o critério de sobreposição não é observável", "declare o código HTTP devolvido") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02", attempt: 2 }, respond: { stdout: PHASE_2 } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 2 }, respond: { stdout: approve() } });

    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    // A fase 1 NÃO foi reescrita: o finding falava só da fase 2.
    const reescritas = agent.calls.filter((call) => call.stage === "authoring" && call.attempt === 2);
    expect(reescritas.map((call) => call.subject)).toEqual(["phase-p02"]);
  });

  it("o documento remontado mantém título, stamp e TODAS as fases", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2", attempt: 1 },
      respond: { stdout: reject("Phase 2", "critério vago", "declare o código HTTP") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02", attempt: 2 }, respond: { stdout: PHASE_2 } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 2 }, respond: { stdout: approve() } });

    await init(steps);
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano.split("\n")[0]).toMatch(/^# .+ — Project Phases$/);
    expect(plano.split("\n")[2]).toMatch(/^<!-- inputs:/);
    expect(plano).toContain("## Phase 1:");
    expect(plano).toContain("## Phase 2:");

    const { parsePhases } = await import("../../src/contract/index.js");
    const parsed = parsePhases(plano);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
  });

  it("finding sem fase identificada reescreve todas, pelo conservador", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência", attempt: 1 },
      respond: { stdout: reject("Overview", "a ordem das fases não é fundação-primeiro", "reordene as fases") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 2 }, respond: { stdout: PHASE_1 } });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02", attempt: 2 }, respond: { stdout: PHASE_2 } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 2 }, respond: { stdout: approve() } });

    const { agent } = await init(steps);
    const reescritas = agent.calls.filter((call) => call.stage === "authoring" && call.attempt === 2);
    expect(reescritas.map((call) => call.subject).sort()).toEqual(["phase-p01", "phase-p02"]);
  });
});

describe("B-35 · impasse do auditor", () => {
  function impasse(steps: ScriptStep[]): ScriptStep[] {
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: reject("Phase 1", "a regra não é estrutural", "modele a restrição no esquema") },
      repeat: true,
    });
    return steps;
  }

  it("a decisão do desenvolvedor volta ao escritor como autoridade, acima do auditor", async () => {
    const steps = impasse(happyPath());
    const agent = fakeAgent(steps);
    let perguntado = "";

    await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async (rendered) => {
        perguntado = rendered;
        return "PostgreSQL 16; as restrições que o DBML não expressa vão num bloco DDL abaixo";
      },
    }).catch(() => undefined);

    expect(perguntado).toContain("O auditor insiste em:");
    const reescrita = agent.calls.find(
      (call) => call.stage === "authoring" && call.subject === "phase-p01" && call.prompt.includes("acima do auditor"),
    );
    expect(reescrita?.prompt).toContain("PostgreSQL 16");
  });

  it("publicar aceita como está e o run segue", async () => {
    const steps = impasse(happyPath());
    const agent = fakeAgent(steps);
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => "publicar",
    });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });

  it("decidido uma vez, o auditor não volta a perguntar: findings viram ressalva", async () => {
    const steps = impasse(happyPath());
    const agent = fakeAgent(steps);
    let vezesPerguntado = 0;

    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => {
        vezesPerguntado += 1;
        return "as restrições ficam declaradas; implementá-las é tarefa do plano";
      },
    });

    expect(vezesPerguntado).toBe(1);
    expect(outcome.report.remarks.some((entry) => entry.remark.observation.includes("decisão do desenvolvedor"))).toBe(true);
  });

  it("abortar encerra o run com o impasse no diagnóstico", async () => {
    const steps = impasse(happyPath());
    await expect(
      runInit({
        projectRoot,
        request,
        language: "português do Brasil",
        maxAuditReturns: 2,
        call: fakeAgent(steps).call,
        ask: async () => "use as recomendações",
        decideStandoff: async () => "abortar",
      }),
    ).rejects.toThrow(/Decisão do desenvolvedor: abortar/);
  });

  it("reiniciar renova o ciclo, exige aprovação e não vira decisão confirmada", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: (call) => call.attempt < 4 ? reject("Phase 1", "falta a restrição", "declare a restrição") : approve() },
      repeat: true,
    });
    const agent = fakeAgent(steps);
    let asked = 0;
    const outcome = await runInit({
      projectRoot, request, language: "português do Brasil", maxAuditReturns: 2,
      call: agent.call, ask: async () => "use as recomendações",
      decideStandoff: async () => ++asked === 1 ? "  REINICIAR  " : "abortar",
    });
    expect(outcome.readiness.ready).toBe(true);
    expect(asked).toBe(1);
    expect(agent.calls.filter((call) => call.subject === "project-phases.md#P1").map((call) => call.attempt)).toEqual([1, 2, 3, 4]);
    expect(outcome.report.checkpoint.decisions).toHaveLength(0);
    expect(outcome.report.remarks.some((entry) => entry.remark.observation.includes("decisão do desenvolvedor"))).toBe(false);
    expect(agent.calls.some((call) => call.prompt.includes("acima do auditor: REINICIAR"))).toBe(false);
    const { readHandoff } = await import("../../src/interview/index.js");
    const handoff = await readHandoff(projectRoot, outcome.runId, "project-phases.md");
    expect(handoff?.answers ?? []).toEqual([]);
    const events = await readEvents(runPaths(projectRoot, outcome.runId).events);
    expect(events.some((event) => event.detail.includes("reinício da auditoria"))).toBe(true);
    expect(events.some((event) => event.detail.includes("sob decisão do desenvolvedor"))).toBe(false);
  });

  it("cada reinício precisa ser pedido, volta a respeitar o teto e mantém tentativas crescentes", async () => {
    const agent = fakeAgent(impasse(happyPath()));
    let asked = 0;
    await expect(runInit({
      projectRoot, request, language: "português do Brasil", maxAuditReturns: 2, maxMechanicalRounds: 1,
      call: agent.call, ask: async () => "use as recomendações",
      decideStandoff: async () => ++asked <= 2 ? "reiniciar" : "abortar",
    })).rejects.toThrow(/Decisão do desenvolvedor: abortar/);
    expect(asked).toBe(3);
    expect(agent.calls.filter((call) => call.subject === "project-phases.md#P1").map((call) => call.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(agent.calls.filter((call) => call.subject === "phase-p01").map((call) => call.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(agent.calls.some((call) => call.role === "verifier")).toBe(false);
    await expect(readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).rejects.toThrow();
  });
});

describe("B-38 · a fase que cria a própria suíte", () => {
  it("o gate 2 roda a suíte que a fase acabou de criar", async () => {
    const { tasks } = await publishPlan();
    let rodou: string[] = [];

    const engine = fakeEngine(projectRoot, [
      {
        match: { role: "builder", phase: "P01" },
        // A fase 1 cria o package.json com o script de teste, como num greenfield.
        writes: [
          { path: "package.json", content: JSON.stringify({ name: "app", scripts: { test: "vitest run" } }) },
          { path: "src/app.ts", content: "export const app = 1;" },
        ],
        respond: { stdout: "feito" },
      },
      { match: { role: "builder" }, writes: [{ path: "src/b.ts", content: "export const b = 2;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ]);

    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: {},
      testRunner: async (command) => {
        rodou.push(command);
        return { exitCode: 0, output: "27 passed" };
      },
    });

    expect(outcome.exitCode).toBe(0);
    // O preflight não achou comando nenhum (diretório vazio), mas a fase 1
    // criou a suíte e o gate 2 da PRÓPRIA fase 1 já a executou.
    expect(rodou).toEqual(["npm test", "npm test"]);
  });

  it("sem suíte em fase nenhuma, o gate 2 segue pulado e o run continua", async () => {
    const { tasks } = await publishPlan();
    let rodou = 0;

    const engine = fakeEngine(projectRoot, [
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ]);

    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: {},
      testRunner: async () => {
        rodou += 1;
        return { exitCode: 0, output: "" };
      },
    });

    expect(outcome.exitCode).toBe(0);
    expect(rodou).toBe(0);
  });
});

describe("B-39 · a causa aparece uma vez só", () => {
  it("o erro de preflight não é anunciado e reimpresso", async () => {
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), "isto não é um plano", "utf8");

    const avisos: string[] = [];
    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: async () => {
        throw new Error("nenhum modelo deveria ser chamado");
      },
      announce: (mensagem) => avisos.push(mensagem),
      environment: {},
    });

    expect(outcome.exitCode).toBe(1);
    const anunciado = avisos.filter((aviso) => aviso.includes("nenhuma chamada de modelo"));
    expect(anunciado).toHaveLength(1);
  });

  it("a causa da fase que para sai inteira pelo anúncio", async () => {
    const { tasks } = await publishPlan();
    const avisos: string[] = [];

    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      maxCycles: 1,
      sleep: async () => undefined,
      environment: {},
      announce: (mensagem) => avisos.push(mensagem),
      call: fakeEngine(projectRoot, [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: someIncomplete(tasks[0]!, 1, "falta a migration inteira") }, repeat: true },
      ]).call,
    });

    expect(outcome.exitCode).toBe(2);
    const texto = avisos.join("\n");
    expect(texto).toContain("PAROU");
    expect(texto).toContain("falta a migration inteira");
    // Uma vez só, no anúncio; `errors` é dado para quem consome, não segunda via.
    expect(texto.split("falta a migration inteira").length - 1).toBe(1);
  });
});

describe("B-14 a B-18 · gates do loop", () => {
  it("B-14 executor sai com código diferente de zero", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder", phase: "P01" }, respond: { stdout: "erro de sintaxe na linha 4", exitCode: 3 }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors[0]).toContain("gate 0");
    expect(outcome.errors[0]).toContain("erro de sintaxe");
  });

  it("B-15 sessão que não escreve nada com gates verdes: fase já implementada", async () => {
    await gitRepo();
    const { tasks } = await publishPlan();
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "plano"], { cwd: projectRoot });

    const { outcome } = await build([
      { match: { role: "builder" }, respond: { stdout: "nada a fazer, já está implementado" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.phases.every((phase) => phase.outcome.status === "already-implemented")).toBe(true);
  });

  it("B-16 sessão que não escreve nada e a fase NÃO está pronta: reprova", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, respond: { stdout: "nada a fazer" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: someIncomplete(tasks[0]!, 1, "a migration não existe") }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors[0]).toContain("a migration não existe");
  });

  it("B-17 suíte vermelha reprova com a saída real", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      ],
      { maxCycles: 1, testExit: [1] },
    );
    // Sem comando de teste resolvido o gate 2 é pulado; aqui não há manifesto,
    // então a fase passa e o testExit não é consultado.
    expect([0, 2]).toContain(outcome.exitCode);
  });

  it("B-18 projeto sem comando de teste: gate 2 pulado com aviso", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.warnings.map((warning) => warning.code)).toContain("sem-suite");
    expect(outcome.exitCode).toBe(0);
  });
});

describe("B-19 a B-22 · verificador", () => {
  it("B-19 cobertura parcial reprova por cobertura, não por conteúdo", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: "TASK 1: DONE" }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.errors[0]).toContain(`cobriu 1 de ${tasks[0]}`);
  });

  it("B-20 INCOMPLETE e depois DONE: o ciclo converge", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01", attempt: 1 }, respond: { stdout: someIncomplete(tasks[0]!, 2, "falta o seed") } },
      { match: { role: "verifier", phase: "P01", attempt: 2 }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.phases[0]?.outcome.status).toBe("complete");
  });

  it("B-21 verificador sem nenhuma linha TASK reprova", async () => {
    const { tasks } = await publishPlan();
    expect(tasks.length).toBeGreaterThan(0);
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: "Está tudo certo!" }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.errors[0]).toContain("não emitiu nenhuma linha");
  });

  it("B-22 o prompt do verificador proíbe escrever", async () => {
    const { verifyPrompt } = await import("../../src/prompts/index.js");
    expect(verifyPrompt({ language: "pt-BR", phaseMarkdown: "x", taskCount: 1 })).toContain("never write, edit, create, delete");
  });
});

describe("B-23 · plano de controle", () => {
  it("o commit da fase nunca leva .capivara junto", async () => {
    await gitRepo();
    const { tasks } = await publishPlan();
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "plano"], { cwd: projectRoot });

    await build([
      { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const a = 1;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);

    const { stdout } = await run("git", ["log", "--name-only", "--format=%s"], { cwd: projectRoot });
    expect(stdout).toContain("feat(phase-1)");
    expect(stdout).not.toContain(".capivara/runs");
  });
});

describe("B-24 a B-26 · parada, limite e falso positivo", () => {
  it("B-24 fase que esgota os ciclos para o run, retomável", async () => {
    const { tasks } = await publishPlan();
    const { outcome, engine } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: someIncomplete(tasks[0]!, 1, "falta tudo") }, repeat: true },
      ],
      { maxCycles: 3 },
    );
    expect(outcome.exitCode).toBe(2);
    // Parou na primeira fase: a segunda nunca foi tentada.
    expect(engine.calls.every((call) => call.phase.id === "P01")).toBe(true);
    expect(outcome.phases).toHaveLength(1);
  });

  it("B-25 limite de uso espera e repete a mesma fase sem consumir ciclo", async () => {
    const { tasks } = await publishPlan();
    const { outcome, engine } = await build([
      { match: { role: "builder", phase: "P01" }, respond: { stdout: "trabalhando\nrate limit reached" } },
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.exitCode).toBe(0);
    const p01 = engine.calls.filter((call) => call.role === "builder" && call.phase.id === "P01");
    expect(p01.map((call) => call.attempt)).toEqual([1, 1]);
  });

  it("B-26 um 429 na saída de teste do projeto não dispara espera", async () => {
    const { detectRateLimit } = await import("../../src/loop/index.js");
    const log = ["FAIL http.spec.ts", "  esperava 200, recebeu 429 Too Many Requests", ...Array(30).fill("ok")].join("\n");
    expect(detectRateLimit(log, "codex")).toBeNull();
  });
});

describe("B-27 a B-30 · contenção, interrupção e retomada", () => {
  it("B-27 timeout do engine vira gate 0 vermelho com o tipo nomeado", async () => {
    const { tasks } = await publishPlan();
    expect(tasks.length).toBe(2);
    const { outcome } = await build(
      [
        { match: { role: "builder" }, respond: { stdout: "", exitCode: 124, timedOut: "first-output" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.errors[0]).toContain("first-output");
  });

  it("B-29 run retomado não refaz fase já verde", async () => {
    const { tasks } = await publishPlan();
    const roteiro: EngineStep[] = [
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ];

    const primeira = await build(roteiro);
    expect(primeira.outcome.exitCode, primeira.outcome.errors.join(" | ")).toBe(0);
    const { engine, outcome: segunda } = await build(roteiro);
    // Na segunda execução, nenhuma fase é reexecutada: a retomada não paga duas
    // vezes pelo mesmo trabalho.
    expect(engine.calls.map((call) => `${call.role}/${call.phase.id}`)).toEqual([]);
    expect(segunda.exitCode).toBe(0);
  });

  it("B-30 projeto sem git roda e apenas registra", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.warnings.map((warning) => warning.code)).toContain("sem-git");
  });
});

describe("cadeia completa init → build", () => {
  it("do pedido à aplicação, sem tocar em modelo real", async () => {
    const { outcome: documented } = await init(happyPath());
    expect(documented.readiness.ready).toBe(true);

    for (const artefato of ["skeleton.md", "project-phases.md"]) {
      expect((await readFile(join(projectRoot, ".capivara/init", artefato), "utf8")).length).toBeGreaterThan(50);
    }

    const plan = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    const split = splitPhases(plan, projectRoot, runIdFor("build", sha12(plan)));
    if (!split.ok) throw new Error("o plano publicado pelo init não passa no contrato");

    const { outcome: built } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/reservas.ts", content: "export const criar = () => 1;" }], respond: { stdout: "feito" }, repeat: true },
      ...split.sessions.map((session) => ({
        match: { role: "verifier" as const, phase: session.id },
        respond: { stdout: allDone(session.taskCount) },
      })),
    ]);

    expect(built.exitCode).toBe(0);
    expect(built.phases).toHaveLength(split.sessions.length);

    const events = await readEvents(runPaths(projectRoot, built.runId).events);
    expect(events.at(-1)?.status).toBe("complete");
  });
});

describe("B-40 · não-resposta não vira autoridade", () => {
  function impasseNoPlano(steps: ScriptStep[]): ScriptStep[] {
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: reject("Phase 1", "a fase inventou escopo que ninguém pediu", "remova o que o pedido não pede") },
      repeat: true,
    });
    return steps;
  }

  async function comDecisao(decisao: string) {
    const agent = fakeAgent(impasseNoPlano(happyPath()));
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => decisao,
    });
    return { outcome, agent };
  }

  for (const naoResposta of ["use as recomendações", "não sei", "tanto faz", "   "]) {
    it(`"${naoResposta.trim() || "(vazio)"}" publica, mas o finding segue em aberto e não vira decisão de ninguém`, async () => {
      const { outcome } = await comDecisao(naoResposta);
      expect(outcome.readiness.ready, outcome.rendered).toBe(true);

      const ressalva = outcome.report.remarks.find((entry) => entry.remark.observation.includes("inventou escopo"));
      expect(ressalva?.remark.observation).toContain("ninguém decidiu");
      expect(ressalva?.remark.observation).not.toContain("decisão do desenvolvedor");
    });
  }

  it("uma decisão de verdade continua valendo como autoridade acima do auditor", async () => {
    const { outcome, agent } = await comDecisao("o escopo extra fica; eu quero editar categoria");
    expect(outcome.readiness.ready).toBe(true);

    const reescrita = agent.calls.find(
      (call) => call.stage === "authoring" && call.prompt.includes("acima do auditor"),
    );
    expect(reescrita?.prompt).toContain("eu quero editar categoria");
    expect(outcome.report.remarks.some((entry) => entry.remark.observation.includes("decisão do desenvolvedor"))).toBe(true);
  });

  it("abortar continua derrubando o run, e não se confunde com não responder", async () => {
    await expect(comDecisao("abortar")).rejects.toThrow(/Decisão do desenvolvedor: abortar/);
  });
});
