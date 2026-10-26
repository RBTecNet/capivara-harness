/**
 * O bloqueio que sobra depois da emenda: arquitetura, ou decisão — nunca o build.
 *
 * No run `init-dc741f0d7b92` do Codex a auditoria achou seis contradições, a
 * emenda fechou cinco, e a que sobrou era real: o arquiteto pôs os contratos
 * CRUD dos três módulos no componente da Fase 1, e o escritor da fase os
 * copiou. Nenhuma emenda de fase alcança a origem. O bloqueio vai uma vez à
 * arquitetura, com as citações; a refeita é auditada uma vez, as fases cujo
 * contrato mudou são reescritas e o plano é auditado uma vez. O que ainda
 * sobrar vira pergunta ao desenvolvedor — as passagens em conflito e a correção
 * do auditor como leitura recomendada —; a resposta é aplicada como decisão, e
 * as fases afetadas são reescritas uma vez. O plano só é publicado limpo: se as
 * passagens ainda coexistem, o `plan` para citando as duas.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_1, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-contradicao-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "contradica01" };
const language = "português do Brasil";
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "use as recomendações");

/** O contrato que o arquiteto pôs no componente da Fase 1 e que contradiz a regra do esqueleto. */
const CONTRATO = "As reservas do mesmo quarto podem se sobrepor";
const REGRA = "duas reservas do mesmo quarto não se sobrepõem";
/** A passagem da Fase 1 que o `reject` do caminho feliz cita contra a mesma regra. */
const DA_FASE = "A tabela statuses existe e contém exatamente pendente, confirmada e cancelada";

const original = JSON.parse(ARCHITECTURE) as { components: { name: string; contracts: string[] }[] };
const COM_O_CONTRATO = JSON.stringify({
  ...original,
  components: original.components.map((componente) => (componente.name === "dados" ? { ...componente, contracts: [...componente.contracts, CONTRATO] } : componente)),
});

/** A Fase 1 copia o contrato do componente quando a fatia dela o traz. */
const FASE_1_COPIADA = PHASE_1.replace(
  "    - A tabela reservations existe com status_id referenciando statuses\n",
  `    - A tabela reservations existe com status_id referenciando statuses\n    - ${CONTRATO}\n`,
);
/** A Fase 1 reescrita com a decisão do desenvolvedor: a passagem que contradizia sai. */
const FASE_1_DECIDIDA = PHASE_1.replace(DA_FASE, "A tabela statuses existe com as três situações de uma reserva");

const contradicao = [
  "CAPIVARA_AUDIT_STATUS: REJECTED",
  `CAPIVARA_FINDING: CONTRADICTION | Phase 1 | o critério «${CONTRATO}» contradiz a regra «${REGRA}» | tire a sobreposição do contrato da fase 1`,
  "CAPIVARA_REASON: a fase 1 contradiz uma regra do produto",
].join("\n");

async function init(): Promise<void> {
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
}

function plan(passos: ScriptStep[], extras: Partial<Parameters<typeof runPlan>[0]> = {}) {
  const dito: string[] = [];
  const perguntas: Question[] = [];
  const agent = fakeAgent([...passos, ...skeletonPath()]);
  const ask = extras.ask ?? (async (question: Question) => {
    perguntas.push(question);
    return await responde(question);
  });
  const run = runPlan({ projectRoot, request, language, call: agent.call, ask, announce: (linha) => void dito.push(linha), sleep: async () => undefined, ...extras, ...(extras.ask ? {} : { ask }) });
  return { run, agent, perguntas, anunciado: () => dito.join("\n") };
}

const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
const publicado = (nome: string) => readFile(join(projectRoot, ".capivara/init", nome), "utf8");
const daContradicao = (perguntas: readonly Question[]) => perguntas.filter((pergunta) => pergunta.topic.startsWith("plano · "));

/** O arquiteto põe o contrato no componente; com o achado na mão, tira-o. */
const arquiteto: ScriptStep = {
  match: { role: "writer", stage: "authoring", subject: "architecture" },
  respond: { stdout: (call) => (call.prompt.includes("passagens conferidas pelo Core") ? ARCHITECTURE : COM_O_CONTRATO) },
  repeat: true,
};
const escritorQueCopia: ScriptStep = {
  match: { role: "writer", stage: "authoring", subject: "phase-p01" },
  respond: { stdout: (call) => (call.prompt.includes(CONTRATO) ? FASE_1_COPIADA : PHASE_1) },
  repeat: true,
};
const auditorDoContrato: ScriptStep = {
  match: { role: "auditor", stage: "audit", subject: "project-phases.md" },
  respond: { stdout: (call) => (call.prompt.includes(CONTRATO) ? contradicao : approve()) },
  repeat: true,
};
/** O auditor que reprova enquanto a Fase 1 tem a passagem que contradiz a regra do esqueleto. */
const auditorDaFase: ScriptStep = {
  match: { role: "auditor", stage: "audit", subject: "project-phases.md" },
  respond: { stdout: (call) => (call.prompt.includes(DA_FASE) ? reject("Phase 1", "a fase contradiz a regra das reservas", "troque a lista fixa de situações por uma que não imponha a regra") : approve()) },
  repeat: true,
};
/** O escritor que aplica a decisão do desenvolvedor quando ela chega. */
const escritorQueDecide: ScriptStep = {
  match: { role: "writer", stage: "authoring", subject: "phase-p01" },
  respond: { stdout: (call) => (call.prompt.includes("o desenvolvedor decidiu") ? FASE_1_DECIDIDA : PHASE_1) },
  repeat: true,
};

