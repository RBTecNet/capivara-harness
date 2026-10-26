import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitSpecification, runPhase, splitPhases } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseSession } from "../../src/loop/index.js";
import { readEvents, runPaths } from "../../src/state/index.js";
import { VALID_PHASES } from "../contract/fixture.js";

const run = promisify(execFile);
let projectRoot = "";
const RUN = "build-abc123abc123";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-runner-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function session(): PhaseSession {
  const split = splitPhases(VALID_PHASES, projectRoot, RUN);
  if (!split.ok) throw new Error("plano inválido");
  return split.sessions[0]!;
}

const ok = (stdout = "feito"): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });

interface Scenario {
  /** O executor só escreve na implementação: as correções não mudam nada. */
  soNaImplementacao?: boolean;
  builder?: (call: EngineCall) => Promise<EngineResult>;
  verifier?: (call: EngineCall) => Promise<EngineResult>;
  testExit?: number[];
  commits?: boolean;
  maxCycles?: number;
}

async function phase(scenario: Scenario) {
  const calls: EngineCall[] = [];
  let testRun = 0;
  const target = session();

  const outcome = await runPhase({
    projectRoot,
    runId: RUN,
    language: "pt-BR",
    engine: "codex",
    session: target,
    testCommand: { command: "npm test", source: "teste", containerized: false },
    commitsEnabled: scenario.commits ?? false,
    maxCycles: scenario.maxCycles ?? 3,
    sleep: async () => undefined,
    call: async (call) => {
      calls.push(call);
      if (call.role === "verifier") {
        return scenario.verifier
          ? scenario.verifier(call)
          : ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"));
      }
      // O executor escreve algo, para o gate 1 sinalizar mudança (só na implementação, quando o cenário pede).
      if (!scenario.soNaImplementacao || call.attempt === 1) await writeFile(join(projectRoot, `fase-${call.attempt}.ts`), `export const x = ${call.attempt};`, "utf8");
      return scenario.builder ? scenario.builder(call) : ok();
    },
    testRunner: async () => {
      const exit = scenario.testExit?.[testRun] ?? 0;
      testRun += 1;
      return { exitCode: exit, output: exit === 0 ? "2 passed" : "FAIL reserva.spec.ts\n  esperava 409, recebeu 500" };
    },
  });

  return { outcome, calls, target };
}

