/**
 * BUILD vNext (§125): os defeitos que a revisão adversarial do C/D/E achou e
 * reproduziu, cada um como regressão. Mesma infraestrutura dos cenários do
 * §13: runner de verdade, Git real, provider falso que escreve no disco.
 *
 * Os cenários de laço têm teto no próprio teste: um gate chamado além dele
 * lança, para o laço aparecer como falha e não como teste pendurado.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPhase, splitPhases, TasksAprovadas, tasksDaFase } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseRunOptions, PhaseSession } from "../../src/loop/index.js";
import * as flowGates from "../../src/loop/flows.js";
import * as gates from "../../src/loop/gates.js";
import { emptyScope, LivroDeEvidencias } from "../../src/loop/evidencias.js";
import { estadoDoCodigo } from "../../src/loop/git.js";
import { defeitosDoRun, mesmoDefeito, RegistroDeDefeitos, type EstadoDaRecuperacao } from "../../src/loop/defeitos.js";
import { resolveTestCommand } from "../../src/loop/testcmd.js";
import { runPaths } from "../../src/state/index.js";

const run = promisify(execFile);
const RUN = "build-revisao0000000";
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-vnext-rev-"));
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "t@t"], { cwd: root });
  await run("git", ["config", "user.name", "t"], { cwd: root });
  await writeFile(join(root, ".gitignore"), "node_modules/\n.capivara/runs/\n.capivara/handoffs/\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 0;\n");
  await writeFile(join(root, "src", "b.ts"), "export const b = 0;\n");
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-q", "-m", "base"], { cwd: root });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const PLANO = `# Reservas — Project Phases

<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->

## Overview

Fase única.

---

## Phase 1: Reservas

**Goal:** criar e listar reservas · **Depends on:** none · **Covers:** reservations, workflow 1

- [ ] **Task:** Implementar a criação em \`src/a.ts\`
  - **Acceptance criteria:**
    - A criação devolve 201
  - **Traces:** reservations, workflow 1

- [ ] **Task:** Implementar a listagem em \`src/b.ts\`
  - **Acceptance criteria:**
    - A listagem devolve as reservas
  - **Traces:** reservations

## Open Questions

Nenhuma.
`;

function sessao(runId = RUN): PhaseSession {
  const split = splitPhases(PLANO, root, runId);
  if (!split.ok) throw new Error(JSON.stringify(split.errors));
  return split.sessions[0]!;
}

const ok = (stdout = "feito", extra: Partial<EngineResult> = {}): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null, ...extra });
const DONE = "TASK 1: DONE\nTASK 2: DONE";
const FLUXOS = { workflows: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" };

async function fase(call: (chamada: EngineCall) => Promise<EngineResult>, extra: Partial<PhaseRunOptions> = {}, runId = RUN) {
  const calls: EngineCall[] = [];
  const notices: string[] = [];
  let suites = 0;
  const outcome = await runPhase({
    projectRoot: root, runId, language: "pt-BR", engine: "codex", session: sessao(runId),
    testCommand: { command: "npm test", source: "teste", containerized: false },
    commitsEnabled: false, maxCycles: 3, sleep: async () => undefined,
    announce: (linha) => notices.push(linha),
    ...extra,
    testRunner: async (...args) => {
      suites += 1;
      return extra.testRunner ? extra.testRunner(...args) : { exitCode: 0, output: "2 passed" };
    },
    call: async (chamada) => {
      calls.push(chamada);
      return call(chamada);
    },
  });
  return { outcome, calls, notices, suites: () => suites };
}

const escrever = (caminho: string, conteudo: string): Promise<void> => writeFile(join(root, caminho), conteudo);
const defeitos = async (runId = RUN): Promise<EstadoDaRecuperacao> =>
  JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, runId).root), "P01.json"), "utf8")) as EstadoDaRecuperacao;
const leituras = (calls: readonly EngineCall[]) => calls.filter((chamada) => chamada.role === "verifier" && !chamada.repair && !chamada.purpose);

/** Um gate com teto: além dele, lança — o laço vira falha visível. */
function comTeto<T extends (...args: never[]) => unknown>(original: T, teto: number, nome: string): { fn: T; chamadas: () => number } {
  let chamadas = 0;
  const fn = (async (...args: Parameters<T>) => {
    chamadas += 1;
    if (chamadas > teto) throw new Error(`LAÇO: ${nome} chamado ${chamadas} vezes`);
    return original(...args);
  }) as unknown as T;
  return { fn, chamadas: () => chamadas };
}

