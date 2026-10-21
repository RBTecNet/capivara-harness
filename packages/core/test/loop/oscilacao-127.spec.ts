/**
 * §127 — a recuperação do BUILD reconhece o que ela mesma registra: a mesma
 * falha do G4 com outra redação é o mesmo defeito, e dois gates puxando o
 * mesmo arquivo para lados opostos é incompatibilidade de contrato, não
 * trabalho a repetir.
 *
 * O runner de verdade, Git real (o estado do código é conteúdo), provider
 * falso que escreve no disco, e o G4 simulado lendo o arquivo do servidor —
 * como na P04 do Luna: o G4 só passa com `/categorias` registrado, e o critério
 * do G3 diz "O roteador é exportado sem registro no servidor central".
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
import { LivroDeEvidencias } from "../../src/loop/evidencias.js";
import { defeitosDoRun, mesmoDefeito, type Defect, type EstadoDaRecuperacao } from "../../src/loop/defeitos.js";
import { lerTransicoes } from "../../src/loop/narrador.js";
import { runPaths } from "../../src/state/index.js";

const run = promisify(execFile);
const RUN = "build-osc127000000";
let root = "";

const PLANO = `# Lab — Project Phases

<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->

## Overview

Fase única.

---

## Phase 1: Gestão de categorias

**Goal:** Implementar o CRUD de categorias · **Depends on:** none · **Covers:** categorias, workflow 1

- [ ] **Task:** Em \`server/categorias.ts\`, implementar e exportar \`categoriasRouter\`.
  - **Acceptance criteria:**
    - O roteador é exportado sem registro no servidor central.
  - **Traces:** categorias, workflow 1

- [ ] **Task:** Em \`src/categorias.tsx\`, implementar a página de categorias.
  - **Acceptance criteria:**
    - A página exporta \`CategoriasPage\`.
  - **Traces:** categorias, workflow 1

## Open Questions

Nenhuma.
`;

const SERVIDOR = "server/api.ts";
const REGISTRO = "registrar('categorias', categoriasRouter);";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-osc-127-"));
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "t@t"], { cwd: root });
  await run("git", ["config", "user.name", "t"], { cwd: root });
  await writeFile(join(root, ".gitignore"), "node_modules/\n.capivara/runs/\n.capivara/handoffs/\n");
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, SERVIDOR), "export function registrar() {}\n");
  // O pacote de reparo documental confere o documento publicado: ele está no disco, como num run de verdade.
  await mkdir(join(root, ".capivara", "init"), { recursive: true });
  await writeFile(join(root, ".capivara", "init", "project-phases.md"), PLANO);
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-q", "-m", "base"], { cwd: root });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

function sessao(): PhaseSession {
  const split = splitPhases(PLANO, root, RUN);
  if (!split.ok) throw new Error(JSON.stringify(split.errors));
  return split.sessions[0]!;
}

const ok = (stdout = "feito"): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });
const FLUXO = { number: "1", name: "Gestão de categorias", steps: ["Cadastrar uma categoria.", "Consultar categorias."] };

async function registrado(): Promise<boolean> {
  return (await readFile(join(root, SERVIDOR), "utf8")).includes(REGISTRO);
}

/** A falha do G4 na P04 do Luna: o mesmo passo, o mesmo localizador, e a triagem dizendo o lugar com outras palavras a cada vez. */
let reprovacoesDoG4 = 0;
function falhaDoFluxo(passo = 1) {
  reprovacoesDoG4 += 1;
  const lugares = ["Rota `/categorias`, na página de categorias.", "Rota `/categorias` e integração da página.", "Rota /categorias na interface.", "Rota POST /api/categorias."];
  return {
    green: false as const,
    cause: "O gate 4 reprovou e a triagem diz que o defeito é do PRODUTO. Corrija isto: registrar `/categorias` na aplicação",
    output: `  1) [workflow-1] › workflow-1.spec.ts:3:1 › workflow 1 › passo ${passo}: ${FLUXO.steps[passo - 1]}\n    Error: locator.click: Test timeout of 60000ms exceeded.`,
    triagem: {
      tipo: "PRODUTO" as const,
      criterio: "a página de categorias acessível pela aplicação",
      evidencia: "o snapshot mostra só o painel; `/categorias` não abre a página",
      onde: lugares[(reprovacoesDoG4 - 1) % lugares.length]!,
      correcao: "registrar `/categorias` na aplicação",
    },
    falharam: ["1"],
  };
}

