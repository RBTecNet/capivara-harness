/**
 * §129, no orquestrador — a rodada 2 do Parallel Lab (`laravel/claude`, 0.7.2)
 * com o provider falso.
 *
 * As respostas dos auditores são as do run (`parallel-lab-129.rodada2.json`),
 * com uma única adaptação: o endereço da fase, porque a fixture da pousada tem
 * duas fases e o run tinha seis. O que se prova é o caminho do pedido de
 * testes: ele chega ao esqueleto, é guardado para o build, e não volta ao plano
 * — nem como task, nem como critério, nem como motivo de devolução.
 *
 * `CAPIVARA_MEDIR=1` imprime as chamadas de cada cenário (linhas `MEDIDA`).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAudit } from "../../src/audit/index.js";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { sharedContractFromSkeleton } from "../../src/prompts/acceptance-policy.js";
import { PHASE_2, SKELETON, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

const RODADA_2 = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "parallel-lab-129.rodada2.json"), "utf8")) as Record<string, string>;
const achadoDoRun = (chave: string) => {
  const lido = parseAudit(RODADA_2[chave]!);
  if (!lido.ok) throw new Error(lido.defects.join("; "));
  return lido.verdict.findings[0]!;
};

/** O F2 do run: a fase 3 reprovada por NÃO trazer o critério de testes do módulo. */
const F2 = achadoDoRun("P3");
/** O F1 do run: a sub-fase 4.3 é uma task de teste — e a correção pedia o requisito como critério no lugar. */
const F1 = achadoDoRun("P4");

const PEDIDO =
  "Uma pousada com reservas. Cada módulo deve ter suas próprias rotas, componentes, serviços e testes. " +
  "Os testes precisam utilizar banco isolado dos dados normais da aplicação. Testes automatizados aprovados.";

/** A task de teste da sub-fase 4.3 do run, com o nome do módulo da pousada. */
const PHASE_2_COM_TASK_DE_TESTE = `${PHASE_2.trimEnd()}

- [ ] **Task:** O módulo Reservas tem os seus próprios testes automatizados, executados contra um banco SQLite isolado e descartável, nunca o arquivo do banco normal
  - **Acceptance criteria:**
    - A execução dos testes do módulo não cria, altera nem apaga registros do arquivo de banco configurado no \`.env\`
    - Os testes de Reservas são aprovados na mesma execução documentada dos testes dos demais módulos
  - **Traces:** US-1.1, reservations, workflow 1
`;

/** O esqueleto como o escritor do run o escreveu: o pedido de testes na stack e numa regra. */
const SKELETON_COM_TESTES = JSON.stringify({
  ...JSON.parse(SKELETON),
  stack: [...JSON.parse(SKELETON).stack, { component: "Testes", decision: "Testes automatizados, executados contra um banco isolado dos dados normais da aplicação" }],
  rules: [
    ...JSON.parse(SKELETON).rules,
    { subject: "testes.requisito", statement: "O produto tem testes automatizados, e cada módulo tem os seus próprios, executados contra o banco isolado. Todos devem ser aprovados em uma única execução documentada." },
  ],
});

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-129-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "pousada12900" };
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

function custo(cenario: string, agent: { calls: AgentCall[] }): void {
  if (process.env.CAPIVARA_MEDIR !== "1") return;
  const contar = (filtro: Partial<AgentCall>) => por(agent, filtro).length;
  console.log(`MEDIDA ${cenario}: total=${agent.calls.length} escritaP2=${contar({ stage: "authoring", subject: "phase-p02" })} auditoriaP2=${contar({ stage: "audit", subject: "project-phases.md" })}`);
}

async function init(steps: ScriptStep[]) {
  const agent = fakeAgent(steps);
  await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: agent.call, ask: responde, announce: () => undefined });
  return agent;
}

async function plan(steps: ScriptStep[]) {
  const dito: string[] = [];
  const perguntadas: Question[] = [];
  const agent = fakeAgent(steps);
  const outcome = await runPlan({
    projectRoot, request, language: "português do Brasil", call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; }, announce: (linha) => void dito.push(linha), sleep: async () => undefined,
  });
  return { outcome, agent, perguntadas, anunciado: dito.join("\n") };
}

const publicado = (nome: string) => readFile(join(projectRoot, ".capivara/init", nome), "utf8");

