/**
 * §127 — o PLAN publica o tempo dos fluxos sem contradição.
 *
 * No Parallel Lab com Luna (0.7.0, run `init-dc741f0d7b92`) o arquiteto
 * escolheu, na primeira chamada, "uma fase final que conecta os módulos ao
 * servidor e à navegação" — a resolução que o próprio prompt oferecia — e
 * deixou cada módulo cobrindo o seu workflow. Ninguém disse a ele, nem ao
 * escritor das fases, nem aos auditores, que o build percorre o workflow ao fim
 * da primeira fase que o cobre. Quatro achados culparam os escritores por
 * "antecipar a integração"; nenhum apontou a cobertura. E a decisão Q-71,
 * levantada pelo auditor da fase 3, saiu sem fase: a resposta foi às fases 1, 4
 * e 6, e a emenda da fase 1, que estava aprovada, devolveu três tasks a menos.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import { decisaoDeEngenhariaComoFinding } from "../../src/audit/authority.js";
import { materialityInput } from "../../src/audit/materiality.js";
import { affectedPhases, parsePhases } from "../../src/contract/index.js";
import { decisaoDoAuditorComoFinding } from "../../src/interview/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { NO_QUESTIONS, approve, fakeAgent, materialityKeeps, rehearsalApproves, reject } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-127-plan-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const PEDIDO = `# CAPIVARA PARALLEL LAB

Aplicação com tarefas e categorias, Node.js, TypeScript, React com Vite e SQLite em arquivo.
Os módulos independentes não devem modificar arquivos compartilhados simultaneamente.
Integração e verificação consolidada ao final.
`;
const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "lunalab00127" };
const language = "português do Brasil" as const;
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");

const ESQUELETO = JSON.stringify({
  contract: "capivara-skeleton/v2",
  environment: [{ technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["--version"] }],
  projectName: "Parallel Lab",
  stack: [
    { component: "Ambiente de execução", decision: "Node.js" },
    { component: "Interface", decision: "React com Vite" },
    { component: "Persistência", decision: "SQLite em arquivo local" },
  ],
  entities: [
    { name: "tarefas", fields: [{ name: "titulo", type: "texto obrigatório" }], relations: [] },
    { name: "categorias", fields: [{ name: "nome", type: "texto obrigatório e único" }], relations: [] },
  ],
  stories: [
    { id: "US-1.1", statement: "Como pessoa usuária, quero navegar pela barra lateral entre o painel e os módulos." },
    { id: "US-2.1", statement: "Como pessoa usuária, quero cadastrar e consultar tarefas." },
    { id: "US-3.1", statement: "Como pessoa usuária, quero cadastrar e consultar categorias." },
  ],
  workflows: [
    { number: "1", name: "Painel", steps: ["Abrir o painel inicial."] },
    { number: "2", name: "Gestão de tarefas", steps: ["Cadastrar uma tarefa.", "Consultar tarefas cadastradas."] },
    { number: "3", name: "Gestão de categorias", steps: ["Cadastrar uma categoria.", "Consultar categorias cadastradas."] },
  ],
  rules: [{ subject: "interface", statement: "A interface é responsiva, em português brasileiro." }],
  phases: [
    { number: 1, title: "Fundação", goal: "Persistência, servidor com registro de rotas e shell com navegação e painel.", dependsOn: "none", covers: ["US-1.1", "workflow 1"], taskCount: 1 },
    { number: 2, title: "Gestão de tarefas", goal: "CRUD de tarefas.", dependsOn: "Phase 1", covers: ["tarefas", "US-2.1", "workflow 2"], taskCount: 1 },
    { number: 3, title: "Gestão de categorias", goal: "CRUD de categorias.", dependsOn: "Phase 1", covers: ["categorias", "US-3.1", "workflow 3"], taskCount: 1 },
  ],
  mvpCutPhase: 3,
});

/** A arquitetura do Luna, reduzida: a fase de categorias deixa a integração para a fase 4, que conecta o módulo. */
function arquitetura(variacao: "adiada" | "sem-espera" | "prematura"): string {
  // "prematura": a fase 4 não espera a de tarefas, e o workflow 3 atravessa tarefas — nenhuma fase completa o caminho.
  const dependeDaIntegracao = variacao === "sem-espera" ? "Phase 2" : variacao === "prematura" ? "Phase 3" : "Phase 2, Phase 3";
  return JSON.stringify({
    contract: "capivara-architecture/v1",
    overview: "Monólito modular: cada módulo mantém suas rotas e páginas; uma fase final conecta categorias ao servidor e à navegação.",
    components: [
      { name: "fundacao", responsibility: "Persistência, servidor HTTP com registro de rotas e shell React com navegação.", areas: ["dados", "backend", "frontend"], dependsOn: [], contracts: ["registrarModulo(prefixo, roteador)", "Caminhos de navegação: /, /tarefas, /categorias"], files: ["server/api/", "src/app/"], owns: [] },
      { name: "modulo-tarefas", responsibility: "CRUD de tarefas.", areas: ["backend", "frontend"], dependsOn: ["fundacao"], contracts: ["GET /api/tarefas → 200 lista"], files: ["server/modulos/tarefas/", "src/modulos/tarefas/"], owns: ["tarefas"] },
      { name: "modulo-categorias", responsibility: "CRUD de categorias.", areas: ["backend", "frontend"], dependsOn: ["fundacao"], contracts: ["GET /api/categorias → 200 lista"], files: ["server/modulos/categorias/", "src/modulos/categorias/"], owns: ["categorias"] },
    ],
    dataDecisions: [{ subject: "tarefas.id", statement: "Identificador inteiro autoincrementado." }],
    flows: [
      { workflow: "1", components: ["fundacao"], notes: "" },
      { workflow: "2", components: ["fundacao", "modulo-tarefas"], notes: "" },
      { workflow: "3", components: variacao === "prematura" ? ["fundacao", "modulo-categorias", "modulo-tarefas"] : ["fundacao", "modulo-categorias"], notes: "" },
    ],
    infrastructure: {
      runtimes: [{ name: "Node.js", version: "", purpose: "Executar a API.", basis: "stack do skeleton: Node.js" }],
      tools: [], packageManagers: [], dependencies: [], services: [],
      databases: [{ name: "SQLite", version: "", purpose: "Persistir os registros.", basis: "pedido original: SQLite em arquivo" }],
      compatibility: [], preconditions: [],
    },
    phases: [
      { number: 1, title: "Fundação", goal: "Persistência, servidor com registro de rotas e shell com navegação e painel.", dependsOn: "none", covers: ["US-1.1", "workflow 1"], areas: ["dados", "backend", "frontend"], components: ["fundacao"], taskCount: 1, rationale: "Fundação." },
      { number: 2, title: "Gestão de tarefas", goal: "CRUD de tarefas, registrado no servidor e na navegação.", dependsOn: "Phase 1", covers: ["tarefas", "US-2.1", "workflow 2"], areas: ["backend", "frontend"], components: ["modulo-tarefas"], taskCount: 1, rationale: "Módulo." },
      {
        number: 3, title: "Gestão de categorias",
        goal: variacao === "prematura" ? "CRUD de categorias." : "CRUD de categorias, entregando a página do módulo pronta para a integração da navegação na fase 4.",
        dependsOn: "Phase 1", covers: ["categorias", "US-3.1", "workflow 3"], areas: ["backend", "frontend"], components: ["modulo-categorias"], taskCount: 1, rationale: "Módulo.",
      },
      { number: 4, title: "Integração de categorias", goal: "Conectar o roteador e a página de categorias ao servidor e à navegação.", dependsOn: dependeDaIntegracao, covers: ["workflow 3"], areas: ["backend", "frontend"], components: ["fundacao"], taskCount: 1, rationale: "Integração." },
    ],
    mvpCutPhase: 4,
  });
}

