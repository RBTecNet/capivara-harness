/**
 * O ciclo de fase.
 *
 * Sessão nova a cada tentativa, prompt auto-contido, quatro gates, e um commit
 * quando tudo fica verde com a árvore suja. Verde com a árvore limpa significa
 * que a fase já estava implementada em HEAD: concluída, sem commit.
 *
 * Esgotados os ciclos, o loop PARA e reporta, retomável. Seguir em frente com
 * uma fase vermelha faz a próxima construir sobre chão que não existe.
 */

import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { fixPrompt, flowPrompt, implementPrompt, verifyPrompt } from "../prompts/index.js";
import type { BuildProgressListener, LoopGate } from "./progress.js";
import { commitPhase, hasPendingChanges, treeSignature } from "./git.js";
import { declaredComplete, gate0, gate1, gate2, gate3, type GateName, type TestRunner } from "./gates.js";
import { detectRateLimit, planWait } from "./ratelimit.js";
import { FLOW_PORT, gate4, type FlowRunner } from "./flows.js";
import { procurarTestesNomeados } from "./feature-tests.js";
import { MEMORIAS_DIR, recolherMemorias, type MemoriaParaRegistrar } from "../mcp/index.js";
import { featureTestNames } from "../contract/index.js";
import type { SkeletonWorkflow } from "../contract/index.js";
import type { PhaseSession } from "./split.js";
import type { TestCommand } from "./testcmd.js";

export interface EngineResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: string | null;
  /**
   * O que só quem abriu o envelope da CLI sabe, e o gate 0 precisa saber.
   * Ausentes quando a CLI fala texto puro, e aí o gate 0 julga pelo código de saída.
   */
  resultRead?: boolean;
  engineError?: boolean;
}

export interface EngineCall {
  role: "builder" | "verifier";
  phase: PhaseSession;
  attempt: number;
  prompt: string;
}

export type EngineCaller = (call: EngineCall) => Promise<EngineResult>;

export interface PhaseRunOptions {
  projectRoot: string;
  runId: string;
  language: string;
  engine: string;
  session: PhaseSession;
  testCommand: TestCommand | null;
  /**
   * Redetecta o comando de teste DEPOIS da sessão do executor.
   *
   * Num greenfield a suíte não existe quando a fase começa e existe quando ela
   * termina: a própria fase 1 cria o package.json. Resolver uma vez, no
   * preflight, com o diretório vazio, condena o gate 2 a ficar pulado para
   * sempre — foi o que aconteceu no piloto 1, que entregou 27 testes passando
   * sem que o loop tivesse rodado um único deles.
   */
  resolveTest?: () => Promise<TestCommand | null>;
  call: EngineCaller;
  /**
   * O gate 4, quando o projeto tem fluxos a percorrer.
   *
   * Ausente significa build sem gate de fluxos — é o que acontece quando não há
   * esqueleto legível, e o comportamento volta a ser o de antes do §33.
   */
  flows?: {
    /** Os fluxos que esta fase entrega, vindos do esqueleto. */
    workflows: SkeletonWorkflow[];
    /** Os fluxos das fases já concluídas: a regressão desta fase. */
    regressao?: SkeletonWorkflow[];
    /**
     * Como a aplicação sobe — resolvido DEPOIS da sessão, não antes dela.
     *
     * Num greenfield o `package.json` não existe quando o build começa: é a
     * fase 1 que o escreve. Resolver uma vez, no início, condenava o gate 4 a
     * nunca ter o que abrir — o mesmo erro que o gate 2 já tinha pago com
     * `resolveTest`, e que aqui seria a mesma correção faltando no irmão.
     */
    resolveStart: () => Promise<string | null>;
    runner?: FlowRunner;
    port?: number;
  };
  testRunner?: TestRunner;
  /**
   * As skills desta fase, prontas para o prompt.
   *
   * Já escolhidas por área e materializadas no disco pelo build — o runner não
   * decide nada sobre elas, só as carrega.
   */
  skills?: string;
  /**
   * Recolhe o que o executor anotou, ao fim da fase.
   *
   * Ausente desliga o pedido no prompt: sem alguém para receber, pedir anotação
   * seria pedir trabalho que ninguém lê.
   */
  onMemorias?: (memorias: MemoriaParaRegistrar[]) => Promise<void>;
  /** Se o executor pode instalar fora do projeto. Muda o que o gate 2 pede a ele. */
  systemInstall?: boolean;
  maxCycles?: number;
  maxLimitWaits?: number;
  commitsEnabled: boolean;
  announce?: (message: string) => void;
  /** Espelho do andamento, para quem desenha. O loop emite e segue. */
  onProgress?: BuildProgressListener;
  sleep?: (seconds: number) => Promise<void>;
  now?: () => Date;
}