describe("§129 · teste não é motivo de devolução", () => {
  it("a fase reprovada por NÃO ter o critério de testes sai aprovada: sem emenda e sem pergunta", async () => {
    await init(skeletonPath());
    const f2 = reject("Phase 2 (Goal, task 2.1)", F2.problem, F2.fix);
    const { outcome, agent, perguntadas, anunciado } = await plan([
      // O auditor do run insistiu duas rodadas; aqui ele insiste sempre.
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: f2 }, repeat: true },
      ...skeletonPath(),
    ]);
    custo("F2", agent);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado).toContain("pediam ou julgavam teste");
    expect(por(agent, { stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(por(agent, { stage: "audit", subject: "project-phases.md" })).toHaveLength(1);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(await publicado("project-phases.md")).not.toMatch(/testes automatizados/u);
  });

  it("a correção que mandava tirar a task de teste e pôr o requisito como critério chega ao escritor só tirando", async () => {
    await init(skeletonPath());
    let leituras = 0;
    const f1 = reject("Phase 2.2 (task \"O módulo Reservas tem os seus próprios testes automatizados\")", F1.problem, F1.fix.replaceAll("4.3", "2.2"));
    const { outcome, agent } = await plan([
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: () => ((leituras += 1) === 1 ? f1 : approve()) }, repeat: true },
      ...skeletonPath(),
    ]);
    custo("F1", agent);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const emenda = por(agent, { stage: "authoring", subject: "phase-p02" })[1]?.prompt ?? "";
    expect(emenda).toContain("Remova a Phase 2.2 e a tarefa");
    expect(emenda).not.toContain("Registre o requisito do desenvolvedor");
    expect(emenda).not.toContain("mova-o");
    expect(emenda).toContain("Não escreva nada sobre testes no lugar");
  });
});

describe("§129 · a task de teste não chega a nenhum auditor", () => {
  it("a task que é teste — a 4.3 do run — volta ao escritor pela I-16, e o plano publicado não a carrega", async () => {
    await init(skeletonPath());
    let escritas = 0;
    const { outcome, agent } = await plan([
      { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: () => ((escritas += 1) === 1 ? PHASE_2_COM_TASK_DE_TESTE : PHASE_2) }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "phase-p02"),
    ]);
    custo("4.3", agent);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const escritasP2 = por(agent, { stage: "authoring", subject: "phase-p02" });
    expect(escritasP2).toHaveLength(2);
    expect(escritasP2[1]?.prompt).toContain("I-16");
    expect(escritasP2[1]?.prompt).toContain("executado pelo build");
    for (const auditoria of por(agent, { stage: "audit", subject: "project-phases.md" })) {
      expect(auditoria.prompt).not.toContain("tem os seus próprios testes automatizados");
    }
    expect(await publicado("project-phases.md")).not.toContain("testes automatizados");
  });
});

describe("§129 · o pedido de testes vai para o build", () => {
  it("o esqueleto o guarda na regra de testes e na stack, o build o recebe no contrato compartilhado, e o arquiteto e o escritor de fase não o veem", async () => {
    await init([
      { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: SKELETON_COM_TESTES }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "skeleton"),
    ]);
    const md = await publicado("skeleton.md");
    expect(md).toContain("- Testes: Testes automatizados, executados contra um banco isolado dos dados normais da aplicação");
    expect(md.slice(md.indexOf("## Regras transversais"), md.indexOf("## Fases"))).toContain("- testes.requisito: O produto tem testes automatizados, e cada módulo tem os seus próprios");
    const contrato = sharedContractFromSkeleton(md);
    expect(contrato).toContain("cada módulo tem os seus próprios");
    expect(contrato).toContain("- Testes: Testes automatizados");

    const { outcome, agent } = await plan(skeletonPath().filter((passo) => passo.match.subject !== "skeleton"));
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    for (const chamada of [...por(agent, { stage: "authoring", subject: "architecture" }), ...por(agent, { stage: "authoring", subject: "phase-p02" })]) {
      expect(chamada.prompt).not.toContain("cada módulo tem os seus próprios");
      expect(chamada.prompt).not.toContain("- Testes: Testes automatizados");
    }
  });
});

describe("§129 · a ressalva do pedido de testes fica no relatório", () => {
  it("o pedido de testes que o escritor insiste em pôr numa story é publicado com ressalva, e a ressalva não chega aos auditores do plano", async () => {
    const naStory = JSON.stringify({
      ...JSON.parse(SKELETON_COM_TESTES),
      stories: [{ id: "US-1.1", statement: "Como hóspede, crio uma reserva, e o módulo de reservas tem testes automatizados próprios" }],
    });
    // INIT e PLAN no mesmo processo: é o caminho em que as ressalvas do esqueleto chegam às auditorias do plano.
    const agent = fakeAgent([
      { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: naStory }, repeat: true },
      { match: { role: "auditor", stage: "authoring", subject: "skeleton" }, respond: { stdout: naStory }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "skeleton"),
    ]);
    const outcome = await runInit({ projectRoot, request, language: "português do Brasil", call: agent.call, ask: responde, announce: () => undefined, sleep: async () => undefined });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(outcome.report.remarks.some((entrada) => entrada.remark.observation.includes("carrega o pedido de testes para o plano"))).toBe(true);
    const auditorias = agent.calls.filter((call) => call.stage === "audit");
    expect(auditorias.length).toBeGreaterThan(0);
    for (const auditoria of auditorias) expect(auditoria.prompt).not.toContain("carrega o pedido de testes para o plano");
  });
});