async function fase(call: (chamada: EngineCall) => Promise<EngineResult>, extra: Partial<PhaseRunOptions> = {}, semFluxos = false) {
  const calls: EngineCall[] = [];
  const notices: string[] = [];
  const outcome = await runPhase({
    projectRoot: root, runId: RUN, language: "pt-BR", engine: "codex", session: sessao(),
    testCommand: { command: "npm test", source: "teste", containerized: false },
    commitsEnabled: false, maxCycles: 3, sleep: async () => undefined,
    testRunner: async () => ({ exitCode: 0, output: "2 passed" }),
    ...(semFluxos ? {} : { flows: { workflows: [FLUXO], resolveStart: async () => "npm start" } }),
    maxVerifierRepairs: 0,
    announce: (linha) => notices.push(linha),
    ...extra,
    call: async (chamada) => {
      calls.push(chamada);
      return call(chamada);
    },
  });
  return { outcome, calls, notices };
}

async function defeitos(): Promise<EstadoDaRecuperacao> {
  return JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), "utf8")) as EstadoDaRecuperacao;
}

beforeEach(() => {
  reprovacoesDoG4 = 0;
});

describe("§127 · 9, 15 — G3 e G4 não sustentam um ciclo de pôr e tirar a mesma integração", () => {
  it("o Core prova a reversão causal, para de reparar, preserva tudo e encaminha o diagnóstico ao PLAN", async () => {
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => (await registrado()) ? { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] } : falhaDoFluxo());
    const { outcome, calls } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) {
          await writeFile(join(root, "server", "categorias.ts"), "export const categoriasRouter = {};\n");
          await writeFile(join(root, "src", "categorias.tsx"), "export function CategoriasPage() {}\n");
          return ok();
        }
        // O executor faz o que o gate da vez pede: o G3 manda tirar o registro, o G4 manda pôr.
        const base = "export function registrar() {}\n";
        await writeFile(join(root, SERVIDOR), chamada.prompt.includes("OBSERVED: server/api.ts registra") ? base : `${base}${REGISTRO}\n`);
        return ok();
      }
      return ok((await registrado())
        ? "TASK 1: INCOMPLETE — B1: CRITERION: O roteador é exportado sem registro no servidor central; OBSERVED: server/api.ts registra `/categorias`; EXPECTED: sem registro; FIX: remover o registro\nTASK 2: DONE"
        : "TASK 1: DONE\nTASK 2: DONE");
    });

    expect(outcome.status).toBe("failed");
    const causa = outcome.status === "failed" ? outcome.cause : "";
    expect(causa).toContain("OSCILAÇÃO ENTRE GATES");
    expect(causa).toContain("server/api.ts");
    expect(causa).toContain("incompatibilidade de contrato");
    // Três reparos do executor e a fase para, no primeiro ciclo: nada de esgotar três ciclos alternando.
    expect(calls.filter((chamada) => chamada.role === "builder")).toHaveLength(4);

    const estado = await defeitos();
    const doG4 = estado.defects.filter((defeito) => defeito.gates.includes("G4"));
    const doG3 = estado.defects.filter((defeito) => defeito.nature === "task");
    // 11 — independentes: o "/categorias" que os dois citam não junta a exigência e a proibição num defeito só.
    expect(doG4).toHaveLength(1);
    expect(doG4[0]!.gates).toEqual(["G4"]);
    expect(doG3).toHaveLength(1);
    expect([doG4[0]!.status, doG3[0]!.status]).toEqual(["UPSTREAM_REPAIR_REQUIRED", "UPSTREAM_REPAIR_REQUIRED"]);
    expect(doG4[0]!.attempts.map((tentativa) => tentativa.files)).toEqual([[SERVIDOR], [SERVIDOR]]);

    // O pacote de reparo documental, validado, com os dois critérios — nenhum documento aprovado foi tocado.
    const pacotes = await readdir(join(root, ".capivara", "repairs", "upstream"));
    expect(pacotes).toEqual([doG4[0]!.upstream]);
    const diagnostico = await readFile(join(root, ".capivara", "repairs", "upstream", pacotes[0]!, "diagnosis.md"), "utf8");
    expect(diagnostico).toContain("O roteador é exportado sem registro no servidor central");
    expect(diagnostico).toContain("possível incompatibilidade de contrato");
    expect(await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8")).toBe(PLANO);

    // 15 — o trabalho parcial e o histórico ficam: os arquivos da fase, o commit base, as provas.
    expect(await readFile(join(root, "server", "categorias.ts"), "utf8")).toContain("categoriasRouter");
    expect((await run("git", ["log", "--format=%s"], { cwd: root })).stdout.trim()).toBe("base");
    const transicoes = await lerTransicoes(root, RUN);
    expect(transicoes.some((transicao) => transicao.linha.startsWith("oscilação entre gates"))).toBe(true);

    // 13 — a parada não invalida o que vale: a prova da task 2 continua de pé para o conteúdo em que a fase parou.
    const livro = await LivroDeEvidencias.abrir(runPaths(root, RUN).root, RUN);
    expect(livro.atual("P01", "task-2")?.validity.state).toBe("VALID");
  }, 60_000);

  it("na retomada, o pacote ainda válido para a fase de novo sem nenhuma chamada", async () => {
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => (await registrado()) ? { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] } : falhaDoFluxo());
    const executor = async (chamada: EngineCall): Promise<EngineResult> => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) await writeFile(join(root, "server", "categorias.ts"), "export const categoriasRouter = {};\n");
        else await writeFile(join(root, SERVIDOR), `export function registrar() {}\n${chamada.prompt.includes("OBSERVED: server/api.ts registra") ? "" : `${REGISTRO}\n`}`);
        return ok();
      }
      return ok((await registrado()) ? "TASK 1: INCOMPLETE — B1: CRITERION: O roteador é exportado sem registro no servidor central; OBSERVED: server/api.ts registra; FIX: remover\nTASK 2: DONE" : "TASK 1: DONE\nTASK 2: DONE");
    };
    expect((await fase(executor)).outcome.status).toBe("failed");
    const retomada = await fase(executor);
    expect(retomada.outcome.status).toBe("failed");
    expect(retomada.calls).toHaveLength(0);
    expect(retomada.outcome.status === "failed" ? retomada.outcome.cause : "").toContain("REPARO DOCUMENTAL PENDENTE");
  }, 60_000);
});

