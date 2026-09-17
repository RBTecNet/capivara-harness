import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAnswer,
  buildCheckpoint,
  isSettled,
  needsDecisionMarkers,
  planRound,
  readHandoff,
  unresolved,
  writeHandoff,
} from "../../src/interview/index.js";
import type { Answer, Question, RoundState } from "../../src/interview/index.js";

const question = (id: string, topic = "tema"): Question => ({
  id,
  topic,
  evidence: "evidência",
  decision: `decisão ${id}`,
  why: "motivo",
  options: [],
  recommended: "",
  recommendationBasis: "",
});

const QUESTIONS = [question("Q-01", "stack"), question("Q-02", "auth"), question("Q-03", "deploy")];

function answer(id: string, disposition: Answer["disposition"], round = 1): Answer {
  return buildAnswer(
    QUESTIONS.find((q) => q.id === id)!,
    "resposta crua",
    { disposition, decision: disposition === "ACCEPTED" ? "decidido" : "", open: "o que falta" },
    round,
  );
}

const state = (answers: Answer[], round = 1, maxRounds = 3): RoundState => ({
  round,
  questions: QUESTIONS,
  answers,
  assumptions: [],
  maxRounds,
});

describe("planRound", () => {
  it("a rodada 1 pergunta tudo", () => {
    expect(planRound(state([])).ask).toHaveLength(3);
  });

  it("as seguintes só reperguntam o que continua aberto", () => {
    const plan = planRound(state([answer("Q-01", "ACCEPTED"), answer("Q-02", "PARTIAL")], 2));
    expect(plan.ask.map((q) => q.id)).toEqual(["Q-02", "Q-03"]);
  });

  it("nunca reabre uma decisão aceita", () => {
    const answers = [answer("Q-01", "ACCEPTED"), answer("Q-02", "ACCEPTED"), answer("Q-03", "ACCEPTED")];
    expect(planRound(state(answers, 2)).ask).toEqual([]);
    expect(isSettled(answers, "Q-01")).toBe(true);
  });

  it("converge quando nada mais está aberto", () => {
    const answers = QUESTIONS.map((q) => answer(q.id, "ACCEPTED"));
    expect(planRound(state(answers, 2)).converged).toBe(true);
  });

  it("DEFERRED não é reperguntado — quem adiou já respondeu", () => {
    const plan = planRound(state([answer("Q-01", "DEFERRED"), answer("Q-02", "ACCEPTED"), answer("Q-03", "ACCEPTED")], 2));
    expect(plan.ask).toEqual([]);
  });

  it("AMBIGUOUS e CONTRADICTED voltam para repergunta", () => {
    const plan = planRound(state([answer("Q-01", "AMBIGUOUS"), answer("Q-02", "CONTRADICTED"), answer("Q-03", "ACCEPTED")], 2));
    expect(plan.ask.map((q) => q.id)).toEqual(["Q-01", "Q-02"]);
  });

  it("o teto interrompe as rodadas", () => {
    const plan = planRound(state([answer("Q-01", "PARTIAL")], 4, 3));
    expect(plan).toMatchObject({ capReached: true, converged: false, ask: [] });
  });
});

describe("o que não foi resolvido", () => {
  it("vira [NEEDS DECISION], nunca suposição silenciosa", () => {
    const markers = needsDecisionMarkers(state([answer("Q-01", "ACCEPTED"), answer("Q-02", "DEFERRED")], 4, 3));
    expect(markers).toHaveLength(2);
    for (const marker of markers) expect(marker.startsWith("[NEEDS DECISION] ")).toBe(true);
    expect(markers.join(" ")).toContain("auth");
    expect(markers.join(" ")).toContain("deploy");
  });

  it("pergunta nunca respondida conta como não resolvida", () => {
    expect(unresolved(state([]))).toHaveLength(3);
  });
});

describe("checkpoint", () => {
  it("separa decisões, adiamentos e ambiguidade restante", () => {
    const checkpoint = buildCheckpoint({
      ...state([answer("Q-01", "ACCEPTED"), answer("Q-02", "DEFERRED"), answer("Q-03", "AMBIGUOUS")]),
      assumptions: [{ topic: "log", statement: "log em stdout", basis: "convenção da stack escolhida" }],
    });
    expect(checkpoint.decisions.map((d) => d.questionId)).toEqual(["Q-01"]);
    expect(checkpoint.deferrals.map((d) => d.questionId)).toEqual(["Q-02"]);
    expect(checkpoint.ambiguities.map((d) => d.questionId)).toEqual(["Q-03"]);
    expect(checkpoint.assumptions).toHaveLength(1);
  });
});

describe("handoff", () => {
  let projectRoot = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-handoff-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("preserva a resposta crua entre execuções", async () => {
    await writeHandoff(projectRoot, {
      contract: "capivara-handoff/v1",
      runId: "init-abc123abc123",
      language: "pt-BR",
      document: "project-description.md",
      round: 2,
      questions: QUESTIONS,
      answers: [answer("Q-01", "ACCEPTED")],
      assumptions: [],
      updatedAt: "2026-09-16T00:00:00.000Z",
    });

    const restored = await readHandoff(projectRoot, "init-abc123abc123", "project-description.md");
    expect(restored?.answers[0]?.raw).toBe("resposta crua");
    expect(restored?.round).toBe(2);
  });

  it("handoff ausente devolve null", async () => {
    expect(await readHandoff(projectRoot, "init-inexistente", "x.md")).toBeNull();
  });
});
