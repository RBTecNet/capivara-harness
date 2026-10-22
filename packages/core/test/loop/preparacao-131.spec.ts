/**
 * A preparação do ambiente e a integração paralela (§131), no cenário do
 * `build-dd15cc4a810d`: o plano sonda as ferramentas por `./node_modules/.bin/X`
 * e o driver por `require`; a sessão de preparação cria o `package.json`
 * mínimo e o lock na raiz; a P01 roda num worktree e mexe no mesmo manifesto.
 *
 * Lá, o manifesto não foi adotado — a adoção só reconhecia pacotes de `require`
 * —, ficou sujo na principal, e a P01 verde foi barrada na integração. E a
 * preparação instalou um Vitest cujo `engines` recusa o Node do harness: a
 * sonda `--version` passou, e o `npm ci --engine-strict` do próprio build
 * falhou depois.
 */

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha12, type EnvironmentRequirement } from "../../src/contract/index.js";
import { runIdFor } from "../../src/state/index.js";
import { runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import { adoptPreparedDependencies, conteudoDe, criadosPelaPreparacao } from "../../src/loop/prepared-dependencies.js";
import { packageBehindBinary, satisfiesNodeRange } from "../../src/loop/prerequisite-workspace.js";
import { checkPrerequisites } from "../../src/loop/prerequisites.js";
import { VALID_PHASES } from "../contract/fixture.js";
import { certifyCurrentPlan } from "../support/current-plan.js";

const run = promisify(execFile);
let root: string;
let cache: string;
const git = async (args: string[], cwd = root) => (await run("git", args, { cwd })).stdout.trim();

const MAJOR = Number(process.versions.node.split(".")[0]);
/** Como o `^22.12.0 || ^24.0.0 || >=26.0.0` do vitest@5.0.5 diante do Node 25: um intervalo que pula o Node de quem roda. */
const RECUSA_ESTE_NODE = `^${MAJOR - 2}.0.0 || >=${MAJOR + 1}.0.0`;
const ACEITA_ESTE_NODE = `>=${MAJOR}.0.0`;

const TS: EnvironmentRequirement = { technology: "TypeScript", binary: "./node_modules/.bin/tsc", systemLevel: false, checkArgs: ["--version"], installHint: "Instalar TypeScript 5 como dependência local do projeto." };
const VITEST: EnvironmentRequirement = { technology: "Vitest", binary: "./node_modules/.bin/vitest", systemLevel: false, checkArgs: ["--version"], installHint: "Instalar Vitest como dependência local do projeto." };
const DRIVER: EnvironmentRequirement = { technology: "SQLite", binary: "node", systemLevel: false, checkArgs: ["-e", "require('driver-sql')"], installHint: "Instalar driver-sql como dependência local do projeto." };
const SONDAS = [TS, VITEST, DRIVER];

/** Um pacote instalado como o npm deixa: a pasta, o manifesto e, havendo ferramenta, o link em `.bin`. */
async function pacote(nome: string, versao: string, opcoes: { engines?: string; bin?: string; em?: string } = {}): Promise<void> {
  const base = opcoes.em ?? root;
  const pasta = join(base, "node_modules", nome);
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, "package.json"), JSON.stringify({ name: nome, version: versao, ...(opcoes.engines ? { engines: { node: opcoes.engines } } : {}) }));
  await writeFile(join(pasta, "index.js"), "module.exports = 42;\n");
  if (!opcoes.bin) return;
  const alvo = join(pasta, "bin", opcoes.bin);
  await mkdir(dirname(alvo), { recursive: true });
  await writeFile(alvo, `#!${process.execPath}\nconsole.log(${JSON.stringify(`${nome} ${versao}`)});\n`);
  await chmod(alvo, 0o755);
  const link = join(base, "node_modules/.bin", opcoes.bin);
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { force: true });
  await symlink(relative(dirname(link), alvo), link);
}

const DECLARADAS = { dependencies: { "driver-sql": "^1.0.0" }, devDependencies: { typescript: "^5.9.3", vitest: "^5.0.5" } };