describe("§127 · 10, 11 — a identidade do defeito do G4 é o passo do roteiro, não a redação da triagem", () => {
  it("10 — a mesma falha com outra redação é o mesmo defeito: as tentativas se acumulam nele", async () => {
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => falhaDoFluxo());
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") await writeFile(join(root, "src", "categorias.tsx"), `export const versao = ${chamada.attempt};\n`);
      return ok(chamada.role === "verifier" ? "TASK 1: DONE\nTASK 2: DONE" : "feito");
    });
    expect(outcome.status).toBe("failed");
    const estado = await defeitos();
    expect(estado.defects).toHaveLength(1);
    const [defeito] = estado.defects;
    expect(defeito!.anchors).toMatchObject({ workflow: "1", step: "passo 1" });
    expect(defeito!.attempts).toHaveLength(3);
    // As redações diferentes ficam na história do defeito, não em ids novos de orçamento cheio.
    expect(defeito!.rediagnoses.length).toBe(3);
    expect(reprovacoesDoG4).toBe(4);
  }, 60_000);

  it("11 — falhas em passos diferentes do fluxo continuam defeitos diferentes", async () => {
    vi.spyOn(flowGates, "gate4")
      .mockImplementationOnce(async () => falhaDoFluxo(1))
      .mockImplementationOnce(async () => falhaDoFluxo(2))
      .mockResolvedValue({ green: true, skipped: "", scripts: ["workflow-1.spec.ts"] });
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") await writeFile(join(root, "src", "categorias.tsx"), `export const versao = ${chamada.attempt};\n`);
      return ok(chamada.role === "verifier" ? "TASK 1: DONE\nTASK 2: DONE" : "feito");
    });
    expect(outcome.status).toBe("complete");
    const estado = await defeitos();
    expect(estado.defects.map((defeito) => defeito.anchors.step)).toEqual(["passo 1", "passo 2"]);
    expect(estado.defects.map((defeito) => defeito.status)).toEqual(["RESOLVED", "RESOLVED"]);
  }, 60_000);
});