describe("laços que a revisão achou", () => {
  it("regressão sem roteiro no disco: o próprio G4 decide que não há o que percorrer, e a fase fecha", async () => {
    const g4 = comTeto(flowGates.gate4, 4, "gate4");
    vi.spyOn(flowGates, "gate4").mockImplementation(g4.fn);
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 1;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, { flows: { workflows: [], regressao: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" } });
    expect(outcome.status).toBe("complete");
    expect(g4.chamadas()).toBe(1);
  });

  it("o comando de teste que some depois da suíte vermelha não conserta nada: a fase para, sem laço", async () => {
    await escrever("package.json", JSON.stringify({ name: "x", scripts: { test: "node t.js" } }));
    await run("git", ["add", "-A"], { cwd: root });
    await run("git", ["commit", "-q", "-m", "pkg"], { cwd: root });
    const g2 = comTeto(gates.gate2, 8, "gate2");
    vi.spyOn(gates, "gate2").mockImplementation(g2.fn);
    const { outcome } = await fase(async (chamada) => {
      // O reparo "resolve" apagando o script de teste.
      if (chamada.repair) {
        await escrever("package.json", JSON.stringify({ name: "x", scripts: { build: "tsc" } }));
        return ok("reparado");
      }
      if (chamada.role === "builder") await escrever("src/a.ts", `export const a = ${chamada.attempt};\n`);
      return ok(DONE);
    }, {
      maxVerifierRepairs: 1,
      resolveTest: () => resolveTestCommand(root),
      testRunner: async () => ({ exitCode: 1, output: "FAIL src/a.test.ts > cria\n1 failed" }),
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.cause).toContain("deixou de declarar o comando de teste");
  });
});

describe("identidade e escada", () => {
  it("roteiro errado e produto errado no mesmo fluxo são defeitos distintos, cada um com a sua escada", async () => {
    let passagem = 0;
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => {
      passagem += 1;
      if (passagem === 1) return { green: false, cause: "o roteiro procura um seletor que não existe", scriptFailed: true, falharam: ["1"] } as never;
      if (passagem === 2) {
        return {
          green: false, cause: "o produto não salva a reserva", falharam: ["1"],
          triagem: { tipo: "PRODUTO", evidencia: "o botão salvar não faz nada", onde: "src/a.ts", criterio: "A criação devolve 201", correcao: "ligar o salvar" },
        } as never;
      }
      return { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] } as never;
    });
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", `export const a = ${chamada.attempt};\n`);
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, { flows: FLUXOS });
    expect(outcome.status).toBe("complete");
    const estado = await defeitos();
    const doFluxo = estado.defects.filter((defeito) => defeito.anchors.workflow === "1");
    expect(doFluxo.map((defeito) => defeito.nature)).toEqual(["fluxo-roteiro", "fluxo-produto"]);
    expect(doFluxo[0]!.attempts.map((tentativa) => tentativa.strategy)).toEqual(["roteiro"]);
    expect(doFluxo[1]!.attempts.map((tentativa) => tentativa.strategy)).toEqual(["executor"]);
    expect(doFluxo.every((defeito) => defeito.status === "RESOLVED")).toBe(true);
  });

  it("a falha da árvore integrada nunca casa com a suíte que o worktree já resolveu", () => {
    const resolvida = {
      defectId: "P01-D1", nature: "suite", status: "RESOLVED", gates: ["G2"], anchors: { tests: ["src/c.test.ts > integra"], signature: "x" },
    } as unknown as Parameters<typeof mesmoDefeito>[0];
    expect(mesmoDefeito(resolvida, { gate: "G2", nature: "integracao-teste", anchors: { tests: ["src/c.test.ts > integra"] }, summary: "", detail: "" })).toBe(false);
  });

  it("a mesma falha reescrita em outras palavras não é progresso: o reparo do verificador chega", async () => {
    const frases = ["a listagem devolve 500", "listar reservas retorna erro HTTP 500", "o endpoint de listagem falha com status 500", "GET /reservas responde 500"];
    let v = 0;
    const { calls } = await fase(async (chamada) => {
      if (chamada.repair) return ok("reparado");
      if (chamada.role === "builder") await escrever("src/b.ts", `export const b = ${chamada.attempt};\n`);
      if (chamada.role === "builder") return ok();
      return ok(`TASK 1: DONE\nTASK 2: INCOMPLETE — ${frases[v++ % frases.length]}`);
    }, { maxVerifierRepairs: 1, maxCycles: 1 });
    // Executor primeiro; a mesma falha (reescrita) bloqueia o executor no ciclo, e o verificador que diagnosticou assume.
    expect(calls.filter((chamada) => chamada.repair)).toHaveLength(1);
    const tentativa = (await defeitos()).defects[0]!.attempts[0]!;
    expect(tentativa).toMatchObject({ strategy: "executor", result: "no-progress" });
  });

  it("o defeito que outra ação consertou é resolvido quando o gate dele passa, e não recebe reparo próprio", async () => {
    let g4 = 0;
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => {
      g4 += 1;
      return (g4 === 1 ? { green: false, cause: "fluxo 1: o botão salvar não responde", falharam: ["1"] } : { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] }) as never;
    });
    let consertado = false;
    const reparos: string[] = [];
    await fase(async (chamada) => {
      if (chamada.repair) {
        reparos.push(chamada.prompt.match(/### (P01-D\d+)/u)?.[1] ?? "?");
        consertado = true;
        await escrever("src/b.ts", `export const b = 'r${reparos.length}';\n`);
        return ok("reparado");
      }
      if (chamada.role === "builder") await escrever("src/a.ts", `export const a = ${chamada.attempt};\n`);
      if (chamada.role === "builder") return ok();
      return ok(consertado ? DONE : "TASK 1: INCOMPLETE — CRITERION: a criação devolve 500\nTASK 2: INCOMPLETE — CRITERION: a listagem devolve vazio");
    }, { maxVerifierRepairs: 2, flows: FLUXOS });
    expect(reparos).toHaveLength(1);
    const estado = await defeitos();
    expect(estado.defects.filter((defeito) => defeito.gates.includes("G3")).every((defeito) => defeito.status === "RESOLVED")).toBe(true);
  });
});

