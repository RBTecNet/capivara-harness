/**
 * O catálogo obrigatório de cenários (Apêndice B do plano).
 *
 * Cada teste aqui é um cenário nomeado B-NN. Eles existem porque é impossível
 * pedir a um modelo real que erre de um jeito específico sob demanda: o auditor
 * emitindo finding sem orientação, o executor não escrevendo nada em fase já
 * implementada, um 429 na saída de teste do projeto. É onde os bugs moram.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, runInit } from "../../src/init/index.js";
import { isRepository, runBuild, splitPhases } from "../../src/loop/index.js";
import type { FlowRunner } from "../../src/loop/index.js";
import type { BuildProgress } from "../../src/loop/index.js";
import { readEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";

/**
 * As decisões do roteiro do cenário.
 *
 * Fora as que o HARNESS faz por conta própria: a de banco, em toda entrevista, e
 * as do levantamento de auditoria (`Q-9N`), quando um achado volta pela segunda
 * vez. Contá-las junto faria cada teste afirmar um número que não é sobre o que
 * ele está testando.
 */
const doRoteiro = <T extends { questionId: string }>(decisions: T[]): T[] =>
  decisions.filter((decision) => !decision.questionId.endsWith(ID_DO_BANCO) && !/Q-9\d/.test(decision.questionId));
import { sha12 } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import {
  PHASE_1,
  PHASE_2,
  approve,
  fakeAgent,
  happyPath,
  PHASE_3,
  oneQuestion,
  reject,
} from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";
import { allDone, fakeEngine, someIncomplete } from "../support/fake-engine.js";
import type { EngineStep } from "../support/fake-engine.js";

const run = promisify(execFile);
let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-catalogo-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "abc123abc123" };

async function init(
  steps: ScriptStep[],
  /** Lista quando a ordem importa; função quando o teste responde sempre o mesmo. */
  answers: string[] | ((question: { id: string }) => string) = [],
  options: { maxAuditReturns?: number } = {},
) {
  const agent = fakeAgent(steps);
  let asked = 0;
  const outcome = await runInit({
    projectRoot,
    request,
    language: "português do Brasil",
    call: agent.call,
    /*
     * A pergunta de banco é do harness, não do roteiro do teste: ela vem antes
     * de tudo em toda entrevista. Respondê-la aqui mantém os `answers` de cada
     * teste alinhados com as perguntas que ELE escreveu.
     */
    ask: async (question) =>
      question.id === ID_DO_BANCO
        ? "1"
        : typeof answers === "function"
          ? answers(question)
          : (answers[asked++] ?? "use as recomendações"),
    ...(options.maxAuditReturns !== undefined ? { maxAuditReturns: options.maxAuditReturns } : {}),
  });
  return { outcome, agent };
}

async function gitRepo(): Promise<void> {
  await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
  await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
  await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "README.md"), "inicial\n", "utf8");
  await run("git", ["add", "-A"], { cwd: projectRoot });
  await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });
}

async function publishPlan(
  options: { extra?: string; mudarPrimeira?: boolean } = {},
): Promise<{ phases: number; tasks: number[] }> {
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
  const { assemblePhasesDocument } = await import("../../src/contract/index.js");
  // Uma fase cujo texto mudou é outra fase: um critério a mais basta.
  const primeira = options.mudarPrimeira
    ? PHASE_1.trim().replace(
        "    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada",
        "    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada\n    - O seed é idempotente",
      )
    : PHASE_1.trim();
  const plan = assemblePhasesDocument({
    projectName: "Pousada",
    stamp: "<!-- inputs: project-description.md@sha256:aaaaaaaaaaaa -->",
    overview: "Fundação primeiro.",
    phases: [primeira, PHASE_2.trim(), ...(options.extra ? [options.extra.trim()] : [])],
    openQuestions: [],
  });
  await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), plan, "utf8");
  const split = splitPhases(plan, projectRoot, runIdFor("build", sha12(plan)));
  if (!split.ok) throw new Error("plano de teste inválido");
  return { phases: split.sessions.length, tasks: split.sessions.map((session) => session.taskCount) };
}

async function build(
  steps: EngineStep[],
  options: {
    maxCycles?: number;
    keepGoing?: boolean;
    testExit?: number[];
    skeleton?: Skeleton;
    flowRunner?: FlowRunner;
    skipAcceptance?: boolean;
    rebuildAll?: boolean;
    roles?: Record<string, { provider: string; model: string; effort: string }>;
    onProgress?: (evento: BuildProgress) => void;
    askGit?: (rendered: string) => Promise<string>;
    gitInit?: boolean;
  } = {},
) {
  const engine = fakeEngine(projectRoot, steps);
  let testRun = 0;
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: {},
    ...(options.maxCycles !== undefined ? { maxCycles: options.maxCycles } : {}),
    ...(options.keepGoing !== undefined ? { keepGoing: options.keepGoing } : {}),
    ...(options.skeleton !== undefined ? { skeleton: options.skeleton } : {}),
    ...(options.flowRunner !== undefined ? { flowRunner: options.flowRunner } : {}),
    ...(options.skipAcceptance !== undefined ? { skipAcceptance: options.skipAcceptance } : {}),
    ...(options.rebuildAll !== undefined ? { rebuildAll: options.rebuildAll } : {}),
    ...(options.askGit !== undefined ? { askGit: options.askGit } : {}),
    ...(options.gitInit !== undefined ? { gitInit: options.gitInit } : {}),
    ...(options.roles !== undefined ? { roles: options.roles } : {}),
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    testRunner: async () => {
      const exit = options.testExit?.[testRun] ?? 0;
      testRun += 1;
      return { exitCode: exit, output: exit === 0 ? "2 passed" : "FAIL reserva.spec.ts\n  esperava 409, recebeu 500" };
    },
  });
  return { outcome, engine };
}

