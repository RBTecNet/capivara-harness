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

import { comAutoridade, decisaoGravada, lerEscolha, perguntaDeLevantamento } from "../../src/interview/levantamento.js";
import { ehRepetido, fingerprint } from "../../src/audit/index.js";

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

/*
 * A forma da pergunta, pedida pelo desenvolvedor depois de ver a tela cheia:
 * "a primeira linha explicando a que área aquela pergunta se trata e o que ela
 * visa resolver, a questão do auditor e a questão do escritor, somente isso sem
 * demais explicações".
 *
 * O que saiu: a frase que explicava o mecanismo do harness ("o auditor devolveu
 * este ponto pela segunda vez…"), o bloco "por que importa", e a desculpa dentro
 * da opção 2 quando a entrega do escritor não estava em mãos. O que o auditor
 * entendeu e o que ele pede desceram para DENTRO da opção que os escolhe.
 */
describe("a pergunta do levantamento", () => {
  const pergunta = perguntaDeLevantamento(finding, 1);

  it("a primeira linha diz do que se trata e o que a escolha resolve", () => {
    expect(pergunta.evidence).toContain(finding.where);
    expect(pergunta.evidence).toContain("entenderam de formas diferentes");
    // E nada do mecanismo do harness: quem decide não precisa saber como ele funciona.
    expect(pergunta.evidence).not.toContain("segunda vez");
    expect(pergunta.evidence).not.toContain("capricho");
  });

  it("a leitura do auditor vive DENTRO da opção que a escolhe", () => {
    const doAuditor = pergunta.options.find((opcao) => opcao.label === "Vale a leitura do auditor");
    expect(doAuditor?.consequence).toContain(finding.problem);
    expect(doAuditor?.consequence).toContain(finding.fix);
    // E não acima da pergunta, onde ela era lida antes de se saber para quê.
    expect(pergunta.evidence).not.toContain(finding.problem);
  });

  it("a entrega do escritor vive dentro da opção dele", () => {
    const comEntrega = perguntaDeLevantamento(finding, 1, "- Cadastrar dica\n- Alterar e consultar dicas");
    const doEscritor = comEntrega.options.find((opcao) => opcao.label === "Vale o que o escritor escreveu");
    expect(doEscritor?.consequence).toContain("Cadastrar dica");
    expect(doEscritor?.consequence).toContain("Alterar e consultar dicas");
  });

  /*
   * Sem a entrega em mãos — um achado da auditoria de coerência, que não aponta
   * fase única —, a opção dizia um parágrafo pedindo desculpas por não poder
   * mostrar. Quem lê quer saber o que acontece se escolher, não por que o harness
   * não conseguiu.
   */
  it("sem a entrega em mãos, diz o que acontece e não pede desculpas", () => {
    expect(pergunta.options[1]?.consequence).toBe("A fase segue exatamente como está escrita hoje.");
  });

  it("não tem bloco de explicação: as duas leituras são a pergunta inteira", () => {
    expect(pergunta.why).toBe("");
    expect(pergunta.recommendationBasis).toBe("");
    expect(pergunta.decision).toBe("Qual dos dois entendimentos vale?");
  });

  /*
   * Ela não passa no `parseQuestionBatch`, e é de propósito: aquele parser guarda
   * a régua das perguntas do MODELO, onde `why` existe para impedir pergunta
   * cega. Aqui a substância está nas opções, que é onde a escolha é feita. O que
   * precisa continuar valendo é o resto da régua.
   */
  it("mantém a régua que importa: duas opções concretas, com consequência, e uma recomendada", () => {
    expect(pergunta.options).toHaveLength(2);
    expect(pergunta.options.every((opcao) => opcao.label !== "" && opcao.consequence !== "")).toBe(true);
    expect(pergunta.options.map((opcao) => opcao.label)).toContain(pergunta.recommended);
    expect(pergunta.evidence).not.toBe("");
    expect(pergunta.decision).not.toBe("");
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

/*
 * O `assitencia` arbitrou ONZE pontos e o auditor devolveu os mesmos dois na
 * rodada seguinte. O handoff explicava:
 *
 *   Q-91 | ACCEPTED | decision = "Vale a leitura do auditor"
 *   Q-92 | ACCEPTED | decision = "Vale a leitura do auditor"
 *   …
 *
 * O harness guardou o rótulo do botão. Essa frase vai para o contexto do
 * escritor, para a lista de decisões que o auditor recebe e para o relatório — e
 * não diz nada em nenhum dos três.
 */
describe("o que fica gravado é a decisão, não o botão", () => {
  it("dar razão ao auditor grava O QUE passa a valer", () => {
    const gravada = decisaoGravada(finding, { tipo: "auditor" });
    expect(gravada).toContain(finding.where);
    expect(gravada).toContain("exclusividade em todo o sistema");
    expect(gravada).not.toContain("Vale a leitura");
  });

  it("dar razão ao escritor grava que o ponto foi decidido a favor do texto", () => {
    const gravada = decisaoGravada(finding, { tipo: "escritor" });
    expect(gravada).toContain("fica como está");
    expect(gravada).toContain(finding.problem);
  });

  it("a terceira via grava o texto do desenvolvedor, com o endereço junto", () => {
    const gravada = decisaoGravada(finding, { tipo: "outra", texto: "único por tenant" });
    expect(gravada).toBe(`${finding.where}: único por tenant`);
  });

  it("a decisão gravada é legível sem a pergunta ao lado", () => {
    // O auditor da rodada seguinte recebe só esta linha; ela tem de bastar.
    for (const escolha of [{ tipo: "auditor" as const }, { tipo: "escritor" as const }]) {
      const gravada = decisaoGravada(finding, escolha);
      expect(gravada.length).toBeGreaterThan(40);
      expect(gravada.split(":")[0]).toBe(finding.where);
    }
  });
});
