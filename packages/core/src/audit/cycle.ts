/**
 * O ciclo de devolução.
 *
 * O auditor descreve o defeito e a correção; quem aplica é o escritor, em sessão
 * nova. Se o auditor corrigisse, seria escritor e auditor ao mesmo tempo e a
 * independência do veredito acabaria.
 *
 * Esgotado o teto, o run NÃO desiste em silêncio nem aceita o documento: ele
 * para e mostra ao desenvolvedor, lado a lado, o que o auditor rejeita e o que o
 * escritor insiste em fazer. O teto esgotado sinaliza falta de convergência;
 * sozinho ele não prova que uma decisão de produto esteja faltando.
 */

import type { AuditVerdict, Finding } from "./protocol.js";

export const DEFAULT_MAX_RETURNS = 3;

export interface AuditAttempt {
  /** 1 para a primeira auditoria do documento. */
  attempt: number;
  verdict: AuditVerdict;
  /** Marca do texto auditado nesta tentativa, para saber se ele mudou. */
  contentSha: string;
}

export interface AuditCycleState {
  document: string;
  history: AuditAttempt[];
  maxReturns: number;
  /** Rodadas para fechar defeito mecânico, separadas do teto do auditor. */
  maxMechanical: number;
}

export type AuditAction =
  | { action: "publish"; remarks: AuditVerdict["remarks"] }
  | { action: "return-to-writer"; findings: Finding[]; attempt: number }
  | { action: "ask-developer"; standoff: Standoff };

export interface Standoff {
  document: string;
  /** Rejeições semânticas do auditor; não inclui o self-check. */
  returns: number;
  mechanical: boolean;
  mechanicalChecks: number;
  /** O que o auditor rejeita na versão atual do documento. */
  auditorInsists: Finding[];
  /** Marcas dos findings que já tinham aparecido em tentativa anterior. */
  repeated: Set<string>;
  /** O que o escritor fez a cada tentativa, visto pelo próprio auditor. */
  writerDid: string[];
  question: string;
}

/**
 * A identidade de um achado, para CONTAR: endereço mais problema.
 *
 * "Critério vago" em duas tasks diferentes são dois defeitos, e o resumo que o
 * desenvolvedor lê no impasse — "fechou 1 de 2, 1 seguiu aberto" — depende de
 * distingui-los. Aqui o endereço faz parte da identidade, e deve fazer.
 */
export function fingerprint(finding: Finding): string {
  return `${finding.where}::${finding.problem}`.toLowerCase();
}

/**
 * A marca do PROBLEMA, para saber se é o mesmo ponto de novo.
 *
 * Pergunta diferente, marca diferente. Contar defeitos quer o endereço; reconhecer
 * insistência não pode querer, porque o endereço é justamente a parte que o auditor
 * reescreve. Medido no `assistencia2`, tentativas 2 e 3 da mesma fase:
 *
 *     t2: Tarefa de geração manual de cobranças | Os critérios definem o primeiro
 *         vencimento e o ajuste para o último dia do período, mas não exigem…
 *     t3: Tarefa «Gerar manualmente cobranças da recorrência de tenants ativos» |
 *         Os critérios definem o primeiro vencimento e o ajuste para o último dia…
 *
 * O problema é o mesmo texto; o endereço virou outro porque a emenda mexeu no
 * título da task que ele cita. Com o endereço na identidade, `ehRepetido` dizia
 * não, e o levantamento — a pergunta que existe para o desacordo que sobrevive a
 * uma reescrita — ficava fechado. O run caminhava para o impasse com pontos que
 * tinham voltado três vezes sem serem reconhecidos como repetidos.
 *
 * O preço é conhecido e aceito: dois achados com a MESMA frase de problema em
 * lugares diferentes contam como um só ponto para a arbitragem. Numa auditoria de
 * verdade a frase é longa e específica; a colisão é rara, e arbitrar duas vezes o
 * que o desenvolvedor já decidiu é pior.
 */
