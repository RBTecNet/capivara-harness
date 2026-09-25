/**
 * As áreas que o pedido não menciona.
 *
 * O MCP_teste fechou cinco fases verdes e não tinha como corrigir o telefone de
 * um cliente: o pedido falava em cadastrar e nunca em alterar, e ninguém
 * perguntou. O desenvolvedor não decidiu que não queria — não pensou nisso.
 */

import { describe, expect, it } from "vitest";
import { QUESTIONS_CONTRACT, naoObjetivos, parseQuestionBatch } from "../../src/interview/index.js";
import type { Answer, Omission } from "../../src/interview/index.js";

const omissao = (overrides: Record<string, unknown> = {}) => ({
  id: "O-01",
  topic: "edição de clientes",
  evidence: "O pedido descreve cadastrar clientes e nunca menciona alterar nem remover.",
  decision: "A aplicação deve permitir alterar e remover clientes?",
  why: "Sem isso, corrigir um telefone digitado errado exige mexer no banco à mão.",
  options: [
    { label: "Sim, incluir alteração e remoção", consequence: "Mais uma tela e duas rotas no cadastro de clientes." },
    { label: "Não, fica fora do escopo", consequence: "O cadastro só cria e consulta; correções saem pelo banco." },
  ],
  include: "Sim, incluir alteração e remoção",
  recommended: "Sim, incluir alteração e remoção",
  recommendationBasis: "Um cadastro operado no balcão acumula erro de digitação já na primeira semana.",
  ...overrides,
});

const lote = (omissions: unknown[]) => JSON.stringify({ contract: QUESTIONS_CONTRACT, questions: [], omissions });

describe("o canal das omissões", () => {
  it("lê a omissão e guarda qual opção inclui a área", () => {
    const resultado = parseQuestionBatch(lote([omissao()]));
    if (!resultado.ok) throw new Error(resultado.defects.map((defeito) => defeito.problem).join("; "));

    expect(resultado.omissions).toHaveLength(1);
    expect(resultado.omissions[0]?.id).toBe("O-01");
    expect(resultado.omissions[0]?.include).toBe("Sim, incluir alteração e remoção");
  });

  it("lote sem omissões continua válido — pedido bem escrito não tem lacuna", () => {
    const resultado = parseQuestionBatch(JSON.stringify({ contract: QUESTIONS_CONTRACT, questions: [] }));
    if (!resultado.ok) throw new Error("deveria aceitar");
    expect(resultado.omissions).toEqual([]);
  });

  /*
   * `include` é o que permite ao harness saber se a recusa foi recusa. Sem ele
   * apontando para uma opção de verdade, a resposta vira texto sem significado.
   */
  it("recusa `include` que não é o rótulo de nenhuma opção", () => {
    const resultado = parseQuestionBatch(lote([omissao({ include: "Talvez" })]));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.defects[0]?.problem).toContain("include");
  });

  it("recusa omissão que não é sim ou não", () => {
    const tresOpcoes = omissao({
      options: [
        { label: "Sim", consequence: "a" },
        { label: "Só alterar", consequence: "b" },
        { label: "Não", consequence: "c" },
      ],
      include: "Sim",
      recommended: "Sim",
    });
    const resultado = parseQuestionBatch(lote([tresOpcoes]));
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.defects.some((defeito) => defeito.problem.includes("duas opções"))).toBe(true);
  });

  it("id de omissão é O-, não Q-: elas dividem a fila e não podem colidir", () => {
    const resultado = parseQuestionBatch(lote([omissao({ id: "Q-01" })]));
    expect(resultado.ok).toBe(false);
  });

  /*
   * O teto era quatro, e o excedente era cortado em silêncio.
   *
   * Cortar a quinta omissão é decidir por quota que aquela área fica fora do
   * produto — sem perguntar a ninguém, que é exatamente o que este canal existe
   * para não fazer. O filtro passou a ser a régua do prompt (quatro testes que
   * uma omissão precisa passar), e não um número: num produto de vinte e cinco
   * stories há legitimamente mais do que num de três.
   */
  it("não corta por quota: toda omissão chega a quem decide", () => {
    const cinco = [1, 2, 3, 4, 5].map((numero) => omissao({ id: `O-0${numero}` }));
    const resultado = parseQuestionBatch(lote(cinco));
    if (!resultado.ok) throw new Error("deveria aceitar");
    expect(resultado.omissions).toHaveLength(5);
  });

  it("a mesma régua das perguntas vale: sem evidência não chega à tela", () => {
    expect(parseQuestionBatch(lote([omissao({ evidence: "" })])).ok).toBe(false);
  });
});

const resposta = (decision: string, disposition: Answer["disposition"] = "ACCEPTED"): Answer => ({
  questionId: "O-01",
  raw: "2",
  disposition,
  decision,
  open: "",
  round: 1,
  answeredAt: "2026-09-22T00:00:00.000Z",
});

describe("o que ficou de fora por decisão", () => {
  const perguntas = [parseQuestionBatch(lote([omissao()])) as { ok: true; omissions: Omission[] }].flatMap((lido) => lido.omissions);

  it("a recusa vira não-objetivo escrito, com a consequência que estava na tela", () => {
    const fora = naoObjetivos(perguntas, [resposta("Não, fica fora do escopo")]);
    expect(fora).toHaveLength(1);
    expect(fora[0]).toContain("edição de clientes");
    expect(fora[0]).toContain("fora do escopo por decisão do desenvolvedor");
    expect(fora[0]).toContain("correções saem pelo banco");
  });

  it("aceitar a área não gera não-objetivo nenhum", () => {
    expect(naoObjetivos(perguntas, [resposta("Sim, incluir alteração e remoção")])).toEqual([]);
  });

  /*
   * Adiar não é recusar. Declarar fora do escopo o que ninguém decidiu é o
   * mesmo erro que a disposição DEFERRED existe para impedir.
   */
  it("omissão adiada não vira decisão", () => {
    expect(naoObjetivos(perguntas, [resposta("", "DEFERRED")])).toEqual([]);
    expect(naoObjetivos(perguntas, [])).toEqual([]);
  });

  /*
   * Resposta em texto livre é normalizada por um modelo e não casa com rótulo
   * nenhum. Aqui o harness não sabe, e por isso não afirma.
   */
  it("resposta em prosa não é lida como recusa", () => {
    expect(naoObjetivos(perguntas, [resposta("o desenvolvedor prefere decidir isso depois de ver a tela")])).toEqual([]);
  });

  it("pergunta comum nunca vira não-objetivo", () => {
    const comum = [{ ...perguntas[0]!, id: "Q-01", include: "" }];
    expect(naoObjetivos(comum, [{ ...resposta("Não, fica fora do escopo"), questionId: "Q-01" }])).toEqual([]);
  });
});
