import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, evaluateReadiness, inspectProject, resolveRequest, runInit, summarizeInventory } from "../../src/init/index.js";
import { readEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { assemblePhasesDocument } from "../../src/contract/index.js";
import { SKELETON, PHASE_1, PHASE_2, approve, fakeAgent, happyPath, oneQuestion, reject, rehearsedAddresses } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-init-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "abc123abc123" };

/**
 * As decisões do roteiro do teste, sem a do banco.
 *
 * A pergunta de banco é do harness e é feita em toda entrevista; contá-la junto
 * faria cada teste afirmar um número que não é sobre o que ele está testando.
 */
const doRoteiro = <T extends { questionId: string }>(decisions: T[]): T[] => decisions.filter((decision) => !decision.questionId.endsWith(ID_DO_BANCO));

/** Um plano que passa no contrato, para exercitar o gate sem rodar o run inteiro. */
const PLANO = assemblePhasesDocument({
  projectName: "Pousada",
  stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
  overview: "Fundação primeiro.",
  phases: [PHASE_1.trim(), PHASE_2.trim()],
  openQuestions: [],
});

async function run(steps: ScriptStep[], answers: string[] = [], extras: { fresh?: boolean } = {}) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  let asked = 0;
  const outcome = await runInit({
    projectRoot,
    request,
    language: "português do Brasil",
    announce: (message) => void dito.push(message),
    ...extras,
    call: agent.call,
    /*
     * A pergunta de banco é do harness, não do roteiro do teste: ela vem antes
     * de tudo em toda entrevista. Respondê-la aqui mantém os `answers` de cada
     * teste alinhados com as perguntas que ELE escreveu.
     */
    ask: async (question) => (question.id === ID_DO_BANCO ? "1" : (answers[asked++] ?? "use as recomendações")),
  });
  return { outcome, agent, anunciado: dito.join("\n") };
}

describe("resolveRequest", () => {
  it("aceita texto direto e hasheia a fonte", async () => {
    const resolved = await resolveRequest(projectRoot, { prompt: "uma agenda de consultas" });
    expect(resolved.origin).toBe("text");
    expect(resolved.sha12).toMatch(/^[0-9a-f]{12}$/);
  });

  it("aceita @arquivo e --file", async () => {
    await writeFile(join(projectRoot, "pedido.md"), "uma agenda de consultas", "utf8");
    const viaArroba = await resolveRequest(projectRoot, { prompt: "@pedido.md" });
    const viaFlag = await resolveRequest(projectRoot, { file: "pedido.md" });
    expect(viaArroba.origin).toBe("file");
    expect(viaArroba.sha12).toBe(viaFlag.sha12);
  });

  it("o mesmo pedido gera o mesmo run — é o que permite retomar", async () => {
    const um = await resolveRequest(projectRoot, { prompt: "x" });
    const outro = await resolveRequest(projectRoot, { prompt: "x" });
    expect(runIdFor("init", um.sha12)).toBe(runIdFor("init", outro.sha12));
  });

  it("recusa pedido vazio dizendo como passar um", async () => {
    await expect(resolveRequest(projectRoot, {})).rejects.toThrow(/--file/);
  });

  it("recusa arquivo fora do projeto", async () => {
    await expect(resolveRequest(projectRoot, { file: "../../etc/passwd" })).rejects.toThrow(/escapa do projeto/);
  });
});

describe("inventário", () => {
  it("reconhece projeto vazio", async () => {
    const inventory = await inspectProject(projectRoot);
    expect(inventory.empty).toBe(true);
    expect(summarizeInventory(inventory)).toContain("vazio");
  });

  it("registra a existência de segredos sem ler o conteúdo", async () => {
    await writeFile(join(projectRoot, ".env"), "OPENAI_API_KEY=sk-nao-pode-vazar", "utf8");
    const inventory = await inspectProject(projectRoot);
    expect(inventory.secretsPresent).toEqual([".env"]);
    expect(JSON.stringify(inventory)).not.toContain("sk-nao-pode-vazar");
    expect(summarizeInventory(inventory)).not.toContain("sk-nao-pode-vazar");
  });

  it("lê manifestos, que revelam a stack", async () => {
    await writeFile(join(projectRoot, "package.json"), '{"name":"x"}', "utf8");
    const inventory = await inspectProject(projectRoot);
    expect(inventory.manifests[0]?.path).toBe("package.json");
  });

  it("ignora node_modules e .git", async () => {
    await writeFile(join(projectRoot, "package.json"), "{}", "utf8");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, "node_modules", "lodash"), { recursive: true });
    await writeFile(join(projectRoot, "node_modules", "lodash", "index.js"), "module.exports={}", "utf8");
    const inventory = await inspectProject(projectRoot);
    expect(inventory.files.map((file) => file.path)).toEqual(["package.json"]);
  });
});

