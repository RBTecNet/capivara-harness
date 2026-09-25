/**
 * `change`: mexer numa aplicação que já roda.
 *
 * O `init` desenha um produto do zero e o `build` o constrói. Depois disso o
 * produto passa a existir — e todo pedido novo deixa de ser "o que construir"
 * para ser "o que mudar no que está construído". Sem um caminho para isso, o
 * desenvolvedor só tinha dois: editar o plano à mão, ou rodar um `init` novo que
 * desenharia o produto inteiro outra vez.
 *
 * O que este comando faz, na ordem:
 *
 * 1. lê o esqueleto — o que foi combinado — e o inventário — o que existe;
 * 2. pede o DELTA a uma chamada só: o que entra, o que sai, e as fases (1 a 3);
 * 3. se o modelo tiver dúvida material, ela vai à tela ANTES de virar fase;
 * 4. funde no esqueleto e detalha só as fases novas;
 * 5. republica esqueleto e plano, preservando o texto das fases que já existiam.
 *
 * O ponto delicado é o 5: o texto de uma fase já construída não pode ser
 * reescrito. É ele que o registro de fases fechadas usa para reconhecer o que
 * não precisa ser refeito, e mexer nele faria o build reconstruir a aplicação
 * inteira para acrescentar um formulário.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyChange,
  assemblePhase,
  assemblePhasesDocument,
  buildStamp,
  extractTasks,
  parseChange,
  parsePhases,
  renderSkeleton,
  sliceForPhase,
  tasksBlock,
  type Change,
  type ChangeQuestion,
  type Skeleton,
  type SkeletonPhase,
} from "../contract/index.js";
import { MAX_CRITERIA_PER_TASK, MAX_TASKS_PER_PHASE } from "../authoring/ledger.js";
import { changePrompt, phaseFromSlicePrompt } from "../prompts/index.js";
import { inspectProject, summarizeInventory } from "../init/inventory.js";
import { readRequestState, readSkeletonState, writeSkeletonState } from "../init/index.js";
import { runIdFor } from "../state/run-store.js";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";

/**
 * Os mesmos tetos do `plan`, e de propósito uma importação em vez de um número.
 *
 * Aqui havia 12 tasks e 6 critérios, contra 15 e 4 do razão de autoria. Dois
 * números para o mesmo conceito — "o que cabe numa sessão de agente" — e eles
 * divergiam no pior lugar possível: uma fase de mudança com 6 critérios por task
 * é construída pelo MESMO loop, verificada pelo MESMO verificador, e seria
 * recusada pelo self-check do plano se um dia passasse por ele. Quem escreve a
 * fase é o mesmo prompt nas duas pontas; a régua tinha de ser uma só.
 */
export { MAX_CRITERIA_PER_TASK, MAX_TASKS_PER_PHASE } from "../authoring/ledger.js";

export interface ChangeCall {
  (request: { role: "writer"; stage: string; subject: string; attempt: number; prompt: string }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: string | null;
  }>;
}

export interface ChangeOptions {
  projectRoot: string;
  language: string;
  /** O que mudar, verbatim. */
  request: string;
  call: ChangeCall;
  /** Como perguntar ao desenvolvedor. Ausente significa que não há quem responda. */
  ask?: (question: ChangeQuestion, indice: number, total: number) => Promise<string>;
  announce?: (line: string) => void;
}

export interface ChangeOutcome {
  change: Change;
  skeleton: Skeleton;
  /** As fases criadas, já numeradas e detalhadas. */
  novas: SkeletonPhase[];
  aplicados: string[];
  avisos: string[];
  /** Os arquivos republicados. */
  written: string[];
}

export class ChangeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeBlockedError";
  }
}

/**
 * A resposta a uma pergunta da mudança.
 *
 * Número escolhe a opção; texto livre vale como está. É a mesma regra da
 * entrevista, sem o classificador: aqui há uma rodada só, e o que o
 * desenvolvedor escreveu vai inteiro para a chamada seguinte, que é quem sabe
 * interpretá-lo no contexto do pedido.
 */
export function lerResposta(question: ChangeQuestion, bruto: string): string {
  const resposta = bruto.trim();
  if (resposta === "") return question.recommended;
  if (/^\d+$/.test(resposta)) return question.options[Number(resposta) - 1]?.label ?? resposta;
  return resposta;
}

