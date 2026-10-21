/**
 * BUILD vNext, checkpoints C, D e E (§125): revalidação seletiva, G4
 * condicional, defeitos com identidade e orçamento, ciclos que preservam
 * estado, handoff do verificador e retomada de sessão com fallback.
 *
 * São os cenários 1 a 10 da seção 13 da especificação, contra o runner de
 * verdade: Git real (o estado do código é conteúdo), provider falso que
 * escreve no disco, e o que fica persistido — eventos, evidências, defeitos,
 * handoffs — lido do plano de controle como qualquer leitor leria.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPhase, splitPhases } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseRunOptions, PhaseSession } from "../../src/loop/index.js";
import * as flowGates from "../../src/loop/flows.js";
import { LivroDeEvidencias, emptyScope, evidenciasDoRun } from "../../src/loop/evidencias.js";
import { estadoDoCodigo } from "../../src/loop/git.js";
import { defeitosDoRun, type EstadoDaRecuperacao } from "../../src/loop/defeitos.js";
import { lerTransicoes } from "../../src/loop/narrador.js";
import { readEvents, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";

const run = promisify(execFile);
const RUN = "build-vnext00000000";
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-vnext-rec-"));
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

function sessao(): PhaseSession {
  const split = splitPhases(PLANO, root, RUN);
  if (!split.ok) throw new Error(JSON.stringify(split.errors));
  return split.sessions[0]!;
}

const ok = (stdout = "feito", extra: Partial<EngineResult> = {}): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null, ...extra });
const DONE = "TASK 1: DONE\nTASK 2: DONE";

async function fase(call: (chamada: EngineCall) => Promise<EngineResult>, extra: Partial<PhaseRunOptions> = {}) {
  const calls: EngineCall[] = [];
  const notices: string[] = [];
  let suites = 0;
  const outcome = await runPhase({
    projectRoot: root, runId: RUN, language: "pt-BR", engine: "codex", session: sessao(),
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

async function escrever(caminho: string, conteudo: string): Promise<void> {
  await writeFile(join(root, caminho), conteudo);
}

async function evidencias() {
  return LivroDeEvidencias.abrir(runPaths(root, RUN).root, RUN);
}

async function defeitos(): Promise<EstadoDaRecuperacao> {
  return JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), "utf8")) as EstadoDaRecuperacao;
}

describe("§13.1 · a mudança localizada invalida só a evidência associada", () => {
  it("o reparo de b.ts invalida a suíte e deixa a prova da task de a.ts de pé, dita ao verificador", async () => {
    let verificacoes = 0;
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) {
          await escrever("src/a.ts", "export const a = 1;\n");
          await escrever("src/b.ts", "export const b = 'faltando';\n");
        } else {
          await escrever("src/b.ts", "export const b = 2;\n");
        }
        return ok();
      }
      verificacoes += 1;
      return ok(verificacoes === 1 ? "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: a listagem; OBSERVED: src/b.ts devolve 'faltando'; EXPECTED: as reservas; FIX: corrigir src/b.ts" : DONE);
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    const livro = await evidencias();
    const historico = livro.historico();
    const primeiraDaTask1 = historico.find((evidencia) => evidencia.checkId === "task-1")!;
    // A task 1 cita só src/a.ts: a mudança em src/b.ts não a atinge de forma demonstrável (fica desconhecida, nunca invalidada).
    expect(livro.validadeDe(primeiraDaTask1.evidenceId)?.state).not.toBe("VALID");
    const primeiraDaSuite = historico.find((evidencia) => evidencia.checkId === "suite")!;
    expect(livro.validadeDe(primeiraDaSuite.evidenceId)).toMatchObject({ state: "INVALIDATED" });
    // A segunda leitura do verificador recebe a task 1 como aprovada, com o arquivo que mudou desde então.
    const segunda = calls.filter((chamada) => chamada.role === "verifier")[1]!;
    // Desconhecido nunca é aprovado em silêncio: a task 1 vai à consulta limitada, com o que mudou.
    expect(segunda.prompt).toContain("Previously approved — confirm against what changed");
    expect(segunda.prompt).toContain("changed since: src/b.ts");
    expect(segunda.prompt).not.toContain("Already DONE — not under verification now");
  });

  it("o mesmo conteúdo reaproveita a prova: a correção que não muda nada não roda a suíte de novo", async () => {
    let verificacoes = 0;
    const { outcome, suites } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) await escrever("src/a.ts", "export const a = 1;\n");
        return ok();
      }
      verificacoes += 1;
      return ok(verificacoes === 1 ? "TASK 1: DONE\nTASK 2: INCOMPLETE — falso positivo" : DONE);
    });
    expect(outcome.status).toBe("complete");
    expect(suites()).toBe(1);
    const transicoes = await lerTransicoes(root, RUN);
    expect(transicoes.some((transicao) => transicao.linha.startsWith("evidência preservada") && transicao.linha.includes("suite"))).toBe(true);
  });
});

describe("§13.2 · mudança só no roteiro do G4 não refaz o G2", () => {
  it("numa nova execução, só o G4 roda: suíte e verificação continuam provadas para o mesmo conteúdo", async () => {
    let passou = false;
    const g4 = vi.spyOn(flowGates, "gate4").mockImplementation(async () =>
      passou
        ? { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] }
        : { green: false, cause: "o roteiro procura um seletor que não existe", scriptFailed: true, falharam: ["1"] });
    const fluxos = { workflows: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" };
    const roteiro = join(root, ".capivara", "flows", "workflow-1.spec.ts");
    await mkdir(join(root, ".capivara", "flows"), { recursive: true });
    await writeFile(roteiro, "// roteiro v1\n");
    const primeira = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 1;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, { flows: fluxos, maxCycles: 1 });
    expect(primeira.outcome.status).toBe("failed");
    expect(primeira.suites()).toBe(1);

    // O roteiro foi corrigido fora do código do produto (.capivara/flows): o conteúdo do produto é o mesmo.
    await writeFile(roteiro, "// roteiro v2, corrigido\n");
    passou = true;
    const segunda = await fase(async (chamada) => ok(chamada.role === "verifier" ? DONE : "feito"), { flows: fluxos });
    expect(segunda.outcome.status).toBe("complete");
    expect(segunda.suites()).toBe(0);
    expect(segunda.calls).toHaveLength(0);
    expect(g4.mock.calls.length).toBeGreaterThanOrEqual(3);
    // A prova nova do G4 é do roteiro novo; a do G2 continua a de antes.
    const livro = await evidencias();
    expect(livro.atual("P01", "fluxos")?.evidence.inputs.documents).toContainEqual({ name: "roteiro-1", sha12: sha12("// roteiro v2, corrigido\n") });
    expect(livro.historico().filter((evidencia) => evidencia.checkId === "suite")).toHaveLength(1);
  });
});

describe("§13.3 · depois do G3, impacto só em G0 não reprisa G1–G3", () => {
  it("a revisão do G4 que cai ganha uma sessão nova e o G4 continua, sem nova suíte nem nova verificação", async () => {
    let autores = 0;
    vi.spyOn(flowGates, "gate4").mockImplementation(async (opcoes) => {
      const workflow = opcoes.workflows[0]!;
      await opcoes.author(workflow, [], "http://127.0.0.1:1", { anteriores: [], bancoNovo: [], migracao: null, ajudante: "x" });
      return { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] };
    });
    const { outcome, calls, suites } = await fase(async (chamada) => {
      if (chamada.purpose === "flow-author") {
        autores += 1;
        return autores === 1 ? ok("", { exitCode: 124, timedOut: "wall" }) : ok("```ts\n// roteiro\n```");
      }
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 1;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, { flows: { workflows: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" } });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(autores).toBe(2);
    expect(suites()).toBe(1);
    expect(calls.filter((chamada) => chamada.role === "verifier" && !chamada.purpose)).toHaveLength(1);
    expect(calls.filter((chamada) => chamada.role === "builder")).toHaveLength(1);
  });
});

describe("§13.4 · G4 NOT_APPLICABLE não sobe nada", () => {
  it("sem fluxos e sem regressão: nem porta, nem servidor, nem navegador, nem roteirista", async () => {
    const gate4 = vi.spyOn(flowGates, "gate4");
    const resolveStart = vi.fn(async () => "npm start");
    const runner = vi.fn(async () => ({ exitCode: 0, output: "" }));
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 1;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, { flows: { workflows: [], regressao: [], resolveStart, runner } });
    expect(outcome.status).toBe("complete");
    expect(gate4).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    expect(calls.some((chamada) => chamada.purpose !== undefined)).toBe(false);
    const g4 = (await evidencias()).atual("P01", "fluxos");
    expect(g4?.evidence.outcome).toBe("NOT_APPLICABLE");
  });

  it("a regressão provada e fora do território da mudança não roda: a prova anterior sustenta a decisão", async () => {
    // A fase anterior percorreu o fluxo 1 contra este conteúdo.
    const livro = await evidencias();
    const antes = await estadoDoCodigo(root);
    const prova = await livro.registrar({
      phaseId: "P00", gate: "G4", checkId: "fluxo-1", claim: "o fluxo 1 passa", outcome: "PASS",
      inputs: { documents: [{ name: "roteiro-1", sha12: "e3b0c44298fc" }], code: antes }, scope: emptyScope({ flows: ["1"] }), supports: [], artifactRefs: [],
    });
    const gate4 = vi.spyOn(flowGates, "gate4");
    const runner = vi.fn(async () => ({ exitCode: 0, output: "" }));
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        await mkdir(join(root, "src", "relatorios"), { recursive: true });
        await escrever("src/relatorios/mensal.ts", "export const mensal = 1;\n");
      }
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, {
      evidencias: livro,
      flows: { workflows: [], regressao: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start", runner },
      territorioDoFluxo: () => ({
        componentes: ["cadastro"], arquivos: ["src/a.ts"], commitados: [],
        classificar: (arquivo) => (arquivo.startsWith("src/relatorios/") ? "fora" : "dentro"),
      }),
    });
    expect(outcome.status).toBe("complete");
    expect(gate4).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    const decisao = (await evidencias()).atual("P01", "fluxos")!;
    expect(decisao.evidence.outcome).toBe("NOT_APPLICABLE");
    expect(decisao.evidence.supports).toEqual([prova.evidenceId]);
  });

  it("a mudança que toca o território do fluxo roda a regressão", async () => {
    const livro = await evidencias();
    await livro.registrar({
      phaseId: "P00", gate: "G4", checkId: "fluxo-1", claim: "o fluxo 1 passa", outcome: "PASS",
      inputs: { documents: [], code: await estadoDoCodigo(root) }, scope: emptyScope({ flows: ["1"] }), supports: [], artifactRefs: [],
    });
    const gate4 = vi.spyOn(flowGates, "gate4").mockResolvedValue({ green: true, skipped: "", scripts: ["workflow-1.spec.ts"] });
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever("src/a.ts", "export const a = 9;\n");
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, {
      evidencias: livro,
      flows: { workflows: [], regressao: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" },
      territorioDoFluxo: () => ({ componentes: ["cadastro"], arquivos: ["src/a.ts"], commitados: [], classificar: () => "dentro" }),
    });
    expect(outcome.status).toBe("complete");
    expect(gate4).toHaveBeenCalledOnce();
  });
});

describe("§13.5 · G2 e G3 têm orçamentos independentes", () => {
  it("o G2 gasta o reparo do verificador dele, e o G3 ainda tem o seu no mesmo ciclo", async () => {
    let suiteVerde = false;
    let reparos = 0;
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.repair) {
        reparos += 1;
        // O primeiro reparo é o do G2 (conserta a suíte); o segundo, o do G3.
        if (reparos === 1) suiteVerde = true;
        else await escrever("src/b.ts", "export const b = 'reservas';\n");
        return ok("reparado");
      }
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) await escrever("src/a.ts", "export const a = 1;\n");
        return ok();
      }
      const b = await readFile(join(root, "src", "b.ts"), "utf8");
      return ok(b.includes("reservas") ? DONE : "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: a listagem; OBSERVED: src/b.ts vazio; EXPECTED: as reservas");
    }, {
      maxVerifierRepairs: 1,
      testRunner: async () => (suiteVerde ? { exitCode: 0, output: "2 passed" } : { exitCode: 1, output: "FAIL reservas.spec.ts > cria\n  erro de ambiente" }),
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 1 });
    expect(calls.filter((chamada) => chamada.repair)).toHaveLength(2);
    const estado = await defeitos();
    const porGate = estado.defects.flatMap((defeito) => defeito.attempts.filter((tentativa) => tentativa.strategy === "verificador").map((tentativa) => tentativa.gate));
    expect(porGate.sort()).toEqual(["G2", "G3"]);
  });
});

describe("§13.6 · o mesmo defeito em G2 e G4 mantém identidade e histórico", () => {
  it("a falha citada pela suíte e depois pela triagem do G4 é um defeito só, reaberto, com as tentativas", async () => {
    let suites = 0;
    vi.spyOn(flowGates, "gate4").mockResolvedValueOnce({
      green: false,
      cause: "o fluxo não mostrou 'Reserva criada com sucesso' depois de salvar",
      triagem: { tipo: "PRODUTO", evidencia: "a tela não mostra 'Reserva criada com sucesso'", onde: "src/a.ts", criterio: "A criação devolve 201", correcao: "mostrar a confirmação" },
      falharam: ["1"],
    }).mockResolvedValue({ green: true, skipped: "", scripts: ["workflow-1.spec.ts"] });
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        await escrever("src/a.ts", `export const a = ${chamada.attempt};\n`);
        return ok();
      }
      return ok(DONE);
    }, {
      flows: { workflows: [{ number: "1", name: "Criar", steps: ["cria"] }], resolveStart: async () => "npm start" },
      testRunner: async () => (++suites === 1
        ? { exitCode: 1, output: "FAIL reservas.spec.ts > cria\n  expected 'Reserva criada com sucesso' to be visible" }
        : { exitCode: 0, output: "2 passed" }),
    });
    expect(outcome.status).toBe("complete");
    const estado = await defeitos();
    const comACitacao = estado.defects.filter((defeito) => defeito.anchors.quotes?.includes("reserva criada com sucesso"));
    expect(comACitacao).toHaveLength(1);
    expect(comACitacao[0]!.gates).toEqual(["G2", "G4"]);
    expect(comACitacao[0]!.attempts.length).toBeGreaterThanOrEqual(2);
    expect(comACitacao[0]!.status).toBe("RESOLVED");
  });
});

describe("§13.7 · defeitos compatíveis numa chamada, validados um a um", () => {
  it("duas tasks incompletas vão juntas ao executor; uma resolve, a outra continua aberta com a própria história", async () => {
    let verificacoes = 0;
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 2) await escrever("src/a.ts", "export const a = 'criação';\n");
        else await escrever("src/b.ts", `export const b = ${chamada.attempt};\n`);
        return ok();
      }
      verificacoes += 1;
      if (verificacoes === 1) return ok("TASK 1: INCOMPLETE — CRITERION: a criação; OBSERVED: src/a.ts vazio\nTASK 2: INCOMPLETE — CRITERION: a listagem; OBSERVED: src/b.ts vazio");
      const a = await readFile(join(root, "src", "a.ts"), "utf8");
      const b = await readFile(join(root, "src", "b.ts"), "utf8");
      return ok(`TASK 1: ${a.includes("criação") ? "DONE" : "INCOMPLETE — CRITERION: a criação"}\nTASK 2: ${b.includes("3") ? "DONE" : "INCOMPLETE — CRITERION: a listagem; OBSERVED: src/b.ts ainda vazio"}`);
    });
    expect(outcome.status).toBe("complete");
    const correcoes = calls.filter((chamada) => chamada.role === "builder").slice(1);
    // A primeira correção leva os dois defeitos de uma vez.
    expect(correcoes[0]!.prompt).toContain("P01-D1");
    expect(correcoes[0]!.prompt).toContain("P01-D2");
    const estado = await defeitos();
    const [d1, d2] = estado.defects;
    expect(d1!.status).toBe("RESOLVED");
    expect(d1!.attempts.map((tentativa) => tentativa.result)).toEqual(["resolved"]);
    expect(d2!.status).toBe("RESOLVED");
    expect(d2!.attempts.length).toBeGreaterThanOrEqual(2);
    expect(d2!.attempts[0]!.action).toBe(d1!.attempts[0]!.action);
  });
});

describe("§13.8 · esgotar o orçamento do ciclo abre o seguinte sem perder nada", () => {
  it("o ciclo 2 nasce com contadores novos, o código e as evidências do ciclo 1, e sem nova implementação", async () => {
    const nomes = ["alfa", "beta", "gama", "delta", "epsilon"];
    let rodada = 0;
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") await escrever(`src/c${chamada.attempt}.ts`, `export const c = ${chamada.attempt};\n`);
      return ok(chamada.role === "verifier" ? DONE : "feito");
    }, {
      maxVerifierRepairs: 0,
      orcamento: { porCiclo: 1 },
      testRunner: async () => {
        rodada += 1;
        return rodada >= 4 ? { exitCode: 0, output: "2 passed" } : { exitCode: 1, output: `FAIL reservas.spec.ts > caso ${nomes[rodada]}` };
      },
    });
    expect(outcome).toMatchObject({ status: "complete", cycles: 3 });
    const builders = calls.filter((chamada) => chamada.role === "builder");
    expect(builders[0]!.prompt).toContain("Implement the phase below COMPLETELY");
    expect(builders.slice(1).every((chamada) => !chamada.prompt.includes("Implement the phase below COMPLETELY"))).toBe(true);
    for (const n of [1, 2, 3]) expect(await readFile(join(root, `src/c${n}.ts`), "utf8")).toContain(`${n}`);
    const linhas = (await readFile(evidenciasDoRun(runPaths(root, RUN).root), "utf8")).trim().split("\n");
    expect(linhas.filter((linha) => linha.includes('"checkId":"suite"') && linha.includes('"kind":"evidence"'))).toHaveLength(4);
    const ciclos = (await lerTransicoes(root, RUN)).filter((transicao) => transicao.linha.startsWith("novo ciclo"));
    expect(ciclos).toHaveLength(2);
    expect(ciclos[0]!.linha).toContain("sem voltar à implementação");
  });
});

describe("§13.9 e §13.10 · handoff antes de qualquer reparo, retomada e quem valida", () => {
  const incompleto = "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: a listagem; OBSERVED: src/b.ts vazio; EXPECTED: as reservas; FIX: preencher src/b.ts; CHECK: npm test";

  it("o handoff existe ANTES da primeira correção, e o reparador nunca é quem valida", async () => {
    let handoffsNaCorrecao: string[] | null = null;
    const sessoes: string[] = [];
    let n = 0;
    const { outcome, calls } = await fase(async (chamada) => {
      n += 1;
      if (chamada.role === "builder" && chamada.attempt === 2) {
        handoffsNaCorrecao = await readdir(join(defeitosDoRun(runPaths(root, RUN).root), "P01", "P01-D1")).catch(() => []);
        // E o que está nele é o diagnóstico ORIGINAL, já no disco quando a primeira correção começa.
        const gravado = JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01", "P01-D1", "handoff-G3-c1.json"), "utf8")) as { raw: string };
        expect(gravado.raw).toContain("FIX: preencher src/b.ts");
        return ok();
      }
      if (chamada.role === "builder") return ok();
      if (chamada.repair) {
        await escrever("src/b.ts", "export const b = 'reservas';\n");
        return ok("reparado", { sessionId: `sessao-${n}` });
      }
      sessoes.push(`sessao-${n}`);
      const b = await readFile(join(root, "src", "b.ts"), "utf8");
      return ok(b.includes("reservas") ? DONE : incompleto, { sessionId: `sessao-${n}` });
    }, { maxVerifierRepairs: 1 });
    expect(outcome.status).toBe("complete");
    expect(handoffsNaCorrecao).toEqual(["handoff-G3-c1.json"]);
    const handoff = JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01", "P01-D1", "handoff-G3-c1.json"), "utf8")) as Record<string, unknown>;
    expect(handoff).toMatchObject({ identity: { runId: RUN, phaseId: "P01", gate: "G3", cycle: 1, defectId: "P01-D1" }, minimalRepair: "preencher src/b.ts", requiredProof: "npm test" });
    const reparo = calls.find((chamada) => chamada.repair)!;
    const depois = calls.slice(calls.indexOf(reparo) + 1).filter((chamada) => chamada.role === "verifier" && !chamada.repair);
    expect(depois.length).toBeGreaterThan(0);
    expect(depois.every((chamada) => chamada.resumeSession === undefined)).toBe(true);
    // Quem valida depois do reparo é sempre uma sessão nova: nenhuma leitura pede retomada, e a ponte recusaria (provider/retomada.spec).
    expect(sessoes.length).toBeGreaterThanOrEqual(2);
  });

  const garantida = { maxVerifierRepairs: 1, verifierResume: { estado: "garantido" as const, elevacao: "por-invocacao" as const, motivo: "teste" } };
  const verificador = async (chamada: EngineCall): Promise<EngineResult> => {
    const b = await readFile(join(root, "src", "b.ts"), "utf8");
    return ok(b.includes("reservas") ? DONE : incompleto, { sessionId: "diagnostico-1" });
  };

  it("com retomada garantida, o reparo pede a sessão que diagnosticou, e só a conta como retomada pelo id devolvido", async () => {
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") return ok();
      if (chamada.repair) {
        await escrever("src/b.ts", "export const b = 'reservas';\n");
        return ok("reparado", { sessionId: chamada.resumeSession ?? "nova" });
      }
      return verificador(chamada);
    }, garantida);
    expect(outcome.status).toBe("complete");
    const reparos = calls.filter((chamada) => chamada.repair);
    expect(reparos).toHaveLength(1);
    expect(reparos[0]!.resumeSession).toBe("diagnostico-1");
    // A retomada pode não acontecer: o prompt leva o handoff inteiro de qualquer jeito.
    expect(reparos[0]!.prompt).toContain("preencher src/b.ts");
    const tentativa = (await defeitos()).defects[0]!.attempts.find((cada) => cada.strategy === "verificador")!;
    expect(tentativa.agent).toMatchObject({ resumed: true, sessionId: "diagnostico-1" });
  });

  it("o provider que abre outra sessão não retomou — mas ela recebeu o handoff, e o trabalho dela fica", async () => {
    const { outcome, calls, notices } = await fase(async (chamada) => {
      if (chamada.role === "builder") return ok();
      if (chamada.repair) {
        await escrever("src/b.ts", "export const b = 'reservas';\n");
        return ok("reparado", { sessionId: "outra-sessao" });
      }
      return verificador(chamada);
    }, garantida);
    expect(outcome.status).toBe("complete");
    expect(calls.filter((chamada) => chamada.repair)).toHaveLength(1);
    expect(notices.join("\n")).toContain("não foi retomada (o provider abriu outra-sessao)");
    const tentativa = (await defeitos()).defects[0]!.attempts.find((cada) => cada.strategy === "verificador")!;
    expect(tentativa.agent).toMatchObject({ resumed: false, sessionId: "outra-sessao" });
  });

  it("a sessão pedida que não conclui cai em UMA sessão nova com o handoff, e o transcrito dela fica", async () => {
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") return ok();
      if (chamada.repair) {
        if (chamada.resumeSession) return { exitCode: 1, stdout: "", stderr: "a sessão não pôde ser retomada", timedOut: null };
        await escrever("src/b.ts", "export const b = 'reservas';\n");
        return ok("reparado", { sessionId: "nova-sessao" });
      }
      return verificador(chamada);
    }, garantida);
    expect(outcome.status).toBe("complete");
    const reparos = calls.filter((chamada) => chamada.repair);
    expect(reparos.map((reparo) => reparo.resumeSession)).toEqual(["diagnostico-1", undefined]);
    for (const reparo of reparos) expect(reparo.prompt).toContain("preencher src/b.ts");
    const logs = await readdir(runPaths(root, RUN).logs);
    expect(logs.some((nome) => nome.endsWith(".retomada.log"))).toBe(true);
    const tentativa = (await defeitos()).defects[0]!.attempts.find((cada) => cada.strategy === "verificador")!;
    expect(tentativa.agent).toMatchObject({ resumed: false, sessionId: "nova-sessao" });
  });

  it("sem capacidade declarada (ou só não verificada), nunca pede retomada", async () => {
    const { calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") return ok();
      if (chamada.repair) {
        await escrever("src/b.ts", "export const b = 'reservas';\n");
        return ok("reparado");
      }
      const b = await readFile(join(root, "src", "b.ts"), "utf8");
      return ok(b.includes("reservas") ? DONE : incompleto, { sessionId: "diagnostico-1" });
    }, { maxVerifierRepairs: 1, verifierResume: { estado: "nao-verificado", elevacao: "por-invocacao", motivo: "teste" } });
    expect(calls.filter((chamada) => chamada.resumeSession !== undefined)).toHaveLength(0);
  });
});

describe("transparência da recuperação no events.tsv", () => {
  it("cada transição tem assunto próprio, status started e nunca vem depois do evento final da fase", async () => {
    let verificacoes = 0;
    await fase(async (chamada) => {
      if (chamada.role === "builder") {
        await escrever("src/b.ts", `export const b = ${chamada.attempt};\n`);
        return ok();
      }
      verificacoes += 1;
      return ok(verificacoes === 1 ? "TASK 1: DONE\nTASK 2: INCOMPLETE — CRITERION: a listagem" : DONE);
    });
    const eventos = await readEvents(runPaths(root, RUN).events);
    const recuperacao = eventos.filter((evento) => evento.subject === "P01:recuperacao");
    expect(recuperacao.length).toBeGreaterThan(0);
    expect(recuperacao.every((evento) => evento.status === "started" && evento.stage === "recover")).toBe(true);
    expect(eventos.at(-1)).toMatchObject({ subject: "P01", status: "complete" });
  });
});
