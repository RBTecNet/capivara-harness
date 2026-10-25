/**
 * §126 — o impasse INIT → PLAN: o procedimento da execução de teste não é
 * requisito, e o envelope de fase se corrige na arquitetura.
 *
 * O Parallel Lab com Luna (0.7.0, run `init-dc741f0d7b92`) pedia só "os testes
 * precisam utilizar banco isolado dos dados normais da aplicação". O escritor
 * do esqueleto escreveu isso, e mais nada. Quem acrescentou "banco descartável,
 * criado e destruído pela própria execução dos testes" foi o HARNESS — as
 * regras de banco que `regrasDeBanco` põe no esqueleto depois do parser. Na
 * reorganização da arquitetura o auditor leu a regra como produto ("não
 * atribui a nenhum componente ou fase a criação e a destruição do arquivo") e
 * mandou atribuí-la; o arquiteto escreveu "a execução automatizada dos testes e
 * dos fluxos cria e destrói o banco descartável … e fornece seu caminho por
 * DATABASE_PATH" nos goals das fases 2 a 5; a auditoria aprovou. Os auditores
 * de fase, aplicando a responsabilidade do planejamento, mandaram tirar a frase
 * do Goal — e o Goal é envelope, montado da arquitetura, que nenhuma emenda de
 * fase alcança. Onze rodadas, três arbitragens ("qual dos dois entendimentos
 * vale?") e o impasse.
 *
 * Os textos reais são as fixtures. O que se prova: a regra do harness carrega o
 * isolamento e não o procedimento; I-16 reconhece o procedimento da execução de
 * teste no esqueleto, na arquitetura, no plano e na correção do auditor, com o
 * pedido como autoridade; o achado sobre o envelope vai à arquitetura, nunca ao
 * desenvolvedor; o orçamento esgotado para com diagnóstico que nomeia a origem;
 * o que estava aprovado e não mudou fica; e o caminho limpo não ganha chamada.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mesmoPonto } from "../../src/audit/cycle.js";
import { alvoNoEnvelope, chavesDoEnvelope } from "../../src/audit/envelope.js";
import type { Finding } from "../../src/audit/protocol.js";
import { parseArchitecture, parseSkeleton, testPrescriptionHint, testPrescriptions, testRunPrescriptions, testToolPrescriptions } from "../../src/contract/index.js";
import { runInit, runPlan } from "../../src/init/index.js";
import type { AgentCall } from "../../src/init/index.js";
import { ID_DO_BANCO, regrasDeBanco } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { NO_QUESTIONS, approve, fakeAgent, reject } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-126-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

/* ---------- o pedido real (os trechos que decidem) ---------- */

const PEDIDO = `# CAPIVARA PARALLEL LAB — Teste de execução paralela

## Stack

- Node.js
- TypeScript
- React
- Vite
- Backend Node.js com API REST
- SQLite em arquivo
- Testes automatizados

## Persistência

Usar SQLite em arquivo.
Todos os cadastros devem persistir entre reinicializações.
Os testes precisam utilizar banco isolado dos dados normais da aplicação.
Não utilizar serviços de banco de dados externos.

## Testes e critérios de aceite

Cada módulo precisa demonstrar:

1. Criação de registro válido.
2. Rejeição de entradas inválidas.
3. Exclusão com confirmação na interface.
4. Persistência após reinicialização.

A aplicação completa precisa demonstrar:

- Fluxos reais executados no navegador.
- Testes automatizados aprovados.
`;

/** O mesmo pedido, quando o desenvolvedor FIXA o procedimento: aí ele é dele. */
const PEDIDO_COM_PROCEDIMENTO = `${PEDIDO}
Os testes devem criar um arquivo SQLite temporário, informar seu caminho à aplicação pela variável DATABASE_PATH e apagá-lo ao terminar.
`;

const request = { text: PEDIDO, origin: "text" as const, path: null, sha12: "lunalab00126" };
const requestComProcedimento = { text: PEDIDO_COM_PROCEDIMENTO, origin: "text" as const, path: null, sha12: "lunalab01126" };
const language = "português do Brasil" as const;
/** A decisão de banco do run real: "1", o projeto cria o dele, embutido em arquivo. */
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
const COERENCIA = "project-phases.md#coerência";

/* ---------- o esqueleto que o escritor devolveu (log 027b515b), reduzido a três fases ---------- */

const GOAL_1 = "Disponibilizar o banco local, os arquivos de configuração de ambiente na raiz, o manifesto do projeto com o comando de migração e a estrutura visual com navegação e painel inicial.";
const GOAL_2 = "Disponibilizar o CRUD de tarefas com validação, alteração de status, confirmação de exclusão e persistência por meio dos contratos da fundação.";
const GOAL_3 = "Disponibilizar o CRUD de categorias com validação de nome único, confirmação de exclusão e persistência por meio dos contratos da fundação.";

/** A regra do escritor, byte a byte: isolamento, e nenhum procedimento. */
const REGRA_DO_ESCRITOR =
  "Os testes automatizados de cada módulo usam banco isolado dos dados normais da aplicação e demonstram criação válida, rejeição de entradas inválidas, consulta persistida, atualização, exclusão confirmada na interface e persistência após reinicialização.";
const US_2_2 =
  "O módulo de tarefas inclui testes automatizados que demonstram criação válida, rejeição de entradas inválidas, consulta persistida, atualização, exclusão confirmada na interface e persistência após reinicialização, usando banco isolado dos dados normais da aplicação.";

