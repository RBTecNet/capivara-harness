/**
 * §124 — integridade da triagem: finding material só está resolvido quando o
 * plano está coerente.
 *
 * O `haiku` (Parallel Lab, 0.6.2, run `init-dc741f0d7b92`): a fundação
 * entregava `src/servidor/modulos.ts` com as quatro entradas e a casca
 * `src/web/navegacao.ts` com os quatro itens; as fases 3 a 6, sem ordem entre
 * si, mandavam "acrescentar"/"registrar" cada entrada de novo. O auditor de
 * coerência apontou três rodadas seguidas; a triagem de materialidade
 * descartou três rodadas seguidas ("os conflitos desaparecem se a fundação já
 * registrar as entradas e os módulos só substituírem os próprios stubs"); e o
 * plano foi publicado RALPH READY com as tasks ordenando o registro duplicado
 * e a edição concorrente que o pedido proíbe.
 *
 * O que se prova aqui, com o provider falso sobre textos modelados nos reais:
 * a obrigação de escrita concorrente é conferida em código antes de qualquer
 * auditor (I-18), vira emenda localizada na fase que escreve, o auditor não
 * aprova o próprio reparo, a publicação não acontece com a contradição no
 * texto, a triagem não descarta um conflito entre fases citando só um lado,
 * a substituição explícita entre fases sequenciais continua aceita, e o
 * caminho limpo não ganhou chamada nenhuma.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditVerdict } from "../../src/audit/protocol.js";
import { checkWriteOwnership, parsePhaseFragment, parsePhases } from "../../src/contract/index.js";
import { InitBlockedError, runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { evaluateReadiness } from "../../src/init/readiness.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { REPAIR_MARKER } from "../../src/prompts/index.js";
import type { Question } from "../../src/interview/index.js";
import { NO_QUESTIONS, approve, fakeAgent } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-124-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "Parallel Lab: uma fundação compartilhada e módulos independentes que não modificam arquivos compartilhados ao mesmo tempo", origin: "text" as const, path: null, sha12: "paralle1lab1" };
const language = "português do Brasil" as const;
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
const emendas = (agent: { calls: AgentCall[] }, subject?: string) =>
  agent.calls.filter((call) => call.stage === "authoring" && call.prompt.includes("amending a phase") && (subject === undefined || call.subject === subject));

/* ---------- o produto, modelado no Parallel Lab: fundação e dois módulos sem ordem entre si ---------- */

const SKELETON_124 = JSON.stringify({
  contract: "capivara-skeleton/v2",
  environment: [{ technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["--version"] }],
  projectName: "Parallel Lab",
  stack: [
    { component: "Linguagem", decision: "Node 22 com TypeScript" },
    { component: "API", decision: "Express 5" },
    { component: "Banco", decision: "SQLite em arquivo" },
  ],
  entities: [
    { name: "tarefas", fields: [{ name: "titulo", type: "texto, obrigatório" }], relations: [] },
    { name: "categorias", fields: [{ name: "nome", type: "texto, único" }], relations: [] },
  ],
  stories: [
    { id: "US-1.1", statement: "Como desenvolvedor, subo a API com os módulos montados" },
    { id: "US-2.1", statement: "Como usuário, cadastro e listo tarefas" },
    { id: "US-3.1", statement: "Como usuário, cadastro e listo categorias" },
  ],
  workflows: [{ number: "1", name: "Cadastrar tarefa", steps: ["abrir tarefas", "cadastrar", "ver na lista"] }],
  rules: [
    { subject: "api.prefixo", statement: "Toda rota da API fica sob /api; GET /api/tarefas devolve a lista de tarefas e GET /api/categorias a lista de categorias" },
    { subject: "modulos.independencia", statement: "Os módulos independentes não modificam arquivos compartilhados ao mesmo tempo; cada módulo entrega as próprias rotas" },
  ],
  phases: [
    { number: 1, title: "Fundação", goal: "a API sobe com o ponto único onde os módulos são montados", dependsOn: "none", covers: ["US-1.1"], taskCount: 1 },
    { number: 2, title: "Módulo Tarefas", goal: "o usuário cadastra e lista tarefas", dependsOn: "Phase 1", covers: ["US-2.1", "tarefas", "workflow 1"], taskCount: 1 },
    { number: 3, title: "Módulo Categorias", goal: "o usuário cadastra e lista categorias", dependsOn: "Phase 1", covers: ["US-3.1", "categorias"], taskCount: 1 },
  ],
  mvpCutPhase: 3,
});

