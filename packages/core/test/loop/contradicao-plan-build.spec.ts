import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runPhase, splitPhases, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import { conferirReparosNaEntrada, pastaDosReparos, validarReparo } from "../../src/loop/upstream.js";
import { defeitosDoRun, type EstadoDaRecuperacao } from "../../src/loop/defeitos.js";
import { runPaths } from "../../src/state/index.js";

const git = promisify(execFile);
const RUN = "build-conflict000000";
const MECANISMO = "Criar um registro usando a operação somente-leitura consultar.";
const RESULTADO = "Um registro ausente passa a existir, sem alterar registros existentes.";
const PLANO = `# Registros — Project Phases

<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->

## Overview

Registros locais.

## Phase 1: Registros

**Goal:** criar e consultar · **Depends on:** none · **Covers:** registros

- [ ] **Task:** ${MECANISMO}
  - **Acceptance criteria:**
    - ${RESULTADO}
  - **Traces:** registros

- [ ] **Task:** Consultar em src/listar.ts
  - **Acceptance criteria:**
    - A consulta preserva os registros.
  - **Traces:** registros

## Open Questions

Nenhuma.
`;
const TECNICA = "consultar: antes=0; depois=0";
const DIAGNOSTICO = "TASK 1: INCOMPLETE — B1: CRITERION: criar o registro ausente; OBSERVED: src/criar.ts usa consultar; " +
  "EXPECTED: o registro passa a existir; LOCATION: `consulta.log`; EVIDENCE: «" + TECNICA + "»; " +
  "FIX: usar criar; CHECK: criar registro ausente; UPSTREAM: PLAN — project-phases.md: «" + MECANISMO + "» contradiz «" + RESULTADO + "»: a operação aprovada não escreve.\nTASK 2: DONE";
let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-conflict-"));
  await git("git", ["init", "-q", "-b", "main"], { cwd: root });
  await git("git", ["config", "user.email", "t@t"], { cwd: root });
  await git("git", ["config", "user.name", "test"], { cwd: root });
  await mkdir(join(root, ".capivara/init"), { recursive: true });
  await mkdir(join(root, "src"));
  await writeFile(join(root, ".gitignore"), ".capivara/runs/\n.capivara/handoffs/\n.capivara/repairs/\n");
  await writeFile(join(root, ".capivara/init/project-phases.md"), PLANO);
  await writeFile(join(root, ".capivara/init/skeleton.md"), "# Registros\n## Stack\n- Terminal\n");
  const prova = await git(process.execPath, ["-e", "const registros = new Map(); const consultar = chave => registros.get(chave); const antes = registros.size; consultar('ausente'); console.log(`consultar: antes=${antes}; depois=${registros.size}`);"]);
  expect(prova.stdout.trim()).toBe(TECNICA);
  await writeFile(join(root, "consulta.log"), prova.stdout);
  await writeFile(join(root, "src/listar.ts"), "export const listar = () => [];\n");
  await git("git", ["add", "."], { cwd: root });
  await git("git", ["commit", "-qm", "base"], { cwd: root });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const ok = (stdout = "feito"): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });

async function executar(diagnosticos: string[], plano = PLANO) {
  const split = splitPhases(plano, root, RUN);
  if (!split.ok) throw new Error(JSON.stringify(split.errors));
  const calls: string[] = [];
  let revisoes = 0;
  const call = async (c: EngineCall) => {
    calls.push(c.repair ? "verifier:repair" : c.role);
    if (c.role === "verifier" && !c.repair) return ok(diagnosticos[Math.min(revisoes++, diagnosticos.length - 1)]!);
    // O mesmo agente falso antes e depois: reparador entrega a funcionalidade;
    // executor seguinte volta ao mecanismo literal que a revisão pede.
    await writeFile(join(root, "src/criar.ts"), c.repair ? "export const criar = () => 'criado';\n" : "export const criar = () => 'consulta';\n");
    return ok();
  };
  const outcome = await runPhase({ projectRoot: root, runId: RUN, language: "pt-BR", engine: "codex", session: split.sessions[0]!,
    commitsEnabled: false, maxCycles: 3, maxVerifierRepairs: 1, sleep: async () => undefined,
    testCommand: { command: "test", source: "fixture", containerized: false },
    testRunner: async () => ({ exitCode: 0, output: "passed" }), call });
  const state = JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), "utf8")) as EstadoDaRecuperacao;
  return { calls, outcome, state, repairs: state.defects.flatMap(d => d.attempts).length };
}

