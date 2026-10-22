/**
 * A autoridade das decisões nas auditorias do INIT e do PLAN (§118).
 *
 * No `teste_openrouter3` (run `init-dc741f0d7b92`) o pedido dizia "testes
 * automatizados"; o esqueleto inventou "Vitest e Playwright" na stack; a
 * arquitetura criou um componente de automação com arquivos de configuração
 * de teste; as fases herdaram tasks com nome de arquivo de teste; e o auditor,
 * vendo o conflito com a regra do planejamento, perguntou ao desenvolvedor se
 * a regra valia — com a primeira leitura "recomendada" por ter sido escrita
 * primeiro. O que se prova aqui: a regra (I-16) é conferida em código nos três
 * documentos, com o pedido e a entrevista como única autoridade para nomear
 * uma ferramenta; uma decisão do auditor que é uma regra do harness vira
 * correção, não pergunta; nenhuma leitura do auditor é recomendada; e uma
 * decisão genuína de produto continua chegando ao desenvolvedor.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAudit } from "../../src/audit/index.js";
import { assemblePhasesDocument, checkTestPrescription, parseArchitecture, parsePhases, parseSkeleton, testPrescriptions } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { evaluateReadiness, readSkeletonState, runInit, runPlan } from "../../src/init/index.js";
import { classifyLocally } from "../../src/interview/classify.js";
import { ID_DO_BANCO, readHandoff } from "../../src/interview/index.js";
import { perguntaDoAuditor } from "../../src/interview/levantamento.js";
import type { AgentCall } from "../../src/init/index.js";
import type { Question } from "../../src/interview/index.js";
import { ARCHITECTURE, PHASE_1, PHASE_2, SKELETON, approve, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

/** A resposta real do auditor da fase 5 (Luna), byte a byte. */
const LUNA_P5 = `CAPIVARA_AUDIT_STATUS: APPROVED
CAPIVARA_DECISION: Phase 5, última tarefa | A fase deve especificar automação própria do módulo, embora as regras de planejamento proíbam requisitos de testes, arquivos de teste e estratégias de validação? | 1) Manter a automação com Vitest e Playwright, conforme a fatia da arquitetura e o pedido original. | 2) Remover os requisitos de automação da fase e deixar a comprovação do produto a cargo do avaliador.
CAPIVARA_REASON: A última tarefa exige automação com Vitest e Playwright, conforme a arquitetura, mas as regras de planejamento proíbem prescrever testes e estratégias de validação.`;

const PEDIDO_SEM_FERRAMENTA = "uma pousada com reservas e testes automatizados com banco isolado";

/** O esqueleto como o Luna o escreveu: a stack decide a ferramenta de teste, e o environment a sonda. */
const SKELETON_CONTAMINADO = JSON.stringify({
  ...JSON.parse(SKELETON),
  stack: [...JSON.parse(SKELETON).stack, { component: "Automação de testes", decision: "Vitest e Playwright como dependências locais do projeto" }],
  environment: [...JSON.parse(SKELETON).environment, { technology: "Playwright", binary: "npx", systemLevel: false, checkArgs: ["playwright", "--version"] }],
  rules: [...JSON.parse(SKELETON).rules, { subject: "banco dos testes", statement: "a suíte automatizada roda contra um banco descartável, criado e destruído pela própria execução" }],
});

/** A arquitetura com o que se separa contando: ferramenta na infraestrutura e arquivo de teste em files. */
const ARQUITETURA_CONTAMINADA = JSON.stringify({
  ...JSON.parse(ARCHITECTURE),
  components: JSON.parse(ARCHITECTURE).components.map((component: { name: string; files: string[] }) =>
    component.name === "api" ? { ...component, files: [...component.files, "vitest.config.ts", "src/quality/reservas/api.test.ts"] } : component,
  ),
  infrastructure: {
    ...JSON.parse(ARCHITECTURE).infrastructure,
    tools: [...JSON.parse(ARCHITECTURE).infrastructure.tools, { name: "Vitest", version: "", purpose: "testes unitários", basis: "stack do esqueleto" }],
    dependencies: [...JSON.parse(ARCHITECTURE).infrastructure.dependencies, { name: "playwright", version: "", kind: "dev", purpose: "fluxos no navegador", basis: "stack do esqueleto" }],
  },
});

