/**
 * O ciclo em dois estágios: init entrega as fases, plan as detalha.
 *
 * O corte fica onde o custo muda de ordem de grandeza — o `init` é uma chamada,
 * o `plan` são dezenas. Errar a divisão do produto passa a custar minutos em vez
 * de horas, porque o esqueleto é pequeno o bastante para se olhar antes de pagar
 * pelo detalhe.
 */

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, evaluatePlanReadiness, runInit, runPlan } from "../../src/init/index.js";
import { parseSkeleton } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { PHASE_1, SKELETON, fakeAgent, oneQuestion, skeletonPath } from "../support/fake-agent.js";
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

async function init(steps: ScriptStep[], ask?: (typeof comum)["ask"]) {
  const agent = fakeAgent(steps);
  const outcome = await runInit({ projectRoot, request, ...comum, stage: "init", call: agent.call, ...(ask ? { ask } : {}) });
  return { outcome, agent };
}

async function plan(steps: ScriptStep[], ask?: (typeof comum)["ask"]) {
  const agent = fakeAgent(steps);
  const outcome = await runPlan({ projectRoot, request, ...comum, call: agent.call, ...(ask ? { ask } : {}) });
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

describe("a entrevista do plan — o que só a escrita da fase descobre", () => {
  /** A fase 1 sai com uma decisão em aberto; o resto do roteiro é o feliz. */
  function comLacuna(): ScriptStep[] {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: { stdout: `${PHASE_1}\n[NEEDS DECISION] qual provedor de email envia a confirmação\n` },
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: { stdout: oneQuestion("Q-G1") },
    });
    return steps;
  }

  it("marcador deixado pela fase vira pergunta, e a resposta some com o marcador", async () => {
    await init(skeletonPath());
    const { outcome, agent } = await plan(comLacuna(), async () => "1");

    const lacuna = agent.calls.find((call) => call.subject === "project-phases.md:gaps");
    expect(lacuna?.prompt).toContain("qual provedor de email envia a confirmação");
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    expect(plano).not.toContain("[NEEDS DECISION]");
  });

  it("a rodada de lacunas leva junto, com as palavras dele, o que o init já fechou", async () => {
    const comEntrevista = skeletonPath();
    comEntrevista.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: oneQuestion() },
    });
    await init(comEntrevista, async () => "1");

    const { agent } = await plan(comLacuna(), async () => "1");
    const lacuna = agent.calls.find((call) => call.subject === "project-phases.md:gaps");
    expect(lacuna?.prompt).toContain("Never ask again what the developer already answered");
    expect(lacuna?.prompt).toContain("Node + Vitest");
  });

  it("sem marcador nenhum, ninguém é perguntado", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());
    expect(agent.calls.some((call) => call.subject === "project-phases.md:gaps")).toBe(false);
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

describe("o esqueleto guardado e a entrevista do esqueleto não brigam pelo mesmo arquivo", () => {
  it("as respostas do init sobrevivem à gravação do esqueleto", async () => {
    const comEntrevista = skeletonPath();
    comEntrevista.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: oneQuestion() },
    });
    const agent = fakeAgent(comEntrevista);
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agent.call, ask: async () => "1" });

    const handoffs = join(projectRoot, ".capivara", "handoffs");
    const arquivos = await readdir(handoffs);
    expect(arquivos.sort()).toEqual(arquivos.sort().filter((nome) => nome.endsWith(".json")));
    expect(arquivos).toHaveLength(2);

    const entrevista = arquivos.find((nome) => nome.endsWith(".skeleton.json"));
    const guardado = JSON.parse(await readFile(join(handoffs, entrevista ?? ""), "utf8")) as { answers: unknown[] };
    expect(guardado.answers).toHaveLength(1);
  });
});

describe("cada auditoria recebe só o que a sua pergunta exige", () => {
  it("a auditoria de uma fase recebe a fatia que escreveu aquela fase, não o produto inteiro", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const fase2 = agent.calls.find((call) => call.role === "auditor" && call.subject === "project-phases.md#P2");
    expect(fase2?.prompt).toContain("US-1.1");
    expect(fase2?.prompt).not.toContain("pertence a statuses");
  });

  it("a auditoria de coerência recebe o esqueleto inteiro: a pergunta dela é global", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const coerencia = agent.calls.find((call) => call.role === "auditor" && call.subject === "project-phases.md#coerência");
    expect(coerencia?.prompt).toContain("pertence a statuses");
    expect(coerencia?.prompt).toContain("## Fases");
  });
});

describe("o esqueleto é conferido no laço, não só no portão", () => {
  /** Um esqueleto que passa no parser e deixa uma story sem fase que a entregue. */
  const semCobertura = JSON.stringify({
    ...JSON.parse(SKELETON),
    stories: [
      { id: "US-1.1", statement: "Como hóspede, crio uma reserva" },
      { id: "US-2.2", statement: "Como operador, suspendo um membro" },
    ],
  });

  it("story que nenhuma fase entrega volta ao escritor com o defeito nomeado", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton", attempt: 1 },
      respond: { stdout: semCobertura },
    });

    const { outcome, agent } = await init(steps);

    const segunda = agent.calls.find(
      (call) => call.subject === "skeleton" && call.stage === "authoring" && call.attempt === 2,
    );
    expect(segunda, "o escritor precisa ganhar uma segunda tentativa").toBeDefined();
    expect(segunda?.prompt).toContain("US-2.2");
    // E o run chega ao gate, em vez de morrer nele.
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });

  it("corrigido na segunda tentativa, não há terceira", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton", attempt: 1 },
      respond: { stdout: semCobertura },
    });

    const { agent } = await init(steps);
    const tentativas = agent.calls.filter((call) => call.subject === "skeleton" && call.stage === "authoring");
    expect(tentativas).toHaveLength(2);
  });

  it("insistindo no defeito, o run publica e o portão reporta NOT READY em vez de estourar", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: semCobertura },
      repeat: true,
    });

    const { outcome, agent } = await init(steps);
    expect(agent.calls.filter((call) => call.subject === "skeleton" && call.stage === "authoring")).toHaveLength(3);
    expect(outcome.readiness.ready).toBe(false);
    expect(outcome.rendered).toContain("US-2.2");
  });
});
