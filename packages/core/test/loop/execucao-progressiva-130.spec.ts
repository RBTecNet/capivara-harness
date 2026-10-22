/**
 * Execução progressiva dentro das fases (§130).
 *
 * O BUILD entregava a fase inteira ao executor numa sessão só: as quinze tasks
 * e os sessenta critérios de uma vez, que é onde um modelo de contexto pequeno
 * se perde. Agora a fase grande vai em partes — grupos contíguos das tasks
 * aprovadas, na ordem do plano, no texto exato do plano —, e a fase continua
 * sendo uma entrega só: os gates a julgam inteira, depois da última parte.
 *
 * Os cenários são os quinze da seção 10 da especificação, contra o runner de
 * verdade: Git real (o estado do código é conteúdo), provider falso que escreve
 * no disco o arquivo de cada task que o prompt lhe entrega, e o que fica
 * persistido lido do plano de controle como qualquer leitor leria.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild, runPhase, splitPhases } from "../../src/loop/index.js";
import type { EngineCall, EngineResult, PhaseRunOptions, PhaseSession } from "../../src/loop/index.js";
import { LivroDeEvidencias } from "../../src/loop/evidencias.js";
import { defeitosDoRun, type EstadoDaRecuperacao } from "../../src/loop/defeitos.js";
import { dividirEmPartes, ORCAMENTO_DA_PARTE } from "../../src/loop/partes.js";
import { shaDaTask } from "../../src/loop/veredictos.js";
import type { FatiaDaArquitetura } from "../../src/loop/arquitetura.js";
import { lerTransicoes } from "../../src/loop/narrador.js";
import { implementPrompt } from "../../src/prompts/index.js";
import { sharedContractFromSkeleton } from "../../src/prompts/acceptance-policy.js";
import { artifactPaths, readEvents, replayEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { parsePhaseFragment, recorteDaFase, sha12 } from "../../src/contract/index.js";
import { certifyCurrentPlan } from "../support/current-plan.js";

const run = promisify(execFile);
const RUN = "build-partes0000000";
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-partes-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.email", "t@t"]);
  await git(["config", "user.name", "t"]);
  await writeFile(join(root, ".gitignore"), "node_modules/\n.capivara/runs/\n.capivara/handoffs/\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "base.ts"), "export const base = 0;\n");
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "base"]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function git(args: string[], cwd = root): Promise<string> {
  return (await run("git", args, { cwd })).stdout.trim();
}

// ------------------------------------------------------------------ o plano

const criterios = (modulo: string, quantos = 4): string[] =>
  Array.from({ length: quantos }, (_, posicao) => `O módulo ${modulo} cumpre a regra ${posicao + 1} com a entrada válida e recusa a inválida com a mensagem da regra`);

function task(modulo: string, caminho: string, quantos = 4, criteriosProprios?: string[]): string {
  return [
    `- [ ] **Task:** Implementar o módulo ${modulo} em \`${caminho}\``,
    "  - **Acceptance criteria:**",
    ...(criteriosProprios ?? criterios(modulo, quantos)).map((criterio) => `    - ${criterio}`),
    `  - **Traces:** US-1.${modulo.replace(/\D/gu, "") || "1"}`,
    "",
  ].join("\n");
}

const envelope = (fases: string[]): string =>
  ["# Módulos — Project Phases", "", "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", "", "## Overview", "", "Módulos.", "", ...fases, "## Open Questions", "", "Nenhuma.", ""].join("\n");

/** Doze tasks de quatro critérios (48, acima dos 15 por sessão), em duas sub-fases: 1–5 e 6–12. */
function faseGrande(numero = 1, comSubfases = true): string {
  const tasks = (de: number, ate: number): string[] => Array.from({ length: ate - de + 1 }, (_, posicao) => task(String(de + posicao), `src/t${de + posicao}.ts`));
  return [
    `## Phase ${numero}: Módulos`,
    "",
    `**Goal:** os doze módulos funcionam · **Depends on:** none · **Covers:** US-1`,
    "",
    ...(comSubfases ? ["### Phase " + numero + ".1: Base", "", "Os módulos de que os outros dependem.", ""] : []),
    ...tasks(1, 5),
    ...(comSubfases ? ["### Phase " + numero + ".2: Extensões", "", "Os módulos que usam a base.", ""] : []),
    ...tasks(6, 12),
  ].join("\n");
}

const PEQUENA = [
  "## Phase 1: Pequena",
  "",
  "**Goal:** dois módulos · **Depends on:** none · **Covers:** US-1",
  "",
  task("1", "src/t1.ts", 2),
  task("2", "src/t2.ts", 2),
].join("\n");

function sessao(plano: string): PhaseSession {
  const split = splitPhases(plano, root, RUN);
  if (!split.ok) throw new Error(JSON.stringify(split.errors));
  return split.sessions[0]!;
}

// ------------------------------------------------------------------ o provider falso

const ok = (stdout = "feito", extra: Partial<EngineResult> = {}): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null, ...extra });
const todasDone = (quantas: number): string => Array.from({ length: quantas }, (_, posicao) => `TASK ${posicao + 1}: DONE`).join("\n");