const ESQUELETO_DO_RUN = JSON.stringify({
  contract: "capivara-skeleton/v2",
  environment: [{ technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["--version"] }],
  projectName: "Parallel Lab",
  stack: [
    { component: "Ambiente de execução", decision: "Node.js" },
    { component: "Linguagem", decision: "TypeScript" },
    { component: "Interface", decision: "React com Vite" },
    { component: "Persistência", decision: "SQLite em arquivo local" },
  ],
  entities: [
    { name: "tarefas", fields: [{ name: "titulo", type: "texto obrigatório" }, { name: "status", type: "pendente, em andamento ou concluída" }], relations: [] },
    { name: "categorias", fields: [{ name: "nome", type: "texto obrigatório e único" }], relations: [] },
  ],
  stories: [
    { id: "US-1.1", statement: "Como pessoa usuária, quero navegar por uma interface responsiva em português brasileiro, com menu lateral, painel inicial e contagens reais de tarefas e categorias." },
    { id: "US-2.1", statement: "Como pessoa usuária, quero cadastrar, consultar, editar, alterar o status e excluir tarefas, com validação, confirmação antes da exclusão e dados persistidos após reinicializações." },
    { id: "US-2.2", statement: US_2_2 },
    { id: "US-3.1", statement: "Como pessoa usuária, quero cadastrar, consultar, editar e excluir categorias, com nome obrigatório e único, validação, confirmação antes da exclusão e dados persistidos após reinicializações." },
  ],
  workflows: [
    { number: "1", name: "Navegação e painel inicial", steps: ["Abrir o painel inicial.", "Consultar as contagens de registros persistidos de tarefas e categorias."] },
    { number: "2", name: "Gerenciamento de tarefas", steps: ["Cadastrar uma tarefa com título obrigatório.", "Confirmar a exclusão da tarefa na interface."] },
  ],
  rules: [
    { subject: "persistencia", statement: "Os registros dos módulos persistem em arquivo SQLite local e continuam disponíveis após reinicializações da aplicação. Nenhum serviço de banco de dados externo é necessário." },
    { subject: "testes automatizados", statement: REGRA_DO_ESCRITOR },
    { subject: "exclusao", statement: "A interface pede confirmação antes de excluir uma tarefa ou categoria." },
  ],
  phases: [
    { number: 1, title: "Fundação compartilhada", goal: GOAL_1, dependsOn: "none", covers: ["US-1.1", "workflow 1", "tarefas", "categorias"], taskCount: 2 },
    { number: 2, title: "Gerenciamento de tarefas", goal: GOAL_2, dependsOn: "Phase 1", covers: ["US-2.1", "US-2.2", "workflow 2"], taskCount: 1 },
    { number: 3, title: "Gerenciamento de categorias", goal: GOAL_3, dependsOn: "Phase 1", covers: ["US-3.1"], taskCount: 1 },
  ],
  mvpCutPhase: 3,
});

/**
 * O mesmo esqueleto como o escritor da §129 o devolve: a story US-2.2 fica com
 * o comportamento, e o pedido de testes fica em regras de assunto "testes",
 * que o build lê e o plano não. É o que os cenários de outros mecanismos
 * recebem; o texto do run (`ESQUELETO_DO_RUN`) é o que prova a recusa, no fim
 * do arquivo.
 */
const US_2_2_PRODUTO =
  "O módulo de tarefas demonstra criação válida, rejeição de entradas inválidas, consulta persistida, atualização, exclusão confirmada na interface e persistência após reinicialização.";
const ESQUELETO = JSON.stringify({
  ...JSON.parse(ESQUELETO_DO_RUN),
  stories: (JSON.parse(ESQUELETO_DO_RUN).stories as { id: string; statement: string }[]).map((story) => (story.id === "US-2.2" ? { ...story, statement: US_2_2_PRODUTO } : story)),
  rules: [...(JSON.parse(ESQUELETO_DO_RUN).rules as unknown[]), { subject: "testes.tarefas", statement: US_2_2 }],
});

/* ---------- a arquitetura: a legítima, a contaminada (textos reais) e a em prosa sem forma ---------- */

/** O que a arquitetura real aprovou na rodada 6, depois de o auditor mandar atribuir o ciclo de vida. */
const REAL = {
  goal2: "A execução automatizada dos testes e dos fluxos cria e destrói o banco descartável usado por tarefas e fornece seu caminho por DATABASE_PATH.",
  goal3: "A execução automatizada dos testes e dos fluxos cria e destrói o banco descartável usado por categorias e fornece seu caminho por DATABASE_PATH.",
  responsabilidade: "A execução automatizada dos testes e dos fluxos relacionados a tarefas cria e destrói o banco SQLite descartável, fornece seu caminho por DATABASE_PATH e não acessa o banco normal da aplicação.",
  contrato: "A execução automatizada dos testes e dos fluxos de tarefas cria e destrói seu banco descartável e fornece o caminho desse banco à aplicação por DATABASE_PATH.",
  decisao: "O mecanismo de execução dos testes automatizados e dos fluxos cria um arquivo SQLite descartável, define DATABASE_PATH para que a aplicação use esse arquivo e o destrói ao concluir. Nenhuma dessas execuções acessa o banco normal configurado em .env. Não é fixada ferramenta para esse mecanismo.",
  compatibilidade: "O mecanismo de execução dos testes automatizados e dos fluxos cria e destrói o banco SQLite descartável, fornece seu caminho por DATABASE_PATH e não acessa o banco normal configurado em .env. A aplicação aceita esse caminho alternativo.",
};

/** A mesma prescrição, em prosa que nenhuma forma reconhece: é o caso em que só o roteamento salva. */
const PROSA = " Cada rodada de testes e de fluxos recebe um banco descartável próprio, preparado antes e apagado depois, cujo caminho chega à aplicação por DATABASE_PATH.";

/** O lado da APLICAÇÃO, decisão técnica legítima do plano: fica. */
const CONTRATO_DA_APLICACAO =
  "A aplicação aceita DATABASE_PATH apontando para outro arquivo SQLite local, incluindo o banco descartável usado pelos testes e fluxos, sem acessar o banco normal configurado em .env.";

type Variacao = "limpa" | "contaminada" | "prosa";

