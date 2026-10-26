/**
 * O ambiente usa o que está instalado, e a sonda de versão confere mínimo.
 *
 * As sondas rodam com o Node do harness, e o build não troca de Node nem de npm.
 * O Codex obedeceu a "confira a compatibilidade da versão" e escreveu
 * `process.exit(principal===22&&secundaria>=12?0:1)` numa máquina com Node 25:
 * o build gastou duas sessões de instalação antes de parar no preflight. Aqui:
 * o inventário diz à entrevista, ao esqueleto e ao arquiteto qual Node e qual npm
 * o harness roda, e o `plan` roda as sondas desse runtime antes de publicar,
 * sem modelo nenhum. A sonda impossível volta ao arquiteto uma vez; se ele
 * insistir, o Core a troca por `[binário, "--version"]` e diz no relatório.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit, runPlan } from "../../src/init/index.js";
import { ambienteDoHarness, inspectProject, summarizeInventory } from "../../src/init/inventory.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import type { Question } from "../../src/interview/index.js";
import { sondaDoRuntimeDoHarness } from "../../src/loop/prerequisites.js";
import { ARCHITECTURE, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";
beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-maquina-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "um sistema de reservas para uma pousada", origin: "text" as const, path: null, sha12: "maquina00001" };
const language = "português do Brasil";
const responde = async (question: Question) => (question.id === ID_DO_BANCO ? "1" : "use as recomendações");

/** Uma série do Node que esta máquina não roda, qualquer que seja a máquina. */
const OUTRA_SERIE = Number(process.versions.node.split(".")[0]) - 3;
const SONDA_DA_SERIE = {
  technology: "Node.js",
  binary: "node",
  systemLevel: false,
  checkArgs: ["-e", `const [principal] = process.versions.node.split('.').map(Number); process.exit(principal === ${OUTRA_SERIE} ? 0 : 1)`],
  installHint: `instalar o Node ${OUTRA_SERIE}`,
};
const SONDA_DO_MINIMO = { technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["-e", "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"] };

function arquitetura(requirements: object[]): string {
  const base = JSON.parse(ARCHITECTURE) as { infrastructure: Record<string, unknown> };
  return JSON.stringify({ ...base, infrastructure: { ...base.infrastructure, requirements } });
}

async function init(): Promise<ReturnType<typeof fakeAgent>> {
  const agent = fakeAgent(skeletonPath());
  await runInit({ projectRoot, request, language, stage: "init", call: agent.call, ask: responde, announce: () => undefined });
  return agent;
}

function plan(arquiteto: ScriptStep["respond"]["stdout"]) {
  const dito: string[] = [];
  const agent = fakeAgent([{ match: { role: "writer", stage: "authoring", subject: "architecture" }, respond: { stdout: arquiteto }, repeat: true }, ...skeletonPath()]);
  const run = runPlan({ projectRoot, request, language, call: agent.call, ask: responde, announce: (linha) => void dito.push(linha), sleep: async () => undefined });
  const doArquiteto = () => agent.calls.filter((call) => call.stage === "authoring" && call.subject === "architecture");
  return { run, agent, doArquiteto, anunciado: () => dito.join("\n") };
}

async function frase(): Promise<string> {
  const maquina = await ambienteDoHarness();
  return `exige o que a máquina não tem: o harness roda Node ${maquina.node} / npm ${maquina.npm ?? "ausente"}`;
}

describe("o inventário diz qual Node e qual npm o harness roda", () => {
  it("o inventário traz a versão do Node do harness e a do npm que ele resolve, e diz que as sondas rodam com eles", async () => {
    const inventario = await inspectProject(projectRoot);
    expect(inventario.runtime?.node).toBe(process.versions.node);
    expect(inventario.runtime?.npm).toMatch(/^\d+\.\d+\.\d+/u);
    const resumo = summarizeInventory(inventario);
    expect(resumo).toContain(`o harness roda Node.js ${process.versions.node} e npm ${inventario.runtime!.npm}`);
    expect(resumo).toContain("As sondas de prontidão rodam com esse Node e esse npm, e o build não os troca.");
  });

  it("a entrevista, o esqueleto e o arquiteto recebem o ambiente da máquina", async () => {
    const doInit = await init();
    const doPlan = plan(arquitetura([SONDA_DO_MINIMO]));
    await doPlan.run;
    const linha = `o harness roda Node.js ${process.versions.node}`;
    expect(doInit.calls.find((call) => call.stage === "interview")?.prompt).toContain(linha);
    const doEsqueleto = doInit.calls.find((call) => call.stage === "authoring" && call.subject === "skeleton")?.prompt ?? "";
    expect(doEsqueleto).toContain(linha);
    // A instrução antiga ("confira a compatibilidade da versão escolhida") saiu; ficou a do mínimo.
    expect(doEsqueleto).not.toContain("Check chosen version compatibility");
    expect(doEsqueleto).toContain("A version probe checks a minimum (>=), never an exact series nor a ceiling, unless the request demands it.");
    expect(doEsqueleto).toContain("When the request does not fix a version, adopt the version installed on the machine");
    expect(doPlan.doArquiteto()[0]?.prompt).toContain(linha);
  });
});

