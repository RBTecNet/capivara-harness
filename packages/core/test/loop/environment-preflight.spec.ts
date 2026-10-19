import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { preflight } from "../../src/loop/preflight.js";
import { runBuild } from "../../src/loop/build.js";
import { sha12 } from "../../src/contract/stamps.js";
import { VALID_PHASES } from "../contract/fixture.js";
import * as installations from "../../src/loop/instalacao-node.js";
import { prepareBuildEnvironment } from "../../src/loop/environment-prepare.js";
import { defaultFlowRunner } from "../../src/loop/flows.js";
import { checkPrerequisites, resolvePrerequisites } from "../../src/loop/prerequisites.js";
import { certifyCurrentPlan } from "../support/current-plan.js";
import { ENVIRONMENT_CONTRACT, PLANNING_CONTRACT } from "../../src/contract/environment.js";
import { defaultTestRunner } from "../../src/loop/gates.js";
import { relatorioDoBuild } from "../../src/loop/parada.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-env-first-"));
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await writeFile(join(root, ".capivara/init/project-phases.md"), VALID_PHASES);
  await writeFile(join(root, ".capivara/init/skeleton.md"), "## Stack\n- Runtime: Node.js\n");
  await certifyCurrentPlan(root);
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

async function requirements(checkArgs: string[], skeletonSha12?: string) {
  const skeleton = await readFile(join(root, ".capivara/init/skeleton.md"), "utf8");
  await writeFile(join(root, ".capivara/init/environment.json"), JSON.stringify({
    contract: ENVIRONMENT_CONTRACT, planningContract: PLANNING_CONTRACT,
    planSha12: sha12(VALID_PHASES), skeletonSha12: skeletonSha12 ?? sha12(skeleton),
    requirements: [{ technology: "Runtime pronto", binary: process.execPath, systemLevel: false, checkArgs, installHint: "Corrigir runtime" }],
  }));
}

const packageProbe = "const D=require('node:module').createRequire(process.cwd()+'/');if(D('capivara-probe-driver')()!==42)process.exit(1)";
async function installProbeFixture() {
  await mkdir(join(root, "backend/node_modules/capivara-probe-driver"), { recursive: true });
  await writeFile(join(root, "backend/package.json"), JSON.stringify({ dependencies: { "capivara-probe-driver": "1.0.0" } }));
  await writeFile(join(root, "backend/node_modules/capivara-probe-driver/index.js"), "module.exports=()=>42");
}

it("pacote declarado no backend é comprovado lá sem modificar o plan", async () => {
  await installProbeFixture();
  await requirements(["-e", packageProbe]);
  const metadata = await readFile(join(root, ".capivara/init/environment.json"), "utf8");
  const checked = await preflight({ projectRoot: root, runId: "build-env", git: { repository: false, clean: true } });
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(checked.prerequisites[0]).toMatchObject({ present: true, cwd: join(root, "backend") });
  expect(await readFile(join(root, ".capivara/init/environment.json"), "utf8")).toBe(metadata);
  expect(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")).toBe(VALID_PHASES);
});

it("prontidão em um workspace não encobre outro dono com pacote ausente", async () => {
  await installProbeFixture();
  await mkdir(join(root, "worker"));
  await writeFile(join(root, "worker/package.json"), JSON.stringify({ dependencies: { "capivara-probe-driver": "1.0.0" } }));
  const [status] = await checkPrerequisites([{ technology: "driver", binary: "node", systemLevel: false, checkArgs: ["-e", packageProbe] }], { cwd: root });
  expect(status?.present).toBe(false);
  expect(status?.evidence).toContain(join(root, "backend"));
  expect(status?.evidence).toContain(join(root, "worker"));
});

it("sonda de builtin permanece na raiz e não é comprovada por dependência privada", async () => {
  await installProbeFixture();
  const [status] = await checkPrerequisites([{ technology: "Node", binary: "node", systemLevel: false,
    checkArgs: ["-e", "require('node:fs'); console.log(process.cwd())"] }], { cwd: root });
  expect(status).toMatchObject({ present: true, cwd: root });
});

it("diagnóstico distingue executável encontrado de prontidão recusada", async () => {
  const [status] = await checkPrerequisites([{ technology: "driver", binary: "node", systemLevel: false, checkArgs: ["-e", packageProbe] }], { cwd: root });
  const announce = vi.fn();
  await resolvePrerequisites([status!], { choose: async () => "verificar", announce,
    verify: async () => [status!], install: async () => undefined }, 1);
  expect(announce.mock.calls.flat().join("\n")).toContain("executável encontrado");
  expect(announce.mock.calls.flat().join("\n")).not.toContain("não está no PATH");
});

it("instala uma vez e comprova o pacote antes do primeiro builder", async () => {
  await requirements(["-e", packageProbe]);
  const install = vi.fn(installProbeFixture);
  const call = vi.fn(async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => ({
    exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null,
  }));
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false,
    installPrerequisites: install, systemInstall: true, skipFlows: true, skipAcceptance: true, maxCycles: 1 });
  expect(result.exitCode).toBe(0);
  expect(install).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(4);
  expect(result.preparation?.sessions).toBe(1);
  expect(result.warnings.some(item => item.code === "instala-sistema")).toBe(false);
});