describe("ciclo de fase — caminho verde", () => {
  it.each(["quota", "configuration"] as const)("recusa %s do executor preserva a árvore sem outra chamada", async providerFailure => {
    const { outcome, calls } = await phase({ maxCycles: 3, builder: async () => ({ ...ok("recusa do provider"), engineError: true, providerFailure }) });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 0 — engine", cycles: 1 });
    expect(calls).toHaveLength(1);
    expect(await readFile(join(projectRoot, "fase-1.ts"), "utf8")).toContain("x = 1");
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some(event => event.status === "retry")).toBe(false);
  });

  it.each(["quota", "configuration"] as const)("recusa %s do verificador não pede reimplementação", async providerFailure => {
    const { outcome, calls } = await phase({ maxCycles: 3, verifier: async () => ({ ...ok("recusa do provider"), engineError: true, providerFailure }) });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 0 — engine", cycles: 1 });
    expect(calls.map(c => c.role)).toEqual(["builder", "verifier"]);
  });

  /*
   * §125: o tempo acabou DEPOIS de a sessão escrever — o parcial é julgado uma
   * vez pelos gates, sem outra sessão de construção (§115.17 continua: nenhuma
   * hora de construção nova). Verde, fecha; vermelho, para com o parcial.
   */
  it.each(["wall", "idle", "first-output"])("timeout %s com trabalho escrito: o parcial é julgado uma vez, sem outra sessão de construção", async timedOut => {
    const { outcome, calls } = await phase({ maxCycles: 3, builder: async () => ({ exitCode: 124, stdout: "Continuarei investigando um mutante. CAPIVARA_BUILDER_STATUS: COMPLETE", stderr: "", timedOut }) });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.filter(call => call.role === "builder")).toHaveLength(1);
    expect(calls.filter(call => call.role === "verifier")).toHaveLength(1);
    expect(await readFile(join(projectRoot, "fase-1.ts"), "utf8")).toContain("x = 1");
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some(event => event.status === "retry")).toBe(false);
  });

  it.each(["wall", "idle", "first-output"])("timeout %s cujo parcial não fecha: para com o parcial preservado, sem outra sessão de construção", async timedOut => {
    const { outcome, calls } = await phase({ maxCycles: 3, testExit: [1, 1, 1], builder: async () => ({ exitCode: 124, stdout: "Continuarei investigando um mutante.", stderr: "", timedOut }) });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto", cycles: 1 });
    expect(calls.filter(call => call.role === "builder")).toHaveLength(1);
    expect(calls.filter(call => call.role === "verifier")).toHaveLength(0);
    expect(await readFile(join(projectRoot, "fase-1.ts"), "utf8")).toContain("x = 1");
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.at(-1)?.status).toBe("blocked");
    expect(events.some(event => event.status === "retry")).toBe(false);
  });

  // A revisão que cai não vira nova construção: ganha uma revisão a mais e, sem leitura, a fase não fecha — para em verificação inconclusiva.
  it("timeout do verificador não vira nova sessão do construtor: uma revisão a mais, e sem leitura a fase para em verificação inconclusiva", async () => {
    const { outcome, calls } = await phase({ maxCycles: 3, verifier: async () => ({ exitCode: 124, stdout: "Investigando critérios", stderr: "", timedOut: "wall" }) });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 3 — verificação independente", cycles: 1 });
    if (outcome.status === "failed") expect(outcome.inconclusiva).toContain("nem na segunda chamada");
    expect(calls.filter(call => call.role === "builder")).toHaveLength(1);
    expect(calls.filter(call => call.role === "verifier")).toHaveLength(2);
  });

  it("timeout confirmado não vira repetição por texto de rate limit na resposta parcial", async () => {
    const { outcome, calls } = await phase({ builder: async () => ({ exitCode: 124, stdout: "rate limit exceeded HTTP 429", stderr: "", timedOut: "wall" }) });
    // O parcial é julgado (§125), mas a sessão do executor nunca é repetida por causa do texto de limite.
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.filter(call => call.role === "builder")).toHaveLength(1);
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some(event => event.detail.includes("limite de uso"))).toBe(false);
  });
  it("fecha a fase quando os quatro gates ficam verdes", async () => {
    const { outcome } = await phase({});
    expect(outcome.status).toBe("complete");
  });

  it("grava o prompt e o log de cada ciclo, auditáveis", async () => {
    const { target } = await phase({});
    const paths = runPaths(projectRoot, RUN);
    expect((await readFile(join(paths.prompts, `${target.id}.cycle-1.txt`), "utf8")).length).toBeGreaterThan(100);
    expect(await readFile(join(paths.logs, `${target.id}.verify-1.log`), "utf8")).toContain("TASK 1: DONE");
  });

  it("registra eventos que permitem retomar", async () => {
    await phase({});
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.at(-1)).toMatchObject({ subject: "P01", status: "complete" });
  });
});

