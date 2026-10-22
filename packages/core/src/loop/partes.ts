/**
 * A implementação de uma fase em partes (§130).
 *
 * O PLAN aprova a fase como UMA entrega, e os gates continuam julgando a fase
 * inteira. O que muda é só quanto trabalho vai a cada sessão do executor: a
 * sessão única recebia as quinze tasks e os sessenta critérios de uma vez, e
 * um modelo de contexto pequeno se perdia no meio da fase. Aqui a fase vira
 * partes — grupos contíguos das tasks aprovadas, na ordem do plano, que é a
 * única dependência entre elas que o documento expressa —, e cada parte é uma
 * sessão nova com o texto exato das suas tasks (`recorteDaFase`).
 *
 * A divisão é feita em código, a partir do plano estruturado: nenhuma chamada
 * de modelo decide o que vai junto. A task é indivisível — os critérios dela
 * nunca são cortados para caber —, e a fronteira de sub-fase é o corte
 * preferido, porque é o agrupamento que o próprio plano escolheu.
 *
 * O orçamento. Nenhum adapter informa ao runner a janela de contexto do
 * executor (o OpenCode consulta `limit.context` dos modelos OpenRouter, mas
 * dentro da própria chamada, para limitar a saída). Então a política é a
 * conservadora e fixa, a mesma para qualquer modelo, e os números são de
 * política, não a janela de algum modelo:
 * - no máximo um quarto dos critérios que o plano aceita numa fase;
 * - o prompt real da parte (preâmbulo, contrato, fatia e as tasks) até
 *   48 mil caracteres;
 * - quando o contexto fixo sozinho já passa disso, as tasks ainda podem
 *   ocupar 16 mil caracteres: mais partes não encolheriam o que se repete em
 *   todas, só multiplicariam as sessões (com 8 mil, medidos nos planos reais
 *   de contexto pesado, fases de 15 tasks viravam sete sessões).
 * A fase que cabe inteira nesses limites vai numa sessão só, como sempre foi.
 */

import { MAX_CRITERIA_PER_PHASE } from "../authoring/index.js";
import { parsePhaseFragment } from "../contract/index.js";

export const ORCAMENTO_DA_PARTE = {
  criterios: MAX_CRITERIA_PER_PHASE / 4,
  caracteres: 48_000,
  pisoDasTasks: 16_000,
} as const;

export interface ParteDaFase {
  /** As posições das tasks na fase — as do plano, a partir de 1 —, em ordem. */
  indices: number[];
  criterios: number;
  /** O tamanho do prompt desta parte, em caracteres. */
  caracteres: number;
  /** Uma task só que já passa do orçamento: vai inteira, sem corte de critério. */
  excede: boolean;
}

export interface DivisaoDaFase {
  partes: ParteDaFase[];
  /** O teto de caracteres que valeu para esta fase (o geral, ou o contexto fixo mais o piso das tasks). */
  limite: number;
  /** O prompt sem nenhuma task: o que se repete em toda parte. */
  fixo: number;
}

/**
 * Divide a fase em partes, ou devolve uma parte só quando ela cabe inteira.
 *
 * `medir` devolve o tamanho do prompt real para um grupo de tasks — vazio é o
 * contexto fixo. Sem tasks legíveis, nenhuma parte: quem chama segue com a
 * sessão única de sempre.
 */
export function dividirEmPartes(
  phaseMarkdown: string,
  medir: (indices: readonly number[]) => number,
  orcamento: typeof ORCAMENTO_DA_PARTE = ORCAMENTO_DA_PARTE,
): DivisaoDaFase {
  const fase = parsePhaseFragment(phaseMarkdown);
  const fixo = medir([]);
  const limite = Math.max(orcamento.caracteres, fixo + orcamento.pisoDasTasks);
  if (fase === null || fase.tasks.length === 0) return { partes: [], limite, fixo };
  const tasks = fase.tasks;
  // A sub-fase de cada task: a última cujo heading vem antes dela; 0 antes da primeira.
  const subDe = (indice: number): number => {
    const linha = tasks.find((task) => task.index === indice)!.line;
    return fase.subPhases.filter((sub) => sub.line < linha).at(-1)?.number ?? 0;
  };
  const criteriosDe = (indices: readonly number[]): number =>
    indices.reduce((soma, indice) => soma + (tasks.find((task) => task.index === indice)?.acceptanceCriteria.length ?? 0), 0);
  const cabe = (indices: readonly number[]): boolean => criteriosDe(indices) <= orcamento.criterios && medir(indices) <= limite;
  const parte = (indices: number[]): ParteDaFase => ({
    indices,
    criterios: criteriosDe(indices),
    caracteres: medir(indices),
    excede: indices.length === 1 && !cabe(indices),
  });

  const todas = tasks.map((task) => task.index);
  if (cabe(todas)) return { partes: [parte(todas)], limite, fixo };

  const partes: ParteDaFase[] = [];
  let atual: number[] = [];
  const fechar = (): void => {
    if (atual.length > 0) partes.push(parte(atual));
    atual = [];
  };
  for (const [posicao, task] of tasks.entries()) {
    const anterior = tasks[posicao - 1];
    if (atual.length > 0 && anterior !== undefined && subDe(task.index) !== subDe(anterior.index)) {
      // A sub-fase que começa aqui vai inteira com a parte atual, ou começa a próxima.
      const daSub = tasks.slice(posicao).filter((outra) => subDe(outra.index) === subDe(task.index)).map((outra) => outra.index);
      if (!cabe([...atual, ...daSub])) fechar();
    }
    if (atual.length > 0 && !cabe([...atual, task.index])) fechar();
    atual.push(task.index);
  }
  fechar();
  return { partes, limite, fixo };
}