describe("orçamento e retomada", () => {
  it("a recuperação da integração tem janela própria: o que a fase gastou no worktree não a recusa", async () => {
    let suites = 0;
    const primeira = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", `export const a = ${chamada.attempt};\n`);
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, {
      testRunner: async () => {
        suites += 1;
        if (suites === 1) return { exitCode: 1, output: "FAIL src/a.test.ts > cria\nAssertionError: expected 'zero' to be 'um'\n1 failed" };
        if (suites === 2) return { exitCode: 1, output: "FAIL src/a.test.ts > lista\nTypeError: lista is not a function\n1 failed" };
        return { exitCode: 0, output: "2 passed" };
      },
    });
    expect(primeira.outcome.status).toBe("complete");
    const segunda = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/b.ts", "export const b = 'integrado';\n");
      return ok(chamada.role === "verifier" ? "CAUSE: artefato\nFIX: pretest\nCHECK: npm test" : "feito");
    }, { integrationFailure: { cause: "FAIL src/c.test.ts > integra\nError: MISSING_WEB_DIST", attempt: 1, repairByVerifier: false, repairBudget: { used: 0 } } });
    expect(segunda.calls.some((chamada) => chamada.role === "builder")).toBe(true);
  });

  it("a ação que outra execução deixou pela metade volta a ser planejável, e não conta como sem progresso", async () => {
    const r = await RegistroDeDefeitos.abrir(runPaths(root, RUN).root, RUN, "P01");
    const d = r.registrar({ gate: "G3", nature: "task", anchors: { task: 1 }, summary: "x", detail: "x" }).defeito;
    r.consumir({ estrategia: "executor", defeitos: [d] }, { role: "builder", attempt: 2 });
    await r.salvar();
    const reaberto = await RegistroDeDefeitos.abrir(runPaths(root, RUN).root, RUN, "P01");
    const depois = reaberto.porId(d.defectId)!;
    expect(depois.status).toBe("OPEN");
    expect(depois.attempts.map((tentativa) => tentativa.result)).toEqual(["interrupted"]);
    expect(depois.failedStrategies).toEqual([]);
    expect(reaberto.planejar({ ciclos: 3, porCiclo: 6, porGate: 2, porDefeito: 3, reparosDoVerificador: 0 }, () => true)?.defeitos).toEqual([depois]);
  });

  it("a implementação que caiu por cota não é implementação feita: a retomada a refaz", async () => {
    const primeira = await fase(async (chamada) => {
      if (chamada.role === "builder") return ok("You've hit your usage limit", { exitCode: 1, engineError: true, providerFailure: "quota" });
      return ok(DONE);
    });
    expect(primeira.outcome.status).toBe("failed");
    expect((await defeitos()).implementation).not.toBe("done");
    const segunda = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 1;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    });
    expect(segunda.calls[0]!.role).toBe("builder");
    expect(segunda.calls[0]!.prompt).toContain("Implement the phase below COMPLETELY");
  });

  it("o parcial descartado como a parada oferece faz a fase recomeçar do zero", async () => {
    await fase(async (chamada) => {
      if (chamada.role === "builder") {
        await escrever("src/a.ts", "export const a = 'criacao';\n");
        await escrever("src/novo.ts", "export const n = 1;\n");
        return ok();
      }
      return ok("TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: a listagem; OBSERVED: vazio; EXPECTED: as reservas");
    }, { maxCycles: 1 });
    await run("git", ["checkout", "--", "."], { cwd: root });
    await run("git", ["clean", "-fd", "-e", ".capivara"], { cwd: root });
    const segunda = await fase(async (chamada) => ok(chamada.role === "verifier" ? DONE : "feito"), { maxCycles: 1 });
    const primeira = segunda.calls.find((chamada) => chamada.role === "builder")!;
    expect(primeira.prompt).toContain("Implement the phase below COMPLETELY");
  });

  it("--rebuild-all arquiva os handoffs junto: o defeito novo não herda o diagnóstico de outro", async () => {
    const runRoot = runPaths(root, RUN).root;
    await mkdir(join(defeitosDoRun(runRoot), "P01", "P01-D1"), { recursive: true });
    await writeFile(join(defeitosDoRun(runRoot), "P01", "P01-D1", "handoff-G3-c1.json"), "{}");
    await (await RegistroDeDefeitos.abrir(runRoot, RUN, "P01")).salvar();
    await RegistroDeDefeitos.abrir(runRoot, RUN, "P01", () => new Date("2026-10-21T00:00:00Z"), true);
    const nomes = await readdir(defeitosDoRun(runRoot));
    expect(nomes).not.toContain("P01");
    expect(nomes).toContain("P01.2026-10-21T00-00-00-000Z");
  });
});

