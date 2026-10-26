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
 * percorrido, e o build, que o percorre só na aceitação final (etapa 4 da
 * redução), termina em verificação inconclusiva — nunca aceito.
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
import type { BuildOptions } from "../../src/loop/index.js";
import { FORA_DO_NAVEGADOR, stepLabel } from "../../src/prompts/index.js";
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

async function construir(esqueleto: NonNullable<BuildOptions["skeleton"]>, engine: ReturnType<typeof motor>, flowRunner: NonNullable<BuildOptions["flowRunner"]>, extra: Partial<BuildOptions> = {}) {
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
    ...extra,
  });
  return { outcome, anuncios };
}

const roteiristas = (engine: ReturnType<typeof motor>): EngineCall[] => engine.chamadas.filter((chamada) => chamada.prompt.includes("You write ONE Playwright script"));

/** A aceitação final de verdade, com os passos do manifesto respondidos pelo teste: é nela que os fluxos são percorridos. */
const comAceitacao: Partial<BuildOptions> = {
  skipAcceptance: false,
  acceptanceRunner: async () => ({ exitCode: 0, output: "ok" }),
  acceptanceService: async () => ({ exitCode: 0, output: "de pé" }),
};

describe("§133 · o build de um produto desktop com fluxos declarados", () => {
  it("6, 13 — fases fechadas sem servidor inventado; na aceitação o fluxo fica NÃO percorrido, e o build termina em verificação inconclusiva, dizendo qual e por quê", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(false);
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner, comAceitacao);

    // As duas fases fecham sem ciclo de correção: os fluxos não são das fases.
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"]]);
    expect(engine.chamadas.filter((chamada) => chamada.role !== "verifier").every((chamada) => chamada.attempt === 1)).toBe(true);
    expect(fluxos.passagens).toEqual([]);
    expect(roteiristas(engine)).toHaveLength(1);
    await expect(readFile(join(projectRoot, "package.json"), "utf8")).rejects.toThrow();

    // O que não se percorreu é dito, com o trecho do contrato: nunca aceito.
    expect(outcome.exitCode).toBe(3);
    expect(outcome.estado).toBe("verificação inconclusiva");
    const pendencias = (outcome.pendencias ?? []).join("\n");
    expect(pendencias).toContain("o fluxo 1 não foi percorrido");
    expect(pendencias).toContain(DESKTOP);
  }, 60_000);
});

/*
 * Item 6 de "atacar os pontos frágeis": o mesmo produto de janela, agora com o
 * projeto .NET que o declara. A aceitação compila e inicia o executável por 10
 * segundos na cópia limpa; de pé, o fluxo de janela tem a prova da plataforma e
 * o build é aceito. O que quebra ao iniciar é pego.
 */
describe("item 6 · o aplicativo desktop que sobe chega a aceito", () => {
  const AVALONIA = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>WinExe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Avalonia" Version="11.0.10" />\n  </ItemGroup>\n</Project>\n';
  const comTela = { acceptancePlatform: { sistema: "linux" as const, tela: true } };

  it("compilado e de pé por 10 segundos na cópia limpa: o fluxo de janela é provado pela subida, e o build termina aceito", async () => {
    await writeFile(join(projectRoot, "Agenda.csproj"), AVALONIA, "utf8");
    const esqueleto = await publicar(DESKTOP);
    const iniciados: { comando: string; segundos: number }[] = [];
    const { outcome, anuncios } = await construir(esqueleto, motor(false), corredor().runner, {
      ...comAceitacao,
      ...comTela,
      acceptanceService: async (comando, _cwd, segundos) => {
        iniciados.push({ comando, segundos });
        return { exitCode: 0, output: "de pé" };
      },
    });

    expect(iniciados).toEqual([{ comando: 'dotnet run --no-build --project "Agenda.csproj"', segundos: 10 }]);
    expect(outcome.estado, anuncios.join("\n")).toBe("aceito");
    expect(outcome.exitCode).toBe(0);
    expect(anuncios.join("\n")).toContain("provado pela subida do executável na cópia limpa");
  }, 60_000);

  it("o executável que quebra ao iniciar é pego: nunca aceito, e a causa é o passo start", async () => {
    await writeFile(join(projectRoot, "Agenda.csproj"), AVALONIA, "utf8");
    const esqueleto = await publicar(DESKTOP);
    const { outcome } = await construir(esqueleto, motor(false), corredor().runner, {
      ...comAceitacao,
      ...comTela,
      maxCycles: 1,
      acceptanceService: async () => ({ exitCode: 134, output: "Unhandled exception. System.NullReferenceException" }),
    });

    expect(outcome.estado).not.toBe("aceito");
    expect(outcome.exitCode).not.toBe(0);
    expect((outcome.pendencias ?? []).join("\n")).toContain('"start"');
  }, 60_000);
});

describe("§133 · controle: o mesmo plano com produto web", () => {
  it("7 — o roteiro é escrito e percorrido na aceitação final, o build é aceito, e o verificador sabe que PORT e HOST são do harness", async () => {
    const esqueleto = await publicar(WEB);
    const engine = motor(true);
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner, comAceitacao);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(outcome.estado).toBe("aceito");
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



});


