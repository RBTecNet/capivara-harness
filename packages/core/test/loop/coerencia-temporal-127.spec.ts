/**
 * §127 — o G4 cobra o fluxo quando ele pode ser cobrado: o build inteiro, com
 * Git real, provider falso e o runner de fluxos falso.
 *
 * A fixture é a forma mínima do incidente do Luna (0.7.0, `build-8e24c805009f`):
 * fundação, um módulo de tarefas que se integra sozinho, um módulo de
 * categorias "pronto para a integração … na fase 4" (o roteador "exportado sem
 * registro no servidor central"), e a fase 4, que integra categorias. Na 0.7.0
 * o G4 cobrou o fluxo de categorias na fase 3, o G3 cobrou a proibição, e o
 * executor pôs e tirou a integração até esgotar três ciclos.
 */

import { certifyCurrentPlan } from "../support/current-plan.js";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { LivroDeEvidencias } from "../../src/loop/evidencias.js";
import { lerTransicoes } from "../../src/loop/narrador.js";
import { defeitosDoRun, type EstadoDaRecuperacao } from "../../src/loop/defeitos.js";
import { stepLabel } from "../../src/prompts/index.js";
import { runPaths } from "../../src/state/index.js";
import type { Skeleton } from "../../src/contract/index.js";

const run = promisify(execFile);
let projectRoot = "";
let cache = "";

async function git(args: string[]): Promise<string> {
  return (await run("git", args, { cwd: projectRoot })).stdout.trim();
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-127-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-127-cache-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

const FLUXOS = [
  { number: "1", name: "Gestão de tarefas", steps: ["Cadastrar uma tarefa com título obrigatório.", "Consultar tarefas cadastradas."] },
  { number: "2", name: "Gestão de categorias", steps: ["Cadastrar uma categoria com nome obrigatório e único.", "Consultar categorias cadastradas."] },
];

interface FaseDoPlano {
  numero: number;
  titulo: string;
  goal: string;
  depende: string;
  cobre: string[];
  task: string;
  criterio: string;
}

const FUNDACAO: FaseDoPlano = {
  numero: 1, titulo: "Fundação", goal: "Persistência, servidor com registro de rotas e shell com navegação.", depende: "none", cobre: ["US-1.1"],
  task: "Em `package.json`, declarar os scripts `start` e `test`.", criterio: "`package.json` declara `start` e `test`.",
};
const TAREFAS: FaseDoPlano = {
  numero: 2, titulo: "Gestão de tarefas", goal: "Implementar o CRUD de tarefas, registrado no servidor e na navegação.", depende: "Phase 1", cobre: ["tarefas", "workflow 1"],
  task: "Em `server/modulos/tarefas/routes.ts`, implementar e registrar o roteador de tarefas.", criterio: "`GET /api/tarefas` retorna `200` pela aplicação.",
};
/** O texto do Luna, reduzido: a fase 3 entrega categorias "pronta para a integração … na fase 4". */
const CATEGORIAS_ADIADA: FaseDoPlano = {
  numero: 3, titulo: "Gestão de categorias",
  goal: "Implementar o CRUD de categorias, entregando a página do módulo pronta para a integração da entrada compartilhada e da navegação na fase 4.",
  depende: "Phase 1", cobre: ["categorias", "workflow 2"],
  task: "Em `server/modulos/categorias/routes.ts`, implementar e exportar `categoriasRouter`.", criterio: "O roteador é exportado sem registro no servidor central.",
};
const INTEGRACAO: FaseDoPlano = {
  numero: 4, titulo: "Integração da aplicação", goal: "Conectar o roteador e a página de categorias ao servidor e à navegação compartilhada.",
  depende: "Phase 2, Phase 3", cobre: ["workflow 2"],
  task: "Em `server/api/index.ts`, montar `categoriasRouter` sob `/api/categorias`.", criterio: "`GET /api/categorias` retorna `200` pela aplicação.",
};

function bloco(fase: FaseDoPlano): string {
  return [
    `## Phase ${fase.numero}: ${fase.titulo}`,
    "",
    `**Goal:** ${fase.goal} · **Depends on:** ${fase.depende} · **Covers:** ${fase.cobre.join(", ")}`,
    "",
    `- [ ] **Task:** ${fase.task}`,
    "  - **Acceptance criteria:**",
    `    - ${fase.criterio}`,
    `  - **Traces:** ${fase.cobre.join(" / ")}`,
    "",
  ].join("\n");
}

async function publicar(fases: FaseDoPlano[], workflows = FLUXOS): Promise<NonNullable<BuildOptions["skeleton"]>> {
  const plano = [
    "# Lab — Project Phases",
    "",
    "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
    "",
    "## Overview",
    "",
    "Fundação, módulos e integração.",
    "",
    ...fases.map(bloco),
    "## Open Questions",
    "",
    "Nenhuma.",
    "",
  ].join("\n");
  await writeFile(join(projectRoot, ".capivara", "init", "project-phases.md"), plano, "utf8");
  await certifyCurrentPlan(projectRoot);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "docs: plano"]);
  const esqueleto: Skeleton = {
    contract: "capivara-skeleton/v2",
    projectName: "Lab",
    stack: [{ component: "linguagem", decision: "TypeScript" }],
    environment: [],
    entities: [],
    stories: [],
    workflows,
    rules: [],
    phases: fases.map((fase) => ({ number: fase.numero, title: fase.titulo, goal: fase.goal, dependsOn: fase.depende, covers: fase.cobre, areas: ["backend"], taskCount: 1 })),
    mvpCutPhase: fases.length,
  };
  return esqueleto;
}

