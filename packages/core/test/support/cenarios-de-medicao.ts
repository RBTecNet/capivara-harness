/**
 * Os cenários medidos: a cadeia `init` → `plan` → `build` com os providers
 * falsos, numa pasta descartável, deixando no disco os registros de sempre —
 * `events.tsv`, `prompts/`, `logs/`, `evidence.jsonl`.
 *
 * Existem para responder "quanto o harness verifica?" com número. Quem conta é
 * `scripts/medir-verificacao.mjs`, que lê só esses registros; quem garante que
 * a redução não deixa defeito escapar é o catálogo, que roda as quatro
 * garantias (G-1 a G-4) daqui.
 *
 * O verificador, o runner de fluxos e a suíte falsos leem o CÓDIGO da árvore,
 * como os de verdade: a revisão diz INCOMPLETE quando o arquivo não tem a
 * restrição, o fluxo reprova quando o botão não chama a operação. Uma resposta
 * fixa provaria só o roteiro; lendo a árvore, prova o caminho que o achado
 * percorre até o executor — e se ele chega.
 */

import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InitBlockedError, readArchitectureState, readSkeletonState, runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall, InitOutcome } from "../../src/init/index.js";
import { runBuild } from "../../src/loop/index.js";
import type { BuildOutcome, EngineCall } from "../../src/loop/index.js";
import { runIdFor } from "../../src/state/index.js";
import { NO_QUESTIONS, approve, fakeAgent, materialityKeeps, rehearsalApproves } from "./fake-agent.js";
import type { ScriptStep } from "./fake-agent.js";
import { allDone, fakeEngine } from "./fake-engine.js";
import type { EngineStep } from "./fake-engine.js";

// ------------------------------------------------------------------ o produto

interface Tarefa {
  title: string;
  criteria: string[];
  traces: string[];
}

interface Fase {
  title: string;
  goal: string;
  covers: string[];
  areas: string[];
  components: string[];
  tasks: Tarefa[];
}

interface Fluxo {
  number: string;
  name: string;
  steps: string[];
}

interface Produto {
  projectName: string;
  pedido: string;
  entities: { name: string; fields: { name: string; type: string }[]; relations: string[] }[];
  stories: { id: string; statement: string }[];
  workflows: Fluxo[];
  rules: { subject: string; statement: string }[];
  components: { name: string; responsibility: string; areas: string[]; dependsOn: string[]; contracts: string[]; files: string[]; owns: string[] }[];
  fases: Fase[];
}

const dependeDe = (indice: number): string => (indice === 0 ? "none" : `Phase ${indice}`);

/** Esqueleto, arquitetura e fases coerentes entre si, do jeito que o escritor os devolveria. */
function documentos(produto: Produto): { skeleton: string; architecture: string; fases: string[] } {
  const skeleton = JSON.stringify({
    contract: "capivara-skeleton/v2",
    environment: [{ technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["--version"] }],
    projectName: produto.projectName,
    stack: [
      { component: "Linguagem", decision: "Node 22 com TypeScript" },
      { component: "Persistência", decision: "arquivo JSON local" },
    ],
    entities: produto.entities,
    stories: produto.stories,
    workflows: produto.workflows,
    rules: produto.rules,
    phases: produto.fases.map((fase, indice) => ({
      number: indice + 1, title: fase.title, goal: fase.goal, dependsOn: dependeDe(indice), covers: fase.covers, taskCount: fase.tasks.length,
    })),
    mvpCutPhase: produto.fases.length,
  });
  const architecture = JSON.stringify({
    contract: "capivara-architecture/v1",
    overview: "Um serviço Node com a camada de dados e a interface no mesmo processo.",
    components: produto.components,
    dataDecisions: [],
    flows: produto.workflows.map((fluxo) => ({ workflow: fluxo.number, components: produto.components.map((componente) => componente.name), notes: "" })),
    infrastructure: {
      runtimes: [{ name: "Node.js", version: "22", purpose: "executar a aplicação", basis: "stack do esqueleto: Node 22 com TypeScript" }],
      tools: [{ name: "TypeScript", version: "", purpose: "tipagem", basis: "stack do esqueleto" }],
      packageManagers: [{ name: "npm", version: "", purpose: "dependências", basis: "padrão do runtime Node.js" }],
      dependencies: [],
      services: [],
      databases: [],
      compatibility: ["Node 22 ou superior"],
      preconditions: [],
    },
    phases: produto.fases.map((fase, indice) => ({
      number: indice + 1, title: fase.title, goal: fase.goal, dependsOn: dependeDe(indice), covers: fase.covers,
      areas: fase.areas, components: fase.components, taskCount: fase.tasks.length, rationale: "uma capacidade por fase",
    })),
    mvpCutPhase: produto.fases.length,
  });
  const fases = produto.fases.map((fase, indice) =>
    [
      `## Phase ${indice + 1}: ${fase.title}`,
      "",
      `**Goal:** ${fase.goal} · **Depends on:** ${dependeDe(indice)} · **Covers:** ${fase.covers.join(", ")}`,
      "",
      ...fase.tasks.flatMap((tarefa) => [
        `- [ ] **Task:** ${tarefa.title}`,
        "  - **Acceptance criteria:**",
        ...tarefa.criteria.map((criterio) => `    - ${criterio}`),
        `  - **Traces:** ${tarefa.traces.join(", ")}`,
        "",
      ]),
    ].join("\n"),
  );
  return { skeleton, architecture, fases };
}

