/**
 * O build paralelo de ponta a ponta, com Git de verdade (§97).
 *
 * O provider é falso — escreve arquivos no worktree que recebeu e responde ao
 * verificador —, mas o resto é o que roda em produção: worktree, commit da fase,
 * cherry-pick na árvore principal, desfazer, refazer sozinha.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARCA_DO_HARNESS, runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { artifactPaths, readEvents, replayEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";
import { arquivoSensivel } from "../../src/loop/admissao.js";

const run = promisify(execFile);

const FASE = (numero: number, titulo: string, depende: string): string =>
  [
    `## Phase ${numero}: ${titulo}`,
    "",
    `**Goal:** ${titulo} funciona · **Depends on:** ${depende} · **Covers:** workflow ${numero}`,
    "",
    `- [ ] **Task:** Entregar ${titulo.toLowerCase()}`,
    "  - **Acceptance criteria:**",
    `    - O arquivo de ${titulo.toLowerCase()} existe`,
    `  - **Traces:** US-${numero}.1`,
    "",
  ].join("\n");

/** P2 e P3 só dependem da fundação; P4 depende das duas. */
const PLANO = [
  "# Paralelo — Project Phases",
  "",
  "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
  "",
  "## Overview",
  "",
  "Fundação, duas frentes independentes, e a junção.",
  "",
  FASE(1, "Fundação", "none"),
  FASE(2, "Cadastro", "Phase 1"),
  FASE(3, "Relatório", "Phase 1"),
  FASE(4, "Painel", "Phase 2, Phase 3"),
  "## Open Questions",
  "",
  "Nenhuma.",
  "",
].join("\n");

interface Passo {
  /** O que a sessão do executor escreve, por fase. */
  escreve: Record<string, { path: string; content: string }[]>;
  /** Quanto o executor demora, por fase, para dar tempo de as outras correrem. */
  demora?: Record<string, number>;
  /** Fases cujo verificador nunca aprova. */
  reprova?: string[];
  /** O que o verificador responde, por fase, quando não é o DONE de sempre. */
  veredito?: Record<string, string>;
  /** Fases cujo executor escreve e então lança — o provider que cai no meio. */
  lanca?: string[];
}

let projectRoot: string;
let cache: string;

async function git(args: string[], cwd = projectRoot): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

async function existe(caminho: string): Promise<boolean> {
  return stat(caminho).then(() => true, () => false);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-paralelo-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-paralelo-cache-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
  await writeFile(join(projectRoot, ".capivara", "init", "project-phases.md"), PLANO, "utf8");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "docs: plano"]);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

function motor(passo: Passo) {
  const chamadas: EngineCall[] = [];
  let ativos = 0;
  let pico = 0;
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    if (chamada.role === "verifier") {
      const reprova = passo.reprova?.includes(chamada.phase.id) === true;
      const proprio = passo.veredito?.[chamada.phase.id];
      return { exitCode: 0, stdout: proprio ?? (reprova ? "TASK 1: INCOMPLETE — falta o arquivo" : "TASK 1: DONE"), stderr: "", timedOut: null };
    }
    ativos += 1;
    pico = Math.max(pico, ativos);
    await new Promise((resolve) => setTimeout(resolve, passo.demora?.[chamada.phase.id] ?? 30));
    for (const arquivo of passo.escreve[chamada.phase.id] ?? []) {
      const destino = join(chamada.root ?? projectRoot, arquivo.path);
      await mkdir(join(destino, ".."), { recursive: true });
      await writeFile(destino, arquivo.content, "utf8");
    }
    ativos -= 1;
    if (passo.lanca?.includes(chamada.phase.id) === true) throw new Error("o provider caiu no meio da sessão");
    return { exitCode: 0, stdout: "feito", stderr: "", timedOut: null };
  };
  return { call, chamadas, pico: () => pico, ativos: () => ativos };
}

const ESCRITAS: Passo["escreve"] = {
  P01: [{ path: "base.txt", content: "fundação\n" }],
  P02: [{ path: "cadastro.txt", content: "cadastro\n" }],
  P03: [{ path: "relatorio.txt", content: "relatório\n" }],
  P04: [{ path: "painel.txt", content: "painel\n" }],
};

async function construir(passo: Passo, extra: Partial<BuildOptions> = {}) {
  const engine = motor(passo);
  const anuncios: string[] = [];
  const testes: { command: string; cwd: string }[] = [];
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache },
    skipAcceptance: true,
    explicitTestCommand: "npm test",
    testRunner: async (command, cwd) => {
      testes.push({ command, cwd });
      return { exitCode: 0, output: "1 passed" };
    },
    announce: (mensagem) => anuncios.push(mensagem),
    parallel: {
      maxConcurrency: 3,
      agentes: [
        { engine: "codex", label: "codex", systemInstall: false },
        { engine: "codex", label: "codex", systemInstall: false },
        { engine: "codex", label: "codex", systemInstall: false },
      ],
      resumo: ["execução: paralela, até 3 agentes"],
    },
    ...extra,
  });
  return { outcome, engine, anuncios, testes };
}

