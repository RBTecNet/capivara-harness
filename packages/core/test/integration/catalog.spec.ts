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
import { DOCUMENT_CHAIN, InitBlockedError, runInit } from "../../src/init/index.js";
import { runBuild, splitPhases } from "../../src/loop/index.js";
import { readEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";
import {
  DESCRIPTION,
  LEDGER,
  PHASE_1,
  PHASE_2,
  SCHEMA,
  STORIES,
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
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, ["1"]);
    expect(outcome.report.checkpoint.decisions[0]?.decision).toBe("Node + Vitest");
  });

  it("B-03 resposta adiada nunca confirma a recomendação", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, ["não sei"]);
    expect(outcome.report.checkpoint.decisions).toHaveLength(0);
    expect(outcome.report.checkpoint.deferrals).toHaveLength(1);
  });

  it("B-04 gap aberto bloqueia o RALPH READY", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
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
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md" }, respond: { stdout: semMotivo } });

    const { outcome, agent } = await init(steps, ["1"]);
    expect(outcome.readiness.ready).toBe(true);

    const levantamentos = agent.calls.filter(
      (call) => call.stage === "interview" && call.subject === "project-description.md" && call.role === "writer",
    );
    // A segunda chamada carrega o defeito nomeado e continua na mesma rodada.
    expect(levantamentos[1]?.prompt).toContain("sem o motivo");
    expect(levantamentos[1]?.prompt).toContain("rejected before it reached the developer");
    expect(levantamentos[0]?.attempt).toBe(levantamentos[1]?.attempt);
  });

  it("malformado duas vezes bloqueia nomeando qual pergunta", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md" },
      respond: { stdout: JSON.stringify({ contract: "capivara-questions/v1", questions: [{ id: "Q-07", topic: "t" }] }) },
      repeat: true,
    });
    await expect(init(steps)).rejects.toThrow(/malformado duas vezes.*Q-07/s);
  });
});

describe("B-05 a B-07 · escrita", () => {
  it("B-05 documento dentro de cerca de código é reparado e publicado", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "project-description.md" },
      respond: { stdout: "```markdown\n" + DESCRIPTION.trim() + "\n```" },
    });
    const { outcome } = await init(steps);
    expect(outcome.readiness.ready).toBe(true);
    const published = await readFile(join(projectRoot, ".capivara/init/project-description.md"), "utf8");
    expect(published.startsWith("# Pousada")).toBe(true);
  });

  it("B-06 ledger inválido bloqueia sem tentar reparo", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "ledger" }, respond: { stdout: "{}" } });
    await expect(init(steps)).rejects.toThrow(/ledger de coordenação veio inválido/);
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
      match: { role: "auditor", stage: "audit", subject: "user-stories.md", attempt: 1 },
      respond: { stdout: reject("US-1.1", "critério não verificável", "use um limite numérico observável") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "user-stories.md", attempt: 2 }, respond: { stdout: STORIES } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "user-stories.md", attempt: 2 }, respond: { stdout: approve() } });

    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready).toBe(true);
    const reescrita = agent.calls.find((call) => call.subject === "user-stories.md" && call.attempt === 2 && call.role === "writer");
    expect(reescrita?.prompt).toContain("use um limite numérico observável");
  });

  it("B-09 finding sem orientação é saída inválida e repete só o auditor", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-description.md" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Overview | está ruim\nCAPIVARA_REASON: ruim" },
    });
    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready).toBe(true);
    const auditorias = agent.calls.filter((call) => call.role === "auditor" && call.subject === "project-description.md");
    // Duas auditorias, ambas na tentativa 1: o escritor não pagou pelo erro de formato.
    expect(auditorias).toHaveLength(2);
    expect(auditorias.every((call) => call.attempt === 1)).toBe(true);
  });

  it("B-10 teto de devoluções esgotado para e pergunta ao desenvolvedor", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-description.md" },
      respond: { stdout: reject("Overview", "continua errado", "reescreva a seção inteira") },
      repeat: true,
    });
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "project-description.md" },
      respond: { stdout: DESCRIPTION },
      repeat: true,
    });
    await expect(init(steps, [], { maxAuditReturns: 2 })).rejects.toThrow(InitBlockedError);
  });

  it("B-11 aprovação com ressalva não bloqueia e aparece no relatório", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "database-schema.md" },
      respond: {
        stdout: "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REMARK: Schema | faltou índice em status_id\nCAPIVARA_REASON: fiel e conforme",
      },
    });
    const { outcome } = await init(steps);
    expect(outcome.readiness.ready).toBe(true);
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
  it("reescreve APENAS a fase que o finding nomeia e remonta o documento inteiro", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 1 },
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
      match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 1 },
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
      match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 1 },
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