/** As tasks que o prompt entrega para implementar: a seção final, não a lista das partes anteriores. */
function entregues(prompt: string): string[] {
  const secao = prompt.split(/^## The (?:part of the )?phase to (?:implement|complete)$/mu)[1] ?? "";
  return [...new Set([...secao.matchAll(/`(src\/[^`]+\.ts)`/gu)].map((achado) => achado[1]!))];
}

/** O executor falso: escreve o arquivo de cada task que recebeu, onde a chamada manda. */
async function implementar(chamada: EngineCall): Promise<void> {
  for (const caminho of entregues(chamada.prompt)) {
    const destino = join(chamada.root ?? root, caminho);
    await mkdir(join(destino, ".."), { recursive: true });
    await writeFile(destino, `export const feito = ${JSON.stringify(caminho)};\n`);
  }
}

async function fase(plano: string, call: (chamada: EngineCall, n: number) => Promise<EngineResult>, extra: Partial<PhaseRunOptions> = {}) {
  const calls: EngineCall[] = [];
  const notices: string[] = [];
  let suites = 0;
  let construcoes = 0;
  const outcome = await runPhase({
    projectRoot: root, runId: RUN, language: "pt-BR", engine: "codex", session: sessao(plano),
    testCommand: { command: "npm test", source: "teste", containerized: false },
    commitsEnabled: false, maxCycles: 3, sleep: async () => undefined,
    announce: (linha) => notices.push(linha),
    ...extra,
    testRunner: async () => {
      suites += 1;
      return { exitCode: 0, output: "passed" };
    },
    call: async (chamada) => {
      calls.push(chamada);
      if (chamada.role === "builder") construcoes += 1;
      return call(chamada, construcoes);
    },
  });
  const construcao = calls.filter((chamada) => chamada.role === "builder");
  return { outcome, calls, construcao, notices, suites: () => suites };
}

/** O executor que implementa tudo o que recebe e o verificador que aprova as doze. */
const tudoCerto = (tasks = 12) => async (chamada: EngineCall): Promise<EngineResult> => {
  if (chamada.role === "builder") {
    await implementar(chamada);
    return ok("feito\nCAPIVARA_BUILDER_STATUS: COMPLETE");
  }
  return ok(todasDone(tasks));
};

async function defeitos(): Promise<EstadoDaRecuperacao> {
  return JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), "utf8")) as EstadoDaRecuperacao;
}

async function evidencias() {
  return LivroDeEvidencias.abrir(runPaths(root, RUN).root, RUN);
}

async function aprovacoes(): Promise<unknown[]> {
  return JSON.parse(await readFile(join(artifactPaths(root).handoffs, "tasks.json"), "utf8").catch(() => "[]")) as unknown[];
}

const parteDo = (prompt: string): string | null => /^## This session builds part (\d+) of (\d+) of the phase$/mu.exec(prompt)?.slice(1, 3).join("/") ?? null;

// ------------------------------------------------------------------ os cenários

describe("§130.1 · a fase pequena continua numa sessão só, com o prompt de sempre", () => {
  it("duas tasks: uma chamada de construção, sem parte, com o mesmo prompt de antes da §130", async () => {
    const plano = envelope([PEQUENA]);
    const { outcome, construcao } = await fase(plano, tudoCerto(2));
    expect(outcome.status).toBe("complete");
    expect(construcao).toHaveLength(1);
    // O prompt de antes, montado pelo mesmo implementPrompt sem parte: nada mudou para quem cabe.
    expect(construcao[0]!.prompt).toBe(implementPrompt({
      language: "pt-BR", sharedContract: sharedContractFromSkeleton(""), testCommand: "npm test", containerized: false, phaseMarkdown: sessao(plano).markdown,
    }));
    expect(parteDo(construcao[0]!.prompt)).toBeNull();
    expect((await defeitos()).partes).toBeUndefined();
  });
});

describe("§130.2 · a fase grande vai em partes, cada uma com só as suas tasks, inteiras", () => {
  it("doze tasks e 48 critérios: cinco sessões, nenhuma com a fase inteira, todo critério no texto do plano", async () => {
    const plano = envelope([faseGrande()]);
    const fase1 = sessao(plano);
    const { outcome, construcao } = await fase(plano, tudoCerto());
    expect(outcome.status).toBe("complete");
    expect(construcao.map((chamada) => parteDo(chamada.prompt))).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
    const originais = parsePhaseFragment(fase1.markdown)!.tasks;
    const vistas = new Set<number>();
    for (const chamada of construcao) {
      expect(chamada.prompt).not.toBe(fase1.markdown);
      const secao = chamada.prompt.split(/^## The part of the phase to implement$/mu)[1]!;
      const recebidas = parsePhaseFragment(secao)!.tasks;
      // Cada task recebida é a do plano, byte a byte no texto canônico: título, critérios e traces.
      for (const recebida of recebidas) {
        const original = originais.find((cada) => cada.title === recebida.title)!;
        expect(shaDaTask(recebida)).toBe(shaDaTask(original));
        vistas.add(original.index);
      }
      // E nenhum critério de task de outra parte.
      const fora = originais.filter((cada) => !recebidas.some((recebida) => recebida.title === cada.title));
      for (const outra of fora) for (const criterio of outra.acceptanceCriteria) expect(secao).not.toContain(criterio);
    }
    expect([...vistas].sort((a, b) => a - b)).toEqual(originais.map((cada) => cada.index));
  });
});

describe("§130.3 · tasks com dependência: a ordem do plano e a sub-fase inteira quando cabe", () => {
  it("as partes são contíguas, a sub-fase 1.2 não começa no meio da parte 2, e cada parte sabe o que veio antes", async () => {
    const plano = envelope([faseGrande()]);
    const { construcao } = await fase(plano, tudoCerto());
    expect((await defeitos()).partes?.grupos).toEqual([[1, 2, 3], [4, 5], [6, 7, 8], [9, 10, 11], [12]]);
    const terceira = construcao[2]!.prompt;
    for (const anterior of [1, 2, 3, 4, 5]) expect(terceira).toContain(`- Task ${anterior} — Implementar o módulo ${anterior} em \`src/t${anterior}.ts\``);
    expect(terceira).toContain("Tasks 9 to 12 belong to later sessions: do not implement or stub them now.");
    expect(terceira).toContain("### Phase 1.2: Extensões");
    expect(terceira).not.toContain("### Phase 1.1: Base");
    expect(construcao[1]!.prompt).toContain("### Phase 1.1: Base");
    expect(construcao[1]!.prompt).not.toContain("### Phase 1.2: Extensões");
  });
});

