/**
 * O conflito técnico não vai ao desenvolvedor (§119).
 *
 * No `teste_openrouter3` (0.6.1) a auditoria da arquitetura parou num impasse
 * "após 1 devoluções": as fases 3, 4 e 5 editariam arquivos compartilhados
 * (`server/index.ts`, o roteador da interface) sem ponto de extensão, o
 * auditor exigia um mecanismo de registro, e o harness perguntou ao
 * desenvolvedor — que não tem o que decidir ali. Duas causas em código: o
 * orçamento das devoluções era o contador das reorganizações do plano, já
 * gasto; e nada representava "fases sem ordem que estendem o mesmo
 * componente", então o auditor julgava um mecanismo em vez de uma propriedade.
 *
 * O que se prova aqui: o parser serializa, por `dependsOn`, as fases sem ordem
 * que estendem o mesmo componente; ponto de extensão e fase de integração
 * passam sem mudança; a auditoria da arquitetura tem orçamento próprio, troca
 * de estratégia antes de desistir, e nunca chama o desenvolvedor; uma decisão
 * genuína de produto continua chegando a ele; e o conflito que não se resolve
 * para o run com diagnóstico, sem publicar.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArchitecture, parseSkeleton, phasesFromArchitecture } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { readSkeletonState, runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { dependenciasEfetivas } from "../../src/loop/escalonador.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_1, PHASE_2, SKELETON, approve, fakeAgent, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

/** O achado real do auditor, como veio no impasse. */
const ACHADO_REAL = [
  "CAPIVARA_AUDIT_STATUS: REJECTED",
  "CAPIVARA_FINDING: components · api-core, web-shell | As fases 3 e 4 são independentes, mas os contratos não definem como cada módulo registra suas rotas REST e de interface sem alterar arquivos compartilhados. api-core inclui server/index.ts no registro de rotas; web-shell define o mapeamento de rotas, mas não prevê pontos de extensão para páginas ainda não entregues. | Definir na fundação mecanismos de registro que permitam aos módulos conectar suas rotas REST e páginas usando apenas arquivos próprios, sem alterações simultâneas nos arquivos compartilhados",
  "CAPIVARA_REASON: as fases independentes editariam server/index.ts e o roteador ao mesmo tempo",
].join("\n");

const base = JSON.parse(ARCHITECTURE) as { components: unknown[]; infrastructure: unknown; dataDecisions: unknown[] };

/** A forma do caso real: fundação compartilhada e dois módulos que a estendem. */
const COMPONENTES = [
  { name: "dados", responsibility: "migrações e acesso às tabelas", areas: ["dados"], dependsOn: [], contracts: ["módulo db: query(sql, params) → linhas"], files: ["src/db.ts"], owns: ["statuses", "reservations"] },
  { name: "api-core", responsibility: "servidor HTTP compartilhado e registro de rotas", areas: ["backend"], dependsOn: ["dados"], contracts: ["server/index.ts monta os routers dos módulos"], files: ["server/index.ts"], owns: [] },
  { name: "web-shell", responsibility: "shell da interface e mapeamento de rotas", areas: ["frontend"], dependsOn: [], contracts: ["web/router.tsx mapeia /reservas e /relatorios"], files: ["web/router.tsx"], owns: [] },
  { name: "modulo-reservas", responsibility: "rotas e páginas de reservas", areas: ["backend", "frontend"], dependsOn: ["api-core", "web-shell", "dados"], contracts: ["POST /reservas → 201 {id}"], files: ["src/modules/reservas/"], owns: [] },
  { name: "modulo-relatorios", responsibility: "relatório de ocupação", areas: ["backend", "frontend"], dependsOn: ["api-core", "web-shell", "dados"], contracts: ["GET /relatorios/ocupacao → 200 {dias}"], files: ["src/modules/relatorios/"], owns: [] },
];

const fases = (modulos: { reservas: string[]; relatorios: string[] }, integracao = false) => [
  { number: 1, title: "Fundação de dados", goal: "migrations e seeds existem", dependsOn: "none", covers: ["statuses", "reservations"], areas: ["dados"], components: ["dados"], taskCount: 2, rationale: "tudo depende das tabelas" },
  { number: 2, title: "Núcleo HTTP e shell", goal: "servidor e shell sobem", dependsOn: "Phase 1", covers: ["workflow 1"], areas: ["backend", "frontend"], components: ["api-core", "web-shell"], taskCount: 2, rationale: "o que os módulos consomem" },
  { number: 3, title: "Módulo Reservas", goal: "o hóspede cria uma reserva", dependsOn: "Phase 2", covers: ["US-1.1", "workflow 1"], areas: ["backend", "frontend"], components: modulos.reservas, taskCount: 2, rationale: "" },
  { number: 4, title: "Módulo Relatórios", goal: "o relatório lista reservas", dependsOn: "Phase 2", covers: ["reservations"], areas: ["backend", "frontend"], components: modulos.relatorios, taskCount: 1, rationale: "" },
  ...(integracao
    ? [{ number: 5, title: "Integração", goal: "rotas e páginas registradas", dependsOn: "Phase 3, Phase 4", covers: ["workflow 1"], areas: ["backend", "frontend"], components: ["api-core", "web-shell"], taskCount: 1, rationale: "só ela toca o compartilhado" }]
    : []),
];