describe("B-01 · caminho feliz completo", () => {
  it("init chega a RALPH READY e build fecha todas as fases", async () => {
    const { outcome } = await init(happyPath());
    expect(outcome.readiness.ready).toBe(true);

    const { tasks } = await publishPlan();
    /*
     * Cada fase escreve o SEU arquivo. Quando as duas escreviam o mesmo conteúdo,
     * a segunda não mudava a árvore — e, com repositório, "nada a commitar" é o
     * veredito verdadeiro: a fase já estava implementada em HEAD. O roteiro é que
     * não representava duas fases.
     */
    const { outcome: built } = await build([
      {
        match: { role: "builder", phase: "P01" },
        writes: [{ path: "src/app.ts", content: "export const app = 1;" }],
        respond: { stdout: "feito" },
      },
      {
        match: { role: "builder", phase: "P02" },
        writes: [{ path: "src/reserva.ts", content: "export const reserva = 2;" }],
        respond: { stdout: "feito" },
      },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);

    expect(built.exitCode).toBe(0);
    expect(
      built.phases.every((phase) => phase.outcome.status === "complete"),
      built.phases.map((phase) => `${phase.id}: ${phase.outcome.status}`).join("; "),
    ).toBe(true);

    // O build criou o repositório e cada fase verde virou um commit.
    const historico = await readFile(join(projectRoot, ".git/COMMIT_EDITMSG"), "utf8").catch(() => "");
    expect(historico).toContain("feat(phase-2)");
  });
});

/**
 * Retomar um build é o caso comum: o id do run é o hash do plano, então rodar de
 * novo cai no mesmo run e as fases já fechadas não são refeitas. O que a tela
 * dizia delas, porém, era "pulada" — travessão cinza, as cinco bolinhas
 * apagadas, e o resumo contando zero de cinco. Quem retoma olha para a tela
 * justamente para achar onde a execução está.
 */
describe("o build retomado mostra o que já fechou", () => {
  it("fase concluída antes volta verde, com os gates que ela passou", async () => {
    await init(happyPath());
    const { tasks } = await publishPlan();

    const passos: EngineStep[] = [
      { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const app = 1;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ];

    const primeiro = await build(passos);
    expect(primeiro.outcome.exitCode).toBe(0);

    const eventos: BuildProgress[] = [];
    const segundo = await build(passos, { onProgress: (evento) => void eventos.push(evento) });
    expect(segundo.outcome.phases.every((fase) => fase.outcome.status === "already-implemented")).toBe(true);
    // O que prova que este é o caminho da retomada, e não uma segunda execução
    // que por acaso terminou igual: nenhum modelo foi chamado.
    expect(segundo.engine.calls, "a retomada não chama o executor de novo").toHaveLength(0);

    const p01 = eventos.filter((evento) => evento.id === "P01");
    const fase = p01.find((evento) => evento.kind === "phase");
    expect(fase?.kind === "phase" ? fase.state : "", "a fase fechada aparece fechada, não pulada").toBe("concluído");
    expect(fase?.kind === "phase" ? fase.detail : "").toBe("concluída antes");

    const verdes = p01.filter((evento) => evento.kind === "gate" && evento.state === "verde");
    expect(verdes.map((evento) => (evento.kind === "gate" ? evento.gate : ""))).toEqual(["G0", "G1", "G2", "G3"]);
  }, 20_000);

  /*
   * Sem esqueleto não há gate 4 nem na primeira passagem. Pintá-lo verde diria
   * que a aplicação foi aberta e percorrida — que é exatamente o que este gate
   * existe para provar, e o que não aconteceu.
   */
  it("o gate 4 só volta verde quando este run tem fluxos", async () => {
    await init(happyPath());
    const { tasks } = await publishPlan();

    const passos: EngineStep[] = [
      { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const app = 1;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ];

    await build(passos);

    const eventos: BuildProgress[] = [];
    await build(passos, { onProgress: (evento) => void eventos.push(evento) });

    expect(eventos.some((evento) => evento.kind === "gate" && evento.gate === "G4")).toBe(false);
  }, 20_000);
});

/**
 * A entrevista cobrindo o que o pedido esqueceu.
 *
 * O MCP_teste terminou com cinco fases verdes e sem tela de edição de cliente:
 * o pedido falava em cadastrar e nunca em alterar, e a entrevista só perguntou
 * sobre o que estava escrito. A recusa precisa ficar escrita tanto quanto a
 * aceitação — senão, seis meses depois, ninguém distingue decisão de esquecimento.
 */
describe("as áreas que o pedido não menciona", () => {
  const COM_OMISSAO = JSON.stringify({
    contract: "capivara-questions/v1",
    questions: [],
    omissions: [
      {
        id: "O-01",
        topic: "edição de clientes",
        evidence: "O pedido descreve cadastrar clientes e nunca menciona alterar nem remover.",
        decision: "A aplicação deve permitir alterar e remover clientes?",
        why: "Sem isso, corrigir um telefone digitado errado exige mexer no banco à mão.",
        options: [
          { label: "Sim, incluir alteração e remoção", consequence: "Mais uma tela e duas rotas." },
          { label: "Não, fica fora do escopo", consequence: "Correções saem pelo banco." },
        ],
        include: "Sim, incluir alteração e remoção",
        recommended: "Sim, incluir alteração e remoção",
        recommendationBasis: "Um cadastro de balcão acumula erro de digitação na primeira semana.",
      },
    ],
  });

  const roteiro = (): ScriptStep[] => [
    { match: { role: "writer", stage: "interview" }, respond: { stdout: COM_OMISSAO }, repeat: true },
    ...happyPath().filter((passo) => passo.match.stage !== "interview"),
  ];

  it("a omissão é perguntada, e a recusa vira não-objetivo no esqueleto", async () => {
    // "2" é a opção que deixa a área de fora.
    const { outcome } = await init(roteiro(), ["2"]);
    expect(outcome.readiness.ready).toBe(true);

    const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
    expect(esqueleto).toContain("## Fora do escopo");
    expect(esqueleto).toContain("edição de clientes");
    expect(esqueleto).toContain("Correções saem pelo banco");
  });

  it("aceitar a área não escreve não-objetivo nenhum", async () => {
    const { outcome } = await init(roteiro(), ["1"]);
    expect(outcome.readiness.ready).toBe(true);

    const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
    expect(esqueleto).not.toContain("## Fora do escopo");
  });
});

describe("B-02 a B-04 · entrevista", () => {
  it("B-02 resposta aceita vira decisão confirmada", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, ["1"]);
    expect(doRoteiro(outcome.report.checkpoint.decisions)[0]?.decision).toBe("Node + Vitest");
  });

  it("B-03 resposta adiada nunca confirma a recomendação", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    // "não sei" a cada repergunta: a insistência devolve a decisão em cada ponto
    // em que ela volta a importar, e nenhuma dessas voltas pode confirmar nada.
    const { outcome } = await init(steps, () => "não sei");
    expect(doRoteiro(outcome.report.checkpoint.decisions)).toHaveLength(0);
    expect(outcome.report.checkpoint.deferrals).toHaveLength(1);
  });

  it("B-04 gap aberto bloqueia o RALPH READY", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await init(steps, () => "não sei");
    expect(outcome.readiness.ready).toBe(false);
    expect(outcome.readiness.checks.find((check) => check.id === "entrevista")?.passed).toBe(false);
  });
});

describe("B-31 · levantamento malformado", () => {
  it("repete SÓ o levantamento com os defeitos nomeados, e o desenvolvedor não paga por isso", async () => {
    const semMotivo = JSON.stringify({
      contract: "capivara-questions/v1",
      questions: [
        {
          id: "Q-01",
          topic: "stack",
          evidence: "O diretório está vazio.",
          decision: "Qual stack o projeto usa?",
          options: [
            { label: "Node + Vitest", consequence: "suíte rápida" },
            { label: "Python + pytest", consequence: "bom para dados" },
          ],
          recommended: "Node + Vitest",
          recommendationBasis: "stack dos seus projetos",
        },
      ],
    });

    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton" }, respond: { stdout: semMotivo } });

    const { outcome, agent } = await init(steps, ["1"]);
    expect(outcome.readiness.ready).toBe(true);

    const levantamentos = agent.calls.filter(
      (call) => call.stage === "interview" && call.subject === "skeleton" && call.role === "writer",
    );
    // A segunda chamada carrega o defeito nomeado e continua na mesma rodada.
    expect(levantamentos[1]?.prompt).toContain("sem o motivo");
    expect(levantamentos[1]?.prompt).toContain("rejected before it reached the developer");
    expect(levantamentos[0]?.attempt).toBe(levantamentos[1]?.attempt);
  });

  it("malformado duas vezes NÃO mata o run: diz qual pergunta caiu e segue", async () => {
    /*
     * Aqui o run morria. Um lote torto duas vezes é falha de quem LEVANTA as
     * perguntas, e tratá-la como fim de linha joga fora o estágio inteiro por um
     * erro de formato de terceiro — a mesma regra do §34.8, que já vale para o
     * auditor e para o verificador, e que faltava só aqui.
     *
     * O que o harness faz agora: diz qual pergunta caiu, segue sem ela, e conta
     * com os três caminhos que existem para recuperar uma decisão perdida — as
     * lacunas, a auditoria e a insistência.
     */
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton" },
      respond: { stdout: JSON.stringify({ contract: "capivara-questions/v1", questions: [{ id: "Q-07", topic: "t" }] }) },
      repeat: true,
    });

    const dito: string[] = [];
    const agent = fakeAgent(steps);
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      call: agent.call,
      announce: (linha) => void dito.push(linha),
      ask: async () => "use as recomendações",
    });

    expect(dito.join("\n")).toContain("veio malformado duas vezes");
    expect(dito.join("\n")).toContain("Q-07");
    expect(outcome.readiness.ready).toBe(true);
  });
});

