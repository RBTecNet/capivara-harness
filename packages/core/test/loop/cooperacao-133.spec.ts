/**
 * §133 — o G4 não exige navegador de quem não tem um, e o fluxo que ele não
 * percorre nunca vira prova.
 *
 * A forma mínima do incidente do Luna (`build-521a72e8dbb5`): um aplicativo
 * desktop Avalonia cujo esqueleto declara fluxos. Na 0.7.6 o G4 pediu um `start`
 * no manifesto, o executor criou `package.json` com `dotnet run` e depois um
 * `HttpListener` falso dentro do produto, o roteirista inventou seletores web, e
 * a fase gastou 19 chamadas até parar. Aqui o roteirista diz, citando o contrato,
 * que o produto vive fora do navegador; o gate registra o fluxo como NÃO
 * percorrido, e o build não se declara concluído sem ele.
 *
 * O controle é o mesmo plano com produto web: o roteiro é escrito e rodado, e o
 * build fecha — nada do que os projetos web já fazem pode mudar.
 */

import { certifyCurrentPlan } from "../support/current-plan.js";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FLOWS_DIR, gate4, runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import { FLOW_MARK, MOTIVO_SEM_START, citaOContrato } from "../../src/loop/flows.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { LivroDeEvidencias } from "../../src/loop/evidencias.js";
import { lerFasesFechadas } from "../../src/loop/ledger.js";
import { FORA_DO_NAVEGADOR, stepLabel } from "../../src/prompts/index.js";
import { runPaths } from "../../src/state/index.js";
import type { Skeleton, SkeletonWorkflow } from "../../src/contract/index.js";

const run = promisify(execFile);
let projectRoot = "";
let cache = "";