const ARCHITECTURE_124 = JSON.stringify({
  contract: "capivara-architecture/v1",
  overview: "Uma API Express sobre SQLite. A fundação entrega o ponto de extensão src/servidor/modulos.ts já com a entrada de cada módulo; cada módulo implementa só os próprios arquivos, e as fases de módulo rodam em paralelo sem disputar arquivos.",
  components: [
    { name: "api-base", responsibility: "a aplicação Express e a lista única de montagem dos módulos", areas: ["backend"], dependsOn: [], contracts: ["criarModulosApi(banco): { caminho, router }[] — uma entrada por módulo, montada sob /api"], files: ["src/servidor/app.ts", "src/servidor/modulos.ts"], owns: [] },
    { name: "tarefas-api", responsibility: "as rotas de tarefas", areas: ["backend"], dependsOn: ["api-base"], contracts: ["GET /api/tarefas → 200 lista", "POST /api/tarefas → 201 tarefa"], files: ["src/servidor/modulos/tarefas/rotas.ts"], owns: ["tarefas"] },
    { name: "categorias-api", responsibility: "as rotas de categorias", areas: ["backend"], dependsOn: ["api-base"], contracts: ["GET /api/categorias → 200 lista", "POST /api/categorias → 201 categoria"], files: ["src/servidor/modulos/categorias/rotas.ts"], owns: ["categorias"] },
  ],
  dataDecisions: [{ subject: "tarefas.id", statement: "inteiro autoincremento" }],
  flows: [{ workflow: "1", components: ["tarefas-api", "api-base"], notes: "" }],
  infrastructure: {
    runtimes: [{ name: "Node.js", version: "22", purpose: "executar a aplicação", basis: "stack do esqueleto: Node 22 com TypeScript" }],
    tools: [{ name: "TypeScript", version: "", purpose: "tipagem", basis: "stack do esqueleto" }],
    packageManagers: [{ name: "npm", version: "", purpose: "dependências", basis: "padrão do runtime Node.js" }],
    dependencies: [
      { name: "express", version: "5", kind: "app", purpose: "API", basis: "stack do esqueleto: Express 5" },
      { name: "better-sqlite3", version: "", kind: "app", purpose: "SQLite em arquivo", basis: "stack do esqueleto: SQLite em arquivo" },
    ],
    services: [],
    databases: [{ name: "SQLite", version: "", purpose: "persistência", basis: "stack do esqueleto: SQLite em arquivo" }],
    compatibility: ["Node 22 ou superior"],
    preconditions: [],
  },
  phases: [
    { number: 1, title: "Fundação", goal: "a API sobe com o ponto único onde os módulos são montados", dependsOn: "none", covers: ["US-1.1"], areas: ["backend"], components: ["api-base"], taskCount: 1, rationale: "todos dependem do ponto de montagem" },
    { number: 2, title: "Módulo Tarefas", goal: "o usuário cadastra e lista tarefas", dependsOn: "Phase 1", covers: ["US-2.1", "tarefas", "workflow 1"], areas: ["backend"], components: ["tarefas-api"], taskCount: 1, rationale: "só os próprios arquivos; roda em paralelo com categorias" },
    { number: 3, title: "Módulo Categorias", goal: "o usuário cadastra e lista categorias", dependsOn: "Phase 1", covers: ["US-3.1", "categorias"], areas: ["backend"], components: ["categorias-api"], taskCount: 1, rationale: "só os próprios arquivos; roda em paralelo com tarefas" },
  ],
  mvpCutPhase: 3,
});

/* ---------- as fases, modeladas nas tasks reais ---------- */

