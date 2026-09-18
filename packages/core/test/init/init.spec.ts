import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DOCUMENT_CHAIN, InitBlockedError, evaluateReadiness, inspectProject, resolveRequest, runInit, summarizeInventory } from "../../src/init/index.js";
import { readEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { DESCRIPTION, PHASE_1, PHASE_2, approve, fakeAgent, happyPath, oneQuestion, reject, rehearsedAddresses } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-init-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "abc123abc123" };

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
    ask: async () => answers[asked++] ?? "use as recomendações",
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
  it("chega a RALPH READY e publica os quatro documentos", async () => {
    const { outcome } = await run(happyPath());
    expect(outcome.readiness.ready, outcome.readiness.checks.filter((c) => !c.passed).map((c) => `${c.title}: ${c.detail}`).join("\n")).toBe(true);

    for (const document of DOCUMENT_CHAIN) {
      const content = await readFile(join(projectRoot, ".capivara/init", document), "utf8");
      expect(content.length).toBeGreaterThan(50);
    }
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
    expect(content.split("\n")[2]).toMatch(/^<!-- inputs: project-description\.md@sha256:[0-9a-f]{12} /);
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
    expect(publicados.map((event) => event.subject)).toEqual([...DOCUMENT_CHAIN]);
  });

  it("uma fase por chamada: nunca um intervalo", async () => {
    const { agent } = await run(happyPath());
    const partes = agent.calls.filter((call) => call.subject.startsWith("phase-p"));
    expect(partes.map((call) => call.subject)).toEqual(["phase-p01", "phase-p02"]);
  });

  it("nenhuma chamada fica sem roteiro", async () => {
    const { agent } = await run(happyPath());
    expect(agent.unmatched).toEqual([]);
  });
});

describe("entrevista dentro do init", () => {
  it("apresenta a pergunta e usa a decisão aceita", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { agent } = await run(steps, ["1"]);
    const escrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "project-description.md");
    expect(escrita?.prompt).toContain("Node + Vitest");
  });

  it("'não sei' não vira decisão confirmada", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await run(steps, ["não sei"]);
    expect(outcome.report.checkpoint.decisions).toHaveLength(0);
    expect(outcome.report.checkpoint.deferrals).toHaveLength(1);
  });

  it("resposta em texto livre que não fecha volta para quem a escreveu", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
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
    expect(outcome.report.checkpoint.decisions).toHaveLength(1);
  });

  it("o que segue em aberto é dito, nunca sumido", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    steps.unshift({
      match: { role: "auditor", stage: "interview" },
      respond: { stdout: "CAPIVARA_ANSWER: Q-01 | DEFERRED | não dá para saber a stack" },
      repeat: true,
    });

    const { outcome, anunciado } = await run(steps, ["sei lá, o que for melhor", ""]);
    expect(anunciado).toContain("Segue em aberto");
    expect(outcome.report.checkpoint.decisions).toHaveLength(0);
  });

  it("o classificador recebe a evidência e as opções, não só a pergunta", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
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
    steps.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { outcome } = await run(steps, ["não sei"]);
    expect(outcome.readiness.ready).toBe(false);
    const entrevista = outcome.readiness.checks.find((check) => check.id === "entrevista");
    expect(entrevista?.passed).toBe(false);
  });
});