async function git(args: string[]): Promise<string> {
  return (await run("git", args, { cwd: projectRoot })).stdout.trim();
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-133-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-133-cache-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

const DESKTOP = "Interface visual: Avalonia UI para aplicativo desktop compatível com Windows e Linux";
const WEB = "Interface: React servida pelo próprio servidor e usada no navegador";

const FLUXO: SkeletonWorkflow = { number: "1", name: "Cadastrar compromisso", steps: ["Abrir o calendário.", "Cadastrar um compromisso."] };
const TERMINAL: SkeletonWorkflow = { number: "2", name: "Exportar pelo terminal", steps: ["Rodar a exportação."] };
const EXPORTACAO = "Exportação: programa de terminal, sem interface web";

function roteiro(workflow: SkeletonWorkflow): string {
  const passos = workflow.steps.map((passo, indice) => `  await test.step('${stepLabel(indice, passo)}', async () => { await page.goto('/'); await expect(page.getByRole('main')).toBeVisible(); });`);
  return ["```ts", "import { expect, test } from '@playwright/test';", `test('workflow ${workflow.number}', async ({ page }) => {`, ...passos, "});", "```"].join("\n");
}

describe("§133 · o gate 4 diante do produto fora do navegador", () => {
  const contrato = `## Stack\n- ${DESKTOP}`;

  it("o trecho citado do contrato basta: nenhum servidor, navegador ou defeito para o executor", async () => {
    let pedidos = 0;
    let rodou = false;
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: contrato,
      author: async () => {
        pedidos += 1;
        return `${FORA_DO_NAVEGADOR}: ${DESKTOP}`;
      },
      runner: async () => {
        rodou = true;
        return { exitCode: 0, output: "1 passed" };
      },
    });
    if (!resultado.green) throw new Error(`não devia reprovar: ${resultado.cause}`);
    expect(pedidos).toBe(1);
    expect(rodou).toBe(false);
    expect(resultado.scripts).toEqual([]);
    expect(resultado.naoPercorridos).toEqual([{ number: "1", trecho: DESKTOP }]);
    // Não percorrido não é aprovado: o motivo diz que é obrigação pendente.
    expect(resultado.skipped).toContain("não percorrido");
    await expect(readFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), "utf8")).rejects.toThrow();
  });

  it("o trecho que não está no contrato não vale: é roteiro defeituoso, do harness, e o fluxo não sai da cobrança", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: `## Stack\n- ${WEB}`,
      author: async () => `${FORA_DO_NAVEGADOR}: ${DESKTOP}`,
      runner: async () => ({ exitCode: 0, output: "1 passed" }),
    });
    if (resultado.green) throw new Error("o trecho inventado não pode tirar o fluxo do gate");
    expect(resultado.scriptFailed).toBe(true);
    expect(resultado.cause).toContain("não está no contrato");
    expect(resultado.naoPercorridos ?? []).toEqual([]);
  });

  it("sem contrato para conferir, a marca não é aceita", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start",
      author: async () => `${FORA_DO_NAVEGADOR}: ${DESKTOP}`,
      runner: async () => ({ exitCode: 0, output: "1 passed" }),
    });
    expect(resultado.green).toBe(false);
  });

  it("a regressão já percorrida num navegador não sai do gate pela marca", async () => {
    const proprio: SkeletonWorkflow = { number: "2", name: "Consultar o dia", steps: ["Consultar o dia."] };
    // O roteiro da regressão foi escrito para o ambiente antigo: vai ser reescrito, e o roteirista responde com a marca.
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), "import { test } from '@playwright/test';\n", "utf8");
    const resultado = await gate4({
      projectRoot, workflows: [proprio], regressao: [FLUXO], startCommand: "npm start", contratoCertificado: `## Stack\n- ${DESKTOP}`,
      author: async (workflow) => (workflow.number === "1" ? `${FORA_DO_NAVEGADOR}: ${DESKTOP}` : roteiro(proprio)),
      runner: async () => ({ exitCode: 0, output: "2 passed" }),
    });
    if (resultado.green) throw new Error("a regressão não pode sair do gate pela marca");
    expect(resultado.scriptFailed).toBe(true);
    expect(resultado.naoPercorridos ?? []).toEqual([]);
  });

  it("produto web sem `start`: o roteiro é escrito e o gate continua cobrando o entrypoint, como antes", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: `## Stack\n- ${WEB}`,
      author: async () => roteiro(FLUXO),
      runner: async () => ({ exitCode: 0, output: "1 passed" }),
    });
    if (resultado.green) throw new Error("web sem start deve reprovar");
    expect(resultado.cause).toContain("não sabe como subir a aplicação");
    // O roteiro escrito fica: a próxima passagem não paga de novo por ele.
    expect(await readFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), "utf8")).toContain("passo 2");
  });

  it("produto híbrido: o fluxo fora do navegador fica registrado, o outro é percorrido", async () => {
    const terminal: SkeletonWorkflow = { number: "2", name: "Exportar pelo terminal", steps: ["Rodar a exportação."] };
    const percorridos: string[][] = [];
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO, terminal], startCommand: "npm start", contratoCertificado: `## Stack\n- ${WEB}\n- Exportação: programa de terminal, sem interface web`,
      author: async (workflow) => (workflow.number === "2" ? `${FORA_DO_NAVEGADOR}: Exportação: programa de terminal, sem interface web` : roteiro(FLUXO)),
      runner: async (_raiz, scripts) => {
        percorridos.push(scripts);
        return { exitCode: 0, output: "1 passed" };
      },
    });
    if (!resultado.green) throw new Error(resultado.cause);
    expect(percorridos).toEqual([["workflow-1.spec.ts"]]);
    expect(resultado.naoPercorridos).toEqual([{ number: "2", trecho: "Exportação: programa de terminal, sem interface web" }]);
  });
});

async function escreverStack(linhas: string[]): Promise<void> {
  await writeFile(join(projectRoot, ".capivara", "init", "skeleton.md"), `# Agenda — Skeleton\n\n## Stack\n${linhas.map((linha) => `- ${linha}`).join("\n")}\n`, "utf8");
}