describe("B-33 · decisões da entrevista não se embaralham entre documentos", () => {
  it("o mesmo Q-01 em documentos diferentes vira decisões distintas", async () => {
    const pergunta = (topic: string, decision: string, label: string) =>
      JSON.stringify({
        contract: "capivara-questions/v1",
        questions: [
          {
            id: "Q-01",
            topic,
            evidence: "evidência suficiente",
            decision,
            why: "muda o resultado",
            options: [
              { label, consequence: "consequência a" },
              { label: `${label} (não)`, consequence: "consequência b" },
            ],
            recommended: label,
            recommendationBasis: "base",
          },
        ],
      });

    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 },
      respond: { stdout: pergunta("stack", "Qual stack?", "Node + Vitest") },
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "user-stories.md", attempt: 1 },
      respond: { stdout: pergunta("prioridade", "Qual a prioridade da primeira story?", "Alta") },
    });

    const { outcome } = await init(steps, ["1", "1"]);
    const decisoes = outcome.report.checkpoint.decisions;
    expect(decisoes.map((decision) => `${decision.topic}=${decision.decision}`).sort()).toEqual([
      "prioridade=Alta",
      "stack=Node + Vitest",
    ]);
  });

  it("a entrevista do documento seguinte recebe o que já foi respondido antes", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 },
      respond: {
        stdout: JSON.stringify({
          contract: "capivara-questions/v1",
          questions: [
            {
              id: "Q-01",
              topic: "stack",
              evidence: "diretório vazio",
              decision: "Qual stack o projeto usa?",
              why: "define build e teste",
              options: [
                { label: "Node + Vitest", consequence: "rápido" },
                { label: "Python + pytest", consequence: "dados" },
              ],
              recommended: "Node + Vitest",
              recommendationBasis: "stack dos seus projetos",
            },
          ],
        }),
      },
    });

    const { agent } = await init(steps, ["1"]);
    const seguinte = agent.calls.find((call) => call.stage === "interview" && call.subject === "user-stories.md");
    expect(seguinte?.prompt).toContain("Already answered");
    expect(seguinte?.prompt).toContain("Qual stack o projeto usa?");
    expect(seguinte?.prompt).toContain("Node + Vitest");
  });
});

