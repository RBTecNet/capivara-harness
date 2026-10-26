/**
 * O bloqueio que sobra depois da emenda (item 1 de "atacar os pontos frágeis").
 *
 * No run `init-dc741f0d7b92` do Codex a auditoria achou seis contradições, a
 * emenda fechou cinco, e a que sobrou era real: o arquiteto pôs os contratos
 * CRUD dos três módulos no componente da Fase 1, e o escritor da fase os
 * copiou. Nenhuma emenda de fase alcança a origem, e o plano parava. Agora o
 * bloqueio vai uma vez à arquitetura, com as citações; a refeita é auditada
 * uma vez, as fases cujo contrato mudou são reescritas e o plano é auditado
 * uma vez. O que ainda sobrar é publicado como pendência da fase.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_1, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";
import { cenarioDaPendenciaDoPlano } from "../support/cenarios-de-medicao.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-pendencia-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "pendencia001" };
const language = "português do Brasil";
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "use as recomendações");

/** O contrato que o arquiteto pôs no componente da Fase 1 e que contradiz a regra do esqueleto. */
const CONTRATO = "As reservas do mesmo quarto podem se sobrepor";
const REGRA = "duas reservas do mesmo quarto não se sobrepõem";

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

const contradicao = [
  "CAPIVARA_AUDIT_STATUS: REJECTED",
  `CAPIVARA_FINDING: CONTRADICTION | Phase 1 | o critério «${CONTRATO}» contradiz a regra «${REGRA}» | tire a sobreposição do contrato da fase 1`,
  "CAPIVARA_REASON: a fase 1 contradiz uma regra do produto",
].join("\n");

async function init(): Promise<void> {
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(skeletonPath()).call, ask: responde, announce: () => undefined });
}

function plan(passos: ScriptStep[]) {
  const dito: string[] = [];
  const agent = fakeAgent([...passos, ...skeletonPath()]);
  const run = runPlan({ projectRoot, request, language, call: agent.call, ask: responde, announce: (linha) => void dito.push(linha), sleep: async () => undefined });
  return { run, agent, anunciado: () => dito.join("\n") };
}

const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
const publicado = (nome: string) => readFile(join(projectRoot, ".capivara/init", nome), "utf8");

/** O arquiteto põe o contrato no componente; com o achado na mão, tira-o. */
const arquiteto: ScriptStep = {
  match: { role: "writer", stage: "authoring", subject: "architecture" },
  respond: { stdout: (call) => (call.prompt.includes("passagens conferidas pelo Core") ? ARCHITECTURE : COM_O_CONTRATO) },
  repeat: true,
};
const escritorDaFase1: ScriptStep = {
  match: { role: "writer", stage: "authoring", subject: "phase-p01" },
  respond: { stdout: (call) => (call.prompt.includes(CONTRATO) ? FASE_1_COPIADA : PHASE_1) },
  repeat: true,
};
const auditorDoPlano: ScriptStep = {
  match: { role: "auditor", stage: "audit", subject: "project-phases.md" },
  respond: { stdout: (call) => (call.prompt.includes(CONTRATO) ? contradicao : approve()) },
  repeat: true,
};

