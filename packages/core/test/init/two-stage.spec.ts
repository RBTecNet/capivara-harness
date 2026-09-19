/**
 * O ciclo em dois estágios: init entrega as fases, plan as detalha.
 *
 * O corte fica onde o custo muda de ordem de grandeza — o `init` é uma chamada,
 * o `plan` são dezenas. Errar a divisão do produto passa a custar minutos em vez
 * de horas, porque o esqueleto é pequeno o bastante para se olhar antes de pagar
 * pelo detalhe.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, evaluatePlanReadiness, runInit, runPlan } from "../../src/init/index.js";
import { parseSkeleton } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { SKELETON, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-ciclo-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };

const comum = {
  language: "português do Brasil" as const,
  ask: async () => "use as recomendações",
};

async function init(steps: ScriptStep[]) {
  const agent = fakeAgent(steps);
  const outcome = await runInit({ projectRoot, request, ...comum, mode: "skeleton", stage: "init", call: agent.call });
  return { outcome, agent };
}

async function plan(steps: ScriptStep[]) {
  const agent = fakeAgent(steps);
  const outcome = await runPlan({ projectRoot, request, ...comum, call: agent.call });
  return { outcome, agent };
}

const esqueletoLido = (): Skeleton => {
  const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
  if (!lido.ok) throw new Error("fixture inválida");
  return lido.skeleton;
};

describe("estágio 1 — init", () => {
  it("entrega as fases e para em PLAN READY", async () => {
    const { outcome } = await init(skeletonPath());
    expect(outcome.rendered).toContain("PLAN READY");
    expect(outcome.readiness.ready).toBe(true);
    expect(outcome.report.phases).toBe(2);
  });

  it("não detalha fase nenhuma: quem detalha é o plan", async () => {
    const { agent } = await init(skeletonPath());
    expect(agent.calls.some((call) => call.subject.startsWith("phase-"))).toBe(false);
    await expect(readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8")).rejects.toThrow();
  });

  it("custa poucas chamadas: é o estágio barato de errar", async () => {
    const { agent } = await init(skeletonPath());
    expect(agent.calls.length).toBeLessThanOrEqual(3);
  });

  it("publica o esqueleto para ser lido antes de pagar pelo detalhe", async () => {
    await init(skeletonPath());
    const esqueleto = await readFile(join(projectRoot, ".capivara", "init", "skeleton.md"), "utf8");
    expect(esqueleto).toContain("## Fases");
    expect(esqueleto).toContain("Regras transversais");
  });
});

describe("estágio 2 — plan", () => {
  it("retoma o esqueleto do init e chega a RALPH READY", async () => {
    await init(skeletonPath());
    const { outcome } = await plan(skeletonPath());

    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    expect(plano).toContain("Phase 1");
    expect(plano).toContain("Phase 2");
  });

  it("não reescreve o esqueleto nem reentrevista", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    expect(agent.calls.some((call) => call.subject === "skeleton")).toBe(false);
    expect(agent.calls.some((call) => call.stage === "interview")).toBe(false);
  });

  it("sem init antes, diz o que fazer em vez de tentar adivinhar", async () => {
    await expect(plan(skeletonPath())).rejects.toThrow(/capivara init/);
  });

  it("cada fase continua vendo só a sua fatia", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const fase2 = agent.calls.find((call) => call.subject === "phase-p02");
    expect(fase2?.prompt).toContain("US-1.1");
    expect(fase2?.prompt).not.toContain("pertence a statuses");
  });
});

describe("o gate PLAN READY", () => {
  it("story que nenhuma fase entrega bloqueia", () => {
    const esqueleto = esqueletoLido();
    const semCobertura: Skeleton = {
      ...esqueleto,
      stories: [...esqueleto.stories, { id: "US-9.9", statement: "algo que ninguém constrói" }],
    };
    const readiness = evaluatePlanReadiness({ skeleton: semCobertura, unresolvedQuestions: [] });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === "cobertura")?.detail).toContain("US-9.9");
  });

  it("fase que depende do futuro bloqueia: o loop não volta atrás", () => {
    const esqueleto = esqueletoLido();
    const invertido: Skeleton = {
      ...esqueleto,
      phases: esqueleto.phases.map((phase) => (phase.number === 1 ? { ...phase, dependsOn: "Phase 2" } : phase)),
    };
    const readiness = evaluatePlanReadiness({ skeleton: invertido, unresolvedQuestions: [] });
    expect(readiness.checks.find((check) => check.id === "ordem")?.passed).toBe(false);
  });

  it("regra transversal vaga bloqueia: é o acordo entre fases que não se veem", () => {
    const esqueleto = esqueletoLido();
    const vaga: Skeleton = { ...esqueleto, rules: [{ subject: "", statement: "normalizar" }] };
    const readiness = evaluatePlanReadiness({ skeleton: vaga, unresolvedQuestions: [] });
    expect(readiness.checks.find((check) => check.id === "regras")?.passed).toBe(false);
  });

  it("decisão em aberto bloqueia", () => {
    const readiness = evaluatePlanReadiness({ skeleton: esqueletoLido(), unresolvedQuestions: ["stack: qual banco"] });
    expect(readiness.ready).toBe(false);
  });

  it("esqueleto íntegro passa", () => {
    expect(evaluatePlanReadiness({ skeleton: esqueletoLido(), unresolvedQuestions: [] }).ready).toBe(true);
  });

  it("sem esqueleto, o gate diz que falta rodar o init", () => {
    const readiness = evaluatePlanReadiness({ skeleton: null, unresolvedQuestions: [] });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks[0]?.detail).toContain("init");
  });
});
