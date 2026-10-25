/**
 * O ciclo em dois estágios: init entrega as fases, plan as detalha.
 *
 * O corte fica onde o custo muda de ordem de grandeza — o `init` é uma chamada,
 * o `plan` são dezenas. Errar a divisão do produto passa a custar minutos em vez
 * de horas, porque o esqueleto é pequeno o bastante para se olhar antes de pagar
 * pelo detalhe.
 */

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, evaluatePlanReadiness, readRequestState, runInit, runPlan } from "../../src/init/index.js";
import { ID_DO_BANCO, readHandoff } from "../../src/interview/index.js";
import { paradaDoEstagio } from "../../src/commands/paradas.js";
import { readPlanCache, writePlanCache } from "../../src/init/plan-cache.js";
import type { Question } from "../../src/interview/index.js";
import { parseSkeleton } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { PHASE_1, SKELETON, fakeAgent, oneQuestion, reject, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-ciclo-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };

/** A pergunta chega a quem responde: alguns testes decidem pelo tópico dela. */
type Perguntar = (question: Question, index: number, total: number) => Promise<string>;

const comum = {
  language: "português do Brasil" as const,
  ask: (async () => "use as recomendações") as Perguntar,
};

async function init(steps: ScriptStep[], ask?: (typeof comum)["ask"]) {
  const agent = fakeAgent(steps);
  const outcome = await runInit({ projectRoot, request, ...comum, stage: "init", call: agent.call, ...(ask ? { ask } : {}) });
  return { outcome, agent };
}

async function planComAnuncioEResposta(steps: ScriptStep[], ask: (typeof comum)["ask"], options: { fresh?: boolean } = {}) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  const outcome = await runPlan({ projectRoot, request, ...comum, ...options, ask, call: agent.call, announce: (linha) => void dito.push(linha) });
  return { outcome, agent, anunciado: dito.join("\n") };
}

async function planComAnuncio(steps: ScriptStep[]) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  const outcome = await runPlan({ projectRoot, request, ...comum, call: agent.call, announce: (linha) => void dito.push(linha) });
  return { outcome, agent, anunciado: dito.join("\n") };
}

async function plan(steps: ScriptStep[], ask?: (typeof comum)["ask"]) {
  const agent = fakeAgent(steps);
  const outcome = await runPlan({ projectRoot, request, ...comum, call: agent.call, ...(ask ? { ask } : {}) });
  return { outcome, agent };
}

const esqueletoLido = (): Skeleton => {
  const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
  if (!lido.ok) throw new Error("fixture inválida");
  return lido.skeleton;
};


