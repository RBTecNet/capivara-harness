import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSkeleton, sha12 } from "../../src/contract/index.js";
import { runBuild } from "../../src/loop/build.js";
import { runPlan } from "../../src/init/plan.js";
import { readSkeletonState } from "../../src/init/skeleton-state.js";
import { shaDaFase } from "../../src/loop/ledger.js";
import { runIdFor } from "../../src/state/run-store.js";
import { VALID_PHASES } from "../contract/fixture.js";
import { SKELETON } from "../support/fake-agent.js";
import { certifyCurrentPlan } from "../support/current-plan.js";
import { runChange } from "../../src/change/orchestrator.js";
import { readPlanCache, planCachePath } from "../../src/init/plan-cache.js";

let root: string;
const legacy = () => ({ ...JSON.parse(SKELETON), contract: "capivara-skeleton/v1" });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-version-boundary-"));
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await writeFile(join(root, ".capivara/init/project-phases.md"), VALID_PHASES);
  await writeFile(join(root, ".capivara/init/skeleton.md"), "## Stack\n- Runtime: Node.js\n");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it.each(["ausente", "v1"])("build rejeita plano antigo com metadado %s antes de Git ou modelos, mesmo com flags de retomada", async kind => {
  if (kind === "v1") await writeFile(join(root, ".capivara/init/environment.json"), JSON.stringify({ contract: "capivara-environment/v1", skeletonSha12: sha12(await readFile(join(root, ".capivara/init/skeleton.md"), "utf8")), requirements: [] }));
  const call = vi.fn(async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => ({ stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", exitCode: 0, timedOut: null }));
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false, skipFlows: true, skipAcceptance: true, rebuildAll: true });
  expect(result.exitCode).toBe(1);
  expect(result.errors.join("\n")).toContain("incompatível");
  expect(result.errors.join("\n")).toContain("capivara init --fresh");
  expect(call).not.toHaveBeenCalled();
  expect(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")).toBe(VALID_PHASES);
  await expect(readFile(join(root, ".git/HEAD"))).rejects.toThrow();
});

it("não aceita esqueleto v1 nem completa environment ausente silenciosamente", () => {
  expect(parseSkeleton(JSON.stringify(legacy()), { maxTasksPerPhase: 15 }).ok).toBe(false);
  const withoutEnvironment = JSON.parse(SKELETON);
  delete withoutEnvironment.environment;
  expect(parseSkeleton(JSON.stringify(withoutEnvironment), { maxTasksPerPhase: 15 }).ok).toBe(false);
});

it("estado antigo não volta como esqueleto atual", async () => {
  await mkdir(join(root, ".capivara/handoffs"), { recursive: true });
  await writeFile(join(root, ".capivara/handoffs/init-old.skeleton-state.json"), JSON.stringify(legacy()));
  expect(await readSkeletonState(root, "init-old")).toBeNull();
});

it("plan antigo para sem chamar o modelo e explica como gerar novamente", async () => {
  const runId = runIdFor("init", "abc123abc123");
  await mkdir(join(root, ".capivara/handoffs"), { recursive: true });
  await writeFile(join(root, `.capivara/handoffs/${runId}.skeleton-state.json`), JSON.stringify(legacy()));
  const call = vi.fn(async () => { throw new Error("não deveria chamar modelo"); });
  await expect(runPlan({ projectRoot: root, request: { text: "reservas", sha12: "abc123abc123", path: null, origin: "text" }, language: "pt-BR", call, ask: async () => "1" })).rejects.toThrow(/incompatível/);
  expect(call).not.toHaveBeenCalled();
});

it("runs e aprovações de fase não reaproveitam a identidade da geração anterior", () => {
  expect(runIdFor("init", "pedido")).not.toBe(`init-${sha12("pedido")}`);
  expect(runIdFor("build", "plano")).not.toBe(`build-${sha12("plano")}`);
  expect(runIdFor("survey", "produto")).toBe(`survey-${sha12("produto")}`);
  expect(shaDaFase("fase idêntica")).not.toBe(sha12("fase idêntica"));
});

it.each(["plano", "esqueleto", "geração", "JSON"])("metadado divergente em %s bloqueia o build sem inferência", async kind => {
  await certifyCurrentPlan(root, []);
  const dir = join(root, ".capivara/init");
  if (kind === "plano") await writeFile(join(dir, "project-phases.md"), VALID_PHASES + "\n");
  if (kind === "esqueleto") await writeFile(join(dir, "skeleton.md"), "alterado");
  if (kind === "geração") {
    const metadata = JSON.parse(await readFile(join(dir, "environment.json"), "utf8"));
    metadata.planningContract = "capivara-planning/v1";
    await writeFile(join(dir, "environment.json"), JSON.stringify(metadata));
  }
  if (kind === "JSON") await writeFile(join(dir, "environment.json"), "{");
  const call = vi.fn(async () => { throw new Error("não deveria chamar modelo"); });
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call });
  expect(result.exitCode).toBe(1);
  expect(result.errors.join("\n")).toContain("incompatível");
  expect(call).not.toHaveBeenCalled();
  await expect(readFile(join(root, ".git/HEAD"))).rejects.toThrow();
});

it("change não converte plano antigo nem chama o modelo", async () => {
  const call = vi.fn(async () => { throw new Error("não deveria chamar modelo"); });
  await expect(runChange({ projectRoot: root, language: "pt-BR", request: "editar reservas", call })).rejects.toThrow(/incompatível/);
  expect(call).not.toHaveBeenCalled();
});

it("sem flags de Git também rejeita plano antigo antes de criar repositório", async () => {
  const call = vi.fn(async () => { throw new Error("não deveria chamar modelo"); });
  const result = await runBuild({ projectRoot: root, language: "pt-BR", engine: "codex", call });
  expect(result.exitCode).toBe(1);
  expect(result.errors.join("\n")).toContain("incompatível");
  expect(call).not.toHaveBeenCalled();
  await expect(readFile(join(root, ".git/HEAD"))).rejects.toThrow();
});

it("cache de autoria da geração anterior não certifica tasks atuais", async () => {
  const path = planCachePath(root, "init-cache");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify({ contract: "capivara-plan-cache/v1", runId: "init-cache", escritas: { hash: "fase antiga" }, aprovadas: { hash: "ontem" } }));
  expect(await readPlanCache(root, "init-cache")).toMatchObject({ escritas: {}, aprovadas: {} });
});
