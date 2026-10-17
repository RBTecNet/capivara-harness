import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPhase, splitPhases } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseRunOptions, PhaseSession } from "../../src/loop/index.js";
import { TasksAprovadas, tasksDaFase } from "../../src/loop/veredictos.js";
import { runPaths } from "../../src/state/index.js";
import { VALID_PHASES } from "../contract/fixture.js";
import * as flowGates from "../../src/loop/flows.js";
import { MARCA_DE_INSTALACAO_NODE, registrarInstalacaoNode, runtimeNode } from "../../src/loop/instalacao-node.js";

const run = promisify(execFile);
const RUN = "build-repair123456";
const done = "TASK 1: DONE\nTASK 2: DONE";
const guidance = "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: three statuses; EVIDENCE: seed.ts inserts two; FIX: insert cancelled and assert all three rows; CHECK: npm test -- statuses";
const ok = (stdout = "feito"): EngineResult => ({ stdout, stderr: "", exitCode: 0, timedOut: null });
let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-verifier-repair-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectRoot, { recursive: true, force: true });
});

function session(): PhaseSession {
  const parsed = splitPhases(VALID_PHASES, projectRoot, RUN);
  if (!parsed.ok) throw new Error("fase inválida");
  return parsed.sessions[0]!;
}

async function phase(overrides: Partial<PhaseRunOptions> = {}) {
  const calls: EngineCall[] = [];
  let suiteRuns = 0;
  const target = session();
  const outcome = await runPhase({
    projectRoot,
    runId: RUN,
    language: "pt-BR",
    engine: "codex",
    session: target,
    testCommand: { command: "npm test", source: "fixture", containerized: false },
    commitsEnabled: false,
    maxCycles: 1,
    maxVerifierRepairs: 1,
    ...overrides,
    testRunner: async (...args) => {
      suiteRuns += 1;
      return overrides.testRunner ? overrides.testRunner(...args) : { exitCode: 0, output: "passed" };
    },
    call: async (call) => {
      calls.push(call);
      if (overrides.call) return overrides.call(call);
      if (call.role === "builder") {
        await writeFile(join(call.root ?? projectRoot, "seed.ts"), "two statuses");
        return ok();
      }
      if (call.repair === true) {
        await writeFile(join(call.root ?? projectRoot, "seed.ts"), "three statuses");
        return ok("Corrected seed and test; no self approval.");
      }
      return ok((await readFile(join(call.root ?? projectRoot, "seed.ts"), "utf8")) === "three statuses" ? done : guidance);
    },
  });
  return { outcome, calls, suiteRuns, target };
}