describe("init ponta a ponta — caminho feliz", () => {
  it("chega a RALPH READY e publica o esqueleto e o plano", async () => {
    const { outcome } = await run(happyPath());
    expect(outcome.readiness.ready, outcome.readiness.checks.filter((c) => !c.passed).map((c) => `${c.title}: ${c.detail}`).join("\n")).toBe(true);

    // Dois artefatos, não quatro: o esqueleto e o plano que o loop consome.
    for (const artefato of ["skeleton.md", "project-phases.md"]) {
      const content = await readFile(join(projectRoot, ".capivara/init", artefato), "utf8");
      expect(content.length).toBeGreaterThan(50);
    }
  });

  it("as regras de banco entram no esqueleto a partir da decisão, não do escritor", async () => {
    const { anunciado } = await run(happyPath());
    const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");

    // A pergunta é respondida com "1" pelo helper: banco embutido.
    expect(esqueleto).toContain(".env.example");
    expect(esqueleto).toContain("comando único de migração");
    expect(esqueleto).toContain("banco descartável");
    expect(esqueleto).toContain("embutido em arquivo");
    expect(anunciado).toContain("regra(s) de banco");

    // Elas atravessam para as fases: é lá que o executor as lê.
    const plano = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    expect(plano.length).toBeGreaterThan(50);
  });

  it("não escreve regra de banco quando o desenvolvedor diz que não há banco", async () => {
    const agent = fakeAgent(happyPath());
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      call: agent.call,
      ask: async (question) => (question.id === ID_DO_BANCO ? "4" : "use as recomendações"),
    });
    expect(outcome.readiness.ready).toBe(true);

    const esqueleto = await readFile(join(projectRoot, ".capivara/init/skeleton.md"), "utf8");
    expect(esqueleto).not.toContain(".env.example");
  });

  it("o plano publicado passa no próprio contrato", async () => {
    await run(happyPath());
    const { parsePhases } = await import("../../src/contract/index.js");
    const content = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    const parsed = parsePhases(content);
    expect(parsed.ok, parsed.ok ? "" : parsed.errors.map((e) => `${e.code} ${e.message}`).join("; ")).toBe(true);
    if (parsed.ok) expect(parsed.document.phases).toHaveLength(2);
  });

  it("o stamp de inputs é gravado e está fresco", async () => {
    await run(happyPath());
    const content = await readFile(join(projectRoot, ".capivara/init/project-phases.md"), "utf8");
    // O plano é carimbado com o único upstream que existe: o esqueleto.
    expect(content.split("\n")[2]).toMatch(/^<!-- inputs: skeleton\.md@sha256:[0-9a-f]{12} /);
  });

  it("o relatório traz artefatos, plano, cobertura e custo", async () => {
    const { outcome } = await run(happyPath());
    expect(outcome.rendered).toContain("RALPH READY");
    expect(outcome.rendered).toContain("cobertura:");
    expect(outcome.report.phases).toBe(2);
    expect(outcome.report.tasks).toBe(3);
    expect(outcome.report.costs.some((cost) => cost.role === "writer")).toBe(true);
  });

  it("grava eventos suficientes para retomar", async () => {
    const { outcome } = await run(happyPath());
    const events = await readEvents(runPaths(projectRoot, outcome.runId).events);
    const publicados = events.filter((event) => event.stage === "publish" && event.status === "complete");
    expect(publicados.map((event) => event.subject)).toEqual(["skeleton", "project-phases.md"]);
  });

  /*
   * O contrato é "uma fase por chamada", não a ordem entre elas: as fases são
   * escritas em paralelo porque são independentes, e quem chega primeiro depende
   * de quanto cada worker esperou em disco. Prender a ordem aqui fazia o teste
   * piscar assim que o laço ganhou uma escrita a mais antes da chamada.
   */
  it("uma fase por chamada: nunca um intervalo", async () => {
    const { agent } = await run(happyPath());
    const partes = agent.calls.filter((call) => call.subject.startsWith("phase-p"));
    expect(partes.map((call) => call.subject).sort()).toEqual(["phase-p01", "phase-p02"]);
  });

  /*
   * O `build` guardava prompt e saída de cada ciclo; o `init` e o `plan` — que
   * custam dezenas de chamadas — não guardavam nada. Quando um `plan` morria no
   * meio, não sobrava o que ler: nem o que foi pedido, nem o que o provider
   * respondeu, e a pergunta "foi o modelo ou fomos nós?" ficava sem resposta.
   */
  it("guarda o prompt e a resposta de cada chamada, como o build faz", async () => {
    const { outcome } = await run(happyPath());
    const raiz = join(projectRoot, ".capivara", "runs", outcome.runId);

    const prompts = await readdir(join(raiz, "prompts"));
    const logs = await readdir(join(raiz, "logs"));
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.length).toBe(logs.length);

    // O nome diz estágio, assunto, papel e tentativa — é por ele que se acha a
    // chamada que morreu, sem abrir todos os arquivos.
    expect(prompts.some((nome) => nome.startsWith("authoring.phase-p01.writer."))).toBe(true);
  });

  it("assunto com . / e # vira nome de arquivo, não caminho inventado", async () => {
    const { outcome } = await run(happyPath());
    const prompts = await readdir(join(projectRoot, ".capivara", "runs", outcome.runId, "prompts"));
    expect(prompts.every((nome) => !nome.includes("/") && !nome.includes("#"))).toBe(true);
    expect(prompts.some((nome) => nome.includes("project-phases.md"))).toBe(true);
  });

  it("nenhuma chamada fica sem roteiro", async () => {
    const { agent } = await run(happyPath());
    expect(agent.unmatched).toEqual([]);
  });
});