describe("o bloqueio que sobra depois da emenda", () => {
  it("a contradição que nasce do contrato de um componente: a arquitetura refeita a fecha, e o plano é publicado limpo, por quatro chamadas a mais e nenhuma pergunta", async () => {
    await init();
    const { run, agent, perguntas, anunciado } = plan([arquiteto, escritorQueCopia, auditorDoContrato]);
    const outcome = await run;

    expect(outcome.readiness.ready, anunciado()).toBe(true);
    expect(await publicado("project-phases.md")).not.toContain("Pendência do plano");
    expect(await publicado("project-phases.md")).not.toContain(CONTRATO);
    expect(await publicado("architecture.md")).not.toContain(CONTRATO);
    expect(daContradicao(perguntas)).toEqual([]);

    // A volta única custa uma escrita e uma auditoria da arquitetura, a fase cujo contrato mudou e uma auditoria do plano.
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(3);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(3);

    const volta = por(agent, { role: "writer", stage: "authoring", subject: "architecture" })[1]!.prompt;
    expect(volta).toContain(`«${CONTRATO}» (Phase 1, architecture.md)`);
    expect(volta).toContain(`«${REGRA}» (skeleton.md)`);
  });

  it("a contradição que persiste vira pergunta com as duas passagens e a correção do auditor como leitura recomendada; respondida, a fase é reescrita com a decisão e o plano é publicado limpo", async () => {
    await init();
    const { run, agent, perguntas } = plan([escritorQueDecide, auditorDaFase]);
    const outcome = await run;

    expect(outcome.readiness.ready).toBe(true);
    const [pergunta, ...outras] = daContradicao(perguntas);
    expect(outras).toEqual([]);
    expect(pergunta!.evidence).toContain(`«${DA_FASE}» (Phase 1)`);
    expect(pergunta!.evidence).toContain(`«${REGRA}» (skeleton.md)`);
    expect(pergunta!.recommended).toBe("troque a lista fixa de situações por uma que não imponha a regra");
    expect(pergunta!.options.map((opcao) => opcao.label)).toEqual([
      "troque a lista fixa de situações por uma que não imponha a regra",
      `Vale «${DA_FASE}»`,
      `Vale «${REGRA}»`,
    ]);
    // A resposta virou decisão, e a fase 1 foi reescrita uma vez com ela; não há outra auditoria.
    const reescritas = por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" });
    expect(reescritas.at(-1)!.prompt).toContain("o desenvolvedor decidiu, e esta decisão é a autoridade acima das duas passagens");
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(2);
    const plano = await publicado("project-phases.md");
    expect(plano).not.toContain(DA_FASE);
    expect(plano).not.toContain("Pendência do plano");
  });

  it("sem resposta no prazo, a leitura recomendada é aplicada como decisão, e o plano é publicado limpo", async () => {
    await init();
    const { run } = plan([escritorQueDecide, auditorDaFase], {
      planQuestionTimeoutMs: 20,
      ask: async (question: Question, _indice?: number, _total?: number, controle?: { signal?: AbortSignal }) =>
        question.topic.startsWith("plano · ")
          ? await new Promise<string>((_ok, falha) => controle?.signal?.addEventListener("abort", () => falha(new Error("retirada"))))
          : await responde(question),
    });
    const outcome = await run;

    expect(outcome.readiness.ready).toBe(true);
    expect(await publicado("project-phases.md")).not.toContain(DA_FASE);
    expect(outcome.report.checkpoint.assumptions.some((suposicao) => suposicao.basis.includes("o plan seguiu com a leitura recomendada"))).toBe(true);
  });

  it("o escritor que ignora a decisão deixa as duas passagens no plano: o Core confere, e o plan para citando as duas, sem publicar", async () => {
    await init();
    const { run, perguntas } = plan([auditorDaFase]);
    const erro = await run.then(() => null, (falha: unknown) => falha);

    expect(erro).toBeInstanceOf(InitBlockedError);
    const mensagem = (erro as Error).message;
    expect(mensagem).toContain("continuam no plano depois da decisão");
    expect(mensagem).toContain(`«${DA_FASE}»`);
    expect(mensagem).toContain(`«${REGRA}»`);
    expect(daContradicao(perguntas)).toHaveLength(1);
    await expect(publicado("project-phases.md")).rejects.toThrow();
  });

  it("a arquitetura refeita que a auditoria reprova é descartada; a contradição que mora num documento que o plan não reescreve faz o plan parar, mesmo decidida", async () => {
    await init();
    const auditorDaArquitetura: ScriptStep = {
      match: { role: "auditor", stage: "audit", subject: "architecture" },
      respond: { stdout: (call) => (call.prompt.includes(CONTRATO) ? approve() : reject("phases · Phase 1", "a fase perdeu um contrato", "devolva o contrato")) },
      repeat: true,
    };
    const { run, perguntas } = plan([arquiteto, escritorQueCopia, auditorDoContrato, auditorDaArquitetura]);
    const erro = await run.then(() => null, (falha: unknown) => falha);

    expect(erro).toBeInstanceOf(InitBlockedError);
    expect((erro as Error).message).toContain("o plan não reescreve (o esqueleto ou a arquitetura)");
    expect(await publicado("architecture.md")).toContain(CONTRATO);
    expect(daContradicao(perguntas)).toHaveLength(1);
    await expect(publicado("project-phases.md")).rejects.toThrow();
  });

  it("o caminho limpo não ganha chamada nenhuma nem pergunta", async () => {
    await init();
    const { run, agent, perguntas } = plan([]);
    expect((await run).readiness.ready).toBe(true);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(1);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(1);
    expect(daContradicao(perguntas)).toEqual([]);
    expect(await publicado("project-phases.md")).not.toContain("Pendência do plano");
  });
});