describe("build paralelo", () => {
  it("fases independentes rodam ao mesmo tempo, cada uma no seu worktree, e o histórico sai um commit por fase", async () => {
    const { outcome, engine, anuncios } = await construir({ escreve: ESCRITAS, demora: { P02: 80, P03: 80 } });

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(engine.pico()).toBe(2);

    const raizes = new Map(engine.chamadas.filter((chamada) => chamada.role === "builder").map((chamada) => [chamada.phase.id, chamada.root]));
    expect(raizes.get("P02")).not.toBe(raizes.get("P03"));
    for (const raiz of raizes.values()) expect(raiz?.startsWith(cache)).toBe(true);
    // O verificador lê a árvore que o executor escreveu.
    for (const chamada of engine.chamadas.filter((item) => item.role === "verifier")) {
      expect(chamada.root).toBe(raizes.get(chamada.phase.id));
    }

    const historico = (await git(["log", "--format=%s"])).split("\n");
    expect(historico.filter((linha) => linha.startsWith("feat(phase-"))).toHaveLength(4);
    expect(historico[0]).toBe("feat(phase-4): Painel");
    for (const arquivo of ["base.txt", "cadastro.txt", "relatorio.txt", "painel.txt"]) {
      expect(await existe(join(projectRoot, arquivo)), arquivo).toBe(true);
    }

    // Nada sobra: nem worktree no disco, nem branch de fase.
    expect(await git(["branch", "--list", "capivara/*"])).toBe("");
    expect((await git(["worktree", "list"])).split("\n")).toHaveLength(1);

    const runId = runIdFor("build", sha12(PLANO));
    const progresso = replayEvents(await readEvents(runPaths(projectRoot, runId).events));
    expect([...progresso.completed].sort()).toEqual(["P01", "P02", "P03", "P04"]);
  });

  it("a fundação roda sozinha, e a fase que depende de duas espera as duas integradas", async () => {
    const { engine } = await construir({ escreve: ESCRITAS, demora: { P02: 20, P03: 120 } });
    const ordem = engine.chamadas.filter((chamada) => chamada.role === "builder").map((chamada) => chamada.phase.id);
    expect(ordem[0]).toBe("P01");
    expect(ordem.at(-1)).toBe("P04");
  });

  it("conflito na integração: desfaz, e a fase refaz SOZINHA sobre a árvore integrada", async () => {
    const escreve = {
      ...ESCRITAS,
      P02: [{ path: "compartilhado.txt", content: "do cadastro\n" }],
      P03: [{ path: "compartilhado.txt", content: "do relatório\n" }],
    };
    const { outcome, engine, anuncios } = await construir({ escreve, demora: { P02: 20, P03: 150 } });

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(anuncios.some((linha) => linha.includes("[P03] conflito ao integrar em compartilhado.txt"))).toBe(true);
    const sessoesDoRelatorio = engine.chamadas.filter((chamada) => chamada.role === "builder" && chamada.phase.id === "P03");
    expect(sessoesDoRelatorio).toHaveLength(2);
    expect(await readFile(join(projectRoot, "compartilhado.txt"), "utf8")).toBe("do relatório\n");

    // A conclusão só foi gravada depois de a fase entrar no produto.
    const runId = runIdFor("build", sha12(PLANO));
    const doRelatorio = (await readEvents(runPaths(projectRoot, runId).events)).filter((evento) => evento.subject === "P03");
    expect(doRelatorio.map((evento) => evento.status)).toEqual(["started", "started", "retry", "started", "started", "complete"]);
  });

  it("a suíte da árvore integrada é o juiz: verde no worktree e vermelho junto não entra no produto", async () => {
    const engine = motor({ escreve: ESCRITAS, demora: { P02: 20, P03: 150 } });
    const anuncios: string[] = [];
    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache },
      skipAcceptance: true,
      explicitTestCommand: "npm test",
      // Cada fase sozinha passa; o cadastro e o relatório juntos, não.
      testRunner: async (_command, cwd) => {
        const juntos = (await existe(join(cwd, "cadastro.txt"))) && (await existe(join(cwd, "relatorio.txt")));
        return juntos ? { exitCode: 1, output: "FAIL integracao.spec.ts" } : { exitCode: 0, output: "ok" };
      },
      announce: (mensagem) => anuncios.push(mensagem),
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: [],
      },
    });

    expect(outcome.exitCode).toBe(2);
    expect(anuncios.some((linha) => linha.startsWith("[P03] a suíte da árvore integrada reprovou"))).toBe(true);
    /*
     * Refeita sozinha, a fase parte da árvore que já tem o cadastro: a suíte
     * reprova DENTRO do worktree dela, e o executor tem os ciclos de correção
     * para resolver — como teria no build serial.
     */
    expect(outcome.errors.join("\n")).toContain("gate 2 — suíte do projeto");
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(false);
    expect(await existe(join(projectRoot, "cadastro.txt"))).toBe(true);
    // O trabalho da fase que não entrou fica no branch dela.
    expect(await git(["branch", "--list", "capivara/*"])).toContain("P03");
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P04")).toBe(false);
  });

  it("refeita sozinha e ainda vermelha na árvore integrada: a fase falha, e o produto fica como estava", async () => {
    const engine = motor({ escreve: ESCRITAS, demora: { P02: 20, P03: 150 } });
    const outcome = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache },
      skipAcceptance: true,
      explicitTestCommand: "npm test",
      // Só a árvore principal reprova a combinação — nenhum worktree vê o defeito.
      testRunner: async (_command, cwd) =>
        cwd === projectRoot && (await existe(join(cwd, "relatorio.txt"))) ? { exitCode: 1, output: "FAIL" } : { exitCode: 0, output: "ok" },
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: [],
      },
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("mesmo rodando sozinha");
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder" && chamada.phase.id === "P03")).toHaveLength(2);
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(false);
    expect((await git(["log", "--format=%s"])).split("\n").some((linha) => linha.includes("phase-3"))).toBe(false);
  });

  it("fase que falha para o build; a que estava rodando termina e é integrada", async () => {
    const { outcome, engine } = await construir({ escreve: ESCRITAS, demora: { P02: 20, P03: 120 }, reprova: ["P02"] });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.phases.find((fase) => fase.id === "P02")?.outcome.status).toBe("failed");
    expect(outcome.phases.find((fase) => fase.id === "P03")?.outcome.status).toBe("complete");
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(true);
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P04")).toBe(false);
    // O parcial da que falhou foi guardado no branch dela, fora da árvore principal.
    expect(await existe(join(projectRoot, "cadastro.txt"))).toBe(false);
    expect(await git(["log", "--format=%s", "-1", `capivara/${runIdFor("build", sha12(PLANO))}/P02`])).toContain("wip(P02)");
  });

  it("com --keep-going, só o que depende da que falhou é pulado", async () => {
    const { anuncios, engine } = await construir({ escreve: ESCRITAS, reprova: ["P02"] }, { keepGoing: true });
    expect(anuncios).toContain("[P04] pulada: depende de uma fase que falhou");
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P03")).toBe(true);
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P04")).toBe(false);
  });

  it("banco em servidor: o paralelo é suspenso e diz por quê, em vez de fingir", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DATABASE_URL=postgres://usuario@servidor.exemplo.invalid/app\n", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "env"]);
    const { outcome, engine, anuncios } = await construir({ escreve: ESCRITAS, demora: { P02: 60, P03: 60 } });

    expect(outcome.exitCode).toBe(0);
    expect(engine.pico()).toBe(1);
    expect(anuncios.some((linha) => linha.startsWith("paralelismo suspenso") && linha.includes("DATABASE_URL"))).toBe(true);
  });

  it("sem Git não há paralelo: o build não começa, em vez de rodar serial com outro nome", async () => {
    await rm(join(projectRoot, ".git"), { recursive: true, force: true });
    const { outcome, engine } = await construir({ escreve: ESCRITAS }, { gitInit: false });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errors.join("\n")).toContain("--serial");
    expect(engine.chamadas).toHaveLength(0);
  });

  it("o node_modules da árvore principal vai copiado para o worktree, não ligado", async () => {
    await mkdir(join(projectRoot, "node_modules", "pacote"), { recursive: true });
    await writeFile(join(projectRoot, "node_modules", "pacote", "index.js"), "module.exports = 1;\n", "utf8");
    await writeFile(join(projectRoot, ".gitignore"), "node_modules/\n", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "ignore"]);

    const escreve = { ...ESCRITAS, P02: [{ path: "node_modules/pacote/index.js", content: "module.exports = 2;\n" }, ...ESCRITAS.P02!] };
    const { outcome } = await construir({ escreve });
    expect(outcome.exitCode).toBe(0);
    expect(await readFile(join(projectRoot, "node_modules", "pacote", "index.js"), "utf8")).toBe("module.exports = 1;\n");
  });
});