describe("entrevista dentro do init", () => {
  it("apresenta a pergunta e usa a decisão aceita", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { agent } = await run(steps, ["1"]);
    const escrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "skeleton");
    expect(escrita?.prompt).toContain("Node + Vitest");
  });

  it("'não sei' não vira decisão confirmada", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await run(steps, ["não sei"]);
    expect(doRoteiro(outcome.report.checkpoint.decisions)).toHaveLength(0);
    expect(outcome.report.checkpoint.deferrals).toHaveLength(1);
  });

  it("resposta em texto livre que não fecha volta para quem a escreveu", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    // Primeiro veredito: falta algo. Segundo: fechou.
    let vez = 0;
    steps.unshift({
      match: { role: "auditor", stage: "interview" },
      respond: {
        stdout: () => {
          vez += 1;
          return vez === 1
            ? "CAPIVARA_ANSWER: Q-01 | PARTIAL | falta dizer o que acontece com os cartões"
            : "CAPIVARA_ANSWER: Q-01 | ACCEPTED | Três colunas fixas, sem gerenciamento";
        },
      },
      repeat: true,
    });

    const { outcome, anunciado } = await run(steps, ["três colunas fixas", "três colunas fixas, e não há remoção"]);
    expect(anunciado).toContain("Sua resposta não fechou a decisão");
    expect(anunciado).toContain("falta dizer o que acontece com os cartões");
    expect(doRoteiro(outcome.report.checkpoint.decisions)).toHaveLength(1);
  });

  it("o que segue em aberto é dito, nunca sumido", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    steps.unshift({
      match: { role: "auditor", stage: "interview" },
      respond: { stdout: "CAPIVARA_ANSWER: Q-01 | DEFERRED | não dá para saber a stack" },
      repeat: true,
    });

    const { outcome, anunciado } = await run(steps, ["sei lá, o que for melhor", ""]);
    expect(anunciado).toContain("Segue em aberto");
    expect(doRoteiro(outcome.report.checkpoint.decisions)).toHaveLength(0);
  });

  it("o classificador recebe a evidência e as opções, não só a pergunta", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    steps.unshift({
      match: { role: "auditor", stage: "interview" },
      respond: { stdout: "CAPIVARA_ANSWER: Q-01 | ACCEPTED | Node com Vitest" },
      repeat: true,
    });

    const { agent } = await run(steps, ["node mesmo"]);
    const classificacao = agent.calls.find((call) => call.role === "auditor" && call.stage === "interview");
    expect(classificacao?.prompt).toContain("What had been observed");
    expect(classificacao?.prompt).toContain("REMOVES THE PREMISE");
    expect(classificacao?.prompt).toContain("The developer is the authority");
  });

  it("pergunta adiada bloqueia o RALPH READY com [NEEDS DECISION]", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await run(steps, ["não sei"]);
    expect(outcome.readiness.ready).toBe(false);
    const entrevista = outcome.readiness.checks.find((check) => check.id === "entrevista");
    expect(entrevista?.passed).toBe(false);
  });
});