describe("estágio 1 — init", () => {
  it("plan publica pré-requisitos vinculados ao esqueleto sem uma sessão extra de modelo", async () => {
    await init(skeletonPath());
    const { outcome, agent } = await plan(skeletonPath());
    expect(outcome.readiness.ready).toBe(true);
    const metadata = JSON.parse(await readFile(join(projectRoot, ".capivara/init/environment.json"), "utf8"));
    expect(metadata.contract).toBe("capivara-environment/v3");
    expect(metadata.skeletonSha12).toMatch(/^[a-f0-9]{12}$/);
    const { sha12 } = await import("../../src/contract/index.js");
    expect(metadata.planSha12).toBe(sha12(await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8")));
    expect(Array.isArray(metadata.requirements)).toBe(true);
    expect(agent.calls.some(call => call.subject === "environment")).toBe(false);
  });

  it("entrega as fases e para em PLAN READY", async () => {
    const { outcome } = await init(skeletonPath());
    expect(outcome.rendered).toContain("PLAN READY");
    expect(outcome.readiness.ready).toBe(true);
    expect(outcome.report.phases).toBe(2);
  });

  it("não detalha fase nenhuma: quem detalha é o plan", async () => {
    const { agent } = await init(skeletonPath());
    expect(agent.calls.some((call) => call.subject.startsWith("phase-"))).toBe(false);
    await expect(readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8")).rejects.toThrow();
  });

  it("custa poucas chamadas: é o estágio barato de errar", async () => {
    const { agent } = await init(skeletonPath());
    expect(agent.calls.length).toBeLessThanOrEqual(3);
  });

  it("publica o esqueleto para ser lido antes de pagar pelo detalhe", async () => {
    await init(skeletonPath());
    const esqueleto = await readFile(join(projectRoot, ".capivara", "init", "skeleton.md"), "utf8");
    expect(esqueleto).toContain("## Fases");
    expect(esqueleto).toContain("Regras transversais");
  });

  /*
   * O id do run é o hash do pedido, e é por ele que o `plan` reencontra o
   * esqueleto. Se o `init` não registrar qual pedido usou, o `plan` só acha o
   * esqueleto de quem por acaso chamou o arquivo de `pedido.md`.
   */
  it("registra qual pedido gerou o esqueleto, para o plan retomá-lo", async () => {
    await init(skeletonPath());
    expect((await readRequestState(projectRoot))?.text).toBe(request.text);
  });
});

describe("regressões de teste_minimax", () => {
  it("publica regras de SQLite que mantêm o banco normal separado do banco dos testes", async () => {
    await init(skeletonPath());
    const skeleton = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
    expect(skeleton).toContain("caminho do arquivo do banco");
    expect(skeleton).toContain("local persistente");
    expect(skeleton).toContain("outro arquivo temporário");
    expect(skeleton).not.toContain("host, porta, usuário, senha e nome da base");
  });

  it("aplica emenda com negrito incompleto preservando a correção, sem gastar outra rodada", async () => {
    await init(skeletonPath());
    const steps = skeletonPath();
    let audits = 0;
    steps.unshift({ match: { role: "auditor", stage: "audit", subject: "project-phases.md" }, repeat: true,
      respond: { stdout: () => ++audits === 1 ? reject("Phase 1", "falta prazo no seed", "declare prazo de 37 dias") : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: ok" },
    });
    const corrected = PHASE_1.replace("A tabela statuses existe", "O seed preserva a garantia de 37 dias e a tabela statuses existe").replace("**Acceptance criteria:**", "**Acceptance criteria:");
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 2 }, respond: { stdout: corrected } });
    const { outcome, anunciado, agent } = await planComAnuncio(steps);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(anunciado).not.toContain("emenda recusada");
    const published = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(published).toContain("garantia de 37 dias");
    expect(agent.calls.filter(call => call.stage === "authoring" && call.subject === "phase-p01")).toHaveLength(2);
  });


  it("preserva a evidência de cada chamada e da retomada", async () => {
    const initialized = await init(skeletonPath());
    const initialCount = initialized.agent.calls.length;
    const first = fakeAgent(skeletonPath());
    const outcome = await runPlan({ projectRoot, request, ...comum, call: first.call });
    const root = join(projectRoot, ".capivara/runs", outcome.runId);
    const before = new Map(await Promise.all((await readdir(join(root, "prompts"))).map(async name => [name, await readFile(join(root, "prompts", name), "utf8")] as const)));
    expect(before.size).toBe(initialCount + first.calls.length);
    const second = fakeAgent(skeletonPath());
    await runPlan({ projectRoot, request, ...comum, call: second.call, fresh: true });
    const prompts = await readdir(join(root, "prompts"));
    const logs = await readdir(join(root, "logs"));
    expect(prompts.length).toBe(before.size + second.calls.length);
    expect(logs.length).toBe(prompts.length);
    for (const [name, content] of before) expect(await readFile(join(root, "prompts", name), "utf8")).toBe(content);
    const state = JSON.parse(await readFile(join(root, "run.json"), "utf8"));
    expect(state.command).toBe("plan");
  });
});

describe("reprovação mecânica não é decisão de produto", () => {
  const densePhase = PHASE_1.replace("  - **Acceptance criteria:**", "  - **Acceptance criteria:**\n    - Condição observável A\n    - Condição observável B\n    - Condição observável C\n    - Condição observável D");
  const stepsWithDensePhase = () => {
    const steps = skeletonPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: densePhase }, repeat: true });
    return steps;
  };

  it("a conferência mecânica que não fecha para o plan, sem pergunta e sem publicar", async () => {
    await init(skeletonPath());
    const agent = fakeAgent(stepsWithDensePhase());
    await expect(runPlan({ projectRoot, request, ...comum, call: agent.call, maxMechanicalRounds: 1 })).rejects.toThrow(/a conferência mecânica do plano não fechou/);
    // A conferência é do Core: nenhum auditor é chamado a julgar o plano que ela recusa.
    expect(agent.calls.filter(call => call.role === "auditor" && call.subject === "project-phases.md")).toHaveLength(0);
    await expect(readFile(join(projectRoot, ".capivara/init/project-phases.md"))).rejects.toThrow();
  });
});

describe("estágio 2 — plan", () => {
  it("retoma o esqueleto do init e chega a RALPH READY", async () => {
    await init(skeletonPath());
    const { outcome } = await plan(skeletonPath());

    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    expect(plano).toContain("Phase 1");
    expect(plano).toContain("Phase 2");
  });

  it("não reescreve o esqueleto nem reentrevista", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    expect(agent.calls.some((call) => call.subject === "skeleton")).toBe(false);
    expect(agent.calls.some((call) => call.stage === "interview")).toBe(false);
  });

  it("sem init antes, diz o que fazer em vez de tentar adivinhar", async () => {
    await expect(plan(skeletonPath())).rejects.toThrow(/capivara init/);
  });

  it("cada fase continua vendo só a sua fatia", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const fase2 = agent.calls.find((call) => call.subject === "phase-p02");
    expect(fase2?.prompt).toContain("US-1.1");
    expect(fase2?.prompt).not.toContain("pertence a statuses");
  });
});