describe("a palavra do agente nunca supera um gate", () => {
  it("executor declara COMPLETE mas a suíte está vermelha: a fase não é aceita — falha, com a suíte como causa", async () => {
    const { outcome } = await phase({
      builder: async () => ok("pronto\nCAPIVARA_BUILDER_STATUS: COMPLETE"),
      testExit: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
    if (outcome.status !== "failed") return;
    expect(outcome.cause).toContain("esperava 409, recebeu 500");
  });

  it("executor declara COMPLETE mas o verificador vê task incompleta: o reparo volta à revisão, e a task que segue incompleta faz a fase falhar", async () => {
    const { outcome, calls } = await phase({
      builder: async () => ok("CAPIVARA_BUILDER_STATUS: COMPLETE"),
      verifier: async () => ok("TASK 1: DONE\nTASK 2: INCOMPLETE — falta o seed"),
    });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 3 — verificação independente" });
    if (outcome.status !== "failed") return;
    expect(outcome.cause).toContain("falta o seed");
    // A revisão relê depois de cada reparo: a fase só fecharia com ela aprovando.
    expect(calls.filter((call) => call.role === "verifier").length).toBeGreaterThan(1);
    // O achado chegou ao executor: a correção dele leva o diagnóstico da revisão.
    expect(calls.filter((call) => call.role === "builder").at(-1)?.prompt).toContain("falta o seed");
  });
});

describe("ciclos de correção", () => {
  it("a segunda tentativa recebe a causa REAL da falha", async () => {
    const { calls } = await phase({ testExit: [1, 0] });
    const correcao = calls.find((call) => call.role === "builder" && call.attempt === 2);
    expect(correcao?.prompt).toContain("esperava 409, recebeu 500");
    expect(correcao?.prompt).toContain("gate 2");
  });

  // §125: a correção localizada não abre ciclo: converge no ciclo 1, com duas sessões do executor.
  it("converge quando a correção seguinte conserta, sem abrir outro ciclo", async () => {
    const { outcome, calls } = await phase({ testExit: [1, 0] });
    expect(outcome.status).toBe("complete");
    if (outcome.status === "complete") expect(outcome.cycles).toBe(1);
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(2);
  });

  /*
   * §125 (spec §5.2 e §5.3): a correção que muda o código sem resolver não se
   * repete no MESMO ciclo. O ciclo inteiro sem progresso em nenhum defeito — a
   * mesma falha — esgotou a escada de verdade: outro ciclo repetiria as mesmas
   * estratégias, e a fase falha com o defeito dito, sem abri-lo.
   */
  it("a mesma falha com o código mudando: o ciclo sem progresso encerra a escada, e a fase falha sem abrir outro ciclo", async () => {
    const { outcome, calls } = await phase({ testExit: [1, 1, 1, 1, 1, 1], maxCycles: 3 });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1, gate: "gate 2 — suíte do projeto" });
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(2);
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some((event) => event.detail.includes("não trouxe progresso em nenhum defeito aberto"))).toBe(true);
  });

  // §125 (spec §5.3): a correção que não muda nada não é repetida — é a impossibilidade real, e a fase falha antes dos ciclos.
  it("a correção que não muda nada termina por esgotamento técnico, sem gastar os ciclos restantes: a fase falha com o defeito dito", async () => {
    const { outcome, calls } = await phase({ testExit: [1, 1, 1, 1, 1, 1], maxCycles: 3, soNaImplementacao: true });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1, gate: "gate 2 — suíte do projeto" });
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(2);
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some((event) => event.detail.includes("nenhuma estratégia restante tem informação nova"))).toBe(true);
  });

  it("com progresso a cada correção, os ciclos se esgotam e a fase falha", async () => {
    const target = session();
    const calls: EngineCall[] = [];
    let suites = 0;
    const outcome = await runPhase({
      projectRoot, runId: RUN, language: "pt-BR", engine: "codex", session: target,
      testCommand: { command: "npm test", source: "teste", containerized: false },
      commitsEnabled: false, maxCycles: 2, sleep: async () => undefined,
      call: async (call) => {
        calls.push(call);
        if (call.role === "verifier") return ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"));
        await writeFile(join(projectRoot, `fase-${calls.length}.ts`), `export const x = ${calls.length};`, "utf8");
        return ok();
      },
      // Cada correção muda a falha: é progresso, e a recuperação continua enquanto houver orçamento.
      testRunner: async () => {
        const nome = ["alfa", "beta", "gama", "delta", "epsilon", "zeta", "eta"][suites++] ?? "omega";
        return { exitCode: 1, output: `FAIL reserva.spec.ts > caso ${nome}\n  esperava o caso ${nome}` };
      },
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 2, gate: "gate 2 — suíte do projeto" });
    // Implementação + duas correções por ciclo (o orçamento do defeito), em dois ciclos.
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(5);
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some((event) => event.detail.includes("os 2 ciclo(s) de correção desta execução se esgotaram"))).toBe(true);
    expect(events.some((event) => event.stage === "recover" && event.detail.startsWith("novo ciclo"))).toBe(true);
  });

  it("G0 vermelho também vira ciclo de correção com a saída do engine", async () => {
    const { outcome } = await phase({ builder: async () => ({ exitCode: 3, stdout: "erro de sintaxe na linha 4", stderr: "", timedOut: null }) });
    if (outcome.status !== "failed") throw new Error("deveria falhar");
    expect(outcome.gate).toBe("gate 0 — engine");
    expect(outcome.cause).toContain("erro de sintaxe");
  });
});

