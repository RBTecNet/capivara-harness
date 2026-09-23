import { describe, expect, it } from "vitest";

import { relatorioDoBuild } from "../../src/loop/parada.js";
import type { BuildOutcome, PhaseReport } from "../../src/loop/build.js";

function build(partial: Partial<BuildOutcome>): BuildOutcome {
  return { runId: "build-abc123", exitCode: 2, phases: [], warnings: [], errors: [], acceptance: null, ...partial };
}

const fechada = (id: string): PhaseReport => ({
  id,
  title: id,
  outcome: { status: "complete", committed: true, message: "", cycles: 1 },
});

const falhou = (id: string, gate: string, cause: string, cycles = 3): PhaseReport => ({
  id,
  title: id,
  outcome: { status: "failed", gate: gate as never, cause, cycles },
});

describe("relatório do build", () => {
  it("cobra do ambiente quando o gate disse que o runner não está instalado", () => {
    const causa = "O runner de testes do projeto NÃO ESTÁ INSTALADO neste ambiente: 'npm test' terminou com código 127.\nSaída: ...";
    const relatorio = relatorioDoBuild(
      build({ phases: [fechada("P01"), falhou("P02", "gate 2 — suíte do projeto", causa)], errors: [causa] }),
    );

    expect(relatorio.tipo).toBe("parada");
    if (relatorio.tipo !== "parada") return;
    expect(relatorio.parada.natureza).toBe("ambiente");
    expect(relatorio.parada.paraSeguir[0]).toContain("nada no seu código precisa mudar");
  });

  it("cobra do produto quando a suíte simplesmente reprovou", () => {
    const causa = "2 testes falharam em P03";
    const relatorio = relatorioDoBuild(build({ phases: [falhou("P03", "gate 2 — suíte do projeto", causa)], errors: [causa] }));

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.natureza).toBe("produto");
  });

  it("cobra da sessão do modelo quando o gate 0 reprovou", () => {
    const causa = "o engine terminou com código 1 sem devolver saída";
    const relatorio = relatorioDoBuild(build({ phases: [falhou("P01", "gate 0 — engine", causa)], errors: [causa] }));

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.natureza).toBe("modelo");
    expect(relatorio.parada.paraSeguir[0]).toContain("o texto da fase continua válido");
  });

  it("aponta o log do gate que reprovou, não um diretório genérico", () => {
    const g4 = relatorioDoBuild(build({ phases: [falhou("P04", "gate 4 — fluxos na aplicação", "x", 2)], errors: ["x"] }));
    const g3 = relatorioDoBuild(build({ phases: [falhou("P04", "gate 3 — verificação independente", "x", 1)], errors: ["x"] }));

    if (g4.tipo !== "parada" || g3.tipo !== "parada") throw new Error("esperava parada");
    expect(g4.parada.evidencia?.[0]).toContain("P04.flow-run-2.log");
    expect(g3.parada.evidencia?.[0]).toContain("P04.verify-1.log");
  });

  it("diz o que foi preservado, que é o que a pessoa quer saber", () => {
    const relatorio = relatorioDoBuild(
      build({ phases: [fechada("P01"), fechada("P02"), falhou("P03", "gate 2 — suíte do projeto", "x")], errors: ["x"] }),
      { totalDeFases: 8, fechadasAntes: 1 },
    );

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.custou).toContain("3 de 8");
    expect(relatorio.parada.custou).toContain("não serão refeitas");
    expect(relatorio.parada.custou).toContain("3 ciclo(s)");
    expect(relatorio.parada.paraSeguir.at(-1)).toContain("retoma de P03");
  });

  it("não chama de defeito o build que nem começou", () => {
    const relatorio = relatorioDoBuild(
      build({ exitCode: 1, errors: ["não há .capivara/init/project-phases.md; rode `capivara init` antes de `capivara build`"] }),
    );

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.natureza).toBe("decisão");
    expect(relatorio.parada.custou).toContain("nenhuma sessão gasta");
    expect(relatorio.parada.paraSeguir[0]).toContain("capivara init");
  });

  it("separa o limite de uso de um defeito de código", () => {
    const relatorio = relatorioDoBuild(
      build({
        phases: [{ id: "P05", title: "P05", outcome: { status: "rate-limit-exhausted", waits: 20 } }],
        errors: ["limite de uso esgotado"],
      }),
    );

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.natureza).toBe("ambiente");
    expect(relatorio.parada.deQuem).toContain("cota do provedor");
  });

  it("trata a aceitação reprovada como produto, sem fase falhada", () => {
    const relatorio = relatorioDoBuild(
      build({
        phases: [fechada("P01")],
        errors: ["`npm start` não subiu"],
        acceptance: { accepted: false, steps: [], failure: { id: "start", cause: "`npm start` não subiu" } },
      }),
    );

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.natureza).toBe("produto");
    expect(relatorio.parada.oQue).toContain("aceitação operacional");
  });

  it("leva o resto da causa para o detalhe, mantendo o cabeçalho de uma linha", () => {
    const relatorio = relatorioDoBuild(
      build({ phases: [falhou("P02", "gate 2 — suíte do projeto", "2 testes falharam\nFAIL src/a.spec.ts\nFAIL src/b.spec.ts")], errors: ["2 testes falharam\nFAIL src/a.spec.ts\nFAIL src/b.spec.ts"] }),
    );

    if (relatorio.tipo !== "parada") throw new Error("esperava parada");
    expect(relatorio.parada.oQue).toBe("P02 — 2 testes falharam");
    expect(relatorio.parada.detalhe).toContain("FAIL src/b.spec.ts");
  });

  it("relata a conclusão no mesmo formato", () => {
    const relatorio = relatorioDoBuild(
      build({
        exitCode: 0,
        phases: [fechada("P01"), fechada("P02")],
        acceptance: { accepted: true, steps: [], skipped: "" },
      }),
    );

    expect(relatorio.tipo).toBe("conclusao");
    if (relatorio.tipo !== "conclusao") return;
    expect(relatorio.conclusao.oQue).toContain("sobe a partir de uma cópia limpa");
    expect(relatorio.conclusao.custou).toContain("2 fase(s)");
  });
});
