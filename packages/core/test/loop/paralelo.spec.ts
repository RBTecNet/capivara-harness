/**
 * O build paralelo de ponta a ponta, com Git de verdade (§97).
 *
 * O provider é falso — escreve arquivos no worktree que recebeu e responde ao
 * verificador —, mas o resto é o que roda em produção: worktree, commit da fase,
 * cherry-pick na árvore principal, desfazer, refazer sozinha.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { readEvents, replayEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";

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
      return { exitCode: 0, stdout: reprova ? "TASK 1: INCOMPLETE — falta o arquivo" : "TASK 1: DONE", stderr: "", timedOut: null };
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
    return { exitCode: 0, stdout: "feito", stderr: "", timedOut: null };
  };
  return { call, chamadas, pico: () => pico };
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
