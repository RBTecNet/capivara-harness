/**
 * O levantamento de auditoria.
 *
 * No `assitencia` a exclusividade do e-mail voltou em quatro rodadas seguidas e
 * sobreviveu a três reinícios. O escritor seguia a regra transversal do
 * esqueleto ("usuários operacionais"); o auditor seguia a decisão aceita ("em
 * todo o sistema"). Os dois estavam certos sobre fontes diferentes, e nenhum
 * podia decidir qual valia.
 */

import { describe, expect, it } from "vitest";

import { comAutoridade, lerEscolha, perguntaDeLevantamento } from "../../src/interview/levantamento.js";
import { ehRepetido, fingerprint } from "../../src/audit/index.js";
import { parseQuestionBatch } from "../../src/interview/protocol.js";
import { QUESTIONS_CONTRACT } from "../../src/interview/types.js";

const finding = {
  where: "Phase 2 · usuários",
  problem: "a exclusividade do e-mail foi limitada aos usuários operacionais",
  fix: "exigir exclusividade em todo o sistema, incluindo o painel global",
};

describe("quando um achado vira desacordo", () => {
  it("o segundo aparecimento é desacordo, não descuido", () => {
    const historia = [{ attempt: 1, verdict: { status: "REJECTED" as const, findings: [finding], remarks: [], reason: "x" }, contentSha: "a" }];
    expect(ehRepetido(finding, historia)).toBe(true);
    expect(ehRepetido({ ...finding, problem: "outra coisa" }, historia)).toBe(false);
  });

  it("a marca ignora maiúsculas, para não deixar o mesmo ponto passar duas vezes", () => {
    expect(fingerprint(finding)).toBe(fingerprint({ ...finding, where: finding.where.toUpperCase() }));
  });
});

describe("a pergunta do levantamento", () => {
  const pergunta = perguntaDeLevantamento(finding, 1);

  it("põe as duas leituras na frente de quem decide", () => {
    expect(pergunta.evidence).toContain("O auditor entendeu");
    expect(pergunta.evidence).toContain(finding.problem);
    expect(pergunta.evidence).toContain(finding.fix);
    expect(pergunta.options.map((opcao) => opcao.label)).toEqual([
      "Vale a leitura do auditor",
      "Vale o que o escritor escreveu",
    ]);
  });

  it("mostra o que o ESCRITOR entregou, senão a opção 2 é uma escolha no escuro", () => {
    const comEntrega = perguntaDeLevantamento(finding, 1, "- Cadastrar dica\n- Alterar e consultar dicas");

    expect(comEntrega.evidence).toContain("O escritor entregou:");
    expect(comEntrega.evidence).toContain("Cadastrar dica");
    // E a opção 2 diz o que fica valendo, em vez de "o ponto é encerrado".
    const doEscritor = comEntrega.options.find((opcao) => opcao.label === "Vale o que o escritor escreveu");
    expect(doEscritor?.consequence).toContain("Cadastrar dica");
    expect(doEscritor?.consequence).toContain("Alterar e consultar dicas");
  });

  it("sem a entrega em mãos, não finge que mostrou", () => {
    expect(pergunta.evidence).not.toContain("O escritor entregou:");
    expect(pergunta.options[1]?.consequence).toBe("O ponto é encerrado como está, e o auditor não volta a levantá-lo.");
  });

  it("diz por que a pergunta existe: o laço que ela evita", () => {
    expect(pergunta.why).toContain("o escritor reescreve e o auditor devolve");
    expect(pergunta.why).toContain("auditorias seguintes");
  });

  it("passa no mesmo protocolo das outras perguntas", () => {
    const lote = JSON.stringify({ contract: QUESTIONS_CONTRACT, questions: [{ ...pergunta, id: "Q-91" }] });
    const lido = parseQuestionBatch(lote);
    expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
  });

  it("usa id fora da faixa da entrevista, para não colidir no handoff", () => {
    expect(perguntaDeLevantamento(finding, 3).id).toBe("Q-93");
  });
});

describe("o que a resposta faz com o achado", () => {
  it("dar razão ao escritor encerra o ponto", () => {
    expect(lerEscolha("Vale o que o escritor escreveu", "2")).toEqual({ tipo: "escritor" });
  });

  it("dar razão ao auditor mantém o achado, agora com respaldo", () => {
    const escolha = lerEscolha("Vale a leitura do auditor", "1");
    expect(escolha).toEqual({ tipo: "auditor" });
    expect(comAutoridade(finding, escolha).fix).toContain("o desenvolvedor confirmou esta leitura");
  });

  it("uma terceira via substitui a correção pelo texto do desenvolvedor", () => {
    const escolha = lerEscolha("único por tenant, e o painel global tem regra própria", "único por tenant…");
    expect(escolha).toEqual({ tipo: "outra", texto: "único por tenant, e o painel global tem regra própria" });

    const arbitrado = comAutoridade(finding, escolha);
    expect(arbitrado.fix).toContain("autoridade acima do auditor");
    expect(arbitrado.fix).toContain("único por tenant");
    expect(arbitrado.problem).toContain("decidiu de outra forma");
  });

  it("resposta vazia não inventa terceira via: fica com o auditor", () => {
    expect(lerEscolha("", "")).toEqual({ tipo: "auditor" });
  });
});
