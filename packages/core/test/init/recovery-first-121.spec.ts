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
  let impasses = 0;
  const agent = fakeAgent(steps);
  const run = runPlan({
    projectRoot, request, language: "português do Brasil", call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; },
    announce: (linha) => void dito.push(linha), sleep: async () => undefined,
    decideStandoff: async () => { impasses += 1; return "publicar"; },
    ...extras,
  });
  return { run, agent, perguntadas, anunciado: () => dito.join("\n"), impasses: () => impasses };
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
  it("1, 3, 10, 14. o escritor devolve o mesmo texto; o auditor assume o reparo; o verifier valida; o plano fecha — mais barato que insistir", async () => {
    await init();
    let auditorias = 0;
    const { run, agent, anunciado, impasses, perguntadas } = await plan(roteiro({
      auditor: () => ((auditorias += 1) === 1 ? F1 : F1), // o auditor reprova sempre que lê o texto velho
      writer: () => PHASE_2, // o escritor não muda nada
      reparador: () => COM_STATUS,
      verifier: () => approve(),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses()).toBe(0);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·") || pergunta.topic.startsWith("impasse"))).toEqual([]);

    // A estratégia mudou na evidência: texto idêntico, não contagem.
    expect(anunciado()).toContain("a emenda não mudou o texto e o auditor reprovou de novo; insistir não resolve — trocando de estratégia");
    expect(anunciado()).toContain("o auditor assume o reparo (1/2) e o verifier valida, em sessão própria");
    // O reparador recebeu o prompt de emenda inteiro mais o bloco de reparo, com o achado e o histórico.
    const reparo = por(agent, { role: "auditor", stage: "authoring", subject: "phase-p02" });
    expect(reparo).toHaveLength(1);
    expect(reparo[0]?.prompt).toContain(REPAIR_MARKER);
    expect(reparo[0]?.prompt).toContain("o status inicial não é observável");
    expect(reparo[0]?.prompt).toContain("## What was tried and did not close it");
    expect(reparo[0]?.prompt).toContain("devolveu o MESMO texto");
    // Ninguém aprova o próprio reparo: a leitura que aprovou foi do verifier, depois do reparo.
    const leituras = por(agent, { stage: "audit", subject: P2 }).map((call) => call.role);
    expect(leituras).toEqual(["auditor", "auditor", "verifier"]);
    // O preço: uma emenda do escritor, um reparo, uma validação — contra três devoluções e uma arbitragem.
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })).toHaveLength(2);
    expect(por(agent, { subject: "phase-p02" }).length + por(agent, { subject: P2 }).length).toBe(6);
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).toContain("A resposta 201 traz status pendente");
    // Observabilidade: a transferência e a validação estão no histórico do run.
    const events = await readEvents(runPaths(projectRoot, outcome.runId).events);
    expect(events.some((event) => event.detail.includes("reparo pelo auditor (1/2)"))).toBe(true);
  });

  it("2, 4. o reparador fecha só parte; a pendência segue em recuperação sem perder o que já fechou", async () => {
    await init();
    let reparos = 0;
    const { run, agent, impasses } = await plan(roteiro({
      auditor: () => F1_E_F2,
      writer: () => PHASE_2,
      reparador: () => ((reparos += 1) === 1 ? COM_STATUS : COM_STATUS_E_409),
      verifier: (call) => (call.prompt.includes("respondem 409") ? approve() : SO_F2),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses()).toBe(0);
    // O escritor recebeu os dois achados juntos.
    const emenda = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })[1]?.prompt ?? "";
    expect(emenda).toContain("o status inicial não é observável");
    expect(emenda).toContain("o critério de datas não diz a resposta HTTP");
    // O segundo reparo parte do primeiro (status já fechado) e recebe só a pendência.
    const segundo = por(agent, { role: "auditor", stage: "authoring", subject: "phase-p02" })[1]?.prompt ?? "";
    expect(segundo).toContain("A resposta 201 traz status pendente");
    expect(segundo).toContain("o critério de datas não diz a resposta HTTP");
    expect(segundo).not.toContain("what to do: diga que a resposta 201 traz status pendente");
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).toContain("A resposta 201 traz status pendente");
    expect(plano).toContain("respondem 409 e nada é persistido");
  });

  it("5. a reauditoria descobre um ponto novo depois de o escritor fechar o anterior; o progresso fica", async () => {
    await init();
    let auditorias = 0;
    let escritas = 0;
    const { run, agent, anunciado } = await plan(roteiro({
      auditor: () => { auditorias += 1; return auditorias === 1 ? F1 : auditorias === 2 ? SO_F2 : approve(); },
      writer: () => { escritas += 1; return escritas === 1 ? PHASE_2 : escritas === 2 ? COM_STATUS : COM_STATUS_E_409; },
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado()).not.toContain("assume o reparo");
    expect(por(agent, { role: "auditor", stage: "authoring" })).toHaveLength(0);
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).toContain("A resposta 201 traz status pendente");
    expect(plano).toContain("respondem 409 e nada é persistido");
  });

  it("8. o reparador apaga uma regra confirmada; a validação independente recusa e o reparo seguinte a preserva", async () => {
    await init();
    let reparos = 0;
    const { run, agent, impasses } = await plan(roteiro({
      auditor: () => F1,
      writer: () => PHASE_2,
      reparador: () => ((reparos += 1) === 1 ? SEM_A_REGRA : COM_STATUS),
      verifier: (call) => (call.prompt.includes("Datas sobrepostas no mesmo quarto")
        ? approve()
        : reject("Tarefa «Implementar a criação de reserva com recusa de datas sobrepostas»", "a emenda apagou a recusa de datas sobrepostas, regra do esqueleto", "restaure o critério de datas sobrepostas")),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses()).toBe(0);
    expect(por(agent, { role: "verifier", stage: "audit", subject: P2 })).toHaveLength(2);
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).toContain("Datas sobrepostas no mesmo quarto");
    expect(plano).toContain("A resposta 201 traz status pendente");
  });

  it("9. o reparador introduz uma regressão; a validação recusa, cita o que voltou, e o reparo seguinte a desfaz", async () => {
    await init();
    let reparos = 0;
    const regressao = PHASE_2.replace("Uma reserva nova nasce com status pendente", "A resposta 201 traz status pendente").replace("- **Traces:** US-1.1, reservations, workflow 1", "- **Traces:** US-1.1, reservations, workflow 1\n\n- [ ] **Task:** Validar o formulário de reserva\n  - **Acceptance criteria:**\n    - O formulário funciona corretamente\n  - **Traces:** US-1.1");
    const { run, agent, impasses } = await plan(roteiro({
      auditor: () => F1,
      writer: () => PHASE_2,
      reparador: () => ((reparos += 1) === 1 ? regressao : COM_STATUS),
      verifier: (call) => (call.prompt.includes("funciona corretamente")
        ? reject("Tarefa «Validar o formulário de reserva»", "o critério \"funciona corretamente\" não é verificável — a task veio junto com o reparo", "remova a task que o reparo acrescentou; ela não fecha achado nenhum")
        : approve()),
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses()).toBe(0);
    const segundo = por(agent, { role: "auditor", stage: "authoring", subject: "phase-p02" })[1]?.prompt ?? "";
    expect(segundo).toContain("a task veio junto com o reparo");
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).not.toContain("funciona corretamente");
  });

  it("7. a decisão genuína de produto continua chegando ao desenvolvedor pela entrevista", async () => {
    await init();
    let auditorias = 0;
    const { run, perguntadas } = await plan(roteiro({
      auditor: () => ((auditorias += 1) === 1 ? `${approve()}\nCAPIVARA_DECISION: P2.T1.C1 | A reserva nova nasce pendente ou confirmada? | Pendente, até o pagamento | Confirmada no ato` : approve()),
      writer: () => PHASE_2,
    }));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·")).map((pergunta) => pergunta.decision)).toEqual(["A reserva nova nasce pendente ou confirmada?"]);
  });

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
    const { run, agent, perguntadas, impasses } = await plan([
      { match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: () => ((auditorias += 1) === 1 ? reject("components · api", "a api consome query(sql) que dados não expõe nesse formato", "alinhe o contrato de dados ao que a api consome") : approve()) }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquitetoQueMuda() }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "architecture"),
    ]);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses()).toBe(0);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "authoring" })).toHaveLength(0);
  });

  it("1 (arquitetura). o arquiteto não fecha; o auditor repara; o verifier valida; o plano fecha", async () => {
    await init();
    const achado = reject("components · api", "a api consome query(sql) que dados não expõe nesse formato", "alinhe o contrato de dados ao que a api consome");
    const { run, agent, impasses, anunciado } = await plan([
      { match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: achado }, repeat: true },
      { match: { role: "verifier", stage: "audit", subject: "architecture" }, respond: { stdout: approve() }, repeat: true },
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquitetoQueMuda() }, repeat: true },
      { match: { role: "auditor", stage: "authoring", subject: "architecture" }, respond: { stdout: JSON.stringify({ ...JSON.parse(ARCHITECTURE), overview: "Reparada pelo auditor." }) }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "architecture"),
    ]);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(impasses()).toBe(0);
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
    const { run, impasses, perguntadas } = await plan([
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
    expect(impasses()).toBe(0);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    // O estado retomável: o esqueleto do init continua em disco; a arquitetura reprovada não foi publicada.
    expect(await readSkeletonState(projectRoot, runIdFor("init", request.sha12))).not.toBeNull();
    await expect(readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).rejects.toThrow();
  });
});