it("exit 1 com resultado preservado não bloqueia instalação comprovada pelo Core", async () => {
  await requirements(["-e", packageProbe]);
  const install = vi.fn(async () => {
    await installProbeFixture();
    return { exitCode: 1, stdout: "instalado", stderr: "", timedOut: null, resultRead: true };
  });
  const call = vi.fn(async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => ({
    exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null,
  }));
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "opencode", call, gitInit: false,
    installPrerequisites: install, systemInstall: true, skipFlows: true, skipAcceptance: true, maxCycles: 1 });
  expect(result.exitCode).toBe(0);
  expect(install).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledTimes(4);
  const records = await Promise.all(result.preparation!.evidence.filter(path => path.endsWith(".json")).map(path => readFile(path, "utf8")));
  expect(records.join("\n")).toContain('"recovered"');
});

it("exit 1 com instalação ainda ausente continua bloqueado", async () => {
  await requirements(["-e", packageProbe]);
  const call = vi.fn();
  const install = vi.fn(async () => ({ exitCode: 1, stdout: "instalado", stderr: "", timedOut: null, resultRead: true }));
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "opencode", call, gitInit: false,
    installPrerequisites: install, systemInstall: true, skipFlows: true });
  expect(result.exitCode).toBe(1);
  expect(call).not.toHaveBeenCalled();
  expect(install).toHaveBeenCalledOnce();
});

it("cota recusada não é promovida a sucesso porque um pacote ficou em disco", async () => {
  await requirements(["-e", packageProbe]);
  const call = vi.fn();
  const install = vi.fn(async () => {
    await installProbeFixture();
    return { exitCode: 1, stdout: "", stderr: "cota recusada", timedOut: null, providerFailure: "quota" as const };
  });
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "opencode", call, gitInit: false,
    installPrerequisites: install, systemInstall: true, skipFlows: true });
  expect(result.exitCode).toBe(1);
  expect(call).not.toHaveBeenCalled();
  expect(install).toHaveBeenCalledOnce();
});

it("retomada preserva os registros da preparação ao arquivar logs da execução anterior", async () => {
  const call = vi.fn(async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => ({
    exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null,
  }));
  const options = { projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false,
    skipFlows: true, skipAcceptance: true, maxCycles: 1 };
  expect((await runBuild(options)).exitCode).toBe(0);
  await requirements(["-e", packageProbe]);
  const result = await runBuild({ ...options, installPrerequisites: installProbeFixture, systemInstall: true });
  expect(result.exitCode).toBe(0);
  expect(result.preparation?.sessions).toBe(1);
  for (const path of result.preparation!.evidence) expect(await readFile(path, "utf8")).not.toBe("");
});