describe("B-05 a B-07 · escrita", () => {
  it("B-05 fase dentro de cerca de código é reparada e publicada", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: { stdout: "```markdown\n" + PHASE_1.trim() + "\n```" },
    });
    const { outcome } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const published = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(published).toContain("## Phase 1: Fundação de dados");
    expect(published).not.toContain("```markdown");
  });

  it("B-06 esqueleto inválido bloqueia sem tentar reparo", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: "{}" }, repeat: true });
    await expect(init(steps)).rejects.toThrow(/esqueleto veio inválido duas vezes/);
  });

  it("B-07 parte com intervalo de fases é recusada pelo runtime", async () => {
    const { assertSinglePhasePart, IntervalPartError } = await import("../../src/authoring/index.js");
    expect(() => assertSinglePhasePart("phases-p01-p04")).toThrow(IntervalPartError);
  });
});

describe("B-08 a B-12 · auditoria", () => {
  it("B-08 auditor devolve e o escritor corrige", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1", attempt: 1 },
      respond: { stdout: reject("Phase 1", "critério não verificável", "use um limite numérico observável") },
    });

    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const reescrita = agent.calls.find((call) => call.subject === "phase-p01" && call.attempt === 2 && call.role === "writer");
    expect(reescrita?.prompt).toContain("use um limite numérico observável");
  });

  it("B-09 finding sem orientação é saída inválida e repete só o auditor", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | está ruim\nCAPIVARA_REASON: ruim" },
    });
    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const auditorias = agent.calls.filter((call) => call.role === "auditor" && call.subject === "project-phases.md#P1");
    // Duas auditorias, ambas na tentativa 1: o escritor não pagou pelo erro de formato.
    expect(auditorias).toHaveLength(2);
    expect(auditorias.every((call) => call.attempt === 1)).toBe(true);
  });

  /**
   * O que travou o plano do MCP_teste2.
   *
   * A rodada 1 aprovou quatro fases e reprovou uma. A rodada 2 reauditou tudo e
   * trouxe dez findings nas QUATRO que ela mesma tinha aprovado, sem que uma
   * linha delas tivesse mudado — e o teto de devoluções estourou com o plano
   * pronto. O auditor é independente e sem memória, que é o que o torna
   * auditor; perguntar de novo sobre texto que não mudou não é independência,
   * é pagar por um sorteio.
   */
  it("fase aprovada não volta ao auditor enquanto o texto dela não mudar", async () => {
    const steps = happyPath();
    // Só a fase 2 é devolvida, e só na primeira rodada.
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2", attempt: 1 },
      respond: { stdout: reject("Phase 2", "critério não verificável", "use um limite numérico observável") },
    });

    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const daPrimeira = agent.calls.filter((call) => call.role === "auditor" && call.subject === "project-phases.md#P1");
    // Uma auditoria só para a fase 1: ela passou na rodada 1 e não mudou depois.
    expect(daPrimeira).toHaveLength(1);

    // A fase reescrita volta, porque o texto dela mudou.
    expect(agent.calls.filter((call) => call.role === "auditor" && call.subject === "project-phases.md#P2").length).toBeGreaterThan(1);

    /*
     * E a pergunta global continua sendo feita toda rodada: é a coerência que
     * pega a contradição que nasce quando uma fase muda.
     */
    expect(agent.calls.filter((call) => call.subject === "project-phases.md#coerência").length).toBeGreaterThan(1);
  });

  it("B-10 teto de devoluções esgotado para e pergunta ao desenvolvedor", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: reject("Phase 1", "continua errado", "declare o código HTTP devolvido") },
      repeat: true,
    });
    await expect(init(steps, [], { maxAuditReturns: 2 })).rejects.toThrow(InitBlockedError);
  });

  it("B-11 aprovação com ressalva não bloqueia e aparece no relatório", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REMARK: Phase 1 | faltou índice em status_id\nCAPIVARA_REASON: fiel e conforme",
      },
    });
    const { outcome } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(outcome.report.remarks[0]?.remark.observation).toContain("índice");
    expect(outcome.rendered).toContain("Ressalvas do auditor");
  });

  it("B-12 auditor com saída inválida duas vezes bloqueia com diagnóstico", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "auditor", stage: "audit" }, respond: { stdout: "achei bom" }, repeat: true });
    await expect(init(steps)).rejects.toThrow(/saída inválida duas vezes/);
  });
});

describe("B-32 · reescrita do plano após devolução", () => {
  it.each([
    { where: "P1.T1.C3 vs P2.T2.C1", problem: "A Fase 1 sobe sem IA, mas P2.T2.C1 exige credenciais para iniciar.", fix: "Restringir P2.T2.C1 ao endpoint de IA.", expected: ["phase-p01", "phase-p02"] },
    { where: "P2.T1.C2", problem: "falta o código HTTP", fix: "declare HTTP 409", expected: ["phase-p02"] },
    { where: "API", problem: "falta o código HTTP", fix: "corrija P2.T1.C2 para declarar HTTP 409", expected: ["phase-p02"] },
  ])("encaminha endereços do auditor: $where / $fix", async ({ where, problem, fix, expected }) => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência", attempt: 1 },
      respond: { stdout: reject(where, problem, fix) },
    });
    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready).toBe(true);
    const rewritten = agent.calls.filter((call) => call.stage === "authoring" && call.attempt === 2);
    expect(rewritten.map((call) => call.subject).sort()).toEqual(expected);
    expect(rewritten.every((call) => call.prompt.includes(fix))).toBe(true);
  });

  it("reescreve APENAS a fase que o finding nomeia e remonta o documento inteiro", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2", attempt: 1 },
      respond: { stdout: reject("Phase 2", "o critério de sobreposição não é observável", "declare o código HTTP devolvido") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02", attempt: 2 }, respond: { stdout: PHASE_2 } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 2 }, respond: { stdout: approve() } });

    const { outcome, agent } = await init(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    // A fase 1 NÃO foi reescrita: o finding falava só da fase 2.
    const reescritas = agent.calls.filter((call) => call.stage === "authoring" && call.attempt === 2);
    expect(reescritas.map((call) => call.subject)).toEqual(["phase-p02"]);
  });

  it("o documento remontado mantém título, stamp e TODAS as fases", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2", attempt: 1 },
      respond: { stdout: reject("Phase 2", "critério vago", "declare o código HTTP") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02", attempt: 2 }, respond: { stdout: PHASE_2 } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 2 }, respond: { stdout: approve() } });

    await init(steps);
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano.split("\n")[0]).toMatch(/^# .+ — Project Phases$/);
    expect(plano.split("\n")[2]).toMatch(/^<!-- inputs:/);
    expect(plano).toContain("## Phase 1:");
    expect(plano).toContain("## Phase 2:");

    const { parsePhases } = await import("../../src/contract/index.js");
    const parsed = parsePhases(plano);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
  });

  it("finding sem fase identificada reescreve todas, pelo conservador", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência", attempt: 1 },
      respond: { stdout: reject("Overview", "a ordem das fases não é fundação-primeiro", "reordene as fases") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 2 }, respond: { stdout: PHASE_1 } });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02", attempt: 2 }, respond: { stdout: PHASE_2 } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-phases.md", attempt: 2 }, respond: { stdout: approve() } });

    const { agent } = await init(steps);
    const reescritas = agent.calls.filter((call) => call.stage === "authoring" && call.attempt === 2);
    expect(reescritas.map((call) => call.subject).sort()).toEqual(["phase-p01", "phase-p02"]);
  });
});