/** O roteiro do `plan` que aprova tudo: entrevista sem pergunta, documentos válidos, auditoria e ensaio aprovando. */
function roteiroDoPlano(produto: Produto, extra: ScriptStep[] = []): ScriptStep[] {
  const docs = documentos(produto);
  return [
    ...extra,
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: docs.skeleton }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: docs.architecture }, repeat: true },
    ...docs.fases.map((markdown, indice): ScriptStep => ({
      match: { role: "writer", stage: "authoring", subject: `phase-p${String(indice + 1).padStart(2, "0")}` },
      respond: { stdout: markdown },
      repeat: true,
    })),
    { match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true },
    materialityKeeps(),
    rehearsalApproves(),
  ];
}

// ------------------------------------------------------------------ o build

export interface Arquivo {
  path: string;
  content: string;
}

/** Como cada papel falso se comporta num cenário. Todos leem a árvore da chamada. */
interface Comportamento {
  /** O que o executor escreve, por fase e sessão. */
  executor: (call: EngineCall) => Promise<Arquivo[]>;
  /** A revisão da fase (hoje o G3): devolve as linhas TASK. */
  revisao?: (call: EngineCall, arvore: string) => Promise<string>;
  /** O que o verificador escreve quando é chamado para reparar. */
  reparo?: (call: EngineCall) => Promise<Arquivo[]>;
  /** O fluxo percorrido na aplicação de pé: código de saída e saída do runner. */
  fluxo?: (arvore: string, roteiros: string[]) => Promise<{ exitCode: number; output: string }>;
  /** A suíte do projeto. */
  suite?: (arvore: string) => Promise<{ exitCode: number; output: string }>;
}

const MANIFESTO: Arquivo = {
  path: "package.json",
  content: JSON.stringify({ name: "app", private: true, scripts: { test: "node --test", start: "node src/servidor.js" } }),
};

/** O roteiro que o roteirista devolve para o fluxo que o prompt pede. */
function roteiroDoFluxo(prompt: string, fluxos: readonly Fluxo[]): string {
  const numero = /^## The flow — workflow (\S+):/m.exec(prompt)?.[1];
  const fluxo = fluxos.find((cada) => cada.number === numero) ?? fluxos[0]!;
  return [
    "```ts",
    "import { expect, test } from '@playwright/test';",
    "",
    `test('workflow ${fluxo.number}', async ({ page }) => {`,
    ...fluxo.steps.map(
      (passo, indice) => `  await test.step('passo ${indice + 1}: ${passo}', async () => { await page.goto('/'); expect(page.url()).toBeTruthy(); });`,
    ),
    "});",
    "```",
  ].join("\n");
}

const lerArquivo = (raiz: string, caminho: string): Promise<string> => readFile(join(raiz, caminho), "utf8").catch(() => "");

/**
 * O que os falsos viram: as chamadas de cada provider, cada vez que um runner
 * rodou, e o relógio de cada estágio. É a conferência dos registros: o que o
 * script conta no disco tem de bater com o que foi disparado.
 */
export interface Observado {
  chamadasDoPlano: AgentCall[];
  chamadasDoBuild: EngineCall[];
  suites: number;
  fluxos: { arvore: string; exitCode: number }[];
  /** Os comandos que a aceitação operacional rodou, na ordem. */
  aceitacao: string[];
  /** Milissegundos de relógio de cada estágio; ausente é estágio que não rodou. */
  duracoes: { init?: number; plan?: number; build?: number };
}

export interface ResultadoDoCenario {
  nome: string;
  projectRoot: string;
  init: InitOutcome | null;
  plan: InitOutcome | null;
  /** A parada do `init`/`plan`, quando ele bloqueia em vez de devolver NOT READY. */
  bloqueio: string | null;
  build: BuildOutcome | null;
  observado: Observado;
}

const PEDIDO = { origin: "text" as const, path: null };
const LINGUA = "português do Brasil";

/**
 * A cadeia inteira, como o CLI a encadeia: `init` até PLAN READY, `plan` até
 * RALPH READY, e o `build` recebendo o esqueleto e a arquitetura que o `plan`
 * guardou. Os orçamentos do build são os padrões do CLI (`--max-cycles 3`,
 * `--max-verifier-repairs 1` com validador por CLI), não os da biblioteca.
 */
