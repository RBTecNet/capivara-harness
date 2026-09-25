/**
 * O lote de perguntas levantado pelo modelo.
 *
 * Uma pergunta sem evidência, sem a decisão que falta ou sem o motivo é
 * rejeitada antes de chegar à tela. Perguntar sem mostrar o que já se sabe faz
 * o desenvolvedor repetir o que já está no prompt, e é a diferença entre uma
 * entrevista e um interrogatório.
 */

import { QUESTIONS_CONTRACT, type Assumption, type Omission, type Question, type QuestionOption } from "./types.js";

export interface QuestionDefect {
  index: number;
  questionId: string;
  problem: string;
  hint: string;
}

export type QuestionBatch =
  | { ok: true; questions: Question[]; assumptions: Assumption[]; omissions: Omission[] }
  /**
   * Recusado — e as que se salvaram.
   *
   * O lote é recusado inteiro porque um lote torto costuma significar que o
   * modelo entendeu errado o pedido, e perguntar metade de um mal-entendido é
   * pior que repetir. Mas as perguntas SEM defeito seguem aqui: na rodada de
   * lacunas, cada pergunta corresponde a uma decisão específica, e jogar oito
   * boas fora porque três vieram tortas é perder oito decisões que o
   * desenvolvedor responderia em um minuto.
   */
  | { ok: false; defects: QuestionDefect[]; questions: Question[] };

const ID = /^Q-\d{2,}$/;
const OMISSION_ID = /^O-\d{2,}$/;

/**
 * O teto de omissões foi removido, e aqui está o porquê.
 *
 * Eram quatro, cortadas em silêncio, "pela mesma razão do teto de perguntas".
 * As duas razões caíram juntas: o que faz o desenvolvedor parar de responder com
 * cuidado não é o número de perguntas, é a pergunta que não tem como ser
 * respondida. E o preço do corte não era o silêncio — era um produto entregue
 * sem a área que a quinta omissão teria trazido, descoberto no uso.
 *
 * O que sobra no lugar do teto é a régua: o prompt lista quatro testes que uma
 * omissão precisa passar, e uma que não passa não é cortada por quota, é errada.
 * Num produto de vinte e cinco stories há legitimamente mais do que num de três.
 */

/**
 * A pergunta pede mais de uma decisão?
 *
 * Instrução no prompt não basta: o modelo às vezes junta três decisões numa
 * frase, as opções respondem só uma delas, e a resposta volta marcada incompleta
 * sem culpa de quem respondeu. Num run real isso aconteceu com quatro perguntas,
 * e uma delas voltou três vezes — "o que o valor cobre, existe prazo e o que
 * acontece se passar?".
 *
 * A conferência precisa de PROVA, não de indício. Reprovar pergunta boa custa
 * uma volta de levantamento inteira — e, como o lote é recusado junto, custa
 * também as perguntas boas que vieram com ela.
 *
 * Houve aqui uma terceira regra que contava palavras interrogativas e reprovava
 * a partir de três. Ela derrubou, no `assitencia`, as três melhores perguntas de
 * um lote de onze:
 *
 *   "Qual indicação inicial deve aparecer quando faltar uma das datas?"
 *    ↑qual                 ↑deve        ↑quando  → "3 decisões na mesma frase"
 *
 * É uma pergunta só, com uma oração condicional — a forma mais natural de
 * perguntar uma regra de negócio, e justamente a que a regra matava. `deve` é
 * modal, `quando` ali é subordinativo, e contar palavra não é contar decisão.
 */
export function decisoesJuntas(decision: string): string | null {
  const texto = decision.trim();

  const perguntas = (texto.match(/\?/g) ?? []).length;
  if (perguntas > 1) return `${perguntas} perguntas numa linha`;

  /*
   * Conjunção emendando outra cláusula interrogativa: "…, e o que acontece…",
   * "… e, se existir, …", "…obrigatórios e quais não podem repetir?". As três
   * formas saíram do mesmo run.
   *
   * O interrogativo depois do "e" é o que separa isto de "terá login e senha?",
   * onde o "e" liga duas coisas de UMA decisão.
   */
  const emenda = /\be,?\s*(o que|qual|quais|como|quando|quanto|onde|se)\b/i.exec(texto);
  if (emenda) return `duas decisões ligadas por "${emenda[0].trim()}"`;

  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function options(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      return { label: text(record.label), consequence: text(record.consequence) };
    })
    .filter((option) => option.label !== "");
}