describe("a sonda do runtime, conferida antes de publicar", () => {
  it("só entram as sondas do Node e do npm que leem o runtime; a que lê pacote espera a preparação do build", () => {
    expect(sondaDoRuntimeDoHarness(SONDA_DA_SERIE)).toBe(true);
    expect(sondaDoRuntimeDoHarness({ technology: "Node.js", binary: "node", systemLevel: false, checkArgs: ["--version"] })).toBe(true);
    expect(sondaDoRuntimeDoHarness({ technology: "npm", binary: "npm", systemLevel: false, checkArgs: ["-v"] })).toBe(true);
    expect(sondaDoRuntimeDoHarness({ technology: "Vite", binary: "npm", systemLevel: false, checkArgs: ["exec", "--no", "--", "vite", "--version"] })).toBe(false);
    expect(sondaDoRuntimeDoHarness({ technology: "Playwright", binary: "node", systemLevel: false, checkArgs: ["-e", "require('@playwright/test'); process.versions.node"] })).toBe(false);
    expect(sondaDoRuntimeDoHarness({ technology: "PostgreSQL", binary: "psql", systemLevel: true, checkArgs: ["--version"] })).toBe(false);
  });

  it("a sonda que exige outra série do Node volta à arquitetura uma vez, com o achado, e a corrigida é publicada", async () => {
    await init();
    const doPlan = plan((call) => (call.prompt.includes("exige o que a máquina não tem") ? arquitetura([SONDA_DO_MINIMO]) : arquitetura([SONDA_DA_SERIE])));
    const outcome = await doPlan.run;

    expect(outcome.readiness.ready, doPlan.anunciado()).toBe(true);
    expect(doPlan.doArquiteto()).toHaveLength(2);
    expect(doPlan.doArquiteto()[1]!.prompt).toContain(await frase());
    const ambiente = JSON.parse(await readFile(join(projectRoot, ".capivara/init/environment.json"), "utf8")) as { requirements: { checkArgs?: string[] }[] };
    expect(ambiente.requirements.map((requisito) => requisito.checkArgs)).toEqual([SONDA_DO_MINIMO.checkArgs]);
  });

  it("se o arquiteto insiste, o Core troca a sonda por `node --version`, publica o plano e registra o alerta com as duas versões, sem parar", async () => {
    await init();
    const doPlan = plan(arquitetura([SONDA_DA_SERIE]));
    const outcome = await doPlan.run;

    expect(outcome.readiness.ready, doPlan.anunciado()).toBe(true);
    expect(doPlan.doArquiteto()).toHaveLength(2);
    const ambiente = JSON.parse(await readFile(join(projectRoot, ".capivara/init/environment.json"), "utf8")) as { requirements: { binary: string; checkArgs?: string[] }[] };
    expect(ambiente.requirements.map((requisito) => [requisito.binary, ...(requisito.checkArgs ?? [])])).toEqual([["node", "--version"]]);
    const alerta = outcome.report.remarks.find((entrada) => entrada.remark.where === "sondas de prontidão")?.remark.observation ?? "";
    expect(alerta).toMatch(/^a sonda Node\.js \(`node -e "const \[principal\]/u);
    expect(alerta).toContain(await frase());
    expect(alerta).toContain("o Core a trocou por `node --version`");
    expect(outcome.rendered).toContain("o Core a trocou por `node --version`");
  });

  it("a sonda que confere mínimo passa sem nenhuma chamada a mais", async () => {
    await init();
    const doPlan = plan(arquitetura([SONDA_DO_MINIMO, { technology: "npm", binary: "npm", systemLevel: false, checkArgs: ["--version"] }]));
    const outcome = await doPlan.run;

    expect(outcome.readiness.ready).toBe(true);
    expect(doPlan.doArquiteto()).toHaveLength(1);
    expect(doPlan.anunciado()).not.toContain("exige o que esta máquina não tem");
  });

  it("a arquitetura guardada de um plan anterior, com a sonda impossível, é desenhada de novo em vez de reaproveitada", async () => {
    await init();
    await plan(arquitetura([SONDA_DO_MINIMO])).run;
    // O estado de um plan de antes desta conferência: a mesma arquitetura, com a sonda da série.
    const pasta = join(projectRoot, ".capivara/handoffs");
    const arquivo = join(pasta, (await readdir(pasta)).find((nome) => nome.endsWith(".architecture-state.json"))!);
    const estado = JSON.parse(await readFile(arquivo, "utf8")) as { architecture: { infrastructure: { requirements: object[] } } };
    estado.architecture.infrastructure.requirements = [SONDA_DA_SERIE];
    await writeFile(arquivo, JSON.stringify(estado));

    const doPlan = plan(arquitetura([SONDA_DO_MINIMO]));
    const outcome = await doPlan.run;

    expect(outcome.readiness.ready).toBe(true);
    expect(doPlan.anunciado()).toContain("a arquitetura guardada tem sonda que esta máquina não satisfaz");
    expect(doPlan.doArquiteto()).toHaveLength(1);
    expect(doPlan.doArquiteto()[0]!.prompt).toContain(await frase());
  });
});