describe("§130.4 · a task que sozinha passa do orçamento vai inteira", () => {
  it("quatro critérios enormes: a task vira uma parte só, sem corte, e o excesso é dito", async () => {
    const enormes = Array.from({ length: 4 }, (_, posicao) => `O relatório ${posicao + 1} lista ${"cada coluna da planilha consolidada ".repeat(400)}na ordem do cadastro`);
    const plano = envelope([[
      "## Phase 1: Relatórios",
      "",
      "**Goal:** relatórios · **Depends on:** none · **Covers:** US-1",
      "",
      task("1", "src/t1.ts", 2),
      task("2", "src/t2.ts", 4, enormes),
      task("3", "src/t3.ts", 2),
    ].join("\n")]);
    const { outcome, construcao } = await fase(plano, tudoCerto(3));
    expect(outcome.status).toBe("complete");
    expect((await defeitos()).partes?.grupos).toEqual([[1], [2], [3]]);
    for (const criterio of enormes) expect(construcao[1]!.prompt).toContain(criterio);
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.startsWith("entrega") && linha.includes("a task 2 sozinha passa do orçamento") && linha.includes("sem corte de critério"))).toBe(true);
  });
});

describe("§130.5 · sessões independentes e sem memória", () => {
  it("cada parte é uma chamada nova, sem retomada de sessão, e o estado vem do Git", async () => {
    const plano = envelope([faseGrande()]);
    const { construcao } = await fase(plano, tudoCerto());
    expect(construcao.every((chamada) => chamada.resumeSession === undefined && chamada.repair !== true)).toBe(true);
    const segunda = construcao[1]!.prompt;
    expect(segunda).toContain("You are a new session with no memory of them");
    expect(segunda).toContain("Files this phase has changed so far:\n- src/t1.ts\n- src/t2.ts\n- src/t3.ts");
    // A primeira não tem passado a contar.
    expect(construcao[0]!.prompt).not.toContain("Earlier sessions of this phase implemented");
  });
});

describe("§130.6 · retomada depois de interrupção entre partes", () => {
  it("o provider caiu na parte 2: a retomada começa nela, sem refazer a parte 1, e o código dela fica", async () => {
    const plano = envelope([faseGrande()]);
    const primeira = await fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      if (n === 2) return ok("cota", { exitCode: 1, providerFailure: "quota" });
      await implementar(chamada);
      return ok();
    });
    expect(primeira.outcome).toMatchObject({ status: "failed", gate: "gate 0 — engine" });
    expect(primeira.construcao).toHaveLength(2);
    expect(primeira.calls.some((chamada) => chamada.role === "verifier")).toBe(false);
    const t1 = await readFile(join(root, "src", "t1.ts"), "utf8");

    const segunda = await fase(plano, tudoCerto());
    expect(segunda.outcome.status).toBe("complete");
    expect(segunda.construcao.map((chamada) => parteDo(chamada.prompt))).toEqual(["2/5", "3/5", "4/5", "5/5"]);
    expect(await readFile(join(root, "src", "t1.ts"), "utf8")).toBe(t1);
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.includes("1 de 5 feitas; segue da parte 2, que roda de novo sobre o que a sessão interrompida dela deixou, sem refazer as anteriores"))).toBe(true);
  });

  it("o tempo acabou depois de escrever, no meio: a fase para sem julgar o que falta, e a parte roda de novo sobre o próprio parcial", async () => {
    const plano = envelope([faseGrande()]);
    const primeira = await fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      await implementar(chamada);
      return n === 2 ? ok("", { exitCode: 124, timedOut: "wall" }) : ok();
    });
    expect(primeira.outcome).toMatchObject({ status: "failed", gate: "gate 0 — engine" });
    expect(primeira.suites()).toBe(0);
    // A parte 2 não terminou: a 3 nunca ouviu que as tasks 4 e 5 existem.
    expect((await defeitos()).partes).toMatchObject({ feitas: 1, tentada: 2, emCurso: null });
    const segunda = await fase(plano, tudoCerto());
    expect(segunda.construcao.map((chamada) => parteDo(chamada.prompt))).toEqual(["2/5", "3/5", "4/5", "5/5"]);
    expect(segunda.construcao[0]!.prompt).toContain("An earlier session of this part did not finish");
    expect(segunda.construcao[1]!.prompt).not.toContain("An earlier session of this part did not finish");
    expect(segunda.outcome.status).toBe("complete");
  });
});