const MANIFESTO = JSON.stringify({ name: "lab", scripts: { start: "node server.js", test: "echo ok" } });

/** O provider falso: o executor escreve o arquivo da fase; o roteirista devolve o roteiro do fluxo pedido; o verificador aprova. */
function motor(opcoes: { juntas?: string[]; triagem?: string } = {}) {
  const chamadas: EngineCall[] = [];
  const intervalos = new Map<string, { inicio: number; fim: number }>();
  const iniciadas = new Set<string>();
  let liberar!: () => void;
  const barreira = new Promise<void>((resolve) => { liberar = resolve; });
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });
    if (chamada.role === "verifier") {
      if (chamada.prompt.includes("You write ONE Playwright script")) {
        const fluxo = FLUXOS.find((item) => chamada.prompt.includes(`workflow ${item.number}: ${item.name}`))!;
        const passos = fluxo.steps.map((passo, indice) => `  await test.step('${stepLabel(indice, passo)}', async () => { await page.goto('/'); await expect(page.getByRole('main')).toBeVisible(); });`);
        return ok(["```ts", "import { expect, test } from '@playwright/test';", `test('workflow ${fluxo.number}', async ({ page }) => {`, ...passos, "});", "```"].join("\n"));
      }
      if (chamada.purpose === "flow-triage") return ok(opcoes.triagem ?? "");
      return ok("TASK 1: DONE");
    }
    const raiz = chamada.root ?? projectRoot;
    const inicio = Date.now();
    if (opcoes.juntas?.includes(chamada.phase.id)) {
      iniciadas.add(chamada.phase.id);
      if (opcoes.juntas.every((fase) => iniciadas.has(fase))) liberar();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`as fases ${opcoes.juntas!.join(", ")} não começaram juntas`)), 8000);
        void barreira.then(() => { clearTimeout(timer); resolve(); });
      });
    }
    if (chamada.phase.id === "P01" && !(await readFile(join(raiz, "package.json"), "utf8").then(() => true, () => false))) await writeFile(join(raiz, "package.json"), MANIFESTO, "utf8");
    await writeFile(join(raiz, `${chamada.phase.id.toLowerCase()}-${chamada.attempt}.txt`), `${chamada.phase.id}\n`, "utf8");
    // A sessão de implementação: é ela que a barreira faz começar junto; uma correção posterior não a substitui.
    if (!intervalos.has(chamada.phase.id)) intervalos.set(chamada.phase.id, { inicio, fim: Date.now() });
    return ok("feito");
  };
  return { call, chamadas, intervalos };
}

async function construir(
  esqueleto: NonNullable<BuildOptions["skeleton"]>,
  engine: ReturnType<typeof motor>,
  flowRunner: NonNullable<BuildOptions["flowRunner"]>,
  extra: Partial<BuildOptions> = {},
) {
  const anuncios: string[] = [];
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache },
    skipAcceptance: true,
    explicitTestCommand: "npm test",
    testRunner: async () => ({ exitCode: 0, output: "1 passed" }),
    skeleton: esqueleto,
    flowRunner,
    announce: (mensagem) => anuncios.push(mensagem),
    ...extra,
  });
  return { outcome, anuncios };
}