describe("referência de design", () => {
  it("caminho que não existe é removido em código, sem custar devolução", async () => {
    /*
     * Antes isto virava finding de auditoria — e no piloto 4 foram 24 deles, um
     * por task, o mesmo defeito repetido consumindo o ciclo inteiro. Referência
     * para arquivo inexistente é morta por definição e o gate a recusaria de
     * qualquer forma: removê-la é estritamente melhor do que reprovar por causa
     * dela.
     */
    const comDesign = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base · **Depends on:** none · **Covers:** statuses",
      "",
      "- [ ] **Task:** Montar a tela inicial",
      "  - **Acceptance criteria:**",
      "    - A tela existe e lista os quartos.",
      "  - **Feature tests:** tela → renderiza",
      "  - **Design ref:** telas/inicial.png",
      "  - **Traces:** statuses",
      "",
    ].join("\n");

    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 1 }, respond: { stdout: comDesign } });

    const { outcome, anunciado } = await run(steps);
    expect(anunciado).toContain("Design ref para arquivo inexistente");
    expect(outcome.readiness.checks.find((check) => check.id === "design")?.passed).toBe(true);

    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    expect(plano).not.toContain("telas/inicial.png");
  });
});

describe("dimensionamento de fase", () => {
  it("fase densa demais volta ao escritor mesmo cabendo em tasks", async () => {
    // Mesmo número de tasks, o dobro do trabalho: é a medida que faltava.
    const densa = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base · **Depends on:** none · **Covers:** statuses",
      "",
      ...Array.from({ length: 10 }, (_unused, indice) => [
        `- [ ] **Task:** Tarefa ${indice + 1}`,
        "  - **Acceptance criteria:**",
        ...Array.from({ length: 7 }, (_ignora, posicao) => `    - condição observável ${posicao + 1}`),
        "  - **Feature tests:** t → t",
        "  - **Traces:** statuses",
        "",
      ].join("\n")),
    ].join("\n");

    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01", attempt: 1 }, respond: { stdout: densa } });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: PHASE_1 }, repeat: true });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: PHASE_2 }, repeat: true });

    const { agent, anunciado } = await run(steps);
    expect(anunciado).toContain("auditor devolveu project-phases.md");
    const reescrita = agent.calls.find((call) => call.subject === "phase-p01" && call.attempt > 1);
    expect(reescrita?.prompt).toContain("critérios de aceite");
  });
});