describe("a entrevista do plan — o que só a escrita da fase descobre", () => {
  /** A fase 1 sai com uma decisão em aberto; o resto do roteiro é o feliz. */
  function comLacuna(): ScriptStep[] {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: { stdout: `${PHASE_1}\n[NEEDS DECISION] qual provedor de email envia a confirmação\n` },
    });
    /*
     * O id precisa ser `Q-NN`: o protocolo recusa qualquer outro, e o fixture
     * usava `Q-G1`. O lote era rejeitado, a rodada de lacunas desistia EM
     * SILÊNCIO, e o teste passava mesmo assim porque a auditoria acabava
     * removendo o marcador por outro caminho. O silêncio escondia o defeito na
     * nossa própria fixture — que é o mesmo que ele escondeu em produção.
     */
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: { stdout: oneQuestion() },
    });
    return steps;
  }

  it("marcador deixado pela fase vira pergunta, e a resposta some com o marcador", async () => {
    await init(skeletonPath());
    const { outcome, agent, anunciado } = await planComAnuncioEResposta(comLacuna(), async () => "1");

    const lacuna = agent.calls.find((call) => call.subject === "project-phases.md:gaps");
    expect(lacuna?.prompt).toContain("qual provedor de email envia a confirmação");
    // A rodada de lacunas ACONTECEU — e é isso que o silêncio escondia.
    expect(anunciado).toContain("decisão(ões) pendente(s) nas fases");
    expect(anunciado).not.toContain("não consegui transformar");
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    expect(plano).not.toContain("[NEEDS DECISION]");
  });

  it("a rodada de lacunas leva junto, com as palavras dele, o que o init já fechou", async () => {
    const comEntrevista = skeletonPath();
    comEntrevista.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: oneQuestion() },
    });
    await init(comEntrevista, async () => "1");

    const { agent } = await plan(comLacuna(), async () => "1");
    const lacuna = agent.calls.find((call) => call.subject === "project-phases.md:gaps");
    expect(lacuna?.prompt).toContain("Never ask again what the developer already answered");
    expect(lacuna?.prompt).toContain("Node + Vitest");
  });

  it("sem marcador nenhum, ninguém é perguntado", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());
    expect(agent.calls.some((call) => call.subject === "project-phases.md:gaps")).toBe(false);
  });
});

describe("o gate PLAN READY", () => {
  it("story que nenhuma fase entrega bloqueia", () => {
    const esqueleto = esqueletoLido();
    const semCobertura: Skeleton = {
      ...esqueleto,
      stories: [...esqueleto.stories, { id: "US-9.9", statement: "algo que ninguém constrói" }],
    };
    const readiness = evaluatePlanReadiness({ skeleton: semCobertura, unresolvedQuestions: [] });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === "cobertura")?.detail).toContain("US-9.9");
  });

  it("fase que depende do futuro bloqueia: o loop não volta atrás", () => {
    const esqueleto = esqueletoLido();
    const invertido: Skeleton = {
      ...esqueleto,
      phases: esqueleto.phases.map((phase) => (phase.number === 1 ? { ...phase, dependsOn: "Phase 2" } : phase)),
    };
    const readiness = evaluatePlanReadiness({ skeleton: invertido, unresolvedQuestions: [] });
    expect(readiness.checks.find((check) => check.id === "ordem")?.passed).toBe(false);
  });

  it("regra transversal vaga bloqueia: é o acordo entre fases que não se veem", () => {
    const esqueleto = esqueletoLido();
    const vaga: Skeleton = { ...esqueleto, rules: [{ subject: "", statement: "normalizar" }] };
    const readiness = evaluatePlanReadiness({ skeleton: vaga, unresolvedQuestions: [] });
    expect(readiness.checks.find((check) => check.id === "regras")?.passed).toBe(false);
  });

  it("decisão em aberto bloqueia", () => {
    const readiness = evaluatePlanReadiness({ skeleton: esqueletoLido(), unresolvedQuestions: ["stack: qual banco"] });
    expect(readiness.ready).toBe(false);
  });

  it("esqueleto íntegro passa", () => {
    expect(evaluatePlanReadiness({ skeleton: esqueletoLido(), unresolvedQuestions: [] }).ready).toBe(true);
  });

  it("sem esqueleto, o gate diz que falta rodar o init", () => {
    const readiness = evaluatePlanReadiness({ skeleton: null, unresolvedQuestions: [] });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks[0]?.detail).toContain("init");
  });
});

describe("o esqueleto guardado e a entrevista do esqueleto não brigam pelo mesmo arquivo", () => {
  it("as respostas do init sobrevivem à gravação do esqueleto", async () => {
    const comEntrevista = skeletonPath();
    comEntrevista.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: oneQuestion() },
    });
    const agent = fakeAgent(comEntrevista);
    await runInit({ projectRoot, request, ...comum, stage: "init", call: agent.call, ask: async () => "1" });

    const handoffs = join(projectRoot, ".capivara", "handoffs");
    const arquivos = await readdir(handoffs);
    expect(arquivos.sort()).toEqual(arquivos.sort().filter((nome) => nome.endsWith(".json")));
    /*
     * Os dois convivem: o que colidiu uma vez foi o nome, não a pasta. Contar
     * arquivos aqui só prenderia o teste a quem mais escreve em handoffs.
     */
    expect(arquivos.filter((nome) => nome.endsWith(".skeleton.json"))).toHaveLength(1);
    expect(arquivos.filter((nome) => nome.endsWith(".skeleton-state.json"))).toHaveLength(1);

    const entrevista = arquivos.find((nome) => nome.endsWith(".skeleton.json"));
    // Duas: a pergunta do roteiro e a de banco, que o harness faz em toda entrevista.
    const guardado = JSON.parse(await readFile(join(handoffs, entrevista ?? ""), "utf8")) as { answers: { questionId: string }[] };
    expect(guardado.answers).toHaveLength(2);
    expect(guardado.answers.some((answer) => answer.questionId === ID_DO_BANCO)).toBe(true);
  });
});