/** Lê e valida o lote. Entrada não confiável: o modelo erra, e a tela não pode. */
export function parseQuestionBatch(source: string): QuestionBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(source));
  } catch {
    return {
      ok: false,
      questions: [],
      defects: [{ index: 0, questionId: "-", problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${QUESTIONS_CONTRACT}", "questions": [...] } sem cerca de código` }],
    };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  if (root.contract !== QUESTIONS_CONTRACT) {
    return {
      ok: false,
      questions: [],
      defects: [{ index: 0, questionId: "-", problem: `contrato ausente ou diferente de ${QUESTIONS_CONTRACT}`, hint: `declare "contract": "${QUESTIONS_CONTRACT}" na raiz` }],
    };
  }
  if (!Array.isArray(root.questions)) {
    return { ok: false, questions: [], defects: [{ index: 0, questionId: "-", problem: "questions não é uma lista", hint: "devolva uma lista, mesmo que vazia quando não há gap material" }] };
  }

  const defects: QuestionDefect[] = [];
  const questions: Question[] = [];
  const seen = new Set<string>();

  /** Tudo o que vale para pergunta vale igual para omissão: é a mesma tela. */
  const ler = (entry: unknown, index: number, formato: RegExp, comoUsar: string): Question => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const question: Question = {
      id: text(record.id),
      topic: text(record.topic),
      evidence: text(record.evidence),
      decision: text(record.decision),
      why: text(record.why),
      options: options(record.options),
      recommended: text(record.recommended),
      recommendationBasis: text(record.recommendationBasis),
    };

    const complain = (problem: string, hint: string): void => {
      defects.push({ index, questionId: question.id || `#${index + 1}`, problem, hint });
    };

    if (!formato.test(question.id)) complain("id fora do formato", comoUsar);
    else if (seen.has(question.id)) complain("id repetido", "cada pergunta tem um id único no lote");
    else seen.add(question.id);

    if (question.evidence === "") complain("sem evidência", "declare o que já foi descoberto sobre o tema; perguntar o descobrível é proibido");
    if (question.decision === "") complain("sem a decisão que falta", "escreva a decisão em forma de pergunta objetiva");
    else {
      const juntas = decisoesJuntas(question.decision);
      if (juntas !== null) {
        complain(
          `a pergunta junta mais de uma decisão (${juntas})`,
          "uma decisão por pergunta: quebre em perguntas separadas, cada uma respondível numa frase",
        );
      }
    }
    if (question.why === "") complain("sem o motivo", "diga o que muda no resultado conforme a resposta");

    /*
     * Pergunta sem opção é pergunta discursiva, e pergunta discursiva entra em
     * laço.
     *
     * O caminho é sempre o mesmo: o modelo pergunta algo aberto, o desenvolvedor
     * responde com o que faz sentido para ele, o classificador julga que a
     * resposta não cobre tudo o que a pergunta pedia, e a pergunta volta — duas
     * vezes por rodada, três rodadas. Seis vezes a mesma pergunta que nunca teve
     * uma resposta "certa" possível.
     *
     * Com opções isso não acontece: escolher pelo número é decisão fechada, e o
     * classificador nem chega a ser chamado. Texto livre continua valendo para
     * quem quiser dizer outra coisa — o que deixa de existir é a pergunta que
     * SÓ pode ser respondida em prosa.
     */
    if (question.options.length < 2) {
      complain(
        "pergunta sem opções",
        "toda pergunta oferece de 2 a 4 opções concretas e excludentes, com a recomendada marcada; " +
          "quando a resposta parecer texto livre, enumere as alternativas reais que você consegue imaginar",
      );
    }
    if (question.options.length > 1) {
      if (question.recommended === "") complain("opções sem recomendação", "aponte a opção recomendada e a evidência que a sustenta");
      else if (!question.options.some((option) => option.label === question.recommended)) {
        complain("a recomendação não é uma das opções", "a recomendação precisa ser exatamente o rótulo de uma das opções");
      }
      if (question.options.some((option) => option.consequence === "")) {
        complain("opção sem consequência", "toda opção declara o que acontece se for escolhida");
      }
    }

    return question;
  };

  root.questions.forEach((entry, index) => {
    questions.push(ler(entry, index, ID, "use Q-01, Q-02, … estáveis entre rodadas"));
  });

  /*
   * As omissões: o que o pedido NÃO diz.
   *
   * Elas vêm em lista própria porque a regra é outra: uma pergunta é sobre o que
   * o pedido DISSE de forma ambígua, e uma omissão é sobre o que ele não disse.
   * No MCP_teste as perguntas eram todas boas e todas necessárias, e a edição de
   * clientes não caberia em nenhuma delas — ela não era ambiguidade de nada.
   *
   * E elas vêm TODAS. O corte silencioso do excedente foi embora com o teto:
   * cortar a quinta omissão é decidir, por quota, que aquela área fica fora do
   * produto — sem perguntar a ninguém, que é exatamente o que este canal existe
   * para não fazer.
   */
  const omissions: Omission[] = [];
  if (Array.isArray(root.omissions)) {
    root.omissions.forEach((entry, index) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const question = ler(entry, index, OMISSION_ID, "use O-01, O-02, … para omissões");
      const include = text(record.include);

      if (question.options.length !== 2) {
        defects.push({
          index,
          questionId: question.id || `#${index + 1}`,
          problem: "omissão sem exatamente duas opções",
          hint: "a omissão é sim ou não: uma opção que inclui a área no escopo e outra que a deixa de fora",
        });
      } else if (!question.options.some((option) => option.label === include)) {
        defects.push({
          index,
          questionId: question.id || `#${index + 1}`,
          problem: "`include` não é o rótulo de nenhuma das opções",
          hint: "declare em `include` o rótulo EXATO da opção que traz a área para o escopo",
        });
      }

      omissions.push({ ...question, include });
    });
  }

  /*
   * A suposição precisa de um canal.
   *
   * O prompt sempre mandou "registre uma suposição de baixo risco em vez de
   * perguntar", e o contrato só aceitava perguntas — então tudo virava pergunta.
   * O piloto 3 chegou a 47 perguntas em três documentos, incluindo quais valores
   * hexadecimais usar numa paleta de etiquetas. Sem saída, a regra de não
   * perguntar o dispensável não tinha como ser obedecida.
   */
  const assumptions: Assumption[] = Array.isArray(root.assumptions)
    ? root.assumptions
        .map((item) => (item ?? {}) as Record<string, unknown>)
        .map((item) => ({
          topic: text(item.topic),
          statement: text(item.statement),
          basis: text(item.basis),
        }))
        .filter((assumption) => assumption.statement !== "")
    : [];

  return defects.length > 0
    ? { ok: false, defects, questions: questions.filter((_, indice) => !defects.some((defeito) => defeito.index === indice)) }
    : { ok: true, questions, assumptions, omissions };
}

function stripFence(source: string): string {
  const trimmed = source.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
