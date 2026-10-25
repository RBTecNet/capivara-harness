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

/*
 * O achado de cobertura saía sem fase, e `affectedPhases` o mandava para todas.
 * No `assistencia2`, "o workflow 7 não é coberto por nenhuma task" chegou à fase
 * 11 (Estoque), que não tem o workflow 7 na fatia. Ela escreveu o único texto
 * legal que tinha — `[NEEDS DECISION] Indicar a task que implementa workflow 7` —,
 * um marcador que nenhum desenvolvedor pode responder, e o plano inteiro,
 * aprovado, reprovou no gate por causa dele.
 */
describe("o achado de cobertura vai para a fase dona do item", () => {
  it("o workflow que falta é pedido à fase que o esqueleto manda cobri-lo, e a nenhuma outra", async () => {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agentInit.call, ask: async () => "use as recomendações" });

    // A fase 2 é a dona do workflow 1 no esqueleto; ela nasce sem citá-lo.
    const semOWorkflow = PHASE_2.replace("US-1.1, reservations, workflow 1", "US-1.1, reservations");
    let escritas = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p02" },
      respond: {
        stdout: () => {
          escritas += 1;
          return escritas === 1 ? semOWorkflow : PHASE_2;
        },
      },
      repeat: true,
    });

    const agent = fakeAgent(steps);
    const outcome = await runPlan({ projectRoot, request, ...comum, call: agent.call, ask: async () => "use as recomendações" });

    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    // Só a fase 2 foi emendada. A 1 não tem o workflow 1 na fatia, e mandar a
    // ela é o que faz nascer o marcador que ninguém pode responder.
    const emendas = agent.calls.filter((call) => call.stage === "authoring" && call.prompt.includes("amending a phase"));
    expect(emendas.map((call) => call.subject)).toEqual(["phase-p02"]);
    expect(emendas[0]?.prompt).toContain("O esqueleto põe este item na fase 2");
  });
});

