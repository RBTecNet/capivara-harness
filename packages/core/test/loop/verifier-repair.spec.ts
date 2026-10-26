import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPhase, splitPhases } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseRunOptions, PhaseSession } from "../../src/loop/index.js";
import { TasksAprovadas, tasksDaFase } from "../../src/loop/veredictos.js";
import { readEvents, runPaths } from "../../src/state/index.js";
import { VALID_PHASES } from "../contract/fixture.js";
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

  it("cada sessão recebe uma porta privada sem alterar process.env", async () => {
    const before = process.env.E2E_PORT;
    const { calls, outcome } = await phase({ call: async input => ok(input.role === "verifier" ? done : "feito") });
    expect(outcome.status).toBe("complete");
    const ports = calls.map(input => input.environment?.E2E_PORT);
    expect(ports.every(port => Number(port) > 0)).toBe(true);
    expect(new Set(ports).size).toBe(calls.length);
    expect(process.env.E2E_PORT).toBe(before);
  });

  it("observação não bloqueante é anunciada sem outra sessão", async () => {
    const messages: string[] = [];
    const registry = await TasksAprovadas.abrir(projectRoot, RUN);
    const note = "mais uma asserção seria útil, mas a URL final e a gravação estão corretas";
    const { outcome, calls, target } = await phase({
      maxCycles: 3,
      aprovadas: registry,
      announce: message => messages.push(message),
      flows: { workflows: [{ number: "1", name: "Save", steps: ["save"] }], resolveStart: async () => "npm start" },
      call: async call => ok(call.role === "verifier" ? `TASK 1: DONE — ADVISORY: ${note}\nTASK 2: DONE` : "feito"),
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier"]);
    expect(messages.join("\n")).toContain(`observação não bloqueante: ${note}`);
    expect(registry.jaAprovadas(target.id, tasksDaFase(target.markdown))).toHaveLength(2);
  });

  /*
   * §125: o achado do verificador vai primeiro ao executor, como correção
   * localizada DENTRO do ciclo (spec §6). A correção volta à revisão; a task que
   * segue incompleta faz a fase falhar com o defeito dito — e ela não anuncia um
   * ciclo que não existe.
   */
  it("observação não aprova defeito funcional e o último ciclo não anuncia retorno inexistente", async () => {
    const notices: string[] = [];
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 0,
      announce: (line) => notices.push(line),
      call: async call => ok(call.role === "verifier" ? `TASK 1: DONE — ADVISORY: nome de teste diferente\n${guidance.split("\n")[1]}` : "feito"),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1, gate: "gate 3 — verificação independente" });
    // A correção volta à revisão; sem progresso no ciclo, a escada acaba.
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier", "builder", "verifier"]);
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.filter(event => event.status === "retry")).toHaveLength(1);
    expect(notices.join("\n")).not.toContain("ciclo de correção 2");
    expect(events.some(event => event.detail.includes("ciclo de correção 2"))).toBe(false);
  });

  it("cada nova construção registra causa completa e ação concreta do verificador", async () => {
    const { outcome, calls } = await phase({
      maxCycles: 2, maxVerifierRepairs: 0,
      call: async call => {
        if (call.role === "builder") await writeFile(join(call.root ?? projectRoot, "seed.ts"), call.attempt === 1 ? "two statuses" : "three statuses");
        return ok(call.role === "verifier" ? call.attempt === 1 ? guidance : done : "feito");
      },
    });
    expect(outcome.status).toBe("complete");
    expect(calls.filter(call => call.role === "builder")).toHaveLength(2);
    const retries = (await readEvents(runPaths(projectRoot, RUN).events)).filter(event => event.status === "retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.detail).toContain("EVIDENCE: seed.ts inserts two");
    expect(retries[0]?.detail).toContain("FIX: insert cancelled");
    expect(retries[0]?.detail).toContain("CHECK: npm test");
  });




  it.each([
    ["anotação", "TASK 1: DONE; uncertain\nTASK 2: DONE"],
    ["resposta vazia", ""],
    ["índice repetido", "TASK 1: DONE\nTASK 1: DONE"],
    ["índice fora da fase", "TASK 1: DONE\nTASK 3: DONE"],
  ])("protocolo inválido (%s): sem builder e sem reparo, uma revisão a mais — ilegível de novo, a fase para em verificação inconclusiva", async (_label, malformed) => {
    const { outcome, calls } = await phase({
      maxCycles: 3,
      call: async call => ok(call.role === "verifier" ? malformed : "feito"),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1, gate: "gate 3 — verificação independente" });
    if (outcome.status !== "failed") throw new Error("deveria parar");
    expect(outcome.inconclusiva).toContain("a revisão veio ilegível");
    expect(outcome.inconclusiva).toContain("P01.verify-1.repetida.log");
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier", "verifier"]);
    expect(calls[2]?.prompt).toContain("## The previous review could not be read");
    expect(calls.some(call => call.repair)).toBe(false);
  });




  it.each(["quota", "configuration"] as const)("recusa %s no reparo não inicia outro construtor e mantém a causa original", async providerFailure => {
    const { outcome, calls, suiteRuns } = await phase({
      maxCycles: 3,
      testRunner: async () => ({ exitCode: 1, output: "missing statuses" }),
      call: async call => call.repair ? { ...ok("recusa explícita"), engineError: true, providerFailure } : ok(),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1 });
    if (outcome.status !== "failed") throw new Error("deveria falhar");
    expect(outcome.cause).toContain("missing statuses");
    expect(outcome.cause).toContain("recusa explícita");
    expect(calls).toHaveLength(2);
    expect(suiteRuns).toBe(1);
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


  it("não considera resolvido um reparo sem efeito quando o gate continua vermelho", async () => {
    const { outcome, calls, suiteRuns } = await phase({
      testRunner: async () => ({ exitCode: 1, output: "dependency still missing" }),
      call: async () => ok("I fixed everything"),
    });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
    // §125: o reparo assistido (primeiro degrau no G2, §114) e a correção do executor; a mesma falha não se repete.
    expect(suiteRuns).toBe(3);
    expect(calls.filter((call) => call.repair)).toHaveLength(1);
  });

  it("timeout de reparo preserva a causa inicial e não permite G3 nem autoaprovação", async () => {
    const { outcome, calls, suiteRuns } = await phase({
      maxCycles: 3,
      testRunner: async () => ({ exitCode: 1, output: "missing statuses" }),
      call: async (call) => call.repair
        ? { ...ok(done), timedOut: "wall" }
        : ok(),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1 });
    if (outcome.status !== "failed") throw new Error("deveria falhar");
    expect(outcome.cause).toContain("missing statuses");
    expect(outcome.cause).toContain("wall");
    expect(suiteRuns).toBe(1);
    expect(calls).toHaveLength(2);
  });

  /*
   * §125 (spec §5.2, critério §12.4): o orçamento do verificador é por gate e
   * renova no ciclo seguinte — antes era um só por fase, e um reparo do G2
   * tirava a vez do G3. A alternância entre estratégias é a informação nova.
   */
  it("o orçamento do verificador é por gate e ciclo, e renova no ciclo seguinte", async () => {
    // O reparo do verificador muda a falha (progresso: o ciclo seguinte abre); a correção do executor não. A suíte continua quebrada.
    let escrita = 0;
    let suites = 0;
    const { outcome, calls } = await phase({
      maxCycles: 2,
      testRunner: async () => ({ exitCode: 1, output: `broken: caso ${["alfa", "beta", "beta", "gama", "gama", "delta"][suites++] ?? "omega"}` }),
      call: async (call) => {
        if (call.role === "builder" || call.repair) await writeFile(join(call.root ?? projectRoot, "tentativa.ts"), `export const n = ${++escrita};\n`);
        return ok();
      },
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 2, gate: "gate 2 — suíte do projeto" });
    expect(calls.filter((call) => call.repair)).toHaveLength(2);
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(3);
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
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
    const correction = calls.find((call) => call.role === "builder" && call.attempt === 2)?.prompt;
    expect(correction).toContain("still missing statuses");
    expect(correction).toContain("FIX: seed.ts needs an explicit cancelled row");
  });



  it.each([
    ["protocolo vazio", ok("all done")],
    ["índices repetidos", ok("TASK 1: DONE\nTASK 1: INCOMPLETE — missing")],
    ["cobertura parcial", ok("TASK 2: INCOMPLETE — missing")],
    ["sessão com engineError", { ...ok(guidance), engineError: true }],
  ])("não transforma %s em autorização para editar: uma revisão a mais, e a fase para em verificação inconclusiva", async (_label, response) => {
    const { outcome, calls } = await phase({ call: async (call) => call.role === "verifier" ? response : ok() });
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 3 — verificação independente" });
    if (outcome.status === "failed") expect(outcome.inconclusiva).toBeDefined();
    expect(calls.filter((call) => call.role === "verifier")).toHaveLength(2);
    expect(calls.some((call) => call.repair)).toBe(false);
  });

  it("repasse ao builder preserva critério, evidência, correção e comando do verificador", async () => {
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 0,
      maxCycles: 2,
      call: async (call) => {
        if (call.role === "builder") await writeFile(join(call.root ?? projectRoot, "seed.ts"), call.attempt === 1 ? "two statuses" : "three statuses");
        return ok(call.role === "verifier" ? call.attempt === 1 ? guidance : done : "feito");
      },
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
    // A suíte vermelha começa pelo reparo do verificador (§114): é ele que tenta mexer no Git.
    const { outcome } = await phase({
      testRunner: async () => ({ exitCode: 1, output: "missing statuses" }),
      call: async (call) => {
        if (call.repair) await run("git", ["tag", "forbidden-repair"], { cwd: projectRoot });
        return ok(call.role === "verifier" && !call.repair ? done : "feito");
      },
    });
    expect(outcome).toMatchObject({ status: "commit-blocked" });
    if (outcome.status !== "commit-blocked") throw new Error("deveria bloquear");
    expect(outcome.cause).toContain("refs/tags/forbidden-repair");
  });

  it("reparo escreve no worktree da fase, não na raiz do produto", async () => {
    const workRoot = await mkdtemp(join(projectRoot, "worktree-"));
    // A suíte reprova até o seed ter os três status: o reparo do verificador é o primeiro degrau (§114).
    const { outcome, calls } = await phase({
      workRoot,
      testRunner: async () => ((await readFile(join(workRoot, "seed.ts"), "utf8").catch(() => "")) === "three statuses" ? { exitCode: 0, output: "passed" } : { exitCode: 1, output: "missing statuses" }),
    });
    expect(outcome.status).toBe("complete");
    expect(calls.every((call) => call.root === workRoot)).toBe(true);
    expect(await readFile(join(workRoot, "seed.ts"), "utf8")).toBe("three statuses");
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
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
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
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 2 — suíte do projeto" });
    // Nenhuma reinstalação: só a suíte, que roda de novo depois da correção do executor (§125).
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command === "npm test")).toBe(true);
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