export function marcaDoProblema(finding: Finding): string {
  return finding.problem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * O achado que já voltou antes — e é aí que a conversa deixa de ser sobre escrita.
 *
 * Um achado que aparece uma vez é defeito: o escritor conserta e segue. Um achado
 * que sobrevive a uma reescrita é DESACORDO — o escritor leu as fontes de um
 * jeito, o auditor de outro, e nenhum dos dois pode decidir quem tem razão.
 * Mandá-lo de volta uma terceira vez é pagar para reencenar a mesma discussão.
 */
export function ehRepetido(finding: Finding, history: readonly AuditAttempt[]): boolean {
  const marca = marcaDoProblema(finding);
  return history.some((tentativa) => tentativa.verdict.findings.some((anterior) => marcaDoProblema(anterior) === marca));
}

/** Findings que sobreviveram a todas as devoluções, sem repetir o equivalente. */
/**
 * No que o auditor insiste AGORA.
 *
 * A versão anterior somava tudo o que ele havia dito em qualquer tentativa, e o
 * resultado era um impasse que citava defeitos já corrigidos. No piloto 3 isso
 * chegou ao absurdo de apresentar dois findings contraditórios lado a lado —
 * cada um descrevendo uma versão diferente do documento — e pedir que o
 * desenvolvedor decidisse entre eles.
 *
 * Insistência é sobre o texto que está na mesa: vale a última reprovação.
 */
export function persistentFindings(history: readonly AuditAttempt[]): Finding[] {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const attempt = history[index];
    if (attempt?.verdict.status === "REJECTED") return attempt.verdict.findings;
  }
  return [];
}

/**
 * Quais desses findings já tinham aparecido antes.
 *
 * É o sinal que importa no impasse: o ponto que sobreviveu a reescritas é o que
 * provavelmente não se resolve escrevendo melhor.
 */
export function repeatedFindings(history: readonly AuditAttempt[]): Set<string> {
  const contagem = new Map<string, number>();
  for (const attempt of history) {
    for (const marca of new Set(attempt.verdict.findings.map(marcaDoProblema))) {
      contagem.set(marca, (contagem.get(marca) ?? 0) + 1);
    }
  }
  return new Set([...contagem.entries()].filter(([, vezes]) => vezes > 1).map(([marca]) => marca));
}

/**
 * O que o escritor fez a cada tentativa, medido pelo que o auditor deixou de
 * apontar.
 *
 * O resumo era `tentativa N: escreveu <documento>`, repetido uma vez por
 * tentativa. Chamado a desempatar, o desenvolvedor via quatro linhas idênticas:
 * nem se o texto tinha mudado, nem o que o escritor havia fechado no caminho.
 *
 * Não há como perguntar ao escritor o que ele fez — ele escreve em sessão nova a
 * cada volta e não guarda a anterior. Mas o auditor leu as duas versões, e a
 * diferença entre os dois vereditos é exatamente isso: o que saiu da lista o
 * escritor resolveu, o que ficou ele não resolveu, o que apareceu ele quebrou.
 *
 * O caso que mais importa é o texto idêntico. Reenviar byte a byte o mesmo
 * documento não é desacordo sobre conteúdo: é o escritor sem saber o que fazer
 * com o pedido — e é o fato que decide se a pergunta ao desenvolvedor é sobre o
 * produto ou sobre o prompt.
 */
export function writerDid(history: readonly AuditAttempt[]): string[] {
  return history.map((attempt, index) => {
    const anterior = index === 0 ? null : history[index - 1];
    const apontados = attempt.verdict.findings.length;

    if (!anterior) {
      return `tentativa ${attempt.attempt}: escreveu o documento; ${attempt.verdict.mechanical ? "o self-check" : "o auditor"} apontou ${apontados} ponto(s)`;
    }

    const balanco = balancoDaRodada(history, index);
    if (balanco.mesmoTexto) return `tentativa ${attempt.attempt}: ${descreverBalanco(balanco)}`;
    return `tentativa ${attempt.attempt}: reescreveu — ${descreverBalanco(balanco).replace(/^fechou (\d+)/, `fechou $1 de ${anterior.verdict.findings.length}`)}`;
  });
}