/** O que a sessão de preparação do run fez: manifesto mínimo, lock e a instalação. */
async function preparar(engines = ACEITA_ESTE_NODE): Promise<void> {
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "lab", version: "0.0.0", private: true, ...DECLARADAS }, null, 2));
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ name: "lab", lockfileVersion: 3, packages: { "": { name: "lab", ...DECLARADAS } } }, null, 2));
  await pacote("typescript", "5.9.3", { bin: "tsc" });
  await pacote("vitest", "5.0.5", { bin: "vitest", engines });
  await pacote("driver-sql", "1.0.0", { engines: ">=18" });
}

/** O que uma sessão de preparação registra ao terminar: cada caminho com o conteúdo que ela deixou. */
async function atestar(caminhos: string[]): Promise<Map<string, Set<string>>> {
  const atestados = new Map<string, Set<string>>();
  for (const caminho of caminhos) {
    const conteudo = await conteudoDe(join(root, caminho));
    if (conteudo) atestados.set(caminho, new Set([conteudo]));
  }
  return atestados;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-preparacao-131-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-preparacao-131-cache-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

async function repositorio(): Promise<void> {
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await git(["commit", "--allow-empty", "-qm", "base"]);
}

describe("o intervalo engines.node", () => {
  it.each([
    ["^22.12.0 || ^24.0.0 || >=26.0.0", "v25.9.0", false],
    ["^22.12.0 || ^24.0.0 || >=26.0.0", "v24.22.0", true],
    ["^20.0.0 || ^22.0.0 || >=24.0.0", "v25.9.0", true],
    ["^20.19.0 || >=22.12.0", "v25.9.0", true],
    [">=22", "v20.11.1", false],
    [">= 18", "v18.0.0", true],
    ["20.x || 22.x", "v21.1.0", false],
    ["~20.10", "v20.10.9", true],
    ["~20.10", "v20.11.0", false],
    ["^0.10.0", "v0.11.0", false],
    ["18 - 20", "v20.99.0", true],
    ["18 - 20", "v21.0.0", false],
    [">16 <20", "v19.9.9", true],
    // Um comparador falso derruba a alternativa mesmo ao lado de um ilegível.
    [">=26 <27.0.0-0", "v25.9.0", false],
    ["*", "v25.9.0", true],
  ])("%s com %s → %s", (intervalo, versao, esperado) => {
    expect(satisfiesNodeRange(intervalo, versao)).toBe(esperado);
  });

  it.each(["latest", ">=20.0.0-rc.1", "node >= 20"])("sem leitura segura (%s) não há veredito, e nada é recusado por ele", (intervalo) => {
    expect(satisfiesNodeRange(intervalo, "v25.9.0")).toBeNull();
  });
});

describe("o pacote por trás da sonda", () => {
  it("o link de .bin diz o pacote, inclusive com escopo, e o que não é link de .bin não diz nada", async () => {
    await pacote("typescript", "5.9.3", { bin: "tsc" });
    await pacote("@playwright/test", "1.64.1", { bin: "playwright" });
    expect(await packageBehindBinary(root, "./node_modules/.bin/tsc")).toMatchObject({ name: "typescript", version: "5.9.3" });
    expect(await packageBehindBinary(root, "./node_modules/.bin/playwright")).toMatchObject({ name: "@playwright/test" });
    expect(await packageBehindBinary(root, "./node_modules/.bin/ausente")).toBeNull();
    expect(await packageBehindBinary(root, "node")).toBeNull();
  });

  it("link de .bin que aponta para fora do node_modules não diz pacote nenhum", async () => {
    await mkdir(join(root, "ferramentas/bin"), { recursive: true });
    await writeFile(join(root, "ferramentas/package.json"), JSON.stringify({ name: "alheio", version: "1.0.0" }));
    await writeFile(join(root, "ferramentas/bin/x"), "#!/bin/sh\n");
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    await symlink(join(root, "ferramentas/bin/x"), join(root, "node_modules/.bin/x"));
    expect(await packageBehindBinary(root, "./node_modules/.bin/x")).toBeNull();
  });
});

describe("a adoção da preparação", () => {
  const CRIADOS = () => atestar(["package.json", "package-lock.json"]);

  it("adota o manifesto que a preparação criou para as ferramentas sondadas por .bin", async () => {
    await repositorio();
    await preparar();
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, await CRIADOS())).toBe(true);
    expect(await git(["ls-tree", "-r", "--name-only", "HEAD"])).toBe("package-lock.json\npackage.json");
    expect(await git(["log", "-1", "--format=%s"])).toBe("chore(capivara): prepara dependências do ambiente");
    expect(await git(["rev-parse", "HEAD~1"])).toBe(head);
    expect(await git(["status", "--porcelain"])).toBe("");
    expect(await readFile(join(root, "node_modules/vitest/package.json"), "utf8")).toContain("5.0.5");
  });

  it.each([
    { caso: "a sessão foi vista sem criar o manifesto", criados: new Map<string, Set<string>>() },
    { caso: "nenhum registro de preparação provou a origem", criados: null },
  ])("manifesto do desenvolvedor não é adotado quando $caso", async ({ criados }) => {
    await repositorio();
    await preparar();
    const head = await git(["rev-parse", "HEAD"]);
    const manifesto = await readFile(join(root, "package.json"), "utf8");
    expect(await adoptPreparedDependencies(root, SONDAS, criados)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(manifesto);
    expect(await git(["status", "--porcelain", "--", "package.json", "package-lock.json"])).toBe("?? package-lock.json\n?? package.json".trim());
  });

  it("a proveniência soma o que cada sessão deixou, e registro antigo sem ela não prova nada", async () => {
    const pasta = join(root, "preparation");
    await mkdir(pasta);
    expect(await criadosPelaPreparacao(pasta)).toBeNull();
    await writeFile(join(pasta, "antigo.json"), JSON.stringify({ status: "complete" }));
    expect(await criadosPelaPreparacao(pasta)).toBeNull();
    await writeFile(join(pasta, "a.json"), JSON.stringify({ pendentesAntes: [], criados: [{ caminho: "package.json", sha256: "a1" }] }));
    await writeFile(join(pasta, "b.json"), JSON.stringify({ pendentesAntes: ["package.json"], criados: [{ caminho: "package.json", sha256: "b2" }, { caminho: "package-lock.json", sha256: "c3" }] }));
    expect(await criadosPelaPreparacao(pasta)).toEqual(new Map([["package.json", new Set(["a1", "b2"])], ["package-lock.json", new Set(["c3"])]]));
  });

  it("o manifesto reescrito depois da sessão não é o que ela deixou: o registro de uma execução anterior não o adota", async () => {
    await repositorio();
    await preparar();
    const atestados = await CRIADOS();
    // Entre as execuções, o desenvolvedor reescreve o manifesto no mesmo caminho, só com o que as sondas comprovam.
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "meu-app", description: "escrito à mão", ...DECLARADAS }, null, 2));
    const head = await git(["rev-parse", "HEAD"]);
    expect(await adoptPreparedDependencies(root, SONDAS, atestados)).toBe(false);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toContain("escrito à mão");
  });
});