describe("a auditoria do plano lê o plano inteiro contra as fontes", () => {
  it("uma chamada, com o esqueleto, a arquitetura e todas as fases", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const auditorias = agent.calls.filter((call) => call.role === "auditor" && call.subject === "project-phases.md");
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]?.prompt).toContain("pertence a statuses");
    expect(auditorias[0]?.prompt).toContain("## Upstream document: architecture.md");
    expect(auditorias[0]?.prompt).toContain("## Phase 1: Fundação de dados");
    expect(auditorias[0]?.prompt).toContain("## Phase 2: Criar reserva");
  });
});

describe("o esqueleto é conferido no laço, não só no portão", () => {
  /** Um esqueleto que passa no parser e deixa uma story sem fase que a entregue. */
  const semCobertura = JSON.stringify({
    ...JSON.parse(SKELETON),
    stories: [
      { id: "US-1.1", statement: "Como hóspede, crio uma reserva" },
      { id: "US-2.2", statement: "Como operador, suspendo um membro" },
    ],
  });

  it("story que nenhuma fase entrega volta ao escritor com o defeito nomeado", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton", attempt: 1 },
      respond: { stdout: semCobertura },
    });

    const { outcome, agent } = await init(steps);

    const segunda = agent.calls.find(
      (call) => call.subject === "skeleton" && call.stage === "authoring" && call.attempt === 2,
    );
    expect(segunda, "o escritor precisa ganhar uma segunda tentativa").toBeDefined();
    expect(segunda?.prompt).toContain("US-2.2");
    // E o run chega ao gate, em vez de morrer nele.
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });

  it("corrigido na segunda tentativa, não há terceira", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton", attempt: 1 },
      respond: { stdout: semCobertura },
    });

    const { agent } = await init(steps);
    const tentativas = agent.calls.filter((call) => call.subject === "skeleton" && call.stage === "authoring");
    expect(tentativas).toHaveLength(2);
  });

  it("insistindo no defeito, o run publica e o portão reporta NOT READY em vez de estourar", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: semCobertura },
      repeat: true,
    });

    const { outcome, agent } = await init(steps);
    expect(agent.calls.filter((call) => call.subject === "skeleton" && call.stage === "authoring")).toHaveLength(3);
    expect(outcome.readiness.ready).toBe(false);
    expect(outcome.rendered).toContain("US-2.2");
  });
});

describe("fase sem task é resposta inválida, não resultado", () => {
  it("o escritor ganha uma segunda tentativa quando a fase volta vazia", async () => {
    await init(skeletonPath());

    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 1 },
      respond: { stdout: "Claro! Aqui está a fase, sem nenhuma task." },
    });

    const { outcome, agent } = await plan(steps);
    const tentativas = agent.calls.filter((call) => call.subject === "phase-p01" && call.stage === "authoring");
    expect(tentativas.length, "a fase vazia precisa custar uma segunda chamada").toBeGreaterThanOrEqual(2);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });

  it("insistindo no vazio, o run para dizendo o que verificar", async () => {
    await init(skeletonPath());

    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: { stdout: "" },
      repeat: true,
    });

    // Antes disto o plano seguia vazio para a auditoria, o ensaio e o gate, que o
    // reprovava por I-07 — muitas chamadas depois de o defeito ser conhecível.
    await expect(plan(steps)).rejects.toThrow(/sem nenhuma task em três tentativas: duas do writer e uma do auditor/);
  });
});

/*
 * A retomada do `plan`.
 *
 * No `assitencia` o run morreu duas vezes perto do fim — impasse do auditor e
 * ensaio do verificador — e nas duas as 18 fases foram reescritas do zero, 5.190
 * segundos de escritor cada vez, para produzir o mesmo texto.
 */