describe("fase já implementada", () => {
  it("sessão que não escreve nada, com gates verdes, fecha sem commit", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const target = session();
    const outcome = await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: target,
      testCommand: null,
      commitsEnabled: true,
      sleep: async () => undefined,
      call: async (call) =>
        call.role === "verifier"
          ? ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"))
          : ok("nada a fazer: já está implementado"),
    });

    expect(outcome.status).toBe("already-implemented");
  });
});

describe("commit por fase", () => {
  it("fase verde com árvore suja gera um commit", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const { outcome } = await phase({ commits: true });
    expect(outcome.status).toBe("complete");
    if (outcome.status !== "complete") return;
    expect(outcome.committed).toBe(true);
    const { stdout } = await run("git", ["log", "--format=%s", "-1"], { cwd: projectRoot });
    expect(stdout.trim()).toBe("feat(phase-1): Fundação de dados");
  });

  it("sem git, roda e apenas registra", async () => {
    const { outcome } = await phase({ commits: false });
    if (outcome.status !== "complete") throw new Error("deveria completar");
    expect(outcome.committed).toBe(false);
  });
});

describe("limite de uso", () => {
  it("espera e repete a MESMA fase sem consumir ciclo", async () => {
    let tentativa = 0;
    const target = session();
    const builderCalls: number[] = [];

    const outcome = await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: target,
      testCommand: null,
      commitsEnabled: false,
      maxCycles: 2,
      sleep: async () => undefined,
      call: async (call) => {
        if (call.role === "verifier") {
          return ok(Array.from({ length: target.taskCount }, (_, index) => `TASK ${index + 1}: DONE`).join("\n"));
        }
        builderCalls.push(call.attempt);
        tentativa += 1;
        await writeFile(join(projectRoot, `f${tentativa}.ts`), "x", "utf8");
        return tentativa === 1 ? ok("trabalhando\nrate limit reached") : ok("feito");
      },
    });

    expect(outcome.status).toBe("complete");
    // Duas chamadas ao executor, ambas no ciclo 1: a espera não consumiu ciclo.
    expect(builderCalls).toEqual([1, 1]);
  });
});

describe("fase que para deixando trabalho na árvore", () => {
  it("diz as duas saídas, em vez de deixar o operador num beco", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "inicial\n", "utf8");
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });

    const avisos: string[] = [];
    const target = session();

    const outcome = await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: target,
      testCommand: null,
      commitsEnabled: true,
      maxCycles: 1,
      sleep: async () => undefined,
      announce: (mensagem) => avisos.push(mensagem),
      // A fase para de verdade — o provider recusa a sessão depois de ela escrever —, e o parcial fica na árvore.
      call: async (call) => {
        if (call.role === "verifier") return ok("TASK 1: INCOMPLETE — falta tudo");
        await writeFile(join(projectRoot, "parcial.ts"), "export const x = 1;", "utf8");
        return { ...ok("escrevi algo mas não terminei"), engineError: true, providerFailure: "quota" };
      },
    });

    expect(outcome.status).toBe("failed");
    const texto = avisos.join("\n");
    expect(texto).toContain("trabalho parcial desta fase ficou na árvore");
    expect(texto).toContain("git commit");
    expect(texto).toContain("git clean -fd");
  }, 20000);

  it("fase que para sem ter escrito nada não sugere commit de coisa nenhuma", async () => {
    const avisos: string[] = [];
    const target = session();

    await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: target,
      testCommand: null,
      commitsEnabled: false,
      maxCycles: 1,
      sleep: async () => undefined,
      announce: (mensagem) => avisos.push(mensagem),
      call: async (call) => (call.role === "verifier" ? ok("TASK 1: INCOMPLETE — falta tudo") : ok("nada a fazer")),
    });

    expect(avisos.join("\n")).not.toContain("trabalho parcial");
  }, 20000);
});