/** Uma fase de fundação e uma com o fluxo, como a P01/P02 do Luna. */
async function publicar(stack: string | string[], fluxos: SkeletonWorkflow[] = [FLUXO]): Promise<NonNullable<BuildOptions["skeleton"]>> {
  const linhas = typeof stack === "string" ? [stack] : stack;
  const cobertos = fluxos.map((workflow) => `workflow ${workflow.number}`);
  const fase = (numero: number, titulo: string, goal: string, cobre: string[], task: string, criterio: string): string[] => [
    `## Phase ${numero}: ${titulo}`,
    "",
    `**Goal:** ${goal} · **Depends on:** ${numero === 1 ? "none" : `Phase ${numero - 1}`} · **Covers:** ${cobre.join(", ")}`,
    "",
    `- [ ] **Task:** ${task}`,
    "  - **Acceptance criteria:**",
    `    - ${criterio}`,
    `  - **Traces:** ${cobre.join(" / ")}`,
    "",
  ];
  const plano = [
    "# Agenda — Project Phases",
    "",
    "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
    "",
    "## Overview",
    "",
    "Persistência e calendário.",
    "",
    ...fase(1, "Persistência", "Guardar compromissos localmente.", ["US-1.1"], "Em `src/dados.txt`, guardar compromissos.", "Compromissos persistem entre reinícios."),
    ...fase(2, "Calendário e cadastro", "Apresentar o calendário e cadastrar compromissos.", ["US-1.2", ...cobertos], "Na inicialização, apresentar o calendário e conectar o cadastro.", "Após cadastrar, o calendário indica o dia do compromisso."),
    "## Open Questions",
    "",
    "Nenhuma.",
    "",
  ].join("\n");
  await escreverStack(linhas);
  await writeFile(join(projectRoot, ".capivara", "init", "project-phases.md"), plano, "utf8");
  await certifyCurrentPlan(projectRoot);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "docs: plano"]);
  const esqueleto: Skeleton = {
    contract: "capivara-skeleton/v2",
    projectName: "Agenda",
    stack: linhas.map((linha) => ({ component: "interface", decision: linha })),
    environment: [],
    entities: [],
    stories: [],
    workflows: fluxos,
    rules: [],
    phases: [
      { number: 1, title: "Persistência", goal: "Guardar compromissos localmente.", dependsOn: "none", covers: ["US-1.1"], areas: ["backend"], taskCount: 1 },
      { number: 2, title: "Calendário e cadastro", goal: "Apresentar o calendário e cadastrar compromissos.", dependsOn: "Phase 1", covers: ["US-1.2", ...cobertos], areas: ["frontend"], taskCount: 1 },
    ],
    mvpCutPhase: 2,
  };
  return esqueleto;
}

/** O provider falso. O roteirista lê o contrato do prompt; o executor só escreve o arquivo da fase. */
type Roteirista = (prompt: string, vez: number) => string;
const DO_DESKTOP: Roteirista = () => `Não há navegador neste produto.\n${FORA_DO_NAVEGADOR}: ${DESKTOP}`;
const DO_WEB: Roteirista = (prompt) => roteiro([FLUXO, TERMINAL].find((fluxo) => prompt.includes(`workflow ${fluxo.number}: ${fluxo.name}`)) ?? FLUXO);

function motor(web: boolean, roteirista: Roteirista = web ? DO_WEB : DO_DESKTOP) {
  const chamadas: EngineCall[] = [];
  let vezes = 0;
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });
    if (chamada.role === "verifier") {
      if (chamada.prompt.includes("You write ONE Playwright script")) return ok(roteirista(chamada.prompt, ++vezes));
      return ok("TASK 1: DONE");
    }
    const raiz = chamada.root ?? projectRoot;
    // O executor web declara o entrypoint que o gate sobe; o desktop não inventa servidor nenhum.
    if (web && !(await readFile(join(raiz, "package.json"), "utf8").then(() => true, () => false))) {
      await writeFile(join(raiz, "package.json"), JSON.stringify({ name: "agenda", scripts: { start: "node server.js", test: "echo ok" } }), "utf8");
    }
    await writeFile(join(raiz, `${chamada.phase.id.toLowerCase()}-${chamada.attempt}.txt`), `${chamada.phase.id}\n`, "utf8");
    return ok("feito");
  };
  return { call, chamadas };
}