async function cadeia(
  nome: string,
  produto: Produto,
  comportamento: Comportamento,
  opcoes: { extraNoPlano?: ScriptStep[]; sha12: string },
): Promise<ResultadoDoCenario> {
  const projectRoot = await mkdtemp(join(tmpdir(), `capivara-medida-${nome}-`));
  const request = { ...PEDIDO, text: produto.pedido, sha12: opcoes.sha12 };
  const agente = fakeAgent(roteiroDoPlano(produto, opcoes.extraNoPlano));
  const observado: Observado = { chamadasDoPlano: agente.calls, chamadasDoBuild: [], suites: 0, fluxos: [], aceitacao: [], duracoes: {} };
  const cronometrar = async <T>(estagio: keyof Observado["duracoes"], executar: () => Promise<T>): Promise<T> => {
    const inicio = performance.now();
    try {
      return await executar();
    } finally {
      observado.duracoes[estagio] = Math.round(performance.now() - inicio);
    }
  };
  const comum = {
    projectRoot, request, language: LINGUA, call: agente.call,
    ask: async () => "use as recomendações",
    // Ninguém decide o impasse: num cenário medido, o desenvolvedor não está olhando.
    decideStandoff: async () => "não sei",
    sleep: async () => undefined,
  };

  let init: InitOutcome | null = null;
  let plan: InitOutcome | null = null;
  try {
    init = await cronometrar("init", () => runInit({ ...comum, stage: "init" }));
    if (init.readiness.ready) plan = await cronometrar("plan", () => runPlan(comum));
  } catch (erro) {
    if (!(erro instanceof InitBlockedError)) throw erro;
    return { nome, projectRoot, init, plan, bloqueio: erro.message, build: null, observado };
  }
  if (!plan?.readiness.ready) return { nome, projectRoot, init, plan, bloqueio: null, build: null, observado };

  const runDoInit = runIdFor("init", request.sha12);
  const esqueleto = await readSkeletonState(projectRoot, runDoInit);
  const arquitetura = (await readArchitectureState(projectRoot, runDoInit))?.architecture ?? null;

  const passos: EngineStep[] = [
    {
      match: { role: "verifier", purpose: "flow-author" },
      respond: { stdout: async (call) => roteiroDoFluxo(call.prompt, produto.workflows) },
      repeat: true,
    },
    {
      match: { role: "verifier", purpose: "flow-triage" },
      respond: {
        stdout: async () =>
          [
            "CAPIVARA_TRIAGEM: PRODUTO",
            "CAPIVARA_EVIDENCIA: o passo reprovou com a aplicação de pé; a tela não mudou depois da ação",
            "CAPIVARA_ONDE: public/app.js",
            "CAPIVARA_CRITERIO: o passo do fluxo que reprovou",
            "CAPIVARA_CORRECAO: ligue a ação da tela à operação do serviço",
          ].join("\n"),
      },
      repeat: true,
    },
    {
      match: { role: "verifier", repair: true },
      writes: async (call) => (comportamento.reparo ? await comportamento.reparo(call) : []),
      respond: { stdout: "reparo concluído" },
      repeat: true,
    },
    {
      match: { role: "verifier" },
      respond: {
        stdout: async (call) =>
          comportamento.revisao ? await comportamento.revisao(call, call.root ?? projectRoot) : allDone(call.phase.taskCount),
      },
      repeat: true,
    },
    { match: { role: "builder" }, writes: async (call) => await comportamento.executor(call), respond: { stdout: "feito" }, repeat: true },
  ];
  const motor = fakeEngine(projectRoot, passos);
  observado.chamadasDoBuild = motor.calls;

  const build = await cronometrar("build", () => runBuild({
    projectRoot,
    language: LINGUA,
    engine: "codex",
    call: motor.call,
    sleep: async () => undefined,
    environment: {},
    skeleton: esqueleto,
    architecture: arquitetura,
    maxCycles: 3,
    maxVerifierRepairs: 1,
    systemInstall: true,
    testRunner: async (_command, arvore) => {
      observado.suites += 1;
      return comportamento.suite ? await comportamento.suite(arvore) : { exitCode: 0, output: "# pass 4\n# fail 0" };
    },
    flowRunner: async (arvore, roteiros) => {
      const corrida = comportamento.fluxo ? await comportamento.fluxo(arvore, roteiros) : { exitCode: 0, output: `${roteiros.length} passed` };
      observado.fluxos.push({ arvore, exitCode: corrida.exitCode });
      return corrida;
    },
    acceptanceRunner: async (comando) => {
      observado.aceitacao.push(comando);
      return { exitCode: 0, output: "ok" };
    },
    acceptanceService: async (comando) => {
      observado.aceitacao.push(comando);
      return { exitCode: 0, output: "de pé" };
    },
  }));
  return { nome, projectRoot, init, plan, bloqueio: null, build, observado };
}