const FASE = (numero: number, titulo: string, task: string, criterio: string, traces: string) => `## Phase ${numero}: ${titulo}

- [ ] **Task:** ${task}
  - **Acceptance criteria:**
    - ${criterio}
  - **Traces:** ${traces}
`;
const FASES: Record<string, string> = {
  "phase-p01": FASE(1, "Fundação", "Em `server/api/index.ts`, criar o servidor com `registrarModulo(prefixo, roteador)`", "`registrarModulo` monta o roteador sob `/api/<prefixo>`", "US-1.1, workflow 1"),
  "phase-p02": FASE(2, "Gestão de tarefas", "Em `server/modulos/tarefas/routes.ts`, implementar e registrar o roteador de tarefas", "`GET /api/tarefas` retorna `200` e uma lista", "tarefas, US-2.1, workflow 2"),
  "phase-p03": FASE(3, "Gestão de categorias", "Em `server/modulos/categorias/routes.ts`, implementar e exportar `categoriasRouter`", "`categoriasRouter` responde `GET /` com `200` e uma lista", "categorias, US-3.1, workflow 3"),
  "phase-p04": FASE(4, "Integração de categorias", "Em `server/api/index.ts`, montar `categoriasRouter` sob `/api/categorias`", "`GET /api/categorias` retorna `200` pela aplicação", "workflow 3"),
};