describe("reparo limitado pelo verificador", () => {
  it("corrige a árvore e exige suíte e NOVA sessão readonly antes de fechar, sem gastar outro ciclo do builder", async () => {
    const { outcome, calls, suiteRuns } = await phase();
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.map((call) => [call.role, call.repair === true])).toEqual([
      ["builder", false], ["verifier", false], ["verifier", true], ["verifier", false],
    ]);
    expect(suiteRuns).toBe(2);
    expect(calls[2]?.prompt).toContain("FIX: insert cancelled");
    const paths = runPaths(projectRoot, RUN);
    expect(await readFile(join(paths.logs, "P01.verify-1.log"), "utf8")).toContain("INCOMPLETE");
    expect(await readFile(join(paths.logs, "P01.repair-1-cycle-1.log"), "utf8")).toContain("Corrected seed");
    expect(await readFile(join(paths.logs, "P01.verify-1-after-repair-1.log"), "utf8")).toContain("TASK 2: DONE");
  });

  it("instala uma dependência sem diff versionado, reroda G2 e ignora a autoaprovação do reparador", async () => {
    let installed = false;
    const { outcome, calls, suiteRuns } = await phase({
      testRunner: async () => ({ exitCode: installed ? 0 : 127, output: installed ? "passed" : "runner: command not found" }),
      call: async (call) => {
        if (call.repair === true) {
          await mkdir(join(projectRoot, "node_modules", "runner"), { recursive: true });
          await writeFile(join(projectRoot, "node_modules", "runner", "index.js"), "installed");
          installed = true;
          return ok("TASK 1: DONE\nTASK 2: DONE");
        }
        return ok(call.role === "verifier" ? done : "implementado");
      },
    });
    expect(outcome.status).toBe("complete");
    expect(suiteRuns).toBe(2);
    expect(calls.map((call) => [call.role, call.repair === true])).toEqual([
      ["builder", false], ["verifier", true], ["verifier", false],
    ]);
    expect(calls[1]?.prompt).toContain("command not found");
  });

  it("um reparo que quebra a suíte bloqueia a fase e não chega à segunda aprovação", async () => {
    let broken = false;
    const { outcome, calls } = await phase({
      testRunner: async () => ({ exitCode: broken ? 1 : 0, output: broken ? "regression in users" : "passed" }),
      call: async (call) => {
        if (call.repair === true) broken = true;
        return ok(call.role === "verifier" && !call.repair ? guidance : "feito");
      },
    });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
    expect(calls.filter((call) => call.role === "verifier" && !call.repair)).toHaveLength(1);
  });

  it("não considera resolvido um reparo sem efeito quando o gate continua vermelho", async () => {
    const { outcome, calls, suiteRuns } = await phase({
      testRunner: async () => ({ exitCode: 1, output: "dependency still missing" }),
      call: async () => ok("I fixed everything"),
    });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
    expect(suiteRuns).toBe(2);
    expect(calls.filter((call) => call.repair)).toHaveLength(1);
  });

  it("timeout de reparo preserva a causa inicial e não permite G3 nem autoaprovação", async () => {
    const { outcome, calls, suiteRuns } = await phase({
      testRunner: async () => ({ exitCode: 1, output: "missing statuses" }),
      call: async (call) => call.repair
        ? { ...ok(done), timedOut: "wall" }
        : ok(),
    });
    expect(outcome).toMatchObject({ status: "failed" });
    if (outcome.status !== "failed") throw new Error("deveria falhar");
    expect(outcome.cause).toContain("missing statuses");
    expect(outcome.cause).toContain("wall");
    expect(suiteRuns).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it("o orçamento pertence à fase inteira e não renova no próximo ciclo do builder", async () => {
    const { outcome, calls } = await phase({
      maxCycles: 2,
      testRunner: async () => ({ exitCode: 1, output: "always broken" }),
      call: async () => ok(),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 2 });
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(2);
    expect(calls.filter((call) => call.repair)).toHaveLength(1);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, -1, 1.5, 11])("rejeita orçamento inválido %s em vez de permitir reparos sem limite", async (budget) => {
    await expect(phase({ maxVerifierRepairs: budget })).rejects.toThrow("inteiro entre 0 e 10");
  });

  it("a correção seguinte recebe a orientação escrita pelo reparador que não resolveu tudo", async () => {
    const { calls, outcome } = await phase({
      maxCycles: 2,
      testRunner: async () => ({ exitCode: 1, output: "still missing statuses" }),
      call: async (call) => ok(call.repair ? "FIX: seed.ts needs an explicit cancelled row; run npm test -- statuses" : "feito"),
    });
    expect(outcome.status).toBe("failed");
    const correction = calls.find((call) => call.role === "builder" && call.attempt === 2)?.prompt;
    expect(correction).toContain("still missing statuses");
    expect(correction).toContain("FIX: seed.ts needs an explicit cancelled row");
  });

  it("respeita orçamento explícito de dois reparos sem consumir ciclos funcionais", async () => {
    let repairs = 0;
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 2,
      call: async (call) => {
        if (call.repair) repairs += 1;
        return ok(call.role === "verifier" && !call.repair ? repairs === 2 ? done : guidance : "feito");
      },
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.filter((call) => call.repair)).toHaveLength(2);
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(1);
  });

  it("revalida todas as tasks e o inventário após reparo, incluindo as já aprovadas", async () => {
    const target = session();
    const registry = await TasksAprovadas.abrir(projectRoot, RUN);
    await registry.aprovar(target.id, tasksDaFase(target.markdown), [1], 1);
    let verifications = 0;
    const { outcome, calls } = await phase({
      aprovadas: registry,
      call: async (call) => {
        if (call.repair) {
          await writeFile(join(projectRoot, "migration.test.ts"), "test('users_migration', () => {});");
          return ok();
        }
        if (call.role === "builder") return ok();
        verifications += 1;
        return ok(verifications === 1 ? guidance : done);
      },
    });
    expect(outcome.status).toBe("complete");
    const checks = calls.filter((call) => call.role === "verifier" && !call.repair);
    expect(checks[0]?.prompt).toContain("Already DONE");
    expect(checks[0]?.prompt).toContain("NAME NOT FOUND");
    expect(checks[1]?.prompt).not.toContain("Already DONE");
    expect(checks[1]?.prompt).toContain("name found in the tree");
  });

  it.each([
    ["protocolo vazio", ok("all done")],
    ["índices repetidos", ok("TASK 1: DONE\nTASK 1: INCOMPLETE — missing")],
    ["cobertura parcial", ok("TASK 2: INCOMPLETE — missing")],
    ["sessão com engineError", { ...ok(guidance), engineError: true }],
  ])("não transforma %s em autorização para editar", async (_label, response) => {
    const { outcome, calls } = await phase({ call: async (call) => call.role === "verifier" ? response : ok() });
    expect(outcome.status).toBe("failed");
    expect(calls.some((call) => call.repair)).toBe(false);
  });

  it("repasse ao builder preserva critério, evidência, correção e comando do verificador", async () => {
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 0,
      maxCycles: 2,
      call: async (call) => ok(call.role === "verifier" ? call.attempt === 1 ? guidance : done : "feito"),
    });
    expect(outcome.status).toBe("complete");
    const fix = calls.find((call) => call.role === "builder" && call.attempt === 2)?.prompt;
    expect(fix).toContain("CRITERION: three statuses");
    expect(fix).toContain("EVIDENCE: seed.ts inserts two");
    expect(fix).toContain("FIX: insert cancelled");
    expect(fix).toContain("CHECK: npm test -- statuses");
    expect(calls.some((call) => call.repair)).toBe(false);
  });

  it("redetecta o runner que o reparador instalou em vez de repetir um comando antigo", async () => {
    let repaired = false;
    const commands: string[] = [];
    const { outcome } = await phase({
      resolveTest: async () => ({ command: repaired ? "npm run check" : "npm test", source: "fixture", containerized: false }),
      testRunner: async (command) => {
        commands.push(command);
        return { exitCode: command === "npm run check" ? 0 : 1, output: command };
      },
      call: async (call) => {
        if (call.repair) repaired = true;
        return ok(call.role === "verifier" && !call.repair ? done : "feito");
      },
    });
    expect(outcome.status).toBe("complete");
    expect(commands).toEqual(["npm test", "npm run check"]);
  });

  it("sessão de reparo não ganha autoridade de alterar refs Git", async () => {
    await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
    await run("git", ["config", "user.email", "test@test"], { cwd: projectRoot });
    await run("git", ["config", "user.name", "test"], { cwd: projectRoot });
    await writeFile(join(projectRoot, "README.md"), "initial");
    await run("git", ["add", "README.md"], { cwd: projectRoot });
    await run("git", ["commit", "-qm", "initial"], { cwd: projectRoot });
    const { outcome } = await phase({
      call: async (call) => {
        if (call.repair) await run("git", ["tag", "forbidden-repair"], { cwd: projectRoot });
        return ok(call.role === "verifier" && !call.repair ? guidance : "feito");
      },
    });
    expect(outcome).toMatchObject({ status: "commit-blocked" });
    if (outcome.status !== "commit-blocked") throw new Error("deveria bloquear");
    expect(outcome.cause).toContain("refs/tags/forbidden-repair");
  });

  it("reparo escreve no worktree da fase, não na raiz do produto", async () => {
    const workRoot = await mkdtemp(join(projectRoot, "worktree-"));
    const { outcome, calls } = await phase({ workRoot });
    expect(outcome.status).toBe("complete");
    expect(calls.every((call) => call.root === workRoot)).toBe(true);
    expect(await readFile(join(workRoot, "seed.ts"), "utf8")).toBe("three statuses");
  });

  it("G4 com defeito confirmado do produto pode ser reparado e exige nova passagem de G2/G3/G4", async () => {
    let repaired = false;
    const g4 = vi.spyOn(flowGates, "gate4").mockImplementation(async () => repaired
      ? { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] }
      : {
          green: false,
          cause: "save button has no handler; add submit handler and assert saved status",
          triagem: { tipo: "PRODUTO", evidencia: "no handler", onde: "form.tsx", criterio: "saves", correcao: "add submit handler" },
        });
    const { outcome, calls, suiteRuns } = await phase({
      flows: { workflows: [{ number: "1", name: "Save", steps: ["save"] }], resolveStart: async () => "npm start" },
      call: async (call) => {
        if (call.repair) repaired = true;
        return ok(call.role === "verifier" && !call.repair ? done : "feito");
      },
    });
    expect(outcome.status).toBe("complete");
    expect(suiteRuns).toBe(2);
    expect(g4).toHaveBeenCalledTimes(2);
    expect(calls.filter((call) => call.role === "verifier" && !call.repair)).toHaveLength(2);
    expect(calls.find((call) => call.repair)?.prompt).toContain("add submit handler");
  });

  it.each(["ROTEIRO", "CRITERIO"] as const)("G4 de %s não autoriza adaptar o produto por reparo", async (tipo) => {
    vi.spyOn(flowGates, "gate4").mockResolvedValue({
      green: false,
      cause: "selector is wrong",
      triagem: { tipo, evidencia: "Save is named Salvar", onde: "workflow", criterio: "saves", correcao: "correct selector" },
    });
    const { outcome, calls } = await phase({
      flows: { workflows: [{ number: "1", name: "Save", steps: ["save"] }], resolveStart: async () => "npm start" },
      call: async (call) => ok(call.role === "verifier" ? done : "feito"),
    });
    expect(outcome.status).toBe("failed");
    expect(calls.some((call) => call.repair)).toBe(false);
  });
});

