/**
 * §125 G · entrega final proporcional (spec §10; §13.16).
 *
 * A aplicação só é concluída com todas as fases fechadas; a aceitação prova a
 * preparação e a subida numa cópia limpa sem repetir a suíte; o reparo da
 * aceitação é provado pela suíte uma vez, commitado pelo Core, e a entrega diz
 * como rodar e o que não foi provado — inclusive a preparação que o PLAN
 * declara e o projeto não oferece.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import { estadoDoBuild } from "../../src/loop/build.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { runPaths } from "../../src/state/index.js";
import { certifyCurrentPlan } from "../support/current-plan.js";

const run = promisify(execFile);
let root = "";

const FASE = (n: number, titulo: string, depende: string): string =>
  [`## Phase ${n}: ${titulo}`, "", `**Goal:** ${titulo} funciona · **Depends on:** ${depende} · **Covers:** workflow ${n}`, "",
    `- [ ] **Task:** Entregar ${titulo.toLowerCase()}`, "  - **Acceptance criteria:**", `    - O arquivo de ${titulo.toLowerCase()} existe`, `  - **Traces:** US-${n}.1`, ""].join("\n");

const PLANO = ["# Entrega — Project Phases", "", "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", "", "## Overview", "", "Duas fases.", "",
  FASE(1, "Fundação", "none"), FASE(2, "Cadastro", "Phase 1"), "## Open Questions", "", "Nenhuma.", ""].join("\n");

async function git(args: string[]): Promise<string> {
  return (await run("git", args, { cwd: root })).stdout.trim();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-vnext-entrega-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "t"]);
  await git(["config", "user.email", "t@t"]);
  await mkdir(join(root, ".capivara", "init"), { recursive: true });
  await writeFile(join(root, ".capivara", "init", "project-phases.md"), PLANO);
  await certifyCurrentPlan(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: "node -e 0", start: "node server.js" } }));
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "base"]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });

async function construir(extra: Partial<BuildOptions> & { reprova?: string[]; reparo?: (chamada: EngineCall) => Promise<void> } = {}) {
  const chamadas: EngineCall[] = [];
  const suites: string[] = [];
  const passos: string[] = [];
  const anuncios: string[] = [];
  const { reprova = [], reparo, ...opcoes } = extra;
  const outcome = await runBuild({
    projectRoot: root, language: "pt-BR", engine: "codex", sleep: async () => undefined,
    explicitTestCommand: "npm test", announce: (linha) => anuncios.push(linha),
    testRunner: async (command) => {
      suites.push(command);
      return { exitCode: 0, output: "1 passed" };
    },
    acceptanceRunner: async (command) => {
      passos.push(command);
      return { exitCode: 0, output: "ok" };
    },
    acceptanceService: async (command) => {
      passos.push(command);
      return { exitCode: 0, output: "de pé" };
    },
    call: async (chamada) => {
      chamadas.push(chamada);
      if (chamada.role === "verifier") return ok(reprova.includes(chamada.phase.id) ? "TASK 1: INCOMPLETE — falta o arquivo" : "TASK 1: DONE");
      if (chamada.prompt.includes("operational acceptance") || chamada.prompt.includes("aceitação")) {
        await reparo?.(chamada);
        return ok("corrigido");
      }
      await writeFile(join(root, `${chamada.phase.id.toLowerCase()}.txt`), `${chamada.phase.id}\n`);
      return ok("feito\nCAPIVARA_BUILDER_STATUS: COMPLETE");
    },
    ...opcoes,
  });
  return { outcome, chamadas, suites, passos, anuncios };
}

describe("§10 · concluída só com todas as fases fechadas", () => {
  // Só existe `aceito`: a fase que a escada não fecha falha, e nada se constrói por cima dela.
  it("a fase que não fecha para o build: falhou, com o defeito dito, sem construir a seguinte e sem aceitação", async () => {
    const { outcome, passos, anuncios, chamadas } = await construir({ reprova: ["P01"], maxCycles: 1, maxVerifierRepairs: 0 });
    expect(outcome.exitCode).toBe(2);
    expect(estadoDoBuild(outcome)).toBe("falhou");
    expect(outcome.errors.join("\n")).toContain("falta o arquivo");
    expect(chamadas.some((chamada) => chamada.phase.id === "P02")).toBe(false);
    expect(anuncios).not.toContain("aplicação aceita: todas as fases verdes e a aceitação limpa");
    expect(passos).toEqual([]);
  });
});

describe("§13.16 · a entrega prepara e sobe sem repetir a suíte", () => {
  it("a aceitação instala, migra e sobe; a suíte não roda de novo; a entrega diz como rodar", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: "node -e 0", migrate: "node migrar.js", start: "node server.js" } }));
    await writeFile(join(root, ".env.example"), "PORT=3000\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "migração"]);
    const { outcome, suites, passos } = await construir();
    expect(outcome.exitCode).toBe(0);
    expect(passos).toEqual(["npm install --no-audit --no-fund", "npm run migrate", "npm start"]);
    // Uma suíte por fase, nenhuma na entrega (a migração do preparo do G2 também passa pelo runner).
    expect(suites.filter((comando) => comando === "npm test")).toHaveLength(2);
    const entrega = await readFile(join(runPaths(root, outcome.runId).root, "entrega.md"), "utf8");
    expect(entrega).toContain("copie `.env.example` para `.env`");
    expect(entrega).toContain("prepare o banco: `npm run migrate`");
    expect(entrega).toContain("suba a aplicação: `npm start`");
  });

  it("o banco que o PLAN declara sem migração vira limitação dita, não preparação provada", async () => {
    const ambiente = JSON.parse(await readFile(join(root, ".capivara", "init", "environment.json"), "utf8")) as Record<string, unknown>;
    ambiente.infrastructure = { databases: [{ name: "PostgreSQL 16", purpose: "dados", basis: "pedido" }] };
    await writeFile(join(root, ".capivara", "init", "environment.json"), `${JSON.stringify(ambiente, null, 2)}\n`);
    const { outcome } = await construir();
    expect(outcome.exitCode).toBe(0);
    const entrega = await readFile(join(runPaths(root, outcome.runId).root, "entrega.md"), "utf8");
    expect(entrega).toContain("o PLAN declara PostgreSQL 16, e o projeto não tem uma migração que a aceitação tenha rodado: a preparação do banco só foi provada pela subida do serviço");
  });

  it("o reparo da aceitação é provado pela suíte uma vez, e o Core o commita", async () => {
    let tentativas = 0;
    const { outcome, suites, chamadas } = await construir({
      acceptanceService: async (command) => {
        tentativas += 1;
        const existe = await readFile(join(root, "server.js"), "utf8").then(() => true, () => false);
        return existe ? { exitCode: 0, output: "de pé" } : { exitCode: 1, output: `Error: Cannot find module 'server.js' (${command})` };
      },
      reparo: async () => writeFile(join(root, "server.js"), "require('http').createServer().listen(process.env.PORT)\n"),
    });
    expect(outcome.exitCode).toBe(0);
    expect(tentativas).toBe(2);
    expect(chamadas.filter((chamada) => chamada.role === "builder")).toHaveLength(3);
    // Duas suítes das fases e uma do reparo: só a prova que o reparo pode ter quebrado.
    expect(suites.filter((comando) => comando === "npm test")).toHaveLength(3);
    expect(await git(["log", "--format=%s", "-1"])).toBe("fix(entrega): preparação operacional (aceitação, tentativa 1)");
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
    const entrega = await readFile(join(runPaths(root, outcome.runId).root, "entrega.md"), "utf8");
    expect(entrega).toContain("o reparo da aceitação tocou server.js");
  });
});

describe("§9 · fase fechada só é anunciada preservada se o código dela está no histórico", () => {
  it("depois de um reset que tira o commit da fase, ela volta a ser verificada, sem nova implementação", async () => {
    const primeira = await construir({ skipAcceptance: true });
    expect(primeira.outcome.exitCode).toBe(0);
    // O commit da P02 sai do histórico; o ledger, no plano de controle, continua dizendo que ela fechou.
    await git(["reset", "-q", "--hard", "HEAD~1"]);
    const segunda = await construir({ skipAcceptance: true });
    expect(segunda.anuncios.some((linha) => linha.startsWith("[P02] fechada no run") && linha.includes("não está no histórico do HEAD"))).toBe(true);
    expect(segunda.anuncios.some((linha) => linha.startsWith("[P01]") && linha.includes("não vou refazer") || linha === "[P01] já concluída neste run")).toBe(true);
    // A P02 foi julgada de novo pelo verificador; a P01, não.
    expect(segunda.chamadas.filter((chamada) => chamada.role === "verifier").map((chamada) => chamada.phase.id)).toEqual(["P02"]);
    expect(segunda.chamadas.some((chamada) => chamada.prompt.includes("Implement the phase below COMPLETELY"))).toBe(false);
  });
});

describe("da revisão adversarial do G: o reparo da aceitação e o commit que falha", () => {
  const semServidor = async (command: string) => {
    const existe = await readFile(join(root, "server.js"), "utf8").then(() => true, () => false);
    return existe ? { exitCode: 0, output: "de pé" } : { exitCode: 1, output: `Error: Cannot find module 'server.js' (${command})` };
  };

  it("o reparo que quebrou a suíte não é absolvido pela tentativa seguinte que não muda nada", async () => {
    let suite = 0;
    let reparos = 0;
    const { outcome } = await construir({
      acceptanceService: semServidor,
      testRunner: async (command) => {
        if (command === "npm test") suite += 1;
        // As duas suítes das fases passam; depois do primeiro reparo, a suíte está quebrada.
        return command === "npm test" && suite > 2 ? { exitCode: 1, output: "FAIL app.spec.ts > sobe\n1 failed" } : { exitCode: 0, output: "1 passed" };
      },
      reparo: async () => {
        reparos += 1;
        if (reparos === 1) await writeFile(join(root, "server.js"), "quebra a suíte\n");
      },
    });
    expect(outcome).toMatchObject({ exitCode: 2, estado: "falhou" });
    expect(await git(["log", "--format=%s"])).not.toContain("fix(entrega)");
  });

  it("a suíte do reparo roda com o preparo do G2 (a migração antes), não crua na raiz", async () => {
    await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: "node -e 0", migrate: "node migrar.js", start: "node server.js" } }));
    // Com o .env.example, o ambiente do G2 é o descartável do harness — e é nele que a migração roda.
    await writeFile(join(root, ".env.example"), "PORT=3000\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "migração"]);
    const comandos: string[] = [];
    const { outcome } = await construir({
      acceptanceService: semServidor,
      testRunner: async (command) => {
        comandos.push(command);
        return { exitCode: 0, output: "1 passed" };
      },
      reparo: async () => writeFile(join(root, "server.js"), "require('http')\n"),
    });
    expect(outcome.exitCode).toBe(0);
    // Depois da última suíte das fases, o reparo: migração e suíte, nessa ordem.
    expect(comandos.slice(-2), JSON.stringify(comandos)).toEqual(["npm run migrate", "npm test"]);
  });

  it("sem comando de teste no preflight, o reparo resolve o comando na hora e roda a suíte", async () => {
    await rm(join(root, "package.json"));
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "sem manifesto"]);
    const suites: string[] = [];
    const chamadas: EngineCall[] = [];
    const outcome = await runBuild({
      projectRoot: root, language: "pt-BR", engine: "codex", sleep: async () => undefined, announce: () => undefined,
      testRunner: async (command) => {
        suites.push(command);
        return { exitCode: 0, output: "1 passed" };
      },
      acceptanceRunner: async () => ({ exitCode: 0, output: "ok" }),
      acceptanceService: semServidor,
      call: async (chamada) => {
        chamadas.push(chamada);
        if (chamada.role === "verifier") return ok("TASK 1: DONE");
        if (chamada.phase.id === "P01" && chamada.attempt === 1) {
          await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { test: "node -e 0", start: "node server.js" } }));
        }
        if (chamada.prompt.includes("does not run")) await writeFile(join(root, "server.js"), "require('http')\n");
        await writeFile(join(root, `${chamada.phase.id.toLowerCase()}.txt`), "x\n");
        return ok("feito\nCAPIVARA_BUILDER_STATUS: COMPLETE");
      },
    });
    expect(outcome.exitCode).toBe(0);
    const entrega = await readFile(join(runPaths(root, outcome.runId).root, "entrega.md"), "utf8");
    expect(entrega).toContain("provado pela suíte e pela aceitação");
    expect(suites.filter((comando) => comando === "npm test").length).toBeGreaterThanOrEqual(3);
  });

  it("sem Git, o reparo da aceitação é dito na entrega: os arquivos tocados não se determinam", async () => {
    await rm(join(root, ".git"), { recursive: true, force: true });
    const { outcome } = await construir({ gitInit: false, acceptanceService: semServidor, reparo: async () => writeFile(join(root, "server.js"), "require('http')\n") });
    expect(outcome.exitCode).toBe(0);
    const entrega = await readFile(join(runPaths(root, outcome.runId).root, "entrega.md"), "utf8");
    expect(entrega).toContain("arquivos que não puderam ser determinados (sem árvore do Git)");
  });

  it("a fase cujo commit o git recusou fica sem HEAD no registro, dita na entrega, e volta a ser verificada depois", async () => {
    await git(["config", "user.name", ""]);
    const primeira = await construir({ skipAcceptance: true });
    expect(primeira.outcome.exitCode).toBe(0);
    const ledger = JSON.parse(await readFile(join(root, ".capivara", "handoffs", "fases.json"), "utf8")) as { id: string; head?: string; semCommit?: boolean }[];
    expect(ledger.every((fase) => fase.semCommit === true && fase.head === undefined)).toBe(true);
    const entrega = await readFile(join(runPaths(root, primeira.outcome.runId).root, "entrega.md"), "utf8");
    expect(entrega).toContain("passou nos gates, mas o commit não foi criado");
    // O código é descartado (como a parada oferece); a fase não é dada como fechada.
    await git(["config", "user.name", "t"]);
    await git(["checkout", "--", "."]);
    await git(["clean", "-fd", "-e", ".capivara"]);
    const segunda = await construir({ skipAcceptance: true });
    expect(segunda.anuncios.some((linha) => linha.includes("fechou no run") && linha.includes("sem commit"))).toBe(true);
    expect(segunda.chamadas.some((chamada) => chamada.role === "verifier")).toBe(true);
  });
});