describe("§130.7 · falha durante a implementação de uma parte", () => {
  it("G0 vermelho numa parte: uma sessão nova só dela, sem defeito, sem reparo, e os gates depois da última", async () => {
    const plano = envelope([faseGrande()]);
    const { outcome, construcao, calls } = await fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      if (n === 2) return ok("erro do engine", { exitCode: 1 });
      await implementar(chamada);
      return ok();
    });
    expect(outcome.status).toBe("complete");
    expect(construcao.map((chamada) => parteDo(chamada.prompt))).toEqual(["1/5", "2/5", "2/5", "3/5", "4/5", "5/5"]);
    expect(construcao[2]!.prompt).toContain("An earlier session of this part did not finish");
    // Nenhum reparo da fase inteira antes dos gates: o verificador lê depois da última parte, uma vez.
    expect(construcao.some((chamada) => chamada.prompt.includes("A previous session tried to implement the phase below"))).toBe(false);
    expect(calls.findIndex((chamada) => chamada.role === "verifier")).toBe(6);
    const estado = await defeitos();
    expect(estado.defects).toEqual([]);
    expect(estado.actions).toBe(0);
  });

  it("a mesma parte falha duas vezes sem escrever: ela não conta como feita, a seguinte não ouve falar dela, e a retomada começa nela", async () => {
    const plano = envelope([faseGrande()]);
    const primeira = await fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      if (n === 2 || n === 3) return ok("erro do engine", { exitCode: 1 });
      await implementar(chamada);
      return ok();
    });
    expect(primeira.outcome).toMatchObject({ status: "failed", gate: "gate 0 — engine" });
    expect(primeira.construcao.map((chamada) => parteDo(chamada.prompt))).toEqual(["1/5", "2/5", "2/5"]);
    expect(primeira.suites()).toBe(0);
    expect((await defeitos()).partes).toMatchObject({ feitas: 1, tentada: 2 });
    expect((await defeitos()).defects).toEqual([]);
    const segunda = await fase(plano, tudoCerto());
    expect(segunda.construcao.map((chamada) => parteDo(chamada.prompt))).toEqual(["2/5", "3/5", "4/5", "5/5"]);
    const terceira = segunda.construcao[1]!.prompt;
    expect(terceira).toContain("- Task 4 — Implementar o módulo 4");
    expect(segunda.outcome.status).toBe("complete");
    expect((await defeitos()).actions).toBe(0);
    expect(await readFile(join(root, "src", "t4.ts"), "utf8")).toContain("feito");
  });
});

describe("§130.8 · nenhuma aprovação prematura", () => {
  it("as partes declaram COMPLETE e nada é aprovado: nem task, nem prova, nem fase, até os gates", async () => {
    const plano = envelope([faseGrande()]);
    const { outcome } = await fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      if (n === 3) return ok("cota", { exitCode: 1, providerFailure: "quota" });
      await implementar(chamada);
      return ok("feito\nCAPIVARA_BUILDER_STATUS: COMPLETE");
    });
    expect(outcome.status).toBe("failed");
    expect(await aprovacoes()).toEqual([]);
    const livro = await evidencias();
    expect(livro.historico().filter((evidencia) => evidencia.gate === "G2" || evidencia.gate === "G3" || evidencia.gate === "G4")).toEqual([]);
    const progresso = replayEvents(await readEvents(runPaths(root, RUN).events));
    expect(progresso.completed).not.toContain("P01");
    const estado = await defeitos();
    expect(estado.implementation).toBe("started");
    expect(estado.partes).toMatchObject({ feitas: 2, tentada: 3, emCurso: null });
  });
});

describe("§130.9 · os gates não mudam e não se repetem por parte", () => {
  it("cinco partes: G0 e G1 por sessão, uma suíte, uma leitura do verificador sobre a fase inteira, tudo depois da última parte", async () => {
    const plano = envelope([faseGrande()]);
    const { calls, suites } = await fase(plano, tudoCerto());
    expect(suites()).toBe(1);
    const leituras = calls.filter((chamada) => chamada.role === "verifier");
    expect(leituras).toHaveLength(1);
    for (const indice of Array.from({ length: 12 }, (_, posicao) => posicao + 1)) expect(leituras[0]!.prompt).toContain(`src/t${indice}.ts`);
    const historico = (await evidencias()).historico();
    expect(historico.filter((evidencia) => evidencia.gate === "G0").map((evidencia) => evidencia.checkId)).toEqual(["sessao-1", "sessao-2", "sessao-3", "sessao-4", "sessao-5"]);
    expect(historico.filter((evidencia) => evidencia.gate === "G1").map((evidencia) => evidencia.checkId)).toEqual(["entrega-1", "entrega-2", "entrega-3", "entrega-4", "entrega-5"]);
    const primeiraDoG2 = historico.findIndex((evidencia) => evidencia.gate === "G2");
    const ultimaDoG1 = historico.map((evidencia) => evidencia.gate).lastIndexOf("G1");
    expect(primeiraDoG2).toBeGreaterThan(ultimaDoG1);
    // As partes são trabalho planejado: nenhuma consome orçamento de reparo nem conta como correção.
    expect((await defeitos()).actions).toBe(0);
    const eventos = await readEvents(runPaths(root, RUN).events);
    expect(eventos.filter((evento) => evento.status === "retry")).toEqual([]);
    expect(eventos.filter((evento) => evento.detail.startsWith("implementação: parte"))).toHaveLength(5);
  });
});

