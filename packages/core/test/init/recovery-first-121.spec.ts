/**
 * RECOVERY FIRST (§121): o INIT e o PLAN trabalham para concluir a etapa.
 *
 * Um teto esgotado, uma auditoria reprovada, um escritor que não corrige ou
 * um formato errado são a falha de UMA estratégia. Antes de parar, o harness
 * tenta as que restam: correção determinística, emenda ao escritor com os
 * achados consolidados, balanço de progresso, mudança de estratégia, reparo
 * pelo auditor e validação independente pelo verifier. O que se prova aqui é
 * cada degrau dessa escada, o preço de cada um, e que o último degrau — parar
 * — vem com o diagnóstico do que foi tentado e o estado em disco.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSkeletonState, runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { REPAIR_MARKER } from "../../src/prompts/index.js";
import { readEvents, runIdFor, runPaths } from "../../src/state/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_2, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-121-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

const P2 = "project-phases.md#P2";
const F1 = reject("Tarefa «Implementar a criação de reserva com recusa de datas sobrepostas»", "o status inicial não é observável na resposta", "diga que a resposta 201 traz status pendente");
const F2_LINHA = "CAPIVARA_FINDING: Tarefa «Implementar a criação de reserva com recusa de datas sobrepostas» | o critério de datas não diz a resposta HTTP | diga que a resposta é 409 e nada é persistido";
const F1_E_F2 = `${F1}\n${F2_LINHA}`;
const SO_F2 = ["CAPIVARA_AUDIT_STATUS: REJECTED", F2_LINHA, "CAPIVARA_REASON: falta a resposta HTTP"].join("\n");

const COM_STATUS = PHASE_2.replace("Uma reserva nova nasce com status pendente", "A resposta 201 traz status pendente");
const COM_STATUS_E_409 = COM_STATUS.replace("devolvem erro e não persistem nada", "respondem 409 e nada é persistido");
/** O reparo que apaga uma regra confirmada do produto: a recusa de datas sobrepostas. */
const SEM_A_REGRA = COM_STATUS.replace("    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada\n", "");

async function init() {
  await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
}

async function plan(steps: ScriptStep[], extras: Partial<Parameters<typeof runPlan>[0]> = {}) {
  const dito: string[] = [];
  const perguntadas: Question[] = [];
  const agent = fakeAgent(steps);
  const run = runPlan({
    projectRoot, request, language: "português do Brasil", call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; },
    announce: (linha) => void dito.push(linha), sleep: async () => undefined,
    ...extras,
  });
  return { run, agent, perguntadas, anunciado: () => dito.join("\n") };
}

/** Um roteiro com passos próprios para cada papel da fase 2: auditor que julga, escritor, reparador, verifier. */
function roteiro(papeis: {
  auditor: (call: AgentCall) => string;
  writer: (call: AgentCall) => string;
  reparador?: (call: AgentCall) => string;
  verifier?: (call: AgentCall) => string;
}): ScriptStep[] {
  return [
    { match: { role: "auditor", stage: "audit", subject: P2 }, respond: { stdout: papeis.auditor }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: papeis.writer }, repeat: true },
    ...(papeis.reparador ? [{ match: { role: "auditor" as const, stage: "authoring", subject: "phase-p02" }, respond: { stdout: papeis.reparador }, repeat: true }] : []),
    ...(papeis.verifier ? [{ match: { role: "verifier" as const, stage: "audit", subject: P2 }, respond: { stdout: papeis.verifier }, repeat: true }] : []),
    ...skeletonPath().filter((passo) => passo.match.subject !== "phase-p02"),
  ];
}

describe("a escada de recuperação do PLAN, degrau a degrau", () => {






  it("11. a falha transitória do provider não perde o trabalho válido", async () => {
    await init();
    let vez = 0;
    const { run, agent } = await plan(roteiro({
      auditor: () => approve(),
      writer: () => ((vez += 1) === 1 ? "" : PHASE_2),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "authoring" })).toHaveLength(0);
  });

  it("13. o caminho sem defeito não ganha chamada nenhuma", async () => {
    await init();
    const { run, agent, anunciado } = await plan(skeletonPath());
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(por(agent, { role: "auditor", stage: "authoring" })).toHaveLength(0);
    expect(por(agent, { role: "verifier", stage: "audit" })).toHaveLength(0);
    expect(anunciado()).not.toContain("reparo");
    expect(anunciado()).not.toContain("estratégia");
  });
});