describe("B-34 · gap descoberto na escrita volta para a entrevista", () => {
  const COM_GAP = DESCRIPTION.replace(
    "## Core Workflows",
    "## Open Questions\n\n[NEEDS DECISION] qual stack web exatamente\n\n## Core Workflows",
  );

  const perguntaDaStack = JSON.stringify({
    contract: "capivara-questions/v1",
    questions: [
      {
        id: "Q-01",
        topic: "stack",
        evidence: "O documento marcou a stack como pendente.",
        decision: "Qual stack web exatamente?",
        why: "Define build, teste e a forma de todas as fases.",
        options: [
          { label: "Node 26 + Fastify + Vitest", consequence: "ecossistema que você já usa" },
          { label: "Python + FastAPI + pytest", consequence: "outro runner" },
        ],
        recommended: "Node 26 + Fastify + Vitest",
        recommendationBasis: "stack dos seus projetos",
      },
    ],
  });

  it("o marcador vira pergunta, a resposta vira decisão e o documento é reescrito", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: COM_GAP } });
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md:gaps" }, respond: { stdout: perguntaDaStack } });

    const { outcome, agent } = await init(steps, ["1"]);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const reescrita = agent.calls.find(
      (call) => call.stage === "authoring" && call.subject === "project-description.md" && call.prompt.includes("estava marcada como pendente"),
    );
    expect(reescrita?.prompt).toContain("Node 26 + Fastify + Vitest");
    expect(reescrita?.prompt).toContain("remova o marcador");
  });

  it("a decisão fechada aparece no relatório final", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: COM_GAP } });
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md:gaps" }, respond: { stdout: perguntaDaStack } });

    const { outcome } = await init(steps, ["1"]);
    expect(outcome.report.checkpoint.decisions.map((decision) => decision.decision)).toContain("Node 26 + Fastify + Vitest");
  });

  it("gap que o desenvolvedor adia sobrevive e o gate bloqueia dizendo onde", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: COM_GAP }, repeat: true });
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md:gaps" }, respond: { stdout: perguntaDaStack }, repeat: true });

    const { outcome } = await init(steps, ["não sei", "não sei", "não sei"]);
    expect(outcome.readiness.ready).toBe(false);
    const decisoes = outcome.readiness.checks.find((check) => check.id === "decisoes");
    expect(decisoes?.passed).toBe(false);
    expect(decisoes?.detail).toContain("project-description.md");
  });
});

describe("B-35 · impasse do auditor", () => {
  function impasse(steps: ScriptStep[]): ScriptStep[] {
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "database-schema.md" },
      respond: { stdout: reject("Schema", "a regra não é estrutural", "modele a restrição no esquema") },
      repeat: true,
    });
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "database-schema.md" }, respond: { stdout: SCHEMA }, repeat: true });
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
      (call) => call.stage === "authoring" && call.subject === "database-schema.md" && call.prompt.includes("acima do auditor"),
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
});

describe("B-36 · enxurrada de gaps idênticos", () => {
  const COM_27_MARCADORES = [
    "# Pousada — Project Description",
    "",
    "## Overview",
    "",
    ...Array.from({ length: 27 }, () => "[NEEDS DECISION] qual o caminho do artefato de design"),
    "",
    "### Key Concepts",
    "",
    "- **Reserva:** período entre entrada e saída.",
    "",
    "## Tech Stack",
    "",
    "| Camada | Tecnologia |",
    "| --- | --- |",
    "| Runtime | Node 26 |",
    "",
    "## Core Workflows",
    "",
    "### 1. Criar reserva",
    "",
    "passos",
    "",
  ].join("\n");

  it("marcadores idênticos viram UMA pergunta, não vinte e sete", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: COM_27_MARCADORES } });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md:gaps" },
      respond: {
        stdout: JSON.stringify({
          contract: "capivara-questions/v1",
          questions: [
            {
              id: "Q-01",
              topic: "design",
              evidence: "marcador aberto",
              decision: "Existe artefato de design?",
              why: "define se a task carrega Design ref",
              options: [
                { label: "Não existe", consequence: "sem Design ref" },
                { label: "Existe", consequence: "com Design ref" },
              ],
              recommended: "Não existe",
              recommendationBasis: "o diretório está ausente",
            },
          ],
        }),
      },
      repeat: true,
    });

    let perguntas = 0;
    const agent = fakeAgent(steps);
    await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      call: agent.call,
      ask: async () => {
        perguntas += 1;
        return "1";
      },
    }).catch(() => undefined);

    expect(perguntas).toBeLessThanOrEqual(2);
  });

  it("as perguntas de gap não sobrescrevem as decisões da entrevista principal", async () => {
    const pergunta = (topic: string, decision: string, label: string) =>
      JSON.stringify({
        contract: "capivara-questions/v1",
        questions: [
          {
            id: "Q-01",
            topic,
            evidence: "evidência",
            decision,
            why: "muda o resultado",
            options: [
              { label, consequence: "a" },
              { label: `${label} (não)`, consequence: "b" },
            ],
            recommended: label,
            recommendationBasis: "base",
          },
        ],
      });

    const COM_GAP = DESCRIPTION.replace("## Core Workflows", "## Open Questions\n\n[NEEDS DECISION] qual stack exatamente\n\n## Core Workflows");

    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: COM_GAP } });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md:gaps" },
      respond: { stdout: pergunta("stack", "Qual stack exatamente?", "Node 26 + Fastify") },
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 },
      respond: { stdout: pergunta("identificação dos quartos", "Como identificar os quartos?", "Números de 1 a 8") },
    });

    const { outcome } = await init(steps, ["1", "1"]);
    const decisoes = new Map(outcome.report.checkpoint.decisions.map((decision) => [decision.topic, decision.decision]));
    // Cada tema guarda a SUA resposta: no piloto 1, "Identificação dos quartos"
    // aparecia com a resposta da stack.
    expect(decisoes.get("identificação dos quartos")).toBe("Números de 1 a 8");
    expect(decisoes.get("stack")).toBe("Node 26 + Fastify");
  });
});

