/**
 * As regressões da reformulação do INIT e do PLAN (§116).
 *
 * Nove propriedades, cada uma pedida pelo proprietário e provada aqui contra o
 * provider falso: o que sobrevive a uma falha, o que é corrigido sem repagar, o
 * que nunca é aprovado por cansaço, e o que o build continua lendo igual.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, readArchitectureState, readSkeletonState, runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO, readHandoff } from "../../src/interview/index.js";
import { checkStamp, parsePhases, workflowsForPhase } from "../../src/contract/index.js";
import { readEnvironmentPlan } from "../../src/loop/environment-plan.js";
import { preflight, splitPhases } from "../../src/loop/index.js";
import { runIdFor } from "../../src/state/index.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_1, PHASE_2, SKELETON, approve, architectureStep, fakeAgent, oneQuestion, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-116-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };
const runId = runIdFor("init", request.sha12);

type Perguntar = (question: Question, index: number, total: number) => Promise<string>;
const responde: Perguntar = async (question) => (question.id === ID_DO_BANCO ? "1" : "1");

async function init(steps: ScriptStep[], extras: { ask?: Perguntar; fresh?: boolean } = {}) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  const outcome = await runInit({
    projectRoot, request, language: "português do Brasil", stage: "init", call: agent.call,
    ask: extras.ask ?? responde, announce: (linha) => void dito.push(linha), ...(extras.fresh ? { fresh: true } : {}),
  });
  return { outcome, agent, anunciado: dito.join("\n") };
}

async function plan(steps: ScriptStep[], extras: Partial<Parameters<typeof runPlan>[0]> = {}) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  const outcome = await runPlan({
    projectRoot, request, language: "português do Brasil", call: agent.call, ask: responde,
    announce: (linha) => void dito.push(linha), sleep: async () => undefined, ...extras,
  });
  return { outcome, agent, anunciado: dito.join("\n") };
}

const chamadas = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
  agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

/** Uma arquitetura que DIVIDE a fase 1 do init em duas: três fases, mesma cobertura. */
const ARQUITETURA_DIVIDIDA = JSON.stringify({
  ...JSON.parse(ARCHITECTURE),
  phases: [
    { number: 1, title: "Tabela de status", goal: "statuses existe", dependsOn: "none", covers: ["statuses"], areas: ["dados"], components: ["dados"], taskCount: 1, rationale: "menor e sem dependência" },
    { number: 2, title: "Tabela de reservas", goal: "reservations existe", dependsOn: "Phase 1", covers: ["reservations"], areas: ["dados"], components: ["dados"], taskCount: 1, rationale: "depende da anterior" },
    { number: 3, title: "Criar reserva", goal: "o hóspede cria uma reserva", dependsOn: "Phase 2", covers: ["US-1.1", "workflow 1"], areas: ["backend"], components: ["api"], taskCount: 2, rationale: "" },
  ],
  mvpCutPhase: 3,
});

const TASKS_STATUSES = [
  "- [ ] **Task:** Criar a migration de statuses e semear as três linhas",
  "  - **Acceptance criteria:**",
  "    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada",
  "  - **Traces:** statuses",
].join("\n");

const TASKS_RESERVATIONS = [
  "- [ ] **Task:** Criar a migration de reservations com a chave estrangeira",
  "  - **Acceptance criteria:**",
  "    - A tabela reservations existe com status_id referenciando statuses",
  "  - **Traces:** reservations",
].join("\n");

describe("1. o init preserva decisões e documentos válidos depois de uma falha recuperável", () => {
  it("retomado depois de o provider cair no esqueleto, não repergunta nada e escreve o esqueleto uma vez", async () => {
    // Primeira execução: uma pergunta respondida, e o escritor do esqueleto
    // declara erro do motor sem escrever nada — duas vezes.
    const passos = skeletonPath().filter((passo) => passo.match.subject !== "skeleton" || passo.match.stage !== "authoring");
    passos.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    passos.push({ match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: "", exitCode: 1 }, repeat: true });
    const perguntas: string[] = [];
    await expect(init(passos, { ask: async (question) => { perguntas.push(question.id); return "1"; } })).rejects.toThrow(InitBlockedError);
    expect(perguntas).toContain("Q-01");

    const handoff = await readHandoff(projectRoot, runId, "skeleton");
    expect(handoff?.answers.some((answer) => answer.questionId === "Q-01" && answer.disposition === "ACCEPTED")).toBe(true);

    // Segunda execução: nenhuma pergunta, nenhum levantamento pago, o esqueleto
    // escrito uma vez e PLAN READY.
    const perguntasDepois: string[] = [];
    const { outcome, agent } = await init(skeletonPath(), { ask: async () => { perguntasDepois.push("x"); return "1"; } });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntasDepois).toEqual([]);
    expect(chamadas(agent, { stage: "interview" })).toHaveLength(0);
    expect(chamadas(agent, { stage: "authoring", subject: "skeleton" })).toHaveLength(1);
  });

  it("rodar o init de novo sobre um esqueleto já aceito não paga a chamada do esqueleto", async () => {
    await init(skeletonPath());
    const { outcome, agent, anunciado } = await init(skeletonPath());
    expect(outcome.readiness.ready).toBe(true);
    expect(chamadas(agent, { stage: "authoring", subject: "skeleton" })).toHaveLength(0);
    expect(anunciado).toContain("esqueleto reaproveitado de uma execução anterior");
  });
});