describe("o bloqueio que sobra depois da emenda vai uma vez à arquitetura", () => {
  it("a contradição que nasce do contrato de um componente: a arquitetura refeita a fecha, e o plano é publicado sem pendência, por quatro chamadas a mais", async () => {
    await init();
    const { run, agent, anunciado } = plan([arquiteto, escritorDaFase1, auditorDoPlano]);
    const outcome = await run;

    expect(outcome.readiness.ready, anunciado()).toBe(true);
    expect(await publicado("project-phases.md")).not.toContain("Pendência do plano");
    expect(await publicado("project-phases.md")).not.toContain(CONTRATO);
    expect(await publicado("architecture.md")).not.toContain(CONTRATO);

    // O caminho que parava: uma escrita da arquitetura, uma auditoria dela, duas da fase 1, duas do plano.
    // A volta única custa uma escrita e uma auditoria da arquitetura, a fase cujo contrato mudou e uma auditoria do plano.
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(3);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(3);

    // O arquiteto recebeu o achado com as duas citações e onde cada uma está.
    const volta = por(agent, { role: "writer", stage: "authoring", subject: "architecture" })[1]!.prompt;
    expect(volta).toContain(`«${CONTRATO}» (Phase 1, architecture.md)`);
    expect(volta).toContain(`«${REGRA}» (skeleton.md)`);
  });

  it("a arquitetura refeita que a auditoria reprova é descartada: a anterior fica, e o bloqueio é publicado como pendência da fase", async () => {
    await init();
    const auditorDaArquitetura: ScriptStep = {
      match: { role: "auditor", stage: "audit", subject: "architecture" },
      respond: { stdout: (call) => (call.prompt.includes(CONTRATO) ? approve() : reject("phases · Phase 1", "a fase perdeu um contrato", "devolva o contrato")) },
      repeat: true,
    };
    const { run, agent } = plan([arquiteto, escritorDaFase1, auditorDoPlano, auditorDaArquitetura]);
    const outcome = await run;

    expect(outcome.readiness.ready).toBe(true);
    expect(await publicado("architecture.md")).toContain(CONTRATO);
    const fase1 = (await publicado("project-phases.md")).split("## Phase 2")[0]!;
    expect(fase1).toContain(`**Pendência do plano:** a auditoria do plano não fechou esta contradição: «${CONTRATO}» × «${REGRA}». Correção sugerida pelo auditor: tire a sobreposição do contrato da fase 1`);
    expect((await publicado("project-phases.md")).split("## Phase 2")[1]).not.toContain("Pendência do plano");
    // Descartada a refeita, nada mudou no plano: não há terceira auditoria nem reescrita.
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(2);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(2);
    expect(outcome.report.remarks.some((entrada) => entrada.remark.observation.startsWith("a arquitetura refeita foi descartada pela auditoria"))).toBe(true);
  });

  it("o caminho limpo não ganha chamada nenhuma: uma arquitetura, uma auditoria dela, uma escrita por fase e uma auditoria do plano", async () => {
    await init();
    const { run, agent } = plan([]);
    expect((await run).readiness.ready).toBe(true);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(1);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md" })).toHaveLength(1);
  });
});

describe("a pendência do plano no build", () => {
  it("a contradição que persiste chega ao executor e à revisão, e sem a revisão confirmar a fase falha com ela na causa", async () => {
    const cenario = await cenarioDaPendenciaDoPlano("pendencia-aberta", "pendencia0a1", false);
    try {
      expect(cenario.plan?.readiness.ready).toBe(true);
      const chamadas = cenario.observado.chamadasDoBuild.filter((call) => call.phase.number === 2);
      expect(chamadas.find((call) => call.role === "builder")?.prompt).toContain("## Plan issues this phase carries");
      expect(chamadas.find((call) => call.role === "verifier" && call.purpose === undefined)?.prompt).toContain("PLAN_ISSUE <n>: RESOLVED");
      // A fase sem pendência não recebe nem o bloco nem a linha.
      expect(cenario.observado.chamadasDoBuild.find((call) => call.phase.number === 1 && call.role === "builder")?.prompt).not.toContain("Plan issues");
      expect(cenario.build?.exitCode).toBe(2);
      expect(cenario.build?.errors.join("\n")).toContain("P02 · pendência do plano, sem a revisão confirmar que o código a resolveu");
    } finally {
      await rm(cenario.projectRoot, { recursive: true, force: true });
    }
  });

  it("a revisão que lê no código a contradição resolvida deixa a fase aceita", async () => {
    const cenario = await cenarioDaPendenciaDoPlano("pendencia-resolvida", "pendencia0b2", true);
    try {
      expect(cenario.build?.exitCode).toBe(0);
      expect(cenario.build?.estado).toBe("aceito");
    } finally {
      await rm(cenario.projectRoot, { recursive: true, force: true });
    }
  });
});