describe("§130.10 · a revalidação por impacto continua valendo sobre a fase feita em partes", () => {
  it("o reparo de src/t12.ts reabre a task 12 e a suíte; as outras onze vão à confirmação com o que mudou, não ao zero", async () => {
    const plano = envelope([faseGrande()]);
    let leituras = 0;
    const { outcome, calls, suites } = await fase(plano, async (chamada) => {
      if (chamada.role === "builder") {
        await implementar(chamada);
        if (parteDo(chamada.prompt) === null) await writeFile(join(root, "src", "t12.ts"), "export const t12 = 'corrigido';\n");
        return ok();
      }
      leituras += 1;
      return ok(leituras === 1 ? `${todasDone(11)}\nTASK 12: INCOMPLETE — CRITERION: a regra 1; OBSERVED: src/t12.ts; EXPECTED: a regra; FIX: corrigir src/t12.ts` : todasDone(12));
    });
    expect(outcome.status).toBe("complete");
    expect(suites()).toBe(2);
    const segunda = calls.filter((chamada) => chamada.role === "verifier")[1]!;
    const confirmar = segunda.prompt.split("## Previously approved — confirm against what changed")[1]!.split("Emit their TASK lines")[0]!;
    for (const indice of Array.from({ length: 11 }, (_, posicao) => posicao + 1)) expect(confirmar).toContain(`- task ${indice}: Implementar o módulo ${indice} em \`src/t${indice}.ts\` — changed since: src/t12.ts`);
    expect(confirmar).not.toContain("- task 12:");
  });
});

describe("§130.11 · build paralelo: as fases independentes seguem paralelas, e cada uma vai em partes no seu worktree", () => {
  const MEIO = (numero: number, titulo: string): string => [
    `## Phase ${numero}: ${titulo}`,
    "",
    `**Goal:** ${titulo} funciona · **Depends on:** Phase 1 · **Covers:** US-${numero}`,
    "",
    ...Array.from({ length: 6 }, (_, posicao) => task(`${numero}${posicao + 1}`, `src/p${numero}/t${posicao + 1}.ts`)),
  ].join("\n");
  const PLANO = envelope([
    ["## Phase 1: Fundação", "", "**Goal:** a base · **Depends on:** none · **Covers:** US-1", "", task("1", "src/p1/t1.ts", 2)].join("\n"),
    MEIO(2, "Cadastro"),
    MEIO(3, "Relatório"),
  ]);
  let cache = "";

  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), "capivara-partes-cache-"));
    await mkdir(join(root, ".capivara", "init"), { recursive: true });
    await writeFile(join(root, ".capivara", "init", "project-phases.md"), PLANO, "utf8");
    await certifyCurrentPlan(root);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "docs: plano"]);
  });
  afterEach(async () => {
    await rm(cache, { recursive: true, force: true });
  });

  it("P02 e P03 rodam ao mesmo tempo, duas partes cada, em ordem, no mesmo worktree da fase", async () => {
    const chamadas: EngineCall[] = [];
    let ativos = 0;
    let pico = 0;
    const outcome = await runBuild({
      projectRoot: root,
      language: "português do Brasil",
      engine: "codex",
      sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache },
      skipAcceptance: true,
      explicitTestCommand: "npm test",
      testRunner: async () => ({ exitCode: 0, output: "passed" }),
      announce: () => undefined,
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: ["execução: paralela, até 2 agentes"],
      },
      call: async (chamada) => {
        chamadas.push(chamada);
        if (chamada.role === "verifier") return ok(todasDone(chamada.phase.taskCount));
        ativos += 1;
        pico = Math.max(pico, ativos);
        await new Promise((resolve) => setTimeout(resolve, 60));
        await implementar(chamada);
        ativos -= 1;
        return ok();
      },
    });
    expect(outcome.exitCode).toBe(0);
    expect(pico).toBe(2);
    const daFase = (id: string) => chamadas.filter((chamada) => chamada.role === "builder" && chamada.phase.id === id);
    expect(daFase("P01").map((chamada) => parteDo(chamada.prompt))).toEqual([null]);
    for (const id of ["P02", "P03"]) {
      expect(daFase(id).map((chamada) => parteDo(chamada.prompt))).toEqual(["1/2", "2/2"]);
      expect(new Set(daFase(id).map((chamada) => chamada.root)).size).toBe(1);
    }
    expect(daFase("P02")[0]!.root).not.toBe(daFase("P03")[0]!.root);
    const historico = (await git(["log", "--format=%s"])).split("\n");
    expect(historico.filter((linha) => linha.startsWith("feat(phase-"))).toHaveLength(3);
    for (const numero of [2, 3]) for (const indice of [1, 2, 3, 4, 5, 6]) {
      expect(await readFile(join(root, "src", `p${numero}`, `t${indice}.ts`), "utf8")).toContain("feito");
    }
    const progresso = replayEvents(await readEvents(runPaths(root, runIdFor("build", sha12(PLANO))).events));
    expect([...progresso.completed].sort()).toEqual(["P01", "P02", "P03"]);
  });
});

