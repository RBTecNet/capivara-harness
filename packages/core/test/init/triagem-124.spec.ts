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
import { applyMaterialityReview, materialityInput } from "../../src/audit/materiality.js";
import type { AuditVerdict } from "../../src/audit/protocol.js";
import { checkWriteOwnership, parsePhaseFragment, parsePhases } from "../../src/contract/index.js";
import { InitBlockedError, runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { evaluateReadiness } from "../../src/init/readiness.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { REPAIR_MARKER } from "../../src/prompts/index.js";
import type { Question } from "../../src/interview/index.js";
import { NO_QUESTIONS, approve, fakeAgent, materialityKeeps, rehearsalApproves, reject } from "../support/fake-agent.js";
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

/* ---------- o caso raiz → root (defeito C): sequência explícita ou só imaginada ---------- */

const P1_RAIZ = P1_FUNDACAO.replace(
  "    - Os stubs `src/servidor/modulos/tarefas/rotas.ts` e `src/servidor/modulos/categorias/rotas.ts` exportam `criarRotas(banco)` e devolvem um Router sem rota nenhuma",
  "    - Os stubs `src/servidor/modulos/tarefas/rotas.ts` e `src/servidor/modulos/categorias/rotas.ts` exportam `criarRotas(banco)` e devolvem um Router sem rota nenhuma\n    - `src/web/main.tsx` monta um componente React vazio no elemento de id `raiz`",
);
const P1_ROOT = P1_RAIZ.replace("no elemento de id `raiz`", "no elemento de id `root`");
/** A fase 2 afirma `#root` num critério, mas nenhuma task dela reescreve o `main.tsx` da fase 1. */
const P2_ROOT_IMPLICITO = P2_CORRIGIDA.replace(
  "    - `src/servidor/modulos.ts` contém exatamente um item com `caminho: '/tarefas'`",
  "    - `src/servidor/modulos.ts` contém exatamente um item com `caminho: '/tarefas'`\n    - `src/web/main.tsx` renderiza em `#root` a árvore `App`",
);
/** A fase 2 ORDENA a substituição: depende da 1 e reescreve o arquivo provisório. */
const P2_ROOT_EXPLICITO = P2_ROOT_IMPLICITO.replace(
  "o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/tarefas`",
  "o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/tarefas`; e reescrever `src/web/main.tsx`, provisório na fase 1, para renderizar em `#root` a árvore `App`",
);

const ACHADO_RAIZ = reject("P1.T1.C3 vs P2.T1.C3", "o elemento de montagem é `raiz` na fase 1 e `root` na fase 2; um único main.tsx não satisfaz os dois", "usar `root` em P1.T1.C3, que é o que a fase 2 fixa");

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
    materialityKeeps(),
    rehearsalApproves(),
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
    decideStandoff: async () => { throw new Error("não há decisão de produto a tomar neste cenário"); },
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
    expect(anunciado()).toContain("auditor devolveu project-phases.md");
    const auditorias = por(agent, { stage: "audit" });
    expect(auditorias.every((call) => !call.prompt.includes("acrescentando à lista de `criarModulosApi(banco)`"))).toBe(true);
    // Nenhuma triagem: não houve achado de modelo a triar.
    expect(por(agent, { subject: "project-phases.md#materialidade" })).toHaveLength(0);

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

  it("12. o escritor não fecha; o auditor repara; quem valida o reparo é o verifier, nunca o auditor", async () => {
    const roteiro = caminho(
      {
        p2: () => P2_CONTAMINADA, // o escritor insiste
        p3: () => P3_CONTAMINADA,
      },
      [
        { match: { role: "auditor", stage: "authoring", subject: "phase-p02" }, respond: { stdout: P2_CORRIGIDA }, repeat: true },
        { match: { role: "auditor", stage: "authoring", subject: "phase-p03" }, respond: { stdout: P3_CORRIGIDA }, repeat: true },
      ],
    );
    await init(roteiro);
    const { run, agent, anunciado } = await plan(roteiro);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado()).toContain("o auditor assume o reparo (1/2) e o verifier valida, em sessão própria");
    const reparos = por(agent, { role: "auditor", stage: "authoring" });
    expect(reparos.map((call) => call.subject).sort()).toEqual(["phase-p02", "phase-p03"]);
    expect(reparos[0]?.prompt).toContain(REPAIR_MARKER);
    expect(reparos[0]?.prompt).toContain("I-18:");
    // Depois do reparo, toda leitura do plano é do verifier; o auditor não lê o que reparou.
    const ultimoReparo = Math.max(...reparos.map((call) => agent.calls.indexOf(call)));
    const leiturasDepois = agent.calls.slice(ultimoReparo + 1).filter((call) => call.stage === "audit");
    expect(leiturasDepois.length).toBeGreaterThan(0);
    expect(leiturasDepois.every((call) => call.role === "verifier")).toBe(true);
    expect((await planoPublicado())).not.toContain("acrescentando à lista de `criarModulosApi(banco)`");
  });

  it("13. a publicação não apresenta RALPH READY enquanto as tasks ordenarem a edição concorrente, nem por decisão de publicar", async () => {
    const roteiro = caminho({ p2: () => P2_CONTAMINADA, p3: () => P3_CONTAMINADA });
    await init(roteiro);
    let impasses = 0;
    const { run, agent } = await plan(roteiro, { decideStandoff: async () => { impasses += 1; return "publicar"; } });
    const outcome = await run;
    // O escritor, o reparador (que cai no roteiro do escritor) e o desenvolvedor mandando publicar: ainda assim, NOT READY.
    expect(impasses).toBe(1);
    expect(outcome.readiness.ready).toBe(false);
    const propriedade = outcome.readiness.checks.find((check) => check.id === "propriedade");
    expect(propriedade?.passed).toBe(false);
    expect(propriedade?.detail).toContain("ordena escrever em `src/servidor/modulos.ts`");
    // Nenhum auditor de modelo leu o plano contaminado: o self-check devolveu antes.
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
      approved: true, unresolvedQuestions: [], designRoot: "/nada", designExists: () => true, rehearsal: { blocked: [] },
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
      approved: true, unresolvedQuestions: [], designRoot: "/nada", designExists: () => true, rehearsal: { blocked: [] },
    });
    expect(corrigido.checks.find((check) => check.id === "propriedade")?.passed).toBe(true);
  });
});