/** A fase 2 como o Luna a escreveu: tarefa de automação com ferramenta e arquivo. */
const PHASE_2_CONTAMINADA = `${PHASE_2.trimEnd()}

- [ ] **Task:** Implementar em src/quality/reservas/api.test.ts a automação própria do módulo
  - **Acceptance criteria:**
    - src/quality/reservas/ contém automação local com Vitest e Playwright que executa o fluxo pela aplicação usando um DATABASE_PATH temporário
    - Uma reserva criada permanece consultável após reiniciar a aplicação com o mesmo DATABASE_PATH
  - **Traces:** US-1.1, reservations, workflow 1
`;

/** A mesma exigência, escrita como comportamento: é o que fica. */
const PHASE_2_CORRIGIDA = `${PHASE_2.trimEnd()}

- [ ] **Task:** Aceitar um banco descartável pela mesma variável de ambiente da aplicação
  - **Acceptance criteria:**
    - Com DATABASE_PATH apontando para um arquivo temporário, a aplicação sobe e cria o banco ali sem tocar o banco configurado no .env
    - Uma reserva criada permanece consultável após reiniciar a aplicação com o mesmo DATABASE_PATH
  - **Traces:** US-1.1, reservations, workflow 1
`;

/** O plano montado como o orquestrador monta, com a fase contaminada. */
const PLANO_CONTAMINADO = assemblePhasesDocument({
  projectName: "Pousada",
  stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->",
  overview: "Base",
  phases: [PHASE_1, PHASE_2_CONTAMINADA],
  openQuestions: [],
});

const esqueleto = (): Skeleton => {
  const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
  if (!lido.ok) throw new Error("fixture inválida");
  return lido.skeleton;
};

describe("I-16 — a checagem determinística de prescrição de teste", () => {
  it("reconhece ferramenta, arquivo, diretório e configuração de teste", () => {
    expect(testPrescriptions("automação local com Vitest e Playwright")).toEqual(["Vitest", "Playwright"]);
    expect(testPrescriptions("Implementar em src/quality/reservas/api.test.ts a automação")).toEqual(["src/quality/reservas/api.test.ts"]);
    expect(testPrescriptions("criar vitest.config.ts e tests/reservas.spec.ts")).toEqual(["vitest", "vitest.config.ts", "tests/reservas.spec.ts"]);
    expect(testPrescriptions("os casos ficam em __tests__/")).toEqual(["__tests__/"]);
  });

  it("não toca o lado da aplicação; a condição da suíte, desde a §129, é o pedido de testes dentro do plano", () => {
    expect(testPrescriptions("Com DATABASE_PATH apontando para um arquivo temporário, a aplicação sobe sem tocar o banco do .env")).toEqual([]);
    // Até a §128 isto era "a exigência escrita como comportamento" e ficava no plano; agora é do build.
    expect(testPrescriptions("a suíte automatizada roda contra um banco descartável, criado e destruído pela própria execução")).toEqual(["suíte automatizada roda contra um banco"]);
  });

  it("o pedido e a entrevista são a autoridade: o que eles nomeiam não é prescrição do plano", () => {
    expect(testPrescriptions("suíte com Vitest", ["Quero o projeto testado com Vitest"])).toEqual([]);
    expect(testPrescriptions("suíte com Vitest e Playwright", ["Quero o projeto testado com Vitest"])).toEqual(["Playwright"]);
    // Um produto que É uma ferramenta de teste continua podendo dizê-lo.
    expect(testPrescriptions("um runner compatível com Jest", ["Crie um runner de testes compatível com Jest"])).toEqual([]);
  });

  it("no plano, aponta a task e a fase, com a linha para a emenda ir ao lugar certo", () => {
    const plano = parsePhases(PLANO_CONTAMINADO);
    if (!plano.ok) throw new Error(plano.errors.map((erro) => erro.message).join("; "));
    const erros = checkTestPrescription(plano.document);
    expect(erros).toHaveLength(1);
    expect(erros[0]?.code).toBe("I-16");
    expect(erros[0]?.message).toContain("da fase 2 prescreve teste");
    expect(erros[0]?.message).toContain("Vitest");
    expect(erros[0]?.line).toBeGreaterThan(0);
    expect(erros[0]?.hint).toContain("executado pelo build");
    expect(erros[0]?.hint).not.toContain("mova-o");
    expect(checkTestPrescription(plano.document, ["use Vitest e Playwright e guarde em src/quality/reservas/api.test.ts"])).toEqual([]);
  });
});

