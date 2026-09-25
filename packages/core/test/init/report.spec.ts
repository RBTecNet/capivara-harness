/**
 * O relatório que o desenvolvedor lê no fim do `plan`.
 *
 * Ele é a única prestação de contas do run: o que foi decidido, por quem, e
 * sobre o quê. Uma decisão sob o tópico errado ou com o endereço dito duas vezes
 * é pior que cosmética — é o desenvolvedor lendo o próprio produto errado.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderReport, runInit, runPlan } from "../../src/init/index.js";
import type { InitReport } from "../../src/init/index.js";
import { readHandoff } from "../../src/interview/index.js";
import { PHASE_2, fakeAgent, skeletonPath } from "../support/fake-agent.js";

const relatorio = (decisions: { questionId: string; topic: string; decision: string }[]): InitReport => ({
  ready: true,
  published: [],
  phases: 1,
  tasks: 1,
  mvpCutPhase: 1,
  coverage: { stories: 0, entities: 0, workflows: 0 },
  checkpoint: { decisions, assumptions: [], deferrals: [], ambiguities: [] },
  remarks: [],
  costs: [],
  readiness: { ready: true, checks: [], contractErrors: [] },
});

/*
 * O conserto original (f9ede43) conhecia um prefixo só — `auditoria` — e saiu sem
 * teste. A arbitragem do ensaio nasceu depois, com tópico `ensaio · P1.T3.C1`, e o
 * relatório do `assistencia2` a mostrou assim: "ensaio · P1.T3.C1: P1.T3.C1: fica
 * como está". A irmã que ficou para trás, e sem teste nenhum que a pegasse.
 */
describe("a linha de uma decisão arbitrada diz o endereço uma vez", () => {
  it("vale para o levantamento de auditoria", () => {
    const texto = renderReport(
      relatorio([{ questionId: "Q-91", topic: "auditoria · Tarefas 4, 6 e 8", decision: "Tarefas 4, 6 e 8: Incluir SREP nos bloqueios" }]),
    );
    expect(texto).toContain("· auditoria · Tarefas 4, 6 e 8: Incluir SREP nos bloqueios");
    expect(texto).not.toContain("Tarefas 4, 6 e 8: Tarefas 4, 6 e 8");
  });

  it("e para a arbitragem do ensaio, que é a irmã", () => {
    const texto = renderReport(
      relatorio([{ questionId: "Q-61", topic: "ensaio · P1.T3.C1", decision: "P1.T3.C1: fica como está" }]),
    );
    expect(texto).toContain("· ensaio · P1.T3.C1: fica como está");
    expect(texto).not.toContain("P1.T3.C1: P1.T3.C1");
  });

  it("decisão comum continua com tópico e texto", () => {
    const texto = renderReport(relatorio([{ questionId: "Q-01", topic: "Banco de dados", decision: "Já existe um servidor" }]));
    expect(texto).toContain("· Banco de dados: Já existe um servidor");
  });
});

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-relatorio-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
const comum = { language: "português do Brasil" as const };

/*
 * Cada rodada de lacuna recomeça em `Q-01`, e o handoff guardava o id local:
 * `persistAnswers` descartava a pergunta da rodada 2 por já existir um `Q-01`, mas
 * guardava a resposta. No `assistencia2`, "uma tarefa única para clientes e
 * equipamentos" ficou pendurada em "Vencimento da recorrência".
 */
describe("duas rodadas de lacuna não se misturam no handoff", () => {
  it("cada resposta fica com a pergunta que a gerou", async () => {
    await runInit({ projectRoot, request, ...comum, stage: "init", call: fakeAgent(skeletonPath()).call, ask: async () => "use as recomendações" });

    const marcador = (texto: string): string => `## Phase 2: Criar reserva

**Goal:** o hóspede cria uma reserva · **Depends on:** Phase 1 · **Covers:** US-1.1, workflow 1

- [ ] **Task:** Implementar a criação de reserva com recusa de datas sobrepostas
  - **Acceptance criteria:**
    - Uma reserva nova nasce com status pendente
    [NEEDS DECISION] ${texto}
  - **Feature tests:** reserva_sobreposta → a segunda reserva é recusada
  - **Traces:** US-1.1, reservations, workflow 1
`;

    // A escrita deixa um marcador; a primeira emenda fecha-o e abre OUTRO.
    let escritas = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p02" },
      respond: {
        stdout: () => {
          escritas += 1;
          return escritas === 1 ? marcador("o vencimento no mês curto") : escritas === 2 ? marcador("quem cadastra o equipamento") : PHASE_2;
        },
      },
      repeat: true,
    });
    let rodada = 0;
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: {
        stdout: () => {
          rodada += 1;
          const [topico, pergunta] = rodada === 1
            ? ["Vencimento", "Como tratar o vencimento no mês curto?"]
            : ["Equipamentos", "Quem cadastra o equipamento?"];
          return JSON.stringify({
            contract: "capivara-questions/v1",
            questions: [{
              id: "Q-01", topic: topico, evidence: "a fase parou aqui", decision: pergunta, why: "muda a fase",
              options: [{ label: "A", consequence: "a" }, { label: "B", consequence: "b" }],
              recommended: "A", recommendationBasis: "é o de menor escopo",
            }],
          });
        },
      },
      repeat: true,
    });

    await runPlan({ projectRoot, request, ...comum, call: fakeAgent(steps).call, ask: async () => "1" });

    const handoff = await readHandoff(projectRoot, (await import("../../src/state/index.js")).runIdFor("init", request.sha12), "project-phases.md");
    const topicos = (handoff?.questions ?? []).map((pergunta) => pergunta.topic);
    expect(topicos).toContain("Vencimento");
    expect(topicos).toContain("Equipamentos");
    // E cada resposta aponta para uma pergunta que existe, sem colisão.
    const ids = new Set((handoff?.questions ?? []).map((pergunta) => pergunta.id));
    expect((handoff?.answers ?? []).every((resposta) => ids.has(resposta.questionId))).toBe(true);
    expect(ids.size).toBe((handoff?.questions ?? []).length);
  });
});