describe("§130.12 · o contrato arquitetural vai inteiro a cada parte, e nada certificado muda", () => {
  it("a fatia e o contrato compartilhado em toda sessão; o esqueleto e o plano ficam byte a byte", async () => {
    await mkdir(join(root, ".capivara", "init"), { recursive: true });
    const esqueleto = "# Módulos — Skeleton\n\n## Stack\n\n- Node 24 com TypeScript\n\n## Regras\n\n- testes.requisito: cada módulo com teste próprio\n";
    await writeFile(join(root, ".capivara", "init", "skeleton.md"), esqueleto);
    const plano = envelope([faseGrande()]);
    await writeFile(join(root, ".capivara", "init", "project-phases.md"), plano);
    const fatia: FatiaDaArquitetura = {
      texto: "### Componentes\n- modulos: src/ — expõe `registrar(modulo)`; consome `base` de src/base.ts",
      sha12: sha12("fatia v1"), componentes: ["modulos"], arquivos: ["src/"], contratos: ["modulos: registrar(modulo)"], contratosProprios: ["registrar(modulo)"], consumidoras: [],
    };
    const { construcao } = await fase(plano, tudoCerto(), { architecture: fatia });
    expect(construcao).toHaveLength(5);
    for (const chamada of construcao) {
      expect(chamada.prompt).toContain("## Architecture decided by the plan for this phase");
      expect(chamada.prompt).toContain(fatia.texto);
      expect(chamada.prompt).toContain("- testes.requisito: cada módulo com teste próprio");
      expect(chamada.prompt).toContain("Install the dependencies the approved infrastructure declares");
    }
    expect(await readFile(join(root, ".capivara", "init", "skeleton.md"), "utf8")).toBe(esqueleto);
    expect(await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8")).toBe(plano);
  });
});

describe("§130.13 · a mudança de contrato e o parcial descartado invalidam o progresso", () => {
  async function interromperNaParte2(plano: string, extra: Partial<PhaseRunOptions> = {}) {
    return fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      if (n === 2) return ok("cota", { exitCode: 1, providerFailure: "quota" });
      await implementar(chamada);
      return ok();
    }, extra);
  }

  it("o contrato compartilhado mudou: a divisão anterior não vale, a fase é dividida de novo e o código da parte 1 fica", async () => {
    await mkdir(join(root, ".capivara", "init"), { recursive: true });
    await writeFile(join(root, ".capivara", "init", "skeleton.md"), "# S\n\n## Regras\n\n- persistencia: em arquivo\n");
    const plano = envelope([faseGrande()]);
    await interromperNaParte2(plano);
    await writeFile(join(root, ".capivara", "init", "skeleton.md"), "# S\n\n## Regras\n\n- persistencia: em SQLite\n");
    const segunda = await fase(plano, tudoCerto());
    expect(parteDo(segunda.construcao[0]!.prompt)).toBe("1/5");
    expect(await readFile(join(root, "src", "t1.ts"), "utf8")).toContain("feito");
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.includes("a divisão anterior em partes não vale mais (a fase, a fatia da arquitetura ou o contrato mudou desde a divisão)"))).toBe(true);
  });

  it("a fatia da arquitetura mudou: idem", async () => {
    const plano = envelope([faseGrande()]);
    const fatia = (versao: string): FatiaDaArquitetura => ({ texto: `fatia ${versao}`, sha12: sha12(versao), componentes: [], arquivos: [], contratos: [], contratosProprios: [], consumidoras: [] });
    await interromperNaParte2(plano, { architecture: fatia("v1") });
    const segunda = await fase(plano, tudoCerto(), { architecture: fatia("v2") });
    expect(parteDo(segunda.construcao[0]!.prompt)).toBe("1/5");
  });

  it("o trabalho de uma parte feita sumiu por fora (o parcial não voltou inteiro): a divisão não vale, e o que ficou não é apagado", async () => {
    const plano = envelope([faseGrande()]);
    await fase(plano, async (chamada, n) => {
      if (chamada.role !== "builder") return ok(todasDone(12));
      if (n === 3) return ok("cota", { exitCode: 1, providerFailure: "quota" });
      await implementar(chamada);
      return ok();
    });
    await rm(join(root, "src", "t2.ts"));
    const segunda = await fase(plano, tudoCerto());
    expect(parteDo(segunda.construcao[0]!.prompt)).toBe("1/5");
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.includes("o que as partes escreveram mudou por fora em src/t2.ts"))).toBe(true);
    expect(segunda.outcome.status).toBe("complete");
  });

  it("o parcial foi descartado (git checkout e clean): a fase recomeça da parte 1", async () => {
    const plano = envelope([faseGrande()]);
    await interromperNaParte2(plano);
    await git(["checkout", "--", "."]);
    await git(["clean", "-fdq"]);
    const segunda = await fase(plano, tudoCerto());
    expect(parteDo(segunda.construcao[0]!.prompt)).toBe("1/5");
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.includes("o parcial foi descartado"))).toBe(true);
  });
});