export function renderQuestion(question: ChangeQuestion, indice: number, total: number): string {
  const linhas = [
    "",
    `Pergunta ${indice} de ${total} — ${question.topic}`,
    "",
    question.decision,
    "",
    `  por quê: ${question.why}`,
  ];
  if (question.options.length > 0) {
    linhas.push("");
    for (const [posicao, opcao] of question.options.entries()) {
      const marca = opcao.label === question.recommended ? " (recomendada)" : "";
      linhas.push(`  ${posicao + 1}) ${opcao.label}${marca} — ${opcao.consequence}`);
    }
  }
  return `${linhas.join("\n")}\n`;
}

async function pedirDelta(
  options: ChangeOptions,
  contexto: { skeleton: string; inventory: string },
  respostas: { question: string; answer: string }[],
  announce: (linha: string) => void,
): Promise<Change> {
  let defeitos: string[] = [];

  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    const resposta = await options.call({
      role: "writer",
      stage: "change",
      subject: "delta",
      attempt: tentativa,
      prompt: changePrompt({
        language: options.language,
        request: options.request,
        skeleton: contexto.skeleton,
        inventory: contexto.inventory,
        maxTasksPerPhase: MAX_TASKS_PER_PHASE,
        ...(respostas.length > 0 ? { answers: respostas } : {}),
        ...(defeitos.length > 0 ? { defects: defeitos } : {}),
      }),
    });

    if (resposta.timedOut) throw new ChangeBlockedError(`a chamada foi encerrada por limite do harness (${resposta.timedOut})`);

    const lido = parseChange(resposta.stdout, { maxTasksPerPhase: MAX_TASKS_PER_PHASE });
    if (lido.ok) return lido.change;

    defeitos = lido.defects.map((defeito) => `${defeito.problem} → ${defeito.hint}`);
    announce(`  a mudança veio com ${defeitos.length} defeito(s) de forma; pedindo de novo com eles nomeados`);
  }

  throw new ChangeBlockedError(`o plano da mudança veio inválido três vezes: ${defeitos.join("; ")}`);
}