function corredor() {
  const passagens: string[][] = [];
  const runner: NonNullable<BuildOptions["flowRunner"]> = async (_root, scripts) => {
    passagens.push([...scripts]);
    return { exitCode: 0, output: `${scripts.length} passed` };
  };
  return { runner, passagens };
}

async function construir(esqueleto: NonNullable<BuildOptions["skeleton"]>, engine: ReturnType<typeof motor>, flowRunner: NonNullable<BuildOptions["flowRunner"]>) {
  const anuncios: string[] = [];
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache },
    skipAcceptance: true,
    explicitTestCommand: "true",
    testRunner: async () => ({ exitCode: 0, output: "1 passed" }),
    skeleton: esqueleto,
    flowRunner,
    announce: (mensagem) => anuncios.push(mensagem),
  });
  return { outcome, anuncios };
}

const roteiristas = (engine: ReturnType<typeof motor>): EngineCall[] => engine.chamadas.filter((chamada) => chamada.prompt.includes("You write ONE Playwright script"));

describe("§133 · o build de um produto desktop com fluxos declarados", () => {
  it("6, 13 — fases fechadas sem servidor inventado; o fluxo fica NÃO percorrido, nunca aprovado, e o build diz qual e por quê", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(false);
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);

    // As duas fases fecham: nenhum defeito do G4 vai ao executor, nenhum ciclo de correção.
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"]]);
    expect(engine.chamadas.filter((chamada) => chamada.role !== "verifier").every((chamada) => chamada.attempt === 1)).toBe(true);
    expect(fluxos.passagens).toEqual([]);
    expect(roteiristas(engine)).toHaveLength(1);
    await expect(readFile(join(projectRoot, "package.json"), "utf8")).rejects.toThrow();

    // A obrigação continua devida e nomeada: o build não se declara concluído.
    expect(outcome.exitCode).toBe(2);
    const erro = outcome.errors.join("\n");
    expect(erro).toContain("fluxo obrigatório pendente");
    expect(erro).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
    expect(erro).toContain(DESKTOP);

    // A prova registrada é NOT_APPLICABLE com a marca de pendência; PASS de fluxo não existe.
    const livro = await LivroDeEvidencias.abrir(runPaths(projectRoot, outcome.runId).root, outcome.runId);
    const historico = [...livro.historico()];
    expect(historico.some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.outcome === "PASS")).toBe(false);
    const registro = historico.find((evidencia) => evidencia.checkId === "fora-do-navegador-1");
    expect(registro?.outcome).toBe("NOT_APPLICABLE");
    expect(registro?.claim).toContain("obrigação pendente, não aprovação");

    // O registro da fase fechada guarda o que não foi percorrido: a retomada não o esquece.
    const p02 = (await lerFasesFechadas(projectRoot)).find((fase) => fase.id === "P02");
    expect(p02?.foraDoNavegador).toEqual([{ workflow: "1", trecho: DESKTOP }]);
  }, 60_000);

  it("13 — retomar não transforma o fluxo não percorrido em cumprido, nem pergunta de novo ao roteirista", async () => {
    const esqueleto = await publicar(DESKTOP);
    await construir(esqueleto, motor(false), corredor().runner);
    const segunda = motor(false);
    const { outcome } = await construir(esqueleto, segunda, corredor().runner);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
    expect(roteiristas(segunda)).toHaveLength(0);
  }, 60_000);
});