describe("o laço de auditoria cabe os dois orçamentos", () => {
  it("duas devoluções mecânicas mais duas do auditor não estouram a volta", async () => {
    /*
     * A medição de 95 minutos morreu aqui: "o ciclo de auditoria não convergiu",
     * sem impasse, sem pergunta e sem documento. O teto do laço continuou sendo o
     * do auditor depois que o defeito mecânico ganhou contagem própria.
     */
    const inchada = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base · **Depends on:** none · **Covers:** statuses",
      "",
      "- [ ] **Task:** Fazer tudo",
      "  - **Acceptance criteria:**",
      ...Array.from({ length: 9 }, (_unused, posicao) => `    - condição ${posicao + 1}`),
      "  - **Feature tests:** t → t",
      "  - **Traces:** statuses",
      "",
    ].join("\n");

    let escritas = 0;
    let auditorias = 0;
    const steps = happyPath();

    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "phase-p01" },
      respond: {
        stdout: () => {
          escritas += 1;
          return escritas <= 2 ? inchada : PHASE_1;
        },
      },
      repeat: true,
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: PHASE_2 }, repeat: true });

    // Passadas as mecânicas, o auditor do plano ainda devolve duas vezes.
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" },
      respond: {
        stdout: () => {
          auditorias += 1;
          return auditorias <= 2 ? reject("Phase 2", "o critério não nomeia o alvo", "nomeie o alvo") : approve();
        },
      },
      repeat: true,
    });

    const { outcome } = await run(steps);
    expect(outcome.readiness.checks.find((check) => check.id === "contrato")?.passed).toBe(true);
    expect(outcome.readiness.checks.find((check) => check.id === "auditoria")?.passed).toBe(true);
  });
});

describe("o levantamento não roda à toa", () => {
  it("tudo aceito encerra a entrevista sem pagar outra chamada", async () => {
    // O laço pagava um levantamento a mais por documento só para descobrir que
    // não havia o que perguntar: quatro minutos de modelo, e o lote voltava
    // inteiro descartado por duplicidade.
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: oneQuestion() },
    });

    const { agent } = await run(steps, ["1"]);
    const levantamentos = agent.calls.filter(
      (call) => call.stage === "interview" && call.subject === "skeleton",
    );
    expect(levantamentos).toHaveLength(1);
  });

  it("resposta em aberto ainda abre a rodada seguinte", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: oneQuestion() },
    });

    const { agent } = await run(steps, ["não sei"]);
    const levantamentos = agent.calls.filter(
      (call) => call.stage === "interview" && call.subject === "skeleton",
    );
    expect(levantamentos.length).toBeGreaterThan(1);
  });
});

describe("o canal de suposição", () => {
  it("o que o escritor supõe não vira pergunta, e aparece no relatório", async () => {
    // 47 perguntas em três documentos, incluindo quais hexadecimais usar numa
    // paleta: sem canal para supor, tudo o que não estava decidido virava
    // pergunta.
    const comSuposicao = JSON.stringify({
      contract: "capivara-questions/v1",
      assumptions: [
        { topic: "Paleta", statement: "seis cores fixas em hexadecimal", basis: "cor de etiqueta não muda comportamento observável" },
      ],
      questions: [],
    });

    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "interview", subject: "skeleton", attempt: 1 },
      respond: { stdout: comSuposicao },
    });

    const { outcome, agent, anunciado } = await run(steps);
    expect(anunciado).toContain("suposição(ões) registrada(s)");
    expect(outcome.report.checkpoint.assumptions.map((item) => item.statement)).toContain("seis cores fixas em hexadecimal");

    // E o escritor do documento seguinte trabalha sabendo do que foi suposto.
    // E o esqueleto é escrito sabendo do que foi suposto.
    const escrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "skeleton");
    expect(escrita?.prompt).toContain("seis cores fixas em hexadecimal");
  });

  it("lote sem o campo continua válido: suposição é opcional", async () => {
    const { outcome } = await run(happyPath());
    expect(outcome.readiness.ready).toBe(true);
  });
});