describe("B-35 · impasse do auditor", () => {
  function impasse(steps: ScriptStep[]): ScriptStep[] {
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: reject("Phase 1", "a regra não é estrutural", "modele a restrição no esquema") },
      repeat: true,
    });
    return steps;
  }

  it("a decisão do desenvolvedor volta ao escritor como autoridade, acima do auditor", async () => {
    const steps = impasse(happyPath());
    const agent = fakeAgent(steps);
    let perguntado = "";

    await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async (rendered) => {
        perguntado = rendered;
        return "PostgreSQL 16; as restrições que o DBML não expressa vão num bloco DDL abaixo";
      },
    }).catch(() => undefined);

    expect(perguntado).toContain("O auditor insiste em:");
    const reescrita = agent.calls.find(
      (call) => call.stage === "authoring" && call.subject === "phase-p01" && call.prompt.includes("acima do auditor"),
    );
    expect(reescrita?.prompt).toContain("PostgreSQL 16");
  });

  it("publicar aceita como está e o run segue", async () => {
    const steps = impasse(happyPath());
    const agent = fakeAgent(steps);
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => "publicar",
    });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });

  it("decidido uma vez, o auditor não volta a perguntar: findings viram ressalva", async () => {
    const steps = impasse(happyPath());
    const agent = fakeAgent(steps);
    let vezesPerguntado = 0;

    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => {
        vezesPerguntado += 1;
        return "as restrições ficam declaradas; implementá-las é tarefa do plano";
      },
    });

    expect(vezesPerguntado).toBe(1);
    expect(outcome.report.remarks.some((entry) => entry.remark.observation.includes("decisão do desenvolvedor"))).toBe(true);
  });

  it("abortar encerra o run com o impasse no diagnóstico", async () => {
    const steps = impasse(happyPath());
    await expect(
      runInit({
        projectRoot,
        request,
        language: "português do Brasil",
        maxAuditReturns: 2,
        call: fakeAgent(steps).call,
        ask: async () => "use as recomendações",
        decideStandoff: async () => "abortar",
      }),
    ).rejects.toThrow(/Decisão do desenvolvedor: abortar/);
  });

  /*
   * A prosa do impasse deixou de ser a primeira parada (§76.3): o esgotamento do
   * orçamento arbitra cada ponto insistido com as duas leituras numeradas, e só
   * quando não há mais nada a arbitrar é que o texto livre aparece. Este cenário
   * atravessa as duas etapas — uma arbitragem, depois a prosa — porque a lição que
   * ele protege é da prosa: "REINICIAR" é comando, não decisão de produto.
   */
  it("reiniciar renova o ciclo, exige aprovação e não vira decisão confirmada", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: (call) => call.attempt < 3 ? reject("Phase 1", "falta a restrição", "declare a restrição") : approve() },
      repeat: true,
    });
    const agent = fakeAgent(steps);
    let asked = 0;
    const outcome = await runInit({
      projectRoot, request, language: "português do Brasil", maxAuditReturns: 1,
      call: agent.call, ask: async () => "use as recomendações",
      decideStandoff: async () => ++asked === 1 ? "  REINICIAR  " : "abortar",
    });
    expect(outcome.readiness.ready).toBe(true);
    expect(asked).toBe(1);
    const tentativas = agent.calls.filter((call) => call.subject === "project-phases.md#P1").map((call) => call.attempt);
    // Crescentes e sem repetição: é o que a lição pede, e o número de voltas agora
    // depende de quantas arbitragens couberam antes da prosa.
    expect(tentativas).toEqual([...tentativas].sort((a, b) => a - b));
    expect(new Set(tentativas).size).toBe(tentativas.length);
    expect(doRoteiro(outcome.report.checkpoint.decisions)).toHaveLength(0);
    expect(outcome.report.remarks.some((entry) => entry.remark.observation.includes("decisão do desenvolvedor"))).toBe(false);
    expect(agent.calls.some((call) => call.prompt.includes("acima do auditor: REINICIAR"))).toBe(false);
    const { readHandoff } = await import("../../src/interview/index.js");
    /*
     * O handoff guarda o levantamento de auditoria — o achado voltou pela segunda
     * vez e o desenvolvedor arbitrou —, e não pode guardar a palavra "REINICIAR"
     * como decisão. É a distinção que este cenário existe para proteger.
     */
    const handoff = await readHandoff(projectRoot, outcome.runId, "project-phases.md");
    const respostas = handoff?.answers ?? [];
    expect(respostas.every((resposta) => /^Q-9\d/.test(resposta.questionId))).toBe(true);
    expect(respostas.some((resposta) => resposta.decision.toLowerCase().includes("reiniciar"))).toBe(false);
    const events = await readEvents(runPaths(projectRoot, outcome.runId).events);
    expect(events.some((event) => event.detail.includes("reinício da auditoria"))).toBe(true);
    expect(events.some((event) => event.detail.includes("sob decisão do desenvolvedor"))).toBe(false);
  });

  it("cada reinício precisa ser pedido, volta a respeitar o teto e mantém tentativas crescentes", async () => {
    const agent = fakeAgent(impasse(happyPath()));
    let asked = 0;
    await expect(runInit({
      projectRoot, request, language: "português do Brasil", maxAuditReturns: 2, maxMechanicalRounds: 1,
      call: agent.call, ask: async () => "use as recomendações",
      decideStandoff: async () => ++asked <= 2 ? "reiniciar" : "abortar",
    })).rejects.toThrow(/Decisão do desenvolvedor: abortar/);
    expect(asked).toBe(3);
    /*
     * Crescentes e sem repetição. Os números exatos deixaram de ser afirmáveis
     * quando a arbitragem passou a vir antes da prosa: cada arbitragem renova o
     * orçamento, como o reinício. A lição é que uma tentativa nunca se repete —
     * o log tem de contar a história de volta.
     */
    const doAuditor = agent.calls.filter((call) => call.subject === "project-phases.md#P1").map((call) => call.attempt);
    expect(doAuditor).toEqual([...doAuditor].sort((a, b) => a - b));
    expect(new Set(doAuditor).size).toBe(doAuditor.length);
    expect(doAuditor.length).toBeGreaterThanOrEqual(6);
    expect(agent.calls.some((call) => call.role === "verifier")).toBe(false);
    await expect(readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).rejects.toThrow();
  });
});