describe("o plan não repaga o que já escreveu", () => {
  it("aprova task com linhas em branco na primeira escrita, sem pedir decisão ou reescrita", async () => {
    await init(skeletonPath());
    const steps = skeletonPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, repeat: true,
      respond: { stdout: PHASE_1.replace(/^( +-.+)$/gm, "\n$1\n") } });
    const { outcome, agent } = await plan(steps, async () => { throw new Error("espaçamento não exige decisão do usuário"); });
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
    expect(agent.calls.filter(call => call.stage === "authoring" && call.subject === "phase-p01")).toHaveLength(1);
  });

  it("retoma as fases com linhas em branco já salvas em cache sem chamar o escritor", async () => {
    await init(skeletonPath());
    const primeira = await plan(skeletonPath());
    const cache = await readPlanCache(projectRoot, primeira.outcome.runId);
    expect(Object.keys(cache.escritas)).toHaveLength(2);
    for (const [key, markdown] of Object.entries(cache.escritas)) {
      cache.escritas[key] = markdown.replace(/^( +-.+)$/gm, "\n$1\n");
    }
    await writePlanCache(projectRoot, cache);
    const segunda = await plan(skeletonPath(), async () => { throw new Error("cache completo não exige decisão"); });
    expect(segunda.outcome.readiness.ready, segunda.outcome.rendered).toBe(true);
    expect(segunda.agent.calls.filter(call => call.stage === "authoring")).toHaveLength(0);
  });

  it("reaproveita as fases quando o prompt não mudou, e não chama o escritor", async () => {
    await init(skeletonPath());
    const primeira = await plan(skeletonPath());
    const escritasNaPrimeira = primeira.agent.calls.filter((call) => call.stage === "authoring").length;
    expect(escritasNaPrimeira).toBeGreaterThan(0);

    const segunda = await plan(skeletonPath());
    expect(segunda.agent.calls.filter((call) => call.stage === "authoring")).toHaveLength(0);
    expect(segunda.outcome.readiness.ready).toBe(true);
  });

  it("anuncia o reaproveitamento: economia calada parece run quebrado", async () => {
    await init(skeletonPath());
    await plan(skeletonPath());

    const dito: string[] = [];
    const agent = fakeAgent(skeletonPath());
    await runPlan({ projectRoot, request, ...comum, call: agent.call, announce: (linha) => void dito.push(linha) });
    expect(dito.join("\n")).toContain("reaproveitada de uma execução anterior");
  });

  it("não reaproveita a auditoria de um prompt de auditoria diferente", async () => {
    await init(skeletonPath());
    await plan(skeletonPath());

    // Mesmo com tudo em cache, o plano volta pronto e aprovado.
    const terceira = await plan(skeletonPath());
    expect(terceira.outcome.readiness.ready).toBe(true);
  });

  it("`--fresh` reescreve tudo, como quem pediu esperava", async () => {
    await init(skeletonPath());
    await plan(skeletonPath());

    const agent = fakeAgent(skeletonPath());
    await runPlan({ projectRoot, request, ...comum, call: agent.call, fresh: true });
    expect(agent.calls.filter((call) => call.stage === "authoring").length).toBeGreaterThan(0);
  });
});

/*
 * O quarto impasse do `assitencia`. Sem decisão para fechar um achado, o
 * escritor respondeu à emenda com uma CARTA — quatro perguntas de múltipla
 * escolha, "responda 1A, 2A, 3A, 4A" — e uma única task sem critério nem trace.
 *
 * Ninguém jamais leria aquela carta: o que sai da emenda vai direto para o
 * documento. A fase virou um toco, o contrato reprovou por I-08 e I-09, e as
 * três rodadas foram gastas assim, em cinco fases ao mesmo tempo.
 */
describe("emenda que destrói a fase não entra no documento", () => {
  const carta = [
    "Para resolver os quatro pontos, escolha uma opção em cada item:",
    "",
    "1. Banco de produção:",
    "   - A — MySQL remoto (recomendado).",
    "   - B — SQLite em arquivo.",
    "",
    "Responda, por exemplo: `1A`.",
    "",
    "- [ ] **Task:** Implementar a fundação da aplicação.",
  ].join("\n");

  it("mantém a versão anterior quando a emenda volta sem critério nem trace", async () => {
    await init(skeletonPath());

    const steps = skeletonPath();
    // A auditoria devolve uma vez; a emenda responde com a carta.
    let auditou = 0;
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md" },
      respond: {
        stdout: () => {
          auditou += 1;
          return auditou === 1
            ? reject("Phase 1", "falta dizer o que acontece", "decida e escreva")
            : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: ok";
        },
      },
      repeat: true,
    });
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 2 }, respond: { stdout: carta } });

    const { outcome, anunciado } = await planComAnuncio(steps);

    expect(anunciado).toContain("emenda recusada");
    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    // A carta não entrou, e a fase 1 continua com as tasks que tinha.
    expect(plano).not.toContain("Responda, por exemplo");
    expect(plano).not.toContain("escolha uma opção em cada item");
    expect(outcome.readiness.ready).toBe(true);
  });
});

/*
 * O `assitencia`, quarta rodada: "tentativa 1, 2 achados; fechou 2, apareceram
 * 2; fechou 2, apareceram 4". O escritor fechava tudo e a pilha crescia — porque
 * a EMENDA tem a mesma saída legal que o escritor (marcar `[NEEDS DECISION]` em
 * vez de inventar), e o que ela marcava nascia depois da única rodada de lacunas
 * que existia. Ninguém era perguntado, e o auditor devolvia dizendo "obter a
 * decisão aceita".
 */