/** O runner de fluxos falso: verde, e guarda o que cada passagem percorreu. */
function corredor(falhas: (scripts: string[], passagem: number) => string | null = () => null) {
  const passagens: string[][] = [];
  const runner: NonNullable<BuildOptions["flowRunner"]> = async (_root, scripts) => {
    passagens.push([...scripts]);
    const saida = falhas(scripts, passagens.length);
    return saida === null ? { exitCode: 0, output: `${scripts.length} passed` } : { exitCode: 1, output: saida };
  };
  return { runner, passagens };
}

describe("§127 · G4 com a integração posterior que o plano declara", () => {
  it("2, 4, 14 — a fase 3 não percorre o fluxo de categorias; ele fica registrado como obrigação e passa na fase 4, com a regressão", async () => {
    const esqueleto = await publicar([FUNDACAO, TAREFAS, CATEGORIAS_ADIADA, INTEGRACAO]);
    const engine = motor();
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);

    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    // P2 percorre o seu; P3 só a regressão (o fluxo 2 ficou para a P4); P4 a regressão e o fluxo 2.
    expect(fluxos.passagens).toEqual([["workflow-1.spec.ts"], ["workflow-1.spec.ts"], ["workflow-1.spec.ts", "workflow-2.spec.ts"]]);
    // Nenhum roteiro do fluxo 2 foi pedido na fase 3: nada foi pago para cobrar o que não pode passar.
    expect(engine.chamadas.filter((chamada) => chamada.phase.id === "P03" && chamada.prompt.includes("workflow 2: Gestão de categorias"))).toEqual([]);

    const livro = await LivroDeEvidencias.abrir(runPaths(projectRoot, outcome.runId).root, outcome.runId);
    const adiado = livro.atual("P03", "adiado-2");
    expect(adiado?.evidence).toMatchObject({ gate: "G4", outcome: "NOT_APPLICABLE", inputs: { extra: { para: "P04" } } });
    expect(adiado?.evidence.claim).toContain("na fase 4");
    // A obrigação não é aprovação: a fase 3 não tem prova do fluxo 2; a fase 4 tem.
    expect(livro.atual("P03", "fluxo-2")).toBeNull();
    expect(livro.atual("P04", "fluxo-2")?.evidence.outcome).toBe("PASS");
    expect(livro.atual("P04", "fluxo-1")?.evidence.outcome).toBe("PASS");

    const transicoes = await lerTransicoes(projectRoot, outcome.runId);
    expect(transicoes.some((transicao) => transicao.fase === "P03" && transicao.linha.startsWith("fluxo adiado") && transicao.linha.includes("P04"))).toBe(true);
  }, 60_000);

  it("1, 17 — integração progressiva: a fase do módulo percorre o próprio fluxo, como sempre", async () => {
    const CATEGORIAS_PROGRESSIVA: FaseDoPlano = {
      ...CATEGORIAS_ADIADA,
      goal: "Implementar o CRUD de categorias, registrado no servidor e na navegação.",
      criterio: "`GET /api/categorias` retorna `200` pela aplicação.",
    };
    const esqueleto = await publicar([FUNDACAO, TAREFAS, CATEGORIAS_PROGRESSIVA]);
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, motor(), fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens).toEqual([["workflow-1.spec.ts"], ["workflow-1.spec.ts", "workflow-2.spec.ts"]]);
    const transicoes = await lerTransicoes(projectRoot, outcome.runId);
    expect(transicoes.some((transicao) => transicao.linha.startsWith("fluxo adiado"))).toBe(false);
  }, 60_000);

  it("3 — a integração é desta fase e não veio: o G4 reprova nela, e o defeito ancora no passo do roteiro", async () => {
    const CATEGORIAS_PROGRESSIVA: FaseDoPlano = { ...CATEGORIAS_ADIADA, goal: "Implementar o CRUD de categorias, registrado no servidor e na navegação." };
    const esqueleto = await publicar([FUNDACAO, TAREFAS, CATEGORIAS_PROGRESSIVA]);
    const triagem = [
      "CAPIVARA_TRIAGEM: PRODUTO",
      "CAPIVARA_CRITERIO: a página de categorias acessível pela aplicação",
      "CAPIVARA_EVIDENCIA: o snapshot mostra só o painel",
      "CAPIVARA_ONDE: Rota `/categorias`, na página de categorias.",
      "CAPIVARA_CORRECAO: registrar a rota `/categorias`",
    ].join("\n");
    const fluxos = corredor((scripts, passagem) =>
      passagem === 2 && scripts.includes("workflow-2.spec.ts")
        ? "  ✘  2 [workflow-2] › workflow-2.spec.ts:3:1 › workflow 2 (1.0m)\n  1) [workflow-2] › workflow-2.spec.ts:3:1 › workflow 2 › passo 1: Cadastrar uma categoria com nome obrigatório e único.\n    Error: locator.click: Test timeout"
        : null);
    const { outcome, anuncios } = await construir(esqueleto, motor({ triagem }), fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    const estado = JSON.parse(await readFile(join(defeitosDoRun(runPaths(projectRoot, outcome.runId).root), "P03.json"), "utf8")) as EstadoDaRecuperacao;
    const doFluxo = estado.defects.filter((defeito) => defeito.gates.includes("G4"));
    expect(doFluxo).toHaveLength(1);
    expect(doFluxo[0]!.anchors).toMatchObject({ workflow: "2", step: "passo 1" });
    expect(doFluxo[0]!.status).toBe("RESOLVED");
  }, 60_000);

  it("6 — a fase proíbe a integração sem nomear a fase que a faz: o fluxo continua cobrado nela, nunca dispensado", async () => {
    const CATEGORIAS_SEM_FASE: FaseDoPlano = { ...CATEGORIAS_ADIADA, goal: "Implementar o CRUD de categorias, com a página pronta para integração." };
    const esqueleto = await publicar([FUNDACAO, TAREFAS, CATEGORIAS_SEM_FASE, INTEGRACAO]);
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, motor(), fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens[1]).toEqual(["workflow-1.spec.ts", "workflow-2.spec.ts"]);
  }, 60_000);

  it("5 — o build não se declara concluído com um fluxo obrigatório que nunca foi percorrido", async () => {
    const terceiro = { number: "3", name: "Gestão de anotações", steps: ["Cadastrar uma anotação."] };
    const esqueleto = await publicar([FUNDACAO, TAREFAS], [...FLUXOS.slice(0, 1), terceiro]);
    const { outcome } = await construir(esqueleto, motor(), corredor().runner);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("fluxo obrigatório pendente");
    expect(outcome.errors.join("\n")).toContain("o fluxo 3 (Gestão de anotações) nunca foi percorrido");
    // O que passou continua passado: as duas fases fecharam e estão no histórico.
    expect(outcome.phases.map((fase) => fase.outcome.status)).toEqual(["complete", "complete"]);
    expect((await git(["log", "--format=%s"])).split("\n").filter((linha) => linha.startsWith("feat(phase-"))).toHaveLength(2);
  }, 60_000);
});