describe("§133 · controle: o mesmo plano com produto web", () => {
  it("7 — o roteiro é escrito e percorrido, o build fecha, e o verificador sabe que PORT e HOST são do harness", async () => {
    const esqueleto = await publicar(WEB);
    const engine = motor(true);
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens).toEqual([["workflow-1.spec.ts"]]);
    const g3DaFaseComFluxo = engine.chamadas.find((chamada) => chamada.role === "verifier" && chamada.phase.id === "P02" && chamada.prompt.includes("CAPIVARA_VERIFY"));
    expect(g3DaFaseComFluxo?.prompt).toContain("never ask to remove it");
    const g3SemFluxo = engine.chamadas.find((chamada) => chamada.role === "verifier" && chamada.phase.id === "P01" && chamada.prompt.includes("CAPIVARA_VERIFY"));
    expect(g3SemFluxo?.prompt).not.toContain("never ask to remove it");
  }, 60_000);
});

describe("§133 · revisão adversarial: as saídas que o primeiro desenho deixava abertas", () => {
  const contrato = `## Stack\n- ${DESKTOP}`;
  const semRunner = async (): Promise<{ exitCode: number; output: string }> => {
    throw new Error("nenhum navegador deveria abrir");
  };

  it("a marca dentro de uma cerca de código e com ponto final vale como a marca solta", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: contrato,
      author: async () => `\`\`\`ts\n${FORA_DO_NAVEGADOR}: “${DESKTOP}”.\n\`\`\``,
      runner: semRunner,
    });
    if (!resultado.green) throw new Error(resultado.cause);
    expect(resultado.naoPercorridos).toEqual([{ number: "1", trecho: DESKTOP }]);
  });

  it("fluxo da fase que outra fase já percorreu num navegador não sai pela marca", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: contrato, jaPercorridos: ["1"],
      author: async () => `${FORA_DO_NAVEGADOR}: ${DESKTOP}`,
      runner: async () => ({ exitCode: 0, output: "1 passed" }),
    });
    expect(resultado.green).toBe(false);
    expect(resultado.naoPercorridos ?? []).toEqual([]);
  });

  it("a contestação do executor chega ao roteirista antes da cobrança do `start`, e a marca vale ali", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    const inventado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: contrato,
      author: async () => roteiro(FLUXO), runner: async () => ({ exitCode: 0, output: "1 passed" }),
    });
    expect(inventado.green).toBe(true);
    const contestado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: contrato,
      roteiroContestado: "o produto é desktop: não há servidor HTTP", roteirosQueFalharam: ["1"],
      author: async () => `${FORA_DO_NAVEGADOR}: ${DESKTOP}`, runner: semRunner,
    });
    if (!contestado.green) throw new Error(contestado.cause);
    expect(contestado.naoPercorridos).toEqual([{ number: "1", trecho: DESKTOP }]);
  });

  it("sem `start` e com roteiro web inventado no disco, o roteirista é perguntado de novo uma vez", async () => {
    let perguntas = 0;
    const primeira = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: contrato, confirmarSemStart: true,
      author: async (_fluxo, rejeitado) => {
        perguntas += 1;
        return rejeitado.some((motivo) => motivo === MOTIVO_SEM_START) ? `${FORA_DO_NAVEGADOR}: ${DESKTOP}` : roteiro(FLUXO);
      },
      runner: semRunner,
    });
    if (!primeira.green) throw new Error(primeira.cause);
    expect(perguntas).toBe(2);
    expect(primeira.naoPercorridos).toEqual([{ number: "1", trecho: DESKTOP }]);
  });

  it("web sem `start`: a pergunta a mais devolve o roteiro, e o entrypoint continua cobrado", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: `## Stack\n- ${WEB}`, confirmarSemStart: true,
      author: async () => roteiro(FLUXO), runner: semRunner,
    });
    if (resultado.green) throw new Error("web sem start deve reprovar");
    expect(resultado.cause).toContain("não sabe como subir a aplicação");
  });
});