// ------------------------------------------------------------- a aplicação pequena

/**
 * Uma agenda de atendimento em quatro fases e dois fluxos: dados, cadastro de
 * clientes (fluxo 1), agendamento, e a tela da agenda (fluxo 2).
 */
const AGENDA: Produto = {
  projectName: "Agenda",
  pedido: "uma agenda de atendimento: cadastrar clientes e agendar horários para eles",
  entities: [
    { name: "clientes", fields: [{ name: "nome", type: "text" }, { name: "telefone", type: "text" }], relations: [] },
    { name: "agendamentos", fields: [{ name: "cliente_id", type: "fk para clientes" }, { name: "horario", type: "datetime" }], relations: ["pertence a clientes"] },
  ],
  stories: [
    { id: "US-1.1", statement: "Como atendente, cadastro um cliente" },
    { id: "US-1.2", statement: "Como atendente, agendo um horário para um cliente" },
  ],
  workflows: [
    { number: "1", name: "Cadastrar cliente", steps: ["abre o cadastro", "preenche nome e telefone", "salva e vê o cliente na lista"] },
    { number: "2", name: "Agendar horário", steps: ["abre a agenda", "escolhe cliente e horário", "confirma e vê o horário ocupado"] },
  ],
  rules: [{ subject: "agendamentos.horario", statement: "dois agendamentos não ocupam o mesmo horário" }],
  components: [
    { name: "dados", responsibility: "leitura e escrita do arquivo de dados", areas: ["dados"], dependsOn: [], contracts: ["módulo dados: ler(), gravar(estado)"], files: ["src/dados.js"], owns: ["clientes", "agendamentos"] },
    { name: "servico", responsibility: "regras de clientes e agendamentos", areas: ["backend"], dependsOn: ["dados"], contracts: ["cadastrar(cliente) → id", "agendar(clienteId, horario) → id ou erro de conflito"], files: ["src/clientes.js", "src/agendamentos.js"], owns: [] },
    { name: "interface", responsibility: "telas de cadastro e de agenda", areas: ["frontend"], dependsOn: ["servico"], contracts: ["GET / → tela de clientes", "GET /agenda → tela da agenda"], files: ["src/servidor.js", "public/app.js"], owns: [] },
  ],
  fases: [
    {
      title: "Fundação de dados", goal: "o arquivo de dados existe e é lido e gravado", covers: ["clientes", "agendamentos"], areas: ["dados"], components: ["dados"],
      tasks: [
        { title: "Criar a leitura e a gravação do arquivo de dados", criteria: ["Um arquivo ausente é lido como estado vazio"], traces: ["clientes"] },
        { title: "Criar a coleção de agendamentos ligada a clientes", criteria: ["Um agendamento guarda o cliente_id de um cliente existente"], traces: ["agendamentos"] },
      ],
    },
    {
      title: "Cadastro de clientes", goal: "o atendente cadastra um cliente", covers: ["US-1.1", "workflow 1"], areas: ["backend", "frontend"], components: ["servico", "interface"],
      tasks: [
        { title: "Implementar o cadastro de clientes com a tela de cadastro", criteria: ["Salvar um cliente com nome e telefone o mostra na lista", "Um cliente sem nome é recusado com mensagem"], traces: ["US-1.1", "workflow 1"] },
      ],
    },
    {
      title: "Agendamento", goal: "o atendente agenda um horário", covers: ["US-1.2"], areas: ["backend"], components: ["servico"],
      tasks: [
        { title: "Implementar o agendamento com recusa de horário ocupado", criteria: ["Agendar um horário livre devolve o id", "Agendar um horário ocupado devolve erro de conflito e não grava nada"], traces: ["US-1.2", "agendamentos"] },
      ],
    },
    {
      title: "Tela da agenda", goal: "o atendente agenda pela tela", covers: ["workflow 2"], areas: ["frontend"], components: ["interface"],
      tasks: [
        { title: "Implementar a tela da agenda", criteria: ["Confirmar um horário o mostra como ocupado na agenda"], traces: ["workflow 2"] },
      ],
    },
  ],
};

const ARQUIVOS_DA_AGENDA: Record<string, Arquivo[]> = {
  P01: [MANIFESTO, { path: "src/dados.js", content: "export const ler = () => ({ clientes: [], agendamentos: [] });\n" }],
  P02: [
    { path: "src/clientes.js", content: "export const cadastrar = (cliente) => { if (!cliente.nome) throw new Error('nome obrigatório'); return 1; };\n" },
    { path: "public/app.js", content: "document.querySelector('#salvar').addEventListener('click', () => cadastrar(form()));\n" },
  ],
  P03: [{ path: "src/agendamentos.js", content: "export const agendar = (clienteId, horario, ocupados) => (ocupados.has(horario) ? { erro: 'conflito' } : { id: 1 });\n" }],
  P04: [{ path: "public/agenda.js", content: "document.querySelector('#confirmar').addEventListener('click', () => agendar(escolha()));\n" }],
};