describe("prova que não se sustenta não aprova", () => {
  it("a regra do esqueleto revisada torna desconhecida a aprovação de outro run: o verificador é chamado", async () => {
    await mkdir(join(root, ".capivara", "init"), { recursive: true });
    await escrever(".capivara/init/skeleton.md", "# Esqueleto\n\n## Regras\n\n- Uma reserva só é criada com pagamento confirmado.\n");
    const aprovadas = await TasksAprovadas.abrir(root, RUN);
    const primeira = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 1;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, { aprovadas });
    expect(primeira.outcome.status).toBe("complete");
    // O INIT revisa uma regra que o verificador usa; o código não muda. Um run novo, com o cache de aprovações do projeto.
    await escrever(".capivara/init/skeleton.md", "# Esqueleto\n\n## Regras\n\n- Uma reserva é criada SEM pagamento; o pagamento é posterior.\n");
    const outro = "build-revisao1111111";
    const segunda = await fase(async (chamada) => ok(chamada.role === "verifier" ? DONE : "feito"), { aprovadas: await TasksAprovadas.abrir(root, outro) }, outro);
    expect(segunda.outcome.status).toBe("complete");
    expect(leituras(segunda.calls)).toHaveLength(1);
    expect(leituras(segunda.calls)[0]!.prompt).not.toContain("Already DONE — not under verification now");
  });

  it("a aprovação dada sem fatia não vale sob uma fatia que apareça depois", async () => {
    const aprovadas = await TasksAprovadas.abrir(root, RUN);
    const tasks = tasksDaFase(sessao().markdown);
    await aprovadas.aprovar("P01", tasks, [1], 1, () => new Date(), "", "arvore");
    expect(aprovadas.aprovacao("P01", tasks[0]!, undefined)).not.toBeNull();
    expect(aprovadas.aprovacao("P01", tasks[0]!, "abcdefabcdef")).toBeNull();
  });

  it("o arquivo que já existia e nenhum commit de fase escreveu não é dado como fora do fluxo", async () => {
    // O fluxo 1 passou contra este conteúdo; lib/app.ts existe desde um commit sem fase autora (estado inicial, wip).
    await mkdir(join(root, "lib"), { recursive: true });
    await escrever("lib/app.ts", "export const montarRotas = () => [];\n");
    await run("git", ["add", "-A"], { cwd: root });
    await run("git", ["commit", "-q", "-m", "chore: estado inicial"], { cwd: root });
    const livro = await LivroDeEvidencias.abrir(runPaths(root, RUN).root, RUN);
    await livro.registrar({
      phaseId: "P00", gate: "G4", checkId: "fluxo-1", claim: "o fluxo 1 passa", outcome: "PASS",
      inputs: { documents: [{ name: "roteiro-1", sha12: "e3b0c44298fc" }], code: await estadoDoCodigo(root) }, scope: emptyScope({ flows: ["1"] }), supports: [], artifactRefs: [],
    });
    const gate4 = vi.spyOn(flowGates, "gate4").mockResolvedValue({ green: true, skipped: "", scripts: ["workflow-1.spec.ts"] } as never);
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("lib/app.ts", "export const montarRotas = () => ['mexido'];\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, {
      evidencias: livro,
      flows: { workflows: [], regressao: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" },
      // O mapa diz "fora" para tudo que nenhum commit de fase escreveu — atribuído à fase corrente.
      territorioDoFluxo: () => ({ componentes: ["cadastro"], arquivos: ["src/a.ts"], commitados: [], classificar: (arquivo) => (arquivo === "src/a.ts" ? "dentro" : "fora") }),
    });
    expect(outcome.status).toBe("complete");
    expect(gate4).toHaveBeenCalledOnce();
  });

  it("o custo de cada ação vai aos defeitos dela", async () => {
    let v = 0;
    await fase(async (chamada) => {
      if (chamada.role === "builder") {
        await escrever("src/b.ts", `export const b = ${chamada.attempt};\n`);
        return ok("feito", { usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.25 } });
      }
      v += 1;
      return ok(v === 1 ? "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: a listagem" : DONE);
    });
    const [defeito] = (await defeitos()).defects;
    expect(defeito!.costs.calls).toBe(1);
    expect(defeito!.costs.costUsd).toBeCloseTo(0.25);
    expect(defeito!.evidence.length).toBeGreaterThan(0);
  });
});