describe("decisão de impasse", () => {
  /** Leva o plano ao impasse: o auditor reprova sempre, o escritor insiste. */
  function semConvergencia(): ScriptStep[] {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-phases.md#coerência" },
      respond: { stdout: reject("Phase 1", "a regra não diz sobre o que a operação incide", "nomeie o alvo") },
      repeat: true,
    });
    return steps;
  }

  async function comImpasse(decisao: string) {
    const agent = fakeAgent(semConvergencia());
    const dito: string[] = [];
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      announce: (message) => void dito.push(message),
      call: agent.call,
      ask: async () => "use as recomendações",
      decideStandoff: async () => decisao,
    });
    return { outcome, agent, anunciado: dito.join("\n") };
  }

  it("a decisão do desenvolvedor vira decisão confirmada, não recado", async () => {
    const regra = "o valor é aparado na gravação e a comparação ignora caixa";
    const { outcome, anunciado } = await comImpasse(regra);

    expect(anunciado).toContain("decisão registrada");
    expect(
      outcome.report.checkpoint.decisions.some((entry) => entry.decision.includes("aparado na gravação")),
    ).toBe(true);
  });

  it("ela sobrevive ao run: fica gravada onde a retomada lê", async () => {
    const regra = "o valor é aparado na gravação e a comparação ignora caixa";
    await comImpasse(regra);

    const handoff = JSON.parse(
      await readFile(join(projectRoot, ".capivara", "handoffs", `${runIdFor("init", request.sha12)}.project-phases.md.json`), "utf8"),
    ) as { answers: { questionId: string; disposition: string; decision: string }[] };

    const registrada = handoff.answers.find((answer) => answer.questionId.startsWith("SD-"));
    expect(registrada?.disposition).toBe("ACCEPTED");
    expect(registrada?.decision).toContain("aparado na gravação");
  });

  it("e volta ao escritor como autoridade, na emenda da fase", async () => {
    const regra = "o valor é aparado na gravação e a comparação ignora caixa";
    const { agent } = await comImpasse(regra);

    const emendas = agent.calls.filter((call) => call.subject.startsWith("phase-") && call.prompt.includes("amending"));
    expect(emendas.length).toBeGreaterThan(0);
    expect(emendas.some((call) => call.prompt.includes("aparado na gravação"))).toBe(true);
  });
});

describe("limite de uso", () => {
  it("espera e repete sem gastar a tentativa, em vez de matar a entrevista", async () => {
    const dormidas: number[] = [];
    const steps = happyPath();
    let vez = 0;
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: {
        stdout: () => {
          vez += 1;
          return vez === 1 ? "rate limit reached" : SKELETON;
        },
      },
      repeat: true,
    });

    const agent = fakeAgent(steps);
    const dito: string[] = [];
    const outcome = await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      announce: (message) => void dito.push(message),
      sleep: async (seconds) => void dormidas.push(seconds),
      call: agent.call,
      ask: async () => "use as recomendações",
    });

    expect(dormidas).toHaveLength(1);
    expect(dito.join("\n")).toContain("limite de uso");
    expect(outcome.readiness.ready).toBe(true);
  });
});

describe("timeout do provider", () => {
  it("estouro de tempo tenta de novo antes de desistir", async () => {
    const steps = happyPath();
    // A primeira chamada estoura; a segunda responde.
    let vez = 0;
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: {
        stdout: () => (vez === 0 ? "" : SKELETON),
        exitCode: () => {
          vez += 1;
          return vez === 1 ? 124 : 0;
        },
      },
      repeat: true,
    });

    const { outcome, anunciado } = await run(steps);
    expect(anunciado).toContain("estourou o tempo");
    expect(outcome.readiness.ready).toBe(true);
  });

  /*
   * Sair com erro sem escrever nada é o único fracasso sem diagnóstico.
   * Credencial vencida, modelo inexistente e free tier recusando uso externo
   * saem todos com código 1 e todos dizem o que houve; stdout vazio não diz
   * nada, e a causa provável é o soluço.
   *
   * O caso real: a chamada de coerência de um `plan` voltou vazia depois de
   * três fases escritas e auditadas, e a execução seguinte refez as três.
   */
  it("saída vazia com código de erro tenta de novo antes de desistir", async () => {
    const steps = happyPath();
    let vez = 0;
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: {
        stdout: () => (vez === 0 ? "" : SKELETON),
        exitCode: () => {
          vez += 1;
          return vez === 1 ? 1 : 0;
        },
      },
      repeat: true,
    });

    const { outcome, anunciado } = await run(steps);
    expect(anunciado).toContain("sem escrever nada");
    expect(outcome.readiness.ready).toBe(true);
  });

  it("mas erro COM diagnóstico não repete: a mensagem é a resposta", async () => {
    const steps = happyPath();
    let chamadas = 0;
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: {
        stdout: () => {
          chamadas += 1;
          return "FreeTierError: external usage is not allowed";
        },
        exitCode: 1,
      },
      repeat: true,
    });

    await expect(run(steps)).rejects.toThrow(/FreeTierError/);
    expect(chamadas).toBe(1);
  });

  it("estouro duas vezes para o run dizendo o que fazer", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: "", exitCode: 124 },
      repeat: true,
    });
    await expect(run(steps)).rejects.toThrow(/estourou o tempo duas vezes/);
  });
});