describe("prontidão e engines", () => {
  it("a sonda passa, mas o pacote recusa este Node: não está pronto, e a evidência diz o porquê", async () => {
    await preparar(RECUSA_ESTE_NODE);
    const [vitest, ts] = await checkPrerequisites([VITEST, TS], { cwd: root });
    expect(vitest).toMatchObject({ present: false, path: "./node_modules/.bin/vitest" });
    expect(vitest?.evidence).toContain("vitest 5.0.5");
    expect(vitest?.evidence).toContain(`vitest@5.0.5 declara engines.node "${RECUSA_ESTE_NODE}"`);
    expect(vitest?.evidence).toContain(process.version);
    expect(vitest?.evidence).toContain("--engine-strict");
    expect(ts?.present).toBe(true);
  });

  it("engines que aceita este Node, ou que não se sabe ler, não muda o veredito da sonda", async () => {
    await preparar(ACEITA_ESTE_NODE);
    expect((await checkPrerequisites([VITEST], { cwd: root }))[0]?.present).toBe(true);
    await pacote("vitest", "5.0.5", { bin: "vitest", engines: "latest" });
    expect((await checkPrerequisites([VITEST], { cwd: root }))[0]?.present).toBe(true);
  });

  it("o --engine-strict confere a árvore inteira: dependência do lockfile que recusa o Node reprova, a opcional não", async () => {
    await preparar(ACEITA_ESTE_NODE);
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    lock.packages["node_modules/vitest"] = { version: "5.0.5", engines: { node: ACEITA_ESTE_NODE } };
    lock.packages["node_modules/@vitest/runner"] = { version: "5.0.5", dev: true, engines: { node: RECUSA_ESTE_NODE } };
    lock.packages["node_modules/@rolldown/binding-android-arm64"] = { version: "1.2.15", optional: true, engines: { node: RECUSA_ESTE_NODE } };
    await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
    const [vitest] = await checkPrerequisites([VITEST], { cwd: root });
    expect(vitest?.present).toBe(false);
    expect(vitest?.evidence).toContain("@vitest/runner@5.0.5 declara engines.node");
    expect(vitest?.evidence).not.toContain("binding-android");
    delete lock.packages["node_modules/@vitest/runner"];
    await writeFile(join(root, "package-lock.json"), JSON.stringify(lock));
    expect((await checkPrerequisites([VITEST], { cwd: root }))[0]?.present).toBe(true);
  });

  it("vale também para o pacote de uma sonda por require", async () => {
    await preparar();
    await pacote("driver-sql", "1.0.0", { engines: RECUSA_ESTE_NODE });
    const [driver] = await checkPrerequisites([DRIVER], { cwd: root });
    expect(driver?.present).toBe(false);
    expect(driver?.evidence).toContain("driver-sql@1.0.0 declara engines.node");
  });
});