it("encaminha o conflito comprovado antes de qualquer reparo impossível", async () => {
  const r = await executar([DIAGNOSTICO]);
  expect({ calls: r.calls, repairs: r.repairs, status: r.outcome.status }).toEqual({ calls: ["builder", "verifier"], repairs: 0, status: "failed" });
  expect(r.state.defects[0]?.status).toBe("UPSTREAM_REPAIR_REQUIRED");
  const [id] = await readdir(pastaDosReparos(root));
  const p = await validarReparo(root, id!);
  expect(p.ok).toBe(true);
  if (p.ok) expect(p.evidence.artifacts).toContainEqual(expect.objectContaining({ path: "consulta.log" }));
  expect(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")).toBe(PLANO);
});

it("a revisão após uma correção não manda desfazê-la; mantém código, histórico e retomada", async () => {
  const primeira = DIAGNOSTICO.replace(/; UPSTREAM:[^\n]+/u, "");
  const segunda = DIAGNOSTICO.replace("OBSERVED: src/criar.ts usa consultar", "OBSERVED: src/criar.ts agora cria, mas diverge da prescrição").replace("FIX: usar criar", "FIX: voltar a consultar");
  const r = await executar([primeira, segunda, primeira]);
  expect({ calls: r.calls, repairs: r.repairs }).toEqual({ calls: ["builder", "verifier", "verifier:repair", "verifier"], repairs: 1 });
  expect(r.state.defects[0]?.status).toBe("UPSTREAM_REPAIR_REQUIRED");
  const codigo = await readFile(join(root, "src/criar.ts"), "utf8");
  expect(codigo).toContain("criado");
  const evidence = await readFile(join(runPaths(root, RUN).root, "evidence.jsonl"), "utf8");
  expect((await executar([segunda])).calls).toEqual([]);
  const conferencia = await conferirReparosNaEntrada(root, "plan", () => ({ phase: 1, components: [], contracts: [] }));
  expect(conferencia.pendentes).toHaveLength(1);
  const skeleton = await readFile(join(root, ".capivara/init/skeleton.md"), "utf8");
  const consulta = await readFile(join(root, "src/listar.ts"), "utf8");
  // A autoridade documental aprova apenas a troca impossível. O BUILD não edita o plano.
  const aprovado = PLANO.replace(MECANISMO, "Criar um registro usando a operação criar.");
  await writeFile(join(root, ".capivara/init/project-phases.md"), aprovado);
  const retomada = await executar(["TASK 1: DONE\nTASK 2: DONE"], aprovado);
  expect(retomada.outcome.status).toBe("complete");
  expect(retomada.calls).toEqual(["verifier"]);
  expect(await readFile(join(root, "src/criar.ts"), "utf8")).toBe(codigo);
  expect(await readFile(join(runPaths(root, RUN).root, "evidence.jsonl"), "utf8")).toContain(evidence.trim());
  expect(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")).toBe(aprovado);
  expect(await readFile(join(root, ".capivara/init/skeleton.md"), "utf8")).toBe(skeleton);
  expect(await readFile(join(root, "src/listar.ts"), "utf8")).toBe(consulta);
});

const INICIAL = "TASK 1: INCOMPLETE — B1: CRITERION: cumprir a operação; OBSERVED: src/criar.ts retorna `consulta`; EXPECTED: o efeito contratado; FIX: retornar `criado`; CHECK: conferir o efeito\nTASK 2: DONE";
const INVERSO = "TASK 1: INCOMPLETE — [P01-D1] B1: CRITERION: cumprir a operação; OBSERVED: src/criar.ts retorna `criado`; EXPECTED: o efeito contratado; FIX: retornar `consulta`; CHECK: conferir o efeito\nTASK 2: DONE";

it("recomendações inversas sem prova para arbitrar param em revisão inconclusiva, sem culpar o executor ou alterar PLAN", async () => {
  const r = await executar([INICIAL, INVERSO, INICIAL]);
  expect(r.calls).toEqual(["builder", "verifier", "verifier:repair", "verifier"]);
  expect(r.repairs).toBe(1);
  expect(r.outcome).toMatchObject({ status: "failed", inconclusiva: expect.stringContaining("diagnósticos incompatíveis") });
  expect(r.state.defects[0]?.status).not.toBe("UPSTREAM_REPAIR_REQUIRED");
  expect(await readFile(join(root, "src/criar.ts"), "utf8")).toContain("criado");
  expect(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")).toBe(PLANO);
  // Quando a revisão reúne a prova que faltava, a mesma recuperação existente
  // recebe o defeito, sem nova sessão de escrita ou mudança unilateral do plano.
  const comprovado = await executar([DIAGNOSTICO]);
  expect(comprovado.calls).toEqual(["verifier"]);
  expect(comprovado.state.defects[0]?.status).toBe("UPSTREAM_REPAIR_REQUIRED");
});

it("uma regressão comprovada após a correção pode exigir restaurar código e segue o reparo normal", async () => {
  const plano = PLANO.replace(MECANISMO, "Consultar sem alterar registros existentes.");
  await writeFile(join(root, ".capivara/init/project-phases.md"), plano);
  const prova = INVERSO.replace("; FIX:", "; LOCATION: `regressao.log`; EVIDENCE: «criado alterou registros que deveriam ser preservados»; FIX:");
  await writeFile(join(root, "regressao.log"), "criado alterou registros que deveriam ser preservados");
  const r = await executar([INICIAL, prova, "TASK 1: DONE\nTASK 2: DONE"], plano);
  expect(r.calls).toEqual(["builder", "verifier", "verifier:repair", "verifier", "builder", "verifier"]);
  expect(r.outcome.status).toBe("complete");
  expect(r.repairs).toBe(2);
  expect(await readdir(pastaDosReparos(root)).catch(() => [])).toEqual([]);
});

it.each([
  ["sem prova técnica", DIAGNOSTICO.replace(/EVIDENCE:.*?; FIX:/u, "FIX:")],
  ["citação inventada", DIAGNOSTICO.replace(MECANISMO, "Operação nunca aprovada")],
  ["prova inventada", DIAGNOSTICO.replace(TECNICA, "Esta evidência não existe")],
  ["o próprio diagnóstico como prova", DIAGNOSTICO.replace("`consulta.log`", "`.capivara/runs/build-conflict000000/logs/P01.verify-1.log`")],
])("%s não recebe autoridade sobre o PLAN", async (_nome, diagnostico) => {
  const r = await executar([diagnostico]);
  const ids = await readdir(pastaDosReparos(root)).catch(() => []);
  const pacotes = await Promise.all(ids.map(id => validarReparo(root, id)));
  expect(r.state.defects.some(d => d.status === "UPSTREAM_REPAIR_REQUIRED"), JSON.stringify(pacotes)).toBe(false);
  expect(await readdir(pastaDosReparos(root)).catch(() => [])).toEqual([]);
  expect(await readFile(join(root, ".capivara/init/project-phases.md"), "utf8")).toBe(PLANO);
});

it("redação diferente do mesmo defeito não conta como progresso após mudança no código", async () => {
  const a = "TASK 1: INCOMPLETE — CRITERION: criar registro; OBSERVED: retorna consulta; EXPECTED: criação\nTASK 2: DONE";
  const b = a.replace("criar registro", "um registro novo deve passar a existir");
  const r = await executar([a, b]);
  expect(r.state.defects.flatMap(d => d.attempts).some(t => t.result === "progress")).toBe(false);
});

it("implementação equivalente válida e observação de preferência não bloqueiam", async () => {
  const plano = PLANO.replace(MECANISMO, "Criar um registro respeitando os contratos públicos.");
  await writeFile(join(root, ".capivara/init/project-phases.md"), plano);
  const r = await executar(["TASK 1: DONE — ADVISORY: prefiro outro helper\nTASK 2: DONE"], plano);
  expect(r.outcome.status).toBe("complete");
  expect(r.repairs).toBe(0);
});

it("decisão válida e defeito real continuam exigindo reparo e revisão independente", async () => {
  const plano = PLANO.replace(MECANISMO, "Criar um registro usando a operação criar.");
  await writeFile(join(root, ".capivara/init/project-phases.md"), plano);
  const r = await executar(["TASK 1: INCOMPLETE — CRITERION: usar a operação criar; OBSERVED: usa consulta; EXPECTED: criar; FIX: criar\nTASK 2: DONE", "TASK 1: DONE\nTASK 2: DONE"], plano);
  expect(r.outcome.status).toBe("complete");
  expect(r.calls).toEqual(["builder", "verifier", "verifier:repair", "verifier"]);
});
