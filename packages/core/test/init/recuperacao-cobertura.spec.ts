import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { renderSkeleton, type Skeleton } from "../../src/contract/index.js";
import { InitBlockedError, readSkeletonState, runInit, type AgentCall } from "../../src/init/index.js";
import { writeSkeletonState } from "../../src/init/skeleton-state.js";
import { readPlanCache } from "../../src/init/plan-cache.js";
import { ID_DO_BANCO } from "../../src/interview/index.js";
import { runIdFor } from "../../src/state/index.js";
import { fakeAgent, NO_QUESTIONS, type ScriptStep } from "../support/fake-agent.js";

let root = "";
const request = { text: "Gerenciar registros externos pelo terminal. A linguagem será decidida pelo PLAN. Sem banco próprio.", origin: "text" as const, path: null, sha12: "112233445566" };
const RUN = runIdFor("init", request.sha12);

function completo(): Skeleton {
  return {
    contract: "capivara-skeleton/v2", projectName: "Registros", environment: [],
    stack: [{ component: "Interface", decision: "Terminal interativo" }], entities: [],
    stories: Array.from({ length: 6 }, (_, i) => ({ id: `US-1.${i + 1}`, statement: `Realizar a operação ${i + 1}` })),
    workflows: Array.from({ length: 5 }, (_, i) => ({ number: String(i + 1), name: `Operação ${i + 1}`, steps: ["Selecionar registro", "Confirmar operação"] })),
    rules: [{ subject: "registros.integridade", statement: "Uma operação cancelada preserva os registros existentes." }],
    phases: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, title: `Operação ${i + 1}`, goal: `Disponibilizar a operação ${i + 1} no terminal.`, dependsOn: i === 0 ? "none" : `Phase ${i}`, covers: [`US-1.${i + 1}`, `workflow ${Math.min(i + 1, 5)}`], areas: [], taskCount: 2 })),
    mvpCutPhase: 6,
  };
}

function semCobertura(esqueleto = completo()): Skeleton {
  return { ...esqueleto, phases: esqueleto.phases.map(p => ({ ...p, covers: p.covers.filter(c => !c.startsWith("workflow ")) })) };
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "capivara-init-covers-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function executar(respostas: (string | ((call: AgentCall) => string))[]) {
  const steps: ScriptStep[] = [{ match: { role: "writer", stage: "interview" }, respond: { stdout: NO_QUESTIONS }, repeat: true },
    ...respostas.map((stdout, index): ScriptStep => ({ match: { role: index === 2 ? "auditor" : "writer", stage: "authoring", subject: "skeleton", attempt: index + 1 }, respond: { stdout } }))];
  const agent = fakeAgent(steps);
  const perguntas: string[] = [];
  const run = runInit({ projectRoot: root, request, language: "pt-BR", stage: "init", call: agent.call,
    ask: async q => { perguntas.push(q.id); if (q.id !== ID_DO_BANCO) throw new Error("não há decisão de produto pendente"); return "4"; } });
  return { run, agent, perguntas };
}

const papeis = (agent: ReturnType<typeof fakeAgent>) => agent.calls.filter(c => c.stage === "authoring").map(c => c.role);