describe("dependências preparadas sem consumir ciclos funcionais", () => {
  async function packageJson() {
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ dependencies: { runner: "1.0.0" } }));
  }

  it("engine incompatível para antes de gastar uma sessão de modelo", async () => {
    await packageJson();
    const { outcome, calls } = await phase({
      maxCycles: 3,
      testRunner: async () => ({ exitCode: 1, output: "npm error code EBADENGINE\nnpm error Unsupported engine: required node >=22 <25; actual 25" }),
    });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto", cycles: 0 });
    expect(calls).toHaveLength(0);
    if (outcome.status !== "failed") throw new Error("deveria parar por ambiente");
    expect(outcome.cause).toContain("Reinicie a Capivara com uma versão compatível");
  });

  it("reinstala a cópia ausente antes de chamar o builder e guarda a saída completa", async () => {
    await packageJson();
    await writeFile(join(projectRoot, "package-lock.json"), "{}");
    const trace: string[] = [];
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 0,
      testRunner: async (command) => {
        trace.push(command);
        if (command.startsWith("npm ci")) {
          await mkdir(join(projectRoot, "node_modules"));
          return { exitCode: 0, output: "native addon rebuilt for current runtime\nfull install output" };
        }
        return { exitCode: 0, output: "passed" };
      },
      call: async (call) => {
        trace.push(call.role);
        if (call.role === "builder") {
          const stamp = JSON.parse(await readFile(join(projectRoot, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8"));
          expect(stamp.runtime.abi).toBe(process.versions.modules);
        }
        return ok(call.role === "verifier" ? done : "feito");
      },
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(trace).toEqual(["npm ci --no-audit --no-fund --engine-strict", "builder", "npm test", "verifier"]);
    expect(calls.some((call) => call.repair)).toBe(false);
    const output = await readFile(join(runPaths(projectRoot, RUN).logs, "P01.dependencies-prepare-1.log"), "utf8");
    expect(output).toContain("native addon rebuilt for current runtime\nfull install output");
  });

  it("troca a instalação de outro runtime antes de julgar o trabalho do builder", async () => {
    await packageJson();
    await mkdir(join(projectRoot, "node_modules"));
    await registrarInstalacaoNode(projectRoot, { ...runtimeNode(), abi: "999", node: "v99.0.0" });
    const commands: string[] = [];
    const { outcome } = await phase({
      testRunner: async (command) => { commands.push(command); return { exitCode: 0, output: "prepared" }; },
      call: async (call) => ok(call.role === "verifier" ? done : "feito"),
    });
    expect(outcome.status).toBe("complete");
    expect(commands).toEqual(["npm install --no-audit --no-fund --no-package-lock --engine-strict", "npm test"]);
    const stamp = JSON.parse(await readFile(join(projectRoot, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8"));
    expect(stamp.runtime.abi).toBe(process.versions.modules);
  });

  it("prepara dependências que o builder declarou no primeiro ciclo antes de G2", async () => {
    const commands: string[] = [];
    const { outcome, calls } = await phase({
      testRunner: async (command) => {
        commands.push(command);
        if (command.startsWith("npm install")) await mkdir(join(projectRoot, "node_modules"));
        return { exitCode: 0, output: "passed" };
      },
      call: async (call) => {
        if (call.role === "builder") await packageJson();
        return ok(call.role === "verifier" ? done : "feito");
      },
    });
    expect(outcome.status).toBe("complete");
    expect(commands).toEqual(["npm install --no-audit --no-fund --no-package-lock --engine-strict", "npm test"]);
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(1);
  });

  it("ABI revelada apenas por G2 ganha um reparo de infraestrutura e repete os gates da mesma implementação", async () => {
    await packageJson();
    await mkdir(join(projectRoot, "node_modules"));
    let repaired = false;
    const commands: string[] = [];
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 0,
      testRunner: async (command) => {
        commands.push(command);
        if (command.startsWith("npm install")) repaired = true;
        return {
          exitCode: repaired ? 0 : 1,
          output: repaired ? "passed" : "was compiled against a different Node.js version using NODE_MODULE_VERSION 141. This version requires NODE_MODULE_VERSION 137.",
        };
      },
      call: async (call) => ok(call.role === "verifier" ? done : "feito"),
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(1);
    expect(commands).toEqual(["npm test", "npm install --no-audit --no-fund --no-package-lock --engine-strict", "npm test"]);
  });

  it("instalação malsucedida não vira sucesso, não repete indefinidamente e informa ambos os agentes", async () => {
    await packageJson();
    const commands: string[] = [];
    const { outcome, calls } = await phase({
      maxCycles: 2,
      maxVerifierRepairs: 1,
      testRunner: async (command) => {
        commands.push(command);
        return { exitCode: 1, output: command.startsWith("npm install") ? "download failed: registry unreachable" : "Cannot find package 'runner'" };
      },
      call: async () => ok("install remains blocked"),
    });
    expect(outcome.status).toBe("failed");
    expect(commands.filter((command) => command.startsWith("npm install"))).toHaveLength(1);
    expect(calls.find((call) => call.role === "builder")?.prompt).toContain("registry unreachable");
    expect(calls.find((call) => call.repair)?.prompt).toContain("registry unreachable");
    await expect(readFile(join(projectRoot, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8")).rejects.toThrow();
  });

  it("falha funcional não é pretexto para reinstalar dependências", async () => {
    await packageJson();
    await mkdir(join(projectRoot, "node_modules"));
    const commands: string[] = [];
    const { outcome } = await phase({
      maxVerifierRepairs: 0,
      testRunner: async (command) => { commands.push(command); return { exitCode: 1, output: "expected 3 rows, received 2" }; },
      call: async () => ok(),
    });
    expect(outcome.status).toBe("failed");
    expect(commands).toEqual(["npm test"]);
  });

  it("G2 pulado não registra uma instalação como validada", async () => {
    await packageJson();
    await mkdir(join(projectRoot, "node_modules"));
    const { outcome } = await phase({
      testCommand: null,
      call: async (call) => ok(call.role === "verifier" ? done : "feito"),
    });
    expect(outcome.status).toBe("complete");
    await expect(readFile(join(projectRoot, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8")).rejects.toThrow();
  });
});
