/**
 * A memória do que já foi julgado, na granularidade em que ele foi julgado.
 *
 * O auditor aprova ou devolve uma FASE, e o harness guardava a aprovação pelo sha
 * da fase inteira. Basta uma task mudar para o sha mudar, e a fase inteira volta
 * à fila — com as outras catorze, que ninguém tocou.
 *
 * O efeito num documento grande é um moto-contínuo, e o `assitencia` o mediu:
 *
 *     tentativa 2: fechou 4 de 4 →  6 novos
 *     tentativa 3: fechou 6 de 6 →  2 novos
 *     tentativa 4: fechou 2 de 2 →  7 novos
 *     tentativa 5: fechou 7 de 7 →  4 novos
 *
 * Dezenove fechados, dezenove novos. O escritor nunca falhou em fechar; o
 * auditor nunca ficou sem achar — porque relia 600 critérios a cada volta e
 * nenhuma leitura de modelo encontra tudo na primeira passada. Não é o documento
 * piorando: é amostragem.
 *
 * A chave de uma aprovação é o PAR: o texto julgado e a autoridade que o julgou.
 * Task que não mudou, com as mesmas decisões valendo, não volta. Decisão nova do
 * desenvolvedor muda a autoridade e derruba todas as aprovações de uma vez — o
 * que é exatamente o certo, porque uma fase aprovada ontem pode contradizer o que
 * ele decidiu agora.
 */

import type { TaskBlock } from "../contract/index.js";
import { sha12 } from "../contract/index.js";

/**
 * O texto da task, canônico.
 *
 * Reconstruído dos campos em vez de recortado do markdown: espaço a mais,
 * bullet trocado ou linha reordenada pelo reparo determinístico não são
 * mudanças de conteúdo, e não podem derrubar uma aprovação.
 */
export function textoDaTask(task: TaskBlock): string {
  return [
    task.title.trim(),
    ...task.acceptanceCriteria.map((criterio) => `c:${criterio.trim()}`),
    ...task.featureTests.map((teste) => `t:${teste.trim()}`),
    ...task.traces.map((trace) => `r:${trace.trim()}`),
    task.designRef ? `d:${task.designRef.trim()}` : "",
  ]
    .filter((linha) => linha !== "")
    .join("\n");
}

/** A chave de uma aprovação: o que foi julgado, e sob qual autoridade. */
export function chaveDaTask(task: TaskBlock, autoridade: string): string {
  return `${sha12(textoDaTask(task))}:${autoridade}`;
}

/**
 * O sha das decisões que valem agora.
 *
 * Entra na chave de toda aprovação: quando o desenvolvedor decide mais uma
 * coisa, este valor muda e nenhum julgamento anterior sobrevive. É a única forma
 * honesta de reauditar — e a única forma de NÃO reauditar o resto.
 */
export function shaDaAutoridade(decisoes: readonly string[]): string {
  return sha12([...decisoes].sort().join("\n"));
}

export class TasksJulgadas {
  private readonly aprovadas = new Set<string>();

  /** As tasks desta fase que já passaram, sob a autoridade de agora. */
  jaAprovadas(tasks: readonly TaskBlock[], autoridade: string): TaskBlock[] {
    return tasks.filter((task) => this.aprovadas.has(chaveDaTask(task, autoridade)));
  }

  aprovar(tasks: readonly TaskBlock[], autoridade: string): void {
    for (const task of tasks) this.aprovadas.add(chaveDaTask(task, autoridade));
  }

  get tamanho(): number {
    return this.aprovadas.size;
  }
}