describe("§124 — a triagem distingue falso positivo de solução hipotética", () => {
  /** O achado real do auditor de coerência do Haiku (rodada 4) e o parecer real da triagem que o descartou. */
  const ACHADO_DO_HAIKU: AuditVerdict = {
    status: "REJECTED",
    findings: [{
      where: "P1.T6.C1 vs P3.T4.C1, P4.T5.C1, P5.T4.C1 e P6.T2.C1",
      problem: "P1.T6.C1 exige que criarModulosApi devolva exatamente quatro entradas (/tarefas, /categorias, /anotacoes, /painel) já na fase 1. As outras quatro mandam acrescentar cada entrada em modulos.ts. A lista ganha duplicatas e P4.T5.C2 e P6.T2.C3 (exatamente um item) tornam-se impossíveis. Além disso, as fases 3 a 6 rodam em paralelo e editariam o mesmo arquivo compartilhado, o que o pedido do desenvolvedor proíbe",
      fix: "P1.T6.C1 está certo: a arquitetura põe a lista única de montagem na fundação para que as fases de módulo toquem só os próprios arquivos. Remover de P3.T4.C1, P4.T5.C1, P5.T4.C1 e P6.T2.C1 o registro em modulos.ts e manter apenas o trabalho em rotas.ts de cada módulo, que implementa o stub criado em P1.T6.C1.",
    }],
    remarks: [], decisions: [], reason: "P3 a P6 acrescentam itens a modulos.ts já completos pela fundação",
  };
  const fase = (numero: number, titulo: string, task: string) => parsePhaseFragment(`## Phase ${numero}: ${titulo}\n\n**Goal:** entrega · **Depends on:** ${numero === 1 ? "none" : "Phase 1"} · **Covers:** US-${numero}.1\n\n- [ ] **Task:** ${task}\n  - **Acceptance criteria:**\n    - \`src/servidor/modulos.ts\` contém exatamente um item do módulo\n  - **Traces:** US-${numero}.1\n`)!;
  const fases = [
    fase(1, "Fundação", "Criar `src/servidor/modulos.ts` com `criarModulosApi(banco)`, que devolve, nesta ordem, as entradas com `caminho` `/tarefas`, `/categorias`, `/anotacoes` e `/painel`, cada uma com o router de `criarRotas` do seu módulo"),
    fase(2, "Casca", "Criar `src/web/navegacao.ts` com os quatro itens"),
    fase(3, "Tarefas", "Criar `src/servidor/modulos/tarefas/rotas.ts` e registrar o módulo em `src/servidor/modulos.ts`, acrescentando a entrada `/tarefas`"),
    fase(4, "Categorias", "Registrar o router em `src/servidor/modulos.ts` como item `/categorias`"),
    fase(5, "Anotações", "Registrar o módulo em `src/servidor/modulos.ts` com o item `/anotacoes`"),
    fase(6, "Painel", "Criar as rotas do painel e registrar o módulo em `src/servidor/modulos.ts`, adicionando `/painel`"),
  ];
  const input = materialityInput(ACHADO_DO_HAIKU, {
    request: "Os módulos independentes não devem modificar arquivos compartilhados simultaneamente.", decisions: [], phases: fases,
    skeleton: "## Visão geral\nOs módulos entram aqui apenas como rotas vazias registradas em modulos.ts, para que as fases de módulo toquem somente os próprios arquivos e possam rodar em paralelo.",
  });

  it("7. o parecer real do Haiku — uma solução possível, citando a fundação e a arquitetura — não remove o bloqueio", () => {
    const parecerReal = JSON.stringify({ reviews: [{
      id: "F1", disposition: "ADVISORY",
      reason: "A fase 1 já entrega as quatro entradas de criarModulosApi com os routers de criarRotas. As fases de módulo podem cumprir os critérios só substituindo o stub de rotas.ts, sem inserir novas entradas em modulos.ts. A lista final fica com exatamente um item por caminho, sem duplicata.",
      evidence: [
        { source: "P1", quote: "cada uma com o router de `criarRotas` do seu módulo" },
        { source: "skeleton", quote: "Os módulos entram aqui apenas como rotas vazias registradas em modulos.ts" },
      ],
    }] });
    const result = applyMaterialityReview(ACHADO_DO_HAIKU, input, parecerReal);
    expect(result.defects).toEqual(["F1: a triagem descartou um conflito entre as fases 1, 3, 4, 5, 6 sem citar o texto da(s) fase(s) 3, 4, 5, 6"]);
    expect(result.advisory).toBe(0);
    expect(result.verdict.status).toBe("REJECTED");
    expect(result.verdict.findings).toEqual(ACHADO_DO_HAIKU.findings);
  });

  it("8. um falso positivo comprovado — o texto das fases acusadas NÃO ordena o que o achado afirma, e cada uma é citada — continua descartável", () => {
    const corrigidas = [
      fases[0]!, fases[1]!,
      fase(3, "Tarefas", "Criar `src/servidor/modulos/tarefas/rotas.ts` com `criarRotas(banco)`, o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/tarefas`"),
      fase(4, "Categorias", "Criar `src/servidor/modulos/categorias/rotas.ts`, o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/categorias`"),
      fase(5, "Anotações", "Criar `src/servidor/modulos/anotacoes/rotas.ts`, o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/anotacoes`"),
      fase(6, "Painel", "Criar `src/servidor/modulos/painel/rotas.ts`, o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/painel`"),
    ];
    const entradaLimpa = materialityInput(ACHADO_DO_HAIKU, { request: "Os módulos independentes não devem modificar arquivos compartilhados simultaneamente.", decisions: [], phases: corrigidas });
    const parecer = JSON.stringify({ reviews: [{
      id: "F1", disposition: "ADVISORY",
      reason: "As fases de módulo só criam os próprios arquivos e consomem o stub que a fundação registrou; nenhuma ordena escrever em modulos.ts.",
      evidence: [
        { source: "P1", quote: "cada uma com o router de `criarRotas` do seu módulo" },
        { source: "P3", quote: "o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/tarefas`" },
        { source: "P4", quote: "o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/categorias`" },
        { source: "P5", quote: "o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/anotacoes`" },
        { source: "P6", quote: "o stub registrado em `src/servidor/modulos.ts` pela fundação sob `/painel`" },
      ],
    }] });
    const result = applyMaterialityReview(ACHADO_DO_HAIKU, entradaLimpa, parecer);
    expect(result.defects).toEqual([]);
    expect(result.advisory).toBe(1);
    expect(result.verdict.status).toBe("APPROVED");
    expect(result.verdict.remarks[0]?.observation).toContain("triagem de materialidade");
    // E o mesmo plano, lido em código, concorda: nenhuma obrigação de escrita concorrente.
    expect(checkWriteOwnership({ contract: "capivara-phases/v2", projectName: "Parallel Lab", stamp: null, phases: corrigidas })).toEqual([]);
  });

  it("18. raiz → root por interpretação não documentada: o parecer que cita só a fase 1 é recusado, e a fase 1 é corrigida", async () => {
    let coerencias = 0;
    const roteiro = caminho(
      {
        p1: (call) => (emenda(call) ? P1_ROOT : P1_RAIZ),
        p2: () => P2_ROOT_IMPLICITO,
        p3: () => P3_CORRIGIDA,
      },
      [
        { match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" }, repeat: true, respond: { stdout: (call) => {
          coerencias += 1;
          return call.prompt.includes("no elemento de id `root`") ? approve() : ACHADO_RAIZ;
        } } },
        { match: { role: "verifier", stage: "audit", subject: "project-phases.md#materialidade" }, repeat: true, respond: { stdout: JSON.stringify({ reviews: [{
          id: "F1", disposition: "ADVISORY",
          reason: "O nome do id do elemento de montagem é uma escolha de implementação; a sequência é coerente se a fase 2 usar root para o elemento de montagem.",
          evidence: [{ source: "P1", quote: "monta um componente React vazio no elemento de id `raiz`" }],
        }] }) } },
      ],
    );
    await init(roteiro);
    const { run, agent, anunciado } = await plan(roteiro);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado()).toContain("parecer sem prova válida na triagem: o bloqueio correspondente continua valendo");
    expect(coerencias).toBe(2);
    expect(emendas(agent, "phase-p01")).toHaveLength(1);
    const plano = await planoPublicado();
    expect(plano).toContain("no elemento de id `root`");
    expect(plano).not.toContain("no elemento de id `raiz`");
    // O achado não virou ressalva: foi corrigido no documento.
    expect(outcome.report.remarks.some((remark) => remark.remark.observation.includes("triagem de materialidade"))).toBe(false);
  });

  it("17. raiz → root explicitamente ordenado pela fase seguinte: aceito pelo parecer com os dois lados, sem reescrita", async () => {
    const roteiro = caminho(
      { p1: () => P1_RAIZ, p2: () => P2_ROOT_EXPLICITO, p3: () => P3_CORRIGIDA },
      [
        { match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" }, repeat: true, respond: { stdout: ACHADO_RAIZ } },
        { match: { role: "verifier", stage: "audit", subject: "project-phases.md#materialidade" }, repeat: true, respond: { stdout: JSON.stringify({ reviews: [{
          id: "F1", disposition: "ADVISORY",
          reason: "A fase 2 depende da 1 e ORDENA reescrever o main.tsx provisório para #root: substituição sequencial explícita, não obrigação simultânea.",
          evidence: [
            { source: "P1", quote: "monta um componente React vazio no elemento de id `raiz`" },
            { source: "P2", quote: "reescrever `src/web/main.tsx`, provisório na fase 1, para renderizar em `#root`" },
          ],
        }] }) } },
      ],
    );
    await init(roteiro);
    const { run, agent } = await plan(roteiro);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(emendas(agent)).toHaveLength(0);
    expect(por(agent, { subject: "project-phases.md#materialidade" })).toHaveLength(1);
    expect(outcome.report.remarks.some((remark) => remark.remark.observation.includes("triagem de materialidade"))).toBe(true);
    const plano = await planoPublicado();
    expect(plano).toContain("no elemento de id `raiz`");
    expect(plano).toContain("reescrever `src/web/main.tsx`, provisório na fase 1");
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
    expect(assuntos.filter((assunto) => assunto.startsWith("auditor/audit/")).sort()).toEqual(["auditor/audit/architecture", "auditor/audit/project-phases.md#P1", "auditor/audit/project-phases.md#P2", "auditor/audit/project-phases.md#P3", "auditor/audit/project-phases.md#coerência"]);
    expect(assuntos.filter((assunto) => assunto.includes("materialidade") || assunto.includes("auditor/authoring"))).toEqual([]);
    expect(emendas(agent)).toHaveLength(0);
    expect(anunciado()).not.toContain("auditor devolveu project-phases.md");
  });

  it("20. o auditor que reinsiste num achado equivalente depois de resolvido não produz ciclo: a escada termina, bounded", async () => {
    const roteiro = caminho(
      { p2: (call) => (emenda(call) ? P2_CORRIGIDA : P2_CONTAMINADA), p3: (call) => (emenda(call) ? P3_CORRIGIDA : P3_CONTAMINADA) },
      [{ match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" }, repeat: true, respond: {
        stdout: reject("P1.T1.C1 vs P2.T1.C1, P3.T1.C1", "as fases de módulo acrescentam em modulos.ts as entradas que a fundação já registra", "remover de P2.T1 e P3.T1 o registro em modulos.ts"),
      } }],
    );
    await init(roteiro);
    const { run, agent, anunciado } = await plan(roteiro, { decideStandoff: async () => "abortar" });
    await expect(run).rejects.toBeInstanceOf(InitBlockedError);
    // O I-18 devolveu UMA vez, e nunca mais: o texto corrigido não volta a disparar o self-check.
    expect(anunciado().split("auditor devolveu project-phases.md").length - 1).toBeGreaterThanOrEqual(1);
    expect(emendas(agent).filter((call) => call.prompt.includes("I-18:"))).toHaveLength(2);
    expect((await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8").catch(() => "")).includes("acrescentando à lista de `criarModulosApi(banco)`")).toBe(false);
    // O auditor que insiste no ponto já resolvido sobe a escada de sempre — texto idêntico, troca de estratégia, dois reparos — e para; a escada é finita e esta é a sua altura.
    expect(anunciado()).toContain("a emenda não mudou o texto e o auditor reprovou de novo; insistir não resolve — trocando de estratégia");
    expect(anunciado()).toContain("o auditor assume o reparo (1/2)");
    expect(por(agent, { subject: "project-phases.md#coerência" })).toHaveLength(4);
    expect(por(agent, { subject: "project-phases.md#materialidade" })).toHaveLength(4);
    expect(agent.calls).toHaveLength(27);
  });
});
