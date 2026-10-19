/** G2 integrado real: artefato ignorado não viaja pelo Git e exige preparo durável. */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { executarEmParalelo } from "../../src/loop/paralelo.js";
import { runPhase, type EngineCall, type EngineResult } from "../../src/loop/runner.js";
import { splitPhases } from "../../src/loop/split.js";
import { defaultTestRunner } from "../../src/loop/gates.js";
import { VALID_PHASES } from "../contract/fixture.js";
import { runPaths, readEvents } from "../../src/state/index.js";
import { abrirValidacaoIntegrada, desfazerSemApagar } from "../../src/loop/worktree.js";

const run = promisify(execFile);
let root: string;
let cache: string;
const RUN = "build-integration-recovery";
const ok = (stdout = "feito"): EngineResult => ({ stdout, stderr: "", exitCode: 0, timedOut: null });

it("validação isolada preserva backup e .env de teste sem copiar nem modificar configuração real", async () => {
  await writeFile(join(root, ".env.example"), "CAPIVARA_DB_PATH=server/data/app.db\n");
  await run("git", ["add", ".env.example"], { cwd: root });
  await run("git", ["commit", "-qm", "configuração pública"], { cwd: root });
  await writeFile(join(root, ".env"), "TOKEN=valor-local-nunca-usar-na-validacao\n");
  const recovery = join(root, ".capivara/recovery/isolated-suite");
  const validation = await abrirValidacaoIntegrada(root, recovery);
  expect(await readFile(join(validation.dir, ".env"), "utf8")).not.toContain("valor-local");
  await writeFile(join(validation.dir, ".env.backup-teste-123"), "backup do teste");
  await writeFile(join(validation.dir, ".env"), "configuração de teste não restaurada");
  await validation.fechar();
  expect(await readFile(join(root, ".env"), "utf8")).toBe("TOKEN=valor-local-nunca-usar-na-validacao\n");
  await expect(readFile(join(root, ".env.backup-teste-123"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(recovery, ".env.backup-teste-123"), "utf8")).toBe("backup do teste");
  expect(await readFile(join(recovery, ".env"), "utf8")).toBe("configuração de teste não restaurada");
  expect((await run("git", ["log", "--all", "-p"], { cwd: root })).stdout).not.toContain("TOKEN=valor-local");
});

it("fonte alterada pela suíte é detectada e preservada sem alterar o commit principal", async () => {
  await writeFile(join(root, "source.ts"), "export const original = true;");
  await run("git", ["add", "source.ts"], { cwd: root });
  await run("git", ["commit", "-qm", "código original"], { cwd: root });
  const recovery = join(root, ".capivara/recovery/changed-source");
  const validation = await abrirValidacaoIntegrada(root, recovery);
  await writeFile(join(validation.dir, "source.ts"), "export const falsoVerde = true;");
  expect(await validation.fontesAlteradas()).toEqual(["source.ts"]);
  await run("git", ["add", "source.ts"], { cwd: validation.dir });
  await run("git", ["-c", "user.name=teste", "-c", "user.email=teste@localhost", "commit", "-qm", "alteração durante suíte"], { cwd: validation.dir });
  expect(await validation.fontesAlteradas()).toEqual(["HEAD da cópia de validação", "source.ts"]);
  await validation.fechar();
  expect(await readFile(join(root, "source.ts"), "utf8")).toBe("export const original = true;");
  expect(await readFile(join(recovery, "source.ts"), "utf8")).toBe("export const falsoVerde = true;");
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-integrated-repair-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-integrated-cache-"));
  for (const args of [["init", "-q"], ["config", "user.name", "teste"], ["config", "user.email", "teste@localhost"]]) await run("git", args, { cwd: root });
  await writeFile(join(root, ".gitignore"), "node_modules/\nweb/dist/\n.capivara/\n");
  await run("git", ["add", ".gitignore"], { cwd: root });
  await run("git", ["commit", "-qm", "base"], { cwd: root });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); });

