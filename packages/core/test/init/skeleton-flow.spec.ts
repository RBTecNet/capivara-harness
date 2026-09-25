/**
 * O caminho por esqueleto, do pedido ao plano.
 *
 * A documentação deixou de ter leitor humano, e o critério de aceite virou um
 * só: o loop consegue executar. Este caminho troca quatro documentos em prosa
 * por uma leitura do produto inteiro mais as fases, cada uma vendo só a sua
 * fatia — e os portões que protegem a execução continuam valendo.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InitBlockedError, runInit } from "../../src/init/index.js";
import { SKELETON, fakeAgent, skeletonPath } from "../support/fake-agent.js";
import type { ScriptStep } from "../support/fake-agent.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-esqueleto-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const request = { text: "uma pousada com reservas", origin: "text" as const, path: null, sha12: "abc123abc123" };

async function run(steps: ScriptStep[]) {
  const agent = fakeAgent(steps);
  const dito: string[] = [];
  const outcome = await runInit({
    projectRoot,
    request,
    language: "português do Brasil",
    announce: (message) => void dito.push(message),
    call: agent.call,
    ask: async () => "use as recomendações",
  });
  return { outcome, agent, anunciado: dito.join("\n") };
}

describe("caminho por esqueleto", () => {
  it("chega a RALPH READY com o plano publicado", async () => {
    const { outcome } = await run(skeletonPath());
    expect(outcome.readiness.ready, outcome.rendered).toBe(true);

    const plano = await readFile(join(projectRoot, ".capivara", "init", "project-phases.md"), "utf8");
    expect(plano).toContain("Phase 1");
    expect(plano).toContain("Phase 2");
  });

  it("publica o esqueleto como registro do que foi decidido", async () => {
    await run(skeletonPath());
    const esqueleto = await readFile(join(projectRoot, ".capivara", "init", "skeleton.md"), "utf8");
    expect(esqueleto).toContain("PostgreSQL 16");
    expect(esqueleto).toContain("US-1.1");
    expect(esqueleto).toContain("Regras transversais");
  });

  it("não escreve documento em prosa nenhum: eles existiam para um leitor", async () => {
    await run(skeletonPath());
    for (const prosa of ["project-description.md", "user-stories.md", "database-schema.md"]) {
      await expect(readFile(join(projectRoot, ".capivara", "init", prosa), "utf8")).rejects.toThrow();
    }
  });

  it("cada fase vê só a sua fatia, não o produto inteiro", async () => {
    const { agent } = await run(skeletonPath());

    const fase2 = agent.calls.find((call) => call.subject === "phase-p02");
    expect(fase2?.prompt).toContain("US-1.1");
    // A entidade que só a fase 1 cobre não viaja para a fase 2.
    expect(fase2?.prompt).not.toContain("pertence a statuses");
  });

  it("as regras transversais chegam a TODAS as fases", async () => {
    // É delas que nasciam as contradições: cada fase decidindo por conta.
    const { agent } = await run(skeletonPath());
    for (const parte of ["phase-p01", "phase-p02"]) {
      const chamada = agent.calls.find((call) => call.subject === parte);
      expect(chamada?.prompt, parte).toContain("não se sobrepõem");
    }
  });

  /*
   * O que a fatia economiza, medido pelo CONTEÚDO e não por bytes.
   *
   * Havia aqui uma comparação de tamanho — o prompt da fase menor que o do
   * esqueleto — e ela era um proxy que deixou de funcionar: o escritor da fase
   * passou a receber o pedido verbatim (§77), e num pedido de 16 KB ele domina os
   * dois lados. O proxy nunca foi a tese. A tese é que uma fase não carrega o que
   * as outras cobrem, e é isso que se afirma aqui, nas duas direções: a fase 1 não
   * vê a story nem o fluxo da fase 2, e a 2 não vê a entidade da 1.
   */
  it("a fatia não carrega o que outra fase cobre — nas duas direções", async () => {
    const { agent } = await run(skeletonPath());
    const fase1 = agent.calls.find((call) => call.subject === "phase-p01");

    expect(fase1?.prompt).toContain("statuses");
    expect(fase1?.prompt).not.toContain("US-1.1");
    expect(fase1?.prompt).not.toContain("Criar reserva");
  });

  it("e o pedido chega a quem escreve a fase: era o auditor que o tinha, e ela não", async () => {
    /*
     * A assimetria custava o run: o auditor da fase recebia o pedido verbatim e
     * cobrava o que ele exige — tamanho de campo, rolagem, lista exata de valores
     * —, e o escritor via só a fatia. Dos 25 achados de uma auditoria do
     * `assistencia2`, 18 eram detalhes que a fase não podia conhecer.
     */
    const { agent } = await run(skeletonPath());
    const fase = agent.calls.find((call) => call.subject === "phase-p01");
    expect(fase?.prompt).toContain(request.text);
    // E com o limite dito: ver o pedido inteiro não autoriza escrever a fase do vizinho.
    expect(fase?.prompt).toContain("you write ONLY this phase");
  });

  it("a cobertura sai do esqueleto, não de documento em prosa", async () => {
    const { outcome } = await run(skeletonPath());
    expect(outcome.readiness.checks.find((check) => check.id === "cobertura")?.passed).toBe(true);
  });

  it("esqueleto inválido duas vezes bloqueia com o defeito nomeado", async () => {
    const steps = skeletonPath();
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: { stdout: '{"contract":"capivara-skeleton/v1","phases":[]}' },
      repeat: true,
    });
    await expect(run(steps)).rejects.toThrow(InitBlockedError);
  });

  it("esqueleto recusado uma vez é pedido de novo com os defeitos nomeados", async () => {
    let vez = 0;
    const steps = skeletonPath().filter((step) => step.match.subject !== "skeleton");
    steps.unshift({
      match: { role: "writer", stage: "authoring", subject: "skeleton" },
      respond: {
        stdout: () => {
          vez += 1;
          return vez === 1 ? '{"contract":"capivara-skeleton/v1","phases":[]}' : SKELETON;
        },
      },
      repeat: true,
    });

    const { agent, anunciado } = await run(steps);
    expect(anunciado).toContain("defeito(s)");
    const segunda = agent.calls.filter((call) => call.subject === "skeleton").at(-1);
    expect(segunda?.prompt).toContain("previous attempt was rejected");
  });

  it("o ensaio do verificador continua rodando: é ele que prova que o critério é provável", async () => {
    const { agent, outcome } = await run(skeletonPath());
    expect(agent.calls.some((call) => call.role === "verifier" && call.stage === "verify")).toBe(true);
    expect(outcome.readiness.checks.find((check) => check.id === "ensaio")?.passed).toBe(true);
  });
});