export async function runChange(options: ChangeOptions): Promise<ChangeOutcome> {
  const announce = options.announce ?? ((): void => {});
  const paths = artifactPaths(options.projectRoot);

  const planoAtual = await readFile(join(paths.init, "project-phases.md"), "utf8").catch(() => "");
  const esqueletoBruto = await readFile(join(paths.init, "skeleton.md"), "utf8").catch(() => "");
  if (planoAtual === "" || esqueletoBruto === "") {
    throw new ChangeBlockedError(
      "não achei o que esta aplicação combinou ser: faltam `.capivara/init/skeleton.md` e `project-phases.md`.\n" +
        "Para uma aplicação que a capivara não construiu, rode `capivara survey` e depois `capivara init` — é o init que produz o esqueleto.",
    );
  }

  /*
   * O esqueleto vem do ESTADO, não do markdown.
   *
   * O `skeleton.md` é derivado — bom para ler, perdido em precisão para fundir.
   * O estado é o JSON que o `init` gravou, e ele é encontrado pelo pedido que o
   * produziu: o mesmo ponteiro que o `plan` usa para retomar.
   */
  const pedido = await readRequestState(options.projectRoot);
  const esqueleto = pedido ? await readSkeletonState(options.projectRoot, runIdFor("init", pedido.sha12)) : null;
  if (!esqueleto) {
    throw new ChangeBlockedError(
      "o esqueleto está publicado mas o estado dele não foi encontrado.\n" +
        "Ele é gravado pelo `init` junto do registro do pedido; rode o `init` deste projeto de novo para reconstruí-lo.",
    );
  }

  const inventory = await inspectProject(options.projectRoot);
  const contexto = { skeleton: esqueletoBruto, inventory: summarizeInventory(inventory) };

  let delta = await pedirDelta(options, contexto, [], announce);

  /*
   * A dúvida vai à tela ANTES de virar fase.
   *
   * Uma rodada só: a mudança é pequena por definição, e uma segunda rodada
   * custaria mais do que ela inteira. Sem quem responda, as perguntas viram
   * recusa — planejar sobre a suposição que a pergunta ia desfazer é como se
   * constrói a coisa errada com toda a confiança.
   */
  if (delta.questions.length > 0) {
    if (!options.ask) {
      throw new ChangeBlockedError(
        ["o planejamento da mudança depende de decisões que ninguém está aqui para tomar:", "", ...delta.questions.map((question) => `  - ${question.decision}`), "", "Rode de novo num terminal para responder."].join("\n"),
      );
    }

    const respostas: { question: string; answer: string }[] = [];
    for (const [posicao, question] of delta.questions.entries()) {
      const bruto = await options.ask(question, posicao + 1, delta.questions.length);
      respostas.push({ question: question.decision, answer: lerResposta(question, bruto) });
    }

    delta = await pedirDelta(options, contexto, respostas, announce);
    if (delta.questions.length > 0) {
      announce("  o planejador ainda tem dúvidas; sigo com o que foi respondido");
    }
  }

  if (delta.phases.length === 0) throw new ChangeBlockedError("a mudança não produziu fase nenhuma para construir");

  announce(`mudança: ${delta.summary}`);
  const aplicada = applyChange(esqueleto, delta);
  for (const linha of aplicada.aplicados) announce(`  ${linha}`);
  for (const aviso of aplicada.avisos) announce(`  aviso: ${aviso}`);
  if (delta.touches.length > 0) announce(`  toca no que já existe: ${delta.touches.join("; ")}`);

  /*
   * As fases novas são detalhadas aqui, e só elas.
   *
   * O `plan` detalha o esqueleto inteiro — é o que ele existe para fazer. Usá-lo
   * aqui reescreveria as fases já construídas, mudando o texto que o registro de
   * fases fechadas usa para reconhecê-las, e o build refaria a aplicação inteira
   * para acrescentar um formulário.
   */
  const detalhadas: string[] = [];
  for (const fase of aplicada.novas) {
    announce(`  detalhando a fase ${fase.number} — ${fase.title}`);
    let tasks = "";

    for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
      const saida = await options.call({
        role: "writer",
        stage: "change",
        subject: `phase-p${String(fase.number).padStart(2, "0")}`,
        attempt: tentativa,
        prompt: phaseFromSlicePrompt({
          language: options.language,
          slice: sliceForPhase(aplicada.skeleton, fase.number),
          phaseNumber: fase.number,
          totalPhases: aplicada.skeleton.phases.length,
          grammar: tasksBlock(fase.number),
          maxCriteriaPerTask: MAX_CRITERIA_PER_TASK,
          maxTasksPerPhase: MAX_TASKS_PER_PHASE,
        }),
      });

      tasks = extractTasks(saida.stdout).tasks;
      if (tasks.trim() !== "") break;
      if (tentativa === 1) announce(`    a fase ${fase.number} voltou sem task nenhuma; pedindo de novo`);
    }

    if (tasks.trim() === "") throw new ChangeBlockedError(`a fase ${fase.number} voltou sem task nenhuma em duas tentativas`);

    detalhadas.push(
      assemblePhase(
        { number: fase.number, title: fase.title, goal: fase.goal, dependsOn: fase.dependsOn, covers: fase.covers, areas: fase.areas },
        tasks,
      ).trim(),
    );
  }

  /*
   * O texto das fases que já existiam é preservado LETRA POR LETRA.
   *
   * Ele é a chave do registro de fases fechadas. Reescrevê-lo — mesmo para
   * melhor — faria o build não reconhecer mais o que já construiu.
   */
  const existentes = parsePhases(planoAtual);
  const anteriores = existentes.ok ? existentes.document.phases.map((fase) => fase.markdown.trim()) : [];
  if (anteriores.length === 0) {
    throw new ChangeBlockedError("não consegui ler as fases do plano atual; não vou reescrevê-lo sem saber o que já estava lá");
  }

  const skeletonMarkdown = renderSkeleton(aplicada.skeleton);
  const plano = assemblePhasesDocument({
    projectName: aplicada.skeleton.projectName,
    stamp: buildStamp([{ name: "skeleton.md", content: skeletonMarkdown }]),
    overview: `${aplicada.skeleton.phases.length} fases, fundação primeiro. O MVP fecha na fase ${aplicada.skeleton.mvpCutPhase}.`,
    phases: [...anteriores, ...detalhadas],
    openQuestions: [],
  });

  const caminhoEsqueleto = join(paths.init, "skeleton.md");
  const caminhoPlano = join(paths.init, "project-phases.md");

  await writeAtomic(caminhoEsqueleto, skeletonMarkdown);
  await writeAtomic(caminhoPlano, plano);
  // O estado do esqueleto é atualizado no MESMO lugar de onde veio: é por ele
  // que o `plan` e um `change` seguinte encontram o que já foi combinado.
  await writeSkeletonState(options.projectRoot, runIdFor("init", pedido!.sha12), aplicada.skeleton);

  return {
    change: delta,
    skeleton: aplicada.skeleton,
    novas: aplicada.novas,
    aplicados: aplicada.aplicados,
    avisos: aplicada.avisos,
    written: [caminhoEsqueleto, caminhoPlano],
  };
}
