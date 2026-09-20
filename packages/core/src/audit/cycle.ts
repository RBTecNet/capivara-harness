/**
 * O ciclo de devolução.
 *
 * O auditor descreve o defeito e a correção; quem aplica é o escritor, em sessão
 * nova. Se o auditor corrigisse, seria escritor e auditor ao mesmo tempo e a
 * independência do veredito acabaria.
 *
 * Esgotado o teto, o run NÃO desiste em silêncio nem aceita o documento: ele
 * para e mostra ao desenvolvedor, lado a lado, o que o auditor rejeita e o que o
 * escritor insiste em fazer. Na prática isso é quase sempre um gap de entrevista
 * disfarçado de desacordo, e uma resposta humana resolve.
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
  returns: number;
  /** O que o auditor rejeita na versão atual do documento. */
  auditorInsists: Finding[];
  /** Marcas dos findings que já tinham aparecido em tentativa anterior. */
  repeated: Set<string>;
  /** O que o escritor fez a cada tentativa, visto pelo próprio auditor. */
  writerDid: string[];
  question: string;
}

function fingerprint(finding: Finding): string {
  return `${finding.where}::${finding.problem}`.toLowerCase();
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
    for (const marca of new Set(attempt.verdict.findings.map(fingerprint))) {
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
    const agora = new Set(attempt.verdict.findings.map(fingerprint));

    if (!anterior) {
      return `tentativa ${attempt.attempt}: escreveu o documento; o auditor apontou ${apontados} ponto(s)`;
    }

    if (anterior.contentSha === attempt.contentSha) {
      return `tentativa ${attempt.attempt}: devolveu o MESMO texto, sem uma alteração sequer`;
    }

    const antes = anterior.verdict.findings.map(fingerprint);
    const fechados = antes.filter((marca) => !agora.has(marca)).length;
    const abertos = antes.filter((marca) => agora.has(marca)).length;
    const novos = [...agora].filter((marca) => !antes.includes(marca)).length;

    const partes = [`fechou ${fechados} de ${antes.length}`];
    if (abertos > 0) partes.push(`${abertos} seguiu(ram) aberto(s)`);
    if (novos > 0) partes.push(`${novos} apareceu(ram) novo(s)`);
    return `tentativa ${attempt.attempt}: reescreveu — ${partes.join(", ")}`;
  });
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

  if (last.verdict.mechanical === true) {
    if (mechanical < state.maxMechanical) {
      return { action: "return-to-writer", findings: last.verdict.findings, attempt: last.attempt + 1 };
    }
  } else if (returns < state.maxReturns) {
    return { action: "return-to-writer", findings: last.verdict.findings, attempt: last.attempt + 1 };
  }

  return {
    action: "ask-developer",
    standoff: {
      document: state.document,
      returns,
      auditorInsists: persistentFindings(state.history),
      repeated: repeatedFindings(state.history),
      writerDid: writerDid(state.history),
      question:
        last.verdict.mechanical === true
          ? `O self-check devolveu ${state.document} ${mechanical} vezes e a forma não fechou. ` +
            "Isso não é desacordo: é dimensionamento que o escritor não consegue resolver reescrevendo no lugar. O que vale?"
          : `O auditor devolveu ${state.document} ${returns} vezes e o escritor não fechou o ponto. ` +
            "Isso costuma ser um gap de entrevista disfarçado de desacordo. O que vale?",
    },
  };
}

export function renderStandoff(standoff: Standoff): string {
  const lines: string[] = [
    `Impasse em ${standoff.document} após ${standoff.returns} devoluções.`,
    "",
    "O auditor insiste em:",
  ];
  for (const finding of standoff.auditorInsists) {
    // O ponto que sobreviveu a reescritas é o que provavelmente não se resolve
    // escrevendo melhor, e é nele que a decisão do desenvolvedor costuma morar.
    const insistente = standoff.repeated.has(fingerprint(finding)) ? " (repetido em mais de uma tentativa)" : "";
    lines.push(`  · ${finding.where}: ${finding.problem}${insistente}`);
    lines.push(`    correção pedida: ${finding.fix}`);
  }
  lines.push("", "O escritor fez:");
  standoff.writerDid.forEach((summary, index) => lines.push(`  ${index + 1}. ${summary}`));
  lines.push("", standoff.question);
  lines.push('Comandos: "reiniciar" tenta corrigir e auditar novamente; "publicar" aceita como está; "abortar" interrompe.');
  return lines.join("\n");
}
