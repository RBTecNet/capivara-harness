/**
 * §125 H · reparo documental excepcional (spec §8; §13.12 a §13.14).
 *
 * O estado `UPSTREAM_REPAIR_REQUIRED` só existe com um pacote íntegro,
 * coerente com a versão publicada e completo; a recusa é determinística e
 * antecipada (nada é escrito, nenhum agente é chamado). O reparo que alcança
 * além do defeito pede decisão do usuário, presa ao impacto mostrado, e a
 * recusa deixa todo o resto intacto.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkUpstreamPackage, escopoDoReparo, idDoReparo, sha12, shaDoImpacto, type UpstreamManifest } from "../../src/contract/index.js";
import { conferirReparosNaEntrada, decidirEscopo, pastaDosReparos, publicarReparo, reparosPendentes, validarReparo, type PedidoDeReparo } from "../../src/loop/upstream.js";
import { runPhase, splitPhases, type EngineResult, type PhaseRunOptions } from "../../src/loop/index.js";
import { defeitosDoRun } from "../../src/loop/defeitos.js";
import { runPaths } from "../../src/state/index.js";

let root = "";
const FASES = "# Plano\n\n## Phase 1: Agenda\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-upstream-"));
  await mkdir(join(root, ".capivara", "init"), { recursive: true });
  await writeFile(join(root, ".capivara", "init", "project-phases.md"), FASES);
  await writeFile(join(root, ".capivara", "init", "skeleton.md"), "# Esqueleto\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const DIAGNOSTICO = [
  "## Defeito", "O critério 'a lista mostra o total' da P02 contradiz o contrato do componente agenda.",
  "## Observado", "O contrato `GET /agenda` não devolve total.",
  "## Esperado", "Ou o critério sai, ou o contrato ganha o total.",
  "## Contornos tentados", "executor (2x, sem progresso), verificador (1x, sem progresso).",
  "## Limites da edição", "Só o critério da task 2 da P02, ou só o contrato de GET /agenda.",
].join("\n");

function pedido(parcial: Partial<PedidoDeReparo> = {}): PedidoDeReparo {
  return {
    origin: { runId: "build-abc123abc123", phaseId: "P02", gate: "G3", cycle: 2, defectId: "P02-D1" },
    target: "plan",
    document: { name: "project-phases.md", contract: "capivara-phases/v2", sha12: sha12(FASES) },
    impact: { phases: [2], components: ["agenda"], contracts: ["GET /agenda"] },
    diagnosis: DIAGNOSTICO,
    evidence: {
      artifacts: [{ path: ".capivara/runs/build-abc123abc123/logs/P02.verify-2.log", sha12: "0123456789ab" }],
      handoffs: [".capivara/runs/build-abc123abc123/defects/P02/P02-D1/handoff-G3-c1.json"],
      recovery: [{ strategy: "executor", result: "no-progress", cycle: 1 }, { strategy: "verificador", result: "no-progress", cycle: 2 }],
      exhausted: true,
    },
    createdAt: "2026-10-21T00:00:00.000Z",
    ...parcial,
  };
}

describe("§13.12 · sem pacote completo e íntegro, nada é publicado", () => {
  it("o pacote válido é publicado inteiro, de uma vez, e relido pela mesma validação", async () => {
    const publicado = await publicarReparo(root, pedido());
    expect(publicado).toMatchObject({ ok: true, jaExistia: false });
    const id = idDoReparo(pedido().origin);
    expect((await readdir(pastaDosReparos(root))).sort()).toEqual([id]);
    expect((await readdir(join(pastaDosReparos(root), id))).sort()).toEqual(["diagnosis.md", "evidence.json", "manifest.json"]);
    expect(await validarReparo(root, id)).toMatchObject({ ok: true, manifest: { state: "UPSTREAM_REPAIR_REQUIRED", target: "plan" } });
    // Publicado é imutável: o mesmo id devolve o que já está lá.
    expect(await publicarReparo(root, pedido({ diagnosis: `${DIAGNOSTICO}\nmais` }))).toMatchObject({ ok: true, jaExistia: true });
    expect(await readFile(join(pastaDosReparos(root), id, "diagnosis.md"), "utf8")).toBe(DIAGNOSTICO);
  });

  it.each([
    ["diagnóstico sem seção", { diagnosis: DIAGNOSTICO.replace("## Contornos tentados", "## Outra coisa") }, /sem as seções: Contornos tentados/u],
    ["sem histórico de recuperação", { evidence: { ...pedido().evidence, recovery: [] } }, /histórico de recuperação/u],
    ["escada não esgotada", { evidence: { ...pedido().evidence, exhausted: false } }, /ainda há estratégia compatível/u],
    ["sem artefato", { evidence: { ...pedido().evidence, artifacts: [] } }, /sem artefatos/u],
    ["documento de outra versão", { document: { name: "project-phases.md", contract: "capivara-phases/v2", sha12: "aaaaaaaaaaaa" } }, /mudou desde o diagnóstico/u],
    ["autoridade errada", { document: { name: "skeleton.md", contract: "capivara-skeleton/v2", sha12: sha12("# Esqueleto\n") } }, /não é documento da etapa plan/u],
  ] as const)("recusa %s sem escrever nada", async (_nome, parcial, erro) => {
    const recusado = await publicarReparo(root, pedido(parcial as Partial<PedidoDeReparo>));
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) expect(recusado.errors.join("\n")).toMatch(erro);
    expect(await readdir(pastaDosReparos(root)).catch(() => [])).toEqual([]);
  });

  it("o pacote adulterado no disco é recusado na entrada da etapa, com o motivo", async () => {
    await publicarReparo(root, pedido());
    const id = idDoReparo(pedido().origin);
    await writeFile(join(pastaDosReparos(root), id, "evidence.json"), "{}\n");
    const [pendente] = await reparosPendentes(root, "plan");
    expect(pendente?.repairId).toBe(id);
    expect(pendente?.resultado.ok).toBe(false);
    if (pendente && !pendente.resultado.ok) expect(pendente.resultado.errors).toContain("evidence.json não confere com o hash do manifesto");
  });

  it("o documento revisado depois do diagnóstico torna o pacote velho, não aplicável", async () => {
    await publicarReparo(root, pedido());
    await writeFile(join(root, ".capivara", "init", "project-phases.md"), `${FASES}\n## Phase 2: Outra\n`);
    const resultado = await validarReparo(root, idDoReparo(pedido().origin));
    expect(resultado.ok).toBe(false);
  });
});

describe("§13.13 · escopo ampliado pede autorização; a recusa mantém o estado", () => {
  it("o reparo que alcança outra fase não é localizado, e a decisão vale só para o impacto mostrado", async () => {
    await publicarReparo(root, pedido({ impact: { phases: [2, 3], components: ["agenda", "relatorios"], contracts: ["GET /agenda"] } }));
    const id = idDoReparo(pedido().origin);
    const valido = await validarReparo(root, id);
    if (!valido.ok) throw new Error(valido.errors.join("\n"));
    const escopo = escopoDoReparo(valido.manifest, { phase: 2, components: ["agenda"], contracts: ["GET /agenda"] });
    expect(escopo).toEqual({ localizado: false, alem: { phases: [3], components: ["relatorios"], contracts: [] } });

    const autorizado = await decidirEscopo(root, id, "CONTINUAR COM ESCOPO AMPLIADO", () => new Date("2026-10-21T01:00:00Z"));
    expect(autorizado).toMatchObject({ ok: true, manifest: { state: "SCOPE_AUTHORIZED", authorization: { impactSha12: shaDoImpacto(valido.manifest.impact) } } });

    // Ampliar o impacto depois da autorização a invalida: extensão adicional exige nova aprovação.
    const caminho = join(pastaDosReparos(root), id, "manifest.json");
    const manifesto = JSON.parse(await readFile(caminho, "utf8")) as UpstreamManifest;
    manifesto.impact.phases.push(4);
    await writeFile(caminho, JSON.stringify(manifesto));
    const ampliado = await validarReparo(root, id);
    expect(ampliado.ok).toBe(false);
    if (!ampliado.ok) expect(ampliado.errors.join("\n")).toContain("exige nova aprovação");
  });

  it("abortar muda só o estado do pacote: documentos e o resto ficam como estavam", async () => {
    await publicarReparo(root, pedido({ impact: { phases: [2, 3], components: ["agenda"], contracts: [] } }));
    const id = idDoReparo(pedido().origin);
    const antes = await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8");
    const abortado = await decidirEscopo(root, id, "ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE");
    expect(abortado).toMatchObject({ ok: true, manifest: { state: "ABORTED" } });
    expect(await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8")).toBe(antes);
    expect(await readFile(join(pastaDosReparos(root), id, "diagnosis.md"), "utf8")).toBe(DIAGNOSTICO);
    // O abortado não espera mais a etapa.
    expect(await reparosPendentes(root, "plan")).toEqual([]);
  });

  it("estado sem decisão que o justifique é recusado", () => {
    const evidenceRaw = JSON.stringify(pedido().evidence);
    const manifest = {
      contract: "capivara-upstream-repair/v1", repairId: idDoReparo(pedido().origin), createdAt: "x", origin: pedido().origin, source: "build", target: "plan",
      document: pedido().document, state: "SCOPE_AUTHORIZED", impact: pedido().impact,
      files: { "diagnosis.md": sha12(DIAGNOSTICO), "evidence.json": sha12(evidenceRaw) },
    };
    const resultado = checkUpstreamPackage({ pasta: manifest.repairId, manifest, diagnosis: DIAGNOSTICO, evidenceRaw }, { "project-phases.md": sha12(FASES) });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.errors.join("\n")).toContain("sem a decisão do usuário");
  });
});

describe("§13.12 no runner · o BUILD encaminha o que o diagnóstico diz ser do documento, com o pacote válido", () => {
  const PLANO = [
    "# Agenda — Project Phases", "", "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->", "", "## Overview", "", "Fase única.", "", "---", "",
    "## Phase 1: Agenda", "", "**Goal:** listar · **Depends on:** none · **Covers:** agenda", "",
    "- [ ] **Task:** Listar os compromissos", "  - **Acceptance criteria:**", "    - A lista mostra o total de horas", "  - **Traces:** agenda", "",
    "## Open Questions", "", "Nenhuma.", "",
  ].join("\n");
  const DIAGNOSTICO_UPSTREAM = "TASK 1: INCOMPLETE — B1: CRITERION: a lista mostra o total de horas; OBSERVED: o contrato GET /agenda não tem duração; " +
    "EXPECTED: o total; UPSTREAM: PLAN — project-phases.md, critério da task 1 da Phase 1: o contrato da arquitetura não expõe duração, nenhuma implementação compatível mostra o total";

  async function fase(publicado: boolean, extra: { diagnostico?: string; architecture?: PhaseRunOptions["architecture"]; verificador?: () => string } = {}) {
    const RUN = "build-upstream000000";
    if (publicado) await writeFile(join(root, ".capivara", "init", "project-phases.md"), PLANO);
    else await rm(join(root, ".capivara", "init", "project-phases.md"), { force: true });
    const split = splitPhases(PLANO, root, RUN);
    if (!split.ok) throw new Error(JSON.stringify(split.errors));
    const anuncios: string[] = [];
    const chamadas: string[] = [];
    const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });
    const outcome = await runPhase({
      projectRoot: root, runId: RUN, language: "pt-BR", engine: "codex", session: split.sessions[0]!,
      testCommand: { command: "npm test", source: "teste", containerized: false }, commitsEnabled: false, maxCycles: 3, maxVerifierRepairs: 1,
      sleep: async () => undefined, announce: (linha) => anuncios.push(linha),
      ...(extra.architecture ? { architecture: extra.architecture } : {}),
      testRunner: async () => ({ exitCode: 0, output: "1 passed" }),
      call: async (chamada) => {
        chamadas.push(chamada.repair ? "reparo" : chamada.role);
        // Ninguém consegue mudar o que o documento impede: as correções não mudam nada.
        if (chamada.role === "builder" && chamada.attempt === 1) await writeFile(join(root, "agenda.ts"), "export const agenda = [];\n");
        return ok(chamada.role === "verifier" && !chamada.repair ? (extra.verificador?.() ?? extra.diagnostico ?? DIAGNOSTICO_UPSTREAM) : "feito");
      },
    });
    return { outcome, anuncios, chamadas, RUN };
  }

  // A escada inteira — o reparo do coautor e o executor, cada um relido pela revisão —, e então o pacote: a fase falha apontando-o.
  it("o reparo do verificador e o do executor voltam à revisão, e então o pacote: o defeito vira UPSTREAM_REPAIR_REQUIRED, nada é editado, e a fase falha", async () => {
    const { outcome, chamadas, RUN } = await fase(true);
    // A releitura do mesmo código é uma: depois da correção do executor, que também não mudou nada, o achado vale sem outra.
    expect(chamadas).toEqual(["builder", "verifier", "reparo", "verifier", "builder"]);
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 3 — verificação independente" });
    if (outcome.status !== "failed") return;
    const [repairId] = await readdir(pastaDosReparos(root));
    expect(repairId).toBe(`UR-${RUN}-P01-P01-D1-c1`);
    expect(outcome.cause).toContain(`reparo documental necessário`);
    expect(outcome.cause).toContain(repairId!);
    const pacote = await validarReparo(root, repairId!);
    expect(pacote).toMatchObject({ ok: true, manifest: { target: "plan", document: { name: "project-phases.md" }, state: "UPSTREAM_REPAIR_REQUIRED" } });
    if (pacote.ok) expect(pacote.evidence.recovery).toEqual([{ strategy: "verificador", result: "no-progress", cycle: 1 }, { strategy: "executor", result: "no-progress", cycle: 1 }]);
    const estado = JSON.parse(await readFile(join(defeitosDoRun(runPaths(root, RUN).root), "P01.json"), "utf8")) as { defects: { status: string }[] };
    expect(estado.defects[0]!.status).toBe("UPSTREAM_REPAIR_REQUIRED");
    expect(await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8")).toBe(PLANO);
  });

  it("sem o documento publicado, o pacote é recusado: a fase falha com o defeito comum, sem estado de reparo documental", async () => {
    const { outcome, anuncios } = await fase(false);
    expect(outcome).toMatchObject({ status: "failed", gate: "gate 3 — verificação independente" });
    if (outcome.status === "failed") expect(outcome.cause).not.toContain("reparo documental");
    expect(anuncios.filter((linha) => linha.includes("encaminhamento")), anuncios.join("\n")).toEqual([expect.stringContaining("o encaminhamento documental de P01-D1 foi recusado")]);
    expect(await readdir(pastaDosReparos(root)).catch(() => [])).toEqual([]);
  });
  // Da revisão adversarial do H.
  it("na retomada, o pacote ainda válido para a fase de novo; com o documento revisado, o defeito volta à escada", async () => {
    const primeira = await fase(true);
    expect(primeira.outcome.status).toBe("failed");
    // Mesmo run, documento intacto: nenhuma chamada, a falha aponta o reparo pendente.
    const segunda = await fase(true);
    expect(segunda.chamadas).toEqual([]);
    expect(segunda.outcome.status === "failed" ? segunda.outcome.cause : "").toContain("reparo documental pendente");
    // O documento muda (o PLAN foi revisado): o pacote fica velho e o defeito é reaberto — o BUILD volta a trabalhar.
    await writeFile(join(root, ".capivara", "init", "project-phases.md"), `${PLANO}\n<!-- revisado -->\n`);
    const terceira = await fase(false, { verificador: () => "TASK 1: DONE" });
    expect(terceira.chamadas.length).toBeGreaterThan(0);
  });

  it("o reparo de um contrato alcança as fases que o consomem: o impacto sai do grafo, não da redação", async () => {
    await writeFile(join(root, ".capivara", "init", "architecture.md"), "# Arquitetura\n");
    const diagnostico = "TASK 1: INCOMPLETE — B1: CRITERION: a lista mostra o total de horas; OBSERVED: sem duração; EXPECTED: o total; UPSTREAM: PLAN — architecture.md, contrato GET /agenda: não expõe duração";
    const { outcome } = await fase(true, {
      diagnostico,
      architecture: { texto: "fatia", sha12: "abcdefabcdef", componentes: ["agenda"], arquivos: [], contratosProprios: ["GET /agenda"], consumidoras: [2, 3] },
    });
    expect(outcome.status).toBe("failed");
    const [repairId] = await readdir(pastaDosReparos(root));
    const pacote = await validarReparo(root, repairId!);
    expect(pacote).toMatchObject({ ok: true, manifest: { document: { name: "architecture.md" }, impact: { phases: [1, 2, 3], contracts: ["GET /agenda"] } } });
    if (pacote.ok) expect(escopoDoReparo(pacote.manifest, { phase: 1, components: ["agenda"], contracts: ["GET /agenda"] }).localizado).toBe(false);
  });

  it("a alegação contra o INIT não é encaminhada nesta versão: fica no handoff, sem pacote", async () => {
    const diagnostico = "TASK 1: INCOMPLETE — B1: CRITERION: a lista mostra o total; OBSERVED: x; EXPECTED: y; UPSTREAM: INIT — skeleton.md e project-phases.md: o produto não define duração";
    const { anuncios } = await fase(true, { diagnostico });
    expect(anuncios.some((linha) => linha.includes("o encaminhamento ao INIT não está habilitado nesta versão"))).toBe(true);
    expect(await readdir(pastaDosReparos(root)).catch(() => [])).toEqual([]);
  });

  it("o documento citado de outra etapa não muda a autoridade: a alegação do PLAN vai a um documento do PLAN", async () => {
    await writeFile(join(root, ".capivara", "init", "architecture.md"), "# Arquitetura\n");
    const diagnostico = "TASK 1: INCOMPLETE — B1: CRITERION: o total; OBSERVED: x; EXPECTED: y; UPSTREAM: PLAN — skeleton.md pede o total, e architecture.md não expõe duração";
    await fase(true, { diagnostico });
    const [repairId] = await readdir(pastaDosReparos(root));
    expect(await validarReparo(root, repairId!)).toMatchObject({ ok: true, manifest: { document: { name: "architecture.md" }, target: "plan" } });
  });

  it("manifesto com tipos trocados é recusado, sem derrubar quem confere", async () => {
    await publicarReparo(root, pedido());
    const id = idDoReparo(pedido().origin);
    const caminho = join(pastaDosReparos(root), id, "manifest.json");
    const manifesto = JSON.parse(await readFile(caminho, "utf8")) as Record<string, unknown>;
    manifesto.authorization = null;
    manifesto.impact = { phases: [2], components: [7], contracts: [] };
    await writeFile(caminho, JSON.stringify(manifesto));
    const resultado = await validarReparo(root, id);
    expect(resultado.ok).toBe(false);
    await expect(conferirReparosNaEntrada(root, "plan", () => ({ phase: 2, components: [], contracts: [] }))).resolves.toBeDefined();
  });
});

describe("§13.13 na entrada do PLAN · a pergunta só quando o impacto passa do defeito", () => {
  const daFase2 = () => ({ phase: 2, components: ["agenda"], contracts: ["GET /agenda"] });

  it("localizado: confere e espera, sem perguntar nada", async () => {
    await publicarReparo(root, pedido());
    const perguntas: string[] = [];
    const conferencia = await conferirReparosNaEntrada(root, "plan", daFase2, async (texto) => (perguntas.push(texto), null));
    expect(perguntas).toEqual([]);
    expect(conferencia.pendentes).toEqual([idDoReparo(pedido().origin)]);
    expect(conferencia.linhas[0]).toContain("localizado no defeito");
  });

  it("ampliado: pergunta com as duas opções; continuar autoriza este impacto, abortar encerra e não toca nos documentos", async () => {
    await publicarReparo(root, pedido({ impact: { phases: [2, 3], components: ["agenda"], contracts: [] } }));
    const id = idDoReparo(pedido().origin);
    let opcoesVistas: readonly string[] = [];
    const continuar = await conferirReparosNaEntrada(root, "plan", daFase2, async (texto, opcoes) => {
      opcoesVistas = opcoes;
      expect(texto).toContain("fases 3");
      return "CONTINUAR COM ESCOPO AMPLIADO";
    });
    expect(opcoesVistas).toEqual(["CONTINUAR COM ESCOPO AMPLIADO", "ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE"]);
    expect(continuar.pendentes).toEqual([id]);
    expect(await validarReparo(root, id)).toMatchObject({ ok: true, manifest: { state: "SCOPE_AUTHORIZED" } });
    // Autorizado, não pergunta de novo para o mesmo impacto.
    const denovo = await conferirReparosNaEntrada(root, "plan", daFase2, async () => {
      throw new Error("não devia perguntar");
    });
    expect(denovo.linhas[0]).toContain("já autorizado para este impacto");
  });

  it("abortar mantém tudo como estava, e o pacote deixa de esperar", async () => {
    await publicarReparo(root, pedido({ impact: { phases: [2, 3], components: ["agenda"], contracts: [] } }));
    const antes = await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8");
    const conferencia = await conferirReparosNaEntrada(root, "plan", daFase2, async () => "ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE");
    expect(conferencia.pendentes).toEqual([]);
    expect(await readFile(join(root, ".capivara", "init", "project-phases.md"), "utf8")).toBe(antes);
    expect(await reparosPendentes(root, "plan")).toEqual([]);
  });

  it("sem quem responda, nada é decidido; pacote inválido é recusado sem pergunta", async () => {
    await publicarReparo(root, pedido({ impact: { phases: [2, 3], components: ["agenda"], contracts: [] } }));
    const id = idDoReparo(pedido().origin);
    const semResposta = await conferirReparosNaEntrada(root, "plan", daFase2);
    expect(semResposta.linhas[0]).toContain("espera decisão");
    expect(await validarReparo(root, id)).toMatchObject({ ok: true, manifest: { state: "UPSTREAM_REPAIR_REQUIRED" } });
    await writeFile(join(pastaDosReparos(root), id, "diagnosis.md"), "adulterado");
    const recusado = await conferirReparosNaEntrada(root, "plan", daFase2, async () => {
      throw new Error("não devia perguntar");
    });
    expect(recusado.linhas[0]).toContain("RECUSADO na entrada do plan");
    expect(recusado.pendentes).toEqual([]);
  });
});