describe("§130.14 · sem capacidade conhecida do modelo: a política fixa, a mesma para qualquer engine", () => {
  it("os limites são de política, a divisão é determinística e não depende do engine", async () => {
    expect(ORCAMENTO_DA_PARTE).toEqual({ criterios: 15, caracteres: 48_000, pisoDasTasks: 16_000 });
    const markdown = sessao(envelope([faseGrande()])).markdown;
    const medir = (indices: readonly number[]): number => (recorteDaFase(markdown, indices) ?? "").length + 20_000;
    expect(dividirEmPartes(markdown, medir)).toEqual(dividirEmPartes(markdown, medir));
    const porEngine: number[][][] = [];
    for (const engine of ["codex", "claude"]) {
      await rm(join(root, ".capivara", "runs"), { recursive: true, force: true });
      await fase(envelope([faseGrande()]), tudoCerto(), { engine });
      porEngine.push((await defeitos()).partes!.grupos);
    }
    expect(porEngine[0]).toEqual(porEngine[1]);
  });

  it("o contexto fixo grande não multiplica as sessões: as tasks ainda têm o piso", () => {
    const markdown = sessao(envelope([faseGrande()])).markdown;
    // 60 mil caracteres só de contexto fixo: o teto vira o fixo mais o piso, e o critério continua mandando.
    const divisao = dividirEmPartes(markdown, (indices) => 60_000 + (recorteDaFase(markdown, indices) ?? "").length - (recorteDaFase(markdown, []) ?? "").length);
    expect(divisao.limite).toBe(76_000);
    expect(divisao.partes.map((parte) => parte.indices)).toEqual([[1, 2, 3], [4, 5], [6, 7, 8], [9, 10, 11], [12]]);
  });
});

describe("§130.15 · a fase só fecha inteira", () => {
  it("depois da última parte, a task 2 incompleta segura a fase até o reparo; só então ela fecha", async () => {
    const plano = envelope([faseGrande()]);
    let leituras = 0;
    const { outcome, construcao } = await fase(plano, async (chamada) => {
      if (chamada.role === "builder") {
        await implementar(chamada);
        return ok();
      }
      leituras += 1;
      return ok(leituras === 1 ? todasDone(12).replace("TASK 2: DONE", "TASK 2: INCOMPLETE — CRITERION: a regra 3; OBSERVED: falta; EXPECTED: a regra; FIX: src/t2.ts") : todasDone(12));
    });
    expect(outcome.status).toBe("complete");
    expect(construcao).toHaveLength(6);
    expect(leituras).toBe(2);
    expect((await defeitos()).implementation).toBe("done");
  });
});

describe("§130 · compatibilidade com planos e runs existentes", () => {
  it("estado de antes da §130, com a implementação começada e sem partes: a fase é dividida e começa da parte 1", async () => {
    const plano = envelope([faseGrande()]);
    await mkdir(defeitosDoRun(runPaths(root, RUN).root), { recursive: true });
    await writeFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), JSON.stringify({
      contract: "capivara-defects/v1", runId: RUN, phaseId: "P01", implementation: "started", cycle: 1, builderSessions: 1, actions: 0, seq: 0, defects: [], updatedAt: new Date().toISOString(),
    }));
    const { outcome, construcao } = await fase(plano, tudoCerto());
    expect(outcome.status).toBe("complete");
    expect(parteDo(construcao[0]!.prompt)).toBe("1/5");
  });

  it("estado de antes da §130, com a implementação feita: nenhuma parte roda, só os gates", async () => {
    const plano = envelope([faseGrande()]);
    for (let indice = 1; indice <= 12; indice += 1) await writeFile(join(root, "src", `t${indice}.ts`), "export const feito = 1;\n");
    const { estadoDoCodigo } = await import("../../src/loop/git.js");
    const agora = await estadoDoCodigo(root);
    await mkdir(defeitosDoRun(runPaths(root, RUN).root), { recursive: true });
    await writeFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), JSON.stringify({
      contract: "capivara-defects/v1", runId: RUN, phaseId: "P01", implementation: "done", cycle: 1, builderSessions: 1, actions: 0, seq: 0, defects: [],
      ultimoEstado: { tree: agora.tree, at: new Date().toISOString() }, updatedAt: new Date().toISOString(),
    }));
    const { outcome, construcao } = await fase(plano, tudoCerto());
    expect(outcome.status).toBe("complete");
    expect(construcao).toHaveLength(0);
  });

  it("plano sem sub-fases nem Areas: a divisão segue só os critérios", async () => {
    const plano = envelope([faseGrande(1, false)]);
    const { outcome } = await fase(plano, tudoCerto());
    expect(outcome.status).toBe("complete");
    expect((await defeitos()).partes?.grupos).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
  });
});

describe("§130 · o recorte da fase é o texto do plano", () => {
  const markdown = (): string => {
    const split = splitPhases(envelope([PEQUENA, PEQUENA.replace("## Phase 1: Pequena", "## Phase 2: Pequena"), faseGrande(3)]), root, RUN);
    if (!split.ok) throw new Error(JSON.stringify(split.errors));
    return split.sessions[2]!.markdown;
  };

  it("cada task recortada tem o mesmo texto canônico da fase inteira, com a fase numerada como no plano", () => {
    const fase3 = parsePhaseFragment(markdown())!;
    for (const original of fase3.tasks) {
      const recorte = recorteDaFase(markdown(), [original.index])!;
      const lida = parsePhaseFragment(recorte)!;
      expect(lida.number).toBe(3);
      expect(lida.tasks.map(shaDaTask)).toEqual([shaDaTask(original)]);
      expect(recorte.startsWith("## Phase 3: Módulos\n\n**Goal:** os doze módulos funcionam")).toBe(true);
    }
  });

  it("sem índice, só o cabeçalho; índice que a fase não tem, null", () => {
    expect(recorteDaFase(markdown(), [])).toBe("## Phase 3: Módulos\n\n**Goal:** os doze módulos funcionam · **Depends on:** none · **Covers:** US-1\n");
    expect(recorteDaFase(markdown(), [13])).toBeNull();
  });
});