function arquitetura(variacao: Variacao): string {
  const goal2 = variacao === "contaminada" ? `${GOAL_2} ${REAL.goal2}` : variacao === "prosa" ? `${GOAL_2}${PROSA}` : GOAL_2;
  const goal3 = variacao === "contaminada" ? `${GOAL_3} ${REAL.goal3}` : variacao === "prosa" ? `${GOAL_3}${PROSA}` : GOAL_3;
  const contaminada = variacao === "contaminada";
  return JSON.stringify({
    contract: "capivara-architecture/v1",
    overview: "Aplicação web local: um servidor Node.js expõe a API REST, uma persistência SQLite compartilhada mantém os registros independentes e uma interface React consome a API.",
    components: [
      {
        name: "fundacao",
        responsibility: "Mantém o banco SQLite local, o esquema, a configuração de ambiente na raiz, o manifesto do projeto e a estrutura visual com navegação e painel inicial.",
        areas: ["dados", "backend", "frontend"],
        dependsOn: [],
        contracts: [
          "O caminho do banco é obtido de DATABASE_PATH.",
          CONTRATO_DA_APLICACAO,
          "O comando npm run migrate cria o esquema completo em banco vazio e pode ser repetido sem erro.",
        ],
        files: ["src/dados/", "src/web/", "package.json", ".env.example", ".gitignore"],
        owns: ["tarefas", "categorias"],
      },
      {
        name: "modulo-tarefas",
        responsibility: `Implementa o CRUD de tarefas na API e na interface, com validação, confirmação de exclusão e persistência por meio dos contratos da fundação.${contaminada ? ` ${REAL.responsabilidade}` : ""}`,
        areas: ["backend", "frontend"],
        dependsOn: ["fundacao"],
        contracts: ["GET /api/tarefas → 200 lista JSON", "POST /api/tarefas → 201 registro; título ausente → 400", ...(contaminada ? [REAL.contrato] : [])],
        files: ["src/modulos/tarefas/"],
        owns: [],
      },
      {
        name: "modulo-categorias",
        responsibility: "Implementa o CRUD de categorias na API e na interface, com nome único, confirmação de exclusão e persistência por meio dos contratos da fundação.",
        areas: ["backend", "frontend"],
        dependsOn: ["fundacao"],
        contracts: ["GET /api/categorias → 200 lista JSON", "POST /api/categorias com nome duplicado → 409"],
        files: ["src/modulos/categorias/"],
        owns: [],
      },
    ],
    dataDecisions: [
      { subject: "DATABASE_PATH", statement: "Usar DATABASE_PATH como única variável de ambiente para o caminho do banco. O servidor e a aplicação aceitam caminhos diferentes por essa variável." },
      ...(contaminada ? [{ subject: "banco descartável", statement: REAL.decisao }] : []),
    ],
    flows: [
      { workflow: "1", components: ["fundacao"], notes: "" },
      { workflow: "2", components: ["modulo-tarefas", "fundacao"], notes: "" },
    ],
    infrastructure: {
      runtimes: [{ name: "Node.js", version: "", purpose: "Executar a API e os comandos do projeto.", basis: "stack do skeleton: Ambiente de execução Node.js" }],
      tools: [],
      packageManagers: [{ name: "npm", version: "", purpose: "Instalar as dependências e executar os comandos documentados.", basis: "padrão do runtime Node.js" }],
      dependencies: [{ name: "better-sqlite3", version: "", kind: "app", purpose: "Acessar o banco SQLite em arquivo local.", basis: "decisão aceita: banco embutido em arquivo" }],
      services: [],
      databases: [{ name: "SQLite", version: "", purpose: "Persistir os registros em arquivo local.", basis: "pedido original: SQLite em arquivo" }],
      compatibility: ["A aplicação deve funcionar localmente sem serviço de banco de dados externo.", ...(contaminada ? [REAL.compatibilidade] : [])],
      preconditions: ["Node.js e npm estão instalados."],
    },
    phases: [
      { number: 1, title: "Fundação compartilhada", goal: GOAL_1, dependsOn: "none", covers: ["US-1.1", "workflow 1", "tarefas", "categorias"], areas: ["dados", "backend", "frontend"], components: ["fundacao"], taskCount: 2, rationale: "Estabelece os dados e os contratos de que os módulos dependem." },
      { number: 2, title: "Gerenciamento de tarefas", goal: goal2, dependsOn: "Phase 1", covers: ["US-2.1", "US-2.2", "workflow 2"], areas: ["backend", "frontend"], components: ["modulo-tarefas"], taskCount: 1, rationale: "Um módulo sobre os contratos da fundação." },
      { number: 3, title: "Gerenciamento de categorias", goal: goal3, dependsOn: "Phase 1", covers: ["US-3.1"], areas: ["backend", "frontend"], components: ["modulo-categorias"], taskCount: 1, rationale: "Um módulo independente sobre os contratos da fundação." },
    ],
    mvpCutPhase: 3,
  });
}

/* ---------- as fases ---------- */

const FASE_1 = `## Phase 1: Fundação compartilhada

- [ ] **Task:** Em \`src/dados/\`, criar o esquema SQLite de tarefas e categorias, o comando \`npm run migrate\` e a leitura do caminho do banco por DATABASE_PATH, carregada do \`.env\`
  - **Acceptance criteria:**
    - \`npm run migrate\` cria as tabelas tarefas e categorias num banco vazio e pode ser repetido sem erro
    - Com DATABASE_PATH apontando para outro arquivo, a aplicação usa esse arquivo e não toca o banco configurado no \`.env\`
  - **Traces:** tarefas, categorias

- [ ] **Task:** Em \`src/web/\`, criar o menu lateral e o painel inicial com as contagens reais de tarefas e categorias
  - **Acceptance criteria:**
    - O painel inicial mostra as contagens persistidas de tarefas e categorias
  - **Traces:** US-1.1, workflow 1
`;

const FASE_2 = `## Phase 2: Gerenciamento de tarefas

- [ ] **Task:** Em \`src/modulos/tarefas/\`, implementar o CRUD de tarefas na API e na página de tarefas, com alteração de status e confirmação antes de excluir
  - **Acceptance criteria:**
    - \`POST /api/tarefas\` sem título retorna HTTP 400 e não grava nada
    - Excluir uma tarefa pede confirmação na interface antes de enviar \`DELETE /api/tarefas/{id}\`
  - **Traces:** US-2.1, US-2.2, tarefas, workflow 2
`;

const FASE_3 = `## Phase 3: Gerenciamento de categorias

- [ ] **Task:** Em \`src/modulos/categorias/\`, implementar o CRUD de categorias na API e na página de categorias, com nome único e confirmação antes de excluir
  - **Acceptance criteria:**
    - \`POST /api/categorias\` com nome já utilizado retorna HTTP 409 e não grava nada
    - Excluir uma categoria pede confirmação na interface antes de enviar \`DELETE /api/categorias/{id}\`
  - **Traces:** US-3.1, categorias
`;

/* ---------- os achados reais ---------- */

/** O auditor da arquitetura na rodada 5 da reorganização (log 63383eb0). */
const ACHADO_DA_ARQUITETURA = reject(
  "infraestrutura · Requisitos de ambiente e compatibilidade",
  "O skeleton exige que os testes e os fluxos usem um banco descartável criado e destruído pela própria execução. A arquitetura exige apenas um caminho DATABASE_PATH apontando para esse banco e que a aplicação aceite caminhos alternativos; não atribui a nenhum componente ou fase a criação e a destruição do arquivo.",
  "Atribuir ao mecanismo de execução dos testes e dos fluxos a criação e a destruição do banco descartável, mantendo o uso de DATABASE_PATH e sem escolher ferramentas de teste.",
);
const FIX_DA_ARQUITETURA = "Atribuir ao mecanismo de execução dos testes e dos fluxos a criação e a destruição do banco descartável";

/** O auditor da fase 3 na rodada 4 (log 7c6b9a2d): o lado oposto, mandando acrescentar. */
const ACHADO_P3_ACRESCENTE = reject(
  "Task de `src/modulos/categorias/servico.ts`",
  "O critério exige que os testes usem um banco descartável por `DATABASE_PATH`, mas não exige que a execução automatizada dos testes e dos fluxos crie e destrua esse banco, como determina a arquitetura.",
  "Acrescente ao critério que a execução automatizada dos testes e dos fluxos de categorias cria e destrói o banco SQLite descartável e fornece seu caminho à aplicação por `DATABASE_PATH`, sem acessar o banco normal.",
);

