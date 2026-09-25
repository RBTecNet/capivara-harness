import { describe, expect, it } from "vitest";
import { QUESTIONS_CONTRACT, decisoesJuntas, parseQuestionBatch } from "../../src/interview/index.js";

const question = (overrides: Record<string, unknown> = {}) => ({
  id: "Q-01",
  topic: "stack",
  evidence: "O diretório está vazio; nada indica linguagem nem framework.",
  decision: "Qual stack o projeto usa?",
  why: "Define os comandos de build e teste e a forma de todas as fases.",
  options: [
    { label: "Node + Vitest", consequence: "Suíte rápida; ecossistema que você já usa." },
    { label: "Python + pytest", consequence: "Melhor para processamento de dados; outro runner." },
  ],
  recommended: "Node + Vitest",
  recommendationBasis: "É a stack do restante dos seus projetos.",
  ...overrides,
});

const batch = (questions: unknown[]) => JSON.stringify({ contract: QUESTIONS_CONTRACT, questions });

describe("parseQuestionBatch", () => {
  it("aceita um lote bem formado", () => {
    const result = parseQuestionBatch(batch([question()]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.questions[0]?.id).toBe("Q-01");
  });

  it("aceita lote vazio — nem todo documento tem gap material", () => {
    const result = parseQuestionBatch(batch([]));
    expect(result.ok).toBe(true);
  });

  /*
   * Pergunta discursiva entra em laço: o desenvolvedor responde o que faz
   * sentido para ele, o classificador julga que não cobriu tudo, e a pergunta
   * volta — duas vezes por rodada, três rodadas. Seis vezes uma pergunta que
   * nunca teve resposta certa disponível.
   */
  it("recusa a pergunta sem opções, porque ela não tem como ser respondida", () => {
    const result = parseQuestionBatch(batch([question({ options: [], recommended: "", recommendationBasis: "" })]));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.defects.map((defeito) => defeito.problem)).toContain("pergunta sem opções");
  });

  it("tolera cerca de código em volta do JSON", () => {
    const result = parseQuestionBatch("```json\n" + batch([question()]) + "\n```");
    expect(result.ok).toBe(true);
  });

  it("rejeita resposta que não é JSON", () => {
    const result = parseQuestionBatch("claro, aqui vão as perguntas:");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defects[0]?.problem).toContain("JSON");
  });

  it("rejeita contrato ausente", () => {
    const result = parseQuestionBatch(JSON.stringify({ questions: [] }));
    expect(result.ok).toBe(false);
  });
});

