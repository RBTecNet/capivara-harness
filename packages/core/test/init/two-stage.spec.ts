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
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { parseSkeleton } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { PHASE_1, SKELETON, fakeAgent, oneQuestion, rehearsedAddresses, skeletonPath } from "../support/fake-agent.js";
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

async function planComAnuncioEResposta(steps: ScriptStep[], ask: (typeof comum)["ask"]) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  const outcome = await runPlan({ projectRoot, request, ...comum, ask, call: agent.call, announce: (linha) => void dito.push(linha) });
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

describe("cada auditoria recebe só o que a sua pergunta exige", () => {
  it("a auditoria de uma fase recebe a fatia que escreveu aquela fase, não o produto inteiro", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const fase2 = agent.calls.find((call) => call.role === "auditor" && call.subject === "project-phases.md#P2");
    expect(fase2?.prompt).toContain("US-1.1");
    expect(fase2?.prompt).not.toContain("pertence a statuses");
  });

  it("a auditoria de coerência recebe o esqueleto inteiro: a pergunta dela é global", async () => {
    await init(skeletonPath());
    const { agent } = await plan(skeletonPath());

    const coerencia = agent.calls.find((call) => call.role === "auditor" && call.subject === "project-phases.md#coerência");
    expect(coerencia?.prompt).toContain("pertence a statuses");
    expect(coerencia?.prompt).toContain("## Fases");
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
    await expect(plan(steps)).rejects.toThrow(/sem nenhuma task em duas tentativas/);
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
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: () => {
          auditou += 1;
          return auditou === 1
            ? "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | falta dizer o que acontece | decida e escreva\nCAPIVARA_REASON: falta decisão"
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
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: () => {
          auditou += 1;
          return auditou === 1
            ? "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | falta dizer o prazo | decida\nCAPIVARA_REASON: falta decisão"
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

    expect(anunciado).toContain("a reescrita deixou decisão pendente");
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

  it("reabre a pergunta quando o auditor devolve e há decisão pendente", async () => {
    await init(skeletonPath(), async () => "");   // a entrevista fica sem resposta

    let auditou = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: () => {
          auditou += 1;
          return auditou === 1
            ? "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | a matriz permanece pendente | obter a decisão aceita\nCAPIVARA_REASON: falta decisão"
            : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: ok";
        },
      },
      repeat: true,
    });

    /*
     * A insistência do começo do `plan` é respondida em aberto — "" mantém a
     * decisão pendente —, então ela continua em aberto quando o auditor esbarra
     * nela. É o caso que importa: a decisão fica sem dono até alguém decidir, e
     * quem decide é perguntado no ponto em que a decisão volta a fazer diferença.
     */
    let vez = 0;
    const { agent, anunciado } = await planComAnuncioEResposta(steps, async () => {
      vez += 1;
      return vez <= 3 ? "" : "1";
    });

    expect(anunciado).toContain("não vou fechar o run sem perguntar de novo");
    expect(anunciado).toContain("passam a valer como autoridade");

    // A decisão do desenvolvedor chega à emenda como autoridade.
    const emenda = agent.calls.filter((call) => call.stage === "authoring" && call.subject === "phase-p01").at(-1);
    expect(emenda?.prompt).toContain("esta decisão é a autoridade");
  });

  it("não repergunta a mesma decisão a cada devolução — isso seria trocar um laço por outro", async () => {
    await init(skeletonPath(), async () => "");

    const steps = skeletonPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 1 | pendente | decida\nCAPIVARA_REASON: falta" },
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
        "  - **Feature tests:** t → t",
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
 * O auditor tinha dois canais e nenhum chegava a tempo a quem decide: o finding
 * vai ao escritor, e a ressalva só é lida no relatório, depois de o run terminar.
 * Quando o que falta é uma DECISÃO, mandar ao escritor é pedir que ele invente.
 *
 * O caminho até o desenvolvedor existia e era caro: o levantamento abre quando o
 * MESMO achado volta pela segunda vez, e o impasse quando o teto estoura. Entre a
 * primeira leitura e a primeira pergunta havia sempre um ciclo inteiro.
 */
describe("o auditor pergunta ao desenvolvedor, na primeira leitura", () => {
  const comDecisao = [
    "CAPIVARA_AUDIT_STATUS: REJECTED",
    "CAPIVARA_FINDING: Phase 1 | o critério não diz o que acontece na recusa | descreva o efeito observável",
    "CAPIVARA_DECISION: Phase 1 · statuses | A tabela de statuses é fixa ou o operador cria status novo? | Fixa: as três linhas vêm do seed e ninguém acrescenta | Aberta: o operador cadastra status novos",
    "CAPIVARA_REASON: falta uma decisão que nenhuma fonte contém",
  ].join("\n");

  it("a decisão vai à tela com as leituras dele, e volta ao escritor como autoridade", async () => {
    await init(skeletonPath());

    let auditou = 0;
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: {
        stdout: () => {
          auditou += 1;
          return auditou === 1 ? comDecisao : "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: ok";
        },
      },
      repeat: true,
    });

    const perguntadas: string[] = [];
    const agent = fakeAgent(steps);
    const dito: string[] = [];
    await runPlan({
      projectRoot,
      request,
      ...comum,
      call: agent.call,
      announce: (linha) => void dito.push(linha),
      ask: async (question) => {
        perguntadas.push(`${question.topic} :: ${question.options.map((opcao) => opcao.label).join(" | ")}`);
        return "1";
      },
    });

    expect(dito.join("\n")).toContain("ninguém na mesa pode tomar");
    // As duas leituras do auditor chegam como opções: pergunta sem opção entra em laço.
    expect(perguntadas.join("\n")).toContain("Fixa: as três linhas vêm do seed");
    expect(perguntadas.join("\n")).toContain("Aberta: o operador cadastra status novos");

    // E a escolha volta ao escritor junto do achado, como autoridade.
    const emenda = agent.calls.filter((call) => call.stage === "authoring" && call.subject === "phase-p01").at(-1);
    expect(emenda?.prompt).toContain("esta decisão é a autoridade acima do auditor");
    expect(emenda?.prompt).toContain("Fixa: as três linhas vêm do seed");
  });

  it("uma vez por decisão: o auditor é sem memória e a levantaria de novo", async () => {
    await init(skeletonPath());

    const steps = skeletonPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#P1" },
      respond: { stdout: comDecisao },
      repeat: true,
    });

    let perguntas = 0;
    const agent = fakeAgent(steps);
    await runPlan({
      projectRoot,
      request,
      ...comum,
      call: agent.call,
      ask: async (question) => {
        if (question.topic.includes("statuses")) perguntas += 1;
        return "1";
      },
      decideStandoff: async () => "publicar",
    }).catch(() => undefined);

    expect(perguntas).toBe(1);
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
      "  - **Feature tests:** statuses_seed → as três linhas existem após o seed",
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
 * O ensaio do verificador reprovava, o escritor tinha uma rodada, e se o veredito
 * se mantivesse o run terminava em NOT READY com o plano publicado e uma lista de
 * endereços na tela. É o mesmo desacordo de leitura do levantamento de auditoria,
 * com outro par — e a mesma pessoa capaz de encerrá-lo estava no terminal.
 */
describe("o ensaio também pergunta antes de bloquear", () => {
  const reprovaUm = (): ScriptStep => ({
    match: { role: "verifier", stage: "verify" },
    respond: {
      stdout: (call) =>
        rehearsedAddresses(call.prompt)
          .map((address, indice) =>
            indice === 0
              ? `CRITERION ${address}: UNOBSERVABLE — dois verificadores honestos discordariam`
              : `CRITERION ${address}: OBSERVABLE — dá para abrir o arquivo e olhar`,
          )
          .join("\n"),
    },
    repeat: true,
  });

  it("mantido por decisão do desenvolvedor, o critério deixa de bloquear o gate", async () => {
    await init(skeletonPath());

    const steps = skeletonPath().filter((step) => step.match.role !== "verifier");
    steps.push(reprovaUm());

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
        perguntadas.push(question.topic);
        // Opção 2: vale o critério como está.
        return question.topic.startsWith("ensaio") ? "2" : "use as recomendações";
      },
    });

    expect(perguntadas.some((topico) => topico.startsWith("ensaio ·"))).toBe(true);
    expect(dito.join("\n")).toContain("mantidos por sua decisão");
    expect(outcome.readiness.checks.find((check) => check.id === "ensaio")?.passed).toBe(true);
  });
});