describe("decisão que nasce na reescrita também chega ao desenvolvedor", () => {
  it("reabre a entrevista quando a emenda deixa marcador", async () => {
    await init(skeletonPath());

    // A auditoria devolve uma vez; a emenda responde marcando uma decisão.
    let auditou = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md" },
      respond: {
        stdout: () => {
          auditou += 1;
          return auditou === 1
            ? reject("Phase 1", "falta dizer o prazo", "decida")
            : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: ok";
        },
      },
      repeat: true,
    });
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 2 },
      respond: { stdout: `${PHASE_1}\n[NEEDS DECISION] qual é o prazo de garantia padrão\n` },
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: { stdout: oneQuestion() },
    });

    const { outcome, agent, anunciado } = await planComAnuncioEResposta(steps, async () => "1");

    const perguntas = agent.calls.filter((call) => call.subject === "project-phases.md:gaps");
    expect(perguntas.length).toBeGreaterThan(0);
    expect(perguntas.at(-1)?.prompt).toContain("qual é o prazo de garantia padrão");
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });
});

/*
 * O `assitencia` quebrou numa pergunta sobre permissões: o desenvolvedor
 * respondeu, com exemplos, o classificador disse que não cobria, e a decisão
 * ficou em aberto. O auditor então devolveu a fase três vezes dizendo "obter a
 * decisão aceita" — coisa que o escritor não pode fazer — e o run abortou com
 * tudo pronto e uma pergunta de dez segundos sem resposta.
 */
describe("decisão em aberto volta a quem decide, não ao escritor", () => {
  it("insiste ANTES de escrever a fase, e a decisão chega a quem escreve", async () => {
    /*
     * O `init` terminou com a decisão em aberto, e o `plan` a carrega pelo
     * handoff. Antes, ela só voltava ao desenvolvedor se o AUDITOR esbarrasse
     * nela — ou seja, depois de dezesseis fases escritas em cima do vazio. Agora
     * a insistência roda antes da primeira fase, e o que ela fecha entra no
     * prompt de quem escreve.
     */
    await init(skeletonPath(), async () => "");

    const { agent, anunciado } = await planComAnuncioEResposta(skeletonPath(), async () => "1");

    expect(anunciado).toContain("não vou fechar o run sem perguntar de novo");
    const escrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "phase-p01");
    expect(escrita?.prompt).toContain("Decisions taken after the skeleton was written");
  });


  it("não repergunta a mesma decisão a cada devolução — isso seria trocar um laço por outro", async () => {
    await init(skeletonPath(), async () => "");

    const steps = skeletonPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md" },
      respond: { stdout: reject("Phase 1", "pendente", "decida") },
      repeat: true,
    });

    // O auditor nunca aprova, então o run termina em impasse — e é justamente aí
    // que reperguntar a cada volta seria o laço novo.
    const dito: string[] = [];
    await runPlan({
      projectRoot,
      request,
      ...comum,
      ask: async () => "1",
      call: fakeAgent(steps).call,
      announce: (linha) => void dito.push(linha),
    }).catch(() => undefined);

    const reaberturas = dito.join("\n").split("não vou fechar o run sem perguntar de novo").length - 1;
    expect(reaberturas).toBe(1);
  });
});

/*
 * O levantamento de auditoria disparou para um achado MECÂNICO — "a task declara
 * 5 critérios de aceite" — e perguntou ao desenvolvedor qual leitura valia. Não
 * há duas leituras: 5 é maior que 4. Pedir arbitragem de uma contagem é gastar a
 * atenção dele com aritmética.
 */
describe("achado mecânico não vai a arbitragem", () => {
  it("a conferência de forma devolve ao escritor sem perguntar nada", async () => {
    await init(skeletonPath());

    // Uma fase com tasks acima do teto de critérios: defeito mecânico, contado.
    const densa = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base · **Depends on:** none · **Covers:** statuses",
      "",
      ...Array.from({ length: 3 }, (_unused, indice) => [
        `- [ ] **Task:** Tarefa ${indice + 1}`,
        "  - **Acceptance criteria:**",
        ...Array.from({ length: 7 }, (_ignora, posicao) => `    - condição observável ${posicao + 1}`),
        "  - **Traces:** statuses",
        "",
      ].join("\n")),
    ].join("\n");

    const steps = skeletonPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 1 }, respond: { stdout: densa } });

    let perguntou = 0;
    const agent = fakeAgent(steps);
    await runPlan({
      projectRoot,
      request,
      ...comum,
      call: agent.call,
      ask: async (question) => {
        if (question.topic.startsWith("auditoria ·")) perguntou += 1;
        return "1";
      },
    }).catch(() => undefined);

    expect(perguntou).toBe(0);
  });
});


/*
 * O teto de lacunas era seis rodadas de cinco perguntas: trinta decisões por run.
 * Um plano de dezesseis fases produziu quatorze marcadores de uma vez, e o que
 * passasse do teto virava `[NEEDS DECISION]` no plano e NOT READY no gate — ou
 * seja, o harness sabia o que faltava, tinha quem responder na frente, e desistia.
 */
