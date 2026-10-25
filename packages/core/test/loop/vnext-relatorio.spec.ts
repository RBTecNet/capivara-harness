/**
 * §125 G · §13.15 da especificação: a TUI, os eventos e o relatório
 * apresentam o mesmo ciclo, os mesmos gates, reparos e decisões.
 *
 * Uma fase de verdade (runner, Git, provider falso) atravessa um defeito do G3
 * corrigido pelo executor. O que a TUI recebeu (`onProgress` de recuperação e
 * as linhas do `announce`), o que ficou no `events.tsv` e o que o relatório
 * escreveu têm de ser a MESMA sequência de linhas, e o relatório não pode
 * inventar nada que os registros não tenham.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPhase, splitPhases } from "../../src/loop/index.js";
import type { BuildProgress, EngineCall, EngineResult } from "../../src/loop/index.js";
import { lerTransicoes } from "../../src/loop/narrador.js";
import { gravarRelatorio, resumirRun } from "../../src/loop/relatorio.js";
import { runPaths } from "../../src/state/index.js";

const run = promisify(execFile);
const RUN = "build-relatorio00000";
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-vnext-rel-"));
  await run("git", ["init", "-q", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "t@t"], { cwd: root });
  await run("git", ["config", "user.name", "t"], { cwd: root });
  await writeFile(join(root, ".gitignore"), ".capivara/runs/\n.capivara/handoffs/\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 0;\n");
  await run("git", ["add", "-A"], { cwd: root });
  await run("git", ["commit", "-q", "-m", "base"], { cwd: root });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PLANO = `# Agenda — Project Phases

<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->

## Overview

Fase única.

---

## Phase 1: Agenda

**Goal:** criar compromissos · **Depends on:** none · **Covers:** agenda

- [ ] **Task:** Criar o compromisso em \`src/a.ts\`
  - **Acceptance criteria:**
    - O compromisso é criado com data
  - **Traces:** agenda

## Open Questions

Nenhuma.
`;

const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });

describe("§13.15 · TUI, eventos e relatório contam a mesma recuperação", () => {
  it("as mesmas linhas, na mesma ordem, nos três lugares; e o relatório só diz o que está registrado", async () => {
    const split = splitPhases(PLANO, root, RUN);
    if (!split.ok) throw new Error(JSON.stringify(split.errors));
    const anuncios: string[] = [];
    const progresso: BuildProgress[] = [];
    let verificacoes = 0;
    const outcome = await runPhase({
      projectRoot: root, runId: RUN, language: "pt-BR", engine: "codex", session: split.sessions[0]!,
      testCommand: { command: "npm test", source: "teste", containerized: false },
      commitsEnabled: true, maxCycles: 2, sleep: async () => undefined,
      announce: (linha) => anuncios.push(linha),
      onProgress: (evento) => progresso.push(evento),
      testRunner: async () => ({ exitCode: 0, output: "1 passed" }),
      call: async (chamada: EngineCall) => {
        if (chamada.role === "builder") {
          await writeFile(join(root, "src", "a.ts"), `export const a = ${chamada.attempt};\n`);
          return ok("feito");
        }
        verificacoes += 1;
        return ok(verificacoes === 1 ? "TASK 1: INCOMPLETE — CRITERION: o compromisso; OBSERVED: sem data; EXPECTED: com data; FIX: gravar a data" : "TASK 1: DONE");
      },
    });
    expect(outcome).toMatchObject({ status: "complete", estado: "entregue com pendências" });

    const naTui = progresso.flatMap((evento) => (evento.kind === "recovery" ? [evento.line] : []));
    const nosEventos = (await lerTransicoes(root, RUN)).map((transicao) => transicao.linha);
    expect(naTui.length).toBeGreaterThanOrEqual(3);
    expect(nosEventos).toEqual(naTui);
    // O announce leva a mesma linha, com a fase na frente.
    expect(anuncios.filter((linha) => naTui.some((transicao) => linha === `[P01] ${transicao}`))).toHaveLength(naTui.length);

    const caminho = await gravarRelatorio(root, RUN);
    const markdown = await readFile(caminho, "utf8");
    for (const linha of naTui) expect(markdown).toContain(`- ${linha}`);
    const resumo = JSON.parse(await readFile(join(runPaths(root, RUN).root, "relatorio.json"), "utf8")) as Awaited<ReturnType<typeof resumirRun>>;
    const fase = resumo.fases.find((cada) => cada.id === "P01")!;
    expect(fase.transicoes).toEqual(nosEventos);
    expect(fase.status).toBe("complete");
    // O defeito do G3 e a ação do executor, sem segunda revisão (etapa 4 da redução): os mesmos que a TUI anunciou.
    expect(fase.defeitos).toHaveLength(1);
    const [defeito] = fase.defeitos;
    expect(defeito).toMatchObject({ id: "P01-D1", gates: ["G3"], status: "AWAITING_VALIDATION" });
    expect(defeito!.tentativas).toEqual([expect.objectContaining({ estrategia: "executor", gate: "G3", resultado: "pending" })]);
    expect(naTui.some((linha) => linha.includes("P01-D1") && linha.includes("estratégia: executor"))).toBe(true);
    // As provas: o que o livro tem, com a validade que ele diz.
    expect(fase.evidencias.map((evidencia) => evidencia.checkId)).toEqual(expect.arrayContaining(["suite", "task-1"]));
    expect(fase.evidencias.find((evidencia) => evidencia.checkId === "task-1")).toMatchObject({ resultado: "REPAIR_REQUIRED" });
    // Sem calls.jsonl (o runner foi chamado direto), o relatório não inventa contagem.
    expect(resumo.chamadas).toBeNull();
    expect(markdown).not.toContain("Chamadas de agente");
  });
});