it("instalação recusada registra sessão e evidência sem repetir a chamada", async () => {
  await requirements(["-e", packageProbe]);
  const call = vi.fn();
  const install = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "cota recusada", timedOut: null, providerFailure: "quota" as const }));
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false,
    installPrerequisites: install, systemInstall: true, skipFlows: true });
  expect(result.exitCode).toBe(1);
  expect(install).toHaveBeenCalledOnce();
  expect(call).not.toHaveBeenCalled();
  expect(result.preparation?.sessions).toBe(1);
  expect(result.errors.join("\n")).toContain("recusa do provider");
  const evidence = await Promise.all(result.preparation!.evidence.map(path => readFile(path, "utf8")));
  expect(evidence.join("\n")).toContain("cota recusada");
  const report = relatorioDoBuild(result);
  expect(report.tipo).toBe("parada");
  if (report.tipo === "parada") {
    expect(report.parada.natureza).toBe("ambiente");
    expect(report.parada.custou).toContain("1 sessão");
    expect(report.parada.custou).not.toContain("nenhuma sessão");
  }
  const later = relatorioDoBuild({ ...result, errors: ["outra configuração ainda precisa ser corrigida"] });
  if (later.tipo === "parada") expect(later.parada.custou).toContain("1 sessão");
});

it("binário presente com prontidão recusada impede construção", async () => {
  await requirements(["-e", "process.stderr.write('versão incompatível'); process.exit(3)"]);
  const checked = await preflight({ projectRoot: root, runId: "build-env", git: { repository: false, clean: true } });
  expect(checked.ok).toBe(false);
  if (checked.ok) return;
  expect(checked.missingPrerequisites).toContainEqual(expect.objectContaining({ technology: "Runtime pronto", present: false }));
  expect(checked.errors.join("\n")).toContain("Runtime pronto");
});

it("variáveis parciais do build preservam o PATH da máquina", async () => {
  const [status] = await checkPrerequisites([{ technology: "Node", binary: "node", systemLevel: false }], { environment: { CAPIVARA_ENV_TEST: "1" } });
  expect(status?.present).toBe(true);
});

it("declaração de outro esqueleto não vira aprovação silenciosa", async () => {
  await requirements(["--version"], "000000000000");
  const checked = await preflight({ projectRoot: root, runId: "build-env", git: { repository: false, clean: true } });
  expect(checked.ok).toBe(false);
});

it("sonda desconhecida no catálogo é executada uma vez antes de todas as fases", async () => {
  await requirements(["-e", "require('fs').appendFileSync('probe-count','ready\\n')"]);
  const observed: string[] = [];
  const call = vi.fn(async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => {
    observed.push(await readFile(join(root, "probe-count"), "utf8"));
    return { exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null };
  });
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false, skipAcceptance: true, maxCycles: 1 });
  expect(result.exitCode).toBe(0);
  expect(call).toHaveBeenCalledTimes(4);
  expect(observed).toEqual(["ready\n", "ready\n", "ready\n", "ready\n"]);
});

it.each([0, 1])("instalação inicial com exit %i acontece antes do primeiro builder", async exitCode => {
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { exemplo: "1" } }));
  const call = vi.fn(async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => {
    expect(await readFile(join(root, "preparado"), "utf8")).toBe("sim");
    return { exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null };
  });
  const probes = vi.spyOn(installations, "inspecionarInstalacaoNode");
  const runner = vi.fn(async (command: string) => {
    expect(call).not.toHaveBeenCalled();
    expect(command).toContain("npm install");
    if (exitCode === 0) { await mkdir(join(root, "node_modules")); await writeFile(join(root, "preparado"), "sim"); }
    return { exitCode, output: exitCode === 0 ? "pronto" : "rede indisponível" };
  });
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call, testRunner: runner, gitInit: false, skipAcceptance: true, maxCycles: 1 });
  expect(result.exitCode).toBe(exitCode);
  expect(runner).toHaveBeenCalledOnce();
  expect(call).toHaveBeenCalledTimes(exitCode === 0 ? 4 : 0);
  expect(probes.mock.calls.filter(([, options]) => options?.sondar !== false)).toHaveLength(1);
});