describe("uma pergunta incompleta nunca chega à tela", () => {
  const defectsFor = (overrides: Record<string, unknown>, campo: "problem" | "hint" = "problem"): string[] => {
    const result = parseQuestionBatch(batch([question(overrides)]));
    return result.ok ? [] : result.defects.map((defect) => defect[campo]);
  };

  it("sem evidência", () => {
    expect(defectsFor({ evidence: "" })).toContain("sem evidência");
  });

  it("sem a decisão que falta", () => {
    expect(defectsFor({ decision: "" })).toContain("sem a decisão que falta");
  });

  it("sem o motivo", () => {
    expect(defectsFor({ why: "" })).toContain("sem o motivo");
  });

  it("com opções e sem recomendação", () => {
    expect(defectsFor({ recommended: "" })).toContain("opções sem recomendação");
  });

  it("com recomendação que não é uma das opções", () => {
    expect(defectsFor({ recommended: "Go + testing" })).toContain("a recomendação não é uma das opções");
  });

  it("com opção sem consequência", () => {
    expect(defectsFor({ options: [{ label: "A", consequence: "" }, { label: "B", consequence: "x" }] })).toContain("opção sem consequência");
  });

  it("com uma única opção, que não é escolha", () => {
    expect(defectsFor({ options: [{ label: "A", consequence: "x" }], recommended: "A" })).toContain("pergunta sem opções");
  });

  it("a orientação ensina o que fazer quando a resposta parece texto livre", () => {
    const orientacoes = defectsFor({ options: [], recommended: "" }, "hint");
    expect(orientacoes.join(" ")).toContain("enumere as alternativas reais");
  });

  it("com id fora do formato", () => {
    expect(defectsFor({ id: "pergunta1" })).toContain("id fora do formato");
  });

  it("todo defeito traz a orientação de correção", () => {
    const result = parseQuestionBatch(batch([question({ evidence: "", why: "" })]));
    if (result.ok) throw new Error("esperava defeitos");
    for (const defect of result.defects) expect(defect.hint.length).toBeGreaterThan(15);
  });

  it("rejeita ids repetidos no mesmo lote", () => {
    const result = parseQuestionBatch(batch([question(), question()]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.defects.map((d) => d.problem)).toContain("id repetido");
  });
});

/**
 * Pergunta composta, conferida por máquina.
 *
 * A regra existe no prompt, e o modelo às vezes a desobedece. Os casos abaixo
 * são literais de um run real: quatro perguntas juntavam decisões, uma delas
 * voltou três vezes, e quem respondia não tinha como acertar — as opções
 * cobriam uma das decisões e a resposta voltava incompleta.
 */
describe("uma decisão por pergunta", () => {
  it("reprova o que apareceu no run real", () => {
    const compostas = [
      "O que o valor por aluguel cobre, existe prazo de devolução e, se existir, o que deve acontecer quando ele for ultrapassado?",
      "Quais campos são obrigatórios e quais não podem se repetir?",
      "Como calcular o valor da locação a partir da diária e das datas, e o que acontece quando a retirada e a entrega são no mesmo dia?",
    ];
    for (const decision of compostas) {
      expect(decisoesJuntas(decision), decision).not.toBeNull();
    }
  });

  /*
   * Conservador de propósito: reprovar pergunta boa custa uma volta inteira de
   * levantamento. Um "e" simples liga duas coisas de UMA decisão.
   */
  it("deixa passar a pergunta única, mesmo com 'e' na frase", () => {
    const boas = [
      "Qual stack o projeto usa?",
      "A aplicação terá login e senha?",
      "Quem poderá operar a aplicação e será necessário entrar com uma conta?",
      "Como a aplicação deve controlar a disponibilidade dos filmes?",
      "O cadastro de clientes guarda CPF?",
    ];
    for (const decision of boas) {
      expect(decisoesJuntas(decision), decision).toBeNull();
    }
  });

  it("o lote com pergunta composta é recusado antes de chegar ao desenvolvedor", () => {
    const lote = JSON.stringify({
      contract: "capivara-questions/v1",
      questions: [
        {
          id: "Q-01",
          topic: "Valores e prazos",
          evidence: "Cada filme terá um valor por aluguel.",
          decision: "O que o valor cobre, existe prazo de devolução e o que acontece quando ele passa?",
          why: "define o cálculo do total",
          options: [],
          recommended: "",
          recommendationBasis: "",
        },
      ],
    });

    const lido = parseQuestionBatch(lote);
    expect(lido.ok).toBe(false);
    if (!lido.ok) {
      expect(lido.defects[0]?.problem).toContain("junta mais de uma decisão");
      expect(lido.defects[0]?.hint).toContain("uma decisão por pergunta");
    }
  });
});

/*
 * O `assitencia`, madrugada: "não consegui transformar 4 decisão(ões)
 * pendente(s) em pergunta". O lote trazia onze perguntas; três foram acusadas de
 * "3 decisões na mesma frase" e as onze foram jogadas fora.
 *
 * As três acusadas eram perfeitas:
 *   "Qual indicação inicial deve aparecer quando faltar uma das datas?"
 * Uma decisão só, com oração condicional — e a regra contava `qual`, `deve` e
 * `quando` como três decisões.
 */
describe("contar palavra não é contar decisão", () => {
  const umaDecisao = (decision: string) => parseQuestionBatch(batch([question({ decision })]));

  it("aceita a pergunta condicional, que é a forma natural de regra de negócio", () => {
    for (const decision of [
      "Qual indicação inicial deve aparecer quando faltar uma ou ambas as datas de garantia?",
      "Quando a entrega não informar garantia, o que deve acontecer com o período já registrado?",
      "O que deve acontecer quando a quantidade utilizada superar o saldo disponível?",
    ]) {
      const lido = umaDecisao(decision);
      expect(lido.ok, lido.ok ? "" : JSON.stringify(lido.defects)).toBe(true);
    }
  });

  it("continua recusando o que é prova de duas decisões", () => {
    expect(umaDecisao("O valor cobre a peça? Existe prazo?").ok).toBe(false);
    expect(umaDecisao("O que o valor cobre e o que acontece se o prazo passar?").ok).toBe(false);
  });

  it("um `e` que liga duas coisas da MESMA decisão continua passando", () => {
    expect(umaDecisao("O cadastro terá login e senha?").ok).toBe(true);
  });
});

describe("o lote recusado entrega o que se salvou", () => {
  it("as perguntas sem defeito vêm junto da recusa", () => {
    const lido = parseQuestionBatch(
      batch([
        question({ id: "Q-01" }),
        question({ id: "Q-02", decision: "O valor cobre a peça? Existe prazo?" }),
        question({ id: "Q-03" }),
      ]),
    );

    expect(lido.ok).toBe(false);
    if (lido.ok) return;
    expect(lido.questions.map((pergunta) => pergunta.id)).toEqual(["Q-01", "Q-03"]);
    expect(lido.defects).toHaveLength(1);
  });

  it("resposta que não é JSON não salva nada, e não finge que salvou", () => {
    const lido = parseQuestionBatch("isto não é json");
    expect(lido.ok).toBe(false);
    if (lido.ok) return;
    expect(lido.questions).toEqual([]);
  });
});
