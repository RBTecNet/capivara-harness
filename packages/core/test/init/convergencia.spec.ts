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
import { PHASE_2, fakeAgent, skeletonPath } from "../support/fake-agent.js";
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
        // O tópico é o que distingue uma arbitragem da outra: a pergunta em si passou
        // a ser sempre a mesma frase, com as duas leituras dentro das opções.
        perguntas.push(question.topic);
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
  });

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
        if (question.topic.startsWith("auditoria ·")) arbitragens.push(question.topic);
        return "1";
      },
      decideStandoff: async () => "publicar",
    });

    // Uma arbitragem para o ponto, não uma por endereço reescrito.
    expect(arbitragens.length).toBe(1);
  });
});

/*
 * O invariante que faltava, e que custou um run inteiro: fase aprovada não é
 * reescrita, e achado de uma fase vai para ELA.
 *
 * A auditoria por fase devolve achados cujo endereço é o título da task — medido
 * no `assistencia2`, 24 de 25 não citavam a fase, porque a chamada já sabia qual
 * era. `affectedPhases` então enxergava só o único achado que a citava: reescrevia
 * uma fase e os outros 24 defeitos não chegavam a ninguém, voltando para sempre. E
 * a fase que ele reescrevia perdia a aprovação, porque a marca dela é o sha do
 * texto.
 */
describe("a emenda vai para a fase do achado, e só para ela", () => {
  it("achado da fase 2 não reescreve a fase 1, mesmo sem citar número nenhum", async () => {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agentInit.call, ask: async () => "use as recomendações" });

    // A fase 1 é aprovada; a 2 é devolvida com um achado que NÃO diz "Phase 2".
    let voltas = 0;
    const steps = skeletonPath().filter((step) => step.match.role !== "auditor");
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: fiel" },
      repeat: true,
    });
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2" },
      respond: {
        stdout: () => {
          voltas += 1;
          return voltas === 1
            ? [
                "CAPIVARA_AUDIT_STATUS: REJECTED",
                "CAPIVARA_FINDING: Tarefa «Implementar a criação de reserva» | o critério não diz o que acontece na recusa | descreva o efeito observável",
                "CAPIVARA_REASON: falta o efeito",
              ].join("\n")
            : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: fiel";
        },
      },
      repeat: true,
    });
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: coerente" },
      repeat: true,
    });

    const agent = fakeAgent(steps);
    const { outcome } = await (async () => {
      const resultado = await runPlan({ projectRoot, request, ...comum, call: agent.call, ask: async () => "use as recomendações" });
      return { outcome: resultado };
    })();

    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    /*
     * A emenda tocou a fase 2 e NÃO tocou a 1. Antes, o achado sem número fazia
     * `affectedPhases` devolver todas — e a fase 1, já aprovada, era reescrita,
     * mudava de sha e voltava à fila.
     */
    const emendas = agent.calls.filter((call) => call.stage === "authoring" && call.prompt.includes("amending a phase"));
    expect(emendas.map((call) => call.subject)).toEqual(["phase-p02"]);
  });
});

/*
 * Efeito lateral do `Finding.phase`, encontrado pela análise de impacto e não por
 * acidente: `oQueOEscritorFez` desistia quando `affectedPhases` não conseguia
 * fixar UMA fase, e um achado da auditoria por fase nunca citava fase. Então a
 * pergunta do levantamento oferecia "vale o que o escritor escreveu" sem mostrar o
 * que ele escreveu — o defeito que o §70.2 consertou na renderização e que
 * continuava vivo no dado.
 */