it("aprovação da identidade dispensa nova sonda nativa", async () => {
  await writeFile(join(root, "package.json"), '{"dependencies":{"native":"1"}}');
  await mkdir(join(root, "node_modules/native"), { recursive: true });
  await writeFile(join(root, "node_modules/native/addon.node"), "simulado");
  const probe = vi.fn(async () => "compiled against a different Node.js version");
  expect((await installations.inspecionarInstalacaoNode(root, { sondar: probe })).estado).toBe("incompativel");
  expect((await installations.inspecionarInstalacaoNode(root, { sondar: false })).estado).toBe("compativel");
  expect(probe).toHaveBeenCalledOnce();
});

it("ferramenta do navegador é preparada antes do produto sem alterar seu manifesto", async () => {
  const manifest = '{"name":"produto","private":true}';
  await writeFile(join(root, "package.json"), manifest);
  const runner = vi.fn(async (command: string) => {
    if (command.startsWith("npm install --prefix .capivara")) {
      await mkdir(join(root, ".capivara/node_modules/@playwright/test"), { recursive: true });
    }
    return { exitCode: 0, output: "pronto" };
  });
  const result = await prepareBuildEnvironment(root, runner, () => undefined, { browser: true });
  expect(result.ok).toBe(true);
  expect(await readFile(join(root, "package.json"), "utf8")).toBe(manifest);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(runner.mock.calls[1]![0]).toContain("chromium.launch");
});

it("navegador indisponível interrompe o preparo, sem declarar aprovação", async () => {
  await mkdir(join(root, "node_modules/@playwright/test"), { recursive: true });
  const runner = vi.fn(async () => ({ exitCode: 1, output: "Chromium indisponível" }));
  const result = await prepareBuildEnvironment(root, runner, () => undefined, { browser: true });
  expect(result.ok).toBe(false);
  expect(result.evidence).toContain("Chromium indisponível");
  expect(result.evidence).not.toContain("Ambiente aprovado");
  expect(runner).toHaveBeenCalledTimes(1);
});

it("carrega o Playwright privado com raiz relativa e caracteres especiais sem instalar nada", async () => {
  const relativeRoot = await mkdtemp(join(process.cwd(), "capivara env 'relativo-"));
  try {
    const packageRoot = join(relativeRoot, ".capivara/node_modules/@playwright/test");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "index.js"), "exports.chromium={launch:async()=>({close:async()=>{console.log('browser-stub-ready')}})};");
    const runner = vi.fn(defaultTestRunner);
    const result = await prepareBuildEnvironment(relative(process.cwd(), relativeRoot), runner, () => undefined, { browser: true, systemInstall: true });
    expect(result.ok, result.evidence).toBe(true);
    expect(result.evidence).toContain("browser-stub-ready");
    expect(runner).toHaveBeenCalledOnce();
  } finally {
    await rm(relativeRoot, { recursive: true, force: true });
  }
});

it("o CLI privado do G4 funciona com raiz relativa mesmo executando na pasta dos roteiros", async () => {
  const cli = join(root, ".capivara/node_modules/@playwright/test");
  await mkdir(cli, { recursive: true });
  await mkdir(join(root, ".capivara/flows"), { recursive: true });
  await writeFile(join(cli, "cli.js"), "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));");
  const result = await defaultFlowRunner(relative(process.cwd(), root), ["dashboard.spec.ts"]);
  expect(result.exitCode, result.output).toBe(0);
  expect(JSON.parse(result.output)).toEqual({ cwd: join(root, ".capivara/flows"), args: ["test", "--config", "playwright.config.mjs", "dashboard.spec.ts"] });
});