async function scenario(mode: "executor" | "validator" | "cold" | "broken" | "timeout" | "quota" | "diagnosis-timeout" | "diagnosis-quota", repairs = 1) {
  const parsed = splitPhases(VALID_PHASES, root, RUN);
  if (!parsed.ok) throw new Error("fixture inválida");
  const phase = parsed.sessions[0]!;
  const calls: EngineCall[] = [];
  let builders = 0;
  let fixed = false;
  const call = async (c: EngineCall): Promise<EngineResult> => {
    calls.push(c);
    const cwd = c.root!;
    if (c.prompt.includes("CAPIVARA_TEST_REPAIR_GUIDANCE")) {
      if (mode === "diagnosis-timeout") return { ...ok(), timedOut: "wall" };
      if (mode === "diagnosis-quota") return { ...ok("cota recusada"), engineError: true, providerFailure: "quota" };
      return ok("CAUSE: artefato não versionado\nEVIDENCE: web/dist/index.html ausente no checkout\nFIX: declarar pretest: npm run build no package.json\nCHECK: npm test em checkout sem web/dist");
    }
    if (c.repair) {
      expect(c.prompt).toContain("FIX: declarar pretest");
      if (mode === "timeout") return { ...ok("parcial"), timedOut: "wall" };
      if (mode === "quota") return { ...ok("cota recusada"), engineError: true, providerFailure: "quota" };
      if (mode !== "broken") {
        const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
        manifest.scripts.pretest = "npm run build";
        await writeFile(join(cwd, "package.json"), JSON.stringify(manifest));
        fixed = true;
      }
      return ok("reparo aplicado; os gates devem conferir");
    }
    if (c.role === "verifier") return ok(Array.from({ length: phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"));
    builders += 1;
    if (builders === 1) {
      await writeFile(join(cwd, "package.json"), JSON.stringify({ private: true, scripts: { test: "node check.cjs", build: "node build.cjs" } }));
      await writeFile(join(cwd, "build.cjs"), "require('node:fs').mkdirSync('web/dist',{recursive:true});require('node:fs').writeFileSync('web/dist/index.html','<main>app</main>');\n");
      await writeFile(join(cwd, "check.cjs"), "require('node:assert/strict').ok(require('node:fs').existsSync('web/dist/index.html'),'MISSING_WEB_DIST: web/dist/index.html');\n");
    } else {
      expect(c.prompt).toContain("MISSING_WEB_DIST");
      expect(c.prompt).toContain("FIX: declarar pretest");
      if (mode === "executor") {
        const manifest = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
        manifest.scripts.pretest = "npm run build";
        await writeFile(join(cwd, "package.json"), JSON.stringify(manifest));
        fixed = true;
      }
    }
    // A tentativa ruim apenas aquece o dist local, reproduzindo o incidente.
    if (builders === 1 || mode !== "cold") {
      await mkdir(join(cwd, "web/dist"), { recursive: true });
      await writeFile(join(cwd, "web/dist/index.html"), "<main>app</main>");
    }
    return ok("CAPIVARA_BUILDER_STATUS: COMPLETE");
  };
  const runner = async (command: string, cwd: string) => command.startsWith("npm install") || command.startsWith("npm ci") ? { exitCode: 0, output: "sem dependências" } : defaultTestRunner(command, cwd);
  const result = await executarEmParalelo({
    projectRoot: root, runId: RUN, sessions: [phase], agentes: [{ engine: "custom", label: "fixture", systemInstall: false }], maxConcurrency: 1, keepGoing: false,
    maxVerifierRepairs: repairs,
    jaFechada: () => false, aposIntegrar: async () => {}, esquecer: async () => {},
    isolamento: async () => ({ ok: true, impedimentos: [], motivos: [], limitacoes: [] }),
    comandoDeTeste: async () => "npm test", testRunner: runner, instalar: runner, systemInstall: false, portaBase: 48000,
    semEntrypoint: async () => true, comFluxos: () => true,
    environment: { XDG_CACHE_HOME: cache }, announce: () => {}, now: () => new Date(),
    rodar: (session, execution) => runPhase({ projectRoot: root, runId: RUN, language: "pt-BR", engine: "custom", session, testCommand: { command: "npm test", source: "fixture", containerized: false }, call, workRoot: execution.workRoot, worker: execution.worker, conferirPrincipal: execution.conferirPrincipal, ...(execution.integrationFailure ? { integrationFailure: execution.integrationFailure } : {}), integracaoPendente: true, commitsEnabled: true, maxCycles: 3, maxVerifierRepairs: repairs, testRunner: runner }),
  });
  return { result, calls, fixed, builders };
}

it.each(["executor", "validator", "cold"] as const)("fundação exclusiva recupera G2 integrado com %s, sem perder diagnóstico", async mode => {
  const { result, calls, builders } = await scenario(mode);
  expect(result.parada).toBeNull();
  expect(builders).toBe(2);
  expect(calls.filter(c => c.repair)).toHaveLength(mode === "executor" ? 0 : 1);
  const diagnosis = calls.find(c => c.prompt.includes("CAPIVARA_TEST_REPAIR_GUIDANCE"));
  expect(diagnosis?.prompt).toContain("MISSING_WEB_DIST");
  expect(diagnosis?.repair).not.toBe(true);
  const repairIndex = calls.findIndex(c => c.repair);
  if (repairIndex >= 0) expect(calls.slice(repairIndex + 1).some(c => c.role === "verifier" && !c.repair)).toBe(true);
  expect((await defaultTestRunner("npm test", root)).exitCode).toBe(0);
  const events = await readEvents(runPaths(root, RUN).events);
  expect(events.some(e => e.status === "complete")).toBe(true);
  expect(await readFile(join(runPaths(root, RUN).logs, "P01.cycle-1.log"), "utf8")).toContain("COMPLETE");
  expect(await readFile(join(runPaths(root, RUN).logs, "P01.g2-integracao-1.log"), "utf8")).toContain("MISSING_WEB_DIST");
  expect(await readFile(join(runPaths(root, RUN).logs, `P01.integration-${mode === "validator" ? 2 : 1}.g2-integracao-1.log`), "utf8")).toContain("exit: 0");
});

it.each(["diagnosis-timeout", "diagnosis-quota"] as const)("%s não inicia outra geração após falha técnica do diagnóstico", async mode => {
  const { result, calls, builders } = await scenario(mode);
  expect(result.parada).not.toBeNull();
  expect(builders).toBe(1);
  expect(calls.filter(c => c.repair)).toHaveLength(0);
});

it.each(["broken", "timeout", "quota"] as const)("%s no reparo fica limitado, preserva parcial e não aprova a fase", async mode => {
  const { result, calls } = await scenario(mode);
  expect(result.parada).not.toBeNull();
  expect(calls.filter(c => c.repair)).toHaveLength(1);
  expect(calls.filter(c => c.role === "builder")).toHaveLength(2);
  expect((await run("git", ["log", "--format=%s"], { cwd: root })).stdout.trim()).toBe("base");
});

it("reparo desligado devolve ao executor sem conceder escrita ao validador", async () => {
  const { result, calls } = await scenario("broken", 0);
  expect(result.parada).not.toBeNull();
  expect(calls.filter(c => c.repair)).toHaveLength(0);
  expect(calls.filter(c => c.role === "builder")).toHaveLength(2);
  expect(result.parada?.outcome.status === "failed" && result.parada.outcome.cause).toContain("MISSING_WEB_DIST");
});

it("rollback preserva o banco ignorado pela fase antes de ele parecer escrita externa", async () => {
  const before = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  await writeFile(join(root, ".gitignore"), "node_modules/\n.capivara/\nserver/data/*.db\n");
  await writeFile(join(root, ".env.example"), "CAPIVARA_DB_PATH=server/data/app.db\n");
  await run("git", ["add", ".gitignore", ".env.example"], { cwd: root });
  await run("git", ["commit", "-qm", "fase integrada"], { cwd: root });
  await mkdir(join(root, "server/data"), { recursive: true });
  await writeFile(join(root, "server/data/app.db"), "banco criado pela migração do harness");
  const recovery = join(root, ".capivara/recovery/test");
  const result = await desfazerSemApagar(root, before, { naoVersionadosAntes: [], guardarEm: "recovery", mensagem: "preservar", pastaDeRecuperacao: recovery });
  expect(result.limpo).toBe(true);
  expect(await readFile(join(recovery, "server/data/app.db"), "utf8")).toBe("banco criado pela migração do harness");
  await expect(readFile(join(root, "server/data/app.db"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await run("git", ["status", "--porcelain", "--", ":(exclude).capivara"], { cwd: root })).stdout.trim()).toBe("");
});

it("rollback não remove banco preexistente nem arquivo de código alheio", async () => {
  await mkdir(join(root, "server/data"), { recursive: true });
  await writeFile(join(root, "server/data/app.db"), "dados anteriores");
  const before = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  await writeFile(join(root, ".gitignore"), "node_modules/\n.capivara/\nserver/data/*.db\n");
  await writeFile(join(root, ".env.example"), "CAPIVARA_DB_PATH=server/data/app.db\n");
  await run("git", ["add", ".gitignore", ".env.example"], { cwd: root });
  await run("git", ["commit", "-qm", "fase integrada"], { cwd: root });
  await writeFile(join(root, "externo.ts"), "alteração externa");
  await desfazerSemApagar(root, before, { naoVersionadosAntes: ["server/data/app.db"], guardarEm: "recovery", mensagem: "preservar", pastaDeRecuperacao: join(root, ".capivara/recovery/test") });
  expect(await readFile(join(root, "server/data/app.db"), "utf8")).toBe("dados anteriores");
  expect(await readFile(join(root, "externo.ts"), "utf8")).toBe("alteração externa");
});

it.each([false, true])("migração e suíte integrada usam banco privado e retomam após falha=%s sem falso bloqueio", async failFirst => {
  const parsed = splitPhases(VALID_PHASES, root, RUN);
  if (!parsed.ok) throw new Error("fixture inválida");
  const phase = parsed.sessions[0]!;
  const seen: string[] = [];
  let failed = false;
  let deliveries = 0;
  const runner = async (command: string, cwd: string, env?: NodeJS.ProcessEnv) => {
    if (command.startsWith("npm install")) return { exitCode: 0, output: "instalação simulada" };
    seen.push(env?.CAPIVARA_DB_PATH ?? "SEM_BANCO_PRIVADO");
    if (command === "npm test" && failFirst && !failed) {
      failed = true;
      await mkdir(join(cwd, "server/data"), { recursive: true });
      await writeFile(join(cwd, "server/data/app.db"), "saída ignorada da suíte reprovada");
      await writeFile(join(cwd, ".env.backup-teste-42"), "backup criado pelo teste");
      await writeFile(join(cwd, ".env"), "configuração temporária deixada por teste sem finally\n");
      return { exitCode: 1, output: "defeito do teste, encaminhar correção e preservar seu banco" };
    }
    return defaultTestRunner(command, cwd, env);
  };
  const result = await executarEmParalelo({
    projectRoot: root, runId: RUN, sessions: [phase], agentes: [{ engine: "custom", label: "fixture", systemInstall: false }], maxConcurrency: 1, keepGoing: false,
    jaFechada: () => false, aposIntegrar: async () => {}, esquecer: async () => {},
    isolamento: async () => ({ ok: true, impedimentos: [], motivos: [], limitacoes: [] }),
    comandoDeTeste: async () => "npm test", testRunner: runner, instalar: runner, systemInstall: false, portaBase: 48000,
    environment: { XDG_CACHE_HOME: cache }, announce: () => {}, now: () => new Date(),
    rodar: async (_session, execution) => {
      expect(await execution.conferirPrincipal()).toEqual([]);
      deliveries += 1;
      const cwd = execution.workRoot;
      await writeFile(join(cwd, ".env.example"), "CAPIVARA_DB_PATH=server/data/app.db\n");
      await writeFile(join(cwd, ".gitignore"), "node_modules/\n.capivara/\n.env\nserver/data/*.db\n");
      await writeFile(join(cwd, "package.json"), JSON.stringify({ private: true, scripts: { migrate: "node migrate.cjs", test: "node check.cjs" } }));
      await writeFile(join(cwd, "migrate.cjs"), "const fs=require('fs'),p=require('path');const db=process.env.CAPIVARA_DB_PATH||'server/data/app.db';fs.mkdirSync(p.dirname(db),{recursive:true});fs.writeFileSync(db,'esquema');");
      await writeFile(join(cwd, "check.cjs"), "const fs=require('fs'),a=require('assert/strict');a.equal(fs.existsSync('server/data/app.db'),false,'BANCO_PADRAO_CONTAMINADO');a.equal(fs.readFileSync(process.env.CAPIVARA_DB_PATH,'utf8'),'esquema');");
      await writeFile(join(cwd, "tentativa.txt"), String(deliveries));
      await run("git", ["add", "-A"], { cwd });
      await run("git", ["commit", "-qm", "feat: fase aprovada"], { cwd });
      return { status: "complete", committed: true, message: "aprovada", cycles: 1 };
    },
  });
  expect(result.parada, JSON.stringify(result.parada)).toBeNull();
  expect(deliveries).toBe(failFirst ? 2 : 1);
  expect(seen).toHaveLength(failFirst ? 4 : 2);
  expect(seen[0]).toBe(seen[1]);
  if (failFirst) { expect(seen[2]).toBe(seen[3]); expect(seen[0]).not.toBe(seen[2]); }
  expect(seen[0]).not.toBe("SEM_BANCO_PRIVADO");
  await expect(readFile(join(root, ".env.backup-teste-42"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(seen[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(root, "server/data/app.db"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("gates da fase compartilham um banco temporário e preservam o banco local anterior", async () => {
  const parsed = splitPhases(VALID_PHASES, root, RUN);
  if (!parsed.ok) throw new Error("fixture inválida");
  const session = parsed.sessions[0]!;
  await mkdir(join(root, "server/data"), { recursive: true });
  await writeFile(join(root, "server/data/app.db"), "dados anteriores, não alterar");
  const seen: string[] = [];
  const runner = async (command: string, cwd: string, env?: NodeJS.ProcessEnv) => {
    seen.push(env?.CAPIVARA_DB_PATH ?? "SEM_BANCO_PRIVADO");
    return defaultTestRunner(command, cwd, env);
  };
  const result = await runPhase({ projectRoot: root, runId: RUN, session, language: "pt-BR", engine: "custom", maxCycles: 1, commitsEnabled: false,
    testCommand: { command: "node check.cjs", source: "fixture", containerized: false }, testRunner: runner,
    call: async call => {
      if (call.role === "verifier") return ok(Array.from({ length: session.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"));
      await writeFile(join(root, ".env.example"), "CAPIVARA_DB_PATH=server/data/app.db\n");
      await writeFile(join(root, "package.json"), JSON.stringify({ private: true, scripts: { migrate: "node migrate.cjs" } }));
      await writeFile(join(root, "migrate.cjs"), "const fs=require('fs'),p=require('path');const db=process.env.CAPIVARA_DB_PATH||'server/data/app.db';fs.mkdirSync(p.dirname(db),{recursive:true});fs.writeFileSync(db,'esquema temporário');");
      await writeFile(join(root, "check.cjs"), "const fs=require('fs'),a=require('assert/strict');a.equal(fs.readFileSync('server/data/app.db','utf8'),'dados anteriores, não alterar');a.equal(fs.readFileSync(process.env.CAPIVARA_DB_PATH,'utf8'),'esquema temporário');");
      return ok("CAPIVARA_BUILDER_STATUS: COMPLETE");
    },
  });
  expect(result.status, JSON.stringify(result)).toBe("complete");
  expect(await readFile(join(root, "server/data/app.db"), "utf8")).toBe("dados anteriores, não alterar");
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(seen[1]);
  await expect(readFile(seen[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});