/** O Goal, rodada a rodada, com as palavras de cada leitura (logs dos verifiers de P2, P3, P4, P5 e da coerência). */
const GOAL_P2: Finding[] = [
  { where: "Goal", problem: "Determina que a execução dos testes e dos fluxos crie e destrua o banco descartável e forneça seu caminho por DATABASE_PATH, prescrevendo como a execução é organizada.", fix: "Remova essa instrução operacional e mantenha apenas o requisito de que os testes automatizados e os fluxos usem um banco isolado dos dados normais da aplicação." },
  { where: "Goal", problem: "A instrução de que a execução automatizada cria e destrói o banco descartável e fornece seu caminho por DATABASE_PATH contraria a decisão aceita de remover essa instrução operacional.", fix: "Remova a criação, destruição e fornecimento do caminho; mantenha apenas o requisito de que os testes automatizados e os fluxos usem banco isolado dos dados normais da aplicação." },
  { where: "Goal", problem: "Mantém a instrução operacional de que a execução automatizada cria e destrói o banco descartável e fornece seu caminho por DATABASE_PATH, contrariando a decisão aceita para o Goal.", fix: "Remova essa instrução e mantenha apenas o requisito de que os testes automatizados e os fluxos usem banco isolado dos dados normais da aplicação." },
  { where: "Goal", problem: "A fase mantém a instrução de criar e destruir o banco descartável e fornecer seu caminho por DATABASE_PATH, embora a decisão aceita peça remover essa instrução operacional.", fix: "Remova a criação, a destruição e o fornecimento do caminho; mantenha apenas o requisito de banco isolado indicado na decisão aceita." },
];
const GOAL_P3: Finding = { where: "Goal", problem: "Mantém a instrução operacional de criar e destruir um banco descartável e fornecer seu caminho por DATABASE_PATH, contrariando a decisão aceita que remove essa instrução.", fix: "Remova a criação, a destruição e o fornecimento do caminho; mantenha apenas o requisito de que os testes automatizados e os fluxos usem banco isolado dos dados normais da aplicação." };
const GOAL_P4: Finding = { where: "Phase 4, Goal", problem: "Prescreve que a execução automatizada crie e destrua o banco descartável e forneça seu caminho por DATABASE_PATH, contrariando a decisão aceita de remover essas instruções operacionais.", fix: "Remova a criação, a destruição e o fornecimento do caminho; mantenha somente o requisito de que os testes automatizados e os fluxos usem banco isolado dos dados normais da aplicação." };
const COERENCIA_DESCRICOES: Finding = { where: "Phase 2 vs Phase 3 vs Phase 4 vs Phase 5", problem: "As descrições das quatro fases determinam que a execução automatizada crie e destrua o banco descartável e forneça seu caminho por `DATABASE_PATH`. Isso excede as decisões confirmadas, que mandam remover essas operações e manter apenas o requisito de isolamento do banco.", fix: "Remova das descrições das fases a criação, a destruição e o fornecimento do caminho; mantenha somente o requisito de que os testes automatizados e os fluxos usem banco isolado dos dados normais da aplicação." };
const COERENCIA_DESSAS: Finding = { where: "Phase 2, Phase 3, Phase 4 e Phase 5", problem: "As descrições dessas fases dizem que testes e fluxos criam e destroem o banco descartável e fornecem seu caminho por `DATABASE_PATH`. Isso excede as decisões aceitas, que removem essas instruções operacionais e mantêm apenas o requisito de isolamento do banco.", fix: "Remova das quatro descrições as instruções de criação, destruição e fornecimento do caminho; mantenha somente o requisito de isolamento autorizado para testes e fluxos." };

const linha = (finding: Finding) => reject(finding.where, finding.problem, finding.fix);

/* ---------- roteiro e execução ---------- */

interface Papeis {
  arquiteto?: (call: AgentCall) => string;
  auditorDaArquitetura?: (call: AgentCall) => string;
  p2?: (call: AgentCall) => string;
  p3?: (call: AgentCall) => string;
  coerencia?: (call: AgentCall) => string;
}

function roteiro(papeis: Papeis = {}): ScriptStep[] {
  return [
    { match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: ESQUELETO }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: papeis.arquiteto ?? (() => arquitetura("limpa")) }, repeat: true },
    ...(papeis.auditorDaArquitetura ? [{ match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: papeis.auditorDaArquitetura }, repeat: true }] : []),
    { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: FASE_1 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: FASE_2 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p03" }, respond: { stdout: FASE_3 }, repeat: true },
    // O plano é auditado inteiro, numa chamada (etapa 2 da redução): a leitura que o caso dá a uma fase é a do plano.
    ...(papeis.p2 ?? papeis.p3 ?? papeis.coerencia
      ? [{ match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: (papeis.p2 ?? papeis.p3 ?? papeis.coerencia)! }, repeat: true }]
      : []),
    { match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true },
  ];
}

async function init(pedido = request, papeis: Papeis = {}) {
  const agent = fakeAgent(roteiro(papeis));
  const outcome = await runInit({ projectRoot, request: pedido, language, stage: "init", call: agent.call, ask: responde, announce: () => undefined });
  return { outcome, agent };
}

async function plan(papeis: Papeis, extras: Partial<Parameters<typeof runPlan>[0]> = {}, pedido = request) {
  const dito: string[] = [];
  const perguntadas: Question[] = [];
  const agent = fakeAgent(roteiro(papeis));
  const run = runPlan({
    projectRoot, request: pedido, language, call: agent.call,
    ask: async (question) => { perguntadas.push(question); return "1"; },
    announce: (frase) => void dito.push(frase), sleep: async () => undefined,
    ...extras,
  });
  return { run, agent, perguntadas, anunciado: () => dito.join("\n") };
}

const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));
const arquitetos = (agent: { calls: AgentCall[] }) => por(agent, { stage: "authoring", subject: "architecture" });
const deAuditoria = (perguntadas: Question[]) => perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"));
const publicado = (nome: string) => readFile(join(projectRoot, ".capivara/init", nome), "utf8");
const goalsPublicados = async () => (await publicado("skeleton.md")).split("\n").filter((linha) => /^- Phase \d+:/.test(linha)).join("\n");
const regras = (markdown: string) => markdown.slice(markdown.indexOf("## Regras transversais"), markdown.indexOf("## Fases"));

/** O procedimento do ciclo de vida, nas três formas em que ele chegou aos documentos do run. */
const PROCEDIMENTO = /cria e destr[oó]i|criado e destru[ií]do pela pr[oó]pria execu|fornece(?:m)? (?:seu caminho|pela mesma vari[aá]vel)/iu;