/**
 * Os achados da auditoria do paralelo (docs/AUDITORIA-PARALELO.md, §99). Cada
 * teste reproduz o cenário do achado e falhava antes da correção.
 */
describe("build paralelo — auditoria (§99)", () => {
  const VERDE = { exitCode: 0, output: "ok" };
  const RUN = (): string => runIdFor("build", sha12(PLANO));

  async function commitar(arquivos: Record<string, string>, mensagem: string): Promise<void> {
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      await mkdir(join(projectRoot, caminho, ".."), { recursive: true });
      await writeFile(join(projectRoot, caminho), conteudo, "utf8");
    }
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", mensagem]);
  }

  async function aprovadasDa(fase: string): Promise<unknown[]> {
    const texto = await readFile(join(artifactPaths(projectRoot).handoffs, "tasks.json"), "utf8").catch(() => "[]");
    return (JSON.parse(texto) as { phase: string }[]).filter((entrada) => entrada.phase === fase);
  }

  async function arquivosDoBranch(branch: string): Promise<string[]> {
    return (await git(["ls-tree", "-r", "--name-only", branch])).split("\n");
  }

  /** A pasta de recuperação local da fase: fora do Git, dentro do plano de controle do run. */
  async function recuperacaoDa(fase: string): Promise<string> {
    const pasta = join(runPaths(projectRoot, RUN()).root, "recuperacao");
    const [unica] = (await readdir(pasta)).filter((nome) => nome.startsWith(`${fase}-`));
    if (!unica) throw new Error(`sem recuperação da ${fase} em ${pasta}`);
    return join(pasta, unica);
  }

  /** A integração da P03 reprova, e a suíte deixa na árvore o que `extra` disser — o cenário do rollback. */
  function suiteQueReprovaAP03(extra: () => Promise<void> = async () => undefined, antesDaP03: () => Promise<void> = async () => undefined) {
    return async (_comando: string, cwd: string): Promise<{ exitCode: number; output: string }> => {
      if (cwd !== projectRoot) return VERDE;
      if (!(await existe(join(cwd, "relatorio.txt")))) {
        await antesDaP03();
        return VERDE;
      }
      await escreverNaPrincipal("coverage/report.txt", "da suíte integrada\n");
      await extra();
      return { exitCode: 1, output: "FAIL" };
    };
  }

  const COM_COVERAGE = { ...ESCRITAS, P03: [...ESCRITAS.P03!, { path: "coverage/report.txt", content: "da fase\n" }] };

  async function escreverNaPrincipal(caminho: string, conteudo: string): Promise<void> {
    await mkdir(join(projectRoot, caminho, ".."), { recursive: true });
    await writeFile(join(projectRoot, caminho), conteudo, "utf8");
  }

  it("B1: a suíte da árvore integrada roda com o .env preparado, como a do worktree", async () => {
    await commitar({ ".env.example": "SEGREDO_DA_APP=exemplo\n", ".gitignore": ".env\n" }, "ambiente");
    // A suíte do projeto lê o ambiente: sem .env, reprova — no worktree e na principal.
    const { outcome, anuncios } = await construir(
      { escreve: ESCRITAS },
      { testRunner: async (_comando, cwd) => ((await existe(join(cwd, ".env"))) ? VERDE : { exitCode: 1, output: "FAIL: SEGREDO_DA_APP não definido" }) },
    );

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(anuncios.some((linha) => linha.includes("a suíte da árvore integrada reprovou"))).toBe(false);
    expect((await readFile(join(projectRoot, ".env"), "utf8")).startsWith(MARCA_DO_HARNESS)).toBe(true);
  });

  it("B2: a fase que para num gate não deixa aprovação de código que saiu da árvore", async () => {
    const segunda = [
      "- [ ] **Task:** Entregar o resto do cadastro",
      "  - **Acceptance criteria:**",
      "    - O resto do cadastro existe",
      "  - **Traces:** US-2.2",
      "",
    ].join("\n");
    const plano = PLANO.replace(FASE(2, "Cadastro", "Phase 1"), `${FASE(2, "Cadastro", "Phase 1")}${segunda}\n`);
    await commitar({ ".capivara/init/project-phases.md": plano }, "plano com duas tasks na P2");

    const primeiro = await construir({ escreve: ESCRITAS, veredito: { P02: "TASK 1: DONE\nTASK 2: INCOMPLETE — falta o resto" } });
    expect(primeiro.outcome.exitCode, primeiro.anuncios.join("\n")).toBe(2);
    // O código da task 1 foi para o branch da fase; a árvore principal não o tem.
    expect(await existe(join(projectRoot, "cadastro.txt"))).toBe(false);
    expect(await aprovadasDa("P02")).toEqual([]);

    // A retomada pergunta de novo sobre a task 1, em vez de carimbá-la.
    const segundo = await construir({ escreve: ESCRITAS, veredito: { P02: "TASK 1: DONE\nTASK 2: DONE" } });
    const verificacoes = segundo.engine.chamadas.filter((chamada) => chamada.role === "verifier" && chamada.phase.id === "P02");
    expect(verificacoes[0]?.prompt).not.toContain("Already DONE");
  });

  it("B2: a fase que nem sozinha fecha na árvore integrada também não deixa aprovação", async () => {
    const { outcome } = await construir(
      { escreve: ESCRITAS, demora: { P02: 20, P03: 150 } },
      {
        testRunner: async (_comando, cwd) =>
          cwd === projectRoot && (await existe(join(cwd, "relatorio.txt"))) ? { exitCode: 1, output: "FAIL" } : VERDE,
      },
    );
    expect(outcome.errors.join("\n")).toContain("mesmo rodando sozinha");
    expect(await aprovadasDa("P03")).toEqual([]);
    // A que entrou no produto continua aprovada.
    expect(await aprovadasDa("P02")).toHaveLength(1);
  });

  it("M1: arquivo não versionado na árvore principal não é chamado de conflito, e não é apagado", async () => {
    const escreve = { ...ESCRITAS, P03: [...ESCRITAS.P03!, { path: "coverage/report.txt", content: "da fase\n" }] };
    const { outcome, engine, anuncios } = await construir(
      { escreve, demora: { P02: 20, P03: 150 } },
      {
        // A suíte da principal deixa um relatório que ninguém versionou.
        testRunner: async (_comando, cwd) => {
          if (cwd === projectRoot) await escreverNaPrincipal("coverage/report.txt", "da suíte integrada\n");
          return VERDE;
        },
      },
    );

    expect(outcome.exitCode).toBe(2);
    expect(anuncios.some((linha) => linha.includes("conflito ao integrar"))).toBe(false);
    expect(outcome.errors.join("\n")).toContain("coverage/report.txt");
    // Não é conflito: refazer não muda nada, e a fase não é refeita.
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder" && chamada.phase.id === "P03")).toHaveLength(1);
    expect(await readFile(join(projectRoot, "coverage", "report.txt"), "utf8")).toBe("da suíte integrada\n");
    expect(await git(["log", "--format=%s", "-1", `capivara/${RUN()}/P03`])).toContain("feat(phase-3)");
  });

  it("M1: suíte vermelha com a árvore alterada no caminho: nada reprovado fica na árvore, e nada se perde", async () => {
    const escreve = { ...ESCRITAS, P03: [...ESCRITAS.P03!, { path: "coverage/report.txt", content: "da fase\n" }] };
    const { outcome, engine } = await construir(
      { escreve, demora: { P02: 20, P03: 150 } },
      {
        /*
         * Na integração da P03, a suíte reescreve um arquivo que a fase
         * versionou e deixa um que ninguém versionou — e reprova. O `reset
         * --keep` recusa por causa do primeiro.
         */
        testRunner: async (_comando, cwd) => {
          if (cwd !== projectRoot || !(await existe(join(cwd, "relatorio.txt")))) return VERDE;
          await escreverNaPrincipal("coverage/report.txt", "da suíte integrada\n");
          await escreverNaPrincipal("saida-da-suite.log", "FAIL relatorio.spec\n");
          return { exitCode: 1, output: "FAIL" };
        },
      },
    );

    expect(outcome.exitCode).toBe(2);
    expect((await git(["log", "--format=%s"])).split("\n").some((linha) => linha.includes("phase-3"))).toBe(false);
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder" && chamada.phase.id === "P03")).toHaveLength(1);

    /*
     * O risco do `--soft`: o código reprovado ficava na árvore como alteração
     * não commitada, e o preflight seguinte mandava `git add -A && git commit`
     * — promovendo-o a código aprovado. A árvore tem de voltar a ser a de antes
     * da integração: nada a commitar, nada da fase reprovada em disco.
     */
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
    for (const arquivo of ["relatorio.txt", "coverage/report.txt", "saida-da-suite.log"]) {
      expect(await existe(join(projectRoot, arquivo)), arquivo).toBe(false);
    }

    // E nada se perdeu: o que estava na árvore ficou num branch, e a fase no dela.
    const guardado = await git(["branch", "--list", "--format=%(refname:short)", `capivara/${RUN()}/P03-reprovada-*`]);
    expect(guardado).not.toBe("");
    expect(await git(["show", `${guardado}:coverage/report.txt`])).toBe("da suíte integrada");
    // O que ninguém versionou não entra em commit: vai para a recuperação local, fora do Git.
    expect(await arquivosDoBranch(guardado)).not.toContain("saida-da-suite.log");
    expect(await readFile(join(await recuperacaoDa("P03"), "saida-da-suite.log"), "utf8")).toBe("FAIL relatorio.spec\n");
    expect(await git(["show", `${guardado}:relatorio.txt`])).toBe("relatório");
    expect(outcome.errors.join("\n")).toContain("coverage/report.txt");
    expect(outcome.errors.join("\n")).toContain(guardado);
    expect(await git(["log", "--format=%s", "-1", `capivara/${RUN()}/P03`])).toContain("feat(phase-3)");

    // A retomada começa — o preflight não acha nada a commitar — e refaz a fase pelos gates.
    const retomada = await construir({ escreve: ESCRITAS }, { testRunner: async () => VERDE });
    expect(retomada.outcome.exitCode, retomada.anuncios.join("\n")).toBe(0);
    expect(retomada.engine.chamadas.some((chamada) => chamada.role === "builder" && chamada.phase.id === "P03")).toBe(true);
    expect((await git(["log", "--format=%s"])).split("\n").filter((linha) => linha.includes("phase-3"))).toHaveLength(1);
    expect(await git(["branch", "--list", "--format=%(refname:short)", `capivara/${RUN()}/P03-reprovada-*`])).toBe(guardado);
  });

  it("rollback: a regra do que pode ter segredo pelo nome é fechada, e deixa passar os exemplos", () => {
    // O .pem é julgado pelo conteúdo (§100): um certificado público passa.
    for (const caminho of [".env", ".env.local", "config/.env.production", "chave.key", "deploy/id_ed25519"]) {
      expect(arquivoSensivel(caminho), caminho).toBe(true);
    }
    for (const caminho of [".env.example", ".env.sample", "api/.env.template", "environment.ts", "id_ed25519.pub", "keys.json", "certs/ca.pem"]) {
      expect(arquivoSensivel(caminho), caminho).toBe(false);
    }
  });

  it("rollback: um .env que ninguém ignorou não vai para o branch de recuperação, e não se perde", async () => {
    const SEGREDO = "SEGREDO_DA_APP=valor-real-que-nao-pode-ir-para-o-git";
    const { outcome } = await construir(
      { escreve: COM_COVERAGE, demora: { P02: 20, P03: 150 } },
      { testRunner: suiteQueReprovaAP03(() => escreverNaPrincipal(".env", `${SEGREDO}\n`)) },
    );

    expect(outcome.exitCode).toBe(2);
    const guardado = await git(["branch", "--list", "--format=%(refname:short)", `capivara/${RUN()}/P03-reprovada-*`]);
    expect(guardado).not.toBe("");
    expect(await arquivosDoBranch(guardado)).not.toContain(".env");
    // Em nenhum objeto alcançável do repositório.
    expect(await git(["log", "--all", "-p", "--format=%H"])).not.toContain("valor-real-que-nao-pode-ir-para-o-git");
    // Guardado só localmente, fora do Git, com o conteúdo inteiro.
    expect(await readFile(join(await recuperacaoDa("P03"), ".env"), "utf8")).toBe(`${SEGREDO}\n`);
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
    expect(outcome.errors.join("\n")).toContain("recuperacao");
  });

  it("rollback: o arquivo não versionado que já estava na árvore fica onde estava, fora de qualquer commit", async () => {
    const { outcome } = await construir(
      { escreve: COM_COVERAGE, demora: { P02: 20, P03: 150 } },
      {
        testRunner: suiteQueReprovaAP03(undefined, async () => {
          if (!(await existe(join(projectRoot, "notas-locais.txt")))) await escreverNaPrincipal("notas-locais.txt", "anotação do usuário\n");
        }),
      },
    );

    expect(outcome.exitCode).toBe(2);
    expect(await readFile(join(projectRoot, "notas-locais.txt"), "utf8")).toBe("anotação do usuário\n");
    const guardado = await git(["branch", "--list", "--format=%(refname:short)", `capivara/${RUN()}/P03-reprovada-*`]);
    expect(await arquivosDoBranch(guardado)).not.toContain("notas-locais.txt");
    // Não foi criado pela integração: nem copiado, nem removido.
    const recuperacao = await recuperacaoDa("P03").catch(() => null);
    if (recuperacao) expect(await existe(join(recuperacao, "notas-locais.txt"))).toBe(false);
    expect((await git(["log", "--format=%s"])).split("\n").some((linha) => linha.includes("phase-3"))).toBe(false);
  });

  it("rollback: se a recuperação não pode ser gravada, nada é limpo — sem reset --hard", async () => {
    // A pasta de recuperação não pode ser criada: há um arquivo no caminho.
    await mkdir(runPaths(projectRoot, RUN()).root, { recursive: true });
    await writeFile(join(runPaths(projectRoot, RUN()).root, "recuperacao"), "no caminho\n", "utf8");

    const { outcome } = await construir(
      { escreve: COM_COVERAGE, demora: { P02: 20, P03: 150 } },
      { testRunner: suiteQueReprovaAP03(() => escreverNaPrincipal("saida-da-suite.log", "FAIL relatorio.spec\n")) },
    );

    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("não limpei a árvore");
    // Tudo continua onde estava: nada apagado, nada sobrescrito.
    expect(await readFile(join(projectRoot, "coverage", "report.txt"), "utf8")).toBe("da suíte integrada\n");
    expect(await readFile(join(projectRoot, "saida-da-suite.log"), "utf8")).toBe("FAIL relatorio.spec\n");
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(true);
    expect(await git(["branch", "--list", `capivara/${RUN()}/P03-reprovada-*`])).toBe("");
  });

  it("M2: depois de uma falha fatal na integração, a fase que ainda rodava não entra na árvore", async () => {
    const escreve = { ...ESCRITAS, P02: [...ESCRITAS.P02!, { path: "coverage/report.txt", content: "da fase\n" }] };
    const { outcome, anuncios } = await construir(
      { escreve, demora: { P02: 20, P03: 300 } },
      {
        // A integração da P02 fica fatal (M1); a da P03, sozinha, passaria.
        testRunner: async (_comando, cwd) => {
          if (cwd !== projectRoot) return VERDE;
          if ((await existe(join(cwd, "cadastro.txt"))) && !(await existe(join(cwd, "relatorio.txt")))) {
            await escreverNaPrincipal("coverage/report.txt", "da suíte integrada\n");
            return { exitCode: 1, output: "FAIL" };
          }
          return VERDE;
        },
      },
    );

    expect(outcome.exitCode).toBe(2);
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(false);
    expect((await git(["log", "--format=%s"])).split("\n").some((linha) => linha.includes("phase-3"))).toBe(false);
    expect(anuncios.some((linha) => linha.startsWith("[P03]") && linha.includes("não foi integrada"))).toBe(true);
    // O trabalho dela não se perdeu: está no branch.
    expect(await git(["log", "--format=%s", "-1", `capivara/${RUN()}/P03`])).toContain("feat(phase-3)");
  });

  it("M3: erro inesperado numa fase: o build só sai depois das outras, nada entra depois, e o parcial fica no branch", async () => {
    const engine = motor({ escreve: ESCRITAS, demora: { P02: 20, P03: 300 }, lanca: ["P02"] });
    const erro = await runBuild({
      projectRoot,
      language: "português do Brasil",
      engine: "codex",
      call: engine.call,
      sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache },
      skipAcceptance: true,
      explicitTestCommand: "npm test",
      testRunner: async () => VERDE,
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: [],
      },
    }).then(
      () => null,
      (motivo: unknown) => motivo,
    );

    // Nenhum agente ainda trabalhando quando o build devolve o erro.
    expect(engine.ativos()).toBe(0);
    expect(erro instanceof Error ? erro.message : String(erro)).toContain("o provider caiu");
    const historico = await git(["log", "--format=%s"]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await git(["log", "--format=%s"])).toBe(historico);
    expect(historico).not.toContain("phase-3");
    // O parcial da que caiu e o verde da que não pôde entrar ficam nos branches.
    expect(await git(["log", "--format=%s", "-1", `capivara/${RUN()}/P02`])).toContain("wip(P02)");
    expect(await git(["log", "--format=%s", "-1", `capivara/${RUN()}/P03`])).toContain("feat(phase-3)");
  });

  /*
   * §102 — o piloto paralelo real: o lockfile que o executor gerou no worktree
   * não tinha `"hasInstallScript": true`, o `npm install` da integração o
   * acrescentou na árvore principal, e a fase seguinte, verde, foi barrada como
   * se o desenvolvedor tivesse editado o lockfile. O npm falso abaixo faz o que
   * o npm 11 fez de verdade (reproduzido): `install` reescreve o lockfile,
   * `ci` nunca escreve nele.
   */
  const LOCK_DO_EXECUTOR = '{\n  "name": "lab",\n  "lockfileVersion": 3,\n  "packages": {\n    "node_modules/better-sqlite3": {\n      "version": "13.0.3"\n    }\n  }\n}\n';
  const COM_DEPENDENCIAS: Passo["escreve"] = {
    ...ESCRITAS,
    P01: [
      ...ESCRITAS.P01!,
      { path: "package.json", content: '{ "name": "lab", "dependencies": { "better-sqlite3": "13.0.3" } }\n' },
      { path: "package-lock.json", content: LOCK_DO_EXECUTOR },
    ],
  };
  const npmFalso = (comandos: { command: string; cwd: string }[], suite?: (cwd: string) => Promise<void>) =>
    async (command: string, cwd: string): Promise<{ exitCode: number; output: string }> => {
      comandos.push({ command, cwd });
      if (/^npm install\b/.test(command) && !command.includes("--no-package-lock")) {
        const lock = join(cwd, "package-lock.json");
        const atual = await readFile(lock, "utf8").catch(() => null);
        if (atual !== null) await writeFile(lock, atual.replace('"version": "13.0.3"', '"version": "13.0.3",\n      "hasInstallScript": true'), "utf8");
      }
      if (command === "npm test" && suite) await suite(cwd);
      return { exitCode: 0, output: "1 passed" };
    };

  /*
   * §106 — o `teste_haiku_v2`: o `init` não estava commitado, o worktree nasce do
   * HEAD, e executor e verificador trabalharam sem o esqueleto que o prompt
   * manda ler.
   */
  it("§106: a especificação não versionada chega ao worktree, só de leitura, e nunca entra num commit", async () => {
    await git(["rm", "-r", "-q", "--cached", ".capivara/init"]);
    await git(["commit", "-q", "-m", "chore: init fora do histórico"]);
    const base = await git(["rev-parse", "HEAD"]);
    await writeFile(join(projectRoot, ".capivara", "init", "skeleton.md"), "# esqueleto\n", "utf8");

    const vistos: { fase: string; existe: boolean; gravavel: boolean; escreveu: boolean }[] = [];
    const engine = motor({ escreve: ESCRITAS });
    const call = async (chamada: EngineCall): Promise<EngineResult> => {
      if (chamada.role === "builder") {
        const esqueleto = join(chamada.root ?? projectRoot, ".capivara", "init", "skeleton.md");
        const info = await stat(esqueleto).catch(() => null);
        const escreveu = await writeFile(esqueleto, "adulterado", "utf8").then(() => true, () => false);
        vistos.push({ fase: chamada.phase.id, existe: info !== null, gravavel: info !== null && (info.mode & 0o222) !== 0, escreveu });
      }
      return engine.call(chamada);
    };
    const { outcome, anuncios } = await construir({ escreve: ESCRITAS }, { call });

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(vistos.length).toBe(4);
    for (const visto of vistos) expect(visto, visto.fase).toEqual({ fase: visto.fase, existe: true, gravavel: false, escreveu: false });
    expect(anuncios.some((linha) => linha.includes("copiado:") && linha.includes(join(".capivara", "init")))).toBe(true);
    // Nenhum commit, de fase ou de integração, leva a especificação.
    expect(await git(["log", "--name-only", "--format=", `${base}..HEAD`])).not.toContain(".capivara/init");
    expect(await readFile(join(projectRoot, ".capivara", "init", "skeleton.md"), "utf8")).toBe("# esqueleto\n");
  });

  it("§108: a negação ao executor é registrada, e a fase segue para os gates no worktree dela", async () => {
    const engine = motor({ escreve: ESCRITAS });
    const call = async (chamada: EngineCall): Promise<EngineResult> => {
      const resposta = await engine.call(chamada);
      if (chamada.role === "builder" && chamada.phase.id === "P01") return { ...resposta, negacoes: ["Bash: npm"] };
      return resposta;
    };
    const { anuncios } = await construir({ escreve: ESCRITAS }, { call });

    expect(anuncios.some((linha) => linha.includes("negado(s) por permissão: Bash: npm — registrado"))).toBe(true);
    // Os gates julgaram a P01: o verificador foi chamado para ela.
    expect(engine.chamadas.some((chamada) => chamada.role === "verifier" && chamada.phase.id === "P01")).toBe(true);
    const eventos = await readEvents(runPaths(projectRoot, runIdFor("build", sha12(PLANO))).events);
    expect(eventos.some((evento) => evento.detail.includes("permissão negada"))).toBe(false);
  });

  it("§102: a instalação na árvore integrada não reescreve o lockfile, e a fase seguinte integra", async () => {
    const comandos: { command: string; cwd: string }[] = [];
    const { outcome, anuncios } = await construir({ escreve: COM_DEPENDENCIAS }, { testRunner: npmFalso(comandos) });

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect((await git(["log", "--format=%s"])).split("\n").filter((linha) => linha.startsWith("feat(phase-"))).toHaveLength(4);
    // A árvore principal sai igual ao HEAD, e o lockfile é o que a fase commitou.
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
    expect(await readFile(join(projectRoot, "package-lock.json"), "utf8")).toBe(LOCK_DO_EXECUTOR);
    const naPrincipal = comandos.filter((comando) => comando.cwd === projectRoot && comando.command.startsWith("npm ") && comando.command !== "npm test");
    expect(naPrincipal.map((comando) => comando.command)).toEqual(["npm ci --no-audit --no-fund"]);
  });

  it("§102: o que o próprio harness altera na árvore integrada é dito na hora, com o nome dele, e nada é descartado", async () => {
    const comandos: { command: string; cwd: string }[] = [];
    // A suíte que reescreve um arquivo versionado — só na árvore principal, durante a integração da P01.
    const suite = async (cwd: string): Promise<void> => {
      if (cwd === projectRoot && (await existe(join(cwd, "base.txt")))) await writeFile(join(cwd, "base.txt"), "reescrito pela suíte\n", "utf8");
    };
    const { outcome, engine, anuncios } = await construir({ escreve: ESCRITAS }, { testRunner: npmFalso(comandos, suite) });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("Quem alterou foi o próprio harness");
    expect(outcome.errors.join("\n")).toContain("base.txt");
    expect(anuncios.some((anuncio) => anuncio.includes("[P01] ATENÇÃO"))).toBe(true);
    // A P01 entrou; nada foi desfeito nem descartado; nenhuma fase saiu por cima.
    expect(await git(["log", "--format=%s", "-1"])).toBe("feat(phase-1): Fundação");
    expect(await readFile(join(projectRoot, "base.txt"), "utf8")).toBe("reescrito pela suíte\n");
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder").map((chamada) => chamada.phase.id)).toEqual(["P01"]);
  });
});