describe("referência de design", () => {
  it("caminho que não existe em disco volta ao escritor, não ao gate", async () => {
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
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p01" }, respond: { stdout: PHASE_1 }, repeat: true });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "phase-p02" }, respond: { stdout: PHASE_2 }, repeat: true });

    const { agent } = await run(steps);
    const reescrita = agent.calls.find((call) => call.subject === "phase-p01" && call.attempt > 1);
    expect(reescrita?.prompt).toContain("telas/inicial.png");
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

describe("retomada", () => {
  it("documento já publicado neste run não é reescrito, e suas decisões descem a cadeia", async () => {
    const primeiro = happyPath();
    primeiro.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    // O primeiro run morre depois de publicar project-description.md.
    primeiro.unshift({ match: { role: "writer", stage: "authoring", subject: "user-stories.md" }, respond: { stdout: "", exitCode: 124 }, repeat: true });
    await expect(run(primeiro, ["1"])).rejects.toThrow(InitBlockedError);

    const { agent, anunciado, outcome } = await run(happyPath());
    expect(anunciado).toContain("reaproveitado deste run");
    expect(agent.calls.some((call) => call.stage === "authoring" && call.subject === "project-description.md")).toBe(false);
    // A decisão da entrevista do documento reaproveitado continua valendo.
    const escrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "user-stories.md");
    expect(escrita?.prompt).toContain("Node + Vitest");
    expect(outcome.readiness.ready).toBe(true);
  });

  it("resposta já dada não é perguntada de novo", async () => {
    const primeiro = happyPath();
    primeiro.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    primeiro.unshift({ match: { role: "writer", stage: "authoring", subject: "project-description.md" }, respond: { stdout: "", exitCode: 124 }, repeat: true });
    await expect(run(primeiro, ["1"])).rejects.toThrow(InitBlockedError);

    const segundo = happyPath();
    segundo.unshift({ match: { role: "writer", stage: "interview", subject: "project-description.md", attempt: 1 }, respond: { stdout: oneQuestion() } });
    const { anunciado, outcome } = await run(segundo, []);
    expect(anunciado).toContain("resposta(s) retomada(s)");
    expect(outcome.report.checkpoint.decisions).toHaveLength(1);
  });

  it("plano publicado que não passa mais nas verificações é reescrito, não reaproveitado", async () => {
    /*
     * É a situação do piloto 3: um plano publicado por uma versão anterior, que
     * o gate reprova. Reaproveitá-lo devolveria o mesmo NOT READY para sempre.
     */
    await run(happyPath());

    const plano = join(projectRoot, ".capivara", "init", "project-phases.md");
    const publicado = await readFile(plano, "utf8");
    await writeFile(plano, publicado.replace(/\*\*Traces:\*\* .*/g, "**Traces:** nada"), "utf8");

    const { agent, anunciado } = await run(happyPath());
    expect(anunciado).toContain("não passa mais nas verificações mecânicas");
    expect(agent.calls.some((call) => call.subject === "phase-p01")).toBe(true);
  });

  it("plano reaproveitado ainda é ensaiado: reaproveitar texto não reaproveita veredito", async () => {
    // Sem isto o gate reprovaria por o ensaio não ter rodado, e a tentativa
    // seguinte reaproveitaria de novo — reprovado para sempre.
    await run(happyPath());

    const { agent, outcome } = await run(happyPath());
    const ensaios = agent.calls.filter((call) => call.role === "verifier" && call.stage === "verify");
    expect(ensaios.length).toBeGreaterThan(0);
    expect(outcome.readiness.checks.find((check) => check.id === "ensaio")?.passed).toBe(true);
  });

  it("--fresh ignora tudo e recomeça", async () => {
    const primeiro = happyPath();
    primeiro.unshift({ match: { role: "writer", stage: "authoring", subject: "user-stories.md" }, respond: { stdout: "", exitCode: 124 }, repeat: true });
    await expect(run(primeiro)).rejects.toThrow(InitBlockedError);

    const { agent, anunciado } = await run(happyPath(), [], { fresh: true });
    expect(anunciado).not.toContain("reaproveitado");
    expect(agent.calls.some((call) => call.stage === "authoring" && call.subject === "project-description.md")).toBe(true);
  });
});

describe("decisão de impasse", () => {
  /** Leva o documento ao impasse: o auditor reprova sempre, o escritor insiste. */
  function semConvergencia(): ScriptStep[] {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-description.md" },
      respond: { stdout: reject("Tech Stack", "a regra não diz sobre o que a operação incide", "nomeie o alvo") },
      repeat: true,
    });
    steps.push({
      match: { role: "writer", stage: "authoring", subject: "project-description.md" },
      respond: { stdout: DESCRIPTION },
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
      await readFile(join(projectRoot, ".capivara", "handoffs", `${runIdFor("init", request.sha12)}.project-description.md.json`), "utf8"),
    ) as { answers: { questionId: string; disposition: string; decision: string }[] };

    const registrada = handoff.answers.find((answer) => answer.questionId.startsWith("SD-"));
    expect(registrada?.disposition).toBe("ACCEPTED");
    expect(registrada?.decision).toContain("aparado na gravação");
  });

  it("e desce a cadeia: o documento seguinte é escrito sabendo dela", async () => {
    const regra = "o valor é aparado na gravação e a comparação ignora caixa";
    const { agent } = await comImpasse(regra);

    const seguinte = agent.calls.find((call) => call.stage === "authoring" && call.subject === "user-stories.md");
    expect(seguinte?.prompt).toContain("aparado na gravação");
  });
});

describe("limite de uso", () => {
  it("espera e repete sem gastar a tentativa, em vez de matar a entrevista", async () => {
    const dormidas: number[] = [];
    const steps = happyPath();
    let vez = 0;
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "project-description.md" },
      respond: {
        stdout: () => {
          vez += 1;
          return vez === 1 ? "rate limit reached" : DESCRIPTION;
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
      match: { role: "writer", stage: "authoring", subject: "project-description.md" },
      respond: {
        stdout: () => (vez === 0 ? "" : DESCRIPTION),
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

  it("estouro duas vezes para o run dizendo o que fazer", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "project-description.md" },
      respond: { stdout: "", exitCode: 124 },
      repeat: true,
    });
    await expect(run(steps)).rejects.toThrow(/estourou o tempo duas vezes/);
  });
});

describe("auditoria dentro do init", () => {
  it("devolve, o escritor reescreve, e o documento é publicado", async () => {
    const steps = happyPath();
    steps.unshift({
      match: { role: "auditor", stage: "audit", subject: "project-description.md", attempt: 1 },
      respond: { stdout: reject("Tech Stack", "a versão do Node não é a decidida", "use Node 26, como decidido na entrevista") },
    });
    steps.push({ match: { role: "writer", stage: "authoring", subject: "project-description.md", attempt: 2 }, respond: { stdout: (await import("../support/fake-agent.js")).DESCRIPTION } });
    steps.push({ match: { role: "auditor", stage: "audit", subject: "project-description.md", attempt: 2 }, respond: { stdout: approve() } });

    const { outcome, agent } = await run(steps);
    expect(outcome.readiness.ready).toBe(true);
    const reescrita = agent.calls.find((call) => call.stage === "authoring" && call.subject === "project-description.md" && call.attempt === 2);
    expect(reescrita?.prompt).toContain("use Node 26");
  });

  it("saída inválida do auditor duas vezes bloqueia o run com diagnóstico", async () => {
    const steps = happyPath();
    steps.unshift({ match: { role: "auditor", stage: "audit" }, respond: { stdout: "achei que está bom" }, repeat: true });
    await expect(run(steps)).rejects.toThrow(InitBlockedError);
  });
});

describe("gate de prontidão", () => {
  const base = {
    documents: Object.fromEntries(DOCUMENT_CHAIN.map((name) => [name, "conteúdo"])) as Record<string, string>,
    stampInputs: [],
    coverage: { storyIds: [], entities: [], workflows: [] },
    approved: [...DOCUMENT_CHAIN],
    unresolvedQuestions: [],
    designRoot: ".capivara/init/design",
    designExists: () => true,
  };

  it("um único item falso produz NOT READY, nunca 'quase pronto'", () => {
    const readiness = evaluateReadiness({ ...base, approved: ["project-description.md"] });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.find((check) => check.id === "auditoria")?.detail).toContain("user-stories.md");
  });

  it("documento faltando é reportado pelo nome", () => {
    const documents = { ...base.documents };
    delete documents["user-stories.md"];
    const readiness = evaluateReadiness({ ...base, documents });
    expect(readiness.checks.find((check) => check.id === "documentos")?.detail).toContain("user-stories.md");
  });

  it("[NEEDS DECISION] em qualquer documento bloqueia", () => {
    const readiness = evaluateReadiness({
      ...base,
      documents: { ...base.documents, "user-stories.md": "texto [NEEDS DECISION] qual provedor de email" },
    });
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
