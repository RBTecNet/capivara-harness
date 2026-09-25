/**
 * O laço de auditoria TERMINA — provado contra um auditor adversário.
 *
 * Todo defeito de convergência deste harness foi descoberto em produção, ao preço
 * de duas horas de run por descoberta: o §73 (o auditor relendo 600 critérios), o
 * §75 (o verificador relendo catorze tasks), o §76 (a auditoria rebaixada por um
 * marcador). Os três são a mesma coisa — um modelo relendo um texto grande acha
 * algo novo a cada passada — e nenhum teste do harness falhava por causa deles,
 * porque os roteiros de teste sempre aprovavam na segunda volta.
 *
 * Este arquivo roteiriza o comportamento adversário: um auditor que devolve um
 * achado VERDADEIRO E NOVO em cada leitura, para sempre, com o endereço reescrito
 * a cada volta. Ele não é injusto — é o que um modelo faz quando a pergunta que
 * lhe foi feita não tem borda.
 *
 * O que se afirma não é que o plano fica bom. É que o harness TERMINA, e que o
 * preço em atenção do desenvolvedor é limitado: quem decide é chamado uma vez por
 * ponto, nunca duas, e o run acaba com um veredito na tela em vez de um laço.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import { fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-convergencia-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
const comum = { language: "português do Brasil" as const };

/**
 * O auditor que nunca fica sem achado.
 *
 * Cada leitura devolve um ponto novo, com endereço novo — é assim que ele aparece
 * nos logs reais, porque ele cita o título da task e a emenda mexe no título.
 */
function auditorAdversario(): ScriptStep {
  let leitura = 0;
  return {
    match: { role: "auditor", stage: "audit" },
    respond: {
      stdout: () => {
        leitura += 1;
        return [
          "CAPIVARA_AUDIT_STATUS: REJECTED",
          `CAPIVARA_FINDING: Tarefa «${"o".repeat(leitura)} formulário de reserva» | ` +
            `os critérios não exigem o campo ${leitura} definido no pedido | acrescente o campo ${leitura}`,
          "CAPIVARA_REASON: falta um campo que o pedido define",
        ].join("\n");
      },
    },
    repeat: true,
  };
}

describe("o laço de auditoria termina contra um auditor que nunca aprova", () => {
  it("termina, e chama o desenvolvedor uma vez por ponto — nunca duas", async () => {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agentInit.call, ask: async () => "use as recomendações" });

    const steps = skeletonPath().filter((step) => step.match.role !== "auditor");
    steps.unshift(auditorAdversario());

    const perguntas: string[] = [];
    let impasses = 0;
    const agent = fakeAgent(steps);

    const outcome = await runPlan({
      projectRoot,
      request,
      ...comum,
      call: agent.call,
      ask: async (question) => {
        perguntas.push(question.decision);
        return "1";
      },
      decideStandoff: async () => {
        impasses += 1;
        return "publicar";
      },
    });

    // Terminou: há veredito, e ele é honesto sobre o que o auditor nunca aprovou.
    expect(outcome.readiness).toBeDefined();
    expect(outcome.report.readiness.checks.find((check) => check.id === "auditoria")).toBeDefined();

    /*
     * O preço em atenção é limitado. Sem teto nenhum aqui o harness perguntaria
     * uma vez por leitura do auditor, e ele lê para sempre; com o teto, ele
     * arbitra os pontos que couberem e o impasse encerra.
     */
    /*
     * O número não é mágico: é o que a arbitragem limitada entrega. Três rodadas,
     * cada uma arbitrando os pontos distintos daquela leitura, e o impasse encerra.
     * Sem o teto de rodadas eram sessenta perguntas; sem a deduplicação por ponto,
     * três vezes cada uma. Os dois defeitos foram descobertos por este teste.
     */
    /*
     * O número não é mágico: é o que a arbitragem limitada entrega, e cada defeito
     * que este teste achou o derrubou. Sessenta, com o teto contado em pontos; um
     * terço disso, com a deduplicação por ponto; e este valor, depois de
     * `ehRepetido` parar de encontrar o achado dentro da própria tentativa que
     * estava sendo julgada — o que fazia TODO achado ser arbitrado na primeira
     * aparição, sem o escritor ter a chance que o §70 lhe dá.
     */
    expect(perguntas.length).toBeLessThan(15);
    expect(new Set(perguntas).size).toBe(perguntas.length);
    expect(impasses).toBeGreaterThan(0);
  }, 30000);

  /*
   * O mesmo achado com o endereço reescrito é o MESMO ponto. Era isso que o
   * `fingerprint` não reconhecia, e por isso o levantamento — a pergunta que
   * existe para o desacordo que sobrevive a uma reescrita — nunca abria.
   */
  it("reconhece o ponto que volta com outro endereço, e o arbitra uma só vez", async () => {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agentInit.call, ask: async () => "use as recomendações" });

    let leitura = 0;
    const steps = skeletonPath().filter((step) => step.match.role !== "auditor");
    steps.unshift({
      match: { role: "auditor", stage: "audit" },
      respond: {
        stdout: () => {
          leitura += 1;
          // Mesmo problema, endereço diferente a cada volta.
          return [
            "CAPIVARA_AUDIT_STATUS: REJECTED",
            `CAPIVARA_FINDING: Tarefa «${"reserva ".repeat(leitura)}» | ` +
              "os critérios não exigem o campo de observações com quatro linhas | exija quatro linhas e rolagem",
            "CAPIVARA_REASON: falta o campo de observações",
          ].join("\n");
        },
      },
      repeat: true,
    });

    const arbitragens: string[] = [];
    const agent = fakeAgent(steps);
    await runPlan({
      projectRoot,
      request,
      ...comum,
      call: agent.call,
      ask: async (question) => {
        if (question.topic.startsWith("auditoria ·")) arbitragens.push(question.decision);
        return "1";
      },
      decideStandoff: async () => "publicar",
    });

    // Uma arbitragem para o ponto, não uma por endereço reescrito.
    expect(arbitragens.length).toBe(1);
  }, 30000);
});
