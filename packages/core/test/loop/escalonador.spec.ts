import { describe, expect, it } from "vitest";
import { bloqueadas, dependenciasEfetivas, esgotada, larguraDoPlano, proximas, type Agenda, type EstadoNaAgenda, type FaseAgendavel } from "../../src/loop/escalonador.js";
import { phaseDependencies } from "../../src/contract/index.js";

const fase = (number: number, dependsOn?: number[]): FaseAgendavel => ({
  id: `P${String(number).padStart(2, "0")}`,
  number,
  ...(dependsOn !== undefined ? { dependsOn } : {}),
});

/** O grafo do erp_teste: P2 e P3 só dependem da fundação. */
const ERP = [fase(1, []), fase(2, [1]), fase(3, [1]), fase(4, [2, 3]), fase(5, [1, 3])];

function agenda(fases: FaseAgendavel[], estados: Record<string, EstadoNaAgenda>, limite: number, exclusivas: string[] = []): Agenda {
  return { fases, estados: new Map(Object.entries(estados)), exclusivas: new Set(exclusivas), limite };
}

describe("o Depends on do contrato, em números", () => {
  it("lê as formas que o documento publica", () => {
    expect(phaseDependencies("none")).toEqual([]);
    expect(phaseDependencies("Phase 2, Phase 3")).toEqual([2, 3]);
    expect(phaseDependencies("P01, fase 3")).toEqual([1, 3]);
    expect(phaseDependencies("")).toEqual([]);
  });
});

describe("dependências efetivas", () => {
  it("a fundação entra em toda fase, mesmo quando o plano diz none", () => {
    expect(dependenciasEfetivas(fase(5, []), [fase(1, []), fase(5, [])])).toEqual({
      numeros: [1],
      ajuste: "a Phase 1 é a fundação: entra como dependência",
    });
  });

  it("a fundação que já chega por outro caminho não é ajuste", () => {
    expect(dependenciasEfetivas(ERP[3]!, ERP)).toEqual({ numeros: [1, 2, 3], ajuste: "" });
  });

  it("dependência que não vem antes vira todas as anteriores", () => {
    const fases = [fase(1, []), fase(2, [1]), fase(3, [7])];
    expect(dependenciasEfetivas(fases[2]!, fases).numeros).toEqual([1, 2]);
    expect(dependenciasEfetivas(fases[2]!, fases).ajuste).toContain("Phase 7");
  });

  it("sem Depends on lido, espera todas as anteriores", () => {
    const fases = [fase(1), fase(2), fase(3)];
    expect(dependenciasEfetivas(fases[2]!, fases).numeros).toEqual([1, 2]);
  });

  it("a primeira fase não depende de nada", () => {
    expect(dependenciasEfetivas(ERP[0]!, ERP)).toEqual({ numeros: [], ajuste: "" });
  });
});

describe("próximas fases", () => {
  it("com a fundação por fazer, só ela sai — por mais agentes que haja", () => {
    expect(proximas(agenda(ERP, {}, 4))).toEqual(["P01"]);
  });

  it("fundação integrada libera as que só dependem dela, na ordem do plano", () => {
    expect(proximas(agenda(ERP, { P01: "integrada" }, 4))).toEqual(["P02", "P03"]);
  });

  it("o teto de agentes corta a leva", () => {
    expect(proximas(agenda(ERP, { P01: "integrada" }, 1))).toEqual(["P02"]);
  });

  it("verde num worktree não é integrada: quem depende espera", () => {
    expect(proximas(agenda(ERP, { P01: "integrada", P02: "rodando", P03: "integrada" }, 4))).toEqual(["P05"]);
  });

  it("os agentes ocupados contam no teto", () => {
    expect(proximas(agenda(ERP, { P01: "integrada", P02: "rodando" }, 2))).toEqual(["P03"]);
    expect(proximas(agenda(ERP, { P01: "integrada", P02: "rodando", P03: "rodando" }, 2))).toEqual([]);
  });

  it("a fase exclusiva espera os ocupados e então roda sozinha", () => {
    const estados = { P01: "integrada", P02: "rodando" } as const;
    expect(proximas(agenda(ERP, estados, 3, ["P03"]))).toEqual([]);
    expect(proximas(agenda(ERP, { P01: "integrada" }, 3, ["P03"]))).toEqual(["P02"]);
    expect(proximas(agenda(ERP, { P01: "integrada", P02: "integrada" }, 3, ["P03"]))).toEqual(["P03"]);
    expect(proximas(agenda(ERP, { P01: "integrada", P02: "integrada", P03: "rodando" }, 3, ["P03"]))).toEqual([]);
  });

  it("é determinística: o mesmo estado dá a mesma resposta", () => {
    const uma = agenda(ERP, { P01: "integrada" }, 3);
    expect(proximas(uma)).toEqual(proximas(uma));
  });
});

describe("bloqueadas e esgotada", () => {
  it("quem depende de uma fase que falhou, direta ou indiretamente, nunca sai", () => {
    expect(bloqueadas(agenda(ERP, { P01: "integrada", P03: "falhou" }, 3))).toEqual(["P04", "P05"]);
  });

  it("acabou quando nada roda e nada pode sair", () => {
    expect(esgotada(agenda(ERP, { P01: "falhou" }, 2))).toBe(true);
    expect(esgotada(agenda(ERP, { P01: "integrada" }, 2))).toBe(false);
  });
});

describe("largura do plano", () => {
  it("em fila, um; no erp_teste, dois ao mesmo tempo no máximo", () => {
    expect(larguraDoPlano([fase(1, []), fase(2, [1]), fase(3, [2])])).toBe(1);
    expect(larguraDoPlano(ERP)).toBe(2);
  });
});