describe("2. o plan identifica novas lacunas normalmente", () => {
  it("um marcador deixado pela fase vira pergunta, a decisão fecha o marcador, e o plano sai pronto", async () => {
    await init(skeletonPath());
    let escritas = 0;
    const passos = skeletonPath().filter((passo) => passo.match.subject !== "phase-p02");
    passos.push({
      match: { role: "writer", stage: "authoring", subject: "phase-p02" },
      respond: {
        stdout: (call) => {
          escritas += 1;
          return call.prompt.includes("amending a phase") ? PHASE_2 : `${PHASE_2}\n[NEEDS DECISION] qual provedor de e-mail envia a confirmação da reserva\n`;
        },
      },
      repeat: true,
    });
    const perguntas: Question[] = [];
    const { outcome } = await plan(passos, { ask: async (question) => { perguntas.push(question); return question.id === ID_DO_BANCO ? "1" : "1"; } });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(perguntas.some((question) => `${question.decision} ${question.evidence}`.includes("provedor de e-mail"))).toBe(true);
    expect(escritas).toBeGreaterThanOrEqual(2);
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).not.toContain("[NEEDS DECISION]");
  });
});

describe("3. o plan não é obrigado a produzir testes nomeados", () => {
  it("fases sem nenhum teste nomeado chegam a RALPH READY, e nenhum prompt do plan pede teste", async () => {
    await init(skeletonPath());
    const { outcome, agent } = await plan(skeletonPath());
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).not.toContain("Feature tests");
    for (const call of agent.calls) {
      expect(call.prompt, `${call.role} · ${call.subject}`).not.toContain("Feature tests");
      expect(call.prompt, `${call.role} · ${call.subject}`).not.toMatch(/named test|names are IDENTIFIERS/i);
    }
  });

  it("um escritor que ainda emite Feature tests por hábito é limpo em código, sem devolução", async () => {
    await init(skeletonPath());
    const comTestes = PHASE_1.replace("  - **Traces:** statuses", "  - **Feature tests:** statuses_seed → as três linhas existem\n  - **Traces:** statuses");
    const passos = skeletonPath().filter((passo) => passo.match.subject !== "phase-p01");
    passos.push({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: comTestes }, repeat: true });
    const { outcome, agent, anunciado } = await plan(passos);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(chamadas(agent, { stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
    expect(anunciado).toContain("linha(s) de Feature tests");
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).not.toContain("Feature tests");
  });
});

