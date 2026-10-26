import { certifyCurrentPlan } from "../support/current-plan.js";
/** O build real, da flag padrão ao adapter, aos gates e ao snapshot final. */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assemblePhasesDocument, sha12 } from "../../src/contract/index.js";
import { readRunState, runIdFor, runPaths } from "../../src/state/index.js";

const PLAN = assemblePhasesDocument({
  projectName: "Reparo independente",
  stamp: "<!-- inputs: project-description.md@sha256:aaaaaaaaaaaa -->",
  overview: "Uma entrega cuja falha é corrigida pelo validador.",
  phases: [`## Phase 1: Conteúdo correto

**Goal:** Entregar o conteúdo solicitado · **Depends on:** none · **Covers:** app

- [ ] **Task:** Gravar o conteúdo de app.txt
  - **Acceptance criteria:**
    - O arquivo app.txt contém exatamente correto
  - **Traces:** US-1.1, app`],
  openQuestions: [],
});

interface AdapterCall {
  role: string;
  repair: string;
  permission: string;
  systemInstall: string | null;
  model: string;
  node: string;
}

interface CallMetadata {
  role: string;
  repair: boolean;
  model: string;
  provider: string;
  node: string;
  abi: string;
}

const jsonLines = <T>(text: string): T[] => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);