describe("a rodada de lacunas não tem teto", () => {
  /** Uma fase com N marcadores de decisão pendente, cada um diferente. */
  const comMarcadores = (quantos: number, apenas?: readonly string[]): string => {
    const numeros = apenas ?? Array.from({ length: quantos }, (_unused, indice) => String(indice + 1));
    return [
      "## Phase 1: Fundação de dados",
      "",
      "**Goal:** migrations e seeds existem · **Depends on:** none · **Covers:** reservations, statuses",
      "",
      "- [ ] **Task:** Criar a migration de statuses e semear as três linhas",
      "  - **Acceptance criteria:**",
      "    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada",
      ...numeros.map((numero) => `    [NEEDS DECISION] decisão pendente número ${numero}`),
      "  - **Traces:** statuses, reservations",
      "",
    ].join("\n");
  };

  it("pergunta os dezoito marcadores, em rodadas, sem abandonar nenhum", async () => {
    await init(skeletonPath());

    const steps = skeletonPath();
    /*
     * O escritor é teimoso de propósito: ele devolve SEMPRE os dezoito
     * marcadores. Quem os apaga é o harness, um por decisão fechada
     * (`stripResolvedMarkers`) — e é isso que faz a rodada seguinte enxergar o que
     * ainda falta em vez de achar que acabou.
     */
    const fechadas = new Set<string>();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: {
        stdout: (call) => {
          // A emenda nomeia as decisões fechadas; o escritor devolve a fase com os
          // marcadores que sobraram, que é o que um escritor honesto faria.
          for (const achado of call.prompt.matchAll(/pendência (\d+)/g)) fechadas.add(achado[1] ?? "");
          const restantes = Array.from({ length: 18 }, (_unused, indice) => String(indice + 1)).filter(
            (numero) => !fechadas.has(numero),
          );
          return restantes.length === 0 ? PHASE_1 : comMarcadores(18, restantes);
        },
      },
      repeat: true,
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: {
        stdout: (call) => {
          // Uma pergunta por marcador que o prompt listou nesta rodada.
          const marcadores = [...call.prompt.matchAll(/^- decisão pendente número (\d+)$/gm)].map((achado) => achado[1] ?? "");
          return JSON.stringify({
            contract: "capivara-questions/v1",
            questions: marcadores.map((numero) => ({
              id: `Q-${numero.padStart(2, "0")}`,
              topic: `pendência ${numero}`,
              evidence: "a fase parou aqui",
              decision: `O que vale na pendência ${numero}?`,
              why: "muda o que a fase afirma",
              options: [
                { label: "Assim", consequence: "a fase afirma assim" },
                { label: "Assado", consequence: "a fase afirma assado" },
              ],
              recommended: "Assim",
              recommendationBasis: "é o de menor escopo",
            })),
          });
        },
      },
      repeat: true,
    });

    const perguntadas = new Set<string>();
    const { outcome } = await plan(steps, async (question) => {
      perguntadas.add(question.topic);
      return "1";
    });

    // Dezoito decisões, nenhuma silenciada por quota.
    expect(perguntadas.size).toBe(18);
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });

  it("lote de perguntas inútil não abandona o marcador: o harness pergunta do jeito que sabe", async () => {
    await init(skeletonPath());

    let escritas = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: {
        stdout: () => {
          escritas += 1;
          return escritas === 1 ? comMarcadores(2) : PHASE_1;
        },
      },
      repeat: true,
    });
    // O escritor não consegue transformar marcador em pergunta — duas vezes.
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: { stdout: JSON.stringify({ contract: "capivara-questions/v1", questions: [{ id: "Q-01", topic: "t" }] }) },
      repeat: true,
    });

    const perguntadas: string[] = [];
    const dito: string[] = [];
    const agent = fakeAgent(steps);
    const outcome = await runPlan({
      projectRoot,
      request,
      ...comum,
      call: agent.call,
      announce: (linha) => void dito.push(linha),
      ask: async (question) => {
        perguntadas.push(question.decision);
        // Delegar: a saída fechada que existe justamente para a pergunta que
        // ninguém soube fazer bem.
        return "1";
      },
    });

    expect(dito.join("\n")).toContain("vou perguntar do jeito que sei");
    expect(perguntadas.join("\n")).toContain("decisão pendente número 1");
    expect(perguntadas.join("\n")).toContain("decisão pendente número 2");
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  });
});


/*
 * O `assistencia2` mostrou uma degradação silenciosa: onze marcadores
 * `[NEEDS DECISION]` vivos fizeram `parsePhases` recusar o documento, e a recusa
 * desligou a auditoria POR FASE — uma chamada sobre o documento inteiro, quatro
 * vezes, apontando fases sempre diferentes. Toda a memória por fase e por task
 * ficou vazia, e nada na tela disse isso.
 */
describe("marcador pendente não rebaixa a auditoria", () => {
  const comMarcador = `## Phase 1: Fundação de dados

**Goal:** migrations e seeds existem · **Depends on:** none · **Covers:** reservations, statuses

- [ ] **Task:** Criar a migration de statuses e semear as três linhas
  - **Acceptance criteria:**
    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada
    [NEEDS DECISION] o status inicial de uma reserva importada
  - **Traces:** statuses, reservations
`;


  it("o marcador continua bloqueando a prontidão: é ao desenvolvedor que ele fala", async () => {
    await init(skeletonPath());

    const steps = skeletonPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: comMarcador }, repeat: true });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: { stdout: JSON.stringify({ contract: "capivara-questions/v1", questions: [] }) },
      repeat: true,
    });

    const { outcome } = await planComAnuncioEResposta(steps, async () => "não sei");
    expect(outcome.readiness.checks.find((check) => check.id === "decisoes")?.passed).toBe(false);
  });
});