describe("§130 · o que a revisão adversarial achou", () => {
  const caiNaParte = (parte: number) => async (chamada: EngineCall, n: number): Promise<EngineResult> => {
    if (chamada.role !== "builder") return ok(todasDone(12));
    if (n === parte) return ok("cota", { exitCode: 1, providerFailure: "quota" });
    await implementar(chamada);
    return ok();
  };

  it("o arquivo de uma parte feita ganhou outra versão por fora (o parcial reaplicado em parte): a divisão não vale", async () => {
    const plano = envelope([faseGrande()]);
    await fase(plano, caiNaParte(3));
    await writeFile(join(root, "src", "t1.ts"), "export const outra = 'versão da árvore integrada';\n");
    const segunda = await fase(plano, tudoCerto());
    expect(parteDo(segunda.construcao[0]!.prompt)).toBe("1/5");
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.includes("o que as partes escreveram mudou por fora em src/t1.ts"))).toBe(true);
  });

  it("sem Git: a retomada sobre o mesmo código segue da parte parada; o código mudado por fora invalida, porque não se sabe o quê", async () => {
    await rm(join(root, ".git"), { recursive: true, force: true });
    const plano = envelope([faseGrande()]);
    await fase(plano, caiNaParte(2));
    const segunda = await fase(plano, caiNaParte(1));
    expect(parteDo(segunda.construcao[0]!.prompt)).toBe("2/5");
    await rm(join(root, "src", "t1.ts"));
    const terceira = await fase(plano, tudoCerto());
    expect(parteDo(terceira.construcao[0]!.prompt)).toBe("1/5");
    const transicoes = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(transicoes.some((linha) => linha.includes("sem histórico Git não se sabe o quê"))).toBe(true);
  });

  it("o que mudou fora das partes (um commit de outra frente) não as invalida e não entra na lista do que a fase mudou", async () => {
    const plano = envelope([faseGrande()]);
    await fase(plano, caiNaParte(2));
    await mkdir(join(root, "src", "outra"), { recursive: true });
    await writeFile(join(root, "src", "outra", "x.ts"), "export const x = 1;\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "outra frente"]);
    const segunda = await fase(plano, tudoCerto());
    const parte2 = segunda.construcao[0]!.prompt;
    expect(parteDo(parte2)).toBe("2/5");
    expect(parte2).toContain("Files this phase has changed so far:\n- src/t1.ts\n- src/t2.ts\n- src/t3.ts\n");
    expect(parte2).not.toContain("src/outra/x.ts");
  });

  it("a parada no meio das partes não deixa registro velho: a retomada depois dos gates não abre sessão da fase inteira", async () => {
    const plano = envelope([faseGrande()]);
    await fase(plano, caiNaParte(2));
    const segunda = await fase(plano, async (chamada) => {
      if (chamada.role === "verifier") return ok("Not logged in · Please run /login");
      await implementar(chamada);
      return ok();
    });
    expect(segunda.outcome.status).toBe("credential-rejected");
    const terceira = await fase(plano, tudoCerto());
    expect(terceira.outcome.status).toBe("complete");
    expect(terceira.construcao).toHaveLength(0);
  });

  it("a nota que o plano pôs entre tasks, sob um ### que não é sub-fase, vai a toda parte", async () => {
    const nota = "### Notas de integração\n\nTodo módulo registra a si mesmo no índice `src/index.ts` ao ser importado.\n";
    const plano = envelope([faseGrande().replace("- [ ] **Task:** Implementar o módulo 4 em", `${nota}\n- [ ] **Task:** Implementar o módulo 4 em`)]);
    const { construcao } = await fase(plano, tudoCerto());
    expect(construcao).toHaveLength(5);
    for (const chamada of construcao) expect(chamada.prompt).toContain("Todo módulo registra a si mesmo no índice `src/index.ts` ao ser importado.");
  });

  it("a parte se identifica como parte: na chamada e nos arquivos de prompt e log, não como ciclo", async () => {
    const plano = envelope([faseGrande()]);
    const { construcao } = await fase(plano, tudoCerto());
    expect(construcao.map((chamada) => chamada.parte)).toEqual(["1/5", "2/5", "3/5", "4/5", "5/5"]);
    const { readdir } = await import("node:fs/promises");
    const prompts = await readdir(runPaths(root, RUN).prompts);
    const logs = await readdir(runPaths(root, RUN).logs);
    for (const numero of [1, 2, 3, 4, 5]) {
      expect(prompts).toContain(`P01.part-${numero}-of-5.txt`);
      expect(logs).toContain(`P01.part-${numero}-of-5.log`);
    }
    expect(prompts.some((nome) => nome.startsWith("P01.cycle-"))).toBe(false);
  });
});