describe("§127 · 12 — módulos independentes continuam no paralelo", () => {
  it("as fases de tarefas e de categorias correm juntas, e o adiamento vale também no worktree", async () => {
    // Com o `start` já declarado, nenhuma fase prepara a fundação sozinha (§110): o que se mede é só a concorrência.
    await writeFile(join(projectRoot, "package.json"), MANIFESTO, "utf8");
    const esqueleto = await publicar([FUNDACAO, TAREFAS, CATEGORIAS_ADIADA, INTEGRACAO]);
    const engine = motor({ juntas: ["P02", "P03"] });
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner, {
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: ["execução: paralela, até 2 agentes"],
      },
    });
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    const p2 = engine.intervalos.get("P02")!;
    const p3 = engine.intervalos.get("P03")!;
    expect(p2.inicio < p3.fim && p3.inicio < p2.fim).toBe(true);
    // Nenhuma passagem do G4 percorreu o fluxo 2 antes da P04: a última é a única que o tem.
    expect(fluxos.passagens.filter((passagem) => passagem.includes("workflow-2.spec.ts"))).toHaveLength(1);
    expect(fluxos.passagens.at(-1)).toContain("workflow-2.spec.ts");
  }, 90_000);
});

/*
 * A revisão adversarial da primeira versão desta correção (§127.6), cada
 * defeito confirmado com o cenário que o reproduziu.
 */