describe("4. o plan pode reorganizar fases sem perder cobertura funcional", () => {
  const dividido = (): ScriptStep[] => [
    ...skeletonPath().filter((passo) => !(passo.match.subject === "architecture" || passo.match.subject?.startsWith("phase-"))),
    { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: ARQUITETURA_DIVIDIDA }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: TASKS_STATUSES }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: TASKS_RESERVATIONS }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p03" }, respond: { stdout: PHASE_2 }, repeat: true },
  ];

  it("a arquitetura divide a fase 1 do init em duas; o plano sai com três fases e toda a cobertura", async () => {
    await init(skeletonPath());
    const { outcome, anunciado } = await plan(dividido());
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado).toContain("a arquitetura reorganizou as fases: 2 do init → 3");

    const plano = parsePhases(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8"));
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    expect(plano.document.phases.map((fase) => fase.title)).toEqual(["Tabela de status", "Tabela de reservas", "Criar reserva"]);
    const traces = plano.document.phases.flatMap((fase) => fase.tasks.flatMap((task) => task.traces)).join(" ");
    for (const item of ["statuses", "reservations", "US-1.1", "workflow 1"]) expect(traces).toContain(item);

    // O esqueleto publicado carrega a divisão nova: é o que o build e o change leem.
    const esqueleto = await readSkeletonState(projectRoot, runId);
    expect(esqueleto?.phases.map((fase) => fase.title)).toEqual(["Tabela de status", "Tabela de reservas", "Criar reserva"]);
    expect(workflowsForPhase(esqueleto!, 3).map((fluxo) => fluxo.number)).toEqual(["1"]);
    expect(await readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).toContain("Phase 3: Criar reserva");
  });

  it("uma divisão que perde cobertura é recusada em código e pedida de novo com o defeito nomeado", async () => {
    await init(skeletonPath());
    let tentativas = 0;
    const perdida = JSON.stringify({ ...JSON.parse(ARQUITETURA_DIVIDIDA), phases: JSON.parse(ARQUITETURA_DIVIDIDA).phases.slice(0, 2) });
    const passos = dividido().filter((passo) => passo.match.subject !== "architecture");
    passos.push({
      match: { role: "writer", stage: "authoring", subject: "architecture" },
      respond: { stdout: (call) => { tentativas += 1; return call.prompt.includes("previous attempt was rejected") ? ARQUITETURA_DIVIDIDA : perdida; } },
      repeat: true,
    });
    const { outcome, agent } = await plan(passos);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(tentativas).toBe(2);
    const segunda = chamadas(agent, { stage: "authoring", subject: "architecture" })[1];
    expect(segunda?.prompt).toContain("perdeu cobertura");
    expect(segunda?.prompt).toContain("story US-1.1");
  });
});

