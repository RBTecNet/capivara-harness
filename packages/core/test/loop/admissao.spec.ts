import { certifyCurrentPlan } from "../support/current-plan.js";
/**
 * A política de admissão dos commits automáticos (§100).
 *
 * Nenhum commit que a Capivara faz sozinha — fase, parcial, recuperação,
 * commit inicial, especificação, integração por cherry-pick — pode levar para o
 * histórico um arquivo sensível conhecido. E nenhum bloqueio pode custar
 * trabalho: o arquivo não é apagado, o conteúdo não é impresso, e o estado fica
 * para correção ou retomada.
 *
 * Tudo com Git de verdade: o que se confere é o conteúdo dos commits e dos
 * branches, não mensagens.
 */

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MARCA_DO_HARNESS, commitPhase, iniciarRepositorio, runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { runIdFor, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";

const run = promisify(execFile);

const SEGREDO = "SENHA_DO_BANCO=valor-real-que-nunca-pode-ir-para-o-historico";
const CHAVE_PRIVADA = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7segredo",
  "-----END PRIVATE KEY-----",
  "",
].join("\n");
const CERTIFICADO_PUBLICO = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBaMQswCQYDVQQGEwJJ",
  "-----END CERTIFICATE-----",
  "",
].join("\n");

let projectRoot: string;
let cache: string;