describe("§127 · revisão adversarial", () => {
  it("C2 — a fase que adia roda de novo (um critério mudou) e a que completa continua fechada: ela volta a ser verificada, e o fluxo é percorrido sobre o código novo", async () => {
    const primeiro = await publicar([FUNDACAO, TAREFAS, CATEGORIAS_ADIADA, INTEGRACAO]);
    const fluxos = corredor();
    expect((await construir(primeiro, motor(), fluxos.runner)).outcome.exitCode).toBe(0);
    fluxos.passagens.length = 0;
    const alterada: FaseDoPlano = { ...CATEGORIAS_ADIADA, task: "Em `server/modulos/categorias/routes.ts`, implementar e exportar `categoriasRouter`, agora com o campo cor." };
    const segundo = await publicar([FUNDACAO, TAREFAS, alterada, INTEGRACAO]);
    const engine = motor();
    const { outcome, anuncios } = await construir(segundo, engine, fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens.some((passagem) => passagem.includes("workflow-2.spec.ts"))).toBe(true);
    expect(anuncios.some((linha) => linha.includes("[P04]") && linha.includes("o fluxo 2, que a P03 deixa para esta fase"))).toBe(true);
    // A P04 volta só para ser verificada: nenhuma sessão de implementação; P01 e P02, que nada reabre, nem chamada têm.
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder").map((chamada) => chamada.phase.id)).toEqual(["P03"]);
  }, 120_000);

  it("C3 — um critério com rótulos de prioridade (P1, P2 ou P3) não adia fluxo nenhum: o build lê o envelope, como o plano", async () => {
    const PRIORIDADES: FaseDoPlano = { ...TAREFAS, criterio: "O campo prioridade aceita P1, P2 ou P3; `p5.js` desenha o gráfico." };
    const PAINEL: FaseDoPlano = {
      numero: 3, titulo: "Painel", goal: "Painel com as tarefas e as categorias.", depende: "Phase 2", cobre: ["workflow 1", "workflow 2"],
      task: "Em `src/painel.tsx`, implementar o painel.", criterio: "O painel lista tarefas e categorias.",
    };
    const fluxos = corredor();
    const { outcome } = await construir(await publicar([FUNDACAO, PRIORIDADES, PAINEL]), motor(), fluxos.runner);
    expect(outcome.exitCode).toBe(0);
    expect(fluxos.passagens[0]).toEqual(["workflow-1.spec.ts"]);
  }, 60_000);
});

describe("§127 · C4 — a fase fora da arquitetura não apaga os adiamentos das outras", () => {
  it("o Luna com uma fase 7 que o `change` acrescentou: a fase 2 continua deixando o workflow 1 para a fase 6", async () => {
    const { readFileSync } = await import("node:fs");
    const { vincularArquitetura, disponibilidadeNoBuild } = await import("../../src/loop/arquitetura.js");
    const { renderArchitecture } = await import("../../src/contract/index.js");
    const FIX = join(import.meta.dirname, "..", "fixtures");
    const arquitetura = JSON.parse(readFileSync(join(FIX, "luna-127.architecture.json"), "utf8")) as import("../../src/contract/index.js").Architecture;
    const esqueleto = JSON.parse(readFileSync(join(FIX, "luna-127.skeleton.json"), "utf8")) as Skeleton;
    const plano = readFileSync(join(FIX, "luna-127.project-phases.md"), "utf8");
    await writeFile(join(projectRoot, ".capivara", "init", "architecture.md"), renderArchitecture(arquitetura, esqueleto), "utf8");
    const fase7 = ["", "## Phase 7: Exportação CSV", "", "**Goal:** Exportar tarefas em CSV. · **Depends on:** Phase 6 · **Covers:** US-2.1 · **Areas:** backend", "",
      "- [ ] **Task:** Em `server/exportar.ts`, implementar a exportação.", "  - **Acceptance criteria:**", "    - `GET /api/exportar` retorna `200` com CSV.", "  - **Traces:** US-2.1", ""].join("\n");
    const comFase7 = { ...esqueleto, phases: [...esqueleto.phases, { number: 7, title: "Exportação CSV", goal: "Exportar tarefas em CSV.", dependsOn: "Phase 6", covers: ["US-2.1"], areas: ["backend"], taskCount: 1 }] };
    const vinculo = await vincularArquitetura(projectRoot, `${plano.trimEnd()}\n${fase7}`, arquitetura, comFase7);
    const disponibilidade = disponibilidadeNoBuild(comFase7, vinculo.tempo());
    expect(disponibilidade.adiados(2)).toEqual([expect.objectContaining({ workflow: "1", para: 6, motivo: expect.objectContaining({ tipo: "caminho" }) })]);
    expect(disponibilidade.adiados(4)).toEqual([expect.objectContaining({ workflow: "3", para: 6 })]);
  });
});
