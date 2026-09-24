/**
 * A retomada do `plan`.
 *
 * O `build` nunca refez fase fechada; o `plan` refazia tudo. No `assitencia`
 * foram 18 fases e 5.190 segundos de escritor, jogados fora duas vezes: uma no
 * impasse do auditor, outra no ensaio do verificador — e nas duas o que estava
 * escrito estava certo.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoriaDoPlano, planCachePath, readPlanCache } from "../../src/init/plan-cache.js";
import { ensureArtifactTree } from "../../src/state/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-plan-cache-"));
  await ensureArtifactTree(projectRoot);
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("memória do plano", () => {
  it("devolve a fase que o MESMO prompt já produziu", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarFase("prompt da fase 5", "## Phase 5");
    await memoria.fechar();

    const outra = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    expect(outra.faseEscrita("prompt da fase 5")).toBe("## Phase 5");
  });

  it("não devolve nada quando o prompt mudou — é o que invalida o cache sozinho", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarFase("prompt da fase 5", "## Phase 5");
    await memoria.fechar();

    const outra = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    expect(outra.faseEscrita("prompt da fase 5, agora com uma regra nova")).toBeNull();
  });

  it("não atravessa de um run para outro: pedido diferente, plano diferente", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarFase("p", "## Phase 1");
    await memoria.fechar();

    const deOutroRun = await MemoriaDoPlano.abrir(projectRoot, "init-2");
    expect(deOutroRun.faseEscrita("p")).toBeNull();
  });

  it("lembra a aprovação pela auditoria exata que aprovou", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarAprovacao("prompt de auditoria da fase 5");
    await memoria.fechar();

    const outra = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    expect(outra.jaAprovada("prompt de auditoria da fase 5")).toBe(true);
    // Mexer no eixo do auditor muda o prompt, e a aprovação velha cai sozinha.
    expect(outra.jaAprovada("prompt de auditoria da fase 5, com o eixo novo")).toBe(false);
  });

  it("`--fresh` recomeça do zero, como quem pediu esperava", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarFase("p", "## Phase 1");
    memoria.guardarAprovacao("a");
    await memoria.fechar();

    const limpa = await MemoriaDoPlano.abrir(projectRoot, "init-1", true);
    expect(limpa.faseEscrita("p")).toBeNull();
    expect(limpa.jaAprovada("a")).toBe(false);
  });

  it("grava a cada fase, não no fim: o run que morre no meio é o caso que importa", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarFase("p1", "## Phase 1");
    memoria.guardarFase("p2", "## Phase 2");
    await memoria.fechar();

    const emDisco = await readPlanCache(projectRoot, "init-1");
    expect(Object.values(emDisco.escritas)).toEqual(["## Phase 1", "## Phase 2"]);
  });

  it("aguenta gravações concorrentes — as fases são escritas em paralelo", async () => {
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    await Promise.all(
      Array.from({ length: 20 }, async (_, indice) => {
        memoria.guardarFase(`prompt ${indice}`, `## Phase ${indice}`);
      }),
    );
    await memoria.fechar();

    expect(Object.keys((await readPlanCache(projectRoot, "init-1")).escritas)).toHaveLength(20);
  });

  it("arquivo corrompido não derruba o run: recomeça sem memória", async () => {
    await writeFile(planCachePath(projectRoot, "init-1"), "{ isto não é json", "utf8");
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    expect(memoria.faseEscrita("p")).toBeNull();
  });

  it("contrato desconhecido é ignorado, não interpretado", async () => {
    await writeFile(
      planCachePath(projectRoot, "init-1"),
      JSON.stringify({ contract: "capivara-plan-cache/v2", runId: "init-1", escritas: { x: "## Phase 1" } }),
      "utf8",
    );
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    expect(memoria.faseEscrita("p")).toBeNull();
  });

  it("guarda ao lado do resto do estado do run", async () => {
    expect(planCachePath(projectRoot, "init-1")).toContain(join(".capivara", "handoffs"));
    const memoria = await MemoriaDoPlano.abrir(projectRoot, "init-1");
    memoria.guardarFase("p", "## Phase 1");
    await memoria.fechar();
    expect(JSON.parse(await readFile(planCachePath(projectRoot, "init-1"), "utf8")).contract).toBe("capivara-plan-cache/v1");
  });
});