async function git(args: string[], cwd = projectRoot): Promise<string> {
  return (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
}

async function existe(caminho: string): Promise<boolean> {
  return stat(caminho).then(() => true, () => false);
}

async function escrever(caminho: string, conteudo: string, raiz = projectRoot): Promise<void> {
  await mkdir(join(raiz, caminho, ".."), { recursive: true });
  await writeFile(join(raiz, caminho), conteudo, "utf8");
}

/** Todo arquivo que algum commit alcançável de qualquer ref já teve. */
async function arquivosNoHistorico(): Promise<string[]> {
  return (await git(["log", "--all", "--format=", "--name-only"])).split("\n").filter(Boolean);
}

/** O conteúdo de todos os objetos alcançáveis: um segredo não pode estar em nenhum. */
async function historicoInteiro(): Promise<string> {
  return git(["log", "--all", "-p", "--format=%H %s"]);
}

async function repositorio(): Promise<void> {
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-admissao-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-admissao-cache-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

describe("commit da fase: a política de admissão", () => {
  beforeEach(async () => {
    await repositorio();
    await escrever("README.md", "inicial\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "inicial"]);
  });

  it(".env não ignorado: o commit não acontece, o arquivo fica, e o conteúdo não aparece", async () => {
    await escrever("src/app.ts", "export const app = 1;\n");
    await escrever(".env", `${SEGREDO}\n`);

    const resultado = await commitPhase(projectRoot, 1, "Fundação");

    expect(resultado.committed).toBe(false);
    expect(resultado.bloqueios?.map((bloqueio) => bloqueio.caminho)).toEqual([".env"]);
    expect(JSON.stringify(resultado)).not.toContain("valor-real");
    expect(await git(["log", "--format=%s", "-1"])).toBe("inicial");
    expect(await arquivosNoHistorico()).not.toContain(".env");
    // Nada apagado, nada desfeito: o trabalho e o arquivo continuam como estavam.
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toBe(`${SEGREDO}\n`);
    expect(await readFile(join(projectRoot, "src", "app.ts"), "utf8")).toBe("export const app = 1;\n");
    expect(await git(["diff", "--cached", "--name-only"])).toBe("");
  });

  it(".env já rastreado e modificado: a alteração não entra, e nada sai do repositório", async () => {
    await escrever(".env", "SENHA_DO_BANCO=antiga\n");
    await git(["add", "-f", ".env"]);
    await git(["commit", "-q", "-m", "o projeto já versionava o .env"]);
    await escrever(".env", `${SEGREDO}\n`);
    await escrever("src/app.ts", "export const app = 2;\n");

    const resultado = await commitPhase(projectRoot, 2, "Cadastro");

    expect(resultado.committed).toBe(false);
    expect(resultado.bloqueios?.[0]?.caminho).toBe(".env");
    expect(await historicoInteiro()).not.toContain("valor-real");
    // Continua rastreado — nada de `git rm` automático — e com a alteração em disco.
    expect(await git(["ls-files", ".env"])).toBe(".env");
    expect(await git(["status", "--porcelain", "--", ".env"])).toBe("M .env");
    expect(resultado.message).toContain("git rm --cached");
  });

  it("chave privada em .pem e em .key: bloqueadas, sem imprimir o conteúdo", async () => {
    await escrever("certs/servidor.pem", CHAVE_PRIVADA);
    await escrever("certs/cliente.key", "qualquer coisa\n");
    await escrever("src/app.ts", "export const app = 3;\n");

    const resultado = await commitPhase(projectRoot, 3, "TLS");

    expect(resultado.committed).toBe(false);
    expect(resultado.bloqueios?.map((bloqueio) => bloqueio.caminho).sort()).toEqual(["certs/cliente.key", "certs/servidor.pem"]);
    expect(JSON.stringify(resultado)).not.toContain("MIIEvQ");
    expect(await arquivosNoHistorico()).not.toContain("certs/servidor.pem");
  });

  it("chave privada num arquivo de nome comum também é bloqueada pelo conteúdo", async () => {
    await escrever("config/integracao.txt", `token do parceiro\n${CHAVE_PRIVADA}`);
    const resultado = await commitPhase(projectRoot, 4, "Parceiro");
    expect(resultado.committed).toBe(false);
    expect(resultado.bloqueios?.[0]?.caminho).toBe("config/integracao.txt");
  });

  it("legítimos passam: .env.example, certificado público e código comum", async () => {
    await escrever(".env.example", "SENHA_DO_BANCO=troque-me\n");
    await escrever("certs/ca.pem", CERTIFICADO_PUBLICO);
    await escrever("certs/ca.crt", CERTIFICADO_PUBLICO);
    await escrever("src/app.ts", "export const app = 5;\n");

    const resultado = await commitPhase(projectRoot, 5, "Configuração");

    expect(resultado.committed, resultado.message).toBe(true);
    expect(resultado.bloqueios ?? []).toEqual([]);
    const noCommit = (await git(["show", "--name-only", "--format=", "HEAD"])).split("\n").sort();
    expect(noCommit).toEqual([".env.example", "certs/ca.crt", "certs/ca.pem", "src/app.ts"]);
  });

  it("um .pem sem bloco reconhecível é tratado como suspeito", async () => {
    await escrever("certs/estranho.pem", "conteúdo que não é PEM nenhum\n");
    const resultado = await commitPhase(projectRoot, 6, "Suspeito");
    expect(resultado.committed).toBe(false);
    expect(resultado.bloqueios?.[0]?.caminho).toBe("certs/estranho.pem");
  });
});

describe("commit inicial do repositório criado pelo build", () => {
  it("a árvore com .env: o repositório nasce, mas o commit inicial não leva o segredo", async () => {
    await escrever("app.js", "console.log(1);\n");
    await escrever(".env", `${SEGREDO}\n`);

    const criado = await iniciarRepositorio(projectRoot, { comTrabalhoExistente: true });

    expect(criado.criado).toBe(true);
    expect(criado.commitInicial).toBe(false);
    expect(criado.motivo).toContain(".env");
    expect(await git(["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "")).toBe("");
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toBe(`${SEGREDO}\n`);
  });
});

// ——— O build de verdade, serial e paralelo ———

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

const PLANO = [
  "# Admissão — Project Phases",
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
  "## Open Questions",
  "",
  "Nenhuma.",
  "",
].join("\n");

const RUN = (): string => runIdFor("build", sha12(PLANO));

interface Escrita {
  path: string;
  content: string;
}

function motor(escreve: Record<string, Escrita[]>, opcoes: { reprova?: string[]; commitaSozinho?: string[]; demora?: Record<string, number> } = {}) {
  const chamadas: EngineCall[] = [];
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    if (chamada.role === "verifier") {
      const reprova = opcoes.reprova?.includes(chamada.phase.id) === true;
      return { exitCode: 0, stdout: reprova ? "TASK 1: INCOMPLETE — falta" : "TASK 1: DONE", stderr: "", timedOut: null };
    }
    await new Promise((resolve) => setTimeout(resolve, opcoes.demora?.[chamada.phase.id] ?? 20));
    const raiz = chamada.root ?? projectRoot;
    for (const arquivo of escreve[chamada.phase.id] ?? []) await escrever(arquivo.path, arquivo.content, raiz);
    // O agente que commita por conta própria, por fora do commit da Capivara.
    if (opcoes.commitaSozinho?.includes(chamada.phase.id) === true) {
      await git(["add", "-A", "--", ".", ":(exclude).capivara"], raiz);
      await git(["commit", "-q", "-m", "commit feito pelo agente"], raiz);
    }
    return { exitCode: 0, stdout: "feito", stderr: "", timedOut: null };
  };
  return { call, chamadas };
}

const ESCRITAS: Record<string, Escrita[]> = {
  P01: [{ path: "base.txt", content: "fundação\n" }],
  P02: [{ path: "cadastro.txt", content: "cadastro\n" }],
  P03: [{ path: "relatorio.txt", content: "relatório\n" }],
};

async function prepararProjeto(): Promise<void> {
  await repositorio();
  await escrever(".capivara/init/project-phases.md", PLANO);
  await certifyCurrentPlan(projectRoot);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "docs: plano"]);
}

function opcoes(engine: ReturnType<typeof motor>, anuncios: string[], extra: Partial<BuildOptions> = {}): BuildOptions {
  return {
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache },
    skipAcceptance: true,
    explicitTestCommand: "npm test",
    testRunner: async () => ({ exitCode: 0, output: "ok" }),
    announce: (mensagem) => anuncios.push(mensagem),
    ...extra,
  };
}

const PARALELO: Partial<BuildOptions> = {
  parallel: {
    maxConcurrency: 2,
    agentes: [
      { engine: "codex", label: "codex", systemInstall: false },
      { engine: "codex", label: "codex", systemInstall: false },
    ],
    resumo: [],
  },
};

describe("build serial", () => {
  beforeEach(prepararProjeto);
  const EXTRA: Partial<BuildOptions> = {};

  it("o .env que o harness semeia do .env.example não bloqueia, não suja a árvore e não entra no histórico", async () => {
    await escrever(".env.example", "APP_NOME=exemplo\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "exemplo de ambiente"]);
    const anuncios: string[] = [];
    const outcome = await runBuild(opcoes(motor(ESCRITAS, { demora: { P02: 20, P03: 60 } }), anuncios, EXTRA));

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect((await git(["log", "--format=%s"])).split("\n").filter((linha) => linha.startsWith("feat(phase-"))).toHaveLength(3);
    expect(await arquivosNoHistorico()).not.toContain(".env");
    expect(await arquivosNoHistorico()).toContain(".env.example");
    expect((await readFile(join(projectRoot, ".env"), "utf8")).startsWith(MARCA_DO_HARNESS)).toBe(true);
  });

  it(".env não ignorado: a fase não é commitada, o build para, e nada se perde", async () => {
    const escreve = { ...ESCRITAS, P02: [...ESCRITAS.P02!, { path: ".env", content: `${SEGREDO}\n` }] };
    const anuncios: string[] = [];
    const engine = motor(escreve);
    const outcome = await runBuild(opcoes(engine, anuncios));

    expect(outcome.exitCode).toBe(2);
    expect(await arquivosNoHistorico()).not.toContain(".env");
    expect(await historicoInteiro()).not.toContain("valor-real");
    expect((await git(["log", "--format=%s"])).split("\n").some((linha) => linha.startsWith("feat(phase-2)"))).toBe(false);
    // A P03 não rodou sobre uma P02 sem commit.
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P03")).toBe(false);
    // O trabalho e o arquivo continuam na árvore; o segredo não aparece em lugar nenhum.
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toBe(`${SEGREDO}\n`);
    expect(await readFile(join(projectRoot, "cadastro.txt"), "utf8")).toBe("cadastro\n");
    expect([...anuncios, ...outcome.errors].join("\n")).not.toContain("valor-real");
    expect(outcome.errors.join("\n")).toContain(".env");
  });

  it("retomada: o preflight avisa do arquivo sensível; ignorado o .env, o build segue pelos gates", async () => {
    const escreve = { ...ESCRITAS, P02: [...ESCRITAS.P02!, { path: ".env", content: `${SEGREDO}\n` }] };
    await runBuild(opcoes(motor(escreve), []));

    // Sem corrigir: o preflight diz qual arquivo é sensível antes de sugerir commit.
    const recusado = await runBuild(opcoes(motor(ESCRITAS), []));
    expect(recusado.exitCode).toBe(1);
    expect(recusado.errors.join("\n")).toContain(".env");
    expect(recusado.errors.join("\n")).toContain(".gitignore");

    // A orientação seguida: ignorar, commitar o parcial, rodar de novo.
    await escrever(".gitignore", ".env\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "wip: trabalho parcial"]);
    const anuncios: string[] = [];
    const retomado = await runBuild(opcoes(motor(ESCRITAS), anuncios));

    expect(retomado.exitCode, anuncios.join("\n")).toBe(0);
    expect(await arquivosNoHistorico()).not.toContain(".env");
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toBe(`${SEGREDO}\n`);
  });
});

describe("build paralelo", () => {
  beforeEach(prepararProjeto);
  const EXTRA = PARALELO;

  it("o .env que o harness semeia do .env.example não bloqueia, não suja a árvore e não entra no histórico", async () => {
    await escrever(".env.example", "APP_NOME=exemplo\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "exemplo de ambiente"]);
    const anuncios: string[] = [];
    const outcome = await runBuild(opcoes(motor(ESCRITAS, { demora: { P02: 20, P03: 60 } }), anuncios, EXTRA));

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect((await git(["log", "--format=%s"])).split("\n").filter((linha) => linha.startsWith("feat(phase-"))).toHaveLength(3);
    expect(await arquivosNoHistorico()).not.toContain(".env");
    expect(await arquivosNoHistorico()).toContain(".env.example");
    // A suíte integrada configura a cópia, preservando a árvore principal.
    expect(await existe(join(projectRoot, ".env"))).toBe(false);
  });

  it(".env não ignorado num worktree: nem o branch da fase nem a principal recebem o arquivo, e ele não se perde", async () => {
    const escreve = { ...ESCRITAS, P02: [...ESCRITAS.P02!, { path: ".env", content: `${SEGREDO}\n` }] };
    const anuncios: string[] = [];
    const outcome = await runBuild(opcoes(motor(escreve, { demora: { P02: 20, P03: 120 } }), anuncios, PARALELO));

    expect(outcome.exitCode).toBe(2);
    expect(await arquivosNoHistorico()).not.toContain(".env");
    expect(await historicoInteiro()).not.toContain("valor-real");
    // O trabalho da fase ficou no branch dela, sem o .env…
    const branch = `capivara/${RUN()}/P02`;
    expect((await git(["ls-tree", "-r", "--name-only", branch])).split("\n")).toContain("cadastro.txt");
    // …e o .env, fora do Git, na recuperação local do run.
    const pasta = join(runPaths(projectRoot, RUN()).root, "recuperacao");
    const [unica] = (await readdir(pasta)).filter((nome) => nome.startsWith("P02-"));
    expect(await readFile(join(pasta, unica!, ".env"), "utf8")).toBe(`${SEGREDO}\n`);
    // A fase independente seguiu e entrou no produto.
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(true);
    expect([...anuncios, ...outcome.errors].join("\n")).not.toContain("valor-real");
  });

  it("arquivo sensível no trabalho parcial de uma fase que falhou: o parcial vai para o branch, o segredo não", async () => {
    const escreve = { ...ESCRITAS, P02: [...ESCRITAS.P02!, { path: "certs/cliente.key", content: "chave\n" }] };
    const outcome = await runBuild(opcoes(motor(escreve, { reprova: ["P02"], demora: { P02: 20, P03: 120 } }), [], PARALELO));

    expect(outcome.exitCode).toBe(2);
    const branch = `capivara/${RUN()}/P02`;
    expect(await git(["log", "--format=%s", "-1", branch])).toContain("wip(P02)");
    const noBranch = (await git(["ls-tree", "-r", "--name-only", branch])).split("\n");
    expect(noBranch).toContain("cadastro.txt");
    expect(noBranch).not.toContain("certs/cliente.key");
    const pasta = join(runPaths(projectRoot, RUN()).root, "recuperacao");
    const [unica] = (await readdir(pasta)).filter((nome) => nome.startsWith("P02-"));
    expect(await readFile(join(pasta, unica!, "certs", "cliente.key"), "utf8")).toBe("chave\n");
  });

  it("o commit do agente com .env é desfeito, e a admissão do commit da fase barra o .env: nada entra na principal", async () => {
    const escreve = { ...ESCRITAS, P02: [...ESCRITAS.P02!, { path: ".env", content: `${SEGREDO}\n` }] };
    const anuncios: string[] = [];
    const outcome = await runBuild(
      opcoes(motor(escreve, { commitaSozinho: ["P02"], demora: { P02: 20, P03: 120 } }), anuncios, PARALELO),
    );

    expect(outcome.exitCode).toBe(2);
    // A principal não recebeu nada da P02.
    expect(await git(["ls-tree", "-r", "--name-only", "main"])).not.toContain(".env");
    expect(await existe(join(projectRoot, "cadastro.txt"))).toBe(false);
    expect(await existe(join(projectRoot, ".env"))).toBe(false);
    // O commit do agente saiu do branch (o Core o desfez); o parcial da fase ficou nele, sem o .env…
    const branch = `capivara/${RUN()}/P02`;
    expect(await git(["log", "--format=%s", branch])).not.toContain("commit feito pelo agente");
    expect((await git(["ls-tree", "-r", "--name-only", branch])).split("\n")).not.toContain(".env");
    expect(await historicoInteiro()).not.toContain("valor-real");
    // …e o .env, fora do Git, na recuperação local do run.
    const pasta = join(runPaths(projectRoot, RUN()).root, "recuperacao");
    const [unica] = (await readdir(pasta)).filter((nome) => nome.startsWith("P02-"));
    expect(await readFile(join(pasta, unica!, ".env"), "utf8")).toBe(`${SEGREDO}\n`);
    expect([...anuncios, ...outcome.errors].join("\n")).not.toContain("valor-real");
  });
});
