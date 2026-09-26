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

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { declarouRoteiroErrado, fixPrompt, flowPrompt, implementPrompt, triagePrompt, verifyPrompt, type Triagem } from "../prompts/index.js";
import type { BuildProgressListener, LoopGate, LoopGateState } from "./progress.js";
import { commitPhase, hasPendingChanges, treeSignature } from "./git.js";
import { declaredComplete, defaultTestRunner, gate0, gate1, gate2, gate3, type GateName, type TestRunner } from "./gates.js";
import { detectCredentialRejection, detectRateLimit, planWait } from "./ratelimit.js";
import { FLOWS_DIR, flowScriptName, gate4, type FlowRunner } from "./flows.js";
import { procurarTestesNomeados } from "./feature-tests.js";
import { TasksAprovadas, tasksDaFase } from "./veredictos.js";
import { prepararAmbiente } from "./ambiente.js";
import { faltaOPacoteDoRunner } from "./dependencias.js";
import { MEMORIAS_DIR, recolherMemorias, type MemoriaParaRegistrar } from "../mcp/index.js";
import { featureTestNames, sha12 } from "../contract/index.js";
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
   * O que o verificador já declarou DONE nesta fase, em ciclo anterior.
   *
   * Ausente significa verificar tudo a cada ciclo, que é o comportamento de antes
   * do §75 — e o que fez o `assitencia` gastar os três ciclos de P01 em seis tasks
   * diferentes, duas por vez, sem nunca fechar.
   */
  aprovadas?: TasksAprovadas;
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
  | { status: "rate-limit-exhausted"; waits: number }
  /**
   * O provider recusou a credencial.
   *
   * Não consome ciclo e não é culpa da fase: o código nem chegou a ser julgado. E
   * não se espera nem se repete — o limite de uso volta sozinho, a credencial não.
   */
  | { status: "credential-rejected"; engine: string; evidence: string; cycles: number };

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
  /*
   * As VERSÕES de roteiro já contestadas, pelo sha do conteúdo.
   *
   * Era "uma contestação por fase". Na P05 do `assistencia2` a contestação do
   * ciclo 2 reescreveu o roteiro, o roteiro novo nasceu com OUTRO defeito, e o
   * executor o diagnosticou certo nos ciclos 3, 5 e 6 — ignorado, porque a cota
   * já tinha ido. Quatro ciclos rodaram o mesmo roteiro contra o mesmo produto.
   * Contestar de novo a MESMA versão continua não valendo; uma versão nova, que
   * ninguém contestou, vale.
   */
  const versoesContestadas = new Set<string>();
  /** Quantas triagens o gate 4 pediu neste ciclo — nomeia o log de cada uma. */
  let triagensNoCiclo = 0;
  /*
   * O que o gate 4 reprovou por último. A contestação do executor fala DESSA
   * passagem, e é o roteiro que falhou nela que precisa ser reescrito.
   */
  let fluxosQueFalharamPorUltimo: string[] = [];

  const relatar = options.onProgress ?? (() => undefined);
  const gate = (nome: LoopGate, estado: LoopGateState, cycle: number): void =>
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

  /*
   * Toda chamada ao provider é protegida, e não só a do executor.
   *
   * O executor sempre teve a proteção do limite de uso. O verificador e o autor dos
   * roteiros — que falam com o MESMO provider — não tinham nenhuma: uma resposta
   * de "credencial recusada" ou "limite atingido" voltava como texto, o gate 3 a
   * lia como "o verificador não emitiu linha nenhuma", e a fase pagava um ciclo por
   * um defeito do ambiente. No P02 do `assistencia2` foram dois ciclos assim, e o
   * build parou com o produto correto e uma contestação do executor que nunca
   * chegou a ser atendida.
   */
  class CredencialRecusada extends Error {
    constructor(readonly evidencia: string) {
      super(evidencia);
    }
  }
  class LimiteEsgotado extends Error {}

  const chamarLeitor = async (chamada: Parameters<EngineCaller>[0]): Promise<EngineResult> => {
    for (;;) {
      const resposta = await options.call(chamada);
      const saida = `${resposta.stdout}\n${resposta.stderr}`;
      const recusa = detectCredentialRejection(saida);
      if (recusa !== null) throw new CredencialRecusada(recusa);

      const limite = detectRateLimit(saida, options.engine);
      if (!limite) return resposta;
      waits += 1;
      if (waits > maxLimitWaits) throw new LimiteEsgotado();
      const plano = planWait(limite);
      announce(`[${session.id}] ${plano.reason}; aguardando ${plano.seconds}s e repetindo a mesma chamada, sem consumir ciclo`);
      await event("retry", `limite de uso: ${plano.reason}`, chamada.attempt);
      await sleep(plano.seconds);
    }
  };

  let cicloCorrente = 1;
  try {
  for (let cycle = 1; cycle <= maxCycles; ) {
    cicloCorrente = cycle;
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

    /*
     * O runner de fluxos, dito ANTES de a sessão começar.
     *
     * O harness já sabia no preflight, e contava de novo só quando o gate 4
     * reprovava — meia hora de sessão para descobrir uma ausência anotada antes
     * da primeira chamada. Só é dito na fase que tem fluxo: avisar quem não vai
     * ser percorrido no navegador é ruído.
     */
    const precisaDoRunner =
      cycle === 1 && (options.flows?.workflows.length ?? 0) > 0 && (await faltaOPacoteDoRunner(options.projectRoot));

    const context = {
      language: options.language,
      testCommand: options.testCommand?.command ?? null,
      containerized: options.testCommand?.containerized ?? false,
      phaseMarkdown: session.markdown,
      ...(precisaDoRunner ? { runnerDeFluxosAusente: true } : {}),
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

    const recusa = detectCredentialRejection(`${result.stdout}\n${result.stderr}`);
    if (recusa !== null) throw new CredencialRecusada(recusa);

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
    const passouNosFluxos = async (cycleAtual: number, contestacao?: string): Promise<boolean> => {
      const fluxos = options.flows;
      if (!fluxos) return true;

      gate("G4", "corrente", cycleAtual);
      const g4 = await gate4({
        projectRoot: options.projectRoot,
        workflows: fluxos.workflows,
        ...(contestacao ? { roteiroContestado: contestacao, roteirosQueFalharam: fluxosQueFalharamPorUltimo } : {}),
        ...(fluxos.regressao ? { regressao: fluxos.regressao } : {}),
        startCommand: await fluxos.resolveStart(),
        author: async (workflow, rejected, baseUrl, passagem) => {
          const resposta = await chamarLeitor({
            role: "verifier",
            phase: session,
            attempt: cycleAtual,
            prompt: flowPrompt({
              language: options.language,
              workflow: { number: workflow.number, name: workflow.name, steps: workflow.steps },
              // A porta é do gate: ele escolhe uma livre a cada passagem.
              baseUrl,
              ...(rejected.length > 0 ? { rejected } : {}),
              passagem,
            }),
          });
          await writeAtomic(
            `${paths.logs}/${session.id}.flow-${workflow.number}-${cycleAtual}.log`,
            resposta.stdout,
          );
          return resposta.stdout;
        },
        /*
         * A triagem é um leitor independente, como o verificador e o roteirista:
         * só lê, e passa pela mesma proteção contra credencial e limite de uso.
         */
        triagem: async (entrada) => {
          triagensNoCiclo += 1;
          const resposta = await chamarLeitor({
            role: "verifier",
            phase: session,
            attempt: cycleAtual,
            prompt: triagePrompt({
              language: options.language,
              phaseMarkdown: session.markdown,
              workflow: { number: entrada.workflow.number, name: entrada.workflow.name, steps: entrada.workflow.steps },
              script: entrada.script,
              failure: entrada.failure,
              snapshot: entrada.snapshot,
              serverErrors: entrada.serverErrors,
            }),
          });
          await writeAtomic(`${paths.logs}/${session.id}.triagem-${cycleAtual}-${triagensNoCiclo}.log`, resposta.stdout);
          return resposta.stdout;
        },
        ...(fluxos.runner !== undefined ? { runner: fluxos.runner } : {}),
        ...(fluxos.port !== undefined ? { port: fluxos.port } : {}),
        announce: (message) => announce(`[${session.id}] ${message}`),
      });
      triagensNoCiclo = 0;
      if (g4.green === false && g4.triagem?.tipo === "CRITERIO") {
        await registrarDecisaoDoBuild(options.projectRoot, session.id, cycleAtual, g4.triagem);
      }

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
        fluxosQueFalharamPorUltimo = [];
        if (g4.skipped !== "") announce(`[${session.id}] gate 4 pulado: ${g4.skipped}`);
        else announce(`[${session.id}] gate 4: ${g4.scripts.length} fluxo(s) percorrido(s) na aplicação de pé`);
        return true;
      }

      fluxosQueFalharamPorUltimo = g4.falharam ?? [];
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

    /*
     * O executor pode dizer que o roteiro é que está errado.
     *
     * Ele é a única parte do ciclo que leu o produto E o erro do seletor. Sem
     * esta saída, a única resposta possível a um gate 4 vermelho é mexer no
     * produto — e na fase 4 do MCP_teste2 isso moveu um título para dentro de um
     * `form` só porque o seletor o procurava ali.
     *
     * Uma vez por fase: a contestação manda reescrever o roteiro antes de rodar,
     * e se o produto estiver mesmo errado o roteiro novo reprova igual.
     */
    const declarada = declarouRoteiroErrado(result.stdout);
    let contestacao: string | null = null;
    if (declarada) {
      /*
       * Quais versões esta contestação atinge: as dos roteiros que falharam na
       * última passagem. Sem essa informação — a primeira passagem de um run
       * retomado —, vale uma vez, como antes.
       */
      const versoes =
        fluxosQueFalharamPorUltimo.length > 0
          ? await Promise.all(
              fluxosQueFalharamPorUltimo.map(async (numero) => {
                const conteudo = await readFile(join(options.projectRoot, FLOWS_DIR, flowScriptName(numero)), "utf8").catch(() => "");
                return `${numero}:${sha12(conteudo)}`;
              }),
            )
          : ["sem-falha-conhecida"];
      if (versoes.some((versao) => !versoesContestadas.has(versao))) {
        for (const versao of versoes) versoesContestadas.add(versao);
        contestacao = declarada;
        announce(`[${session.id}] o executor contestou o roteiro em vez de mexer no produto: ${declarada}`);
      } else {
        announce(`[${session.id}] contestação ignorada: este mesmo roteiro já foi contestado e reescrito nesta fase`);
      }
    }
    const contestacaoDoRoteiro = contestacao ?? undefined;

    const g0 = gate0(result, options.engine);
    gate("G0", g0.green ? "verde" : "vermelho", cycle);
    /*
     * O gate 1 é sinal, não veredito: não escrever nada não reprova a fase, mas
     * muda tudo na leitura de quem olha a tela. Vem depois do gate 0 porque a
     * ordem na tela é a ordem dos gates, não a da avaliação.
     *
     * E por isso ele nunca fica vermelho. Numa fase já implementada — o caso
     * comum de todo build retomado e de todo `change` — não escrever é o certo,
     * e a bolinha vermelha ao lado de quatro verdes fazia a tela relatar uma
     * falha que não houve. Cinza: rodou, e não há o que reportar.
     */
    gate("G1", wrote ? "verde" : "neutro", cycle);
    if (!g0.green) {
      lastGate = g0.gate;
      lastCause = g0.cause;
    } else {
      /*
       * Antes de qualquer gate rodar o produto: configuração e esquema.
       *
       * Aqui e não no preflight porque quem entrega o `.env.example` e a
       * migração é o executor, e ele os entrega no meio da fase. A cada ciclo
       * porque cada fase acrescenta tabela.
       */
      const ambiente = await prepararAmbiente(options.projectRoot, options.testRunner ?? defaultTestRunner);
      for (const aviso of ambiente.anuncios) announce(`[${session.id}] ${aviso}`);
      /*
       * A saída da migração vai ao disco SEMPRE que ela roda.
       *
       * Ela saía só na tela, e a tela corta: no `assitencia` a linha terminou em
       * "> gestao-assistencia-tec…" e a causa real não existia em lugar nenhum.
       * Mensagem que só cabe na tela é mensagem que se perde no primeiro caso
       * interessante.
       */
      if (ambiente.saidaDaMigracao !== "") {
        await writeAtomic(`${paths.logs}/${session.id}.migrate-${cycle}.log`, ambiente.saidaDaMigracao);
      }

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

        /*
         * O que já passou não volta à fila.
         *
         * O verificador é sem memória, e é o que o torna independente. Mas
         * reperguntar sobre um código que ninguém tocou não é independência: é
         * pagar por um sorteio. Medido em P01 do `assitencia`: três ciclos, seis
         * tasks diferentes, nunca mais de duas por vez, todas fechadas — e duas
         * novas em cada volta, entre as que ele mesmo havia aprovado.
         */
        const tasksDestaFase = tasksDaFase(session.markdown);
        const jaAprovadas = options.aprovadas?.jaAprovadas(session.id, tasksDestaFase) ?? [];
        const indicesAprovados = new Set(jaAprovadas.map((task) => task.index));
        if (jaAprovadas.length > 0) {
          announce(
            `[${session.id}] ${jaAprovadas.length} de ${session.taskCount} task(s) já verificadas com este texto; ` +
              "não vou reperguntar sobre elas",
          );
        }

        const verification = await chamarLeitor({
          role: "verifier",
          phase: session,
          attempt: cycle,
          prompt: verifyPrompt({
            language: options.language,
            phaseMarkdown: session.markdown,
            taskCount: session.taskCount,
            featureTests: nomeados,
            ...(jaAprovadas.length > 0
              ? { tasksJaAprovadas: jaAprovadas.map((task) => ({ index: task.index, title: task.title })) }
              : {}),
          }),
        });
        await writeAtomic(`${paths.logs}/${session.id}.verify-${cycle}.log`, verification.stdout);

        const g3 = gate3(verification.stdout, session.taskCount, indicesAprovados);
        /*
         * Desconsiderar não pode ser calado: o texto fica no log da verificação e
         * a linha sai na tela. Se o veredito velho estiver errado, é aqui que o
         * desenvolvedor vê o rastro.
         */
        for (const reaberta of g3.reabertas) {
          announce(`[${session.id}] TASK ${reaberta.index} já estava aprovada e foi reaberta pelo verificador: ${reaberta.missing}`);
        }
        /*
         * A reaberta sai do registro: no ciclo seguinte ela volta a ser verificada,
         * em vez de aparecer na lista do que o verificador não precisa olhar.
         */
        if (g3.reabertas.length > 0) {
          await options.aprovadas?.revogar(session.id, tasksDestaFase, g3.reabertas.map((task) => task.index));
        }
        if (g3.done.length > 0) await options.aprovadas?.aprovar(session.id, tasksDestaFase, g3.done, cycle, now);
        gate("G3", g3.green ? "verde" : "vermelho", cycle);
        if (!g3.green) {
          lastGate = g3.gate;
          lastCause = `${noChangeNote}${g3.cause}`;
        } else if (!(await passouNosFluxos(cycle, contestacaoDoRoteiro))) {
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
  } catch (erro) {
    if (erro instanceof LimiteEsgotado) return { status: "rate-limit-exhausted", waits };
    if (!(erro instanceof CredencialRecusada)) throw erro;

    /*
     * Pára aqui, diz o que fazer, e não culpa a fase.
     *
     * O trabalho que a fase já fez fica na árvore e é bom — nenhum gate o
     * reprovou por mérito. O caminho de volta é renovar a credencial e commitar
     * o parcial, porque o preflight da próxima execução exige árvore limpa e o
     * loop revalida a fase a partir do que estiver commitado.
     */
    await event("blocked", `credencial recusada pelo provider ${options.engine}: ${erro.evidencia}`, cicloCorrente);
    relatar({ kind: "phase", id: session.id, state: "falhou", cycle: cicloCorrente, detail: "credencial recusada" });
    announce(`[${session.id}] o provider ${options.engine} recusou a credencial — isto não é defeito da fase:`);
    announce(`           ${erro.evidencia}`);
    announce(`           renove com \`${options.engine} login\` e rode \`capivara build\` de novo`);
    if (await hasPendingChanges(options.projectRoot)) {
      announce("           o trabalho desta fase ficou na árvore; antes de rodar de novo:");
      announce("           git add -A && git commit -m \"wip: trabalho parcial\"   → o loop revalida a fase e segue");
    }
    return { status: "credential-rejected", engine: options.engine, evidence: erro.evidencia, cycles: cicloCorrente };
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

/**
 * O caso que o critério não decidia, e a leitura que o build seguiu.
 *
 * Decisão do desenvolvedor: nesta versão o build não para para perguntar — segue
 * com a leitura que a triagem recomendou e deixa o caso escrito onde ele o
 * encontra. `.capivara/` fica fora do gate 1, do preflight e do commit da fase:
 * o arquivo não passa por trabalho do executor nem suja a árvore.
 */
async function registrarDecisaoDoBuild(projectRoot: string, fase: string, ciclo: number, triagem: Triagem): Promise<void> {
  const arquivo = join(projectRoot, ".capivara", "decisoes-do-build.md");
  const existe = await readFile(arquivo, "utf8").then(() => true).catch(() => false);
  const cabecalho = existe
    ? ""
    : "# Decisões tomadas pelo build\n\nCasos em que o critério da fase não decidia, e a leitura que o build seguiu. " +
      "Revise: uma leitura errada se corrige com `capivara change`.\n\n";
  await appendFile(
    arquivo,
    `${cabecalho}## ${fase} · ciclo ${ciclo}\n\n` +
      `- critério: ${triagem.criterio || "—"}\n` +
      `- evidência: ${triagem.evidencia || "—"}\n` +
      `- leitura seguida: ${triagem.correcao}\n\n`,
    "utf8",
  );
}