/** O defeito que a suíte pega: o agendamento grava mesmo com o horário ocupado. */
const AGENDAMENTO_COM_DEFEITO: Arquivo = {
  path: "src/agendamentos.js",
  content: "export const agendar = (clienteId, horario) => ({ id: 1 }); // DEFEITO: não confere o horário ocupado\n",
};

const suiteQueLeODefeito = async (arvore: string): Promise<{ exitCode: number; output: string }> =>
  (await lerArquivo(arvore, "src/agendamentos.js")).includes("DEFEITO")
    ? { exitCode: 1, output: "# Subtest: horário ocupado\nnot ok 3 - agendar um horário ocupado devolve conflito\n  esperava { erro: 'conflito' }, recebeu { id: 1 }\n# pass 3\n# fail 1" }
    : { exitCode: 0, output: "# pass 4\n# fail 0" };

/** A aplicação pequena, sem defeito nenhum: o custo mínimo do harness. */
export async function cenarioAppPequeno(): Promise<ResultadoDoCenario> {
  return await cadeia("app-pequeno", AGENDA, {
    executor: async (call) => ARQUIVOS_DA_AGENDA[call.phase.id] ?? [],
  }, { sha12: "a9e4da000001" });
}

/**
 * O executor falha uma vez: a primeira entrega da P03 grava agendamento em
 * horário ocupado, a suíte reprova, e o primeiro reparo corrige — seja do
 * executor ou do verificador, quem o harness escolher.
 */
export async function cenarioReparo(): Promise<ResultadoDoCenario> {
  const sessoes = new Map<string, number>();
  return await cadeia("reparo", AGENDA, {
    executor: async (call) => {
      const vez = (sessoes.get(call.phase.id) ?? 0) + 1;
      sessoes.set(call.phase.id, vez);
      if (call.phase.id === "P03" && vez === 1) return [AGENDAMENTO_COM_DEFEITO];
      return ARQUIVOS_DA_AGENDA[call.phase.id] ?? [];
    },
    // Quem o harness escolher para o reparo, executor ou verificador, corrige na primeira vez.
    reparo: async (call) => ARQUIVOS_DA_AGENDA[call.phase.id] ?? [],
    suite: suiteQueLeODefeito,
  }, { sha12: "a9e4da000002" });
}

/**
 * O orçamento esgota: nem o executor nem o verificador corrigem o defeito da
 * P03. O que se mede é o que o harness faz quando isso acontece.
 */
export async function cenarioOrcamentoEsgotado(): Promise<ResultadoDoCenario> {
  return await cadeia("orcamento-esgotado", AGENDA, {
    executor: async (call) => (call.phase.id === "P03" ? [AGENDAMENTO_COM_DEFEITO] : (ARQUIVOS_DA_AGENDA[call.phase.id] ?? [])),
    suite: suiteQueLeODefeito,
  }, { sha12: "a9e4da000003" });
}

// ------------------------------------------------------------------ as garantias

/** O veredito de uma garantia: pega ou não, e onde o achado ficou registrado. */
export interface Garantia {
  id: "G-1" | "G-2" | "G-3" | "G-4";
  pega: boolean;
  /** O registro onde o defeito apareceu primeiro (arquivo de log, evento ou mensagem de parada). */
  registro: string;
  detalhe: string;
  cenario: ResultadoDoCenario;
}

/** O nome do primeiro log deste run, pela hora em que foi gravado, que contém o trecho. */
async function primeiroLogCom(raiz: string, runId: string, trecho: string): Promise<string> {
  const pasta = join(raiz, ".capivara/runs", runId, "logs");
  const nomes = await readdir(pasta).catch(() => [] as string[]);
  const logs = await Promise.all(
    nomes.map(async (nome) => ({
      nome,
      gravado: (await stat(join(pasta, nome))).mtimeMs,
      texto: await readFile(join(pasta, nome), "utf8").catch(() => ""),
    })),
  );
  return logs.filter((log) => log.texto.includes(trecho)).sort((a, b) => a.gravado - b.gravado)[0]?.nome ?? "";
}

