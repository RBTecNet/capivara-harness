/**
 * O que o `plan` conta enquanto trabalha.
 *
 * O `build` sempre teve a tela de fases: uma linha por fase, as bolinhas dos
 * gates, o ciclo corrente. O `plan` — que é o estágio LONGO, dezenas de chamadas,
 * minutos calado dentro de cada uma — só tinha linhas de log passando. Quem
 * olhava não sabia em que fase ele estava, quantas faltavam, nem se a auditoria
 * já tinha começado.
 *
 * O formato é o mesmo do `build` de propósito: o orquestrador emite e segue, e a
 * tela acumula. Ele nunca pergunta nada de volta, e nunca depende de haver tela.
 */

export type PlanPhaseEvent =
  /** O plano inteiro, antes de a primeira fase começar. */
  | { kind: "planned"; phases: { number: number; title: string; tasks?: number }[] }
  /** A escrita da fase. `reused` quando ela veio do cache e não custou chamada. */
  | { kind: "authoring"; number: number; state: "corrente" | "pronta" | "reused" }
  /** A auditoria da fase. `devolvida` traz quantos achados vieram. */
  | { kind: "audit"; number: number; state: "corrente" | "aprovada" | "devolvida"; findings?: number }
  /** A etapa do documento inteiro: lacunas, coerência, ensaio. */
  | { kind: "documento"; etapa: string };

export type PlanProgressListener = (event: PlanPhaseEvent) => void;