describe("o levantamento mostra o que o escritor entregou", () => {
  it("com a fase declarada pelo harness, as tasks da fase chegam à tela", async () => {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agentInit.call, ask: async () => "use as recomendações" });

    let voltas = 0;
    const steps = skeletonPath().filter((step) => step.match.role !== "auditor");
    // O genérico entra primeiro para ficar DEPOIS do específico na fila: o provider
    // falso casa o primeiro passo compatível, e um passo sem `subject` casa tudo.
    steps.unshift({
      match: { role: "auditor", stage: "audit" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: fiel" },
      repeat: true,
    });
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: () => {
          voltas += 1;
          // O mesmo achado duas vezes, sem citar fase: é o que abre o levantamento.
          return voltas <= 2
            ? [
                "CAPIVARA_AUDIT_STATUS: REJECTED",
                "CAPIVARA_FINDING: Tarefa «Criar a migration de statuses» | falta dizer o que acontece com a linha existente | descreva o efeito",
                "CAPIVARA_REASON: falta o efeito",
              ].join("\n")
            : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: fiel";
        },
      },
      repeat: true,
    });

    const entregas: string[] = [];
    await runPlan({
      projectRoot,
      request,
      ...comum,
      call: fakeAgent(steps).call,
      ask: async (question) => {
        if (question.topic.startsWith("auditoria ·")) {
          // A entrega do escritor vive na opção dele, que é onde ela é escolhida.
          entregas.push(question.options.find((opcao) => opcao.label.includes("escritor"))?.consequence ?? "");
        }
        return "1";
      },
      decideStandoff: async () => "publicar",
    });

    expect(entregas.length).toBeGreaterThan(0);
    expect(entregas[0]).toContain("A fase segue como está");
    expect(entregas[0]).toContain("Criar a migration de statuses");
  });
});

/*
 * `faseDoMarcador` não funcionava NUNCA, e o defeito é exemplar: ela usava
 * `parsePhases(documento)` para achar a fase que contém o marcador, e o parser
 * recusa qualquer documento COM marcador (I-13) — que é o único caso em que ela é
 * chamada. Devolvia `undefined` sempre, `affectedPhases` caía no fallback de
 * "todas", a emenda reescrevia as treze, e toda aprovação caía junto com o sha.
 *
 * Medido no `assistencia2`: a tentativa 3 aprovou 10 fases e a 4 reauditou 12.
 */
describe("a decisão de uma lacuna não derruba as fases aprovadas", () => {
  it("a emenda do marcador toca só a fase dele", async () => {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agentInit.call, ask: async () => "use as recomendações" });

    const marcador = "o status inicial de uma reserva importada";
    const comMarcador = `## Phase 2: Criar reserva

**Goal:** o hóspede cria uma reserva · **Depends on:** Phase 1 · **Covers:** US-1.1, workflow 1

- [ ] **Task:** Implementar a criação de reserva com recusa de datas sobrepostas
  - **Acceptance criteria:**
    - Uma reserva nova nasce com status pendente
    [NEEDS DECISION] ${marcador}
  - **Feature tests:** reserva_sobreposta → a segunda reserva é recusada
  - **Traces:** US-1.1, reservations, workflow 1
`;

    let escritas = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p02" },
      respond: {
        stdout: () => {
          escritas += 1;
          return escritas === 1 ? comMarcador : PHASE_2;
        },
      },
      repeat: true,
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: {
        stdout: JSON.stringify({
          contract: "capivara-questions/v1",
          questions: [
            {
              id: "Q-01",
              topic: "status inicial",
              evidence: "a fase parou aqui",
              decision: "Qual status uma reserva importada recebe?",
              why: "muda o que a migration semeia",
              options: [
                { label: "pendente", consequence: "entra como pendente" },
                { label: "confirmada", consequence: "entra como confirmada" },
              ],
              recommended: "pendente",
              recommendationBasis: "é o de entrada",
            },
          ],
        }),
      },
      repeat: true,
    });

    const agent = fakeAgent(steps);
    await runPlan({ projectRoot, request, ...comum, call: agent.call, ask: async () => "1" });

    // A fase 1 não foi tocada: o marcador estava na 2, e o harness soube dizer qual.
    const emendas = agent.calls.filter((call) => call.stage === "authoring" && call.prompt.includes("amending a phase"));
    expect(emendas.map((call) => call.subject)).toEqual(["phase-p02"]);
  });
});