export type PhaseOutcome =
  | { status: "complete"; committed: boolean; message: string; cycles: number }
  | { status: "already-implemented"; cycles: number }
  | { status: "failed"; gate: GateName; cause: string; cycles: number }
  | { status: "rate-limit-exhausted"; waits: number };

export const DEFAULT_MAX_CYCLES = 3;
export const DEFAULT_MAX_LIMIT_WAITS = 20;

export async function runPhase(options: PhaseRunOptions): Promise<PhaseOutcome> {
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxLimitWaits = options.maxLimitWaits ?? DEFAULT_MAX_LIMIT_WAITS;
  const announce = options.announce ?? (() => undefined);
  const sleep = options.sleep ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)));
  const now = options.now ?? (() => new Date());
  const paths = runPaths(options.projectRoot, options.runId);
  const session = options.session;

  let waits = 0;
  let lastGate: GateName | null = null;
  let lastCause = "";
  let previousWroteNothing = false;

  const relatar = options.onProgress ?? (() => undefined);
  const gate = (nome: LoopGate, estado: "corrente" | "verde" | "vermelho", cycle: number): void =>
    relatar({ kind: "gate", id: session.id, gate: nome, state: estado, cycle });

  const event = async (status: "started" | "complete" | "retry" | "blocked" | "skipped", detail: string, attempt: number): Promise<void> => {
    await appendEvent(paths.events, {
      timestamp: now().toISOString(),
      stage: "implement",
      subject: session.id,
      attempt,
      status,
      detail,
    });
  };

  /*
   * O que o executor anotou vai embora com ele se ninguém recolher. Recolher
   * também quando a fase falha é deliberado: a armadilha que ele encontrou
   * apanhando é justamente o que a próxima tentativa precisa saber.
   */
  const recolher = async (cycle: number): Promise<void> => {
    if (!options.onMemorias) return;
    const memorias = await recolherMemorias(options.projectRoot, `${options.runId} · ${session.id} ciclo ${cycle}`);
    if (memorias.length === 0) return;
    announce(`[${session.id}] ${memorias.length} memória(s) anotada(s) pelo executor`);
    await options.onMemorias(memorias);
  };

  for (let cycle = 1; cycle <= maxCycles; ) {
    await event("started", cycle === 1 ? "implementação" : `ciclo de correção ${cycle}`, cycle);
    announce(cycle === 1 ? `[${session.id}] ${session.title}` : `[${session.id}] ciclo de correção ${cycle}/${maxCycles}`);
    relatar({
      kind: "phase",
      id: session.id,
      state: "em andamento",
      cycle,
      detail: cycle === 1 ? "implementação" : `ciclo ${cycle}/${maxCycles}`,
    });
    // O engine roda antes de qualquer veredito: o gate 0 é o que está correndo
    // enquanto a sessão trabalha, e é o que a tela precisa mostrar por minutos.
    gate("G0", "corrente", cycle);

    const context = {
      language: options.language,
      testCommand: options.testCommand?.command ?? null,
      containerized: options.testCommand?.containerized ?? false,
      phaseMarkdown: session.markdown,
      ...(options.skills !== undefined && options.skills !== "" ? { skills: options.skills } : {}),
      ...(options.onMemorias ? { memoriasDir: MEMORIAS_DIR } : {}),
    };

    const prompt =
      cycle === 1
        ? implementPrompt(context)
        : fixPrompt({ ...context, gate: lastGate ?? "gate 0 — engine", cause: lastCause, previousWroteNothing });

    await writeAtomic(`${paths.prompts}/${session.id}.cycle-${cycle}.txt`, prompt);

    const signatureBefore = await treeSignature(options.projectRoot);
    const result = await options.call({ role: "builder", phase: session, attempt: cycle, prompt });
    await writeAtomic(`${paths.logs}/${session.id}.cycle-${cycle}.log`, `${result.stdout}\n${result.stderr}`);

    // Limite de uso não é defeito da implementação: espera e repete a MESMA
    // fase, sem consumir ciclo de correção.
    const limit = detectRateLimit(`${result.stdout}\n${result.stderr}`, options.engine);
    if (limit) {
      waits += 1;
      if (waits > maxLimitWaits) return { status: "rate-limit-exhausted", waits };
      const plan = planWait(limit);
      announce(`[${session.id}] ${plan.reason}; aguardando ${plan.seconds}s sem consumir ciclo`);
      await event("retry", `limite de uso: ${plan.reason}`, cycle);
      await sleep(plan.seconds);
      continue;
    }

    // A fase pode ter acabado de criar a suíte. Perguntar de novo custa um
    // acesso a disco; não perguntar custa a fase inteira sem validação.
    const testeAgora = options.resolveTest ? await options.resolveTest() : options.testCommand;
    if (testeAgora && testeAgora.command !== options.testCommand?.command) {
      announce(`[${session.id}] comando de teste detectado: ${testeAgora.command} (${testeAgora.source})`);
    }

    const wrote = gate1(signatureBefore, await treeSignature(options.projectRoot));
    previousWroteNothing = !wrote;
    if (!wrote) announce(`[${session.id}] a sessão não escreveu nada; validando o código existente`);

    const noChangeNote = wrote ? "" : "A sessão anterior terminou sem alterar nenhum arquivo. ";

    /*
     * G4 — a aplicação faz o que foi pedido.
     *
     * Só roda depois do G3 verde, e por isso não encarece a fase que ainda está
     * errada: abrir o produto para percorrer um fluxo que o código nem tem
     * gastaria uma sessão e um navegador para descobrir o que o gate 3 já sabia.
     */
    const passouNosFluxos = async (cycleAtual: number): Promise<boolean> => {
      const fluxos = options.flows;
      if (!fluxos) return true;

      gate("G4", "corrente", cycleAtual);
      const g4 = await gate4({
        projectRoot: options.projectRoot,
        workflows: fluxos.workflows,
        ...(fluxos.regressao ? { regressao: fluxos.regressao } : {}),
        startCommand: await fluxos.resolveStart(),
        author: async (workflow, rejected) => {
          const resposta = await options.call({
            role: "verifier",
            phase: session,
            attempt: cycleAtual,
            prompt: flowPrompt({
              language: options.language,
              workflow: { number: workflow.number, name: workflow.name, steps: workflow.steps },
              baseUrl: `http://127.0.0.1:${fluxos.port ?? FLOW_PORT}`,
              ...(rejected.length > 0 ? { rejected } : {}),
            }),
          });
          await writeAtomic(
            `${paths.logs}/${session.id}.flow-${workflow.number}-${cycleAtual}.log`,
            resposta.stdout,
          );
          return resposta.stdout;
        },
        ...(fluxos.runner !== undefined ? { runner: fluxos.runner } : {}),
        ...(fluxos.port !== undefined ? { port: fluxos.port } : {}),
        announce: (message) => announce(`[${session.id}] ${message}`),
      });

      /*
       * A saída do Playwright vira arquivo SEMPRE, verde ou vermelho.
       *
       * O evento do run guarda só a primeira linha da causa e o painel some com
       * o resto: quando a fase 3 do MCP_teste reprovou três vezes, não havia no
       * disco uma linha do que tinha acontecido. Um gate que decide sobre o
       * produto precisa deixar a prova no lugar onde já se procura.
       */
      if (g4.output !== undefined && g4.output !== "") {
        await writeAtomic(`${paths.logs}/${session.id}.flow-run-${cycleAtual}.log`, g4.output);
      }

      gate("G4", g4.green ? "verde" : "vermelho", cycleAtual);
      if (g4.green) {
        if (g4.skipped !== "") announce(`[${session.id}] gate 4 pulado: ${g4.skipped}`);
        else announce(`[${session.id}] gate 4: ${g4.scripts.length} fluxo(s) percorrido(s) na aplicação de pé`);
        return true;
      }

      lastGate = "gate 4 — fluxos na aplicação";
      lastCause = g4.toolMissing === true ? g4.cause : `${noChangeNote}${g4.cause}`;
      if (g4.toolMissing === true) {
        announce(`[${session.id}] o runner de fluxos não está instalado; o executor vai instalá-lo no projeto`);
      } else if (g4.startupFailed === true) {
        // Dito na tela também: quem olha o log precisa saber que o produto não
        // subiu, e não que um fluxo reprovou.
        announce(`[${session.id}] gate 4: a aplicação não subiu; nenhum fluxo foi percorrido`);
      } else if (g4.scriptFailed === true) {
        announce(`[${session.id}] gate 4: o roteiro falhou por si mesmo, não o produto — defeito do harness`);
      }
      return false;
    };

    const g0 = gate0(result, options.engine);
    gate("G0", g0.green ? "verde" : "vermelho", cycle);
    // O gate 1 é sinal, não veredito: não escrever nada não reprova a fase, mas
    // muda tudo na leitura de quem olha a tela. Vem depois do gate 0 porque a
    // ordem na tela é a ordem dos gates, não a da avaliação.
    gate("G1", wrote ? "verde" : "vermelho", cycle);
    if (!g0.green) {
      lastGate = g0.gate;
      lastCause = g0.cause;
    } else {
      gate("G2", "corrente", cycle);
      const g2 = await gate2(options.projectRoot, testeAgora?.command ?? null, options.testRunner, options.systemInstall === true);
      gate("G2", g2.green ? "verde" : "vermelho", cycle);
      if (!g2.green) {
        lastGate = g2.gate;
        // Ferramenta ausente não ganha o prefixo de "não escreveu nada": a sessão
        // corretamente não mexeu no código, porque o defeito é de ambiente.
        lastCause = g2.toolMissing === true ? g2.cause : `${noChangeNote}${g2.cause}`;
        if (g2.toolMissing === true) {
          announce(
            `[${session.id}] o runner de testes não está instalado; ` +
              (options.systemInstall === true
                ? "o executor tem acesso de sistema para instalá-lo"
                : "o executor vai instalá-lo como dependência do projeto"),
          );
        }
      } else {
        if (g2.skipped) announce(`[${session.id}] gate 2 pulado: nenhum comando de teste resolvido`);
        gate("G3", "corrente", cycle);
        /*
         * O inventário mecânico dos testes nomeados, antes de gastar o
         * verificador. Ele não decide nada — decide quem lê o código —, mas
         * entrega todos os buracos de uma vez, em vez de um por ciclo.
         */
        const nomeados = await procurarTestesNomeados(options.projectRoot, featureTestNames(session.markdown));
        const semNome = nomeados.filter((teste) => !teste.found);
        if (semNome.length > 0) {
          announce(`[${session.id}] testes nomeados que não existem na árvore: ${semNome.map((teste) => teste.name).join(", ")}`);
        }

        const verification = await options.call({
          role: "verifier",
          phase: session,
          attempt: cycle,
          prompt: verifyPrompt({
            language: options.language,
            phaseMarkdown: session.markdown,
            taskCount: session.taskCount,
            featureTests: nomeados,
          }),
        });
        await writeAtomic(`${paths.logs}/${session.id}.verify-${cycle}.log`, verification.stdout);

        const g3 = gate3(verification.stdout, session.taskCount);
        gate("G3", g3.green ? "verde" : "vermelho", cycle);
        if (!g3.green) {
          lastGate = g3.gate;
          lastCause = `${noChangeNote}${g3.cause}`;
        } else if (!(await passouNosFluxos(cycle))) {
          // A causa já foi registrada por `passouNosFluxos`; o ciclo segue.
        } else {
          const commit = options.commitsEnabled
            ? await commitPhase(options.projectRoot, session.number, session.title)
            : { committed: false, message: "commits desabilitados: nenhum repositório Git" };

          if (!commit.committed && commit.message.includes("já estava implementada")) {
            await event("complete", "já implementada em HEAD", cycle);
            relatar({ kind: "phase", id: session.id, state: "concluído", cycle, detail: "já implementada" });
            announce(`[${session.id}] JÁ IMPLEMENTADA — gates verdes, nada a commitar`);
            return { status: "already-implemented", cycles: cycle };
          }

          await recolher(cycle);
          await event("complete", commit.message, cycle);
          relatar({ kind: "phase", id: session.id, state: "concluído", cycle, detail: commit.committed ? "commitada" : "completa" });
          announce(`[${session.id}] COMPLETA${commit.committed ? ` — ${commit.message}` : ""}`);
          return { status: "complete", committed: commit.committed, message: commit.message, cycles: cycle };
        }
      }
    }

    if (declaredComplete(result.stdout) && lastGate) {
      // A palavra do executor nunca supera um gate vermelho.
      announce(`[${session.id}] o executor declarou conclusão, mas ${lastGate} reprovou`);
    }
    await event("retry", `${lastGate}: ${lastCause.split("\n")[0] ?? ""}`, cycle);
    cycle += 1;
  }

  await recolher(maxCycles);
  await event("blocked", `${lastGate ?? "desconhecido"}: ${lastCause.split("\n")[0] ?? ""}`, maxCycles);
  relatar({ kind: "phase", id: session.id, state: "falhou", cycle: maxCycles, detail: lastGate ?? "sem gate" });

  /*
   * A fase parou deixando trabalho na árvore, e o preflight da próxima execução
   * exige árvore limpa. Sem dizer isto aqui, o operador cai num beco: o loop
   * para por causa do trabalho parcial e depois se recusa a retomar por causa do
   * mesmo trabalho parcial.
   */
  if (await hasPendingChanges(options.projectRoot)) {
    announce(`[${session.id}] o trabalho parcial desta fase ficou na árvore. Antes de rodar de novo, escolha uma:`);
    announce("           git add -A && git commit -m \"wip: trabalho parcial\"   → o loop revalida a fase e segue");
    announce("           git checkout -- . && git clean -fd                      → descarta e a fase recomeça do zero");
  }

  return { status: "failed", gate: lastGate ?? "gate 0 — engine", cause: lastCause, cycles: maxCycles };
}