describe("I-16 no esqueleto: a stack não escolhe a ferramenta de teste", () => {
  it("a entrada de stack sobre testes e a sonda da ferramenta saem contando; a regra do banco isolado fica", () => {
    const lido = parseSkeleton(SKELETON_CONTAMINADO, { maxTasksPerPhase: 15 });
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    if (!lido.ok) return;
    expect(lido.skeleton.stack.map((item) => item.component)).toEqual(["Linguagem", "Banco"]);
    expect(lido.skeleton.environment.map((item) => item.technology)).toEqual(["Node.js", "PostgreSQL"]);
    expect(lido.skeleton.rules.some((regra) => regra.subject === "banco dos testes")).toBe(true);
    expect(lido.applied.join("\n")).toContain('removeu da stack "Automação de testes: Vitest e Playwright');
    expect(lido.applied.join("\n")).toContain('removeu do environment a sonda de "Playwright"');
  });

  it("uma entrada de outro componente que cita a ferramenta não é apagada: vira defeito nomeado", () => {
    const torto = JSON.stringify({ ...JSON.parse(SKELETON), stack: [{ component: "Linguagem", decision: "TypeScript, testado com Vitest" }] });
    const lido = parseSkeleton(torto, { maxTasksPerPhase: 15 });
    expect(lido.ok).toBe(false);
    if (!lido.ok) expect(lido.defects.map((d) => d.problem).join(" ")).toContain("a stack prescreve teste");
  });

  it("com o pedido nomeando a ferramenta, ela fica", () => {
    const lido = parseSkeleton(SKELETON_CONTAMINADO, { maxTasksPerPhase: 15, authority: ["quero Vitest e Playwright"] });
    expect(lido.ok).toBe(true);
    if (lido.ok) expect(lido.skeleton.stack.map((item) => item.component)).toContain("Automação de testes");
  });
});

