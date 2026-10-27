import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runInit } from "../../src/init/index.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { fakeAgent, skeletonPath, SKELETON } from "../support/fake-agent.js";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it.each([
  "Administrar registros de um serviço externo, sem manter um banco de dados próprio. Interface de terminal, sem interface web.",
  "Consultar arquivos locais. A aplicação não precisa de banco de dados. Interface de janela.",
])("o INIT respeita a restrição explícita ao aceitar as recomendações: %s", async text => {
  root = await mkdtemp(join(tmpdir(), "capivara-no-db-"));
  const skeleton = JSON.parse(SKELETON);
  skeleton.stack = [{ component: "Linguagem", decision: "TypeScript" }, { component: "Interface", decision: "terminal" }];
  skeleton.environment = [];
  skeleton.entities = [];
  skeleton.stories = [{ id: "US-1.1", statement: "Consultar registros mantidos externamente" }];
  skeleton.workflows = [{ number: "1", name: "Consultar", steps: ["Selecionar registro", "Consultar registro"] }];
  skeleton.rules = [{ subject: "persistencia.escopo", statement: "A aplicação não mantém banco de dados próprio." }];
  skeleton.phases = [{ number: 1, title: "Consulta", goal: "consultar registros", dependsOn: "none", covers: ["US-1.1", "workflow 1"], taskCount: 2 }];
  skeleton.mvpCutPhase = 1;
  const steps = skeletonPath().map(s => s.match.subject === "skeleton" && s.match.stage === "authoring" ? { ...s, respond: { stdout: JSON.stringify(skeleton) } } : s);
  const agent = fakeAgent(steps);
  const outcome = await runInit({ projectRoot: root, request: { text, origin: "text", path: null, sha12: "aabbcc112233" }, language: "pt-BR", stage: "init", call: agent.call,
    ask: async q => q.id === ID_DO_BANCO ? "use as recomendações" : "use as recomendações" });
  expect(outcome.readiness.ready).toBe(true);
  const publicado = await readFile(join(root, ".capivara/init/skeleton.md"), "utf8");
  expect(publicado).not.toMatch(/SQLite|\.env|migra[çc][aã]o|banco descartável|num navegador/u);
  expect(publicado).toContain("não mantém banco de dados próprio");
});