describe("gate de prontidão", () => {
  const base = {
    plan: PLANO,
    stampInputs: [],
    coverage: { storyIds: [], entities: [], workflows: [] },
    approved: true,
    unresolvedQuestions: [],
    designRoot: ".capivara/init/design",
    designExists: () => true,
  };

  it("um único item falso produz NOT READY, nunca 'quase pronto'", () => {
    const readiness = evaluateReadiness({ ...base, approved: false });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === "auditoria")?.passed).toBe(false);
  });

  it("plano ausente é reportado dizendo o que rodar", () => {
    const readiness = evaluateReadiness({ ...base, plan: "" });
    expect(readiness.checks.find((check) => check.id === "documentos")?.detail).toContain("capivara plan");
  });

  it("[NEEDS DECISION] no plano bloqueia", () => {
    const readiness = evaluateReadiness({ ...base, plan: `${PLANO}\n[NEEDS DECISION] qual provedor de email\n` });
    expect(readiness.checks.find((check) => check.id === "decisoes")?.passed).toBe(false);
  });

  it("são exatamente nove verificações", () => {
    expect(evaluateReadiness(base).checks).toHaveLength(9);
  });

  it("ensaio que não rodou não aprova por omissão", () => {
    const readiness = evaluateReadiness(base);
    expect(readiness.checks.find((check) => check.id === "ensaio")?.passed).toBe(false);
  });

  it("critério reprovado no ensaio aparece com endereço", () => {
    const readiness = evaluateReadiness({
      ...base,
      rehearsal: { blocked: ["P5.T9.C1 · Verificar metadados — UNSATISFIABLE: o projeto não tem dependências"] },
    });
    const check = readiness.checks.find((item) => item.id === "ensaio");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain("P5.T9.C1");
  });
});