describe("I-16 na arquitetura: o arquivo de teste sai contando; a dependência de teste fica na infraestrutura; prosa volta ao arquiteto", () => {
  it("a ferramenta de teste fica na infraestrutura, para o build validá-la uma vez (§129); o arquivo de teste sai de files, anunciando", () => {
    const lida = parseArchitecture(ARQUITETURA_CONTAMINADA, esqueleto(), { maxTasksPerPhase: 15 });
    expect(lida.ok, lida.ok ? "" : JSON.stringify(lida.defects)).toBe(true);
    if (!lida.ok) return;
    // Até a §128 elas saíam; agora a infraestrutura lista todas as dependências, as de teste também.
    expect(lida.architecture.infrastructure.tools.map((item) => item.name)).toEqual(["TypeScript", "Vitest"]);
    expect(lida.architecture.infrastructure.dependencies.map((item) => item.name)).toEqual(["pg", "playwright"]);
    expect(lida.architecture.components.find((c) => c.name === "api")?.files).toEqual(["src/api/reservas.ts"]);
    const notas = lida.applied.join("\n");
    expect(notas).not.toContain("removeu Vitest");
    expect(notas).toContain('removeu de api.files "vitest.config.ts", "src/quality/reservas/api.test.ts"');
  });

  it("o propósito de um runner diz o que ele roda e fica; o procedimento da execução volta ao arquiteto; a compatibilidade da ferramenta fica, o requisito não", () => {
    const base = JSON.parse(ARCHITECTURE);
    const comPropositos = (purpose: string) => JSON.stringify({ ...base, infrastructure: { ...base.infrastructure, dependencies: [...base.infrastructure.dependencies, { name: "vitest", version: "", kind: "dev", purpose, basis: "exigência técnica: o build executa os testes que o pedido exige" }] } });
    expect(parseArchitecture(comPropositos("roda os testes automatizados do backend contra um banco descartável"), esqueleto(), { maxTasksPerPhase: 15 }).ok).toBe(true);
    const comProcedimento = parseArchitecture(comPropositos("a execução dos testes cria e destrói o banco temporário"), esqueleto(), { maxTasksPerPhase: 15 });
    expect(comProcedimento.ok).toBe(false);
    if (!comProcedimento.ok) expect(comProcedimento.defects.map((d) => d.problem).join(" ")).toContain("o item vitest de infrastructure.dependencies prescreve teste");
    const comCompatibilidade = { ...base, infrastructure: { ...base.infrastructure, compatibility: [...(base.infrastructure.compatibility ?? []), "O Playwright exige Node 18 ou superior"] } };
    expect(parseArchitecture(JSON.stringify(comCompatibilidade), esqueleto(), { maxTasksPerPhase: 15 }).ok).toBe(true);
    const comRequisito = { ...base, infrastructure: { ...base.infrastructure, compatibility: [...(base.infrastructure.compatibility ?? []), "A aplicação possui testes automatizados e os fluxos acessam um banco isolado"] } };
    expect(parseArchitecture(JSON.stringify(comRequisito), esqueleto(), { maxTasksPerPhase: 15 }).ok).toBe(false);
  });

  it("um componente cuja responsabilidade é configurar a ferramenta é defeito, não conserto", () => {
    const comAutomacao = JSON.stringify({
      ...JSON.parse(ARCHITECTURE),
      components: [...JSON.parse(ARCHITECTURE).components, { name: "automacao", responsibility: "Configurar Vitest e Playwright e executar a automação contra um banco descartável", areas: ["backend"], dependsOn: ["api"], contracts: [], files: ["src/quality/"], owns: [] }],
    });
    const lida = parseArchitecture(comAutomacao, esqueleto(), { maxTasksPerPhase: 15 });
    expect(lida.ok).toBe(false);
    if (!lida.ok) {
      const problemas = lida.defects.map((d) => d.problem).join(" | ");
      expect(problemas).toContain("o componente automacao prescreve teste: Vitest, Playwright");
    }
    const autorizada = parseArchitecture(comAutomacao, esqueleto(), { maxTasksPerPhase: 15, authority: ["use Vitest e Playwright"] });
    expect(autorizada.ok).toBe(true);
  });
});

describe("o gate RALPH READY confere a prescrição de teste", () => {
  it("um plano que prescreve teste é NOT READY pela verificação própria", () => {
    const readiness = evaluateReadiness({
      plan: PLANO_CONTAMINADO, architecture: "# arq", stampInputs: [], coverage: { storyIds: [], entities: [], workflows: [] },
      approved: true, unresolvedQuestions: [], designRoot: "/nenhum", designExists: () => true, rehearsal: { blocked: [] },
    });
    const testes = readiness.checks.find((check) => check.id === "testes");
    expect(testes?.passed).toBe(false);
    expect(testes?.detail).toContain("Vitest");
    expect(readiness.ready).toBe(false);
  });
});

describe("a decisão do auditor não traz leitura recomendada", () => {
  it("Enter vazio e 'use as recomendações' não confirmam nada", () => {
    const parsed = parseAudit(LUNA_P5);
    if (!parsed.ok) throw new Error(parsed.defects.join("; "));
    const pergunta = perguntaDoAuditor(parsed.verdict.decisions![0]!, 1);
    expect(pergunta.recommended).toBe("");
    expect(pergunta.options).toHaveLength(2);
    expect(classifyLocally(pergunta, "").disposition).toBe("DEFERRED");
    expect(classifyLocally(pergunta, "use as recomendações").disposition).toBe("DEFERRED");
    expect(classifyLocally(pergunta, "2").disposition).toBe("ACCEPTED");
  });
});

