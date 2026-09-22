/**
 * O contrato do levantamento.
 *
 * O que ele recusa é o que tornaria o documento inútil para reescrever: regra
 * sem evidência — que é palpite de modelo sobre código lido por cima — e achado
 * apontando para domínio que não existe.
 */

import { describe, expect, it } from "vitest";
import { SURVEY_CONTRACT, parseSurvey, renderSurvey, surveyCoverage } from "../../src/contract/index.js";
import type { Survey } from "../../src/contract/index.js";

const COMPLETO = {
  contract: SURVEY_CONTRACT,
  application: "Locadora",
  stack: [{ component: "linguagem", decision: "PHP 7.4" }],
  domains: [
    { id: "D-01", name: "Locação", purpose: "Aluga e devolve filmes.", files: ["app/Locacao.php", "app/LocacaoController.php"] },
  ],
  entities: [
    {
      name: "aluguel",
      storage: "tabela `alugueis`",
      fields: [{ name: "valor_total", type: "decimal(10,2)", notes: "nulo até a devolução" }],
      relations: ["cliente_id → clientes.id"],
      evidence: [{ file: "database/migrations/2019_create_alugueis.php", locator: "up()" }],
    },
  ],
  rules: [
    {
      id: "D-01-R01",
      domain: "D-01",
      layer: "dominio",
      behaviour: "O total não conta sábado e domingo entre a locação e a entrega.",
      intent: "A loja não abre no fim de semana, então o cliente não teria como devolver.",
      divergence: "",
      evidence: [{ file: "app/Locacao.php", locator: "diasCobraveis()" }],
    },
    {
      id: "D-01-R02",
      domain: "D-01",
      layer: "contrato",
      behaviour: "O relatório diário é gravado em /var/exports/locacoes-AAAAMMDD.csv, com ponto e vírgula.",
      intent: "",
      divergence: "",
      evidence: [{ file: "app/Console/ExportaLocacoes.php", locator: "handle()" }],
    },
  ],
  flows: [
    {
      id: "D-01-F01",
      domain: "D-01",
      name: "Alugar um filme",
      actor: "atendente",
      steps: ["busca o cliente pelo CPF", "escolhe o filme", "confirma e imprime o recibo"],
      evidence: [{ file: "app/LocacaoController.php", locator: "store()" }],
    },
  ],
  integrations: [
    {
      name: "SMS de cobrança",
      direction: "saida",
      contract: "POST /v1/messages com {telefone, texto}",
      evidence: [{ file: "app/Services/Sms.php", locator: "enviar()" }],
    },
  ],
  questions: [
    { topic: "feriado", question: "Feriado conta como dia cobrável?", whyCodeCannotAnswer: "O código só trata sábado e domingo; não há lista de feriados em lugar nenhum." },
  ],
  deadCode: [{ path: "app/Relatorio2015.php", reason: "nenhuma rota e nenhum comando o alcança" }],
};

const lido = (valor: unknown) => parseSurvey(JSON.stringify(valor));

describe("o contrato do levantamento", () => {
  it("aceita um levantamento completo", () => {
    const resultado = lido(COMPLETO);
    if (!resultado.ok) throw new Error(resultado.defects.map((defeito) => defeito.problem).join("; "));
    expect(resultado.survey.domains).toHaveLength(1);
    expect(resultado.survey.rules[1]?.layer).toBe("contrato");
  });

  /*
   * A recusa que sustenta o resto: sem evidência, o levantamento vira o que um
   * modelo supôs, e a reescrita parte de uma regra que nunca existiu.
   */
  it("recusa regra sem evidência", () => {
    const semEvidencia = { ...COMPLETO, rules: [{ ...COMPLETO.rules[0], evidence: [] }] };
    const resultado = lido(semEvidencia);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.defects[0]?.problem).toContain("não cita evidência");
  });

  it("recusa achado apontando para domínio que não existe", () => {
    const orfa = { ...COMPLETO, rules: [{ ...COMPLETO.rules[0], domain: "D-99" }] };
    const resultado = lido(orfa);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.defects.some((defeito) => defeito.problem.includes("D-99"))).toBe(true);
  });

  it("recusa entidade sem campo: não dá para recriar o que não tem forma", () => {
    expect(lido({ ...COMPLETO, entities: [{ ...COMPLETO.entities[0], fields: [] }] }).ok).toBe(false);
  });

  it("recusa fluxo sem passos", () => {
    expect(lido({ ...COMPLETO, flows: [{ ...COMPLETO.flows[0], steps: [] }] }).ok).toBe(false);
  });

  it("recusa levantamento sem domínio nenhum", () => {
    expect(lido({ ...COMPLETO, domains: [] }).ok).toBe(false);
  });

  it("camada desconhecida vira domínio, que é a leitura conservadora", () => {
    const resultado = lido({ ...COMPLETO, rules: [{ ...COMPLETO.rules[0], layer: "qualquer" }] });
    if (!resultado.ok) throw new Error("deveria aceitar");
    expect(resultado.survey.rules[0]?.layer).toBe("dominio");
  });
});

describe("o documento do levantamento", () => {
  const survey = (lido(COMPLETO) as { ok: true; survey: Survey }).survey;
  const markdown = renderSurvey(survey);

  it("separa o que sobrevive à reescrita do que morre com a stack", () => {
    expect(markdown).toContain("Contratos externos — precisam sobreviver à troca de stack");
    expect(markdown).toContain("locacoes-AAAAMMDD.csv");
  });

  it("diz que a stack de hoje é informação, não autoridade", () => {
    expect(markdown).toContain("informação sobre a origem — nunca autoridade sobre o destino");
  });

  it("cada regra mostra onde foi lida", () => {
    expect(markdown).toContain("app/Locacao.php:diasCobraveis()");
  });

  it("o que o código não responde aparece como pergunta, não como regra", () => {
    expect(markdown).toContain("Perguntas em aberto");
    expect(markdown).toContain("Feriado conta como dia cobrável?");
  });

  it("código morto é candidato, não veredito", () => {
    expect(markdown).toContain("Candidato não é veredito");
  });
});

describe("a cobertura do levantamento", () => {
  const survey = (lido(COMPLETO) as { ok: true; survey: Survey }).survey;

  it("aponta o arquivo de código que nenhum domínio reivindicou", () => {
    const cobertura = surveyCoverage(survey, ["app/Locacao.php", "app/LocacaoController.php", "app/Fiscal.php"]);
    expect(cobertura.unclaimed).toEqual(["app/Fiscal.php"]);
    expect(cobertura.claimed).toBe(2);
  });

  it("o que foi declarado morto não conta como esquecido", () => {
    const cobertura = surveyCoverage(survey, ["app/Locacao.php", "app/LocacaoController.php", "app/Relatorio2015.php"]);
    expect(cobertura.unclaimed).toEqual([]);
  });

  it("domínio que não trouxe regra nenhuma é anunciado", () => {
    const comVazio: Survey = { ...survey, domains: [...survey.domains, { id: "D-02", name: "Fiscal", purpose: "x", files: [] }] };
    expect(surveyCoverage(comVazio, []).domainsWithoutRules).toEqual(["D-02"]);
    expect(surveyCoverage(comVazio, []).domainsWithoutFlows).toEqual(["D-02"]);
  });
});