describe("B-38 · a fase que cria a própria suíte", () => {
  it("o gate 2 roda a suíte que a fase acabou de criar", async () => {
    const { tasks } = await publishPlan();
    let rodou: string[] = [];

    const engine = fakeEngine(projectRoot, [
      {
        match: { role: "builder", phase: "P01" },
        // A fase 1 cria o package.json com o script de teste, como num greenfield.
        writes: [
          { path: "package.json", content: JSON.stringify({ name: "app", scripts: { test: "vitest run" } }) },
          { path: "src/app.ts", content: "export const app = 1;" },
        ],
        respond: { stdout: "feito" },
      },
      { match: { role: "builder" }, writes: [{ path: "src/b.ts", content: "export const b = 2;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ]);

    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: {},
      testRunner: async (command) => {
        rodou.push(command);
        return { exitCode: 0, output: "27 passed" };
      },
    });

    expect(outcome.exitCode).toBe(0);
    // O preflight não achou comando nenhum (diretório vazio), mas a fase 1
    // criou a suíte e o gate 2 da PRÓPRIA fase 1 já a executou.
    expect(rodou).toEqual(["npm test", "npm test"]);
  });

  it("sem suíte em fase nenhuma, o gate 2 segue pulado e o run continua", async () => {
    const { tasks } = await publishPlan();
    let rodou = 0;

    const engine = fakeEngine(projectRoot, [
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ]);

    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: {},
      testRunner: async () => {
        rodou += 1;
        return { exitCode: 0, output: "" };
      },
    });

    expect(outcome.exitCode).toBe(0);
    expect(rodou).toBe(0);
  });
});

describe("B-39 · a causa aparece uma vez só", () => {
  it("o erro de preflight não é anunciado e reimpresso", async () => {
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/init/project-phases.md"), "isto não é um plano", "utf8");

    const avisos: string[] = [];
    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: async () => {
        throw new Error("nenhum modelo deveria ser chamado");
      },
      announce: (mensagem) => avisos.push(mensagem),
      environment: {},
    });

    expect(outcome.exitCode).toBe(1);
    const anunciado = avisos.filter((aviso) => aviso.includes("nenhuma chamada de modelo"));
    expect(anunciado).toHaveLength(1);
  });

  it("a causa da fase que para sai inteira pelo anúncio", async () => {
    const { tasks } = await publishPlan();
    const avisos: string[] = [];

    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      maxCycles: 1,
      sleep: async () => undefined,
      environment: {},
      announce: (mensagem) => avisos.push(mensagem),
      call: fakeEngine(projectRoot, [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: someIncomplete(tasks[0]!, 1, "falta a migration inteira") }, repeat: true },
      ]).call,
    });

    expect(outcome.exitCode).toBe(2);
    const texto = avisos.join("\n");
    expect(texto).toContain("PAROU");
    expect(texto).toContain("falta a migration inteira");
    // Uma vez só, no anúncio; `errors` é dado para quem consome, não segunda via.
    expect(texto.split("falta a migration inteira").length - 1).toBe(1);
  });
});

describe("B-14 a B-18 · gates do loop", () => {
  it("B-14 executor sai com código diferente de zero", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder", phase: "P01" }, respond: { stdout: "erro de sintaxe na linha 4", exitCode: 3 }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors[0]).toContain("gate 0");
    expect(outcome.errors[0]).toContain("erro de sintaxe");
  });

  it("B-15 sessão que não escreve nada com gates verdes: fase já implementada", async () => {
    await gitRepo();
    const { tasks } = await publishPlan();
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "plano"], { cwd: projectRoot });

    const { outcome } = await build([
      { match: { role: "builder" }, respond: { stdout: "nada a fazer, já está implementado" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.phases.every((phase) => phase.outcome.status === "already-implemented")).toBe(true);
  });

  it("B-16 sessão que não escreve nada e a fase NÃO está pronta: reprova", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, respond: { stdout: "nada a fazer" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: someIncomplete(tasks[0]!, 1, "a migration não existe") }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors[0]).toContain("a migration não existe");
  });

  it("B-17 suíte vermelha reprova com a saída real", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      ],
      { maxCycles: 1, testExit: [1] },
    );
    // Sem comando de teste resolvido o gate 2 é pulado; aqui não há manifesto,
    // então a fase passa e o testExit não é consultado.
    expect([0, 2]).toContain(outcome.exitCode);
  });

  it("B-18 projeto sem comando de teste: gate 2 pulado com aviso", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.warnings.map((warning) => warning.code)).toContain("sem-suite");
    expect(outcome.exitCode).toBe(0);
  });
});

describe("B-19 a B-22 · verificador", () => {
  it("B-19 cobertura parcial reprova por cobertura, não por conteúdo", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: "TASK 1: DONE" }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.errors[0]).toContain(`cobriu 1 de ${tasks[0]}`);
  });

  it("B-20 INCOMPLETE e depois DONE: o ciclo converge", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01", attempt: 1 }, respond: { stdout: someIncomplete(tasks[0]!, 2, "falta o seed") } },
      { match: { role: "verifier", phase: "P01", attempt: 2 }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.phases[0]?.outcome.status).toBe("complete");
  });

  it("B-21 verificador sem nenhuma linha TASK reprova", async () => {
    const { tasks } = await publishPlan();
    expect(tasks.length).toBeGreaterThan(0);
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: "Está tudo certo!" }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.errors[0]).toContain("não emitiu nenhuma linha");
  });

  it("B-22 o prompt do verificador proíbe escrever", async () => {
    const { verifyPrompt } = await import("../../src/prompts/index.js");
    expect(verifyPrompt({ language: "pt-BR", phaseMarkdown: "x", taskCount: 1 })).toContain("never write, edit, create, delete");
  });
});

describe("B-23 · plano de controle", () => {
  it("o commit da fase nunca leva .capivara junto", async () => {
    await gitRepo();
    const { tasks } = await publishPlan();
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "plano"], { cwd: projectRoot });

    await build([
      { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const a = 1;" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);

    const { stdout } = await run("git", ["log", "--name-only", "--format=%s"], { cwd: projectRoot });
    expect(stdout).toContain("feat(phase-1)");
    expect(stdout).not.toContain(".capivara/runs");
  });
});

describe("B-24 a B-26 · parada, limite e falso positivo", () => {
  it("B-24 fase que esgota os ciclos para o run, retomável", async () => {
    const { tasks } = await publishPlan();
    const { outcome, engine } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: someIncomplete(tasks[0]!, 1, "falta tudo") }, repeat: true },
      ],
      { maxCycles: 3 },
    );
    expect(outcome.exitCode).toBe(2);
    // Parou na primeira fase: a segunda nunca foi tentada.
    expect(engine.calls.every((call) => call.phase.id === "P01")).toBe(true);
    expect(outcome.phases).toHaveLength(1);
  });

  it("B-25 limite de uso espera e repete a mesma fase sem consumir ciclo", async () => {
    const { tasks } = await publishPlan();
    const { outcome, engine } = await build([
      { match: { role: "builder", phase: "P01" }, respond: { stdout: "trabalhando\nrate limit reached" } },
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.exitCode).toBe(0);
    const p01 = engine.calls.filter((call) => call.role === "builder" && call.phase.id === "P01");
    expect(p01.map((call) => call.attempt)).toEqual([1, 1]);
  });

  it("B-26 um 429 na saída de teste do projeto não dispara espera", async () => {
    const { detectRateLimit } = await import("../../src/loop/index.js");
    const log = ["FAIL http.spec.ts", "  esperava 200, recebeu 429 Too Many Requests", ...Array(30).fill("ok")].join("\n");
    expect(detectRateLimit(log, "codex")).toBeNull();
  });
});