describe("§133 · revisão adversarial: o build inteiro", () => {
  it("o roteiro web inventado no primeiro rascunho não trava o desktop: a pergunta sem `start` libera a fase", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(false, (prompt) => (prompt.includes(MOTIVO_SEM_START) ? `${FORA_DO_NAVEGADOR}: ${DESKTOP}` : roteiro(FLUXO)));
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"]]);
    expect(engine.chamadas.filter((chamada) => chamada.role !== "verifier").every((chamada) => chamada.attempt === 1)).toBe(true);
    expect(fluxos.passagens).toEqual([]);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
  }, 60_000);

  it("produto híbrido: o fluxo fora do navegador não ganha prova de percurso", async () => {
    const esqueleto = await publicar([WEB, EXPORTACAO], [FLUXO, TERMINAL]);
    const engine = motor(true, (prompt) => (prompt.includes(`workflow 2: ${TERMINAL.name}`) ? `${FORA_DO_NAVEGADOR}: ${EXPORTACAO}` : roteiro(FLUXO)));
    const fluxos = corredor();
    const { outcome } = await construir(esqueleto, engine, fluxos.runner);
    expect(fluxos.passagens).toEqual([["workflow-1.spec.ts"]]);
    const historico = [...(await LivroDeEvidencias.abrir(runPaths(projectRoot, outcome.runId).root, outcome.runId)).historico()];
    expect(historico.some((evidencia) => evidencia.checkId === "fluxo-2" && evidencia.outcome === "PASS")).toBe(false);
    expect(historico.find((evidencia) => evidencia.checkId === "fluxos" && evidencia.outcome === "PASS")?.claim).toBe("os fluxos 1 passam na aplicação de pé");
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("o fluxo 2 (Exportar pelo terminal) não foi percorrido");
  }, 60_000);

  it("o trecho tirado de um critério da fase, e não da Stack, não tira o fluxo do navegador", async () => {
    const esqueleto = await publicar(WEB);
    const engine = motor(true, () => `${FORA_DO_NAVEGADOR}: Após cadastrar, o calendário indica o dia do compromisso.`);
    const { outcome } = await construir(esqueleto, engine, corredor().runner);
    const historico = [...(await LivroDeEvidencias.abrir(runPaths(projectRoot, outcome.runId).root, outcome.runId)).historico()];
    expect(historico.some((evidencia) => evidencia.checkId.startsWith("fora-do-navegador-"))).toBe(false);
    expect(outcome.phases.find((fase) => fase.id === "P02")?.outcome.status).not.toBe("complete");
  }, 60_000);

  it("reescrever o histórico (squash) e revalidar a fase não transforma o fluxo não percorrido em cumprido", async () => {
    const esqueleto = await publicar(DESKTOP);
    const primeira = await construir(esqueleto, motor(false), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(2);
    const raiz = await git(["rev-list", "--max-parents=0", "HEAD"]);
    await git(["reset", "--soft", raiz]);
    await git(["commit", "-q", "-m", "feat: tudo junto"]);
    const { outcome, anuncios } = await construir(esqueleto, motor(false), corredor().runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(2);
    expect(outcome.errors.join("\n")).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
    expect((await lerFasesFechadas(projectRoot)).find((fase) => fase.id === "P02")?.foraDoNavegador).toEqual([{ workflow: "1", trecho: DESKTOP }]);
  }, 90_000);

  it("a Stack corrigida para web reabre a fase: o G4 pergunta de novo, percorre o fluxo, e o build fecha", async () => {
    const esqueleto = await publicar(DESKTOP);
    await construir(esqueleto, motor(false), corredor().runner);
    await escreverStack([WEB]);
    await certifyCurrentPlan(projectRoot);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "docs: a Stack é web"]);
    const fluxos = corredor();
    const engine = motor(true);
    const { outcome, anuncios } = await construir({ ...esqueleto, stack: [{ component: "interface", decision: WEB }] }, engine, fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens).toEqual([["workflow-1.spec.ts"]]);
    expect(anuncios.join("\n")).toContain("que a Stack atual não traz");
  }, 90_000);
});