/* -------------------------------------------------------------- o build inteiro */

const FASE = (numero: number, titulo: string, depende: string): string => [
  `## Phase ${numero}: ${titulo}`, "",
  `**Goal:** ${titulo} funciona · **Depends on:** ${depende} · **Covers:** workflow ${numero}`, "",
  `- [ ] **Task:** Entregar ${titulo.toLowerCase()}`,
  "  - **Acceptance criteria:**",
  `    - O arquivo de ${titulo.toLowerCase()} existe`,
  `  - **Traces:** US-${numero}.1`, "",
].join("\n");
const PLANO = ["# Lab — Project Phases", "", "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", "", "## Overview", "", "Fundação e um módulo.", "",
  FASE(1, "Fundação", "none"), FASE(2, "Cadastro", "Phase 1"), "## Open Questions", "", "Nenhuma.", ""].join("\n");

async function projetoComPlano(sondas: EnvironmentRequirement[], plano = PLANO): Promise<void> {
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await writeFile(join(root, ".capivara/init/project-phases.md"), plano);
  await certifyCurrentPlan(root, sondas);
}

function motor(escritas: Record<string, (raiz: string) => Promise<void>>) {
  const chamadas: EngineCall[] = [];
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    if (chamada.role === "verifier") return { exitCode: 0, stdout: Array.from({ length: chamada.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null };
    await escritas[chamada.phase.id]?.(chamada.root ?? root);
    return { exitCode: 0, stdout: "feito", stderr: "", timedOut: null };
  };
  return { call, chamadas };
}

describe("o build com a preparação do cenário real", () => {
  it("a preparação vira commit antes dos worktrees, a P01 integra, e a principal não fica suja", async () => {
    await repositorio();
    await projetoComPlano(SONDAS);
    await git(["add", "-A"]);
    await git(["commit", "-qm", "docs: plano"]);
    const install = vi.fn(async () => { await preparar(); return { exitCode: 0, stdout: "instalado", stderr: "", timedOut: null, resultRead: true }; });
    const engine = motor({
      P01: async (raiz) => {
        // A fase entrega o manifesto da aplicação: sobre o da preparação, ou do zero, como a P01 do mmax num worktree sem ele.
        const manifesto = await readFile(join(raiz, "package.json"), "utf8").then((texto) => JSON.parse(texto), () => ({ name: "lab", private: true, ...DECLARADAS }));
        await writeFile(join(raiz, "package.json"), JSON.stringify({ ...manifesto, version: "1.0.0", scripts: { test: "vitest run" } }, null, 2));
        await mkdir(join(raiz, "src"), { recursive: true });
        await writeFile(join(raiz, "src/base.ts"), "export const base = 1;\n");
      },
      P02: async (raiz) => { await mkdir(join(raiz, "src"), { recursive: true }); await writeFile(join(raiz, "src/cadastro.ts"), "export const cadastro = 1;\n"); },
    });
    const anuncios: string[] = [];
    const outcome = await runBuild({
      projectRoot: root, language: "português do Brasil", engine: "codex", call: engine.call, sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache }, skipAcceptance: true, skipFlows: true, explicitTestCommand: "npm test",
      testRunner: async () => ({ exitCode: 0, output: "1 passed" }),
      installPrerequisites: install, systemInstall: true, announce: (mensagem) => anuncios.push(mensagem),
      parallel: { maxConcurrency: 2, agentes: [{ engine: "codex", label: "codex", systemInstall: false }, { engine: "codex", label: "codex", systemInstall: false }], resumo: [] },
    });
    expect(install).toHaveBeenCalledOnce();
    expect(anuncios.join("\n")).not.toContain("não são do integrador");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.phases.map((fase) => fase.outcome.status)).toEqual(["complete", "complete"]);
    const historico = (await git(["log", "--format=%s"])).split("\n");
    expect(historico).toContain("chore(capivara): prepara dependências do ambiente");
    // A preparação entrou antes do commit da fase: o worktree da P01 partiu dela.
    expect(historico.indexOf("chore(capivara): prepara dependências do ambiente")).toBeGreaterThan(historico.findIndex((assunto) => assunto.startsWith("feat(phase-1)")));
    expect(JSON.parse(await git(["show", "HEAD:package.json"]))).toMatchObject({ version: "1.0.0", scripts: { test: "vitest run" }, devDependencies: { vitest: "^5.0.5" } });
    expect(await git(["status", "--porcelain", "--", ".", ":(exclude).capivara"])).toBe("");
  });

  it("manifesto que o desenvolvedor deixou antes do build não é adotado nem tocado", async () => {
    await repositorio();
    await projetoComPlano([DRIVER]);
    await git(["add", "-A"]);
    await git(["commit", "-qm", "docs: plano"]);
    // Exatamente o que a adoção aceitaria pelo conteúdo: só o pacote sondado, instalado.
    const manifesto = JSON.stringify({ name: "meu", dependencies: { "driver-sql": "1.0.0" } });
    await writeFile(join(root, "package.json"), manifesto);
    await pacote("driver-sql", "1.0.0");
    await mkdir(join(root, ".git/info"), { recursive: true });
    await writeFile(join(root, ".git/info/exclude"), "node_modules/\n");
    const head = await git(["rev-parse", "HEAD"]);
    const engine = motor({});
    const outcome = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call: engine.call, skipAcceptance: true, skipFlows: true,
      environment: { XDG_CACHE_HOME: cache }, testRunner: async () => ({ exitCode: 0, output: "" }) });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errors.join("\n")).toContain("alterações não commitadas");
    expect(engine.chamadas).toHaveLength(0);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(manifesto);
    expect(await git(["status", "--porcelain", "--", "package.json"])).toBe("?? package.json");
  });

  it("o que já estava pendente antes da sessão de preparação fica fora do commit dela", async () => {
    await repositorio();
    await projetoComPlano([DRIVER]);
    await git(["add", "-A"]);
    await git(["commit", "-qm", "docs: plano"]);
    const manifesto = JSON.stringify({ name: "meu", dependencies: { "driver-sql": "^1.0.0" } });
    await writeFile(join(root, "package.json"), manifesto);
    const head = await git(["rev-parse", "HEAD"]);
    // A sessão instala e gera o lock ao lado do manifesto que já era do desenvolvedor.
    const install = vi.fn(async () => {
      await pacote("driver-sql", "1.0.0");
      await writeFile(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "driver-sql": "^1.0.0" } } } }));
      return { exitCode: 0, stdout: "instalado", stderr: "", timedOut: null, resultRead: true };
    });
    const outcome = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call: motor({}).call, skipAcceptance: true, skipFlows: true,
      environment: { XDG_CACHE_HOME: cache }, testRunner: async () => ({ exitCode: 0, output: "" }), installPrerequisites: install, systemInstall: true });
    expect(install).toHaveBeenCalledOnce();
    expect(outcome.exitCode).toBe(1);
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(manifesto);
    const registros = await Promise.all((outcome.preparation?.evidence ?? []).filter((path) => path.endsWith(".json")).map(async (path) => JSON.parse(await readFile(path, "utf8"))));
    expect(registros[0]).toMatchObject({ pendentesAntes: ["package.json"], criados: [{ caminho: "package-lock.json", sha256: await conteudoDe(join(root, "package-lock.json")) }] });
    // Nem o node_modules que a sessão instalou entra na lista, nem o manifesto que já era do desenvolvedor.
    expect(JSON.stringify(registros[0])).not.toContain("node_modules");
    expect(outcome.errors.join("\n")).toContain("nenhum deles prova");
  });

  it("preparação que a adoção recusa para o build antes da primeira fase, sem commitar nem apagar", async () => {
    await repositorio();
    await projetoComPlano(SONDAS);
    await git(["add", "-A"]);
    await git(["commit", "-qm", "docs: plano"]);
    const head = await git(["rev-parse", "HEAD"]);
    // A sessão declara um pacote que nenhuma sonda comprova: o manifesto deixa de ser o mínimo da preparação.
    const install = vi.fn(async () => {
      await preparar();
      const manifesto = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      await writeFile(join(root, "package.json"), JSON.stringify({ ...manifesto, devDependencies: { ...manifesto.devDependencies, "@types/node": "^24.0.0" } }, null, 2));
      return { exitCode: 0, stdout: "instalado", stderr: "", timedOut: null, resultRead: true };
    });
    const engine = motor({});
    const outcome = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call: engine.call, skipAcceptance: true, skipFlows: true,
      environment: { XDG_CACHE_HOME: cache }, testRunner: async () => ({ exitCode: 0, output: "" }), installPrerequisites: install, systemInstall: true });
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(outcome.errors.join("\n")).toContain("o Core não pôde adotar");
    expect(outcome.errors.join("\n")).toContain("package.json");
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
    expect(await readFile(join(root, "package.json"), "utf8")).toContain("@types/node");
  });

  it("sessão de preparação interrompida: a retomada não adota o que ela deixou, e diz por quê", async () => {
    await repositorio();
    await projetoComPlano(SONDAS);
    await git(["add", "-A"]);
    await git(["commit", "-qm", "docs: plano"]);
    await preparar();
    // O registro de uma sessão que caiu (Ctrl-C) antes de dizer o que criou.
    const runId = runIdFor("build", sha12(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")));
    const pasta = join(root, ".capivara/runs", runId, "preparation");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "environment-install-interrompida.json"), JSON.stringify({ status: "started", pendentesAntes: [] }));
    const head = await git(["rev-parse", "HEAD"]);
    const engine = motor({});
    const outcome = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call: engine.call, skipAcceptance: true, skipFlows: true,
      environment: { XDG_CACHE_HOME: cache }, testRunner: async () => ({ exitCode: 0, output: "" }) });
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(outcome.errors.join("\n")).toContain("alterações não commitadas");
    expect(outcome.errors.join("\n")).toContain("nenhum deles prova");
    expect(await git(["rev-parse", "HEAD"])).toBe(head);
  });

  it("a preparação que instala versão recusada pelo Node é refeita com a evidência, antes de qualquer fase", async () => {
    await projetoComPlano([VITEST], VALID_PHASES);
    const prompts: string[] = [];
    const install = vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      await preparar(prompts.length === 1 ? RECUSA_ESTE_NODE : ACEITA_ESTE_NODE);
      return { exitCode: 0, stdout: "instalado", stderr: "", timedOut: null, resultRead: true };
    });
    const engine = motor({});
    const outcome = await runBuild({ projectRoot: root, language: "pt-BR", engine: "opencode", call: engine.call, gitInit: false, maxCycles: 1,
      installPrerequisites: install, systemInstall: true, skipFlows: true, skipAcceptance: true, testRunner: async () => ({ exitCode: 0, output: "" }) });
    expect(install).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain(`vitest@5.0.5 declara engines.node "${RECUSA_ESTE_NODE}"`);
    expect(outcome.exitCode).toBe(0);
    expect(engine.chamadas.length).toBeGreaterThan(0);
  });

  it("se a preparação não acha versão aceita pelo Node, o build para antes da primeira fase", async () => {
    await projetoComPlano([VITEST], VALID_PHASES);
    const install = vi.fn(async () => { await preparar(RECUSA_ESTE_NODE); return { exitCode: 0, stdout: "instalado", stderr: "", timedOut: null, resultRead: true }; });
    const engine = motor({});
    const outcome = await runBuild({ projectRoot: root, language: "pt-BR", engine: "opencode", call: engine.call, gitInit: false,
      installPrerequisites: install, systemInstall: true, skipFlows: true, skipAcceptance: true, testRunner: async () => ({ exitCode: 0, output: "" }) });
    expect(outcome.exitCode).toBe(1);
    expect(engine.chamadas).toHaveLength(0);
    expect(install).toHaveBeenCalledTimes(2);
  });
});
