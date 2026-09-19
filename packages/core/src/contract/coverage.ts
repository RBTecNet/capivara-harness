/**
 * I-10, I-11 e I-12 — as três coberturas.
 *
 * São o que transforma "cobrir tudo" de intenção em verificação. Uma story sem
 * task, uma entidade citada em lugar nenhum ou um workflow que sumiu entre a
 * descrição e o plano são trabalho esquecido que o loop entregaria como
 * concluído, porque ele só executa o que o plano declara.
 *
 * A correção é sempre adicionar a task que falta — nunca apagar a story, a
 * entidade ou o workflow do esqueleto para silenciar a checagem.
 */

/** Um fluxo numerado, do jeito que o `**Traces:**` de uma task o endereça. */
export interface Workflow {
  number: string;
  name: string;
}
import type { ContractError, PhasesDocument } from "./phases.js";

export interface CoverageSources {
  storyIds: string[];
  entities: string[];
  workflows: Workflow[];
}

export function checkCoverage(document: PhasesDocument, sources: CoverageSources): ContractError[] {
  return [
    ...checkStories(document, sources.storyIds),
    ...checkEntities(document, sources.entities),
    ...checkWorkflows(document, sources.workflows),
  ];
}

/** I-10 — toda story do apêndice aparece em pelo menos um `**Traces:**`. */
export function checkStories(document: PhasesDocument, storyIds: string[]): ContractError[] {
  const traces = allTraces(document).join(" · ");
  const errors: ContractError[] = [];
  for (const id of storyIds) {
    // O guarda de dígito impede que US-1.1 seja satisfeita por US-1.10.
    const pattern = new RegExp(`${escape(id)}(?![0-9])`);
    if (pattern.test(traces)) continue;
    errors.push({
      code: "I-10",
      line: 0,
      message: `a story ${id} não é citada por nenhuma task`,
      hint: `adicione a task que implementa ${id} e cite-a em **Traces:**; nunca remova a story do esqueleto para calar a checagem`,
    });
  }
  return errors;
}

/** I-11 — toda entidade do modelo de dados aparece em pelo menos uma task. */
export function checkEntities(document: PhasesDocument, entities: string[]): ContractError[] {
  const haystack = allTaskText(document).join(" · ");
  const errors: ContractError[] = [];
  for (const entity of entities) {
    const pattern = new RegExp(`\\b${escape(entity)}\\b`);
    if (pattern.test(haystack)) continue;
    errors.push({
      code: "I-11",
      line: 0,
      message: `a entidade ${entity} não aparece em nenhuma task`,
      hint: `adicione a task que cria ou usa ${entity}; uma entidade sem plano é um dado que nunca será implementado`,
    });
  }
  return errors;
}

/** I-12 — todo workflow numerado é coberto por uma task ou explicitamente excluído. */
/**
 * I-12 — todo workflow da descrição aparece em pelo menos um `**Traces:**`.
 *
 * Não existe lista de exclusão, e não existe de propósito. A descrição do
 * projeto nasce da entrevista: um workflow que não deve ser construído
 * simplesmente não é escrito lá. Excluir no plano o que a descrição afirma seria
 * deixar os dois documentos discordando por escrito, com um mecanismo para
 * tornar a discordância legítima.
 */
export function checkWorkflows(document: PhasesDocument, workflows: Workflow[]): ContractError[] {
  const traces = allTraces(document).join(" · ").toLowerCase();
  const errors: ContractError[] = [];
  for (const workflow of workflows) {
    const pattern = new RegExp(`workflow\\s+${escape(workflow.number)}(?![0-9])`);
    if (pattern.test(traces)) continue;
    errors.push({
      code: "I-12",
      line: 0,
      message: `o workflow ${workflow.number} ("${workflow.name}") não é coberto por nenhuma task`,
      hint:
        `cite \`workflow ${workflow.number}\` em **Traces:** na task que o implementa — o rótulo é estrutural ` +
        `e não se traduz; se o workflow não deve ser construído, ele não deveria estar na descrição do projeto`,
    });
  }
  return errors;
}

function allTraces(document: PhasesDocument): string[] {
  return document.phases.flatMap((phase) => phase.tasks.flatMap((task) => task.traces));
}

function allTaskText(document: PhasesDocument): string[] {
  return document.phases.flatMap((phase) =>
    phase.tasks.flatMap((task) => [
      task.title,
      ...task.acceptanceCriteria,
      ...task.featureTests,
      ...task.traces,
    ]),
  );
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