/**
 * O balanço de uma rodada, medido pelo que o auditor deixou de apontar.
 *
 * É o que distingue progresso de estagnação com evidência, e não pela contagem
 * de devoluções. No `teste_openrouter3` (0.6.1, §120) a auditoria da
 * arquitetura devolveu cinco vezes e cada rodada fechou tudo o que a anterior
 * tinha apontado e trouxe um ponto novo — três deles presentes desde a primeira
 * arquitetura, como a comparação das versões em cache mostra. O arquiteto
 * estava convergindo; o auditor estava lendo aos pedaços; e o run parou por
 * contagem.
 *
 * - `fechados`: apontados na rodada anterior e ausentes agora;
 * - `persistentes`: apontados na anterior e ainda presentes;
 * - `novos`: nunca apontados antes;
 * - `regressoes`: fechados numa rodada anterior e de volta agora;
 * - `mesmoTexto`: o documento não mudou desde a rodada anterior.
 */
export interface Balanco {
  fechados: number;
  persistentes: number;
  novos: number;
  regressoes: number;
  mesmoTexto: boolean;
}

export function balancoDaRodada(history: readonly AuditAttempt[], index = history.length - 1): Balanco {
  const atual = history[index];
  const anterior = index > 0 ? history[index - 1] : undefined;
  if (!atual || !anterior) {
    return { fechados: 0, persistentes: 0, novos: atual?.verdict.findings.length ?? 0, regressoes: 0, mesmoTexto: false };
  }
  const agora = new Set(atual.verdict.findings.map(fingerprint));
  const antes = new Set(anterior.verdict.findings.map(fingerprint));
  const jaVistos = new Set(history.slice(0, index - 1).flatMap((tentativa) => tentativa.verdict.findings.map(fingerprint)));
  const fechados = [...antes].filter((marca) => !agora.has(marca)).length;
  const persistentes = [...antes].filter((marca) => agora.has(marca)).length;
  const inéditos = [...agora].filter((marca) => !antes.has(marca));
  const regressoes = inéditos.filter((marca) => jaVistos.has(marca)).length;
  return { fechados, persistentes, novos: inéditos.length - regressoes, regressoes, mesmoTexto: anterior.contentSha === atual.contentSha };
}

/**
 * Uma rodada que avançou: o texto mudou, algo fechou, nada persistiu e nada
 * voltou. A primeira devolução nunca é progresso — não há com o que comparar.
 */
export function rodadaAvancou(history: readonly AuditAttempt[], index: number): boolean {
  if (index <= 0) return false;
  const balanco = balancoDaRodada(history, index);
  return !balanco.mesmoTexto && balanco.fechados > 0 && balanco.persistentes === 0 && balanco.regressoes === 0;
}

/** O balanço em uma linha, para o log e para o impasse. */
export function descreverBalanco(balanco: Balanco): string {
  if (balanco.mesmoTexto) return "devolveu o MESMO texto, sem uma alteração sequer";
  const partes = [`fechou ${balanco.fechados}`];
  if (balanco.persistentes > 0) partes.push(`${balanco.persistentes} seguiu(ram) aberto(s)`);
  if (balanco.novos > 0) partes.push(`${balanco.novos} apareceu(ram) novo(s)`);
  if (balanco.regressoes > 0) partes.push(`${balanco.regressoes} voltou(aram) depois de fechado(s)`);
  return partes.join(", ");
}