const P1_FUNDACAO = `## Phase 1: Fundação

**Goal:** a API sobe com o ponto único onde os módulos são montados · **Depends on:** none · **Covers:** US-1.1

- [ ] **Task:** Criar \`src/servidor/app.ts\` com \`criarApp(banco)\` e \`src/servidor/modulos.ts\` com \`criarModulosApi(banco): { caminho: string; router: Router }[]\`, que devolve, nesta ordem, as entradas \`/tarefas\` e \`/categorias\`, cada uma com o router do stub \`criarRotas(banco)\` do módulo correspondente
  - **Acceptance criteria:**
    - \`criarModulosApi(banco)\` devolve exatamente duas entradas, \`/tarefas\` e \`/categorias\`, e \`criarApp\` monta cada uma sob \`/api\`
    - Os stubs \`src/servidor/modulos/tarefas/rotas.ts\` e \`src/servidor/modulos/categorias/rotas.ts\` exportam \`criarRotas(banco)\` e devolvem um Router sem rota nenhuma
  - **Traces:** US-1.1
`;

/** O que o Haiku escreveu: o módulo cria as próprias rotas E registra de novo a entrada que a fundação já entregou. */
const P2_CONTAMINADA = `## Phase 2: Módulo Tarefas

**Goal:** o usuário cadastra e lista tarefas · **Depends on:** Phase 1 · **Covers:** US-2.1, tarefas, workflow 1

- [ ] **Task:** Criar \`src/servidor/modulos/tarefas/rotas.ts\` com \`criarRotas(banco): Router\` e registrar o módulo em \`src/servidor/modulos.ts\`, acrescentando à lista de \`criarModulosApi(banco)\` a entrada \`{ caminho: '/tarefas', router: criarRotas(banco) }\`, sem outra alteração nesse arquivo
  - **Acceptance criteria:**
    - \`GET /api/tarefas\` devolve 200 com a lista de tarefas e \`POST /api/tarefas\` devolve 201 com a tarefa criada
    - \`src/servidor/modulos.ts\` contém exatamente um item com \`caminho: '/tarefas'\`
  - **Traces:** US-2.1, tarefas, workflow 1

- [ ] **Task:** Criar \`src/web/modulos/tarefas/TarefasPagina.tsx\` com a lista e o formulário de tarefas
  - **Acceptance criteria:**
    - A página lista as tarefas devolvidas por \`GET /api/tarefas\` e cadastra pelo formulário
  - **Traces:** US-2.1, tarefas
`;

const P3_CONTAMINADA = `## Phase 3: Módulo Categorias

**Goal:** o usuário cadastra e lista categorias · **Depends on:** Phase 1 · **Covers:** US-3.1, categorias

- [ ] **Task:** Registrar o router \`criarRotas(banco)\` em \`src/servidor/modulos.ts\` como um item \`{ caminho: '/categorias', router: criarRotas(banco) }\` da lista devolvida por \`criarModulosApi\`, e criar \`src/servidor/modulos/categorias/rotas.ts\` com as rotas do módulo
  - **Acceptance criteria:**
    - \`GET /api/categorias\` devolve 200 com a lista de categorias e \`POST /api/categorias\` devolve 201 com a categoria criada
    - \`src/servidor/modulos.ts\` contém exatamente um item com \`caminho: '/categorias'\`
  - **Traces:** US-3.1, categorias
`;

/** O que o auditor mandou: o módulo implementa o stub que a fundação registrou, sem escrever no arquivo compartilhado. */
const P2_CORRIGIDA = P2_CONTAMINADA.replace(
  "Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco): Router` e registrar o módulo em `src/servidor/modulos.ts`, acrescentando à lista de `criarModulosApi(banco)` a entrada `{ caminho: '/tarefas', router: criarRotas(banco) }`, sem outra alteração nesse arquivo",
  "Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco): Router`, o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/tarefas`",
);
/** A emenda que, além de corrigir a task em conflito, mexe no que ninguém pediu: a outra task e o envelope. */
const P2_EMENDA_INVASIVA = P2_CORRIGIDA
  .replace("**Depends on:** Phase 1 ·", "**Depends on:** Phase 1, Phase 3 ·")
  .replace("Criar `src/web/modulos/tarefas/TarefasPagina.tsx` com a lista e o formulário de tarefas", "Criar `src/web/modulos/tarefas/TarefasPagina.tsx` REESCRITA sem motivo")
  .replace("    - A página lista as tarefas devolvidas por `GET /api/tarefas` e cadastra pelo formulário", "    - A página lista as tarefas devolvidas por `GET /api/tarefas` e cadastra pelo formulário\n    - Um critério que ninguém pediu");
