/**
 * O registro de defeitos de uma fase (§125 D; spec §5).
 *
 * Identidade determinística, orçamento derivado das tentativas em três escalas
 * independentes, regra de progresso e escada de estratégias — sem runner, sem
 * provider: o contrato que o runner consome, provado sozinho.
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RegistroDeDefeitos,
  assinaturaDaFalha,
  citacoes,
  defeitoCitado,
  defeitosDoRun,
  escadaDe,
  mesmoDefeito,
  severidadeDoAchado,
  testesQueFalharam,
  type Defect,
  type DefeitoEncontrado,
  type Estrategia,
  type OrcamentoDaRecuperacao,
} from "../../src/loop/defeitos.js";

let raiz = "";
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "capivara-defeitos-"));
});
afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

const ORCAMENTO: OrcamentoDaRecuperacao = { ciclos: 3, porCiclo: 6, porGate: 2, porDefeito: 3, reparosDoVerificador: 1 };
const todas = (): boolean => true;
const agente = { role: "builder" as const, attempt: 2 };

function achado(parcial: Partial<DefeitoEncontrado> & Pick<DefeitoEncontrado, "gate" | "nature">): DefeitoEncontrado {
  return { anchors: {}, summary: "falha", detail: "falha", ...parcial };
}

const registro = (): Promise<RegistroDeDefeitos> => RegistroDeDefeitos.abrir(raiz, "build-x", "P01");

describe("a assinatura da falha", () => {
  it("é a mesma para a mesma falha com linha, duração, id e caminho temporário diferentes", () => {
    expect(assinaturaDaFalha("FAIL a.spec.ts:12:4 em 35ms — /tmp/abc123/x.ts commit 9f8e7d6c"))
      .toBe(assinaturaDaFalha("FAIL a.spec.ts:98:1 em 1.2 s — /tmp/zzz/x.ts commit 0123abcd"));
  });

  it("muda quando o texto da falha muda", () => {
    expect(assinaturaDaFalha("expected 'reservas' to be visible")).not.toBe(assinaturaDaFalha("expected 'login' to be visible"));
  });
});

describe("identidade entre achados", () => {
  it("a mesma task é o mesmo defeito; outra task é outro", async () => {
    const r = await registro();
    const primeiro = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } }));
    expect(r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito).toBe(primeiro.defeito);
    expect(r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 2 } })).novo).toBe(true);
  });

  it("a suíte vermelha é um defeito só enquanto não fecha; fechada, só volta se um teste coincide", async () => {
    const r = await registro();
    const suite = r.registrar(achado({ gate: "G2", nature: "suite", anchors: { tests: ["a.spec.ts > cria"] } })).defeito;
    expect(r.registrar(achado({ gate: "G2", nature: "suite", anchors: { tests: ["b.spec.ts > lista"] } })).defeito).toBe(suite);
    suite.status = "RESOLVED";
    const outra = r.registrar(achado({ gate: "G2", nature: "suite", anchors: { tests: ["c.spec.ts > apaga"] } }));
    expect(outra.novo).toBe(true);
    outra.defeito.status = "RESOLVED";
    const volta = r.registrar(achado({ gate: "G2", nature: "suite", anchors: { tests: ["a.spec.ts > cria"] } }));
    expect(volta).toMatchObject({ novo: false, reaberto: true });
    expect(volta.defeito.defectId).toBe(suite.defectId);
  });

  it("entre gates diferentes, a ponte é a mensagem citada literalmente ou o id que o verificador citou", async () => {
    const r = await registro();
    const suite = r.registrar(achado({ gate: "G2", nature: "suite", anchors: { quotes: citacoes("expected 'Reserva criada com sucesso' to be visible") } })).defeito;
    const revisao = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1, quotes: citacoes("não mostrou \"Reserva criada com sucesso\"") } }));
    expect(revisao.defeito).toBe(suite);
    expect(suite.gates).toEqual(["G2", "G3"]);
    const outro = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 2 } })).defeito;
    expect(r.registrar(achado({ gate: "G2", nature: "integracao-teste", anchors: {}, tag: outro.defectId })).defeito).toBe(outro);
  });

  it("um nome comum (rota, arquivo) não junta dois defeitos de gates diferentes; a frase literal e o código de erro juntam", () => {
    const existente = (quotes: string[]): Defect => ({
      defectId: "P01-D1", phaseId: "P01", nature: "suite", discovered: { gate: "G2", cycle: 1, at: "" }, gates: ["G2"], severity: "B1",
      anchors: { quotes, signature: "x" }, summary: "", detail: "", criterion: "", observed: "", expected: "", hypothesis: "", components: [],
      status: "OPEN", attempts: [], failedStrategies: [], evidence: [], invalidated: [], handoffs: [], rediagnoses: [], costs: { calls: 0, seconds: 0, costUsd: 0 },
    });
    const daRevisao = (quotes: string[]): DefeitoEncontrado => ({ gate: "G3", nature: "task", anchors: { task: 1, quotes }, summary: "", detail: "" });
    expect(mesmoDefeito(existente(["/categorias"]), daRevisao(["/categorias"]))).toBe(false);
    expect(mesmoDefeito(existente(["categoriaspage.tsx"]), daRevisao(["categoriaspage.tsx"]))).toBe(false);
    expect(mesmoDefeito(existente(["reserva criada com sucesso"]), daRevisao(["reserva criada com sucesso"]))).toBe(true);
    expect(mesmoDefeito(existente(["err_module_not_found"]), daRevisao(["err_module_not_found"]))).toBe(true);
    expect(mesmoDefeito(existente(["econnrefused 127.0.0.1:3000"]), daRevisao(["econnrefused 127.0.0.1:3000"]))).toBe(true);
  });

  it("o defeito que volta guarda a história, os gates e o rediagnóstico", async () => {
    const r = await registro();
    const d = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 }, detail: "primeiro" })).defeito;
    r.consumir({ estrategia: "executor", defeitos: [d] }, agente);
    r.validar(d, null, false);
    const volta = r.registrar(achado({ gate: "G2", nature: "task", anchors: { task: 1 }, detail: "segundo" }));
    expect(volta).toMatchObject({ novo: false, reaberto: true });
    expect(d.status).toBe("OPEN");
    expect(d.attempts).toHaveLength(1);
    expect(d.rediagnoses.map((item) => item.excerpt)).toEqual(["segundo"]);
    expect(d.gates).toEqual(["G3", "G2"]);
  });
});

describe("orçamento em três escalas, derivado das tentativas", () => {
  it("o G2 esgotado não tira a vez do G3 no mesmo ciclo", async () => {
    const r = await registro();
    const suite = r.registrar(achado({ gate: "G2", nature: "suite" })).defeito;
    const task = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    const orcamento = { ...ORCAMENTO, porGate: 1 };
    const primeira = r.planejar(orcamento, todas)!;
    expect(primeira).toMatchObject({ estrategia: "verificador", defeitos: [suite] });
    r.consumir(primeira, { role: "verifier", attempt: 1 });
    r.aguardarValidacao(primeira.defeitos);
    r.validar(suite, { assinatura: "outra" }, false);
    const segunda = r.planejar(orcamento, todas)!;
    expect(segunda.defeitos).toEqual([task]);
    expect(r.uso().byGate).toEqual({ G2: 1 });
  });

  it("a ação agrupada é uma só no ciclo e no gate, e uma tentativa para cada defeito", async () => {
    const r = await registro();
    const d1 = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    const d2 = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 2 } })).defeito;
    // Sem reparo do verificador (o primeiro degrau do achado da revisão), a correção do executor agrupa os dois.
    const acao = r.planejar(ORCAMENTO, (estrategia: Estrategia) => estrategia === "executor")!;
    expect(acao).toMatchObject({ estrategia: "executor", defeitos: [d1, d2] });
    r.consumir(acao, agente);
    expect(r.uso()).toMatchObject({ repairs: 1, byGate: { G3: 1 }, byDefect: { [d1.defectId]: 1, [d2.defectId]: 1 } });
    expect(d1.attempts[0]!.action).toBe(d2.attempts[0]!.action);
  });

  it("o teto do ciclo e o do defeito param o planejamento; o ciclo novo renova os contadores", async () => {
    const r = await registro();
    const d = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    const orcamento = { ...ORCAMENTO, porCiclo: 1 };
    r.consumir(r.planejar(orcamento, todas)!, agente);
    r.validar(d, { assinatura: "mudou" }, false);
    expect(r.planejar(orcamento, todas)).toBeNull();
    r.escalar(d);
    expect(r.novoCiclo()).toBe(2);
    expect(d.status).toBe("OPEN");
    expect(r.uso().repairs).toBe(0);
    expect(r.planejar(orcamento, todas)?.defeitos).toEqual([d]);
    expect(d.attempts).toHaveLength(1);
  });
});

describe("progresso e escada", () => {
  it("não reproduzido resolve; falha diferente sem regressão é progresso e a estratégia continua", async () => {
    const r = await registro();
    const d = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    r.consumir({ estrategia: "executor", defeitos: [d] }, agente);
    d.attempts[0]!.changed = true;
    expect(r.validar(d, { assinatura: "outra" }, false)).toBe("progress");
    expect(r.proximaEstrategia(d, todas)).toBe("executor");
    r.consumir({ estrategia: "executor", defeitos: [d] }, agente);
    expect(r.validar(d, null, false)).toBe("resolved");
    expect(d.status).toBe("RESOLVED");
  });

  it("a mesma falha bloqueia a estratégia e sobe a escada; a outra estratégia no meio a libera", async () => {
    const r = await registro();
    const d = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    r.consumir({ estrategia: "executor", defeitos: [d] }, agente);
    expect(r.validar(d, { assinatura: d.anchors.signature }, false)).toBe("no-progress");
    expect(r.proximaEstrategia(d, todas)).toBe("verificador");
    r.consumir({ estrategia: "verificador", defeitos: [d] }, { role: "verifier", attempt: 1 });
    expect(r.validar(d, { assinatura: d.anchors.signature }, false)).toBe("no-progress");
    // As duas falharam sobre esta falha, mas o verificador veio depois do executor: o executor tem informação nova.
    expect(r.proximaEstrategia(d, todas)).toBe("executor");
  });

  it("duas estratégias que não mudam nada não se liberam uma à outra: é esgotamento técnico", async () => {
    const r = await registro();
    const d = r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    for (const estrategia of ["executor", "verificador"] as const) {
      r.consumir({ estrategia, defeitos: [d] }, estrategia === "executor" ? agente : { role: "verifier", attempt: 1 });
      d.attempts.at(-1)!.changed = false;
      expect(r.validar(d, { assinatura: d.anchors.signature }, false)).toBe("no-progress");
    }
    expect(r.proximaEstrategia(d, todas)).toBeNull();
    expect(r.semSaida(todas)).toBe(true);
  });

  it("ação que não mudou nada, regressão ou mais testes falhando nunca é progresso", async () => {
    const r = await registro();
    const casos: [boolean | undefined, boolean, number | undefined][] = [[false, false, undefined], [true, true, undefined], [true, false, 5]];
    for (const [changed, regressao, testes] of casos) {
      const d = r.registrar(achado({ gate: "G2", nature: "suite", anchors: { tests: [`t${r.estado.seq}`] } })).defeito;
      r.consumir({ estrategia: "verificador", defeitos: [d] }, { role: "verifier", attempt: 1 }, 2);
      if (changed !== undefined) d.attempts.at(-1)!.changed = changed;
      expect(r.validar(d, { assinatura: "outra", ...(testes !== undefined ? { testes } : {}) }, regressao)).toBe("no-progress");
      d.status = "RESOLVED";
    }
  });

  it("sem estratégia possível em nenhum defeito aberto é esgotamento técnico; sem orçamento, não", async () => {
    const r = await registro();
    const d = r.registrar(achado({ gate: "G0", nature: "engine", anchors: {} })).defeito;
    r.consumir({ estrategia: "executor", defeitos: [d] }, agente);
    // A correção não mudou nada e a falha é a mesma: a única estratégia da natureza falhou, e nenhum ciclo novo a destrava.
    d.attempts.at(-1)!.changed = false;
    r.validar(d, { assinatura: d.anchors.signature }, false);
    expect(r.semSaida(todas)).toBe(true);
    // A correção que MUDOU o código sem resolver fica bloqueada só neste ciclo: o próximo recomeça com a história.
    const r3 = await RegistroDeDefeitos.abrir(raiz, "build-x", "P03");
    const t = r3.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } })).defeito;
    r3.consumir({ estrategia: "executor", defeitos: [t] }, agente);
    t.attempts.at(-1)!.changed = true;
    r3.validar(t, { assinatura: t.anchors.signature }, false);
    const soExecutor = (estrategia: Estrategia): boolean => estrategia === "executor";
    expect(r3.proximaEstrategia(t, soExecutor)).toBeNull();
    expect(r3.semSaida(soExecutor)).toBe(false);
    r3.novoCiclo();
    expect(r3.proximaEstrategia(t, soExecutor)).toBe("executor");
    const r2 = await RegistroDeDefeitos.abrir(raiz, "build-x", "P02");
    r2.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } }));
    expect(r2.semSaida(todas)).toBe(false);
    expect(r2.semSaida((estrategia: Estrategia) => estrategia === "conciliacao")).toBe(true);
  });

  it("a escada segue a natureza: a suíte e o achado da revisão começam pelo verificador, coautor", () => {
    expect(escadaDe("suite")).toEqual(["verificador", "executor"]);
    expect(escadaDe("task")).toEqual(["verificador", "executor"]);
    expect(escadaDe("engine")).toEqual(["executor"]);
    expect(escadaDe("integracao-conflito")[0]).toBe("conciliacao");
  });
});

describe("persistência", () => {
  it("o instantâneo volta igual, e o refazer arquiva o anterior em vez de apagar", async () => {
    const r = await registro();
    r.registrar(achado({ gate: "G3", nature: "task", anchors: { task: 1 } }));
    await r.salvar();
    const relido = await registro();
    expect(relido.estado.defects.map((defeito) => defeito.defectId)).toEqual(["P01-D1"]);
    const novo = await RegistroDeDefeitos.abrir(raiz, "build-x", "P01", () => new Date("2026-10-21T00:00:00Z"), true);
    expect(novo.estado.defects).toEqual([]);
    expect((await readdir(defeitosDoRun(raiz))).sort()).toEqual(["P01.2026-10-21T00-00-00-000Z.json"]);
  });
});

describe("leitura determinística da saída", () => {
  it("lê os testes que falharam de vitest, pytest e go", () => {
    expect(testesQueFalharam(" FAIL  test/a.spec.ts > cria 12ms\n× test/b.test.ts > lista\nFAILED tests/x.py::test_y - assert\n--- FAIL: TestZ (0.01s)"))
      .toEqual(["TestZ", "test/a.spec.ts > cria", "test/b.test.ts > lista", "tests/x.py::test_y"]);
  });

  it("B0 só quando o verificador marca; o id citado só vale se for um defeito conhecido", () => {
    expect(severidadeDoAchado("B0: a tabela não existe")).toBe("B0");
    expect(severidadeDoAchado("[P01-D1] B0 — a tabela não existe")).toBe("B0");
    expect(severidadeDoAchado("a tabela não existe (B0)")).toBe("B1");
    expect(defeitoCitado("[P01-D2] continua", ["P01-D1", "P01-D2"])).toBe("P01-D2");
    expect(defeitoCitado("[P01-D9] inventado", ["P01-D1"])).toBeUndefined();
  });
});
