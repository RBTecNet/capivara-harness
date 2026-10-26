/**
 * A preparação do ambiente não escreve fora do projeto (item 8 de "atacar os pontos frágeis").
 *
 * No run `build-948fc298f4fe` (Codex) o agente da preparação alterou o
 * `package.json` e o `package-lock.json` da pasta acima do projeto, e não os
 * restaurou. Antes de cada sessão de preparação, o Core guarda os manifestos e
 * travas de cada pasta acima do projeto, até o `$HOME`; depois, o que mudou
 * volta ao que era, e isso vira alerta no relatório.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild } from "../../src/loop/build.js";
import { fotografarAcima, pastasAcima, restaurarAcima } from "../../src/loop/fora-do-projeto.js";
import { sha12 } from "../../src/contract/stamps.js";
import { ENVIRONMENT_CONTRACT, PLANNING_CONTRACT } from "../../src/contract/environment.js";
import { readEvents, runPaths } from "../../src/state/index.js";
import { VALID_PHASES } from "../contract/fixture.js";
import { certifyCurrentPlan } from "../support/current-plan.js";

let mae = "";
let root = "";
const MANIFESTO_DA_MAE = JSON.stringify({ name: "projetos", private: true, devDependencies: { typescript: "^5.9.3" } }, null, 2);
const TRAVA_DA_MAE = JSON.stringify({ name: "projetos", lockfileVersion: 3, packages: {} }, null, 2);

beforeEach(async () => {
  mae = await mkdtemp(join(tmpdir(), "capivara-mae-"));
  root = join(mae, "projeto");
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await writeFile(join(mae, "package.json"), MANIFESTO_DA_MAE);
  await writeFile(join(mae, "package-lock.json"), TRAVA_DA_MAE);
  await writeFile(join(root, ".capivara/init/project-phases.md"), VALID_PHASES);
  await writeFile(join(root, ".capivara/init/skeleton.md"), "## Stack\n- Runtime: Node.js\n");
  await certifyCurrentPlan(root);
  const skeleton = await readFile(join(root, ".capivara/init/skeleton.md"), "utf8");
  const sonda = "const D=require('node:module').createRequire(process.cwd()+'/');if(D('capivara-probe-driver')()!==42)process.exit(1)";
  await writeFile(join(root, ".capivara/init/environment.json"), JSON.stringify({
    contract: ENVIRONMENT_CONTRACT, planningContract: PLANNING_CONTRACT,
    planSha12: sha12(VALID_PHASES), skeletonSha12: sha12(skeleton),
    requirements: [{ technology: "Driver", binary: process.execPath, systemLevel: false, checkArgs: ["-e", sonda], installHint: "instalar o driver" }],
  }));
});
afterEach(async () => {
  await rm(mae, { recursive: true, force: true });
});

/** A sessão de preparação que instala no projeto e, de quebra, mexe na pasta de cima. */
async function preparacaoQueEscreveNaMae(): Promise<void> {
  await mkdir(join(root, "node_modules/capivara-probe-driver"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "capivara-probe-driver": "1.0.0" } }));
  await writeFile(join(root, "node_modules/capivara-probe-driver/index.js"), "module.exports=()=>42");
  await writeFile(join(mae, "package.json"), JSON.stringify({ name: "projetos", dependencies: { "better-sqlite3": "^13.0.3" } }));
  await writeFile(join(mae, "yarn.lock"), "# criado pela sessão\n");
}

describe("a preparação que escreve na pasta acima do projeto", () => {
  it("a alteração do package.json da pasta mãe é revertida, a trava que ela criou é apagada, e o alerta vai ao relatório", async () => {
    const call = async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => ({
      exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null,
    });
    const anuncios: string[] = [];
    const result = await runBuild({
      projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false,
      installPrerequisites: preparacaoQueEscreveNaMae, systemInstall: true, skipFlows: true, skipAcceptance: true, maxCycles: 1,
      announce: (linha) => void anuncios.push(linha),
    });

    expect(result.exitCode, anuncios.join("\n")).toBe(0);
    expect(await readFile(join(mae, "package.json"), "utf8")).toBe(MANIFESTO_DA_MAE);
    expect(await readFile(join(mae, "package-lock.json"), "utf8")).toBe(TRAVA_DA_MAE);
    await expect(readFile(join(mae, "yarn.lock"), "utf8")).rejects.toThrow();
    // O que a preparação fez no projeto fica: é dela.
    expect(await readFile(join(root, "package.json"), "utf8")).toContain("capivara-probe-driver");

    const eventos = await readEvents(runPaths(root, result.runId).events);
    const alerta = eventos.find((evento) => evento.detail.startsWith("alerta: a sessão de preparação escreveu fora do projeto"))?.detail ?? "";
    expect(alerta).toContain("../package.json (alterado pela sessão; restaurado)");
    expect(alerta).toContain("../yarn.lock (criado pela sessão; apagado)");
    expect(alerta).not.toContain("package-lock.json");
    const relatorio = await readFile(join(runPaths(root, result.runId).root, "relatorio.md"), "utf8");
    expect(relatorio).toContain("## Alertas");
    expect(relatorio).toContain("../package.json (alterado pela sessão; restaurado)");
  });

  it("a preparação que não escreve fora do projeto não deixa alerta", async () => {
    const call = async (input: Parameters<Parameters<typeof runBuild>[0]["call"]>[0]) => ({
      exitCode: 0, stdout: input.role === "builder" ? "feito" : Array.from({ length: input.phase.taskCount }, (_, i) => `TASK ${i + 1}: DONE`).join("\n"), stderr: "", timedOut: null,
    });
    const result = await runBuild({
      projectRoot: root, language: "pt-BR", engine: "codex", call, gitInit: false,
      installPrerequisites: async () => {
        await mkdir(join(root, "node_modules/capivara-probe-driver"), { recursive: true });
        await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { "capivara-probe-driver": "1.0.0" } }));
        await writeFile(join(root, "node_modules/capivara-probe-driver/index.js"), "module.exports=()=>42");
      },
      systemInstall: true, skipFlows: true, skipAcceptance: true, maxCycles: 1,
    });
    expect(result.exitCode).toBe(0);
    const eventos = await readEvents(runPaths(root, result.runId).events);
    expect(eventos.some((evento) => evento.detail.startsWith("alerta:"))).toBe(false);
  });
});

describe("as pastas acima do projeto", () => {
  it("vão da mãe até o $HOME, inclusive; fora do $HOME, até a raiz", () => {
    expect(pastasAcima("/home/ana/Projetos/laravel/codex", "/home/ana")).toEqual(["/home/ana/Projetos/laravel", "/home/ana/Projetos", "/home/ana"]);
    expect(pastasAcima("/tmp/x/projeto", "/home/ana")).toEqual(["/tmp/x", "/tmp", "/"]);
  });

  it("a foto guarda o que existia e o que não existia; a restauração devolve só o que mudou", async () => {
    const foto = await fotografarAcima(root);
    await writeFile(join(mae, "composer.json"), "{}");
    const { restaurados, naoVoltaram } = await restaurarAcima(root, foto);
    expect(restaurados).toEqual(["../composer.json (criado pela sessão; apagado)"]);
    expect(naoVoltaram).toEqual([]);
    expect((await restaurarAcima(root, foto)).restaurados).toEqual([]);
  });
});