const P3_CORRIGIDA = P3_CONTAMINADA.replace(
  "Registrar o router `criarRotas(banco)` em `src/servidor/modulos.ts` como um item `{ caminho: '/categorias', router: criarRotas(banco) }` da lista devolvida por `criarModulosApi`, e criar `src/servidor/modulos/categorias/rotas.ts` com as rotas do módulo",
  "Criar `src/servidor/modulos/categorias/rotas.ts` com `criarRotas(banco): Router`, o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/categorias`",
);

/* ---------- roteiros ---------- */

function caminho(fases: { p1?: (call: AgentCall) => string; p2: (call: AgentCall) => string; p3: (call: AgentCall) => string }, extras: ScriptStep[] = []): ScriptStep[] {
  return [
    ...extras,
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: SKELETON_124 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: ARCHITECTURE_124 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: fases.p1 ?? (() => P1_FUNDACAO) }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: fases.p2 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p03" }, respond: { stdout: fases.p3 }, repeat: true },
    { match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true },
  ];
}

async function init(steps: ScriptStep[]) {
  await runInit({ projectRoot, request, language, stage: "init", call: fakeAgent(steps).call, ask: responde, announce: () => undefined });
}

async function plan(steps: ScriptStep[], extras: Partial<Parameters<typeof runPlan>[0]> = {}) {
  const dito: string[] = [];
  const agent = fakeAgent(steps);
  const run = runPlan({
    projectRoot, request, language, call: agent.call, ask: responde,
    announce: (linha) => void dito.push(linha), sleep: async () => undefined,
    ...extras,
  });
  return { run, agent, anunciado: () => dito.join("\n") };
}

const planoPublicado = async () => readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
const emenda = (call: AgentCall) => call.prompt.includes("amending a phase");

