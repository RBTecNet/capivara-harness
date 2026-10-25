/**
 * BUILD vNext, checkpoint A (§125): a arquitetura do PLAN chega ao executor.
 *
 * O build lia da fase só o markdown dela e, do esqueleto, a Stack e as Regras.
 * Os componentes, contratos e dependências que o `plan` decidiu não chegavam a
 * quem implementa nem a quem verifica. Estes cenários exercitam o build de
 * verdade — git, plano publicado, carimbo do environment.json — e conferem o
 * que cada sessão recebeu, o que é recusado antes de qualquer chamada, e que
 * uma aprovação anterior não vale para uma fatia que ela não viu.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  architectureSliceForPhase,
  architectureViewForPhase,
  assemblePhasesDocument,
  checkArchitectureBinding,
  parseArchitecture,
  parseSkeleton,
  renderArchitecture,
  renderSkeleton,
  sha12,
  type Architecture,
  type Skeleton,
} from "../../src/contract/index.js";
import { runBuild, TasksAprovadas, tasksDaFase } from "../../src/loop/index.js";
import type { EngineCall, EngineResult } from "../../src/loop/index.js";
import { lerFasesFechadas } from "../../src/loop/ledger.js";
import { certifyCurrentPlan } from "../support/current-plan.js";
import { ARCHITECTURE, PHASE_1, PHASE_2, SKELETON } from "../support/fake-agent.js";

const run = promisify(execFile);
let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-vnext-arq-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function esqueleto(): Skeleton {
  const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
  if (!lido.ok) throw new Error("esqueleto inválido");
  return lido.skeleton;
}

function arquitetura(alterar?: (bruta: Record<string, unknown>) => void): Architecture {
  const bruta = JSON.parse(ARCHITECTURE) as Record<string, unknown>;
  alterar?.(bruta);
  const lida = parseArchitecture(JSON.stringify(bruta), esqueleto(), { maxTasksPerPhase: 15 });
  if (!lida.ok) throw new Error(JSON.stringify(lida.defects));
  return lida.architecture;
}

/** Publica esqueleto, arquitetura e plano como o `plan` publica, com o carimbo. */
async function publicar(arch: Architecture, opcoes: { carimbo?: string | null; documento?: string } = {}): Promise<string> {
  await run("git", ["init", "-q", "-b", "main"], { cwd: projectRoot });
  await run("git", ["config", "user.email", "t@t"], { cwd: projectRoot });
  await run("git", ["config", "user.name", "t"], { cwd: projectRoot });
  await writeFile(join(projectRoot, "README.md"), "inicial\n");
  await run("git", ["add", "-A"], { cwd: projectRoot });
  await run("git", ["commit", "-q", "-m", "inicial"], { cwd: projectRoot });
  const init = join(projectRoot, ".capivara", "init");
  await mkdir(init, { recursive: true });
  const sk = esqueleto();
  await writeFile(join(init, "skeleton.md"), renderSkeleton(sk));
  const documento = opcoes.documento ?? renderArchitecture(arch, sk);
  await writeFile(join(init, "architecture.md"), documento);
  const plan = assemblePhasesDocument({
    projectName: "Pousada",
    stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa architecture.md@sha256:bbbbbbbbbbbb -->",
    overview: "Fundação primeiro.",
    phases: [PHASE_1.trim(), PHASE_2.trim()],
    openQuestions: [],
  });
  await writeFile(join(init, "project-phases.md"), plan);
  const carimbo = opcoes.carimbo === undefined ? sha12(renderArchitecture(arch, sk)) : opcoes.carimbo;
  await certifyCurrentPlan(projectRoot, [], carimbo === null ? {} : { architectureSha12: carimbo });
  await run("git", ["add", "-A"], { cwd: projectRoot });
  await run("git", ["commit", "-q", "-m", "plano"], { cwd: projectRoot });
  return plan;
}

const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });

/**
 * O desfecho destes builds: as fases fecham, e os fluxos do esqueleto ficam sem
 * percurso (`--no-flows`), ditos como verificação inconclusiva (etapa 4 da redução).
 */
const ENTREGUE_SEM_FLUXOS = 3;