const USUARIOS: Produto = {
  projectName: "Usuários",
  pedido: "um cadastro de usuários em que só administradores podem excluir usuários",
  entities: [{ name: "usuarios", fields: [{ name: "nome", type: "text" }, { name: "papel", type: "text" }], relations: [] }],
  stories: [{ id: "US-1.1", statement: "Como administrador, excluo um usuário" }],
  workflows: [],
  rules: [{ subject: "usuarios.exclusao", statement: "somente administradores excluem usuários" }],
  components: [
    { name: "servico", responsibility: "regras de usuários", areas: ["backend"], dependsOn: [], contracts: ["excluir(quem, id) → ok ou 403"], files: ["src/usuarios.js"], owns: ["usuarios"] },
  ],
  fases: [
    {
      title: "Exclusão de usuários", goal: "o administrador exclui um usuário", covers: ["usuarios", "US-1.1"], areas: ["backend"], components: ["servico"],
      tasks: [
        {
          title: "Implementar a exclusão de usuários restrita a administradores",
          criteria: ["Um administrador exclui um usuário existente", "Somente administradores excluem usuários: um usuário comum recebe 403 e nada é removido"],
          traces: ["US-1.1", "usuarios"],
        },
      ],
    },
  ],
};

const ACHADO_G1 = "um usuário comum consegue excluir: excluir() não confere o papel de quem pede";

/**
 * G-1 · suíte verde não prova requisito ausente. O executor implementa a
 * exclusão e testa só o caso do administrador; a suíte passa. A revisão da fase
 * tem de apontar a restrição ausente, e o achado tem de chegar ao executor.
 */
export async function garantiaG1(): Promise<Garantia> {
  const semRestricao = "export const excluir = (quem, id) => { remover(id); return 200; };\n";
  const comRestricao = "export const excluir = (quem, id) => { if (quem.papel !== 'admin') return 403; remover(id); return 200; };\n";
  const cenario = await cadeia("g1", USUARIOS, {
    executor: async (call) => [
      MANIFESTO,
      { path: "src/usuarios.js", content: call.prompt.includes(ACHADO_G1) ? comRestricao : semRestricao },
      { path: "test/usuarios.test.js", content: "test('o administrador exclui', () => assert.equal(excluir({ papel: 'admin' }, 1), 200));\n" },
    ],
    revisao: async (call, arvore) =>
      (await lerArquivo(arvore, "src/usuarios.js")).includes("papel !== 'admin'")
        ? allDone(call.phase.taskCount)
        : `TASK 1: INCOMPLETE — Somente administradores excluem usuários; ${ACHADO_G1}; a suíte só testa o administrador; recuse com 403 quando quem.papel não for admin; teste um usuário comum recebendo 403`,
  }, { sha12: "9a7a00000001" });
  const runId = cenario.build?.runId ?? "";
  const registro = await primeiroLogCom(cenario.projectRoot, runId, ACHADO_G1);
  const final = await lerArquivo(cenario.projectRoot, "src/usuarios.js");
  const fechouSemRestricao = cenario.build?.phases.some((fase) => fase.outcome.status === "complete") === true && !final.includes("papel !== 'admin'");
  return {
    id: "G-1",
    pega: registro !== "" && !fechouSemRestricao,
    registro,
    detalhe: fechouSemRestricao
      ? "a fase fechou com a exclusão aberta a qualquer usuário"
      : `achado registrado em ${registro || "(nenhum log)"}; build terminou com código ${cenario.build?.exitCode ?? "-"}`,
    cenario,
  };
}

const CADASTRO: Produto = {
  projectName: "Clientes",
  pedido: "um cadastro de clientes com uma tela para salvar e listar",
  entities: [{ name: "clientes", fields: [{ name: "nome", type: "text" }], relations: [] }],
  stories: [{ id: "US-1.1", statement: "Como atendente, cadastro um cliente" }],
  workflows: [{ number: "1", name: "Cadastrar cliente", steps: ["abre o cadastro", "preenche o nome", "clica em Salvar e vê o cliente na lista"] }],
  rules: [],
  components: [
    { name: "servico", responsibility: "cadastro de clientes", areas: ["backend"], dependsOn: [], contracts: ["cadastrar(nome) → id"], files: ["src/clientes.js"], owns: ["clientes"] },
    { name: "interface", responsibility: "tela de cadastro", areas: ["frontend"], dependsOn: ["servico"], contracts: ["GET / → tela de clientes"], files: ["src/servidor.js", "public/app.js"], owns: [] },
  ],
  fases: [
    {
      title: "Cadastro de clientes", goal: "o atendente cadastra um cliente pela tela", covers: ["clientes", "US-1.1", "workflow 1"], areas: ["backend", "frontend"], components: ["servico", "interface"],
      tasks: [
        { title: "Implementar o serviço de cadastro", criteria: ["cadastrar(nome) grava o cliente e devolve o id"], traces: ["US-1.1", "clientes"] },
        { title: "Implementar a tela de cadastro", criteria: ["Salvar pela tela mostra o cliente na lista"], traces: ["workflow 1"] },
      ],
    },
  ],
};

const FALHA_G2 = "o cliente não apareceu na lista depois de Salvar";

/**
 * G-2 · serviço funcionando não prova fluxo funcionando. O serviço de cadastro
 * funciona, mas o botão Salvar não chama a operação. O fluxo percorrido na
 * aplicação de pé tem de reprovar, e a falha tem de chegar ao executor.
 */