describe("no orquestrador, com o provider falso", () => {
  let projectRoot = "";
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "capivara-118-"));
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const pedido = (text: string) => ({ text, origin: "text" as const, path: null, sha12: "abc123abc123" });
  const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "1");
  const por = (agent: { calls: AgentCall[] }, filtro: Partial<AgentCall>) =>
    agent.calls.filter((call) => Object.entries(filtro).every(([chave, valor]) => (call as unknown as Record<string, unknown>)[chave] === valor));

  async function init(steps: ScriptStep[], request = pedido(PEDIDO_SEM_FERRAMENTA)) {
    const dito: string[] = [];
    const agent = fakeAgent(steps);
    const outcome = await runInit({ projectRoot, request, language: "português do Brasil", stage: "init", call: agent.call, ask: responde, announce: (linha) => void dito.push(linha) });
    return { outcome, agent, anunciado: dito.join("\n") };
  }

  async function plan(steps: ScriptStep[], extras: { ask?: (question: Question) => Promise<string>; request?: ReturnType<typeof pedido> } = {}) {
    const dito: string[] = [];
    const agent = fakeAgent(steps);
    const outcome = await runPlan({
      projectRoot, request: extras.request ?? pedido(PEDIDO_SEM_FERRAMENTA), language: "português do Brasil", call: agent.call,
      ask: extras.ask ?? responde, announce: (linha) => void dito.push(linha), sleep: async () => undefined,
    });
    return { outcome, agent, anunciado: dito.join("\n") };
  }

  /** O roteiro do plan com a fase 2 escrita de um jeito na primeira vez e de outro na emenda. */
  const faseDoisEmDuasVersoes = (primeira: string, segunda: string): ScriptStep[] => {
    let vezes = 0;
    return [
      { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: () => ((vezes += 1) === 1 ? primeira : segunda) }, repeat: true },
      ...skeletonPath().filter((passo) => passo.match.subject !== "phase-p02"),
    ];
  };

  it("1–2. a resposta real do Luna não vira pergunta: a regra é aplicada como correção e o plano fecha", async () => {
    await init(skeletonPath());
    // A fixture tem duas fases; o endereço da decisão é a única adaptação do texto real.
    const resposta = LUNA_P5.replace("Phase 5, última tarefa", "Phase 2, última tarefa");
    let auditou = 0;
    const perguntadas: Question[] = [];
    const passos: ScriptStep[] = [
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2" }, respond: { stdout: () => ((auditou += 1) === 1 ? resposta : approve()) }, repeat: true },
      ...faseDoisEmDuasVersoes(PHASE_2, PHASE_2_CORRIGIDA),
    ];
    const { outcome, agent, anunciado } = await plan(passos, { ask: async (question) => { perguntadas.push(question); return "1"; } });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    // Ninguém foi perguntado se a regra do planejamento vale.
    expect(perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"))).toEqual([]);
    expect(anunciado).toContain("levantou como decisão uma regra do planejamento");
    // A correção chegou ao escritor da fase 2, como achado mecânico: tirar a prescrição (a ferramenta), nada no lugar.
    const escritas = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" });
    expect(escritas).toHaveLength(2);
    expect(escritas[1]?.prompt).toContain("I-16");
    expect(escritas[1]?.prompt).toContain("executado pelo build");
    // Nada do auditor virou decisão confirmada do desenvolvedor.
    const handoff = await readHandoff(projectRoot, outcome.runId, "project-phases.md");
    expect((handoff?.answers ?? []).filter((answer) => answer.decision.includes("Vitest"))).toEqual([]);
  });

  it("3–5. a contaminação é corrigida nos três documentos sem perder a exigência do pedido", async () => {
    const { anunciado: doInit } = await init([
      ...skeletonPath().filter((passo) => passo.match.subject !== "skeleton"),
      { match: { role: "writer", stage: "authoring", subject: "skeleton" }, respond: { stdout: SKELETON_CONTAMINADO }, repeat: true },
    ]);
    expect(doInit).toContain('removeu da stack "Automação de testes');
    const esqueletoPublicado = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
    expect(esqueletoPublicado).not.toContain("Vitest");
    expect(esqueletoPublicado).toContain("banco dos testes");

    const passos: ScriptStep[] = [
      { match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: ARQUITETURA_CONTAMINADA }, repeat: true },
      ...faseDoisEmDuasVersoes(PHASE_2_CONTAMINADA, PHASE_2_CORRIGIDA).filter((passo) => passo.match.subject !== "architecture"),
    ];
    const { outcome, agent, anunciado } = await plan(passos);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    // A infraestrutura lista as dependências de teste (§129): o build as tem antes da primeira fase.
    expect(anunciado).not.toContain("removeu Vitest de infrastructure.tools");
    const arquitetura = await readFile(join(projectRoot, ".capivara/init/architecture.md"), "utf8");
    expect(arquitetura).toMatch(/vitest/i);
    expect(arquitetura).not.toContain("vitest.config.ts");
    // As fases continuam sem dizer como testar: nem ferramenta, nem arquivo.
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).not.toMatch(/vitest|playwright|\.test\.ts/i);
    expect(plano).toContain("Uma reserva criada permanece consultável após reiniciar a aplicação");
    const ambiente = JSON.parse(await readFile(join(projectRoot, ".capivara/init/environment.json"), "utf8")) as { infrastructure?: { tools?: { name: string }[] } };
    expect((ambiente.infrastructure?.tools ?? []).map((item) => item.name)).toContain("Vitest");

    // A emenda foi mecânica, só na fase 2, antes de qualquer auditor ler a prescrição.
    const escritas = por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" });
    expect(escritas).toHaveLength(2);
    expect(escritas[1]?.prompt).toContain("I-16");
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p01" })).toHaveLength(1);
    // A arquitetura e as fases continuam coerentes: a divisão publicada é a mesma.
    const esqueleto = await readSkeletonState(projectRoot, outcome.runId);
    expect(esqueleto?.phases.map((fase) => fase.title)).toEqual(["Fundação de dados", "Criar reserva"]);
  });

  it("6. uma decisão genuína de produto continua chegando ao desenvolvedor, sem leitura recomendada", async () => {
    await init(skeletonPath());
    let auditou = 0;
    const decisao = `${approve()}\nCAPIVARA_DECISION: P2.T1.C1 | A reserva nova nasce pendente ou já confirmada? | Pendente, até o pagamento | Confirmada no ato`;
    const perguntadas: Question[] = [];
    const passos: ScriptStep[] = [
      { match: { role: "auditor", stage: "audit", subject: "project-phases.md#P2" }, respond: { stdout: () => ((auditou += 1) === 1 ? decisao : approve()) }, repeat: true },
      ...faseDoisEmDuasVersoes(PHASE_2, PHASE_2_CORRIGIDA),
    ];
    const { outcome } = await plan(passos, { ask: async (question) => { perguntadas.push(question); return "1"; } });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const daAuditoria = perguntadas.filter((pergunta) => pergunta.topic.startsWith("auditoria ·"));
    expect(daAuditoria).toHaveLength(1);
    expect(daAuditoria[0]?.decision).toContain("pendente ou já confirmada");
    expect(daAuditoria[0]?.recommended).toBe("");
    const handoff = await readHandoff(projectRoot, outcome.runId, "project-phases.md");
    expect(handoff?.answers.some((answer) => answer.decision === "Pendente, até o pagamento" && answer.raw === "1")).toBe(true);
  });

  it("o pedido que nomeia a ferramenta é autoridade: a task que a cita passa sem emenda", async () => {
    const comFerramenta = pedido("uma pousada com reservas; os testes usam Vitest e Playwright em src/quality/reservas/api.test.ts");
    await init(skeletonPath(), comFerramenta);
    const { outcome, agent } = await plan(faseDoisEmDuasVersoes(PHASE_2_CONTAMINADA, PHASE_2_CORRIGIDA), { request: comFerramenta });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(por(agent, { role: "writer", stage: "authoring", subject: "phase-p02" })).toHaveLength(1);
    expect(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")).toContain("Vitest");
  });
});
