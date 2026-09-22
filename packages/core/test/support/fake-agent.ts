/**
 * Provider falso roteirizado.
 *
 * Um roteiro casa por papel, estágio e assunto e devolve bytes fixos. Chamada
 * não casada FALHA o teste de propósito: um default silencioso esconderia
 * exatamente a regressão que o roteiro existe para pegar.
 */

import { QUESTIONS_CONTRACT } from "../../src/interview/index.js";
import type { AgentCall } from "../../src/init/index.js";

export interface ScriptStep {
  match: { role?: string; stage?: string; subject?: string; attempt?: number };
  /** `stdout` como função quando a resposta depende do que foi perguntado —
   *  o ensaio precisa devolver uma linha por endereço que recebeu. */
  respond: { stdout: string | ((call: AgentCall) => string); exitCode?: number | ((call: AgentCall) => number) };
  /** Passo reutilizável. Útil para a rodada extra de entrevista, em que o
   *  modelo é consultado de novo para ver se as respostas abriram perguntas. */
  repeat?: boolean;
}

export interface FakeAgent {
  call: (call: AgentCall) => Promise<{ stdout: string; exitCode: number }>;
  calls: AgentCall[];
  unmatched: AgentCall[];
}

export function fakeAgent(steps: ScriptStep[]): FakeAgent {
  const used = new Set<number>();
  const agent: FakeAgent = {
    calls: [],
    unmatched: [],
    call: async (call) => {
      agent.calls.push(call);
      const index = steps.findIndex((step, position) => {
        if (used.has(position) && step.match.attempt === undefined && step.repeat !== true) return false;
        const { role, stage, subject, attempt } = step.match;
        if (role !== undefined && role !== call.role) return false;
        if (stage !== undefined && stage !== call.stage) return false;
        if (subject !== undefined && subject !== call.subject) return false;
        if (attempt !== undefined && attempt !== call.attempt) return false;
        return true;
      });
      if (index === -1) {
        agent.unmatched.push(call);
        // Falha alto: um default silencioso esconderia a regressão que o
        // roteiro existe para pegar.
        throw new Error(
          `chamada sem roteiro: role=${call.role} stage=${call.stage} subject=${call.subject} attempt=${call.attempt}`,
        );
      }
      if (steps[index]!.match.attempt === undefined && steps[index]!.repeat !== true) used.add(index);
      const respond = steps[index]!.respond;
      return {
        stdout: typeof respond.stdout === "function" ? respond.stdout(call) : respond.stdout,
        exitCode: typeof respond.exitCode === "function" ? respond.exitCode(call) : (respond.exitCode ?? 0),
      };
    },
  };
  return agent;
}

export const NO_QUESTIONS = JSON.stringify({ contract: QUESTIONS_CONTRACT, questions: [] });

export function oneQuestion(id = "Q-01"): string {
  return JSON.stringify({
    contract: QUESTIONS_CONTRACT,
    questions: [
      {
        id,
        topic: "stack",
        evidence: "O diretório está vazio; nada indica linguagem.",
        decision: "Qual stack o projeto usa?",
        why: "Define os comandos de build e teste.",
        options: [
          { label: "Node + Vitest", consequence: "suíte rápida" },
          { label: "Python + pytest", consequence: "bom para dados" },
        ],
        recommended: "Node + Vitest",
        recommendationBasis: "é a stack dos seus projetos",
      },
    ],
  });
}

export const approve = (reason = "fiel ao pedido e às decisões aceitas") =>
  `CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: ${reason}`;

export const reject = (where: string, problem: string, fix: string) =>
  [`CAPIVARA_AUDIT_STATUS: REJECTED`, `CAPIVARA_FINDING: ${where} | ${problem} | ${fix}`, `CAPIVARA_REASON: ${problem}`].join("\n");

export const PHASE_1 = `## Phase 1: Fundação de dados

**Goal:** migrations e seeds existem · **Depends on:** none · **Covers:** reservations, statuses

- [ ] **Task:** Criar a migration de statuses e semear as três linhas
  - **Acceptance criteria:**
    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada
  - **Feature tests:** statuses_seed → as três linhas existem após o seed
  - **Traces:** statuses

- [ ] **Task:** Criar a migration de reservations com a chave estrangeira
  - **Acceptance criteria:**
    - A tabela reservations existe com status_id referenciando statuses
  - **Feature tests:** reservations_migration → a FK aponta para statuses
  - **Traces:** reservations
`;

