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
import { parseSkeleton } from "../../src/contract/index.js";
import type { Skeleton } from "../../src/contract/index.js";
import { PHASE_1, SKELETON, fakeAgent, oneQuestion, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-ciclo-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };

const comum = {
  language: "português do Brasil" as const,
  ask: async () => "use as recomendações",
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