describe("§124 — a obrigação de escrita concorrente é conferida em código, antes de qualquer auditor", () => {
  it("9, 10, 11. a ambiguidade material vira reparo localizado: só as fases que escrevem são emendadas, a instrução contraditória sai e o contrato do produto fica", async () => {
    const roteiro = caminho({
      p2: (call) => (emenda(call) ? P2_EMENDA_INVASIVA : P2_CONTAMINADA),
      p3: (call) => (emenda(call) ? P3_CORRIGIDA : P3_CONTAMINADA),
    });
    await init(roteiro);
    const { run, agent, anunciado } = await plan(roteiro);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    // O achado tem endereço de task: só ela muda; a task vizinha volta byte a byte, e o envelope é do harness.
    expect(emendas(agent, "phase-p02")[0]?.prompt).toContain("P2.T1 · linha");
    const plano0 = await planoPublicado();
    expect(plano0).toContain("Criar `src/web/modulos/tarefas/TarefasPagina.tsx` com a lista e o formulário de tarefas");
    expect(plano0).not.toContain("REESCRITA sem motivo");
    expect(plano0).not.toContain("Um critério que ninguém pediu");
    expect(plano0).not.toContain("Phase 1, Phase 3");

    // A emenda foi à fase 2 e à fase 3 — as que escrevem — e nunca à fundação, que é a dona.
    expect(emendas(agent).map((call) => call.subject).sort()).toEqual(["phase-p02", "phase-p03"]);
    expect(emendas(agent, "phase-p01")).toHaveLength(0);
    // O achado é o I-18, com o dono nomeado e a correção que não inventa dependência.
    const prompt = emendas(agent, "phase-p02")[0]?.prompt ?? "";
    expect(prompt).toContain("I-18:");
    expect(prompt).toContain("ordena escrever em `src/servidor/modulos.ts` (registrar)");
    expect(prompt).toContain("a fase 3 — sem dependência com ela, que o build pode executar ao mesmo tempo — também ordena escrever nele");
    expect(prompt).toContain('na arquitetura o arquivo é do componente "api-base"');
    expect(prompt).toContain("a fase 1, de que todas as fases em conflito dependem, cria `src/servidor/modulos.ts`");
    expect(prompt).toContain("Se ela ainda não entrega, escreva a necessidade como critério");
    expect(prompt).toContain("não invente dependência aqui");
    // Antes de qualquer auditor: o self-check devolveu, e o auditor só leu o texto já corrigido.
    expect(anunciado()).toContain("conferência mecânica");
    const auditorias = por(agent, { stage: "audit" });
    expect(auditorias.every((call) => !call.prompt.includes("acrescentando à lista de `criarModulosApi(banco)`"))).toBe(true);

    const plano = await planoPublicado();
    expect(plano).not.toContain("registrar o módulo em `src/servidor/modulos.ts`");
    expect(plano).not.toContain("Registrar o router `criarRotas(banco)` em `src/servidor/modulos.ts`");
    // O contrato do produto e o critério que VERIFICA o arquivo compartilhado ficam.
    expect(plano).toContain("`GET /api/tarefas` devolve 200 com a lista de tarefas");
    expect(plano).toContain("`GET /api/categorias` devolve 200 com a lista de categorias");
    expect(plano).toContain("`src/servidor/modulos.ts` contém exatamente um item com `caminho: '/tarefas'`");
    // E as fases de módulo continuam sem ordem entre si: a correção foi de propriedade, não de serialização.
    const parsed = parsePhases(plano);
    expect(parsed.ok && parsed.document.phases.map((phase) => phase.dependsOn)).toEqual(["none", "Phase 1", "Phase 1"]);
  });


  it("13. as tasks que insistem na edição concorrente param o plan, sem publicar e sem auditor", async () => {
    const roteiro = caminho({ p2: () => P2_CONTAMINADA, p3: () => P3_CONTAMINADA });
    await init(roteiro);
    const { run, agent } = await plan(roteiro);
    const erro = await run.then(() => null, (e: Error) => e.message);
    expect(erro).toContain("a conferência mecânica do plano não fechou");
    expect(erro).toContain("ordena escrever em `src/servidor/modulos.ts`");
    await expect(planoPublicado()).rejects.toThrow();
    // Nenhum auditor de modelo leu o plano contaminado: a conferência devolveu antes.
    expect(por(agent, { stage: "audit" }).filter((call) => call.subject.startsWith("project-phases.md"))).toHaveLength(0);
    // Bounded: a escada inteira cabe em poucas chamadas, sem ciclo.
    expect(agent.calls.length).toBeLessThan(30);
  });

  it("13 (gate). o plano real do Haiku, como publicado, não passa no gate de prontidão", async () => {
    const plano = [
      "# Parallel Lab — Project Phases",
      "",
      "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->",
      "",
      P1_FUNDACAO,
      P2_CONTAMINADA,
      P3_CONTAMINADA,
    ].join("\n");
    const readiness = evaluateReadiness({
      plan: plano, architecture: "", stampInputs: [], coverage: { storyIds: ["US-1.1", "US-2.1", "US-3.1"], entities: ["tarefas", "categorias"], workflows: [{ number: "1", name: "Cadastrar tarefa" }] },
      approved: true, unresolvedQuestions: [], designRoot: "/nada", designExists: () => true,
    });
    expect(readiness.ready).toBe(false);
    const propriedade = readiness.checks.find((check) => check.id === "propriedade");
    expect(propriedade?.passed).toBe(false);
    expect(propriedade?.detail).toContain("a fase 3 — sem dependência com ela");
    expect(readiness.contractErrors.filter((error) => error.code === "I-18")).toHaveLength(2);
    // E o mesmo gate, com as fases corrigidas, só reprova o que não é desta regra.
    const corrigido = evaluateReadiness({
      plan: plano.replace(P2_CONTAMINADA, P2_CORRIGIDA).replace(P3_CONTAMINADA, P3_CORRIGIDA), architecture: "", stampInputs: [],
      coverage: { storyIds: ["US-1.1", "US-2.1", "US-3.1"], entities: ["tarefas", "categorias"], workflows: [{ number: "1", name: "Cadastrar tarefa" }] },
      approved: true, unresolvedQuestions: [], designRoot: "/nada", designExists: () => true,
    });
    expect(corrigido.checks.find((check) => check.id === "propriedade")?.passed).toBe(true);
  });
});