describe("a especificação entra no histórico", () => {
  it("sem repositório, diz que não versionou em vez de quebrar", async () => {
    const solto = await mkdtemp(join(tmpdir(), "capivara-sem-git-"));
    try {
      const resultado = await commitSpecification(solto, "PLAN READY");
      expect(resultado.committed).toBe(false);
      expect(resultado.message).toContain("sem repositório");
    } finally {
      await rm(solto, { recursive: true, force: true });
    }
  });

  it("versiona os documentos publicados e nada do trabalho em andamento", async () => {
    const repo = await mkdtemp(join(tmpdir(), "capivara-git-"));
    try {
      await run("git", ["init", "-q"], { cwd: repo });
      await run("git", ["config", "user.email", "t@t"], { cwd: repo });
      await run("git", ["config", "user.name", "t"], { cwd: repo });
      await mkdir(join(repo, ".capivara", "init"), { recursive: true });
      await writeFile(join(repo, ".capivara", "init", "skeleton.md"), "# doc\n", "utf8");
      await writeFile(join(repo, "rascunho.txt"), "trabalho em andamento\n", "utf8");

      const resultado = await commitSpecification(repo, "PLAN READY");
      expect(resultado.committed).toBe(true);

      const versionados = await run("git", ["ls-files"], { cwd: repo });
      expect(versionados.stdout).toContain(".capivara/init/skeleton.md");
      expect(versionados.stdout).not.toContain("rascunho.txt");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("rodar de novo sem mudança não cria commit vazio", async () => {
    const repo = await mkdtemp(join(tmpdir(), "capivara-git-"));
    try {
      await run("git", ["init", "-q"], { cwd: repo });
      await run("git", ["config", "user.email", "t@t"], { cwd: repo });
      await run("git", ["config", "user.name", "t"], { cwd: repo });
      await mkdir(join(repo, ".capivara", "init"), { recursive: true });
      await writeFile(join(repo, ".capivara", "init", "skeleton.md"), "# doc\n", "utf8");
      await commitSpecification(repo, "PLAN READY");

      const segunda = await commitSpecification(repo, "PLAN READY");
      expect(segunda.committed).toBe(false);
      expect(segunda.message).toContain("já é esta");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("cada estágio versiona o que ele produziu", () => {
  it("a mensagem nomeia o gate que aquele estágio de fato alcança", async () => {
    const repo = await mkdtemp(join(tmpdir(), "capivara-git-"));
    try {
      await run("git", ["init", "-q"], { cwd: repo });
      await run("git", ["config", "user.email", "t@t"], { cwd: repo });
      await run("git", ["config", "user.name", "t"], { cwd: repo });
      await mkdir(join(repo, ".capivara", "init"), { recursive: true });

      // O init publica o esqueleto e para em PLAN READY.
      await writeFile(join(repo, ".capivara", "init", "skeleton.md"), "# esqueleto\n", "utf8");
      expect((await commitSpecification(repo, "PLAN READY")).message).toContain("PLAN READY");

      // O plan publica o plano executável — o artefato que o loop consome — e
      // ele precisa entrar no histórico tanto quanto o esqueleto.
      await writeFile(join(repo, ".capivara", "init", "project-phases.md"), "# plano\n", "utf8");
      const segundo = await commitSpecification(repo, "RALPH READY");
      expect(segundo.committed).toBe(true);
      expect(segundo.message).toContain("RALPH READY");

      const versionados = await run("git", ["ls-files"], { cwd: repo });
      expect(versionados.stdout).toContain(".capivara/init/project-phases.md");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

/*
 * A P04 do `assitencia` gastou meia hora de sessão para descobrir que o
 * `@playwright/test` não estava instalado — uma ausência que o preflight já
 * tinha anotado antes da primeira chamada, e que o harness só contava quando o
 * gate 4 reprovava.
 */
describe("o runner de fluxos é dito antes, não depois", () => {
  const fluxo = { number: "1", name: "Cadastro", steps: ["abre", "salva"] };

  async function comFluxos(instalado: boolean) {
    if (instalado) {
      await mkdir(join(projectRoot, "node_modules", "@playwright", "test"), { recursive: true });
    }
    const chamadas: EngineCall[] = [];
    await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: session(),
      testCommand: null,
      commitsEnabled: false,
      maxCycles: 1,
      sleep: async () => undefined,
      flows: { workflows: [fluxo], resolveStart: async () => null },
      call: async (call) => {
        chamadas.push(call);
        return ok(call.role === "verifier" ? "CAPIVARA_VERIFY: 1.1 | DONE | pronto" : "feito");
      },
      testRunner: async () => ({ exitCode: 0, output: "" }),
    });
    return chamadas;
  }

  it("avisa na primeira sessão da fase que declara fluxo — e só manda instalar se a infraestrutura aprovada o declara (§129)", async () => {
    const chamadas = await comFluxos(false);
    const implementacao = chamadas.find((chamada) => chamada.role === "builder");
    expect(implementacao?.prompt).toContain("@playwright/test");
    expect(implementacao?.prompt).toContain("If the approved\ninfrastructure declares it, install it as declared");
    expect(implementacao?.prompt).toContain("If it does not, do not add it");
    expect(implementacao?.prompt).not.toContain("saves a whole cycle");
    // E diz qual pacote é: ter `playwright` não satisfaz `@playwright/test`.
    expect(implementacao?.prompt).toContain("not `playwright`, the library");
  });

  it("não avisa quando o runner já está lá — aviso inútil é ruído", async () => {
    const chamadas = await comFluxos(true);
    expect(chamadas.find((chamada) => chamada.role === "builder")?.prompt).not.toContain("which this project does not have installed");
  });
});

/*
 * §107: no `build-96756ca336b0` o contrato do gate 4 só aparecia na causa do
 * último ciclo, e P03, P04 e P05 bloquearam com a aplicação na 3001 da `PORTA`.
 */
describe("o contrato de subida do gate 4 é dito desde o primeiro ciclo", () => {
  async function primeiroPrompt(workflows: { number: string; name: string; steps: string[] }[] | null, start: string | null = null) {
    const chamadas: EngineCall[] = [];
    await runPhase({
      projectRoot,
      runId: RUN,
      language: "pt-BR",
      engine: "codex",
      session: session(),
      testCommand: null,
      commitsEnabled: false,
      maxCycles: 1,
      sleep: async () => undefined,
      ...(workflows !== null ? { flows: { workflows, resolveStart: async () => start } } : {}),
      call: async (call) => {
        chamadas.push(call);
        return ok(call.role === "verifier" ? "CAPIVARA_VERIFY: 1.1 | DONE | pronto" : "feito");
      },
      testRunner: async () => ({ exitCode: 0, output: "" }),
    });
    return chamadas.find((chamada) => chamada.role === "builder")?.prompt ?? "";
  }

  it("a fase com fluxo recebe npm start, PORT e HOST na primeira sessão", async () => {
    const prompt = await primeiroPrompt([{ number: "1", name: "Cadastro", steps: ["abre", "salva"] }]);
    expect(prompt).toContain("`npm start`");
    expect(prompt).toContain("`PORT` and `HOST`");
    expect(prompt).toContain("listens on a fixed port fails the gate");
  });

  /*
   * §109: no `build-96756ca336b0` retomado as três fases receberam o contrato e
   * as três deixaram o gate 4 descobrir a falta de `start`, um ciclo cada.
   */
  it("sem start no manifesto, a primeira sessão ouve que precisa criá-lo", async () => {
    const fluxo = [{ number: "1", name: "Cadastro", steps: ["abre", "salva"] }];
    expect(await primeiroPrompt(fluxo, null)).toContain("This project does NOT declare that entrypoint yet");
    expect(await primeiroPrompt(fluxo, "npm start")).not.toContain("does NOT declare that entrypoint");
  });

  it("a fase sem fluxo, e sem fluxo antes dela, não recebe o contrato", async () => {
    const prompt = await primeiroPrompt(null);
    expect(prompt).not.toBe("");
    expect(prompt).not.toContain("How the application is started for the flow gate");
  });
});

/*
 * O P02 do `assistencia2`: o codex começou a responder `401 Unauthorized:
 * Incorrect API key` no meio do build. O verificador do ciclo 2 recebeu isso, não
 * emitiu linha nenhuma, e o gate 3 contou como reprovação; o executor do ciclo 3
 * recebeu o mesmo, e o build parou. O produto não reprovou nenhuma das duas vezes.
 */
describe("credencial recusada pelo provider", () => {
  // O envelope exato que o codex escreveu, com a chave mascarada como ele mascara.
  const recusa = [
    '{"type":"thread.started","thread_id":"01a0"}',
    '{"type":"error","message":"Reconnecting... 5/5 (stream disconnected before completion: websocket closed by server before response.completed)"}',
    '{"type":"error","message":"unexpected status 401 Unauthorized: Incorrect API key provided: sk-svcac**********fvMA. You can find your API key at https://platform.openai.com/account/api-keys."}',
  ].join("\n");
  const recusada = (): EngineResult => ({ exitCode: 1, stdout: recusa, stderr: "", timedOut: null });

  it("no executor: pára na hora, sem gastar ciclo e sem culpar a fase", async () => {
    const { outcome, calls } = await phase({ builder: async () => recusada() });
    expect(outcome.status).toBe("credential-rejected");
    if (outcome.status !== "credential-rejected") return;
    expect(outcome.engine).toBe("codex");
    expect(outcome.cycles).toBe(1);
    expect(outcome.evidence).toContain("Incorrect API key");
    // Nenhuma segunda chamada: repetir com a mesma credencial só queima a fase.
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(1);
  });

  it("no verificador: não vira 'o verificador não emitiu linha nenhuma'", async () => {
    const { outcome } = await phase({ verifier: async () => recusada() });
    expect(outcome.status).toBe("credential-rejected");
  });

  it("a chave nunca entra na evidência, nem mascarada", async () => {
    const { outcome } = await phase({ builder: async () => recusada() });
    if (outcome.status !== "credential-rejected") throw new Error("deveria recusar");
    expect(outcome.evidence).not.toContain("svcac");
    expect(outcome.evidence).not.toContain("fvMA");
  });

  /*
   * O falso positivo que mais importa: o PRODUTO testando a própria
   * autenticação. Um asserto que espera 401 numa rota protegida não é o provider
   * recusando nada, e parar o build por isso seria o defeito inverso.
   */
  it("o produto testando a própria rota protegida não é credencial recusada", async () => {
    const { outcome } = await phase({
      builder: async () =>
        ok(["implementei a rota de anexos", "✓ GET /anexos sem sessão responde 401 Unauthorized", "✓ 38 passed", "feito"].join("\n")),
    });
    expect(outcome.status).toBe("complete");
  });
});

/*
 * §108: a negação de permissão é diagnóstico, não parada. O §106 parava a fase
 * quando a sessão negada não concluía; com o executor liberado, quem julga o
 * que ficou são os gates, como em qualquer outra sessão.
 */
describe("comandos negados por permissão ao executor", () => {
  const negado = (): EngineResult => ({
    ...ok("Não consegui rodar npm: todo comando pediu aprovação. Não emiti a conclusão."),
    negacoes: ["Bash: npm", "Bash: node"],
  });

  it("não pára a fase: ela segue para os gates, e o verificador julga", async () => {
    const { outcome, calls } = await phase({ builder: async () => negado() });
    expect(outcome.status).toBe("complete");
    expect(calls.filter((call) => call.role === "verifier").length).toBeGreaterThan(0);
  });

  it("nenhuma parada de permissão no log de eventos", async () => {
    await phase({ builder: async () => negado() });
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.some((evento) => evento.status === "blocked")).toBe(false);
    expect(events.some((evento) => evento.detail.includes("permissão negada"))).toBe(false);
  });

  it("quem declarou conclusão segue para os gates: a negação não o impediu", async () => {
    const { outcome } = await phase({
      builder: async () => ({ ...ok("feito\nCAPIVARA_BUILDER_STATUS: COMPLETE"), negacoes: ["Bash: npm"] }),
    });
    expect(outcome.status).toBe("complete");
  });
});