interface Papeis {
  arquiteto?: (call: AgentCall) => string;
  p3?: (call: AgentCall) => string;
}

function roteiro(papeis: Papeis = {}): ScriptStep[] {
  return [
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: ESQUELETO }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: papeis.arquiteto ?? (() => arquitetura("adiada")) }, repeat: true },
    ...Object.entries(FASES).map(([subject, texto]) => ({ match: { role: "writer" as const, stage: "authoring" as const, subject }, respond: { stdout: texto }, repeat: true })),
    ...(papeis.p3 ? [{ match: { role: "auditor" as const, stage: "audit" as const, subject: "project-phases.md#P3" }, respond: { stdout: papeis.p3 }, repeat: true }] : []),
    { match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true },
    materialityKeeps(),
    rehearsalApproves(),
  ];
}

async function planejar(papeis: Papeis = {}) {
  const agentDoInit = fakeAgent(roteiro(papeis));
  await runInit({ projectRoot, request, language, stage: "init", call: agentDoInit.call, ask: responde, announce: () => undefined });
  const perguntadas: Question[] = [];
  const agent = fakeAgent(roteiro(papeis));
  const outcome = await runPlan({
    projectRoot, request, language, call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; },
    announce: () => undefined, sleep: async () => undefined,
    decideStandoff: async () => "publicar",
  });
  return { outcome, agent, perguntadas };
}

const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
const deAuditoria = (perguntadas: Question[]) => perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"));

describe("§127 · o PLAN encontra a contradição temporal antes do build", () => {
  it("7, 8 — a fase que deixa o fluxo para outra que não espera por ela volta ao arquiteto, mecanicamente e sem pergunta", async () => {
    let desenhos = 0;
    const { outcome, agent, perguntadas } = await planejar({ arquiteto: () => ((desenhos += 1) === 1 ? arquitetura("sem-espera") : arquitetura("adiada")) });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const arquitetos = por(agent, { stage: "authoring", subject: "architecture" });
    expect(arquitetos).toHaveLength(2);
    expect(arquitetos[1]!.prompt).toContain("a fase 3 deixa para a fase 4");
    expect(arquitetos[1]!.prompt).toContain("a fase 4 não depende da fase 3");
    expect(deAuditoria(perguntadas)).toEqual([]);
  });

  it("7 — o fluxo cobrado antes de o caminho dele existir, sem fase que o complete, volta ao arquiteto", async () => {
    let desenhos = 0;
    const { outcome, agent } = await planejar({ arquiteto: () => ((desenhos += 1) === 1 ? arquitetura("prematura") : arquitetura("adiada")) });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const arquitetos = por(agent, { stage: "authoring", subject: "architecture" });
    expect(arquitetos).toHaveLength(2);
    expect(arquitetos[1]!.prompt).toContain("o workflow 3 é cobrado pelo gate 4 ao fim da fase 3, que o cobre, mas atravessa modulo-tarefas");
  });
});