export async function garantiaG2(): Promise<Garantia> {
  const botaoMudo = "document.querySelector('#salvar').addEventListener('click', () => {});\n";
  const botaoLigado = "document.querySelector('#salvar').addEventListener('click', () => cadastrar(nome.value));\n";
  const cenario = await cadeia("g2", CADASTRO, {
    executor: async (call) => [
      MANIFESTO,
      { path: "src/clientes.js", content: "export const cadastrar = (nome) => gravar({ nome });\n" },
      { path: "public/app.js", content: call.prompt.includes(FALHA_G2) ? botaoLigado : botaoMudo },
    ],
    fluxo: async (arvore) =>
      (await lerArquivo(arvore, "public/app.js")).includes("cadastrar(")
        ? { exitCode: 0, output: "Running 1 test using 1 worker\n  ✓ workflow 1\n  1 passed" }
        : {
            exitCode: 1,
            output: [
              "Running 1 test using 1 worker",
              "  1) workflow-1.spec.ts:3:1 › workflow 1 › passo 3: clica em Salvar e vê o cliente na lista",
              "    Error: expect(locator).toContainText(expected) failed",
              `    ${FALHA_G2}`,
              "  1 failed",
            ].join("\n"),
          },
  }, { sha12: "9a7a00000002" });
  const quebrado = cenario.observado.fluxos.some((corrida) => corrida.exitCode !== 0);
  const final = await lerArquivo(cenario.projectRoot, "public/app.js");
  const aceitoQuebrado = cenario.build?.exitCode === 0 && !final.includes("cadastrar(");
  const registro = await primeiroLogCom(cenario.projectRoot, cenario.build?.runId ?? "", FALHA_G2);
  return {
    id: "G-2",
    pega: quebrado && !aceitoQuebrado,
    registro,
    detalhe: aceitoQuebrado
      ? "o build terminou concluído com o botão Salvar sem chamar a operação"
      : `fluxo reprovado registrado em ${registro || "(nenhum log)"}; build terminou com código ${cenario.build?.exitCode ?? "-"}`,
    cenario,
  };
}

const CITACAO_DA_DECISAO = "Clientes são desativados, nunca excluídos";
const CITACAO_DA_FASE = "O cliente é excluído permanentemente do banco";

const DESATIVACAO: Produto = {
  projectName: "Carteira",
  pedido: "uma carteira de clientes; clientes que saem são desativados, nunca excluídos",
  entities: [{ name: "clientes", fields: [{ name: "nome", type: "text" }, { name: "ativo", type: "boolean" }], relations: [] }],
  stories: [
    { id: "US-1.1", statement: "Como gerente, cadastro um cliente" },
    { id: "US-1.2", statement: "Como gerente, retiro um cliente da carteira" },
  ],
  workflows: [],
  rules: [{ subject: "clientes.remocao", statement: CITACAO_DA_DECISAO }],
  components: [
    { name: "servico", responsibility: "regras de clientes", areas: ["backend"], dependsOn: [], contracts: ["cadastrar(nome) → id", "retirar(id) → ok"], files: ["src/clientes.js"], owns: ["clientes"] },
  ],
  fases: [
    {
      title: "Cadastro de clientes", goal: "o gerente cadastra clientes", covers: ["clientes", "US-1.1"], areas: ["backend"], components: ["servico"],
      tasks: [{ title: "Implementar o cadastro de clientes", criteria: ["Um cliente novo nasce ativo"], traces: ["US-1.1", "clientes"] }],
    },
    {
      title: "Retirada de clientes", goal: "o gerente retira um cliente da carteira", covers: ["US-1.2"], areas: ["backend"], components: ["servico"],
      tasks: [{ title: "Implementar a retirada de clientes", criteria: [CITACAO_DA_FASE], traces: ["US-1.2"] }],
    },
  ],
};

/**
 * G-3 · contradição entre decisões do plano. O `init` decide que clientes são
 * desativados; uma fase manda excluir permanentemente, e o escritor não muda de
 * ideia. O `plan` tem de bloquear, com as duas citações à vista.
 */