describe("a arquitetura: conflito técnico resolvido dentro de casa, e o esgotamento com diagnóstico", () => {
  const arquitetoQueMuda = () => {
    let vez = 0;
    return () => JSON.stringify({ ...JSON.parse(ARCHITECTURE), overview: `Um serviço Node com camada de dados e camada HTTP no mesmo processo (revisão ${(vez += 1)}).` });
  };

  it("6. um conflito de contrato entre componentes é resolvido pelo arquiteto, sem pergunta e sem impasse", async () => {
    await init();
    let auditorias = 0;
    const { run, agent, perguntadas } = await plan([
      { match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: () => ((auditorias += 1) === 1 ? reject("components · api", "a api consome query(sql) que dados não expõe nesse formato", "alinhe o contrato de dados ao que a api consome") : approve()) }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquitetoQueMuda() }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "architecture"),
    ]);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "authoring" })).toHaveLength(0);
  });

  it("1 (arquitetura). o arquiteto não fecha; o auditor repara; o verifier valida; o plano fecha", async () => {
    await init();
    const achado = reject("components · api", "a api consome query(sql) que dados não expõe nesse formato", "alinhe o contrato de dados ao que a api consome");
    const { run, agent, anunciado } = await plan([
      { match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: achado }, repeat: true },
      { match: { role: "verifier", stage: "audit", subject: "architecture" }, respond: { stdout: approve() }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquitetoQueMuda() }, repeat: true },
      { match: { role: "auditor", stage: "authoring", subject: "architecture" }, respond: { stdout: JSON.stringify({ ...JSON.parse(ARCHITECTURE), overview: "Reparada pelo auditor." }) }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "architecture"),
    ]);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado()).toContain("o auditor assume o reparo (1/2) e o verifier valida");
    expect(anunciado()).toContain("arquitetura aprovada pela validação independente");
    // Três devoluções ao arquiteto, a estratégia, um reparo, uma validação: nenhuma leitura do auditor sobre o próprio reparo.
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(4);
    expect(por(agent, { role: "verifier", stage: "audit", subject: "architecture" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "authoring", subject: "architecture" })).toHaveLength(1);
    expect(await readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).toContain("Reparada pelo auditor.");
  });

  it("12. esgotadas as estratégias, o run para com o diagnóstico do que foi tentado e o estado retomável em disco", async () => {
    await init();
    const achado = reject("components · api", "a api consome query(sql) que dados não expõe nesse formato", "alinhe o contrato de dados ao que a api consome");
    const { run, perguntadas } = await plan([
      { match: { stage: "audit", subject: "architecture" }, respond: { stdout: achado }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquitetoQueMuda() }, repeat: true },
      { match: { role: "auditor", stage: "authoring", subject: "architecture" }, respond: { stdout: arquitetoQueMuda() }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "architecture"),
    ], { maxAuditReturns: 1 });
    const erro = await run.then(() => null, (e: Error) => e.message);
    expect(erro).toContain("não convergiu");
    for (const linha of ["Estratégias tentadas, nesta ordem:", "mudança de estratégia: serialização por dependência", "reparo 1 pelo auditor depois da estratégia trocada; validação independente pelo verifier", "reparo 2 pelo auditor sobre os achados do verifier", "`capivara plan` retoma daqui"]) {
      expect(erro).toContain(linha);
    }
    expect(erro).not.toMatch(/tentativas esgotadas/);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    // O estado retomável: o esqueleto do init continua em disco; a arquitetura reprovada não foi publicada.
    expect(await readSkeletonState(projectRoot, runIdFor("init", request.sha12))).not.toBeNull();
    await expect(readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).rejects.toThrow();
  });
});