const arquitetura = (phases: unknown[]) => JSON.stringify({
  ...base,
  overview: "Fundação compartilhada e módulos independentes.",
  components: COMPONENTES,
  flows: [{ workflow: "1", components: ["modulo-reservas", "api-core", "dados"], notes: "" }],
  phases,
  mvpCutPhase: phases.length,
});

/** Os módulos registram-se nos arquivos compartilhados e DECLARAM isso: o harness os ordena. */
const ARQ_COMPARTILHADO_DECLARADO = arquitetura(fases({ reservas: ["modulo-reservas", "api-core", "web-shell"], relatorios: ["modulo-relatorios", "api-core", "web-shell"] }));
/** Ponto de extensão na fundação: cada módulo só nos seus componentes, paralelos. */
const ARQ_PONTO_DE_EXTENSAO = arquitetura(fases({ reservas: ["modulo-reservas"], relatorios: ["modulo-relatorios"] }));
/** Fase de integração que depende dos módulos e é a única a tocar o compartilhado. */
const ARQ_INTEGRACAO = arquitetura(fases({ reservas: ["modulo-reservas"], relatorios: ["modulo-relatorios"] }, true));

const esqueleto = (): Skeleton => {
  const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
  if (!lido.ok) throw new Error("fixture inválida");
  return lido.skeleton;
};

const lerArquitetura = (json: string) => {
  const lida = parseArchitecture(json, esqueleto(), { maxTasksPerPhase: 15 });
  if (!lida.ok) throw new Error(JSON.stringify(lida.defects));
  return lida;
};

describe("1–4. as três resoluções do conflito de arquivos compartilhados passam no contrato", () => {
  it("serialização: fases sem ordem que estendem o mesmo componente ganham a ordem em dependsOn, e o build a lê", () => {
    const lida = lerArquitetura(ARQ_COMPARTILHADO_DECLARADO);
    expect(lida.architecture.phases[3]?.dependsOn).toBe("Phase 2, Phase 3");
    expect(lida.architecture.phases[2]?.dependsOn).toBe("Phase 2");
    expect(lida.applied.join("\n")).toContain('serializou a fase 4 depois da fase 3: as duas estendem "api-core", "web-shell"');
    // O escalonador do build respeita exatamente o que o plano representa.
    const agendaveis = phasesFromArchitecture(lida.architecture).map((fase) => ({
      id: `p${fase.number}`, number: fase.number,
      dependsOn: [...fase.dependsOn.matchAll(/\d+/g)].map((m) => Number(m[0])),
    }));
    expect(dependenciasEfetivas(agendaveis[3]!, agendaveis).numeros).toEqual([1, 2, 3]);
    expect(dependenciasEfetivas(agendaveis[2]!, agendaveis).numeros).toEqual([1, 2]);
  });

  it("ponto de extensão: módulos só nos seus componentes seguem paralelos, sem conserto", () => {
    const lida = lerArquitetura(ARQ_PONTO_DE_EXTENSAO);
    expect(lida.architecture.phases.map((fase) => fase.dependsOn)).toEqual(["none", "Phase 1", "Phase 2", "Phase 2"]);
    expect(lida.applied.some((nota) => nota.includes("serializou"))).toBe(false);
  });

  it("fase de integração: a única a tocar o compartilhado, depois dos módulos, sem conserto", () => {
    const lida = lerArquitetura(ARQ_INTEGRACAO);
    expect(lida.architecture.phases[4]?.dependsOn).toBe("Phase 3, Phase 4");
    expect(lida.applied.some((nota) => nota.includes("serializou"))).toBe(false);
  });

  it("a ordem só é acrescentada quando falta: uma fase que já alcança a outra pela cadeia não muda", () => {
    const encadeada = arquitetura([
      ...fases({ reservas: ["modulo-reservas", "api-core"], relatorios: ["modulo-relatorios", "api-core"] }).slice(0, 3),
      { number: 4, title: "Módulo Relatórios", goal: "o relatório lista reservas", dependsOn: "Phase 3", covers: ["reservations"], areas: ["backend"], components: ["modulo-relatorios", "api-core"], taskCount: 1, rationale: "" },
    ]);
    const lida = lerArquitetura(encadeada);
    expect(lida.architecture.phases[3]?.dependsOn).toBe("Phase 3");
    expect(lida.applied.some((nota) => nota.includes("serializou"))).toBe(false);
  });
});