/*
 * O laço de lacunas saía quando não havia marcador NOVO, e não quando não havia
 * marcador. Um marcador perguntado, respondido e que o escritor não apagou ficava
 * invisível: `asked` guardava o texto, o filtro o tirava da fila, e o documento
 * voltava marcado.
 */
describe("a rodada de lacunas não devolve plano marcado", () => {
  it("apaga o marcador que o escritor esqueceu, depois de a decisão existir", async () => {
    await init(skeletonPath());

    const marcador = "o status inicial de uma reserva importada";
    const teimoso = `## Phase 1: Fundação de dados

**Goal:** migrations e seeds existem · **Depends on:** none · **Covers:** reservations, statuses

- [ ] **Task:** Criar a migration de statuses e semear as três linhas
  - **Acceptance criteria:**
    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada
    [NEEDS DECISION] ${marcador}
  - **Traces:** statuses, reservations
`;

    const steps = skeletonPath();
    // O escritor devolve SEMPRE o marcador, inclusive depois de a decisão existir.
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: { stdout: teimoso },
      repeat: true,
    });
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: {
        stdout: JSON.stringify({
          contract: "capivara-questions/v1",
          questions: [
            {
              id: "Q-01",
              topic: "status inicial",
              evidence: "a fase parou aqui",
              decision: "Qual status uma reserva importada recebe?",
              why: "muda o que a migration semeia",
              options: [
                { label: "pendente", consequence: "entra como pendente" },
                { label: "confirmada", consequence: "entra como confirmada" },
              ],
              recommended: "pendente",
              recommendationBasis: "é o status de entrada das outras reservas",
            },
          ],
        }),
      },
      repeat: true,
    });

    const { outcome, anunciado } = await planComAnuncioEResposta(steps, async () => "1");

    expect(anunciado).toContain("removeu marcador já decidido");
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano).not.toContain("[NEEDS DECISION]");
    expect(outcome.readiness.checks.find((check) => check.id === "decisoes")?.passed).toBe(true);
  });
});


/*
 * `persistAnswers` dizia, em comentário, que grava "para o run seguinte não
 * perguntar a mesma coisa" — e nada lia aquele arquivo. Um `plan` que recomeçava
 * perdia tudo o que tinha sido decidido nele: as lacunas, os pontos que o auditor
 * devolveu, as arbitragens. No `assistencia2` eram dezessete decisões, várias delas
 * parágrafos escritos à mão.
 */
describe("o plan retomado não perde o que foi decidido nele", () => {
  it("as decisões do plano anterior voltam como autoridade, e chegam a quem escreve", async () => {
    await init(skeletonPath());

    // Primeiro plan: o escritor deixa um marcador, o desenvolvedor decide.
    const marcador = "o status inicial de uma reserva importada";
    const comMarcador = `## Phase 1: Fundação de dados

**Goal:** migrations e seeds existem · **Depends on:** none · **Covers:** reservations, statuses

- [ ] **Task:** Criar a migration de statuses e semear as três linhas
  - **Acceptance criteria:**
    - A tabela statuses existe e contém exatamente pendente, confirmada e cancelada
    [NEEDS DECISION] ${marcador}
  - **Traces:** statuses, reservations
`;
    const primeiro = skeletonPath();
    let escritas = 0;
    primeiro.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: {
        stdout: () => {
          escritas += 1;
          return escritas === 1 ? comMarcador : PHASE_1;
        },
      },
      repeat: true,
    });
    primeiro.unshift({
      match: { role: "writer", stage: "interview", subject: "project-phases.md:gaps" },
      respond: {
        stdout: JSON.stringify({
          contract: "capivara-questions/v1",
          questions: [
            {
              id: "Q-01",
              topic: "status inicial",
              evidence: "a fase parou aqui",
              decision: "Qual status uma reserva importada recebe?",
              why: "muda o que a migration semeia",
              options: [
                { label: "pendente", consequence: "entra como pendente" },
                { label: "confirmada", consequence: "entra como confirmada" },
              ],
              recommended: "pendente",
              recommendationBasis: "é o status de entrada das outras reservas",
            },
          ],
        }),
      },
      repeat: true,
    });
    await plan(primeiro, async () => "2");

    // Nova geração explicitamente solicitada: a retomada normal já reaproveita
    // a emenda corrigida sob essa autoridade, sem pagar outra escrita.
    const { agent, anunciado } = await planComAnuncioEResposta(skeletonPath(), async () => "use as recomendações", { fresh: true });

    expect(anunciado).toContain("decisão(ões) do plano anterior carregada(s)");
    const escrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "phase-p01");
    expect(escrita?.prompt).toContain("Decisions taken after the skeleton was written");
    expect(escrita?.prompt).toContain("confirmada");
  });
});