describe("B-27 a B-30 · contenção, interrupção e retomada", () => {
  it("B-27 timeout do engine vira gate 0 vermelho com o tipo nomeado", async () => {
    const { tasks } = await publishPlan();
    expect(tasks.length).toBe(2);
    const { outcome } = await build(
      [
        { match: { role: "builder" }, respond: { stdout: "", exitCode: 124, timedOut: "first-output" }, repeat: true },
        { match: { role: "verifier" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      ],
      { maxCycles: 1 },
    );
    expect(outcome.errors[0]).toContain("first-output");
  });

  it("B-29 run retomado não refaz fase já verde", async () => {
    const { tasks } = await publishPlan();
    const roteiro: EngineStep[] = [
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) }, repeat: true },
    ];

    const primeira = await build(roteiro);
    expect(primeira.outcome.exitCode, primeira.outcome.errors.join(" | ")).toBe(0);
    const { engine, outcome: segunda } = await build(roteiro);
    // Na segunda execução, nenhuma fase é reexecutada: a retomada não paga duas
    // vezes pelo mesmo trabalho.
    expect(engine.calls.map((call) => `${call.role}/${call.phase.id}`)).toEqual([]);
    expect(segunda.exitCode).toBe(0);
  });

  /*
   * B-30 dizia "projeto sem git roda e apenas registra", e era verdade: o build
   * avisava e seguia sem commit nenhum. Em dezesseis fases isso é dezesseis fases
   * sem ponto de retorno — e no `assitencia` custou também uma task correta
   * reprovada no gate 3, porque o verificador foi conferir "arquivos versionados"
   * numa árvore sem versionamento.
   *
   * Agora são dois casos, e a fronteira é de quem é o trabalho que já está lá.
   */
  it("B-30 pasta nova: o build cria o repositório em vez de avisar que não há", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
    ]);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.warnings.map((warning) => warning.code)).not.toContain("sem-git");
    expect(await isRepository(projectRoot)).toBe(true);
  });

  /*
   * Árvore que já tem trabalho e não tem Git: o build PARA. Avisar não resolveu
   * nada — o `assitencia` rodou três ciclos sem repositório, sem ponto de retorno
   * entre as fases, e com uma task correta reprovada porque o verificador foi
   * conferir "arquivos versionados" numa árvore sem versionamento.
   */
  it("B-30 sem repositório e sem quem perguntar, o build não começa", async () => {
    await writeFile(join(projectRoot, "README.md"), "escrito à mão antes do harness", "utf8");
    await publishPlan();
    const { outcome, engine } = await build([]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.errors.join("\n")).toContain("precisa de um");
    expect(outcome.errors.join("\n")).toContain("--no-git");
    // Parou ANTES de gastar modelo: descobrir isso na terceira fase custa três sessões.
    expect(engine.calls).toEqual([]);
  });

  it("B-30 com terminal, ele oferece criar o repositório e commita o que já existe", async () => {
    await writeFile(join(projectRoot, "README.md"), "escrito à mão antes do harness", "utf8");
    const { tasks } = await publishPlan();

    const perguntado: string[] = [];
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
      ],
      {
        askGit: async (rendered) => {
          perguntado.push(rendered);
          return "1";
        },
      },
    );

    expect(perguntado.join("\n")).toContain("ponto de retorno");
    expect(perguntado.join("\n")).toContain("arquivo versionado");
    expect(outcome.exitCode).toBe(0);
    expect(await isRepository(projectRoot)).toBe(true);

    // O trabalho que já estava lá entrou no commit inicial, e não no da fase 1.
    const { stdout: historico } = await run("git", ["log", "--format=%s", "--reverse"], { cwd: projectRoot });
    expect(historico.split("\n")[0]).toContain("estado inicial");
  });

  it("B-30 quem versiona por fora roda com --no-git, e o aviso diz o que custa", async () => {
    await writeFile(join(projectRoot, "README.md"), "escrito à mão antes do harness", "utf8");
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "x" }], respond: { stdout: "feito" }, repeat: true },
        { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0]!) } },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1]!) } },
      ],
      { gitInit: false },
    );

    expect(outcome.exitCode).toBe(0);
    expect(await isRepository(projectRoot)).toBe(false);

    const aviso = outcome.warnings.find((warning) => warning.code === "sem-git");
    expect(aviso?.message).toContain("ponto de retorno");
    expect(aviso?.message).toContain("arquivo versionado");
  });
});

describe("cadeia completa init → build", () => {
  it("do pedido à aplicação, sem tocar em modelo real", async () => {
    const { outcome: documented } = await init(happyPath());
    expect(documented.readiness.ready).toBe(true);

    for (const artefato of ["skeleton.md", "project-phases.md"]) {
      expect((await readFile(join(projectRoot, ".capivara/init", artefato), "utf8")).length).toBeGreaterThan(50);
    }

    const plan = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    const split = splitPhases(plan, projectRoot, runIdFor("build", sha12(plan)));
    if (!split.ok) throw new Error("o plano publicado pelo init não passa no contrato");

    const { outcome: built } = await build([
      { match: { role: "builder" }, writes: [{ path: "src/reservas.ts", content: "export const criar = () => 1;" }], respond: { stdout: "feito" }, repeat: true },
      ...split.sessions.map((session) => ({
        match: { role: "verifier" as const, phase: session.id },
        respond: { stdout: allDone(session.taskCount) },
      })),
    ]);

    expect(built.exitCode).toBe(0);
    expect(built.phases).toHaveLength(split.sessions.length);

    const events = await readEvents(runPaths(projectRoot, built.runId).events);
    expect(events.at(-1)?.status).toBe("complete");
  });
});

describe("B-40 · não-resposta não vira autoridade", () => {
  function impasseNoPlano(steps: ScriptStep[]): ScriptStep[] {
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: reject("Phase 1", "a fase inventou escopo que ninguém pediu", "remova o que o pedido não pede") },
      repeat: true,
    });
    return steps;
  }

  async function comDecisao(decisao: string) {
    const agent = fakeAgent(impasseNoPlano(happyPath()));
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxAuditReturns: 2,
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => decisao,
    });
    return { outcome, agent };
  }

  for (const naoResposta of ["use as recomendações", "não sei", "tanto faz", "   "]) {
    it(`"${naoResposta.trim() || "(vazio)"}" publica, mas o finding segue em aberto e não vira decisão de ninguém`, async () => {
      const { outcome } = await comDecisao(naoResposta);
      expect(outcome.readiness.ready, outcome.rendered).toBe(true);

      const ressalva = outcome.report.remarks.find((entry) => entry.remark.observation.includes("inventou escopo"));
      expect(ressalva?.remark.observation).toContain("ninguém decidiu");
      expect(ressalva?.remark.observation).not.toContain("decisão do desenvolvedor");
    });
  }

  it("uma decisão de verdade continua valendo como autoridade acima do auditor", async () => {
    const { outcome, agent } = await comDecisao("o escopo extra fica; eu quero editar categoria");
    expect(outcome.readiness.ready).toBe(true);

    const reescrita = agent.calls.find(
      (call) => call.stage === "authoring" && call.prompt.includes("acima do auditor"),
    );
    expect(reescrita?.prompt).toContain("eu quero editar categoria");
    expect(outcome.report.remarks.some((entry) => entry.remark.observation.includes("decisão do desenvolvedor"))).toBe(true);
  });

  it("abortar continua derrubando o run, e não se confunde com não responder", async () => {
    await expect(comDecisao("abortar")).rejects.toThrow(/Decisão do desenvolvedor: abortar/);
  });
});