export function nextAuditAction(state: AuditCycleState): AuditAction {
  const last = state.history.at(-1);
  if (!last) throw new Error("o ciclo de auditoria precisa de ao menos uma auditoria realizada");

  if (last.verdict.status === "APPROVED") {
    return { action: "publish", remarks: last.verdict.remarks };
  }

  /*
   * Defeito mecânico tem orçamento próprio.
   *
   * Contagem de critérios, dimensionamento, cobertura, referência morta: são
   * determinísticos, e o escritor converge para eles — no piloto 3 uma fase caiu
   * de 74 critérios para 61 numa única devolução. Gastar o teto do auditor nisso
   * deixou uma rodada só para o desacordo de verdade, e o run terminou em impasse
   * sobre uma contagem que mais uma volta teria resolvido.
   */
  const mechanical = state.history.filter((attempt) => attempt.verdict.status === "REJECTED" && attempt.verdict.mechanical === true).length;
  const returns = state.history.filter((attempt) => attempt.verdict.status === "REJECTED" && attempt.verdict.mechanical !== true).length;
  /*
   * O teto conta devoluções SEM progresso (§120). Uma rodada que fechou tudo o
   * que a anterior apontou, sem nada persistir nem voltar, é o escritor
   * convergindo e o auditor lendo mais: ela não gasta o teto. O que impede o
   * laço infinito de um auditor que sempre acha um ponto novo é o teto duro, o
   * dobro do teto — finito, e dito no impasse.
   */
  const semProgresso = state.history.filter(
    (attempt, index) => attempt.verdict.status === "REJECTED" && attempt.verdict.mechanical !== true && !rodadaAvancou(state.history, index),
  ).length;

  if (last.verdict.mechanical === true) {
    if (mechanical < state.maxMechanical) {
      return { action: "return-to-writer", findings: last.verdict.findings, attempt: last.attempt + 1 };
    }
  } else if (semProgresso < state.maxReturns && returns < state.maxReturns * 2) {
    return { action: "return-to-writer", findings: last.verdict.findings, attempt: last.attempt + 1 };
  }

  return {
    action: "ask-developer",
    standoff: {
      document: state.document,
      returns,
      mechanical: last.verdict.mechanical === true,
      mechanicalChecks: mechanical,
      auditorInsists: persistentFindings(state.history),
      repeated: repeatedFindings(state.history),
      writerDid: writerDid(state.history),
      question:
        last.verdict.mechanical === true
          ? `O self-check devolveu ${state.document} ${mechanical} vezes e a forma não fechou. ` +
            "Isso não é desacordo nem decisão de produto: o modelo não adequou a estrutura aos limites. " +
            "É possível repetir a correção ou interromper e trocar o modelo do writer. Publicar rascunho não dispensa os limites de prontidão."
          : returns >= state.maxReturns * 2
            ? `O auditor devolveu ${state.document} ${returns} vezes, cada rodada fechando o que a anterior apontou e trazendo ponto novo. ` +
              "O teto duro acabou: o auditor não termina de ler, ou o escritor abre um ponto a cada correção. Confira os pontos acima; isso, por si só, não indica uma decisão de produto pendente."
            : `O auditor devolveu ${state.document} ${returns} vezes e o escritor não fechou o ponto. ` +
              "A correção não convergiu dentro do orçamento. Confira os pontos acima; isso, por si só, não indica uma decisão de produto pendente.",
    },
  };
}

export function renderStandoff(standoff: Standoff): string {
  const lines: string[] = [
    standoff.mechanical
      ? `O modelo não adequou a estrutura de ${standoff.document} após ${standoff.mechanicalChecks} verificações mecânicas.`
      : `Impasse em ${standoff.document} após ${standoff.returns} devoluções.`,
    "",
    standoff.mechanical ? "O self-check aponta:" : "O auditor insiste em:",
  ];
  for (const finding of standoff.auditorInsists) {
    // O ponto que sobreviveu a reescritas é o que provavelmente não se resolve
    // escrevendo melhor, e é nele que a decisão do desenvolvedor costuma morar.
    const insistente = standoff.repeated.has(marcaDoProblema(finding)) ? " (repetido em mais de uma tentativa)" : "";
    lines.push(`  · ${finding.where}: ${finding.problem}${insistente}`);
    lines.push(`    correção pedida: ${finding.fix}`);
  }
  lines.push("", "O escritor fez:");
  standoff.writerDid.forEach((summary, index) => lines.push(`  ${index + 1}. ${summary}`));
  lines.push("", standoff.question);
  lines.push('Comandos: "reiniciar" tenta corrigir e auditar novamente; "publicar" aceita como está; "abortar" interrompe.');
  return lines.join("\n");
}
