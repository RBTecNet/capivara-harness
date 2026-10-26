/**
 * A sessão nova antes da falha por sessão (item 7 de "atacar os pontos frágeis").
 *
 * A sessão de construção que não entregava resultado utilizável até o fim da
 * escada levava a `fecharFalha` e o build parava com código 2. Agora, antes de
 * fechar a fase como falha, UMA sessão nova: do verificador como executor,
 * quando ele roda outro modelo e pode escrever — o validador coautor aplicado à
 * falta de sessão —; senão, do executor. Só depois disso é falha.
 *
 * A recusa do provider, o timeout e a parte que cai continuam parando sem outra
 * chamada do mesmo modelo (§115.14, §115.17, §130): repetir a mesma recusa
 * custa dinheiro e devolve a mesma recusa. Com o verificador de outro modelo, é
 * ele quem faz a sessão nova.
 */

import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPhase, splitPhases } from "../../src/loop/index.js";
import { verificadorComOutroModelo } from "../../src/loop/build.js";
import type { EngineCall, EngineResult, PhaseSession } from "../../src/loop/index.js";
import { VALID_PHASES } from "../contract/fixture.js";

let projectRoot = "";
const RUN = "build-sessaonova01";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-sessao-nova-"));
});
afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function session(): PhaseSession {
  const split = splitPhases(VALID_PHASES, projectRoot, RUN);
  if (!split.ok) throw new Error("plano inválido");
  return split.sessions[0]!;
}

const ok = (stdout = "feito"): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });
/** A sessão que termina sem emitir resultado e sem escrever nada. */
const vazia = (): EngineResult => ({ exitCode: 0, stdout: "", stderr: "", timedOut: null, resultRead: false });

interface Cenario {
  /** O que o executor devolve na sessão de número `n` (1, 2, …); ele só escreve quando devolve `ok`. */
  executor: (n: number) => EngineResult;
  /** O verificador chamado para escrever (o reparo, ou a sessão nova como executor). */
  verificadorQueEscreve?: () => EngineResult;
  verificadorComOutroModelo?: boolean;
  maxVerifierRepairs?: number;
}

async function fase(cenario: Cenario) {
  const calls: EngineCall[] = [];
  const alvo = session();
  let sessoesDoExecutor = 0;
  const outcome = await runPhase({
    projectRoot,
    runId: RUN,
    language: "pt-BR",
    engine: "codex",
    session: alvo,
    testCommand: { command: "npm test", source: "teste", containerized: false },
    commitsEnabled: false,
    maxCycles: 3,
    maxVerifierRepairs: cenario.maxVerifierRepairs ?? 1,
    ...(cenario.verificadorComOutroModelo ? { verificadorComOutroModelo: true } : {}),
    sleep: async () => undefined,
    call: async (call) => {
      calls.push(call);
      if (call.role === "verifier" && call.repair === true) {
        await writeFile(join(projectRoot, "pelo-verificador.ts"), "export const fase = 'implementada';\n", "utf8");
        return cenario.verificadorQueEscreve ? cenario.verificadorQueEscreve() : ok("implementei a fase");
      }
      if (call.role === "verifier") return ok(Array.from({ length: alvo.taskCount }, (_, indice) => `TASK ${indice + 1}: DONE`).join("\n"));
      sessoesDoExecutor += 1;
      const resposta = cenario.executor(sessoesDoExecutor);
      if (resposta.exitCode === 0 && resposta.resultRead !== false && !resposta.providerFailure) {
        await writeFile(join(projectRoot, `pelo-executor-${sessoesDoExecutor}.ts`), "export const x = 1;\n", "utf8");
      }
      return resposta;
    },
    testRunner: async () => ({ exitCode: 0, output: "2 passed" }),
  });
  const doExecutor = calls.filter((call) => call.role === "builder");
  const escritasDoVerificador = calls.filter((call) => call.role === "verifier" && call.repair === true);
  return { outcome, calls, doExecutor, escritasDoVerificador };
}