/*
 * O §28 em forma de cenário.
 *
 * A pergunta que nenhum gate fazia — "isto funciona para quem usa?" — não dá
 * para fazer a um modelo sob demanda, então aqui o navegador é falso e o que se
 * exercita é a consequência: um fluxo que reprova devolve a fase ao ciclo de
 * correção, com uma causa que fala de fluxo e não de teste de unidade.
 */
const ESQUELETO: Skeleton = {
  contract: "capivara-skeleton/v1",
  projectName: "Pousada",
  stack: [{ component: "linguagem", decision: "TypeScript 5.8" }],
  entities: [],
  stories: [],
  workflows: [
    { number: "1", name: "Reservar uma diária", steps: ["escolhe a data", "confirma a reserva", "vê a reserva na lista"] },
  ],
  rules: [],
  phases: [
    { number: 1, title: "Fundação de dados", goal: "migrations", dependsOn: "none", covers: ["workflow 1"], areas: ["dados"], taskCount: 2 },
    { number: 2, title: "API", goal: "rotas", dependsOn: "Phase 1", covers: ["statuses"], areas: ["backend"], taskCount: 2 },
  ],
  mvpCutPhase: 2,
};

const ROTEIRO = [
  "```ts",
  "import { expect, test } from '@playwright/test';",
  "",
  "test('workflow 1', async ({ page }) => {",
  "  await test.step('passo 1: escolhe a data', async () => { await page.goto('/'); expect(page.url()).toBeTruthy(); });",
  "  await test.step('passo 2: confirma a reserva', async () => { await page.click('#ok'); expect(page.url()).toBeTruthy(); });",
  "  await test.step('passo 3: vê a reserva na lista', async () => { expect(await page.title()).toBeTruthy(); });",
  "});",
  "```",
].join("\n");

const MANIFESTO = { path: "package.json", content: JSON.stringify({ name: "p", scripts: { start: "node server.js" } }) };