describe("§124 — o que não muda", () => {
  it("19. o caminho sem defeito não ganha chamada nenhuma: uma escrita por fase, uma leitura por fase mais a coerência, o ensaio — e nada mais", async () => {
    const roteiro = caminho({ p2: () => P2_CORRIGIDA, p3: () => P3_CORRIGIDA });
    await init(roteiro);
    const { run, agent, anunciado } = await plan(roteiro);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const assuntos = agent.calls.map((call) => `${call.role}/${call.stage}/${call.subject}`);
    expect(assuntos.filter((assunto) => assunto.startsWith("writer/authoring/")).sort()).toEqual(["writer/authoring/architecture", "writer/authoring/phase-p01", "writer/authoring/phase-p02", "writer/authoring/phase-p03"]);
    expect(assuntos.filter((assunto) => assunto.startsWith("auditor/audit/")).sort()).toEqual(["auditor/audit/architecture", "auditor/audit/project-phases.md"]);
    expect(assuntos.filter((assunto) => assunto.includes("auditor/authoring") || assunto.startsWith("verifier/"))).toEqual([]);
    expect(emendas(agent)).toHaveLength(0);
    expect(anunciado()).not.toContain("conferência mecânica");
  });

  /*
   * O auditor que insiste no ponto já resolvido cita passagens que a correção
   * apagou: o Core não as acha nos documentos, e o achado vira observação do
   * relatório (etapa 2 da redução). Antes, a mesma insistência subia a escada
   * inteira — texto idêntico, troca de estratégia, dois reparos — em 27 chamadas.
   */
  it("20. o auditor que reinsiste num achado já resolvido não devolve o plano: a correção fica, o achado vai ao relatório", async () => {
    const roteiro = caminho(
      { p2: (call) => (emenda(call) ? P2_CORRIGIDA : P2_CONTAMINADA), p3: (call) => (emenda(call) ? P3_CORRIGIDA : P3_CONTAMINADA) },
      [{ match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, repeat: true, respond: {
        stdout: [
          "CAPIVARA_AUDIT_STATUS: REJECTED",
          "CAPIVARA_FINDING: CONTRADICTION | P1.T1.C1 vs P2.T1.C1, P3.T1.C1 | as fases de módulo acrescentam em modulos.ts as entradas que a fundação já registra: «acrescentando à lista de `criarModulosApi(banco)`» contra «Registrar o router `criarRotas(banco)` em `src/servidor/modulos.ts`» | remover de P2.T1 e P3.T1 o registro em modulos.ts",
          "CAPIVARA_REASON: escrita concorrente",
        ].join("\n"),
      } }],
    );
    await init(roteiro);
    const { run, agent } = await plan(roteiro);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    // O I-18 devolveu uma vez, às duas fases que escrevem, e nunca mais.
    expect(emendas(agent).filter((call) => call.prompt.includes("I-18:"))).toHaveLength(2);
    expect(await planoPublicado()).not.toContain("acrescentando à lista de `criarModulosApi(banco)`");
    // Uma auditoria do plano, nenhuma emenda por ela: as passagens citadas não existem mais.
    expect(por(agent, { stage: "audit", subject: "project-phases.md" })).toHaveLength(1);
    expect(emendas(agent)).toHaveLength(2);
    expect(outcome.report.remarks.some((entrada) => entrada.remark.observation.includes("não bloqueia"))).toBe(true);
  });
});
