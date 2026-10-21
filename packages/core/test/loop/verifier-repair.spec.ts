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
  it("entrega ao autor do G4 e à triagem os contratos já conhecidos, sem sessão de descoberta", async () => {
    const contract = "## Regras transversais\n- API: GET /api/tarefas retorna JSON; navegação da tela: /tarefas retorna HTML";
    await mkdir(join(projectRoot, ".capivara/init"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara/init/skeleton.md"), contract);
    vi.spyOn(flowGates, "gate4").mockImplementation(async options => {
      const workflow = options.workflows[0]!;
      await options.author(workflow, [], "http://127.0.0.1:47533", { anteriores: [], bancoNovo: [], migracao: null, ajudante: "capivara-comando.ts" });
      await options.triagem!({ workflow, script: "roteiro", failure: "HTML em json()", snapshot: "Tarefas", serverErrors: [] });
      return { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] };
    });
    const { outcome, calls, target } = await phase({
      flows: { workflows: [{ number: "1", name: "Tarefas", steps: ["listar tarefas"] }], resolveStart: async () => "npm start" },
      call: async call => ok(call.role === "builder" ? "feito" : done),
    });
    expect(outcome.status).toBe("complete");
    const readers = calls.filter(call => call.prompt.includes("CAPIVARA_FLOW") || call.prompt.includes("CAPIVARA_TRIAGE"));
    expect(readers).toHaveLength(2);
    for (const call of readers) {
      expect(call.prompt).toContain("GET /api/tarefas retorna JSON");
      expect(call.prompt).toContain("/tarefas retorna HTML");
      expect(call.prompt).toContain(target.markdown.trim());
    }
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.prompt).toContain("GET /api/tarefas retorna JSON");
  });

  it("cada sessão recebe uma porta privada sem alterar process.env", async () => {
    const before = process.env.E2E_PORT;
    const { calls, outcome } = await phase({ call: async input => ok(input.role === "verifier" ? done : "feito") });
    expect(outcome.status).toBe("complete");
    const ports = calls.map(input => input.environment?.E2E_PORT);
    expect(ports.every(port => Number(port) > 0)).toBe(true);
    expect(new Set(ports).size).toBe(calls.length);
    expect(process.env.E2E_PORT).toBe(before);
  });

  it("observação não bloqueante é anunciada sem outra sessão e preserva G4 independente", async () => {
    const messages: string[] = [];
    const registry = await TasksAprovadas.abrir(projectRoot, RUN);
    const note = "mais uma asserção seria útil, mas a URL final e a gravação estão corretas";
    const g4 = vi.spyOn(flowGates, "gate4").mockResolvedValue({ green: true, skipped: "", scripts: ["workflow-1.spec.ts"] });
    const { outcome, calls, target } = await phase({
      maxCycles: 3,
      aprovadas: registry,
      announce: message => messages.push(message),
      flows: { workflows: [{ number: "1", name: "Save", steps: ["save"] }], resolveStart: async () => "npm start" },
      call: async call => ok(call.role === "verifier" ? `TASK 1: DONE — ADVISORY: ${note}\nTASK 2: DONE` : "feito"),
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier"]);
    expect(g4).toHaveBeenCalledOnce();
    expect(messages.join("\n")).toContain(`observação não bloqueante: ${note}`);
    expect(registry.jaAprovadas(target.id, tasksDaFase(target.markdown))).toHaveLength(2);
  });

  /*
   * §125: o achado do verificador vai primeiro ao executor, como correção
   * localizada DENTRO do ciclo (spec §6). Sem progresso e sem reparo pelo
   * verificador, a fase para — e não anuncia um ciclo que não existe.
   */
  it("observação não aprova defeito funcional e o último ciclo não anuncia retorno inexistente", async () => {
    const notices: string[] = [];
    const { outcome, calls } = await phase({
      maxVerifierRepairs: 0,
      announce: (line) => notices.push(line),
      call: async call => ok(call.role === "verifier" ? `TASK 1: DONE — ADVISORY: nome de teste diferente\n${guidance.split("\n")[1]}` : "feito"),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1 });
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier", "builder", "verifier"]);
    const events = await readEvents(runPaths(projectRoot, RUN).events);
    expect(events.filter(event => event.status === "retry")).toHaveLength(1);
    expect(notices.join("\n")).not.toContain("ciclo de correção 2");
    expect(events.some(event => event.detail.includes("ciclo de correção 2"))).toBe(false);
  });

  it("cada nova construção registra causa completa e ação concreta do verificador", async () => {
    const { outcome, calls } = await phase({
      maxCycles: 2, maxVerifierRepairs: 0,
      call: async call => ok(call.role === "verifier" ? call.attempt === 1 ? guidance : done : "feito"),
    });
    expect(outcome.status).toBe("complete");
    expect(calls.filter(call => call.role === "builder")).toHaveLength(2);
    const retries = (await readEvents(runPaths(projectRoot, RUN).events)).filter(event => event.status === "retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]?.detail).toContain("EVIDENCE: seed.ts inserts two");
    expect(retries[0]?.detail).toContain("FIX: insert cancelled");
    expect(retries[0]?.detail).toContain("CHECK: npm test");
  });

  it("falha persistente do roteiro não pede ao construtor para alterar produto aprovado", async () => {
    vi.spyOn(flowGates, "gate4").mockResolvedValue({
      green: false, cause: "seletor não corresponde ao produto", scriptFailed: true,
      triagem: { tipo: "ROTEIRO", evidencia: "botão existe", onde: "workflow", criterio: "saves", correcao: "corrigir seletor" },
    });
    const { outcome, calls } = await phase({
      maxCycles: 3,
      flows: { workflows: [{ number: "1", name: "Save", steps: ["save"] }], resolveStart: async () => "npm start" },
      call: async call => ok(call.role === "verifier" ? done : "feito"),
    });
    // §125: a reescrita que volta igual não se repete até gastar os ciclos; o produto nunca é chamado a mudar.
    expect(outcome).toMatchObject({ status: "failed", cycles: 1 });
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier"]);
  });

  it("nova correção recebe os patches já publicados em vez de restaurar o rascunho original", async () => {
    const script = "import { test, expect } from '@playwright/test';\ntest('workflow 1', async ({ page }) => { await test.step('passo 1: save', async () => { expect(await page.title()).toBeTruthy(); }); });\nconst marcador = 'ORIGINAL';";
    const patched = script.replace("'ORIGINAL'", "'PATCH_APLICADO'");
    let authors = 0;
    vi.spyOn(flowGates, "gate4").mockImplementation(async options => {
      const workflow = options.workflows[0]!;
      const context = { anteriores: [], bancoNovo: [], migracao: null, ajudante: "capivara-comando.ts" };
      await options.author(workflow, [], "http://127.0.0.1:47533", context);
      await mkdir(join(projectRoot, ".capivara/flows"), { recursive: true });
      await writeFile(join(projectRoot, ".capivara/flows/workflow-1.spec.ts"), `${flowGates.FLOW_MARK}\n${patched}\n`);
      await options.author(workflow, ["corrigir o próximo seletor"], "http://127.0.0.1:47533", context);
      return { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] };
    });
    const { outcome } = await phase({
      flows: { workflows: [{ number: "1", name: "Save", steps: ["save"] }], resolveStart: async () => "npm start" },
      call: async call => {
        if (call.purpose === "flow-author") {
          authors += 1;
          if (authors > 1) expect(call.prompt).toContain("PATCH_APLICADO");
          return ok(`\`\`\`ts\n${authors === 1 ? script : patched}\n\`\`\``);
        }
        return ok(call.role === "verifier" ? done : "feito");
      },
    });
    expect(outcome.status).toBe("complete");
    expect(authors).toBe(2);
  });

  it("recupera DONE anotado em sessão readonly no mesmo ciclo, preservando a resposta original", async () => {
    const malformed = "TASK 1: DONE; risk noted: production startup may differ on Windows\nTASK 2: DONE";
    const workRoot = await mkdtemp(join(projectRoot, "worktree-"));
    let checks = 0;
    const { outcome, calls, suiteRuns } = await phase({
      maxCycles: 3,
      workRoot,
      worker: 2,
      call: async call => ok(call.role === "verifier" ? ++checks === 1 ? malformed : done : "feito"),
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.map(call => [call.role, call.repair === true])).toEqual([
      ["builder", false], ["verifier", false], ["verifier", false],
    ]);
    expect(suiteRuns).toBe(1);
    expect(calls.every(call => call.root === workRoot && call.worker === 2)).toBe(true);
    const prompt = calls[2]!.prompt;
    expect(prompt).toContain(calls[1]!.prompt);
    expect(prompt).toContain(JSON.stringify(malformed));
    expect(prompt).toContain("1 de 2 tasks");
    expect(prompt).toContain("Do not turn INCOMPLETE into DONE");
    const paths = runPaths(projectRoot, RUN);
    expect(await readFile(join(paths.logs, "P01.verify-1.log"), "utf8")).toContain(malformed);
    expect(await readFile(join(paths.logs, "P01.verify-1.format-1.log"), "utf8")).toContain(done);
    expect(await readFile(join(paths.prompts, "P01.verify-1.format-1.txt"), "utf8")).toBe(prompt);
  });

  it.each([
    ["anotação", "TASK 1: DONE; uncertain\nTASK 2: DONE"],
    ["resposta vazia", ""],
    ["índice repetido", "TASK 1: DONE\nTASK 1: DONE"],
    ["índice fora da fase", "TASK 1: DONE\nTASK 3: DONE"],
  ])("protocolo continua inválido (%s): não reabre builder nem autoriza reparo", async (_label, malformed) => {
    const { outcome, calls } = await phase({
      maxCycles: 3,
      call: async call => ok(call.role === "verifier" ? malformed : "feito"),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1, gate: "gate 3 — verificação independente" });
    if (outcome.status !== "failed") throw new Error("deveria falhar");
    expect(outcome.cause).toContain("O verificador devolveu protocolo inválido");
    expect(outcome.cause).toContain("P01.verify-1.format-1.log");
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier", "verifier"]);
    expect(calls.some(call => call.repair)).toBe(false);
  });

  /*
   * §125 (spec §6): o achado material recuperado do formato vira defeito com
   * handoff; o executor tenta primeiro, sem progresso o verificador que
   * diagnosticou repara, e outra sessão independente valida.
   */
  it("achado material na recuperação não vira verde: exige reparo e outra avaliação independente", async () => {
    let checks = 0;
    const { outcome, calls, suiteRuns } = await phase({
      call: async call => {
        if (call.repair) {
          await writeFile(join(call.root ?? projectRoot, "seed.ts"), "three statuses");
          return ok("Corrected seed.");
        }
        if (call.role === "builder") {
          await writeFile(join(call.root ?? projectRoot, "seed.ts"), "two statuses");
          return ok("feito");
        }
        checks += 1;
        if (checks === 1) return ok("TASK 1: DONE; risk noted\nTASK 2: DONE");
        return ok((await readFile(join(call.root ?? projectRoot, "seed.ts"), "utf8")) === "three statuses" ? done : guidance);
      },
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.map(call => [call.role, call.repair === true])).toEqual([
      ["builder", false], ["verifier", false], ["verifier", false], ["builder", false], ["verifier", false], ["verifier", true], ["verifier", false],
    ]);
    expect(calls[3]!.prompt).toContain("FIX: insert cancelled");
    expect(calls[5]!.prompt).toContain("FIX: insert cancelled");
    // A correção do executor não mudou o código: a suíte não roda de novo; o reparo mudou, e ela roda.
    expect(suiteRuns).toBe(2);
  });

  it.each(["timeout", "quota", "configuration", "engineError", "exitCode", "missingResult"] as const)("%s na recuperação de formato não inicia outra construção", async failure => {
    let checks = 0;
    const { outcome, calls } = await phase({
      maxCycles: 3,
      call: async call => call.role === "verifier" && ++checks > 1
        ? failure === "timeout" ? { ...ok(), timedOut: "wall" }
          : failure === "engineError" ? { ...ok(), engineError: true }
          : failure === "exitCode" ? { ...ok(), exitCode: 1 }
          : failure === "missingResult" ? { ...ok(), resultRead: false }
          : { ...ok("recusa explícita"), engineError: true, providerFailure: failure }
        : ok(call.role === "verifier" ? "all done" : "feito"),
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 1, gate: "gate 0 — engine" });
    expect(calls.map(call => call.role)).toEqual(["builder", "verifier", "verifier"]);
    expect(calls.some(call => call.repair)).toBe(false);
  });

  /*
   * §125: o executor tenta primeiro (spec §6); o reparo do verificador muda o
   * código, e a aprovada volta à verificação (não ao "Already DONE"); a leitura
   * completa depois dele restaura a memória, que vale de novo no ciclo seguinte.
   */
  it.each([false, true])("a leitura completa após reparo restaura a memória DONE para o próximo ciclo (recuperar formato: %s)", async recoverFormat => {
    const target = session();
    const registry = await TasksAprovadas.abrir(projectRoot, RUN);
    await registry.aprovar(target.id, tasksDaFase(target.markdown), [1], 1);
    let checks = 0;
    let reparado = false;
    const { outcome, calls } = await phase({
      maxCycles: 2,
      aprovadas: registry,
      call: async call => {
        if (call.repair) {
          reparado = true;
          await writeFile(join(projectRoot, "seed.ts"), "three statuses");
          return ok("Corrected seed.");
        }
        if (call.role !== "verifier") return ok();
        checks += 1;
        if (!reparado) return ok(guidance);
        if (recoverFormat && checks === 3) return ok("TASK 1: DONE; risk noted\nTASK 2: DONE");
        return ok(checks === (recoverFormat ? 4 : 3)
          ? "TASK 1: INCOMPLETE — FIX: preserve production startup; CHECK: npm test\nTASK 2: DONE" : done);
      },
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 2 });
    const prompts = calls.filter(call => call.role === "verifier" && !call.repair).map(call => call.prompt);
    // §125: a aprovação de outro run, sem conteúdo conhecido, nunca é "já DONE": vai à consulta limitada (spec §3.3).
    expect(prompts[0]).toContain("Previously approved — confirm against what changed");
    const depoisDoReparo = prompts[2]!;
    expect(depoisDoReparo).not.toContain("Already DONE");
    expect(depoisDoReparo).toContain("Previously approved — confirm against what changed");
    if (recoverFormat) expect(prompts[3]).not.toContain("Already DONE");
    expect(prompts.at(-1)).toContain("Already DONE");
    expect(prompts.at(-1)).toContain(`- task 2: ${tasksDaFase(target.markdown)[1]!.title}`);
    expect(prompts.at(-1)).not.toContain(`- task 1: ${tasksDaFase(target.markdown)[0]!.title}`);
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

  // §125 (spec §6): executor primeiro; sem progresso, o verificador repara; a validação é sempre outra sessão somente leitura.
  it("corrige a árvore e exige suíte e NOVA sessão readonly antes de fechar, sem gastar outro ciclo do builder", async () => {
    const { outcome, calls, suiteRuns } = await phase();
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.map((call) => [call.role, call.repair === true])).toEqual([
      ["builder", false], ["verifier", false], ["builder", false], ["verifier", false], ["verifier", true], ["verifier", false],
    ]);
    expect(suiteRuns).toBe(2);
    expect(calls[2]?.prompt).toContain("FIX: insert cancelled");
    expect(calls[4]?.prompt).toContain("FIX: insert cancelled");
    const paths = runPaths(projectRoot, RUN);
    expect(await readFile(join(paths.logs, "P01.verify-1.log"), "utf8")).toContain("INCOMPLETE");
    expect(await readFile(join(paths.logs, "P01.verify-2.log"), "utf8")).toContain("INCOMPLETE");
    expect(await readFile(join(paths.logs, "P01.repair-1-cycle-2.log"), "utf8")).toContain("Corrected seed");
    expect(await readFile(join(paths.logs, "P01.verify-2-after-repair-1.log"), "utf8")).toContain("TASK 2: DONE");
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
    // §125: as duas leituras são antes do reparo (a do executor não mudou nada); depois do reparo que quebra a suíte, nenhuma.
    const ordem = calls.map((call) => call.repair ? "reparo" : call.role);
    expect(ordem.slice(ordem.indexOf("reparo")).filter((papel) => papel === "verifier")).toHaveLength(0);
    expect(calls.filter((call) => call.role === "verifier" && !call.repair)).toHaveLength(2);
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
    // Cada ação muda o código (informação nova para a estratégia seguinte), mas a suíte continua quebrada.
    let escrita = 0;
    const { outcome, calls } = await phase({
      maxCycles: 2,
      testRunner: async () => ({ exitCode: 1, output: "always broken" }),
      call: async (call) => {
        if (call.role === "builder" || call.repair) await writeFile(join(call.root ?? projectRoot, "tentativa.ts"), `export const n = ${++escrita};\n`);
        return ok();
      },
    });
    expect(outcome).toMatchObject({ status: "failed", cycles: 2 });
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
        if (call.repair) {
          repairs += 1;
          await writeFile(join(call.root ?? projectRoot, "seed.ts"), `reparo ${repairs}`);
        }
        // Cada reparo muda o código e a falha (progresso): a estratégia que progrediu continua.
        return ok(call.role === "verifier" && !call.repair
          // Progresso é o critério mudando (reduzido), não a mesma falha reescrita (spec §5.3).
          ? repairs === 2 ? done : repairs === 1 ? "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: the cancelled status row; OBSERVED: cancelled row still missing after seed rewrite" : guidance
          : "feito");
      },
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.filter((call) => call.repair)).toHaveLength(2);
    // O executor tenta antes do verificador (spec §6).
    expect(calls.filter((call) => call.role === "builder")).toHaveLength(2);
  });

  it("revalida todas as tasks após reparo sem cobrar nomes de testes planejados", async () => {
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
        // A correção do executor não resolve (spec §6: ele tenta primeiro); o reparo do verificador resolve.
        return ok(verifications <= 2 ? guidance : done);
      },
    });
    expect(outcome.status).toBe("complete");
    const checks = calls.filter((call) => call.role === "verifier" && !call.repair);
    // A aprovação de outro run, sem conteúdo conhecido, vai à consulta limitada (§125; spec §3.3).
    expect(checks[0]?.prompt).toContain("Previously approved — confirm against what changed");
    expect(checks[0]?.prompt).not.toContain("NAME NOT FOUND");
    // Depois do reparo do verificador, a aprovada volta à verificação, dirigida pelo que mudou (§125, §114).
    expect(checks[2]?.prompt).not.toContain("Already DONE");
    expect(checks[2]?.prompt).toContain("Previously approved — confirm against what changed");
    // Sem Git não há como listar o que mudou: o verificador é mandado ler o código atual.
    expect(checks[2]?.prompt).toContain("unknown (read the current code)");
    expect(checks[2]?.prompt).not.toContain("name found in the tree");
    expect(checks[2]?.prompt).toContain("Choose the smallest sufficient verification");
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
    // §125: depois do executor (sem mudança no código) o G4 roda de novo sozinho; depois do reparo, a suíte (o
    // ambiente pode ter mudado) e o G4. O G3 continua provado: o reparo não mudou o código das tasks.
    expect(g4).toHaveBeenCalledTimes(3);
    expect(calls.filter((call) => call.role === "verifier" && !call.repair)).toHaveLength(1);
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