describe("no orquestrador, com o provider falso", () => {
  let projectRoot = "";
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-119-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const request = { text: "uma pousada com reservas e relatórios, módulos independentes", origin: "text" as const, path: null, sha12: "abc123abc123" };
  const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
  const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
    agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

  const TASKS_NUCLEO = ["- [ ] **Task:** Subir o servidor HTTP e o shell da interface", "  - **Acceptance criteria:**", "    - GET / responde 200 com o shell", "  - **Traces:** workflow 1"].join("\n");
  const TASKS_RELATORIOS = ["- [ ] **Task:** Listar a ocupação a partir de reservations", "  - **Acceptance criteria:**", "    - GET /relatorios/ocupacao responde 200 com um dia por reserva", "  - **Traces:** reservations"].join("\n");
  const TASKS_INTEGRACAO = ["- [ ] **Task:** Registrar as rotas e páginas dos módulos no núcleo", "  - **Acceptance criteria:**", "    - POST /reservas e GET /relatorios/ocupacao respondem pelo servidor compartilhado", "  - **Traces:** workflow 1"].join("\n");

  /** O roteiro do plan sobre a arquitetura modular: escritores por fase, auditores genéricos aprovando. */
  const roteiro = (arquiteto: (call: AgentCall) => string, auditorDaArquitetura: (call: AgentCall) => string): ScriptStep[] => [
    { match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: auditorDaArquitetura }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquiteto }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: PHASE_1 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: TASKS_NUCLEO }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p03" }, respond: { stdout: PHASE_2.replace("## Phase 2: Criar reserva", "## Phase 3: Módulo Reservas").replace("**Depends on:** Phase 1", "**Depends on:** Phase 2") }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p04" }, respond: { stdout: TASKS_RELATORIOS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p05" }, respond: { stdout: TASKS_INTEGRACAO }, repeat: true },
    ...skeletonPath().filter((passo) => !(passo.match.subject === "architecture" || passo.match.subject?.startsWith("phase-"))),
  ];

  async function plan(steps: ScriptStep[], extras: Partial<Parameters<typeof runPlan>[0]> = {}) {
    const agentInit = fakeAgent(skeletonPath());
    await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: agentInit.call, ask: responde, announce: () => undefined });
    const dito: string[] = [];
    const perguntadas: Question[] = [];
    const agent = fakeAgent(steps);
    const run = runPlan({
      projectRoot, request, language: "português do Brasil", call: agent.call,
      ask: async (question) => { perguntadas.push(question); return "1"; },
      announce: (linha) => void dito.push(linha), sleep: async () => undefined,
      ...extras,
    });
    return { run, agent, perguntadas, anunciado: () => dito.join("\n") };
  }

  it("5, 8, 11. o achado real é resolvido pelo arquiteto por serialização, sem pergunta, sem chamada a mais, até RALPH READY", async () => {
    let desenhos = 0;
    let auditorias = 0;
    const { run, agent, perguntadas, anunciado } = await plan(roteiro(
      () => ((desenhos += 1) === 1 ? ARQ_PONTO_DE_EXTENSAO : ARQ_COMPARTILHADO_DECLARADO),
      () => ((auditorias += 1) === 1 ? ACHADO_REAL : approve()),
    ));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·") || pergunta.topic.startsWith("impasse"))).toEqual([]);
    // Uma devolução, uma correção: nada repetido.
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(2);
    // O diagnóstico do auditor chegou inteiro ao arquiteto, com as três saídas válidas.
    const segundo = por(agent, { role: "writer", stage: "authoring", subject: "architecture" })[1]?.prompt ?? "";
    expect(segundo).toContain("Definir na fundação mecanismos de registro");
    expect(segundo).toContain("## Work that runs at the same time");
    expect(segundo).toContain("## Your previous architecture");
    // A serialização foi aplicada em código e publicada no que o build lê.
    expect(anunciado()).toContain("serializou a fase 4 depois da fase 3");
    const esqueletoPublicado = await readSkeletonState(projectRoot, outcome.runId);
    expect(esqueletoPublicado?.phases.map((fase) => fase.dependsOn)).toEqual(["none", "Phase 1", "Phase 2", "Phase 2, Phase 3"]);
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).toContain("**Depends on:** Phase 2, Phase 3");
  });

  it("7. a reorganização pedida pelo plano não consome as devoluções da auditoria da arquitetura", async () => {
    let coerencias = 0;
    let auditorias = 0;
    // Dois achados DIFERENTES: o mesmo achado repetido é o levantamento do plano, outro assunto.
    // Classe e duas passagens existentes: a devolução que o Core deixa passar (etapa 2).
    const devolucaoDoPlano = (ponto: string) => reject("Architecture", ponto, "mova a integração para depois dos módulos");
    // Cada desenho é diferente do anterior: a emenda que não muda o texto é outro caso, abaixo.
    // (Um desenho já aprovado voltaria do cache sem auditoria: o terceiro é inédito de propósito.)
    const desenhos = [ARQ_PONTO_DE_EXTENSAO, ARQ_INTEGRACAO, ARQ_INTEGRACAO.replace("só ela toca o compartilhado", "integração ao final"), ARQ_COMPARTILHADO_DECLARADO];
    let desenho = 0;
    const passos: ScriptStep[] = [
      // O plano pede UMA reorganização — é a emenda que o orçamento tem (etapa 2).
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: () => ((coerencias += 1) === 1 ? devolucaoDoPlano("a fase 4 lista relatório sem que o núcleo exponha a rota") : approve()) }, repeat: true },
      // A segunda arquitetura (a reorganização) é devolvida uma vez pelo seu auditor, e depois aprovada: o orçamento dela está intacto.
      ...roteiro(() => desenhos[Math.min(desenho++, desenhos.length - 1)]!, () => ((auditorias += 1) === 2 ? ACHADO_REAL : approve())),
    ];
    const { run, perguntadas, anunciado } = await plan(passos);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(auditorias, anunciado()).toBe(3);
  });

  it("7b. o arquiteto que devolve a mesma arquitetura recebe a mudança de estratégia antes de qualquer arbitragem", async () => {
    let coerencias = 0;
    const devolucao = reject("Architecture", "as fases 3 e 4 editam server/index.ts sem ordem entre si", "ordene-as ou integre depois");
    const passos: ScriptStep[] = [
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, respond: { stdout: () => ((coerencias += 1) === 1 ? devolucao : approve()) }, repeat: true },
      ...roteiro((call) => (call.prompt.includes("## Change of strategy") ? ARQ_COMPARTILHADO_DECLARADO : ARQ_PONTO_DE_EXTENSAO), () => approve()),
    ];
    const { run, agent, perguntadas, anunciado } = await plan(passos);
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(anunciado()).toContain("o arquiteto devolveu a mesma arquitetura; trocando a estratégia");
    expect(por(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(3);
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).toContain("**Depends on:** Phase 2, Phase 3");
  });

  it("6. uma decisão genuína de produto levantada na auditoria da arquitetura chega ao desenvolvedor", async () => {
    let auditorias = 0;
    const decisao = `${approve()}\nCAPIVARA_DECISION: components · modulo-reservas | A reserva nova nasce pendente ou confirmada? | Pendente, até o pagamento | Confirmada no ato`;
    const { run, perguntadas } = await plan(roteiro(() => ARQ_PONTO_DE_EXTENSAO, () => ((auditorias += 1) === 1 ? decisao : approve())));
    const outcome = await run;
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const daAuditoria = perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"));
    expect(daAuditoria).toHaveLength(1);
    expect(daAuditoria[0]?.decision).toContain("pendente ou confirmada");
  });

  it("10. o conflito que o auditor não dá por resolvido para o run com diagnóstico: sem pergunta, sem publicar", async () => {
    const { run, agent, perguntadas } = await plan(roteiro(() => ARQ_PONTO_DE_EXTENSAO, () => ACHADO_REAL), { maxAuditReturns: 1 });
    await expect(run).rejects.toThrow(/A auditoria de architecture.md não convergiu depois de 4 devolução\(ões\)/);
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    // Teto 1 sem progresso: a primeira devolução já o esgota; uma mudança de estratégia; dois reparos pelo
    // auditor validados pelo verifier (§121); e para, com o diagnóstico das estratégias tentadas.
    const desenhos = por(agent, { role: "writer", stage: "authoring", subject: "architecture" });
    expect(desenhos).toHaveLength(2);
    expect(desenhos[1]?.prompt).toContain("## Change of strategy: resolve by order, not by mechanism");
    expect(por(agent, { role: "auditor", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "auditor", stage: "audit", subject: "architecture" })).toHaveLength(2);
    expect(por(agent, { role: "verifier", stage: "audit", subject: "architecture" })).toHaveLength(2);
    await expect(run).rejects.toThrow(/Estratégias tentadas, nesta ordem:/);
    await expect(readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).rejects.toThrow();
  });
});