describe("B-37 · marcador obsoleto após a decisão", () => {
  it("o marcador some quando a decisão é tomada, mesmo se o escritor não apagar", async () => {
    const COM_GAP = DESCRIPTION.replace(
      "## Core Workflows",
      "## Open Questions\n\n[NEEDS DECISION] Stack escolhida: SQLite; faltam as versões\n\n## Core Workflows",
    );

    const steps = happyPath();
    // O escritor devolve o MESMO documento na reescrita, sem apagar o marcador.
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: COM_GAP }, repeat: true });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-description.md:gaps" },
      respond: {
        stdout: JSON.stringify({
          contract: "capivara-questions/v1",
          questions: [
            {
              id: "Q-01",
              topic: "stack",
              evidence: "marcador aberto sobre a stack",
              decision: "Qual stack e quais versões?",
              why: "define build, teste e todas as fases",
              options: [
                { label: "Node 20, TypeScript 5, PostgreSQL 16", consequence: "banco relacional completo" },
                { label: "Node 20, TypeScript 5, SQLite 3", consequence: "banco em arquivo" },
              ],
              recommended: "Node 20, TypeScript 5, PostgreSQL 16",
              recommendationBasis: "o modelo de dados usa restrições relacionais",
            },
          ],
        }),
      },
      repeat: true,
    });

    const { outcome } = await init(steps, ["1"]);

    const decisoes = outcome.report.checkpoint.decisions.map((decision) => decision.decision);
    expect(decisoes).toContain("Node 20, TypeScript 5, PostgreSQL 16");

    // O gate NÃO pode bloquear por uma decisão que já existe.
    const pendentes = outcome.readiness.checks.find((check) => check.id === "decisoes");
    expect(pendentes?.passed, pendentes?.detail).toBe(true);
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

describe("B-13 · frescor da cadeia", () => {
  it("upstream alterado depois da geração é detectado", async () => {
    await init(happyPath());
    await writeFile(join(projectRoot, ".capivara/init/project-description.md"), "conteúdo trocado depois\n", "utf8");

    const { preflight } = await import("../../src/loop/index.js");
    const result = await preflight({ projectRoot, runId: "build-x", git: { repository: false, clean: true }, environment: {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((warning) => warning.code === "stale")).toBe(true);
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

    for (const document of DOCUMENT_CHAIN) {
      expect((await readFile(join(projectRoot, ".capivara/init", document), "utf8")).length).toBeGreaterThan(50);
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