async function construir(arch: Architecture | null) {
  const calls: EngineCall[] = [];
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    architecture: arch,
    skeleton: esqueleto(),
    skipFlows: true,
    skipAcceptance: true,
    explicitTestCommand: "npm test",
    environment: {},
    sleep: async () => undefined,
    testRunner: async () => ({ exitCode: 0, output: "2 passed" }),
    call: async (call) => {
      calls.push(call);
      if (call.role === "builder") {
        await writeFile(join(call.root ?? projectRoot, `${call.phase.id}.ts`), `export const fase = "${call.phase.id}";\n`);
        return ok("CAPIVARA_BUILDER_STATUS: COMPLETE");
      }
      return ok(Array.from({ length: call.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"));
    },
  });
  return { outcome, calls };
}

describe("o vínculo entre a arquitetura estruturada e a publicada", () => {
  it("documento divergente do carimbo é erro; estruturada que não renderiza igual não vira fatia", () => {
    const arch = arquitetura();
    const sk = esqueleto();
    const publicado = renderArchitecture(arch, sk);
    const phases = [{ number: 1, title: "Fundação de dados" }, { number: 2, title: "Criar reserva" }];

    const certo = checkArchitectureBinding({ architecture: arch, published: publicado, declaredSha12: sha12(publicado), skeleton: sk, phases });
    expect(certo).toEqual({ errors: [], warnings: [], bound: [1, 2] });

    const editado = checkArchitectureBinding({ architecture: arch, published: `${publicado}\nlinha nova`, declaredSha12: sha12(publicado), skeleton: sk, phases });
    expect(editado.errors.join("\n")).toContain("não é o que o plan aprovou");
    expect(editado.bound).toEqual([]);

    const sumiu = checkArchitectureBinding({ architecture: arch, published: null, declaredSha12: sha12(publicado), skeleton: sk, phases });
    expect(sumiu.errors.join("\n")).toContain("não existe");

    const outra = arquitetura((bruta) => { (bruta.components as { contracts: string[] }[])[1]!.contracts.push("GET /reservas → 200 [..]"); });
    const velha = checkArchitectureBinding({ architecture: outra, published: publicado, declaredSha12: sha12(publicado), skeleton: sk, phases });
    expect(velha.errors).toEqual([]);
    expect(velha.bound).toEqual([]);
    expect(velha.warnings.join("\n")).toContain("não corresponde ao architecture.md publicado");
  });

  it("fase acrescentada depois da arquitetura e título divergente seguem sem fatia, ditos ao operador", () => {
    const arch = arquitetura();
    const sk = esqueleto();
    const publicado = renderArchitecture(arch, sk);
    const vinculo = checkArchitectureBinding({
      architecture: arch, published: publicado, declaredSha12: sha12(publicado), skeleton: sk,
      phases: [{ number: 1, title: "Fundação de dados" }, { number: 2, title: "Criar reserva (revisada)" }, { number: 3, title: "Editar a reserva" }],
    });
    expect(vinculo.bound).toEqual([1]);
    expect(vinculo.warnings.join("\n")).toContain("Phase 2 tem outro título");
    expect(vinculo.warnings.join("\n")).toContain("Phase 3 não está na arquitetura");
  });

  it("sem carimbo e sem estruturada, o build antigo segue sem erro (compatível com planos sem arquitetura)", () => {
    expect(checkArchitectureBinding({ architecture: null, published: null, declaredSha12: null, skeleton: null, phases: [] }))
      .toEqual({ errors: [], warnings: [], bound: [] });
  });

  it("a visão estruturada é a mesma escolha que a fatia em markdown", () => {
    const arch = arquitetura();
    const visao = architectureViewForPhase(arch, 2)!;
    expect(visao.own.map((c) => c.name)).toEqual(["api"]);
    expect(visao.consumed.map((c) => c.name)).toEqual(["dados"]);
    expect(visao.flows.map((f) => f.workflow)).toEqual(["1"]);
    expect(architectureViewForPhase(arch, 9)).toBeNull();
    expect(architectureSliceForPhase(arch, 2)).toContain("### dados (fase 1)");
  });
});

describe("a fatia chega a quem implementa e a quem verifica", () => {
  it("executor e verificador recebem os contratos próprios e os consumidos, sem perder o contrato compartilhado", async () => {
    const arch = arquitetura();
    await publicar(arch);
    const { outcome, calls } = await construir(arch);
    expect(outcome.exitCode, outcome.errors.join("\n")).toBe(ENTREGUE_SEM_FLUXOS);

    const builderP2 = calls.find((c) => c.role === "builder" && c.phase.id === "P02")!;
    const verifierP2 = calls.find((c) => c.role === "verifier" && c.phase.id === "P02")!;
    for (const prompt of [builderP2.prompt, verifierP2.prompt]) {
      expect(prompt).toContain("## Architecture decided by the plan for this phase");
      expect(prompt).toContain("POST /reservas com datas sobrepostas → 409");
      expect(prompt).toContain("Componentes de que esta fase depende — contratos a consumir, nunca a reescrever");
      expect(prompt).toContain("módulo db: query(sql, params) → linhas");
      expect(prompt).toContain("## Published shared contracts");
    }
    expect(builderP2.prompt).toContain("never rewrite, rename or redesign them");
    expect(verifierP2.prompt).toContain("Confront the acceptance criteria AND this architecture slice");
    expect(builderP2.prompt).toContain(".capivara/init/architecture.md");
    // A fase 1 recebe a fatia dela, não a da 2.
    const builderP1 = calls.find((c) => c.role === "builder" && c.phase.id === "P01")!;
    expect(builderP1.prompt).toContain("### dados");
    expect(builderP1.prompt).not.toContain("POST /reservas → 201 {id}");
  });

  it("architecture.md alterado depois do RALPH READY para o build antes de qualquer chamada", async () => {
    const arch = arquitetura();
    const sk = esqueleto();
    await publicar(arch, { documento: `${renderArchitecture(arch, sk)}\n- decisão editada à mão\n` });
    const { outcome, calls } = await construir(arch);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.errors.join("\n")).toContain("não é o que o plan aprovou");
    expect(calls).toHaveLength(0);
  });

  it("estruturada ausente: nenhuma fatia, e o executor é mandado ler architecture.md", async () => {
    await publicar(arquitetura());
    const notices: string[] = [];
    const calls: EngineCall[] = [];
    const outcome = await runBuild({
      projectRoot, language: "português do Brasil", engine: "codex", architecture: null, skeleton: esqueleto(),
      skipFlows: true, skipAcceptance: true, explicitTestCommand: "npm test", environment: {}, sleep: async () => undefined,
      announce: (line) => notices.push(line),
      testRunner: async () => ({ exitCode: 0, output: "ok" }),
      call: async (call) => {
        calls.push(call);
        if (call.role === "builder") { await writeFile(join(projectRoot, `${call.phase.id}.ts`), "x\n"); return ok("feito"); }
        return ok(Array.from({ length: call.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"));
      },
    });
    expect(outcome.exitCode).toBe(ENTREGUE_SEM_FLUXOS);
    expect(notices.join("\n")).toContain("a forma estruturada da arquitetura não está disponível");
    expect(calls.every((c) => !c.prompt.includes("## Architecture decided by the plan for this phase"))).toBe(true);
    expect(calls.find((c) => c.role === "builder")!.prompt).toContain(".capivara/init/architecture.md");
  });
});

describe("aprovação anterior não vale para uma fatia que ela não viu (§13 item 14)", () => {
  it.each(["mesmo run", "plano recarimbado"] as const)("fase fechada com o mesmo texto é refeita quando a fatia dela mudou; a outra continua pulada (%s)", async (variante) => {
    const arch = arquitetura();
    await publicar(arch);
    const primeiro = await construir(arch);
    expect(primeiro.outcome.exitCode).toBe(ENTREGUE_SEM_FLUXOS);
    const fechadas = await lerFasesFechadas(projectRoot);
    expect(fechadas.map((f) => [f.id, typeof f.sliceSha12])).toEqual([["P01", "string"], ["P02", "string"]]);

    // O plan revisa o contrato da api (fase 2); o texto das fases não muda.
    const revisada = arquitetura((bruta) => { (bruta.components as { contracts: string[] }[])[1]!.contracts.push("GET /reservas/:id → 200 {id, status}"); });
    const sk = esqueleto();
    const init = join(projectRoot, ".capivara", "init");
    await writeFile(join(init, "architecture.md"), renderArchitecture(revisada, sk));
    if (variante === "plano recarimbado") {
      // O caminho real: o plan republica o plano com o carimbo da arquitetura nova, e o run do build é outro.
      const planoPath = join(init, "project-phases.md");
      const plano = await readFile(planoPath, "utf8");
      await writeFile(planoPath, plano.replace("architecture.md@sha256:bbbbbbbbbbbb", "architecture.md@sha256:cccccccccccc"));
    }
    await certifyCurrentPlan(projectRoot, [], { architectureSha12: sha12(renderArchitecture(revisada, sk)) });
    await run("git", ["add", "-A"], { cwd: projectRoot });
    await run("git", ["commit", "-q", "-m", "arquitetura revisada"], { cwd: projectRoot });

    const segundo = await construir(revisada);
    expect(segundo.outcome.exitCode, segundo.outcome.errors.join("\n")).toBe(ENTREGUE_SEM_FLUXOS);
    expect(segundo.outcome.runId === primeiro.outcome.runId).toBe(variante === "mesmo run");
    // Só a P02 volta, e volta para ser VERIFICADA contra o contrato novo — sem sessão de implementação (§125).
    expect(segundo.calls.filter((c) => c.role === "builder")).toEqual([]);
    const verificadas = segundo.calls.filter((c) => c.role === "verifier").map((c) => c.phase.id);
    expect(verificadas).toEqual(["P02"]);
    expect(segundo.calls.find((c) => c.role === "verifier")!.prompt).toContain("GET /reservas/:id → 200 {id, status}");
  });

  it("a identidade da fatia é o que a fase entrega e consome: infraestrutura e visão geral não reabrem fase", async () => {
    const { vincularArquitetura } = await import("../../src/loop/arquitetura.js");
    const sk = esqueleto();
    const plan = assemblePhasesDocument({ projectName: "Pousada", stamp: "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", overview: "x", phases: [PHASE_1.trim(), PHASE_2.trim()], openQuestions: [] });
    const fatiasDe = async (arch: Architecture) => {
      await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
      await writeFile(join(projectRoot, ".capivara", "init", "architecture.md"), renderArchitecture(arch, sk));
      const vinculo = await vincularArquitetura(projectRoot, plan, arch, sk);
      return [vinculo.fatia(1)!.sha12, vinculo.fatia(2)!.sha12];
    };
    const [p1, p2] = await fatiasDe(arquitetura());
    const [q1, q2] = await fatiasDe(arquitetura((bruta) => {
      bruta.overview = "Outra visão geral, mesma divisão de componentes.";
      (bruta.infrastructure as { compatibility: string[] }).compatibility.push("Linux x64");
    }));
    expect([q1, q2]).toEqual([p1, p2]);
    // Mudar o contrato do componente de dados muda a fatia da fase 1 E a da fase 2, que o consome.
    const [r1, r2] = await fatiasDe(arquitetura((bruta) => { (bruta.components as { contracts: string[] }[])[0]!.contracts.push("módulo db: transacao(fn)"); }));
    expect(r1).not.toBe(p1);
    expect(r2).not.toBe(p2);
  });

  it("a task aprovada com uma fatia volta à verificação com outra; registro antigo sem fatia vale pelo texto", async () => {
    const tarefas = tasksDaFase(PHASE_2);
    const registro = await TasksAprovadas.abrir(projectRoot, "build-x");
    await registro.aprovar("P02", tarefas, [1], 1, () => new Date(), "fatiaA00000");
    expect(registro.jaAprovadas("P02", tarefas, "fatiaA00000").map((t) => t.index)).toEqual([1]);
    expect(registro.jaAprovadas("P02", tarefas, "fatiaB00000")).toEqual([]);
    // Fatia que hoje não se comprova: a aprovação dada sob uma fatia não vale como atual.
    expect(registro.jaAprovadas("P02", tarefas, undefined)).toEqual([]);

    await mkdir(join(projectRoot, ".capivara", "handoffs"), { recursive: true });
    const legado = [{ phase: "P02", index: 1, sha: (await import("../../src/loop/veredictos.js")).shaDaTask(tarefas[0]!), title: "x", runId: "build-velho", cycle: 1, at: "2026-01-01T00:00:00.000Z" }];
    await writeFile(join(projectRoot, ".capivara", "handoffs", "tasks.json"), JSON.stringify(legado));
    const reaberto = await TasksAprovadas.abrir(projectRoot, "build-y");
    expect(reaberto.jaAprovadas("P02", tarefas, "fatiaB00000").map((t) => t.index)).toEqual([1]);
    const emDisco = JSON.parse(await readFile(join(projectRoot, ".capivara", "handoffs", "tasks.json"), "utf8")) as unknown[];
    expect(emDisco).toHaveLength(1);
  });
});