describe("§127 · o relatório do reparo do verificador vale para a correção seguinte, uma vez", () => {
  it("a segunda correção do executor depois do reparo não recebe mais o relatório velho", async () => {
    let verificacoes = 0;
    const { calls } = await fase(async (chamada) => {
      if (chamada.repair === true) {
        await writeFile(join(root, "server", "categorias.ts"), "export const categoriasRouter = {};\n");
        return ok("CAPIVARA_FINDING: P01-D1 — Removi a rota `/categorias` (RELATORIO-127)");
      }
      if (chamada.role === "builder") {
        await writeFile(join(root, "src", "categorias.tsx"), `export const versao = ${chamada.attempt};\n`);
        return ok();
      }
      verificacoes += 1;
      // O reparo não resolve; a primeira correção depois dele progride, e o executor segue com outra, sem reparo no meio.
      const criterio = ["a listagem", "a listagem", "a listagem", "a criação", "a edição", "a exclusão"][verificacoes - 1] ?? "a consulta";
      return ok(`TASK 1: INCOMPLETE — CRITERION: ${criterio}; OBSERVED: server/categorias.ts incompleto\nTASK 2: DONE`);
    }, { maxVerifierRepairs: 1, maxCycles: 2 }, true);
    const correcoes = calls.filter((chamada) => chamada.role === "builder").slice(1);
    const comRelatorio = correcoes.map((chamada) => chamada.prompt.includes("RELATORIO-127"));
    // A correção logo depois do reparo o recebe; a seguinte, que não teve reparo no meio, não.
    expect(calls.filter((chamada) => chamada.repair === true)).toHaveLength(1);
    expect(comRelatorio).toEqual([false, true, false]);
  }, 60_000);
});