describe("ensaio do verificador", () => {
  /** Reprova o primeiro critério de cada task 1 e aprova todo o resto. */
  function rehearsalRejects(rounds: number): ScriptStep {
    let round = 0;
    return {
      match: { role: "verifier", stage: "verify" },
      respond: {
        stdout: (call) => {
          round += 1;
          const alvo = round <= rounds;
          return rehearsedAddresses(call.prompt)
            .map((address, position) =>
              alvo && position === 0
                ? `CRITERION ${address}: UNSATISFIABLE — exige dependência fixada num projeto decidido sem dependências`
                : `CRITERION ${address}: OBSERVABLE — dá para abrir o arquivo e olhar`,
            )
            .join("\n");
        },
      },
      repeat: true,
    };
  }

  /** O escritor devolve a mesma fase quando o ensaio manda reescrever. */
  const reescreve: ScriptStep[] = [
    { match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: PHASE_1 }, repeat: true },
    { match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: PHASE_2 }, repeat: true },
  ];

  it("critério impossível volta ao escritor antes de o build existir", async () => {
    const steps = [...happyPath().filter((step) => step.match.role !== "verifier"), ...reescreve];
    steps.push(rehearsalRejects(1));

    const { outcome, agent } = await run(steps);
    const reescrita = agent.calls.find((call) => call.stage === "authoring" && call.subject.startsWith("phase-") && call.attempt > 1);
    expect(reescrita?.prompt).toContain("as decisões confirmadas negam");
    expect(outcome.readiness.checks.find((check) => check.id === "ensaio")?.passed).toBe(true);
  });

  it("critério que sobrevive à reescrita bloqueia o RALPH READY com o endereço", async () => {
    const steps = [...happyPath().filter((step) => step.match.role !== "verifier"), ...reescreve];
    steps.push(rehearsalRejects(9));

    const { outcome } = await run(steps);
    expect(outcome.readiness.ready).toBe(false);
    const check = outcome.readiness.checks.find((item) => item.id === "ensaio");
    expect(check?.passed).toBe(false);
    expect(check?.detail).toMatch(/P\d+\.T\d+\.C\d+/);
    expect(check?.detail).toContain("UNSATISFIABLE");
  });

  it("lote grande é quebrado: fase com muitos critérios vira várias chamadas", async () => {
    // O piloto 3 perdeu a fase 1 inteira com 51 critérios num lote só: o modelo
    // derivou e voltou sem julgamento nenhum, duas vezes.
    const densa = [
      "## Phase 1: Fundação",
      "",
      "**Goal:** base · **Depends on:** none · **Covers:** statuses",
      "",
      ...Array.from({ length: 5 }, (_unused, indice) => [
        `- [ ] **Task:** Tarefa ${indice + 1}`,
        "  - **Acceptance criteria:**",
        ...Array.from({ length: 4 }, (_ignora, posicao) => `    - condição observável ${posicao + 1}`),
        "  - **Feature tests:** t → t",
        "  - **Traces:** statuses",
        "",
      ].join("\n")),
    ].join("\n");

    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: densa }, repeat: true });

    const agent = fakeAgent(steps);
    await runInit({
      projectRoot,
      request,
      language: "português do Brasil",
      maxCriteriaPerRehearsalBatch: 6,
      call: agent.call,
      ask: async () => "use as recomendações",
    });

    const ensaios = agent.calls.filter((call) => call.role === "verifier" && call.stage === "verify");
    expect(ensaios.length).toBeGreaterThan(1);
    for (const chamada of ensaios) {
      const enderecos = chamada.prompt.match(/^P\d+\.T\d+\.C\d+ /gm) ?? [];
      expect(enderecos.length).toBeLessThanOrEqual(6);
    }
  });

  it("lote sem julgamento acusa o ensaio, não o plano", async () => {
    const steps = happyPath().filter((step) => step.match.role !== "verifier");
    steps.push({ match: { role: "verifier", stage: "verify" }, respond: { stdout: "achei tudo ótimo" }, repeat: true });

    const { outcome } = await run(steps);
    const detalhe = outcome.readiness.checks.find((check) => check.id === "ensaio")?.detail ?? "";
    expect(detalhe).toContain("falha do ensaio, não do plano");
  });

  it("critério sem veredito não passa por omissão", async () => {
    const steps = happyPath().filter((step) => step.match.role !== "verifier");
    steps.push({ match: { role: "verifier", stage: "verify" }, respond: { stdout: "achei tudo ótimo" }, repeat: true });

    const { outcome } = await run(steps);
    expect(outcome.readiness.checks.find((check) => check.id === "ensaio")?.detail).toContain("NÃO ENSAIADO");
  });
});

describe("quando o provider falha, o que ele disse chega a quem chamou", () => {
  it("a mensagem carrega a resposta da CLI, não só o código de saída", async () => {
    // O caso real: o free tier do opencode recusando uso fora da própria
    // ferramenta. Antes, tudo isso virava "falhou com código 1".
    const recusa = JSON.stringify({
      error: { type: "FreeTierError", message: "OpenCode's free tier can only be used from within OpenCode" },
    });

    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: recusa, exitCode: 1 },
      repeat: true,
    });

    await expect(run(steps)).rejects.toThrow(/FreeTierError/);
  });

  it("diz o que fazer, e que nada do publicado se perdeu", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: "erro qualquer", exitCode: 1 },
      repeat: true,
    });

    await expect(run(steps)).rejects.toThrow(/--writer-model/);
    await expect(run(steps)).rejects.toThrow(/nada do que já foi publicado se perdeu/i);
  });

  it("CLI que morre calada não vira mensagem vazia", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: "   \n\n  ", exitCode: 1 },
      repeat: true,
    });

    await expect(run(steps)).rejects.toThrow(/a CLI não escreveu nada/);
  });
});