describe("a sessão nova antes de a fase fechar como falha", () => {
  it("o executor devolve vazio duas vezes, o verificador de outro modelo implementa, e a fase segue — dita como não revisada por quem não a escreveu", async () => {
    const { outcome, doExecutor, escritasDoVerificador } = await fase({ executor: () => vazia(), verificadorComOutroModelo: true });

    expect(doExecutor).toHaveLength(2);
    expect(escritasDoVerificador).toHaveLength(1);
    expect(escritasDoVerificador[0]!.prompt).toContain("Esta é uma sessão nova, a última antes de a fase fechar como falha");
    expect(await readFile(join(projectRoot, "pelo-verificador.ts"), "utf8")).toContain("implementada");
    expect(outcome).toMatchObject({ status: "complete", estado: "entregue com pendências" });
    if (outcome.status === "complete") expect(outcome.pendencias).toEqual([expect.stringContaining("o verificador implementou a fase numa sessão nova")]);
  });

  it("com o verificador do mesmo modelo, a sessão nova é do executor; entregue, a fase é aceita", async () => {
    const { outcome, doExecutor, escritasDoVerificador } = await fase({ executor: (n) => (n <= 2 ? vazia() : ok()) });

    expect(doExecutor).toHaveLength(3);
    expect(doExecutor[2]!.prompt).toContain("Esta é uma sessão nova, a última antes de a fase fechar como falha");
    expect(escritasDoVerificador).toHaveLength(0);
    expect(outcome).toMatchObject({ status: "complete", estado: "aceito" });
  });

  it("o verificador de outro modelo que não pode escrever (sem reparo do verificador) não faz a sessão nova: o executor a faz", async () => {
    const { doExecutor, escritasDoVerificador } = await fase({ executor: (n) => (n <= 2 ? vazia() : ok()), verificadorComOutroModelo: true, maxVerifierRepairs: 0 });
    expect(doExecutor).toHaveLength(3);
    expect(escritasDoVerificador).toHaveLength(0);
  });

  it("a sessão nova também vazia: só então é falha, com uma sessão a mais e nenhuma outra", async () => {
    const { outcome, doExecutor } = await fase({ executor: () => vazia() });
    expect(doExecutor).toHaveLength(3);
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 0 — engine" });
  });

  it("a recusa do provider: com o verificador de outro modelo, ele implementa e a fase segue; o executor não é chamado de novo", async () => {
    const { outcome, doExecutor, escritasDoVerificador } = await fase({ executor: () => ({ ...ok("recusa do provider"), engineError: true, providerFailure: "quota" }), verificadorComOutroModelo: true });
    expect(doExecutor).toHaveLength(1);
    expect(escritasDoVerificador).toHaveLength(1);
    expect(outcome).toMatchObject({ status: "complete" });
  });

  it("o caminho limpo não ganha sessão nenhuma", async () => {
    const { outcome, doExecutor, escritasDoVerificador } = await fase({ executor: () => ok(), verificadorComOutroModelo: true });
    expect(doExecutor).toHaveLength(1);
    expect(escritasDoVerificador).toHaveLength(0);
    expect(outcome).toMatchObject({ status: "complete", estado: "aceito" });
  });
});

describe("quem é o verificador de outro modelo", () => {
  it("outro provider ou outro modelo; o mesmo par, ou papéis sem registro, não", () => {
    const papel = (provider: string, model: string) => ({ provider, model, effort: "" });
    expect(verificadorComOutroModelo({ builder: papel("opencode", "minimax/MiniMax-M3.1-Flash"), verifier: papel("codex", "gpt-6.1-sol") })).toBe(true);
    expect(verificadorComOutroModelo({ builder: papel("codex", "gpt-6-luna"), verifier: papel("codex", "gpt-6.1-sol") })).toBe(true);
    expect(verificadorComOutroModelo({ builder: papel("codex", "gpt-6.1-sol"), verifier: papel("codex", "gpt-6.1-sol") })).toBe(false);
    expect(verificadorComOutroModelo({ builder: papel("codex", "") })).toBe(false);
    expect(verificadorComOutroModelo(undefined)).toBe(false);
  });
});