describe("reparo do validador pelo CLI real", () => {
  let directory: string;
  let cli: string;
  let adapter: string;
  let scenario: string;
  let projectRoot: string;
  let adapterLog: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "capivara-repair-cli-"));
    cli = join(directory, "cli.mjs");
    adapter = join(directory, "adapter.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("../../src/cli.ts", import.meta.url))],
      outfile: cli, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
      define: { __CAPIVARA_VERSION__: JSON.stringify("verifier-repair-test") },
    });
    await writeFile(adapter, `#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
for await (const chunk of process.stdin) {}
const role = process.env.CAPIVARA_ROLE;
const repair = process.env.CAPIVARA_REPAIR;
await appendFile(process.env.FIXTURE_ADAPTER_LOG, JSON.stringify({
  role, repair, permission: process.env.CAPIVARA_PERMISSION,
  systemInstall: process.env.CAPIVARA_SYSTEM_INSTALL ?? null,
  model: process.env.CAPIVARA_MODEL, node: process.execPath,
}) + "\\n");
const app = join(process.env.CAPIVARA_PROJECT_ROOT, "app.txt");
if (role === "builder") {
  await writeFile(app, "errado");
  console.log("CAPIVARA_BUILDER_STATUS: COMPLETE");
} else if (role === "verifier" && repair === "1") {
  await writeFile(app, "correto");
  console.log("Corrigido app.txt; o harness deve repetir os testes e a verificação independente.");
} else if (role === "verifier") {
  const content = await readFile(app, "utf8");
  console.log(content === "correto" ? "TASK 1: DONE" : "TASK 1: INCOMPLETE — app.txt está errado; gravar correto; executar npm test");
} else {
  throw new Error("papel inesperado: " + role);
}
`, "utf8");
    await chmod(adapter, 0o755);
  }, 120_000);

  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  beforeEach(async () => {
    scenario = await mkdtemp(join(directory, "scenario-"));
    projectRoot = join(scenario, "project");
    adapterLog = join(scenario, "adapter-calls.jsonl");
    await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara", "init", "project-phases.md"), PLAN);
    await certifyCurrentPlan(projectRoot);
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ private: true, scripts: { test: "node check.cjs" } }));
    await writeFile(join(projectRoot, "check.cjs"), `const assert = require("node:assert/strict");
const fs = require("node:fs");
assert.equal(process.execPath, process.env.FIXTURE_EXPECTED_NODE, "G2 deve usar o Node do harness");
function app_conteudo() { assert.equal(fs.readFileSync("app.txt", "utf8"), "correto"); }
app_conteudo();
`);
  });

  afterEach(async () => { await rm(scenario, { recursive: true, force: true }); });

  async function execute(extra: string[] = []) {
    // Configuração local vazia e MCP desligado: nenhum serviço ou conta externa participa.
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("CAPIVARA_") || key.startsWith("DOC_CENTER_")) delete environment[key];
    }
    environment.CAPIVARA_CONFIG_DIR = join(scenario, "global-config");
    environment.FIXTURE_ADAPTER_LOG = adapterLog;
    environment.FIXTURE_EXPECTED_NODE = process.execPath;
    const args = [cli, "build", "--provider", "custom", "--adapter", adapter, "--model", "fixture",
      "--project", projectRoot, "--no-git", "--no-system-install", "--no-acceptance", "--no-flows",
      "--no-splash", "--no-modal", "--serial", "--max-cycles", "1", ...extra];
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile(process.execPath, args, { cwd: projectRoot, env: environment, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(new Error(`CLI não terminou: ${error.message}\n${stdout}\n${stderr}`));
          return;
        }
        resolve({ code: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
      });
      child.stdin?.end();
    });
  }

  it("orçamento padrão repara G2 sem outro builder e reavalia somente leitura", async () => {
    const result = await execute();
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(await readFile(join(projectRoot, "app.txt"), "utf8")).toBe("correto");
    const calls = jsonLines<AdapterCall>(await readFile(adapterLog, "utf8"));
    expect(calls.map(({ role, repair, permission }) => ({ role, repair, permission }))).toEqual([
      { role: "builder", repair: "0", permission: "workspace-write" },
      { role: "verifier", repair: "1", permission: "workspace-write" },
      { role: "verifier", repair: "0", permission: "read-only" },
    ]);
    expect(calls.every((call) => call.model === "fixture" && call.systemInstall === null)).toBe(true);
    const runId = runIdFor("build", sha12(PLAN));
    const metadata = jsonLines<CallMetadata>(await readFile(join(runPaths(projectRoot, runId).logs, "calls.jsonl"), "utf8"));
    // Inclui a primeira sessão serial, antes de haver qualquer log de resposta no disco.
    expect(metadata.map(({ role, repair, provider, model }) => ({ role, repair, provider, model }))).toEqual([
      { role: "builder", repair: false, provider: "custom", model: "fixture" },
      { role: "verifier", repair: true, provider: "custom", model: "fixture" },
      { role: "verifier", repair: false, provider: "custom", model: "fixture" },
    ]);
    expect(metadata.every((call) => call.node === process.version && call.abi === process.versions.modules)).toBe(true);
    expect(await readRunState(projectRoot, runId)).toMatchObject({ status: "complete", stage: "complete" });
    // §125: o orçamento que valeu fica fotografado no run, e o adapter custom não retoma sessão.
    expect((await readRunState(projectRoot, runId))?.budgets).toEqual({
      cycles: 1, repairsPerCycle: 6, repairsPerGate: 2, repairsPerDefect: 3, verifierRepairs: 1, verifierResume: "desligada",
    });
  }, 120_000);

  it("orçamento inválido é recusado antes de qualquer sessão; o pedido vira o efetivo no run (§125)", async () => {
    const recusado = await execute(["--repairs-per-cycle", "0"]);
    expect(recusado.code).toBe(2);
    expect(recusado.stdout).toContain("--repairs-per-cycle deve ser um inteiro entre 1 e 50");
    await expect(readFile(adapterLog, "utf8")).rejects.toThrow();

    const result = await execute(["--repairs-per-gate", "4", "--repairs-per-defect", "5"]);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    const runId = runIdFor("build", sha12(PLAN));
    expect((await readRunState(projectRoot, runId))?.budgets).toMatchObject({ repairsPerCycle: 12, repairsPerGate: 4, repairsPerDefect: 5 });
  }, 120_000);

  /*
   * §125: sem reparo pelo verificador, a escada do G2 é o executor, numa
   * correção localizada dentro do ciclo (spec §5.2); a mesma falha sem
   * progresso para a fase — o reparador nunca é chamado.
   */
  // Etapa 4 da redução: o orçamento esgotado entrega a fase com a pendência dita (código 3), e o build termina sem ser aceito.
  it("orçamento zero não chama o reparador: depois de uma correção localizada do executor, a suíte vermelha faz o build falhar", async () => {
    const result = await execute(["--max-verifier-repairs", "0"]);
    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(await readFile(join(projectRoot, "app.txt"), "utf8")).toBe("errado");
    const calls = jsonLines<AdapterCall>(await readFile(adapterLog, "utf8"));
    expect(calls.map(({ role, repair }) => ({ role, repair }))).toEqual([{ role: "builder", repair: "0" }, { role: "builder", repair: "0" }]);
    const runId = runIdFor("build", sha12(PLAN));
    expect(await readRunState(projectRoot, runId)).toMatchObject({ status: "paused" });
    expect(result.stdout).toContain("PAROU");
    expect(result.stdout).toContain("gate 2 — suíte do projeto");
  }, 120_000);
});