describe("§127 · o escritor recebe antes o contrato que vai ser cobrado", () => {
  it("cada fase sabe quais fluxos o build percorre ao fim dela, e o auditor cobra o mesmo contrato", async () => {
    const { outcome, agent } = await planejar();
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const escritor = (subject: string) => por(agent, { role: "writer", stage: "authoring", subject })[0]!.prompt;
    expect(escritor("phase-p03")).toContain("workflow 3 (Gestão de categorias) is covered here but walked only at the end of Phase 4");
    expect(escritor("phase-p03")).toContain("it never wires them into the");
    expect(escritor("phase-p02")).toContain("Walked at the end of THIS phase: workflow 2 (Gestão de tarefas)");
    expect(escritor("phase-p04")).toContain("Walked at the end of THIS phase: workflow 3 (Gestão de categorias)");
    const auditorDaTres = por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md#P3" })[0]!.prompt;
    expect(auditorDaTres).toContain("## The timing of this phase's workflows");
    expect(auditorDaTres).toContain("walked only at the end of Phase 4");
    const coerencia = por(agent, { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" })[0]!.prompt;
    expect(coerencia).toContain("Phase 3: covers workflow 3 (Gestão de categorias) but leaves it to Phase 4");
    const daArquitetura = por(agent, { role: "auditor", stage: "audit", subject: "architecture" })[0]!.prompt;
    expect(daArquitetura).toContain("7. TIMING OF WORKFLOWS");
    expect(daArquitetura).toContain("Phase 3: covers workflow 3 (Gestão de categorias) but leaves it to Phase 4");
  });

  it("o arquiteto sabe que `covers` é promessa de tempo, e que as duas integrações são válidas", async () => {
    const { agent } = await planejar();
    const prompt = por(agent, { stage: "authoring", subject: "architecture" })[0]!.prompt;
    expect(prompt).toContain("## When each workflow is walked");
    expect(prompt).toContain("- progressive: the module phase wires its own page and API");
    expect(prompt).toContain("- later integration: the module phase only builds and exports its parts");
  });
});

describe("§127 · a decisão que o auditor de uma fase levanta volta só a ela", () => {
  it("8 — a resposta do desenvolvedor emenda a fase 3; as fases 1, 2 e 4, aprovadas, ficam como estavam", async () => {
    let auditou = 0;
    const decisao = `${approve()}\nCAPIVARA_DECISION: Task 1 | Qual é a cor inicial de uma categoria criada sem cor? | Cinza neutro | A primeira cor da paleta`;
    const { outcome, agent, perguntadas } = await planejar({ p3: () => ((auditou += 1) === 1 ? decisao : approve()) });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(deAuditoria(perguntadas)).toHaveLength(1);
    const escritas = (subject: string) => por(agent, { role: "writer", stage: "authoring", subject }).length;
    expect(escritas("phase-p03")).toBe(2);
    expect([escritas("phase-p01"), escritas("phase-p02"), escritas("phase-p04")]).toEqual([1, 1, 1]);
  });
});

describe("§127 · 16 — o plano correto não ganha chamada", () => {
  it("o caminho limpo da arquitetura com integração posterior: as mesmas chamadas de sempre, nenhuma a mais", async () => {
    const { outcome, agent, perguntadas } = await planejar();
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(deAuditoria(perguntadas)).toEqual([]);
    const chamadas = agent.calls.map((call) => `${call.role}:${call.stage}:${call.subject}`).sort();
    expect(chamadas).toEqual([
      "auditor:audit:architecture",
      "auditor:audit:project-phases.md#P1",
      "auditor:audit:project-phases.md#P2",
      "auditor:audit:project-phases.md#P3",
      "auditor:audit:project-phases.md#P4",
      "auditor:audit:project-phases.md#coerência",
      // O ensaio do verificador, em lotes: o de sempre.
      "verifier:verify:project-phases.md",
      "verifier:verify:project-phases.md",
      "verifier:verify:project-phases.md",
      "verifier:verify:project-phases.md",
      "writer:authoring:architecture",
      "writer:authoring:phase-p01",
      "writer:authoring:phase-p02",
      "writer:authoring:phase-p03",
      "writer:authoring:phase-p04",
    ]);
  });

  it("a contradição que o auditor da fase endereça à arquitetura vai ao arquiteto, nunca ao desenvolvedor", async () => {
    let auditou = 0;
    const achado = reject(
      "Architecture",
      "A fase 3 cobre o workflow 3, que o build percorre ao fim dela, mas a integração da página e do roteador é da fase 4.",
      "Faça a fase 3 integrar o módulo, ou deixe o workflow 3 só na fase que o integra.",
    );
    const { outcome, agent, perguntadas } = await planejar({ p3: () => ((auditou += 1) === 1 ? achado : approve()) });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(deAuditoria(perguntadas)).toEqual([]);
    const arquitetos = por(agent, { stage: "authoring", subject: "architecture" });
    expect(arquitetos.length).toBeGreaterThanOrEqual(2);
    expect(arquitetos[1]!.prompt).toContain("a integração da página e do roteador é da fase 4");
  });
});

describe("§127 · revisão adversarial — C6: a fase da decisão soma, não substitui", () => {
  it("a decisão de engenharia que cita P1.T2 e P3.T4, levantada pela fase 3, vai às duas; a do desenvolvedor sem endereço de fase, só à 3", () => {
    const engenharia = decisaoDeEngenhariaComoFinding({ where: "P1.T2 e P3.T4", decision: "Qual módulo obtém a conexão?", options: ["getDb()", "new Database()"], phase: 3 });
    expect(affectedPhases([engenharia], 4)).toEqual([1, 3]);
    const desenvolvedor = decisaoDoAuditorComoFinding({ where: "Task 1", decision: "Qual é a cor inicial?", options: ["Cinza", "Azul"], phase: 3 }, "Cinza");
    expect(desenvolvedor.where).toBe("Phase 3 · Task 1");
    expect(affectedPhases([desenvolvedor], 4)).toEqual([3]);
  });

  it("a triagem de materialidade põe na mesa a fase que levantou a decisão", () => {
    const plano = ["# Lab — Project Phases", "", "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", "", "## Overview", "", "Três fases.", "",
      ...["phase-p01", "phase-p02", "phase-p03"].map((chave, indice) => FASES[chave]!.replace("## Phase", `## Phase`).replace(/\n- \[ \]/u, `\n**Goal:** g · **Depends on:** ${indice === 0 ? "none" : "Phase 1"} · **Covers:** US-1.1\n\n- [ ]`)),
      "## Open Questions", "", "Nenhuma.", ""].join("\n");
    const lido = parsePhases(plano);
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.errors)).toBe(true);
    const entrada = materialityInput(
      { status: "APPROVED", findings: [], remarks: [], reason: "", decisions: [{ where: "P1.T1", decision: "Qual?", options: ["a", "b"], phase: 3 }] },
      { request: "", decisions: [], phases: lido.ok ? lido.document.phases : [] },
    );
    expect(entrada.sources.map((fonte) => fonte.id)).toEqual(["request", "decisions", "P1", "P3"]);
    expect(entrada.items[0]).toMatchObject({ kind: "decision", phase: 3 });
  });
});