/* =========================================================================== */

describe("a regra do harness: isolamento, sem o procedimento da execução", () => {
  it("1. as regras de banco mantêm o banco isolado e a origem pelo ambiente, e não dizem quem cria ou destrói o banco dos testes", () => {
    for (const decisao of ["embutido", "informado", "instalado"] as const) {
      const regrasDoBanco = regrasDeBanco(decisao);
      const testes = regrasDoBanco.find((regra) => regra.subject === "banco dos testes")?.statement ?? "";
      expect(testes, decisao).toContain("nenhum teste lê, escreve ou migra");
      expect(testes, decisao).toContain("descartável");
      expect(regrasDoBanco.find((regra) => regra.subject === "a aplicação escolhe o banco pelo ambiente")?.statement, decisao).toContain("o banco DESCARTÁVEL é uma das origens que a APLICAÇÃO aceita");
      for (const regra of regrasDoBanco) {
        expect(regra.statement, `${decisao} · ${regra.subject}`).not.toMatch(PROCEDIMENTO);
        // Nenhuma diz o procedimento nem nomeia ferramenta (§126).
        expect(testRunPrescriptions(`${regra.subject}\n${regra.statement}`), `${decisao} · ${regra.subject}`).toEqual([]);
        expect(testToolPrescriptions(`${regra.subject}\n${regra.statement}`), `${decisao} · ${regra.subject}`).toEqual([]);
        // Só a do banco dos testes fala do teste do produto — e ela é do build: o plano não a lê (§129).
        if (regra.subject !== "banco dos testes") expect(testPrescriptions(`${regra.subject}\n${regra.statement}`), `${decisao} · ${regra.subject}`).toEqual([]);
      }
    }
    const exemplo = regrasDeBanco("embutido").find((regra) => regra.subject === "o exemplo precisa RODAR")?.statement ?? "";
    expect(exemplo).toContain("outro arquivo temporário");
    expect(exemplo).toContain("sem tocar o banco normal");
  });

  it("I-16 reconhece o procedimento da execução de teste nos textos reais do run", () => {
    const real = [
      REAL.goal2,
      REAL.responsabilidade,
      REAL.contrato,
      REAL.decisao,
      REAL.compatibilidade,
      FIX_DA_ARQUITETURA,
      "Acrescente ao critério que a execução automatizada dos testes e dos fluxos de categorias cria e destrói o banco SQLite descartável",
      "O critério que determina que a execução automatizada crie e destrua o banco descartável e forneça seu caminho por DATABASE_PATH",
      // A regra do harness da 0.7.0: "o exemplo precisa RODAR".
      "testes e fluxos fornecem pela mesma variável de ambiente outro arquivo temporário, criado e destruído pela própria execução",
      "Os testes automatizados definem APP_DB_PATH para um arquivo temporário exclusivo de cada execução",
      "the test run creates and destroys the database and sets DATABASE_PATH",
    ];
    for (const texto of real) expect(testPrescriptions(texto, [PEDIDO]), texto).not.toEqual([]);
  });

  it("I-16 não toca o lado da aplicação nem o que a calibração anterior manteve; o requisito de teste, desde a §129, é o pedido de testes", () => {
    // Até a §128 estes eram o requisito que ficava no plano; agora são do build, e a I-16 os conta.
    for (const texto of [
      "Os testes precisam utilizar banco isolado dos dados normais da aplicação.",
      REGRA_DO_ESCRITOR,
      US_2_2,
      "Os testes automatizados do módulo usam banco isolado dos dados normais da aplicação",
      "o módulo possui testes automatizados, executados contra um banco descartável apontado pela variável de ambiente",
      "A execução de testes deve utilizar banco descartável",
      "a suíte automatizada roda contra um banco descartável, criado e destruído pela própria execução",
    ]) {
      expect(testPrescriptions(texto, [PEDIDO]), texto).not.toEqual([]);
    }
    for (const texto of [
      CONTRATO_DA_APLICACAO,
      US_2_2_PRODUTO,
      "O caminho do banco é obtido de DATABASE_PATH.",
      "Usar DATABASE_PATH como única variável de ambiente para o caminho do banco. O servidor e a aplicação aceitam caminhos diferentes por essa variável.",
      "A execução dos testes não cria nem destrói o banco configurado no .env do desenvolvedor",
      "O comando npm run migrate cria o esquema completo em banco vazio",
      "O fluxo cria uma tarefa e a exclui depois de confirmar",
    ]) {
      expect(testPrescriptions(texto, [PEDIDO]), texto).toEqual([]);
    }
  });

  it("o procedimento no propósito de uma dependência não a apaga como ferramenta de teste: ela fica, e a frase volta ao arquiteto", () => {
    const esqueleto = JSON.parse(ESQUELETO);
    const comProcedimento = JSON.parse(arquitetura("limpa"));
    comProcedimento.infrastructure.dependencies[0].purpose = "Acessar o banco SQLite em arquivo local; a execução dos testes cria e destrói o banco temporário com ele.";
    const lida = parseArchitecture(JSON.stringify(comProcedimento), esqueleto, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(lida.ok).toBe(false);
    if (!lida.ok) expect(lida.defects.map((defeito) => defeito.problem).join("\n")).toContain("o item better-sqlite3 de infrastructure.dependencies prescreve teste");
    // A ferramenta de teste saía contando (§118); desde a §129 ela fica: a infraestrutura lista as dependências de teste.
    const comFerramenta = JSON.parse(arquitetura("limpa"));
    comFerramenta.infrastructure.dependencies.push({ name: "vitest", version: "", kind: "dev", purpose: "rodar a suíte", basis: "escolha do arquiteto" });
    const limpa = parseArchitecture(JSON.stringify(comFerramenta), esqueleto, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(limpa.ok, limpa.ok ? "" : JSON.stringify(limpa.defects)).toBe(true);
    if (limpa.ok) {
      expect(limpa.applied.some((conserto) => conserto.startsWith("removeu vitest"))).toBe(false);
      expect(limpa.architecture.infrastructure.dependencies.map((item) => item.name)).toEqual(["better-sqlite3", "vitest"]);
    }
  });

  it("revisão: o verbo sem recurso é produto, o fluxo sozinho é workflow, e o eco da regra não conta; as reescritas realistas contam", () => {
    for (const produto of [
      "A execução do fluxo 2 cria a tarefa e a exibe na lista",
      "A execução do fluxo de aprovação cria uma notificação",
      "A execução dos fluxos de trabalho remove a pendência",
      "A execução do fluxo de cadastro cria o arquivo de exportação",
      "O cadastro de testes cria um registro",
      "A página de testes define o filtro padrão",
      "Os testes definem a nota mínima de aprovação",
      "A suíte define a tarifa de hospedagem",
      "the suite sets its price",
      "Automated tests should provide confidence",
      "A forma como a execução dos testes cria e destrói o banco é decisão do build",
      "Não cabe à execução dos testes criar o banco",
    ]) {
      expect(testPrescriptions(produto, [PEDIDO]), produto).toEqual([]);
    }
    for (const procedimento of [
      "Os testes de cada módulo criam e destroem o banco descartável",
      "Os testes do módulo criam o banco temporário e o apagam ao terminar",
      "Cada teste cria seu próprio banco temporário",
      "each test creates its own database file",
    ]) {
      expect(testPrescriptions(procedimento, [PEDIDO]), procedimento).not.toEqual([]);
    }
  });

  it("revisão: a autoridade é de procedimento sobre recurso — um pedido que fala dos dados de exemplo dos testes não autoriza o banco", () => {
    for (const pedido of [
      "Os testes automatizados criam seus próprios dados de exemplo.",
      "Os testes devem apagar os registros que criarem.",
      "Automated tests should provide confidence.",
    ]) {
      expect(testPrescriptions(REAL.goal2, [pedido]), pedido).not.toEqual([]);
    }
  });

  it("11. o pedido que fixa o procedimento é a autoridade: o mesmo texto deixa de ser prescrição", () => {
    expect(testPrescriptions(REAL.goal2, [PEDIDO_COM_PROCEDIMENTO])).toEqual([]);
    expect(testPrescriptions(REAL.decisao, [PEDIDO_COM_PROCEDIMENTO])).toEqual([]);
    // Sem a frase do desenvolvedor, a mesma prescrição volta a contar.
    expect(testPrescriptions(REAL.goal2, [PEDIDO])).not.toEqual([]);
  });
});

describe("o envelope da fase: o que a emenda não alcança", () => {
  it("os achados reais do Goal e das descrições das fases são do envelope; os de task e critério não", () => {
    for (const finding of [...GOAL_P2, GOAL_P3, GOAL_P4, COERENCIA_DESCRICOES, COERENCIA_DESSAS]) {
      expect(alvoNoEnvelope(finding), `${finding.where} | ${finding.problem}`).toBe(true);
    }
    expect(alvoNoEnvelope({ where: "Goal e critério da tarefa de exclusão", problem: "Prescrevem que a execução dos testes crie e destrua o banco e enumeram comportamentos que a suíte deve demonstrar", fix: "Remova a mecânica de criação e destruição e a lista de cobertura; mantenha apenas o requisito de que os testes automatizados usem banco descartável, isolado dos dados normais" })).toBe(true);
    expect(alvoNoEnvelope({ where: "Phase 3 · Depends on", problem: "A fase consome o roteador que só a fase 4 entrega", fix: "Faça a fase 3 depender da fase 4" })).toBe(true);
    expect(alvoNoEnvelope({ where: "`Goal`", problem: GOAL_P2[0]!.problem, fix: GOAL_P2[0]!.fix })).toBe(true);
    expect(alvoNoEnvelope({ where: "Descrição da fase", problem: GOAL_P2[0]!.problem, fix: GOAL_P2[0]!.fix })).toBe(true);
    // A correção que citava a frase chega já trocada pela da regra (I-16), que fala em "critério de uma task": continua sendo do envelope.
    const original = "Remova do Goal a frase \"a execução automatizada dos testes e dos fluxos cria e destrói o banco descartável\" e mantenha o isolamento.";
    const trocada = `${testPrescriptionHint(["a execução automatizada dos testes e dos fluxos cria"])} (a correção que o auditor propôs — "${original}" — prescrevia teste e foi substituída pela regra I-16)`;
    expect(alvoNoEnvelope({ where: "Goal", problem: GOAL_P2[0]!.problem, fix: trocada })).toBe(true);
    for (const finding of [
      { where: "P2.T8.C3", problem: "O critério prescreve quais comportamentos a suíte automatizada deve demonstrar", fix: "Remova a lista de comportamentos" },
      { where: "Critério da tarefa de exclusão", problem: "O critério prescreve quais comportamentos a suíte automatizada deve demonstrar", fix: "Remova a lista" },
      { where: "Tarefa 1", problem: "O roteador é registrado sob /api/tarefas, mas a tarefa também manda definir GET /api/tarefas", fix: "Defina as rotas relativamente ao prefixo" },
      { where: "Task 8 — Acceptance criteria", problem: "O critério exige que os fluxos usem banco isolado", fix: "Remova “e os fluxos de anotações”" },
      // O goal promete; falta a task que entrega: é a fase que se corrige, não o envelope.
      { where: "Goal / Task de integração do banco", problem: "O objetivo menciona que fluxos automatizados criam e destroem o banco descartável, mas nenhuma tarefa exige a entrega desse mecanismo", fix: "Inclua nesta fase uma tarefa com critérios que exijam fluxos automatizados da aplicação integrada" },
      { where: "P2.T1.C1 vs P2.T3.C2", problem: "C1 exige status e C2 dispensa; as descrições das tarefas divergem", fix: "Preserve o contrato" },
      { where: "Phase 2 · linha 12", problem: "I-08: x", fix: "y", mechanical: true },
      // Contradição entre critérios de duas fases, ainda que fale em "goal": é das tasks, e pode ser decisão de produto.
      { where: "Phase 2 vs Phase 3", problem: "O goal da fase 2 e o da fase 3 tratam a exclusão de forma diferente: P2.T1.C2 exige confirmação e P3.T1.C2 exclui sem confirmação", fix: "Alinhe as duas fases" },
    ]) {
      expect(alvoNoEnvelope(finding), `${finding.where} | ${finding.problem}`).toBe(false);
    }
  });
});

describe("o mesmo defeito com outras palavras", () => {
  it("6. as leituras reais do Goal da fase 2 têm a mesma chave de envelope, embora o vocabulário as separe", () => {
    const comFase = GOAL_P2.map((finding) => ({ ...finding, phase: 2 }));
    // A identidade por vocabulário (§122) não as reconhece: é por isso que voltavam como pontos novos.
    expect(mesmoPonto(comFase[0]!, comFase[1]!)).not.toBe("sim");
    for (const finding of comFase) expect(chavesDoEnvelope(finding, 5)).toEqual(["P2·goal"]);
    expect(chavesDoEnvelope(COERENCIA_DESCRICOES, 5)).toEqual(["P2·goal", "P3·goal", "P4·goal", "P5·goal"]);
    expect(chavesDoEnvelope({ ...GOAL_P4, phase: 4 }, 5)).toEqual(["P4·goal"]);
    // Com a assinatura do envelope na mesa: o mesmo goal, a mesma chave; outro goal, outra chave.
    expect(chavesDoEnvelope(comFase[0]!, 5, () => "aaaa")).toEqual(["P2·goal·aaaa"]);
    expect(chavesDoEnvelope(comFase[1]!, 5, () => "aaaa")).toEqual(chavesDoEnvelope(comFase[0]!, 5, () => "aaaa"));
    expect(chavesDoEnvelope(comFase[1]!, 5, () => "bbbb")).not.toEqual(chavesDoEnvelope(comFase[0]!, 5, () => "aaaa"));
    // E o que é da task não ganha chave nenhuma.
    expect(chavesDoEnvelope({ where: "P2.T8.C3", problem: "x", fix: "y", phase: 2 }, 5)).toEqual([]);
  });
});

describe("INIT: o esqueleto publicado", () => {
  it("2, 1. não ganha o procedimento da execução de teste que o pedido não fixou; o banco isolado continua no produto", async () => {
    const { outcome } = await init();
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const md = await publicado("skeleton.md");
    const regrasPublicadas = regras(md);
    expect(regrasPublicadas).not.toMatch(PROCEDIMENTO);
    expect(testRunPrescriptions(regrasPublicadas, [PEDIDO])).toEqual([]);
    expect(testToolPrescriptions(regrasPublicadas, [PEDIDO])).toEqual([]);
    // O requisito do pedido, nas palavras do escritor, e o isolamento que a regra do harness garante.
    expect(regrasPublicadas).toContain(REGRA_DO_ESCRITOR);
    expect(regrasPublicadas).toContain("nenhum teste lê, escreve ou migra");
    expect(regrasPublicadas).toContain(US_2_2);
  });
});

describe("PLAN: a arquitetura e as auditorias com a mesma autoridade", () => {
  it("3, 12. a decisão técnica legítima do plano — DATABASE_PATH do lado da aplicação — passa e é publicada; o caminho limpo não ganha chamada", async () => {
    await init();
    const { run, agent, perguntadas } = await plan({});
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const arquiteturaPublicada = await publicado("architecture.md");
    expect(arquiteturaPublicada).toContain(CONTRATO_DA_APLICACAO);
    expect(arquiteturaPublicada).toContain("Usar DATABASE_PATH como única variável de ambiente");
    expect(perguntadas).toEqual([]);
    // Arquiteto, leitura da arquitetura, três fases e UMA auditoria do plano inteiro (etapa 2 da redução):
    // eram três leituras de fase, a coerência e três lotes de ensaio. As fases são escritas em paralelo: conta o conjunto.
    expect(agent.calls.map((call) => `${call.role}:${call.stage}:${call.subject}`).sort()).toEqual([
      "writer:authoring:architecture",
      "auditor:audit:architecture",
      "writer:authoring:phase-p01",
      "writer:authoring:phase-p02",
      "writer:authoring:phase-p03",
      "auditor:audit:project-phases.md",
    ].sort());
  });

  it("4. o goal de fase com o procedimento da execução volta ao arquiteto, e não chega ao esqueleto nem à arquitetura publicados", async () => {
    await init();
    let desenhos = 0;
    const { run, agent, perguntadas } = await plan({ arquiteto: () => ((desenhos += 1) === 1 ? arquitetura("contaminada") : arquitetura("limpa")) });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const chamadas = arquitetos(agent);
    expect(chamadas).toHaveLength(2);
    // O que voltou foi nomeado: a fase, o componente e a decisão de dados, com a correção que preserva o isolamento.
    expect(chamadas[1]?.prompt).toContain("a fase 2 prescreve teste");
    expect(chamadas[1]?.prompt).toContain("o componente modulo-tarefas prescreve teste");
    expect(chamadas[1]?.prompt).toContain('a decisão de dados "banco descartável" prescreve teste');
    expect(chamadas[1]?.prompt).toContain("a infraestrutura (requisitos de ambiente) prescreve teste");
    expect(await goalsPublicados()).not.toMatch(PROCEDIMENTO);
    expect(await publicado("architecture.md")).not.toMatch(PROCEDIMENTO);
    expect(await publicado("architecture.md")).toContain(CONTRATO_DA_APLICACAO);
    expect(perguntadas).toEqual([]);
  });

  it("5. o auditor da arquitetura que manda atribuir a criação e a destruição à execução dos testes, e o de fase que manda acrescentá-la, não devolvem nada: teste não é motivo de devolução (§129)", async () => {
    await init();
    let leituras = 0;
    let leiturasP3 = 0;
    const { run, agent, perguntadas, anunciado } = await plan({
      auditorDaArquitetura: () => ((leituras += 1) === 1 ? ACHADO_DA_ARQUITETURA : approve()),
      p3: () => ((leiturasP3 += 1) === 1 ? ACHADO_P3_ACRESCENTE : approve()),
    });
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    // Até a §128 os dois voltavam com a correção da regra (I-16); desde a §129 os dois pediam teste, e saem.
    expect(anunciado()).toContain("pediam ou julgavam teste");
    expect(arquitetos(agent)).toHaveLength(1);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p03" })).toHaveLength(1);
    expect(agent.calls.some((call) => call.prompt.includes(`what to do: ${FIX_DA_ARQUITETURA}`))).toBe(false);
    // E a mesma frase é julgada igual nos três documentos.
    const autoridade = [PEDIDO];
    expect(testPrescriptions(REAL.goal2, autoridade)).not.toEqual([]);
    const lida = parseArchitecture(arquitetura("contaminada"), JSON.parse(ESQUELETO), { maxTasksPerPhase: 15, authority: autoridade });
    expect(lida.ok).toBe(false);
    expect(testPrescriptions(["Em `src/modulos/tarefas/`, implementar o CRUD de tarefas", REAL.contrato].join("\n"), autoridade)).not.toEqual([]);
    expect(await publicado("architecture.md")).not.toMatch(PROCEDIMENTO);
    expect(perguntadas).toEqual([]);
  });

  it("11. o pedido que fixa o procedimento o mantém: a arquitetura que o escreve passa sem emenda", async () => {
    await init(requestComProcedimento);
    const { run, agent } = await plan({ arquiteto: () => arquitetura("contaminada") }, {}, requestComProcedimento);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(arquitetos(agent)).toHaveLength(1);
    expect(await goalsPublicados()).toContain(REAL.goal2);
  });
});


describe("retomada: a arquitetura guardada passa pelo contrato de hoje", () => {
  it("revisão 7, 10. a arquitetura aprovada antes, com o procedimento no goal, não é reaproveitada: é desenhada de novo", async () => {
    const { outcome: doInit } = await init();
    expect((await (await plan({})).run).readiness.ready).toBe(true);

    // O que uma versão anterior teria aprovado e gravado: o mesmo esqueleto e a mesma autoridade, o procedimento no goal.
    const caminho = join(projectRoot, ".capivara/handoffs", `${doInit.runId}.architecture-state.json`);
    const estado = JSON.parse(await readFile(caminho, "utf8")) as Record<string, unknown>;
    const antiga = parseArchitecture(arquitetura("contaminada"), JSON.parse(ESQUELETO), { maxTasksPerPhase: 15, authority: [PEDIDO_COM_PROCEDIMENTO] });
    if (!antiga.ok) throw new Error(antiga.defects.map((defeito) => defeito.problem).join("; "));
    await writeFile(caminho, `${JSON.stringify({ ...estado, architecture: antiga.architecture }, null, 2)}\n`);

    const segundo = await plan({});
    const outcome = await segundo.run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(segundo.anunciado()).toContain("não passa no contrato atual");
    // Desenhada de novo pelo caminho de sempre — e o desenho válido deste mesmo prompt já estava no cache: zero chamadas.
    expect(segundo.anunciado()).toContain("arquitetura reaproveitada do cache");
    expect(segundo.anunciado()).not.toContain("arquitetura reaproveitada de uma execução anterior");
    expect(await publicado("architecture.md")).not.toMatch(PROCEDIMENTO);
    expect(await goalsPublicados()).not.toMatch(PROCEDIMENTO);
  });
});

describe("retomada: o esqueleto de uma versão anterior", () => {
  it("10. a regra de banco anterior à §126 é diagnosticada com a rota de recuperação; como o plano não a lê (§129), nada aprovado sobre o esqueleto anterior precisa ser refeito", async () => {
    const { outcome: doInit } = await init();
    const primeiro = await plan({});
    expect((await primeiro.run).readiness.ready).toBe(true);

    // O que a 0.7.0 gravou: a mesma decisão, a regra com o procedimento.
    const estado = join(projectRoot, ".capivara/handoffs", `${doInit.runId}.skeleton-state.json`);
    const esqueleto = JSON.parse(await readFile(estado, "utf8")) as { rules: { subject: string; statement: string }[] };
    esqueleto.rules = esqueleto.rules.map((regra) => regra.subject !== "banco dos testes" ? regra : {
      ...regra,
      statement: "a suíte automatizada e os fluxos rodam contra um banco descartável, criado e destruído pela própria execução dos testes; nenhum teste lê, escreve ou migra o banco configurado no `.env` do desenvolvedor",
    });
    await writeFile(estado, `${JSON.stringify(esqueleto, null, 2)}\n`);

    const segundo = await plan({});
    const outcome = await segundo.run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(segundo.anunciado()).toContain("banco dos testes");
    expect(segundo.anunciado()).toContain("capivara init");
    expect(outcome.report.remarks.some((entrada) => entrada.document === "skeleton.md" && entrada.remark.observation.includes("capivara init"))).toBe(true);
    // A regra que mudou é a do banco dos testes, que o plano não lê (§129): o prompt do arquiteto, a fatia
    // da fase e a auditoria são os mesmos, e o que foi aprovado contra eles vale — zero chamadas. Até a §128
    // a regra chegava ao plano, e o esqueleto mudado refazia arquitetura e fases.
    expect(segundo.anunciado()).toContain("arquitetura reaproveitada do cache: o prompt não mudou");
    expect(arquitetos(segundo.agent)).toHaveLength(0);
    expect(por(segundo.agent, { stage: "audit", subject: "architecture" })).toHaveLength(0);
    expect(por(segundo.agent, { stage: "audit", subject: "project-phases.md#P1" })).toHaveLength(0);
  });
});

describe("no esqueleto, o procedimento segue o destino do mecanismo (§123): volta nomeado e nunca bloqueia", () => {
  it("a regra que só descreve o procedimento volta ao escritor; tolerada, é publicada com o resíduo; a ferramenta continua bloqueando", () => {
    const comProcedimento = JSON.stringify({
      ...JSON.parse(ESQUELETO),
      rules: [...JSON.parse(ESQUELETO).rules, { subject: "banco.testes", statement: "Os testes automatizados criam um banco temporário próprio e o apagam ao terminar." }],
    });
    const rejeitado = parseSkeleton(comProcedimento, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(rejeitado.ok).toBe(false);
    if (!rejeitado.ok) expect(rejeitado.defects.map((defeito) => defeito.problem).join("\n")).toContain('a regra "banco.testes" prescreve o procedimento da execução de teste');
    const tolerado = parseSkeleton(comProcedimento, { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" });
    expect(tolerado.ok).toBe(true);
    if (tolerado.ok) expect(tolerado.tolerated.join("\n")).toContain("procedimento da execução de teste");
    // A ferramenta não é tolerada: I-16 como a §118 a deixou.
    const comFerramenta = JSON.stringify({
      ...JSON.parse(ESQUELETO),
      rules: [...JSON.parse(ESQUELETO).rules, { subject: "testes", statement: "A suíte usa Vitest e Playwright." }],
    });
    expect(parseSkeleton(comFerramenta, { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" }).ok).toBe(false);
  });
});

describe("o esqueleto do escritor passa pelo contrato como estava", () => {
  it("a resposta real reduzida: a regra de testes fica, é o lugar do pedido; a story de testes volta nomeada (§129)", () => {
    const rejeitado = parseSkeleton(ESQUELETO_DO_RUN, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(rejeitado.ok).toBe(false);
    if (!rejeitado.ok) {
      const problemas = rejeitado.defects.map((d) => d.problem).join("; ");
      expect(problemas).toContain("a story US-2.2 carrega o pedido de testes para o plano");
      expect(problemas).not.toContain('a regra "testes automatizados"');
    }
    const tolerado = parseSkeleton(ESQUELETO_DO_RUN, { maxTasksPerPhase: 15, authority: [PEDIDO], mechanisms: "tolerate" });
    expect(tolerado.ok).toBe(true);
    if (tolerado.ok) {
      expect(tolerado.skeleton.rules.find((regra) => regra.subject === "testes automatizados")?.statement).toBe(REGRA_DO_ESCRITOR);
      expect(tolerado.tolerated.join("\n")).toContain("a story US-2.2 carrega o pedido de testes para o plano");
    }
    // Como o escritor da §129 o devolve: válido, sem defeito nem conserto.
    const limpo = parseSkeleton(ESQUELETO, { maxTasksPerPhase: 15, authority: [PEDIDO] });
    expect(limpo.ok, limpo.ok ? "" : limpo.defects.map((d) => d.problem).join("; ")).toBe(true);
    if (limpo.ok) expect(limpo.applied).toEqual([]);
  });
});