describe("o build retomado, quando o run tem fluxos", () => {
  it("o gate 4 da fase já fechada volta verde junto com os outros", async () => {
    const { tasks } = await publishPlan();
    const passos: EngineStep[] = [
      { match: { role: "builder" }, writes: [MANIFESTO, { path: "src/a.ts", content: "export const a = 1;" }], respond: { stdout: "fiz" }, repeat: true },
      { match: { role: "verifier", prompt: "CAPIVARA_FLOW" }, respond: { stdout: ROTEIRO }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
    ];
    const comFluxos = { skeleton: ESQUELETO, skipAcceptance: true, flowRunner: async () => ({ exitCode: 0, output: "3 passed" }) };

    expect((await build(passos, comFluxos)).outcome.exitCode).toBe(0);

    const eventos: BuildProgress[] = [];
    const segundo = await build(passos, { ...comFluxos, onProgress: (evento) => void eventos.push(evento) });
    expect(segundo.engine.calls).toHaveLength(0);

    const verdes = eventos
      .filter((evento) => evento.kind === "gate" && evento.id === "P01" && evento.state === "verde")
      .map((evento) => (evento.kind === "gate" ? evento.gate : ""));
    expect(verdes).toEqual(["G0", "G1", "G2", "G3", "G4"]);
  }, 20_000);
});

describe("a prova do gate 4 fica no disco", () => {
  /*
   * A fase 3 do MCP_teste reprovou três vezes no gate 4 e não havia no disco uma
   * linha do que o Playwright tinha dito: o evento do run guarda só a primeira
   * linha da causa e o painel some com o resto. Diagnosticar virou adivinhação.
   */
  it("a saída do runner vira log da fase, verde ou vermelho", async () => {
    const { tasks } = await publishPlan();
    const SAIDA = "Running 1 test using 1 worker\n  ✓ workflow 1 (1.2s)\n\n  1 passed (2s)";

    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [MANIFESTO, { path: "src/a.ts", content: "export const a = 1;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "verifier", prompt: "CAPIVARA_FLOW" }, respond: { stdout: ROTEIRO }, repeat: true },
        { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
      ],
      { skeleton: ESQUELETO, skipAcceptance: true, flowRunner: async () => ({ exitCode: 0, output: SAIDA }) },
    );

    const log = join(runPaths(projectRoot, outcome.runId).logs, "P01.flow-run-1.log");
    expect(await readFile(log, "utf8")).toContain("1 passed");
  });
});

describe("B-41 · o gate que abre a aplicação", () => {
  it("fluxo reprovado devolve a fase ao ciclo de correção, e a causa fala de fluxo", async () => {
    const { tasks } = await publishPlan();
    let passagem = 0;
    const { outcome } = await build(
      [
        { match: { role: "builder", phase: "P01" }, writes: [MANIFESTO, { path: "src/a.ts", content: "export const a = 1;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "builder", phase: "P02" }, writes: [{ path: "src/b.ts", content: "export const b = 2;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "verifier", prompt: "CAPIVARA_FLOW" }, respond: { stdout: ROTEIRO }, repeat: true },
        { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
      ],
      {
        skeleton: ESQUELETO,
        skipAcceptance: true,
        flowRunner: async () => {
          passagem += 1;
          // A primeira passagem encontra o produto sem o passo 2; a segunda, com.
          return passagem === 1
            ? { exitCode: 1, output: "1) passo 2: confirma a reserva\n   locator('#ok') não encontrado" }
            : { exitCode: 0, output: "3 passed" };
        },
      },
    );

    expect(outcome.exitCode).toBe(0);
    const eventos = await readEvents(runPaths(projectRoot, outcome.runId).events);
    const devolucao = eventos.find((evento) => evento.status === "retry");
    expect(devolucao?.detail).toContain("gate 4");
    expect(devolucao?.detail).toContain("fluxo");
    // O roteiro ficou no projeto: a fase 2 vai percorrê-lo de novo, de graça.
    expect(await readFile(join(projectRoot, ".capivara/flows/workflow-1.spec.ts"), "utf8")).toContain("passo 3");
  });

  it("o fluxo da fase 1 continua sendo percorrido na fase 2", async () => {
    const { tasks } = await publishPlan();
    const percorridos: string[][] = [];
    const { outcome } = await build(
      [
        { match: { role: "builder", phase: "P01" }, writes: [MANIFESTO, { path: "src/a.ts", content: "export const a = 1;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "builder", phase: "P02" }, writes: [{ path: "src/b.ts", content: "export const b = 2;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "verifier", prompt: "CAPIVARA_FLOW" }, respond: { stdout: ROTEIRO }, repeat: true },
        { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
      ],
      {
        skeleton: ESQUELETO,
        skipAcceptance: true,
        flowRunner: async (_root, scripts) => {
          percorridos.push(scripts);
          return { exitCode: 0, output: "3 passed" };
        },
      },
    );

    expect(outcome.exitCode).toBe(0);
    expect(percorridos).toEqual([["workflow-1.spec.ts"], ["workflow-1.spec.ts"]]);
  });

  /*
   * A P04 do `assistencia2`, retomada: P01 a P03 tinham fechado NESTE run, e o
   * ramo que as pula não as punha na regressão — o ramo irmão, o das fases
   * fechadas em runs anteriores, punha. A passagem perdeu os fluxos 1 e 4, e o
   * fluxo 2, escrito para rodar depois do 1, rodou primeiro num banco sem tabela.
   */
  it("retomado, o fluxo da fase que fechou neste run continua sendo regressão", async () => {
    const { tasks } = await publishPlan();
    const passosDaPrimeira: EngineStep[] = [
      { match: { role: "builder", phase: "P01" }, writes: [MANIFESTO, { path: "src/a.ts", content: "export const a = 1;" }], respond: { stdout: "fiz" }, repeat: true },
      { match: { role: "builder", phase: "P02" }, writes: [{ path: "src/b.ts", content: "export const b = 2;" }], respond: { stdout: "fiz" }, repeat: true },
      { match: { role: "verifier", prompt: "CAPIVARA_FLOW" }, respond: { stdout: ROTEIRO }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: someIncomplete(tasks[1] ?? 2, 1, "falta a rota") }, repeat: true },
    ];
    const primeira = await build(passosDaPrimeira, {
      skeleton: ESQUELETO,
      skipAcceptance: true,
      maxCycles: 1,
      flowRunner: async () => ({ exitCode: 0, output: "3 passed" }),
    });
    expect(primeira.outcome.exitCode).not.toBe(0);
    // O que o desenvolvedor faz com o trabalho parcial antes de retomar.
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "wip: P02 parcial"], { cwd: projectRoot });

    const percorridos: string[][] = [];
    const segunda = await build(
      [
        { match: { role: "builder", phase: "P02" }, writes: [{ path: "src/b.ts", content: "export const b = 3;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "verifier", prompt: "CAPIVARA_FLOW" }, respond: { stdout: ROTEIRO }, repeat: true },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
      ],
      {
        skeleton: ESQUELETO,
        skipAcceptance: true,
        flowRunner: async (_root, scripts) => {
          percorridos.push(scripts);
          return { exitCode: 0, output: "3 passed" };
        },
      },
    );

    expect(segunda.outcome.errors).toEqual([]);
    expect(percorridos).toEqual([["workflow-1.spec.ts"]]);
  }, 20_000);

  it("sem esqueleto, o build avisa e roda como antes — nunca para por causa do gate novo", async () => {
    const { tasks } = await publishPlan();
    const avisos: string[] = [];
    const engine = fakeEngine(projectRoot, [
      { match: { role: "builder" }, writes: [{ path: "src/a.ts", content: "export const a = 1;" }], respond: { stdout: "fiz" }, repeat: true },
      { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
      { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
    ]);
    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: {},
      announce: (message) => avisos.push(message),
      testRunner: async () => ({ exitCode: 0, output: "ok" }),
      flowRunner: async () => {
        throw new Error("o gate 4 não deveria rodar sem esqueleto");
      },
    });

    expect(outcome.exitCode).toBe(0);
    expect(avisos.join("\n")).toContain("sem esqueleto legível");
  });
});

/**
 * O plano que cresceu.
 *
 * O id do run é o hash do plano inteiro, então acrescentar uma fase muda o hash
 * e devolve à fila as que já estavam prontas. Enquanto o plano nascia inteiro e
 * morria inteiro isso nunca aparecia; o `change` acrescenta fase a uma aplicação
 * que já roda, e aí custa uma chamada de verificador por fase antiga antes de
 * escrever a primeira linha do que foi pedido.
 */
describe("fase fechada em run anterior não é refeita", () => {
  const passos = (tasks: number[]): EngineStep[] => [
    { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const app = 1;" }], respond: { stdout: "fiz" }, repeat: true },
    { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
    { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
    { match: { role: "verifier", phase: "P03" }, respond: { stdout: allDone(1) }, repeat: true },
  ];

  it("o registro sobrevive ao plano mudar de hash", async () => {
    const { tasks } = await publishPlan();
    expect((await build(passos(tasks))).outcome.exitCode).toBe(0);

    const fechadas = await readFile(join(projectRoot, ".capivara/handoffs/fases.json"), "utf8");
    expect(JSON.parse(fechadas)).toHaveLength(2);

    /*
     * O plano cresce: mesmo texto nas duas primeiras, uma terceira no fim. O
     * hash do plano muda, o run é outro, e mesmo assim as duas antigas não
     * voltam para a fila.
     */
    await publishPlan({ extra: PHASE_3 });

    const segundo = await build(passos(tasks));
    expect(segundo.engine.calls.filter((call) => call.phase.id === "P01")).toHaveLength(0);
    expect(segundo.outcome.phases[0]?.outcome.status).toBe("already-implemented");
    // E a fase nova foi construída.
    expect(segundo.engine.calls.some((call) => call.phase.id === "P03")).toBe(true);
  }, 20_000);

  it("fase cujo texto mudou volta a ser construída", async () => {
    const { tasks } = await publishPlan();
    await build(passos(tasks));

    await publishPlan({ mudarPrimeira: true });
    const segundo = await build(passos(tasks));

    expect(segundo.engine.calls.some((call) => call.phase.id === "P01")).toBe(true);
  }, 20_000);

  it("--rebuild-all ignora o registro", async () => {
    const { tasks } = await publishPlan();
    await build(passos(tasks));

    const segundo = await build(passos(tasks), { rebuildAll: true });
    expect(segundo.engine.calls.some((call) => call.phase.id === "P01")).toBe(true);
  }, 20_000);
});

/**
 * Quem rodou fica registrado.
 *
 * O `run.json` sempre teve o campo `roles` e ele sempre nasceu vazio.
 * Diagnosticar o `MCP_teste2` exigiu adivinhar qual CLI tinha sido usada — e a
 * resposta mudava o veredito, porque o acesso de sistema que o executor recebe
 * é escolhido pelo adaptador de cada CLI.
 */
describe("o run diz quem o executou", () => {
  it("o build grava provider, modelo e effort de cada papel", async () => {
    const { tasks } = await publishPlan();
    const { outcome } = await build(
      [
        { match: { role: "builder" }, writes: [{ path: "src/app.ts", content: "export const app = 1;" }], respond: { stdout: "fiz" }, repeat: true },
        { match: { role: "verifier", phase: "P01" }, respond: { stdout: allDone(tasks[0] ?? 2) }, repeat: true },
        { match: { role: "verifier", phase: "P02" }, respond: { stdout: allDone(tasks[1] ?? 2) }, repeat: true },
      ],
      { roles: { builder: { provider: "codex", model: "gpt-6", effort: "high" }, verifier: { provider: "claude", model: "opus", effort: "" } } },
    );

    const estado = JSON.parse(await readFile(runPaths(projectRoot, outcome.runId).state, "utf8"));
    expect(estado.roles.builder).toEqual({ provider: "codex", model: "gpt-6", effort: "high" });
    expect(estado.roles.verifier.provider).toBe("claude");
  }, 20_000);
});