export async function garantiaG3(): Promise<Garantia> {
  const auditorQueLe: ScriptStep = {
    match: { role: "auditor", stage: "audit" },
    respond: {
      stdout: (call) =>
        call.prompt.includes(CITACAO_DA_FASE)
          ? [
              "CAPIVARA_AUDIT_STATUS: REJECTED",
              `CAPIVARA_FINDING: Phase 2 | o critério «${CITACAO_DA_FASE}» contradiz a regra do esqueleto «${CITACAO_DA_DECISAO}» | troque a exclusão permanente pela desativação do cliente`,
              "CAPIVARA_REASON: a fase contradiz uma decisão do produto",
            ].join("\n")
          : approve(),
    },
    repeat: true,
  };
  const cenario = await cadeia("g3", DESATIVACAO, { executor: async () => [] }, { extraNoPlano: [auditorQueLe], sha12: "9a7a00000003" });
  const publicado = await readFile(join(cenario.projectRoot, ".capivara/init/project-phases.md"), "utf8").catch(() => "");
  const pronto = cenario.plan?.readiness.ready === true;
  const texto = cenario.bloqueio ?? cenario.plan?.rendered ?? "";
  const citaAsDuas = texto.includes(CITACAO_DA_FASE) && texto.includes(CITACAO_DA_DECISAO);
  const registro = await primeiroLogCom(cenario.projectRoot, runIdFor("init", "9a7a00000003"), `«${CITACAO_DA_FASE}» contradiz`);
  return {
    id: "G-3",
    pega: !pronto && !publicado.includes(CITACAO_DA_FASE) && citaAsDuas,
    registro,
    detalhe: pronto
      ? "o plan publicou RALPH READY com a fase que exclui permanentemente"
      : citaAsDuas
        ? `o plan parou (${cenario.bloqueio !== null ? "impasse" : "NOT READY"}) e a parada cita a fase e a decisão`
        : `o plan parou, mas a parada não cita as duas passagens: ${texto.slice(0, 300)}`,
    cenario,
  };
}

const AUTENTICACAO: Produto = {
  projectName: "Acesso",
  pedido: "login, cadastro de conta e recuperação de senha por e-mail",
  entities: [{ name: "contas", fields: [{ name: "email", type: "text" }, { name: "senha_hash", type: "text" }], relations: [] }],
  stories: [
    { id: "US-1.1", statement: "Como pessoa, crio uma conta" },
    { id: "US-1.2", statement: "Como pessoa, entro com e-mail e senha" },
    { id: "US-1.3", statement: "Como pessoa, recupero a senha esquecida" },
  ],
  workflows: [],
  rules: [],
  components: [
    { name: "servico", responsibility: "contas e sessões", areas: ["backend"], dependsOn: [], contracts: ["cadastrar(email, senha)", "entrar(email, senha)", "recuperar(email)"], files: ["src/contas.js", "src/recuperacao.js"], owns: ["contas"] },
  ],
  fases: [
    {
      title: "Acesso", goal: "a pessoa cria conta, entra e recupera a senha", covers: ["contas", "US-1.1", "US-1.2", "US-1.3"], areas: ["backend"], components: ["servico"],
      tasks: [
        { title: "Implementar o cadastro de conta", criteria: ["Uma conta nova guarda a senha só como hash"], traces: ["US-1.1", "contas"] },
        { title: "Implementar o login", criteria: ["E-mail e senha corretos abrem a sessão"], traces: ["US-1.2"] },
        { title: "Implementar a recuperação de senha", criteria: ["Pedir a recuperação envia um link de redefinição ao e-mail da conta"], traces: ["US-1.3"] },
      ],
    },
  ],
};

const ACHADO_G4 = "recuperação de senha ausente";

/**
 * G-4 · pendência não vira "pronto". O executor entrega cadastro e login e
 * nunca implementa a recuperação de senha; o verificador, chamado para reparar,
 * também não. O build não pode terminar aceito.
 */
export async function garantiaG4(): Promise<Garantia> {
  const cenario = await cadeia("g4", AUTENTICACAO, {
    executor: async () => [MANIFESTO, { path: "src/contas.js", content: "export const cadastrar = () => 1;\nexport const entrar = () => true;\n" }],
    revisao: async (call, arvore) =>
      (await lerArquivo(arvore, "src/recuperacao.js")) !== ""
        ? allDone(call.phase.taskCount)
        : `TASK 1: DONE\nTASK 2: DONE\nTASK 3: INCOMPLETE — ${ACHADO_G4}; não existe src/recuperacao.js nem rota de redefinição; implemente recuperar(email) enviando o link; teste o envio do link`,
  }, { sha12: "9a7a00000004" });
  const aceito = cenario.build?.exitCode === 0;
  const parada = [...(cenario.build?.errors ?? []), ...(cenario.build?.phases.map((fase) => ("cause" in fase.outcome ? fase.outcome.cause : "")) ?? [])].join("\n");
  const nomeada = /recupera[çc][ãa]o de senha/i.test(parada);
  return {
    id: "G-4",
    pega: !aceito && nomeada,
    registro: await primeiroLogCom(cenario.projectRoot, cenario.build?.runId ?? "", ACHADO_G4),
    detalhe: aceito
      ? "o build terminou concluído sem a recuperação de senha"
      : nomeada
        ? `o build não aceitou (código ${cenario.build?.exitCode ?? "-"}; ${cenario.build?.phases.map((fase) => `${fase.id}: ${fase.outcome.status}`).join(", ")}); a pendência é nomeada na parada`
        : "o build não aceitou, mas não diz qual obrigação ficou pendente",
    cenario,
  };
}