describe("§133 · terceira revisão: a decisão e a pergunta sem `start` de ponta a ponta", () => {
  const OUTRO: SkeletonWorkflow = { number: "2", name: "Consultar o dia", steps: ["Consultar o dia."] };
  const corpo = (workflow: SkeletonWorkflow): string => roteiro(workflow).replace(/^```ts\n/, "").replace(/\n```$/, "");
  const FALHOU2 = {
    exitCode: 1,
    output:
      "  ✘  2 [workflow-2] › workflow-2.spec.ts:8:5 › workflow 2 (1.0m)\n" +
      "  1) [workflow-2] › workflow-2.spec.ts:8:5 › passo 1: Rodar a exportação.\n" +
      "    waiting for getByRole('button', { name: 'Exportar' })\n  1 failed",
  };
  const semRunner = async (): Promise<{ exitCode: number; output: string }> => {
    throw new Error("nenhum navegador deveria abrir");
  };

  it("a pergunta sem `start` só se gasta quando foi feita: a redação que reprova antes não a consome", async () => {
    const esqueleto = await publicar(DESKTOP, [FLUXO, OUTRO]);
    let doSegundo = 0;
    const engine = motor(false, (prompt) => {
      if (prompt.includes(MOTIVO_SEM_START)) return `${FORA_DO_NAVEGADOR}: ${DESKTOP}`;
      if (prompt.includes(`workflow 2: ${OUTRO.name}`)) return ++doSegundo <= 2 ? "não consigo escrever agora" : `${FORA_DO_NAVEGADOR}: ${DESKTOP}`;
      return roteiro(FLUXO);
    });
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"]]);
    // O executor nunca é mandado criar `start` num desktop.
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder" && chamada.phase.id === "P02").every((chamada) => chamada.attempt === 1)).toBe(true);
    expect(fluxos.passagens).toEqual([]);
    const erro = outcome.errors.join("\n");
    expect(erro).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
    expect(erro).toContain("o fluxo 2 (Consultar o dia) não foi percorrido");
  }, 90_000);

  it("a reescrita pela triagem ROTEIRO que responde com a marca não vira 'o roteirista não alterou'", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), `${FLOW_MARK}\n${corpo(FLUXO)}\n`, "utf8");
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-2.spec.ts"), `${FLOW_MARK}\n${corpo(TERMINAL)}\n`, "utf8");
    const passagens: string[][] = [];
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO, TERMINAL], startCommand: "npm start", contratoCertificado: `## Stack\n- ${WEB}\n- ${EXPORTACAO}`,
      author: async (workflow) => (workflow.number === "2" ? `${FORA_DO_NAVEGADOR}: ${EXPORTACAO}` : roteiro(workflow)),
      triagem: async () => ["CAPIVARA_TRIAGEM: ROTEIRO", "CAPIVARA_EVIDENCIA: não há página de exportação", "CAPIVARA_ONDE: cli", "CAPIVARA_CRITERIO: task 1", "CAPIVARA_CORRECAO: o fluxo 2 é de terminal"].join("\n"),
      runner: async (_raiz, scripts) => {
        passagens.push([...scripts]);
        return scripts.includes("workflow-2.spec.ts") ? FALHOU2 : { exitCode: 0, output: "1 passed" };
      },
    });
    if (!resultado.green) throw new Error(resultado.cause);
    expect(resultado.naoPercorridos).toEqual([{ number: "2", trecho: EXPORTACAO }]);
    expect(passagens.at(-1)).toEqual(["workflow-1.spec.ts"]);
  });

  it("a decisão alcança a passagem seguinte da fase: o roteiro inventado não volta a rodar", async () => {
    const contrato = `## Stack\n- ${DESKTOP}`;
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), `${FLOW_MARK}\n${corpo(FLUXO)}\n`, "utf8");
    // O mesmo atalho do runner: a decisão tomada nesta fase responde sem nova sessão.
    const decidido = new Map<string, string>();
    let sessoes = 0;
    const author = async (workflow: SkeletonWorkflow, rejeitado: readonly string[]): Promise<string> => {
      const ja = decidido.get(workflow.number);
      if (ja !== undefined && rejeitado.length === 0) return `${FORA_DO_NAVEGADOR}: ${ja}`;
      sessoes += 1;
      return rejeitado.includes(MOTIVO_SEM_START) ? `${FORA_DO_NAVEGADOR}: ${DESKTOP}` : roteiro(workflow);
    };
    const primeira = await gate4({ projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: contrato, confirmarSemStart: true, author, runner: semRunner });
    for (const fluxo of primeira.naoPercorridos ?? []) decidido.set(fluxo.number, fluxo.trecho);
    const segunda = await gate4({ projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: contrato, author, runner: semRunner });
    if (!segunda.green) throw new Error(segunda.cause);
    expect(segunda.naoPercorridos).toEqual([{ number: "1", trecho: DESKTOP }]);
    expect(sessoes).toBe(1);
  });

  it("a citação vale dentro de uma linha da Stack, não costurando duas", () => {
    const stack = `## Stack\n- ${DESKTOP}\n- Banco de dados: SQLite em arquivo local`;
    expect(citaOContrato(DESKTOP, stack)).toBe(true);
    expect(citaOContrato("compatível com Windows e Linux - Banco de dados", stack)).toBe(false);
    expect(citaOContrato("Stack - Interface visual: Avalonia", stack)).toBe(false);
  });

  it("um build com `--no-flows` não apaga a pendência da fase, nem a reabre", async () => {
    const esqueleto = await publicar(DESKTOP);
    await construir(esqueleto, motor(false), corredor().runner);
    const raiz = await git(["rev-list", "--max-parents=0", "HEAD"]);
    await git(["reset", "--soft", raiz]);
    await git(["commit", "-q", "-m", "feat: tudo junto"]);
    await runBuild({
      projectRoot, language: "português do Brasil", engine: "codex", call: motor(false).call, sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache }, skipAcceptance: true, explicitTestCommand: "true",
      testRunner: async () => ({ exitCode: 0, output: "1 passed" }), skeleton: esqueleto, skipFlows: true, announce: () => undefined,
    });
    expect((await lerFasesFechadas(projectRoot)).find((fase) => fase.id === "P02")?.foraDoNavegador).toEqual([{ workflow: "1", trecho: DESKTOP }]);
    // Outro run (o plano mudou fora das fases), com fluxos: a pendência continua nomeada.
    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    await writeFile(join(projectRoot, ".capivara", "init", "project-phases.md"), plano.replace("Persistência e calendário.", "Persistência e calendário, revisado."), "utf8");
    await certifyCurrentPlan(projectRoot);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "docs: overview"]);
    const { outcome } = await construir(esqueleto, motor(false), corredor().runner);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
  }, 180_000);

  it("`--rebuild-all` pergunta de novo ao roteirista: quem refaz tudo não confia na decisão antiga", async () => {
    const esqueleto = await publicar(DESKTOP);
    await construir(esqueleto, motor(false), corredor().runner);
    const segunda = motor(false);
    const outcome = await runBuild({
      projectRoot, language: "português do Brasil", engine: "codex", call: segunda.call, sleep: async () => undefined,
      environment: { XDG_CACHE_HOME: cache }, skipAcceptance: true, explicitTestCommand: "true",
      testRunner: async () => ({ exitCode: 0, output: "1 passed" }), skeleton: esqueleto, flowRunner: corredor().runner,
      rebuildAll: true, announce: () => undefined,
    });
    expect(outcome.exitCode).toBe(2);
    expect(roteiristas(segunda).length).toBeGreaterThan(0);
  }, 120_000);
});
