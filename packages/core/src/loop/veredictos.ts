/**
 * As tasks que o verificador já declarou DONE, e com que texto.
 *
 * O `plan` aprendeu isto e o `build` não — e é a mesma lição, medida duas vezes.
 * No `plan` era o auditor relendo 600 critérios por rodada e achando dois pontos
 * novos a cada volta (§73). Aqui é o verificador relendo catorze tasks por ciclo:
 *
 *     ciclo 1: TASK 1 e TASK 10 incompletas
 *     ciclo 2: TASK 7 e TASK 10   ← a 7 estava DONE no ciclo 1
 *     ciclo 3: TASK 2 e TASK 6    ← as duas estavam DONE nos ciclos 1 e 2
 *
 * Seis tasks diferentes, nunca mais de duas por vez, e o executor fechou todas as
 * que lhe foram apontadas. **A fase não estava piorando: era amostragem.** Nenhuma
 * leitura de modelo encontra tudo numa passada, e cada nova leitura de um texto já
 * lido acha algo que a anterior não achou. Com catorze tasks isso não converge —
 * a fase gasta os três ciclos e o build para com doze tasks prontas.
 *
 * Então um DONE é FATO DO RUN, como a aprovação de uma fase já era. A chave é o
 * texto da task, não o número dela: editar um critério no plano faz a task voltar
 * a ser verificada, que é exatamente o que se quer de quem editou.
 *
 * O que protege contra um DONE velho que deixou de ser verdade não é reperguntar:
 * são os gates 0, 1 e 2, que rodam a árvore INTEIRA a cada ciclo, e a conferência
 * mecânica dos testes nomeados, que também. Uma correção que quebre uma task
 * fechada quebra a compilação ou a suíte — e essas não dependem de atenção.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { textoDaTask } from "../audit/tasks.js";
import { parsePhaseFragment, sha12, type TaskBlock } from "../contract/index.js";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";

export interface TaskAprovada {
  /** `P01`, `P02`… a fase a que a task pertence. */
  phase: string;
  /** A posição dela na fase, a partir de 1 — a mesma que o verificador usa. */
  index: number;
  /** O sha do texto canônico da task quando ela passou. */
  sha: string;
  title: string;
  runId: string;
  cycle: number;
  at: string;
}

function caminho(projectRoot: string): string {
  return join(artifactPaths(projectRoot).handoffs, "tasks.json");
}

/** As tasks de uma fase, lidas do markdown dela. Vazio quando o recorte não lê. */
export function tasksDaFase(phaseMarkdown: string): TaskBlock[] {
  return parsePhaseFragment(phaseMarkdown)?.tasks ?? [];
}

export function shaDaTask(task: TaskBlock): string {
  return sha12(textoDaTask(task));
}

/**
 * O registro, aberto uma vez por build.
 *
 * Ele atravessa execuções de propósito: o caso que doeu foi exatamente o de rodar
 * `capivara build` de novo depois de a fase parar, e a verificação recomeçar do
 * zero nas catorze tasks para achar outras duas.
 */
export class TasksAprovadas {
  private constructor(
    private readonly projectRoot: string,
    private readonly runId: string,
    private readonly registro: TaskAprovada[],
  ) {}

  static async abrir(projectRoot: string, runId: string, refazerTudo = false): Promise<TasksAprovadas> {
    if (refazerTudo) return new TasksAprovadas(projectRoot, runId, []);
    return new TasksAprovadas(projectRoot, runId, await ler(projectRoot));
  }

  /** As tasks desta fase que já passaram, com este texto. */
  jaAprovadas(phaseId: string, tasks: readonly TaskBlock[]): TaskBlock[] {
    return tasks.filter((task) =>
      this.registro.some((entrada) => entrada.phase === phaseId && entrada.sha === shaDaTask(task)),
    );
  }

  /** Os índices já aprovados, que é o que o gate 3 precisa saber. */
  indicesAprovados(phaseId: string, tasks: readonly TaskBlock[]): Set<number> {
    return new Set(this.jaAprovadas(phaseId, tasks).map((task) => task.index));
  }

  async aprovar(
    phaseId: string,
    tasks: readonly TaskBlock[],
    indices: readonly number[],
    cycle: number,
    now = () => new Date(),
  ): Promise<void> {
    const novas = tasks
      .filter((task) => indices.includes(task.index))
      .filter((task) => !this.registro.some((entrada) => entrada.phase === phaseId && entrada.sha === shaDaTask(task)))
      .map((task) => ({
        phase: phaseId,
        index: task.index,
        sha: shaDaTask(task),
        title: task.title,
        runId: this.runId,
        cycle,
        at: now().toISOString(),
      }));
    if (novas.length === 0) return;

    this.registro.push(...novas);
    /*
     * Relê antes de gravar: duas fases correndo ao mesmo tempo não existem hoje,
     * mas o arquivo é do projeto e não do run, e sobrescrever o que outro
     * processo escreveu apagaria julgamento pago.
     */
    const emDisco = await ler(this.projectRoot);
    const juntos = [...emDisco.filter((entrada) => !novas.some((nova) => nova.phase === entrada.phase && nova.sha === entrada.sha)), ...novas];
    await writeAtomic(caminho(this.projectRoot), `${JSON.stringify(juntos, null, 2)}\n`);
  }
}

async function ler(projectRoot: string): Promise<TaskAprovada[]> {
  try {
    const lido = JSON.parse(await readFile(caminho(projectRoot), "utf8")) as unknown;
    if (!Array.isArray(lido)) return [];
    return lido.filter((item): item is TaskAprovada => {
      const entrada = (item ?? {}) as Partial<TaskAprovada>;
      return typeof entrada.phase === "string" && typeof entrada.sha === "string" && entrada.sha !== "" && typeof entrada.index === "number";
    });
  } catch {
    return [];
  }
}