describe("5. as etapas corrigem falhas documentais pontuais sem regenerar todo o trabalho", () => {
  it("um defeito de contrato na fase 2 emenda só a fase 2, e a fase 1 não é reescrita", async () => {
    await init(skeletonPath());
    let vezes = 0;
    const semCriterio = PHASE_2.replace("    - Uma reserva nova nasce com status pendente\n    - Datas sobrepostas no mesmo quarto devolvem erro e não persistem nada\n", "");
    const passos = skeletonPath().filter((passo) => passo.match.subject !== "phase-p02");
    passos.push({
      match: { role: "writer", stage: "authoring", subject: "phase-p02" },
      respond: { stdout: (call) => { vezes += 1; return call.prompt.includes("amending a phase") ? PHASE_2 : semCriterio; } },
      repeat: true,
    });
    const { outcome, agent } = await plan(passos);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(vezes).toBe(2);
    const emendas = agent.calls.filter((call) => call.stage === "authoring" && call.prompt.includes("amending a phase"));
    expect(emendas.map((call) => call.subject)).toEqual(["phase-p02"]);
    expect(emendas[0]?.prompt).toContain("I-08");
    expect(chamadas(agent, { stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
  });

  it("um defeito de forma — rótulo sem traço, critérios na mesma linha — é consertado em código, sem segunda chamada", async () => {
    await init(skeletonPath());
    const torta = [
      "- [ ] **Task:** Criar a migration de statuses e semear as três linhas",
      "  - **Acceptance criteria:** A tabela statuses existe; contém exatamente pendente, confirmada e cancelada",
      "  **Traces:** statuses",
      "",
      "- [ ] **Task:** Criar a migration de reservations com a chave estrangeira",
      "  - **Acceptance criteria:**",
      "    - A tabela reservations existe com status_id referenciando statuses",
      "  **Traces:** reservations",
    ].join("\n");
    const passos = skeletonPath().filter((passo) => passo.match.subject !== "phase-p01");
    passos.push({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: torta }, repeat: true });
    const { outcome, agent } = await plan(passos);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(chamadas(agent, { stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
    expect(agent.calls.some((call) => call.prompt.includes("amending a phase"))).toBe(false);
  });
});

describe("6. um documento inválido não recebe aprovação indevida", () => {
  it("arquitetura reprovada pelo auditor até o fim do orçamento para o run, sem publicar plano", async () => {
    await init(skeletonPath());
    const passos = skeletonPath().filter((passo) => passo.match.role !== "auditor");
    passos.push({
      match: { role: "auditor", stage: "audit", subject: "architecture" },
      respond: { stdout: reject("components · api", "o componente api não serve o fluxo 1 inteiro", "acrescente o passo de confirmação ao contrato") },
      repeat: true,
    });
    await expect(plan(passos, { maxAuditReturns: 1 })).rejects.toThrow(/A auditoria de architecture.md não convergiu/);
    await expect(readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).rejects.toThrow();
  });

  /*
   * §119: o desacordo técnico entre arquiteto e auditor não vai ao
   * desenvolvedor. Ele não decide "publicar": a arquitetura reprovada para o run
   * com o diagnóstico, e nada é publicado como aprovado.
   */
  it("a arquitetura reprovada até o fim não é publicada nem vira pergunta ao desenvolvedor", async () => {
    await init(skeletonPath());
    const passos = skeletonPath().filter((passo) => passo.match.role !== "auditor");
    passos.push({ match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: reject("phases · Phase 2", "grande demais", "divida") }, repeat: true });
    passos.push({ match: { role: "auditor", stage: "audit" }, respond: { stdout: approve() }, repeat: true });
    await expect(plan(passos, { maxAuditReturns: 1 })).rejects.toThrow(/não convergiu/);
    await expect(readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8")).rejects.toThrow();
  });

  it("arquitetura inválida três vezes passa ao auditor (§121); inválida de novo, para com diagnóstico retomável, sem auditoria", async () => {
    await init(skeletonPath());
    const passos = skeletonPath().filter((passo) => passo.match.subject !== "architecture");
    passos.push({ match: { stage: "authoring", subject: "architecture" }, respond: { stdout: "{}" }, repeat: true });
    const agent = fakeAgent(passos);
    await expect(runPlan({ projectRoot, request, language: "português do Brasil", call: agent.call, ask: responde })).rejects.toThrow(/a arquitetura veio inválida 2 vezes pelo auditor, depois do writer/);
    expect(chamadas(agent, { role: "writer", stage: "authoring", subject: "architecture" })).toHaveLength(3);
    expect(chamadas(agent, { role: "auditor", stage: "authoring", subject: "architecture" })).toHaveLength(2);
    expect(chamadas(agent, { stage: "audit" })).toHaveLength(0);
  });

  it("o plano reprovado por um auditor que não cede não é publicado como aprovado: sai com a pendência nomeada na fase", async () => {
    await init(skeletonPath());
    const passos = skeletonPath().filter((passo) => passo.match.role !== "auditor");
    passos.push({ match: { role: "auditor", stage: "audit", subject: "architecture" }, respond: { stdout: approve() }, repeat: true });
    passos.push({ match: { role: "auditor", stage: "audit" }, respond: { stdout: reject("Tarefa «Criar a migration de statuses»", "o seed não diz a ordem das linhas", "diga a ordem") }, repeat: true });
    const { outcome } = await plan(passos);
    expect(outcome.report.remarks.some((entrada) => entrada.remark.observation.startsWith("pendência do plano (a auditoria não fechou): o seed não diz a ordem das linhas"))).toBe(true);
    const publicado = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(publicado.split("## Phase 2")[0]).toContain("**Pendência do plano:**");
  });
});

describe("7. a indisponibilidade do provider preserva progresso retomável", () => {
  it("o provider cai escrevendo a fase 2; a retomada não repaga arquitetura, auditoria dela nem a fase 1", async () => {
    await init(skeletonPath());
    let quedas = 0;
    const caindo = skeletonPath().filter((passo) => passo.match.subject !== "phase-p02");
    caindo.push({
      match: { role: "writer", stage: "authoring", subject: "phase-p02" },
      respond: { stdout: () => { quedas += 1; return "Error: fetch failed: ECONNRESET"; }, exitCode: 1 },
      repeat: true,
    });
    const esperas: number[] = [];
    const agent = fakeAgent(caindo);
    await expect(runPlan({ projectRoot, request, language: "português do Brasil", call: agent.call, ask: responde, sleep: async (s) => void esperas.push(s) }))
      .rejects.toThrow(InitBlockedError);
    // Duas esperas curtas entre três tentativas, depois o diagnóstico: nunca para sempre.
    expect(esperas).toEqual([5, 20]);
    expect(quedas).toBe(3);
    expect(chamadas(agent, { stage: "authoring", subject: "architecture" })).toHaveLength(1);

    const retomada = await plan(skeletonPath());
    expect(retomada.outcome.readiness.ready, retomada.outcome.rendered).toBe(true);
    expect(chamadas(retomada.agent, { stage: "authoring", subject: "architecture" })).toHaveLength(0);
    expect(chamadas(retomada.agent, { role: "auditor", subject: "architecture" })).toHaveLength(0);
    expect(chamadas(retomada.agent, { stage: "authoring", subject: "phase-p01" })).toHaveLength(0);
    expect(chamadas(retomada.agent, { stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(retomada.anunciado).toContain("arquitetura reaproveitada de uma execução anterior");
    expect(await readArchitectureState(projectRoot, runId)).not.toBeNull();
  });

  it("a retomada depois de RALPH READY custa zero chamadas pelo que já foi julgado", async () => {
    await init(skeletonPath());
    await plan(skeletonPath());
    const { outcome, agent } = await plan(skeletonPath());
    expect(outcome.readiness.ready).toBe(true);
    expect(chamadas(agent, { role: "writer" })).toHaveLength(0);
    expect(chamadas(agent, { role: "auditor" })).toHaveLength(0);
    expect(chamadas(agent, { role: "verifier" })).toHaveLength(0);
  });
});

describe("8. a migração de contrato não perde requisitos", () => {
  it("tudo o que o esqueleto declara está no plano e no esqueleto publicado, e o stamp cita os dois documentos", async () => {
    await init(skeletonPath());
    const { outcome } = await plan(skeletonPath());
    expect(outcome.readiness.ready).toBe(true);
    const esqueletoDoInit = JSON.parse(SKELETON) as { stories: { id: string }[]; entities: { name: string }[]; workflows: { number: string }[]; rules: { statement: string }[] };
    const plano = parsePhases(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8"));
    expect(plano.ok).toBe(true);
    if (!plano.ok) return;
    const texto = plano.document.phases.flatMap((fase) => fase.tasks.flatMap((task) => [task.title, ...task.acceptanceCriteria, ...task.traces])).join(" ");
    for (const story of esqueletoDoInit.stories) expect(texto).toContain(story.id);
    for (const entity of esqueletoDoInit.entities) expect(texto).toContain(entity.name);
    for (const workflow of esqueletoDoInit.workflows) expect(texto).toContain(`workflow ${workflow.number}`);
    const publicado = await readSkeletonState(projectRoot, runId);
    // As regras do init continuam todas lá (as de banco, da entrevista, entram junto).
    for (const regra of esqueletoDoInit.rules) expect(publicado?.rules.some((atual) => atual.statement === regra.statement)).toBe(true);
    expect(plano.document.stamp?.inputs.map((input) => input.name)).toEqual(["skeleton.md", "architecture.md"]);
  });
});

describe("9. o build existente continua compatível no escopo declarado da migração", () => {
  it("o preflight lê o plano, o stamp fresco com a arquitetura e o metadado de ambiente", async () => {
    await init(skeletonPath());
    await plan(skeletonPath());
    const init_ = join(projectRoot, ".capivara/init");
    const [plano, esqueleto, arquitetura] = await Promise.all(["project-phases.md", "skeleton.md", "architecture.md"].map((nome) => readFile(join(init_, nome), "utf8")));

    const lido = parsePhases(plano!);
    expect(lido.ok).toBe(true);
    if (lido.ok) expect(checkStamp(lido.document, [{ name: "skeleton.md", content: esqueleto! }, { name: "architecture.md", content: arquitetura! }])).toEqual([]);

    const requisitos = await readEnvironmentPlan(projectRoot, esqueleto!, plano!);
    expect(requisitos.map((requisito) => requisito.binary)).toEqual(["node", "psql"]);
    const metadado = JSON.parse(await readFile(join(init_, "environment.json"), "utf8"));
    expect(metadado.infrastructure.runtimes[0].name).toBe("Node.js");

    const divisao = splitPhases(plano!, projectRoot, "build-x");
    expect(divisao.ok).toBe(true);
    if (divisao.ok) expect(divisao.sessions.map((sessao) => sessao.id)).toEqual(["P01", "P02"]);

    const resultado = await preflight({ projectRoot, runId: "build-x", git: { repository: true, clean: true }, environment: { PATH: process.env.PATH ?? "" } });
    if (!resultado.ok) {
      // Só o pré-requisito de sistema pode faltar nesta máquina; o contrato, o stamp e o metadado passaram.
      expect(resultado.contractErrors).toEqual([]);
      expect(resultado.errors.join("\n")).toMatch(/psql|PostgreSQL/);
    } else {
      expect(resultado.warnings.filter((aviso) => aviso.code === "stale")).toEqual([]);
    }
  });
});

/** O passo do arquiteto está exportado para os roteiros montados à mão. */
it("o roteiro do caminho feliz inclui a arquitetura, e o passo é reutilizável", () => {
  expect(skeletonPath().some((passo) => passo.match.subject === "architecture")).toBe(true);
  expect(architectureStep().match.subject).toBe("architecture");
});