const missingBrowser = "browserType.launch: Executable doesn't exist at /cache/chromium/headless_shell";
const missingLibraries = "Host system is missing dependencies to run browsers.";

it("executável ausente baixa apenas Chromium e confere sua inicialização", async () => {
  await mkdir(join(root, ".capivara/node_modules/@playwright/test"), { recursive: true });
  const runner = vi.fn().mockResolvedValueOnce({ exitCode: 1, output: missingBrowser })
    .mockResolvedValueOnce({ exitCode: 0, output: "download pronto" })
    .mockResolvedValueOnce({ exitCode: 0, output: "abriu" });
  const result = await prepareBuildEnvironment(root, runner, () => undefined, { browser: true, systemInstall: true });
  expect(result.ok, result.evidence).toBe(true);
  expect(runner).toHaveBeenCalledTimes(3);
  expect(runner.mock.calls[1]![0]).toMatch(/ install chromium$/);
  expect(runner.mock.calls.map(call => call[0]).join("\n")).not.toContain("--with-deps");
});

it.each([true, false])("dependência do sistema ausente só é instalada com systemInstall=%s", async systemInstall => {
  await mkdir(join(root, ".capivara/node_modules/@playwright/test"), { recursive: true });
  const runner = vi.fn().mockResolvedValueOnce({ exitCode: 1, output: missingLibraries })
    .mockResolvedValueOnce({ exitCode: 0, output: "bibliotecas prontas" })
    .mockResolvedValueOnce({ exitCode: 0, output: "abriu" });
  const result = await prepareBuildEnvironment(root, runner, () => undefined, { browser: true, systemInstall });
  expect(result.ok, result.evidence).toBe(systemInstall);
  expect(runner).toHaveBeenCalledTimes(systemInstall ? 3 : 1);
  if (systemInstall) expect(runner.mock.calls[1]![0]).toMatch(/ install-deps chromium$/);
});

it("descobre bibliotecas ausentes após download sem repetir reparos", async () => {
  await mkdir(join(root, ".capivara/node_modules/@playwright/test"), { recursive: true });
  const runner = vi.fn().mockResolvedValueOnce({ exitCode: 1, output: missingBrowser })
    .mockResolvedValueOnce({ exitCode: 0, output: "download pronto" })
    .mockResolvedValueOnce({ exitCode: 1, output: "error while loading shared libraries: libX.so.1: cannot open shared object file" })
    .mockResolvedValueOnce({ exitCode: 0, output: "bibliotecas prontas" })
    .mockResolvedValueOnce({ exitCode: 1, output: missingLibraries });
  const result = await prepareBuildEnvironment(root, runner, () => undefined, { browser: true, systemInstall: true });
  expect(result.ok).toBe(false);
  expect(runner).toHaveBeenCalledTimes(5);
  expect(runner.mock.calls[1]![0]).toMatch(/ install chromium$/);
  expect(runner.mock.calls[3]![0]).toMatch(/ install-deps chromium$/);
  expect(result.evidence).not.toContain("Ambiente aprovado");
});

it("erro de módulo na sonda não dispara instalação do navegador nem de pacotes do sistema", async () => {
  await mkdir(join(root, ".capivara/node_modules/@playwright/test"), { recursive: true });
  const runner = vi.fn(async () => ({ exitCode: 1, output: "Error: Cannot find module '.capivara/node_modules/@playwright/test'" }));
  const result = await prepareBuildEnvironment(root, runner, () => undefined, { browser: true, systemInstall: true });
  expect(result.ok).toBe(false);
  expect(runner).toHaveBeenCalledOnce();
  expect(result.evidence).toContain("Cannot find module");
});

it("ausência do CLI é erro de ferramenta, inclusive no caminho privado do harness", async () => {
  await mkdir(join(root, ".capivara/flows"), { recursive: true });
  const result = await defaultFlowRunner(root, []);
  expect(result).toMatchObject({ exitCode: 1, toolMissing: true });
});
