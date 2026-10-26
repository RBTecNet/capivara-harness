/**
 * O plan de uma passada (etapa 2 da redução).
 *
 * Uma auditoria do plano inteiro, mais uma depois da emenda, no máximo. O Core
 * decide o que bloqueia: a contradição com as duas passagens citadas existindo,
 * a interface citada dos dois lados, o pacote fora de
 * `infrastructure.dependencies`. O resto é observação do relatório, sem rodada.
 * A pergunta do plan tem prazo e, vencido, segue com a leitura recomendada.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { approve, fakeAgent, oneQuestion, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-uma-passada-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "umapassada01" };
const language = "português do Brasil";
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "use as recomendações");

async function init(steps: ScriptStep[] = skeletonPath(), ask: (question: Question) => Promise<string> = responde) {
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(steps).call, ask, announce: () => undefined });
}

async function plan(auditor: (call: AgentCall) => string, extras: Partial<Parameters<typeof runPlan>[0]> = {}) {
  const dito: string[] = [];
  const agent = fakeAgent([{ match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: auditor }, repeat: true }, ...skeletonPath()]);
  const run = runPlan({ projectRoot, request, language, call: agent.call, ask: responde, announce: (linha) => void dito.push(linha), sleep: async () => undefined, ...extras });
  return { run, agent, anunciado: () => dito.join("\n") };
}

const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
const emendas = (agent: { calls: AgentCall[] }) => agent.calls.filter((call) => call.stage === "authoring" && call.subject.startsWith("phase-") && call.attempt > 1);
const publicado = () => readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");

describe("o plan de uma passada", () => {
  it("o plano correto custa uma auditoria, e nenhum verificador", async () => {
    await init();
    const { run, agent } = await plan(() => approve());
    expect((await run).readiness.ready).toBe(true);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(1);
    expect(por(agent, { role: "verifier" })).toHaveLength(0);
  });

  it("a contradição com as duas passagens existentes devolve uma vez; a emenda fecha e o plano é publicado", async () => {
    await init();
    let leituras = 0;
    const { run, agent } = await plan(() => ((leituras += 1) === 1 ? reject("Phase 1", "o seed contradiz a regra", "declare a ordem do seed") : approve()));
    expect((await run).readiness.ready).toBe(true);
    expect(leituras).toBe(2);
    expect(emendas(agent).map((call) => call.subject)).toEqual(["phase-p01"]);
    expect(emendas(agent)[0]?.prompt).toContain("declare a ordem do seed");
  });

  it("a contradição com citação que não existe não devolve: vira observação do relatório", async () => {
    await init();
    const inventada = [
      "CAPIVARA_AUDIT_STATUS: REJECTED",
      "CAPIVARA_FINDING: CONTRADICTION | Phase 2 | «uma reserva nasce confirmada» contra «duas reservas do mesmo quarto não se sobrepõem» | escolha uma",
      "CAPIVARA_REASON: contradição",
    ].join("\n");
    const { run, agent } = await plan(() => inventada);
    const outcome = await run;
    expect(outcome.readiness.ready).toBe(true);
    expect(emendas(agent)).toHaveLength(0);
    expect(outcome.report.remarks.some((entrada) => entrada.remark.observation.includes("não bloqueia"))).toBe(true);
  });

  it("o achado de precisão, completude ou estilo é observação, sem rodada e sem pergunta", async () => {
    await init();
    const semClasse = "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | a regra não nomeia o alvo da operação | nomeie o alvo\nCAPIVARA_REASON: precisão";
    const perguntadas: Question[] = [];
    const { run, agent } = await plan(() => semClasse, { ask: async (question) => { perguntadas.push(question); return "1"; } });
    expect((await run).readiness.ready).toBe(true);
    expect(emendas(agent)).toHaveLength(0);
    expect(perguntadas.filter((pergunta) => pergunta.id !== ID_DO_BANCO)).toEqual([]);
  });

  it("o auditor não cria decisão de produto: a decisão que ele levanta vai ao relatório", async () => {
    await init();
    const perguntadas: Question[] = [];
    const comDecisao = `${approve()}\nCAPIVARA_DECISION: Phase 2 | A reserva nasce pendente ou confirmada? | Pendente | Confirmada`;
    const { run } = await plan(() => comDecisao, { ask: async (question) => { perguntadas.push(question); return "1"; } });
    const outcome = await run;
    expect(outcome.readiness.ready).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.id !== ID_DO_BANCO)).toEqual([]);
    expect(outcome.report.remarks.some((entrada) => entrada.remark.observation.includes("A reserva nasce pendente ou confirmada?"))).toBe(true);
  });

  it("o bloqueio que sobrevive à emenda vai uma vez à arquitetura e, sobrando, vira pergunta; o escritor que não aplica a decisão faz o plan parar com as duas citações, e nada é publicado", async () => {
    await init();
    const { run, agent } = await plan(() => reject("Phase 1", "o seed contradiz a regra", "declare a ordem do seed"));
    const erro = await run.then(() => null, (e: Error) => e.message);
    expect(erro).toContain("continuam no plano depois da decisão");
    expect(erro).toContain("«A tabela statuses existe e contém exatamente pendente, confirmada e cancelada»");
    expect(erro).toContain("«duas reservas do mesmo quarto não se sobrepõem»");
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(2);
    // A arquitetura voltou com as citações; o arquiteto a devolveu igual, e ela foi descartada sem auditoria.
    const arquitetos = por(agent, { role: "writer", stage: "authoring", subject: "architecture" });
    expect(arquitetos).toHaveLength(2);
    expect(arquitetos[1]?.prompt).toContain("passagens conferidas pelo Core");
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(1);
    // A decisão chegou à reescrita da fase 1.
    expect(emendas(agent).at(-1)?.prompt).toContain("o desenvolvedor decidiu");
    await expect(publicado()).rejects.toThrow();
  });

  it("o achado sobre o envelope da fase vai à arquitetura já na primeira vez, e nunca ao desenvolvedor", async () => {
    await init();
    let leituras = 0;
    const perguntadas: Question[] = [];
    const { run, agent, anunciado } = await plan(
      () => ((leituras += 1) === 1 ? reject("Phase 2 · Goal", "o objetivo da fase promete o que outra entrega", "ajuste o goal da fase 2") : approve()),
      { ask: async (question) => { perguntadas.push(question); return "1"; } },
    );
    expect((await run).readiness.ready).toBe(true);
    expect(anunciado()).toContain("apontam o envelope de fase");
    const arquitetos = por(agent, { role: "writer", stage: "authoring", subject: "architecture" });
    expect(arquitetos.length).toBeGreaterThanOrEqual(2);
    expect(arquitetos[1]?.prompt).toContain("o objetivo da fase promete o que outra entrega");
    expect(perguntadas.filter((pergunta) => pergunta.id !== ID_DO_BANCO)).toEqual([]);
  });

  it("a auditoria ilegível na primeira e legível na segunda: o plano segue, com uma chamada a mais só nesse caminho", async () => {
    await init();
    let leituras = 0;
    const { run, agent } = await plan(() => ((leituras += 1) === 1 ? "CAPIVARA_AUDIT_STATUS: TALVEZ\nCAPIVARA_REASON: hum" : approve()));
    expect((await run).readiness.ready).toBe(true);
    expect(por(agent, { stage: "audit", subject: "project-phases.md" })).toHaveLength(2);
  });

  it("a auditoria ilegível ganha uma chamada com o protocolo repetido; ilegível duas vezes, não aprova", async () => {
    await init();
    const { run, agent } = await plan(() => "achei tudo ótimo");
    await expect(run).rejects.toThrow(/a auditoria do plano veio ilegível duas vezes/);
    const auditorias = por(agent, { stage: "audit", subject: "project-phases.md" });
    expect(auditorias).toHaveLength(2);
    expect(auditorias[1]?.prompt).toContain("## Repair the previous audit response");
    await expect(publicado()).rejects.toThrow();
  });
});

describe("a pergunta do plan tem prazo", () => {
  it("sem resposta no prazo, o plan segue com a leitura recomendada, a registra como suposição e retira a pergunta", async () => {
    // A entrevista do init deixa a decisão em aberto: o plan a pergunta de novo antes das fases.
    await init([{ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } }, ...skeletonPath()], async (question) => (question.id === ID_DO_BANCO ? "1" : ""));
    const sinais: AbortSignal[] = [];
    const { run } = await plan(() => approve(), {
      planQuestionTimeoutMs: 20,
      ask: (question, _indice, _total, opcoes) => {
        if (question.id === ID_DO_BANCO) return Promise.resolve("1");
        if (opcoes?.signal) sinais.push(opcoes.signal);
        return new Promise<string>(() => undefined);
      },
    });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(sinais.length).toBeGreaterThan(0);
    expect(sinais.every((sinal) => sinal.aborted)).toBe(true);
    const suposicao = outcome.report.checkpoint.assumptions.find((entrada) => entrada.basis.includes("sem resposta"));
    expect(suposicao?.statement).toBe("Node + Vitest");
    expect(outcome.report.checkpoint.decisions.some((decisao) => decisao.decision.includes("Node + Vitest"))).toBe(true);
  });

  it("a resposta dada dentro do prazo vale como sempre, sem suposição", async () => {
    await init([{ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } }, ...skeletonPath()], async (question) => (question.id === ID_DO_BANCO ? "1" : ""));
    const { run } = await plan(() => approve(), { planQuestionTimeoutMs: 60_000, ask: async (question) => (question.id === ID_DO_BANCO ? "1" : "2") });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(outcome.report.checkpoint.assumptions.some((entrada) => entrada.basis.includes("sem resposta"))).toBe(false);
    expect(outcome.report.checkpoint.decisions.some((decisao) => decisao.decision.includes("Python + pytest"))).toBe(true);
  });
});