export const PHASE_2 = `## Phase 2: Criar reserva

**Goal:** o hóspede cria uma reserva · **Depends on:** Phase 1 · **Covers:** US-1.1, workflow 1

- [ ] **Task:** Implementar a criação de reserva com recusa de datas sobrepostas
  - **Acceptance criteria:**
    - Uma reserva nova nasce com status pendente
    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada
  - **Feature tests:** reserva_sobreposta → a segunda reserva é recusada
  - **Traces:** US-1.1, reservations, workflow 1
`;

/** Endereços que o prompt do ensaio listou, na ordem em que apareceram. */
export function rehearsedAddresses(prompt: string): string[] {
  return [...prompt.matchAll(/^(P\d+\.T\d+\.C\d+) /gm)].map((match) => match[1] ?? "");
}

/** Ensaio que aprova tudo, respondendo a cada endereço que recebeu. */
export function rehearsalApproves(): ScriptStep {
  return {
    match: { role: "verifier", stage: "verify" },
    respond: {
      stdout: (call) =>
        rehearsedAddresses(call.prompt)
          .map((address) => `CRITERION ${address}: OBSERVABLE — dá para abrir o arquivo e olhar`)
          .join("\n"),
    },
    repeat: true,
  };
}

/** Uma fase acrescentada depois, como o `change` faz num plano que já rodou. */
export const PHASE_3 = `## Phase 3: Editar a reserva

**Goal:** o hóspede corrige uma reserva já criada · **Depends on:** Phase 2 · **Covers:** US-1.1

- [ ] **Task:** Implementar a edição de uma reserva existente
  - **Acceptance criteria:**
    - Alterar as datas revalida a sobreposição antes de gravar
    - Uma reserva já cancelada não pode ser editada
  - **Feature tests:** edicao_revalida_sobreposicao → a edição que sobrepõe é recusada
  - **Traces:** US-1.1, reservations
`;

/** Um esqueleto coerente com PHASE_1 e PHASE_2, para o caminho novo. */
export const SKELETON = JSON.stringify({
  contract: "capivara-skeleton/v1",
  projectName: "Pousada",
  stack: [
    { component: "Linguagem", decision: "Node 22 com TypeScript" },
    { component: "Banco", decision: "PostgreSQL 16" },
  ],
  entities: [
    { name: "statuses", fields: [{ name: "nome", type: "text, único" }], relations: [] },
    { name: "reservations", fields: [{ name: "status_id", type: "fk para statuses" }], relations: ["pertence a statuses"] },
  ],
  stories: [{ id: "US-1.1", statement: "Como hóspede, crio uma reserva" }],
  workflows: [{ number: "1", name: "Criar reserva", steps: ["escolher datas", "confirmar"] }],
  rules: [{ subject: "reservations.datas", statement: "duas reservas do mesmo quarto não se sobrepõem" }],
  phases: [
    { number: 1, title: "Fundação de dados", goal: "migrations e seeds existem", dependsOn: "none", covers: ["statuses", "reservations"], taskCount: 2 },
    { number: 2, title: "Criar reserva", goal: "o hóspede cria uma reserva", dependsOn: "Phase 1", covers: ["US-1.1", "workflow 1"], taskCount: 2 },
  ],
  mvpCutPhase: 2,
});

/** Roteiro do caminho por esqueleto: uma leitura do produto, depois as fases. */
export function skeletonPath(): ScriptStep[] {
  return [
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: SKELETON }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: PHASE_1 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: PHASE_2 }, repeat: true },
    { match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true },
    rehearsalApproves(),
  ];
}

/**
 * O caminho feliz do ciclo único: entrevista, esqueleto, fases, auditoria, ensaio.
 *
 * A cadeia de quatro documentos em prosa foi removida do produto, e com ela o
 * roteiro que a exercitava.
 */
export function happyPath(): ScriptStep[] {
  return skeletonPath();
}