it.each([false, true])("não publica a substituta sem vínculos; preserva a resposta completa sem transplantar associações (divisão mudou: %s)", async mudou => {
  const primeira = completo();
  // Como no incidente: só I-17 na primeira resposta; a segunda perde a stack.
  primeira.stack = [{ component: "Execução", decision: "Node.js" }];
  const segunda = { ...primeira, stack: [] };
  const substituta = semCobertura();
  if (mudou) {
    substituta.phases = substituta.phases.map(p => ({ ...p, title: `Nova divisão ${p.number}`, goal: `Entregar a nova fatia ${p.number}.` }));
    substituta.workflows = substituta.workflows.map(w => ({ ...w, name: `Novo fluxo ${w.number}`, steps: ["Abrir a nova operação", "Executar a nova operação"] }));
  }
  const { run, agent, perguntas } = executar([JSON.stringify(primeira), JSON.stringify(segunda), JSON.stringify(substituta)]);
  const outcome = await run;
  expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  const publicado = await readSkeletonState(root, RUN);
  expect(publicado?.phases).toEqual(primeira.phases);
  expect(publicado?.workflows).toEqual(primeira.workflows);
  expect(await readFile(join(root, ".capivara/init/skeleton.md"), "utf8")).toBe(renderSkeleton(publicado!));
  expect(papeis(agent)).toEqual(["writer", "writer", "auditor"]);
  expect(agent.calls.some(c => c.stage === "audit" || c.role === "verifier")).toBe(false);
  expect(perguntas).toEqual([ID_DO_BANCO]);
  const cache = await readPlanCache(root, RUN);
  expect(Object.values(cache.esqueletos)).toContain(JSON.stringify(primeira));
  expect(Object.values(cache.esqueletos)).not.toContain(JSON.stringify(substituta));
});

it("divisão nova sem candidato completo volta ao agente com o diagnóstico de cobertura, que ele corrige na tentativa restante", async () => {
  const primeira = { ...completo(), stack: [] };
  const nova = completo();
  nova.phases.reverse();
  nova.phases = nova.phases.map((p, index) => ({ ...p, number: index + 1, title: `Nova fatia ${index + 1}`, dependsOn: "none" }));
  const incompleta = semCobertura(nova);
  const diagnostico = "sem fase que entregue: workflow 1, workflow 2, workflow 3, workflow 4, workflow 5";
  const { run, agent, perguntas } = executar([JSON.stringify(primeira), JSON.stringify(incompleta), call => JSON.stringify(call.prompt.includes(diagnostico) ? nova : incompleta)]);
  const outcome = await run;
  expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  expect((await readSkeletonState(root, RUN))?.phases).toEqual(nova.phases);
  expect(papeis(agent)).toEqual(["writer", "writer", "auditor"]);
  expect(perguntas).toEqual([ID_DO_BANCO]);
});

it.each(["incompleta", "ilegível"])("esgotar tentativas com resposta %s não publica uma reprovação nem sobrescreve a versão válida", async tipo => {
  const anterior = completo();
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await mkdir(join(root, ".capivara/handoffs"));
  await writeFile(join(root, ".capivara/init/skeleton.md"), renderSkeleton(anterior));
  await writeSkeletonState(root, RUN, anterior);
  const primeira = { ...completo(), stack: [] };
  const incompleta = JSON.stringify(semCobertura());
  const { run, agent, perguntas } = executar([JSON.stringify(primeira), incompleta, tipo === "incompleta" ? incompleta : "não é JSON"]);
  await expect(run).rejects.toThrow(InitBlockedError);
  expect(await readFile(join(root, ".capivara/init/skeleton.md"), "utf8")).toBe(renderSkeleton(anterior));
  expect(await readSkeletonState(root, RUN)).toEqual(anterior);
  expect(papeis(agent)).toEqual(["writer", "writer", "auditor"]);
  expect(perguntas).toEqual([ID_DO_BANCO]);
  expect(Object.keys((await readPlanCache(root, RUN)).esqueletos)).toEqual([]);
});

it("esqueleto válido publica PLAN READY na primeira resposta sem chamada adicional", async () => {
  const valido = completo();
  const { run, agent, perguntas } = executar([JSON.stringify(valido)]);
  const outcome = await run;
  expect(outcome.readiness.ready, outcome.rendered).toBe(true);
  expect(await readSkeletonState(root, RUN)).toEqual(valido);
  expect(await readFile(join(root, ".capivara/init/skeleton.md"), "utf8")).toBe(renderSkeleton(valido));
  expect(papeis(agent)).toEqual(["writer"]);
  expect(perguntas).toEqual([ID_DO_BANCO]);
});