describe("§127 · revisão adversarial — o que NÃO é incompatibilidade de contrato", () => {
  it("C1 — um teste da suíte (G2), escrito pelo próprio executor, contra o fluxo: a escada segue, e a fase fecha", async () => {
    const APP = join(root, "src", "App.tsx");
    await writeFile(APP, "v0\n");
    const app = async (): Promise<string> => readFile(APP, "utf8");
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => (await app()).includes("FLUXO_OK")
      ? { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] }
      : { ...falhaDoFluxo(), cause: "O gate 4 reprovou e a triagem diz que o defeito é do PRODUTO. Corrija isto: mostrar o título novo" });
    let correcoesDoFluxo = 0;
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) {
          await writeFile(join(root, "server", "categorias.ts"), "export const categoriasRouter = {};\n");
          return ok();
        }
        if (chamada.prompt.includes("gate 4")) {
          correcoesDoFluxo += 1;
          // A terceira correção do fluxo atualiza também o teste que o executor tinha escrito.
          await writeFile(APP, correcoesDoFluxo >= 3 ? "FLUXO_OK\n" : "FLUXO_OK QUEBRA\n");
        } else {
          await writeFile(APP, "v-teste\n");
        }
        return ok();
      }
      return ok("TASK 1: DONE\nTASK 2: DONE");
    }, {
      testRunner: async () => (await app()).includes("QUEBRA")
        ? { exitCode: 1, output: " FAIL  src/App.test.tsx > App > mostra o título antigo\n 1 failed" }
        : { exitCode: 0, output: "2 passed" },
    });
    expect(outcome.status).toBe("complete");
    expect(await readdir(join(root, ".capivara", "repairs", "upstream")).catch(() => [])).toEqual([]);
  }, 90_000);

  it("C1 — G3 × G4 com um executor que nunca restaura o mesmo conteúdo: sem prova de reversão, sem parada por oscilação", async () => {
    vi.spyOn(flowGates, "gate4").mockImplementation(async () => (await registrado()) ? { green: true, skipped: "", scripts: ["workflow-1.spec.ts"] } : falhaDoFluxo());
    const { outcome } = await fase(async (chamada) => {
      if (chamada.role === "builder") {
        if (chamada.attempt === 1) {
          await writeFile(join(root, "server", "categorias.ts"), "export const categoriasRouter = {};\n");
          return ok();
        }
        const base = `export function registrar() {} // tentativa ${chamada.attempt}\n`;
        await writeFile(join(root, SERVIDOR), chamada.prompt.includes("OBSERVED: server/api.ts registra") ? base : `${base}${REGISTRO}\n`);
        return ok();
      }
      return ok((await registrado())
        ? "TASK 1: INCOMPLETE — B1: CRITERION: O roteador é exportado sem registro no servidor central; OBSERVED: server/api.ts registra; FIX: remover o registro\nTASK 2: DONE"
        : "TASK 1: DONE\nTASK 2: DONE");
    }, { maxCycles: 2 });
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" ? outcome.cause : "").not.toContain("OSCILAÇÃO");
    expect(await readdir(join(root, ".capivara", "repairs", "upstream")).catch(() => [])).toEqual([]);
  }, 90_000);
});

describe("§127 · a ponte entre gates só cruza com mensagem", () => {
  const existente = (quotes: string[]): Defect => ({
    defectId: "P01-D1", phaseId: "P01", nature: "suite", discovered: { gate: "G2", cycle: 1, at: "" }, gates: ["G2"], severity: "B1",
    anchors: { quotes, signature: "x" }, summary: "", detail: "", criterion: "", observed: "", expected: "", hypothesis: "", components: [],
    status: "OPEN", attempts: [], failedStrategies: [], evidence: [], invalidated: [], handoffs: [], rediagnoses: [], costs: { calls: 0, seconds: 0, costUsd: 0 },
  });
  const doFluxo = (quotes: string[]) => ({ gate: "G4" as const, nature: "fluxo-produto" as const, anchors: { workflow: "1", quotes }, summary: "", detail: "" });

  it("um nome comum (rota, arquivo) não junta dois defeitos de gates diferentes", () => {
    expect(mesmoDefeito(existente(["/categorias"]), doFluxo(["/categorias"]))).toBe(false);
    expect(mesmoDefeito(existente(["categoriaspage.tsx"]), doFluxo(["categoriaspage.tsx"]))).toBe(false);
  });

  it("a frase literal e o código de erro de um token continuam juntando", () => {
    expect(mesmoDefeito(existente(["reserva criada com sucesso"]), doFluxo(["reserva criada com sucesso"]))).toBe(true);
    expect(mesmoDefeito(existente(["err_module_not_found"]), doFluxo(["err_module_not_found"]))).toBe(true);
    expect(mesmoDefeito(existente(["econnrefused 127.0.0.1:3000"]), doFluxo(["econnrefused 127.0.0.1:3000"]))).toBe(true);
  });
});
