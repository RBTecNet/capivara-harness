/**
 * O limite de tokens no plano pela API direta (item 9 de "atacar os pontos frágeis").
 *
 * A geração cortada pelo teto de saída parava o `plan` na primeira vez. Agora
 * vem UMA chamada nova pedindo a mesma resposta, compacta — sem prosa, só o
 * contrato —; se estourar de novo, para, como antes. O texto parcial nunca é
 * aprovado.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { PHASE_1, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-limite-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "limitetoken1" };
const language = "português do Brasil";
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "use as recomendações");

/** O que o provider direto devolve quando o teto de saída corta a geração. */
const CORTADA = [
  "openrouter: a geração atingiu o limite de tokens; o documento ficou incompleto e não foi aprovado.",
  "modelo: minimax/MiniMax-M3.1-Flash; effort: padrão; teto solicitado: 8192; término: length.",
].join("\n");

async function plan(escritorDaFase1: (call: AgentCall) => string) {
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
  // A CLI sai com erro quando a geração foi cortada: o texto não é resposta.
  const passo: ScriptStep = { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: escritorDaFase1, exitCode: (call) => (escritorDaFase1(call) === CORTADA ? 1 : 0) }, repeat: true };
  const agent = fakeAgent([passo, ...skeletonPath()]);
  const run = runPlan({ projectRoot, request, language, call: agent.call, ask: responde, announce: () => undefined, sleep: async () => undefined });
  const daFase1 = () => agent.calls.filter((call) => call.subject === "phase-p01" && call.stage === "authoring");
  return { run, daFase1 };
}

describe("o limite de tokens", () => {
  it("cortada na primeira, a mesma resposta compacta na segunda: o plano segue", async () => {
    const { run, daFase1 } = await plan((call) => (call.prompt.includes("## Compact answer") ? PHASE_1 : CORTADA));
    expect((await run).readiness.ready).toBe(true);
    expect(daFase1()).toHaveLength(2);
    expect(daFase1()[1]!.prompt.startsWith(daFase1()[0]!.prompt)).toBe(true);
    expect(daFase1()[1]!.prompt).toContain("only the contract the\nrequest asks for");
  });

  it("cortada nas duas: para, como antes, dizendo que a compacta também estourou", async () => {
    const { run, daFase1 } = await plan(() => CORTADA);
    const erro = await run.then(() => null, (falha: unknown) => falha);
    expect(erro).toBeInstanceOf(InitBlockedError);
    expect((erro as Error).message).toContain("atingiu o limite de tokens, também na chamada que pedia a resposta compacta");
    expect(daFase1()).toHaveLength(2);
  });
});
