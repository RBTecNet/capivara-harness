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
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { declarouRoteiroErrado, extractFlowScript, fixPrompt, flowPrompt, implementPrompt, triagePrompt, verifierRepairPrompt, verifyPrompt, type Triagem } from "../prompts/index.js";
import type { BuildProgressListener, LoopGate, LoopGateState } from "./progress.js";
import type { Bloqueio } from "./admissao.js";
import { fotografarRefs, publicacaoProvavel, refsMovidas } from "./autoridade.js";
import { commitPhase, hasPendingChanges, treeSignature } from "./git.js";
import { declaredComplete, defaultTestRunner, gate0, gate1, gate2, gate3, type GateName, type TestRunner } from "./gates.js";
import { detectCredentialRejection, detectRateLimit, planWait } from "./ratelimit.js";
import { checkFlowScript, FLOWS_DIR, flowScriptName, gate4, type FlowRunner } from "./flows.js";
import { TasksAprovadas, tasksDaFase } from "./veredictos.js";
import { prepararAmbiente } from "./ambiente.js";
import { comBancosDeTeste } from "./test-databases.js";
import { sharedContractFromSkeleton } from "../prompts/acceptance-policy.js";
import { portaLivre } from "./ports.js";
import { faltaOPacoteDoRunner } from "./dependencias.js";
import { MEMORIAS_DIR, recolherMemorias, type MemoriaParaRegistrar } from "../mcp/index.js";
import { sha12 } from "../contract/index.js";
import type { SkeletonWorkflow } from "../contract/index.js";
import type { PhaseSession } from "./split.js";
import { resolveE2eCommand, type TestCommand } from "./testcmd.js";
import { falhaDeInstalacaoNode, inspecionarInstalacaoNode, registrarInstalacaoNode } from "./instalacao-node.js";
import { comandoDeInstalacao } from "./worktree.js";
import { parseVerification, testRepairGuidancePrompt, verifyRetryPrompt } from "../prompts/verifier.js";
import { FLOW_REVIEWS, type FlowReviewPurpose } from "../provider/flow-review.js";
import type { FatiaDaArquitetura } from "./arquitetura.js";

/** Janela limitada para um defeito novo que só apareceu na integração. */
export interface IntegrationFailure {
  cause: string;
  attempt: number;
  repairByVerifier: boolean;
  repairBudget: { used: number };
}

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
  providerFailure?: "quota" | "configuration";
  /** O que a sessão recusou por permissão: só ferramenta e programa, nunca argumentos (§106). */
  negacoes?: string[];
}

export interface EngineCall {
  role: "builder" | "verifier";
  purpose?: FlowReviewPurpose;
  /** Sessão separada de reparo. Apenas o verificador recebe escrita nesta chamada. */
  repair?: boolean;
  phase: PhaseSession;
  attempt: number;
  prompt: string;
  /**
   * Onde a sessão trabalha, quando não é a raiz do projeto: o worktree da fase
   * no build paralelo. O verificador lê a MESMA árvore que o executor escreveu.
   */
  root?: string;
  /** Qual agente do pool atende, a partir de 0. Ausente é o builder de sempre. */
  worker?: number;
  /** Variáveis de recursos privados desta chamada; nunca process.env global. */
  environment?: Record<string, string>;
}

export type EngineCaller = (call: EngineCall) => Promise<EngineResult>;

export interface PhaseRunOptions {
  projectRoot: string;
  /**
   * Onde o agente trabalha e os gates rodam, quando não é a raiz do projeto.
   *
   * É o worktree da fase no build paralelo (§97). O estado do run — eventos,
   * prompts, logs, decisões — continua na raiz: é lá que a retomada e quem
   * investiga procuram. Ausente é a raiz, que é o build serial de sempre.
   */
  workRoot?: string;
  /**
   * Fase verde num worktree ainda não está no produto: falta integrar.
   *
   * Com isto, o evento de conclusão não é gravado aqui — quem o grava é o
   * integrador, depois de a fase entrar na árvore principal. Uma queda entre os
   * dois faria a retomada pular uma fase que nunca chegou ao produto.
   */
  integracaoPendente?: boolean;
  integrationFailure?: IntegrationFailure;
  /** O agente do pool que roda esta fase; vai em cada chamada, para o CLI escolher o modelo. */
  worker?: number;
  runId: string;
  language: string;
  engine: string;
  session: PhaseSession;
  /**
   * A fatia da arquitetura aprovada para esta fase (§125), já conferida contra o
   * documento publicado. Vai ao executor, ao verificador e ao reparo; ausente,
   * eles leem `architecture.md` inteiro, como o preâmbulo manda.
   */
  architecture?: FatiaDaArquitetura;
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
  /** No paralelo, a conferência usa a mesma fila exclusiva do integrador. */
  conferirPrincipal?: () => Promise<string[]>;
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
    preferredPort?: number;
  };
  testRunner?: TestRunner;
  /** Sondas de prontidão já passaram no início do build; só materializar dependências novas. */
  environmentApproved?: boolean;
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
  /** Reparos assistidos pelo verificador. Só habilitar quando o provider tem ferramentas de escrita. */
  maxVerifierRepairs?: number;
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
  | { status: "credential-rejected"; engine: string; evidence: string; cycles: number }
  /**
   * Os gates fecharam, mas o commit da fase levaria arquivo sensível (§100).
   *
   * Não é "completa sem commit": a fase não entrou no histórico, e no paralelo
   * "completa" seria integrar nada e apagar o worktree. O trabalho fica onde
   * está; a retomada revalida a fase depois de o arquivo ser ignorado.
   */
  | { status: "commit-blocked"; bloqueios: Bloqueio[]; cause: string; cycles: number };

export const DEFAULT_MAX_CYCLES = 3;
export const DEFAULT_MAX_LIMIT_WAITS = 20;

export async function runPhase(options: PhaseRunOptions): Promise<PhaseOutcome> {
  const maxCycles = options.integrationFailure ? 1 : options.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxVerifierRepairs = options.maxVerifierRepairs ?? 0;
  if (!Number.isInteger(maxVerifierRepairs) || maxVerifierRepairs < 0 || maxVerifierRepairs > 10) {
    throw new Error("maxVerifierRepairs deve ser um inteiro entre 0 e 10");
  }
  const maxLimitWaits = options.maxLimitWaits ?? DEFAULT_MAX_LIMIT_WAITS;
  const announce = options.announce ?? (() => undefined);
  const sleep = options.sleep ?? ((seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)));
  const now = options.now ?? (() => new Date());
  const paths = runPaths(options.projectRoot, options.runId);
  const session = options.session;
  const evidencePrefix = options.integrationFailure ? `${session.id}.integration-${options.integrationFailure.attempt}` : session.id;
  const arvore = options.workRoot ?? options.projectRoot;
  const sharedContract = sharedContractFromSkeleton(await readFile(join(arvore, ".capivara/init/skeleton.md"), "utf8").catch(() => ""));
  const noWorktree = arvore !== options.projectRoot;
  /*
   * Só o Core registra no Git (§101). As referências são fotografadas antes e
   * depois de TODA chamada de agente; referência movida é violação, e a fase
   * para sem registrar nada. No worktree, o integrador e os outros agentes
   * movem branches e a principal no meio da chamada — ali o que se confere é o
   * HEAD deste worktree (que cobre o branch da fase), tags e rastreio remoto.
   */
  const refsDeOutros = noWorktree ? ["refs/heads/", "refs/stash"] : [];
  class AutoridadeViolada extends Error {
    constructor(
      readonly movidas: string[],
      readonly papel: string,
    ) {
      super(movidas.join(", "));
    }
  }
  class PrincipalAlterada extends Error {
    constructor(readonly caminhos: string[]) { super(caminhos.join(", ")); }
  }
  const conferirPrincipal = async (): Promise<void> => {
    const caminhos = await options.conferirPrincipal?.() ?? [];
    if (caminhos.length > 0) throw new PrincipalAlterada(caminhos);
  };
  /** Toda chamada desta fase leva a árvore e o agente: quem atende precisa dos dois. */
  const chamar: EngineCaller = async (chamada) => {
    await conferirPrincipal();
    const antes = await fotografarRefs(arvore, refsDeOutros);
    let resposta: EngineResult;
    try {
      resposta = await options.call({
        ...chamada,
        environment: { ...chamada.environment, E2E_PORT: String(await portaLivre(0)) },
        ...(noWorktree ? { root: arvore } : {}),
        ...(options.worker !== undefined ? { worker: options.worker } : {}),
      });
    } finally {
      await conferirPrincipal();
    }
    const movidas = refsMovidas(antes, await fotografarRefs(arvore, refsDeOutros));
    if (movidas.length > 0) throw new AutoridadeViolada(movidas, chamada.role === "builder" ? "executor" : "verificador");
    return resposta;
  };
  /** A conclusão vai ao log do run só quando a fase já está no produto. */
  const concluir = async (detalhe: string, cycle: number): Promise<void> => {
    if (options.integracaoPendente === true) await event("started", `verde no worktree, aguardando integração: ${detalhe}`, cycle);
    else await event("complete", detalhe, cycle);
  };

  let waits = 0;
  let lastGate: GateName | null = null;
  let lastCause = "";
  let previousWroteNothing = false;
  let verifierRepairs = options.integrationFailure?.repairBudget.used ?? 0;
  let lastRepairGuidance = "";
  let integrationGuidance = "";
  // Um reparo pode atingir qualquer task. Depois dele nenhum DONE antigo substitui
  // a leitura independente do estado atual, mesmo se a chamada terminou em erro.
  let verificarTudo = false;
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
    const memorias = await recolherMemorias(arvore, `${options.runId} · ${session.id} ciclo ${cycle}`);
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
  class FalhaDeRevisao extends Error {
    constructor(message: string, readonly retryable: boolean) { super(message); }
  }
  const chamarLeitor = async (chamada: Parameters<EngineCaller>[0]): Promise<EngineResult> => {
    for (;;) {
      const resposta = await chamar(chamada);
      const saida = `${resposta.stdout}\n${resposta.stderr}`;
      const recusa = detectCredentialRejection(saida);
      if (recusa !== null) throw new CredencialRecusada(recusa);

      const limite = resposta.timedOut || resposta.providerFailure ? null : detectRateLimit(saida, options.engine);
      if (!limite) return resposta;
      waits += 1;
      if (waits > maxLimitWaits) throw new LimiteEsgotado();
      const plano = planWait(limite);
      announce(`[${session.id}] ${plano.reason}; aguardando ${plano.seconds}s e repetindo a mesma chamada, sem consumir ciclo`);
      await event("retry", `limite de uso: ${plano.reason}`, chamada.attempt);
      await sleep(plano.seconds);
    }
  };

  const chamarRevisao = async (purpose: FlowReviewPurpose, prompt: string, arquivo: string, cycle: number): Promise<string> => {
    const policy = FLOW_REVIEWS[purpose];
    const detail = `${policy.label} · ${arquivo}`;
    const reviewEvent = async (status: "started" | "complete" | "blocked", text: string): Promise<void> => {
      await appendEvent(paths.events, {
        timestamp: new Date().toISOString(), stage: "implement", subject: `${session.id}:${purpose}`,
        attempt: cycle, status, detail: text,
      });
    };
    await writeAtomic(`${paths.prompts}/${arquivo}.txt`, prompt);
    await reviewEvent("started", detail);
    announce(`[${session.id}] ${detail}`);
    try {
      const resposta = await chamarLeitor({ role: "verifier", purpose, phase: session, attempt: cycle, prompt });
      await writeAtomic(`${paths.logs}/${arquivo}.log`, resposta.stdout + (resposta.stderr ? `\n${resposta.stderr}` : ""));
      const g0 = gate0(resposta, options.engine);
      if (!g0.green) throw new FalhaDeRevisao(`${policy.label}: ${g0.cause}\nO produto não foi reprovado por esta sessão; não abrir outro ciclo de construção.`, !resposta.providerFailure);
      await reviewEvent("complete", `${policy.label}: resposta recebida`);
      return resposta.stdout;
    } catch (erro) {
      await reviewEvent("blocked", `${policy.label}: sessão interrompida; parcial preservado`);
      throw erro;
    }
  };

  let preparacoesNode = 0;
  let falhaNaPreparacaoNode = "";
  let runtimeRecusado = false;
  /** Uma instalação de infraestrutura por fase, sem pedir outra implementação. */
  const prepararDependenciasNode = async (cycle: number, evidencia?: string): Promise<boolean> => {
    if (preparacoesNode >= 1) return false;
    let motivo: string;
    if (evidencia !== undefined) {
      if (!(await falhaDeInstalacaoNode(arvore, evidencia))) return false;
      motivo = "G2 identificou dependência declarada ausente ou incompatibilidade do runtime Node";
    } else {
      const instalacao = await inspecionarInstalacaoNode(arvore, options.environmentApproved ? { sondar: false } : {});
      if (instalacao.estado !== "ausente" && instalacao.estado !== "incompativel") return false;
      motivo = instalacao.motivo;
    }
    preparacoesNode += 1;
    const comando = await comandoDeInstalacao(arvore);
    announce(`[${session.id}] preparando dependências do projeto antes de julgar a implementação: ${motivo}`);
    await event("started", `preparação Node ${preparacoesNode}/1: ${motivo}`, cycle);
    const instalacao = await (options.testRunner ?? defaultTestRunner)(comando, arvore).catch((erro: unknown) => ({
      exitCode: 1,
      output: erro instanceof Error ? erro.message : String(erro),
    }));
    await writeAtomic(`${paths.logs}/${evidencePrefix}.dependencies-prepare-${preparacoesNode}.log`, `$ ${comando}\n${instalacao.output}`);
    if (instalacao.exitCode === 0) {
      await registrarInstalacaoNode(arvore);
      announce(`[${session.id}] dependências preparadas para o runtime atual; a suíte ainda precisa passar`);
      return true;
    }
    const resumo = instalacao.output.split(/\r?\n/).slice(-80).join("\n");
    runtimeRecusado = /\bEBADENGINE\b|Unsupported engine/i.test(instalacao.output);
    falhaNaPreparacaoNode =
      `A preparação automática de dependências falhou (código ${instalacao.exitCode}): ${comando}. ` +
      `Corrija a instalação no projeto sem substituir testes ou afrouxar critérios. ` +
      `Saída (últimas 80 linhas; log completo: ${evidencePrefix}.dependencies-prepare-${preparacoesNode}.log):\n${resumo}`;
    announce(`[${session.id}] a preparação de dependências falhou; diagnóstico preservado para o executor e o reparo assistido`);
    return false;
  };

  let cicloCorrente = 1;
  const rascunhosDosFluxos = new Map<string, string>();
  const causasDosRoteiros = new Map<string, string>();
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
    if (cycle === 1 && !options.environmentApproved) await prepararDependenciasNode(cycle);
    if (runtimeRecusado) {
      const cause = `O ambiente Node/npm foi recusado por engines. Reinicie a Capivara com uma versão compatível com o projeto; nenhuma sessão de construção foi iniciada.\n${falhaNaPreparacaoNode}`;
      gate("G0", "neutro", cycle);
      gate("G2", "vermelho", cycle);
      await event("blocked", cause, cycle);
      relatar({ kind: "phase", id: session.id, state: "falhou", cycle, detail: cause });
      return { status: "failed", gate: "gate 2 — suíte do projeto", cause, cycles: cycle - 1 };
    }

    /*
     * O runner de fluxos, dito ANTES de a sessão começar.
     *
     * O harness já sabia no preflight, e contava de novo só quando o gate 4
     * reprovava — meia hora de sessão para descobrir uma ausência anotada antes
     * da primeira chamada. Só é dito na fase que tem fluxo: avisar quem não vai
     * ser percorrido no navegador é ruído.
     */
    const precisaDoRunner =
      cycle === 1 && (options.flows?.workflows.length ?? 0) > 0 && (await faltaOPacoteDoRunner(arvore));

    const temFluxos = (options.flows?.workflows.length ?? 0) + (options.flows?.regressao?.length ?? 0) > 0;
    const context = {
      language: options.language,
      sharedContract,
      ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}),
      testCommand: (options.integrationFailure ? (await options.resolveTest?.())?.command : null) ?? options.testCommand?.command ?? null,
      containerized: options.testCommand?.containerized ?? false,
      ...(await resolveE2eCommand(arvore).then((comando) => (comando ? { e2eCommand: comando } : {}))),
      phaseMarkdown: session.markdown,
      ...(precisaDoRunner ? { runnerDeFluxosAusente: true } : {}),
      ...(temFluxos ? { temFluxos: true } : {}),
      ...(temFluxos && (await options.flows?.resolveStart()) === null ? { entrypointAusente: true } : {}),
      ...(options.skills !== undefined && options.skills !== "" ? { skills: options.skills } : {}),
      ...(options.onMemorias ? { memoriasDir: MEMORIAS_DIR } : {}),
    };

    const promptBase =
      cycle === 1
        ? implementPrompt(context)
        : fixPrompt({
            ...context,
            gate: lastGate ?? "gate 0 — engine",
            cause: lastCause + (lastRepairGuidance ? `\n\nRelatório do último reparo assistido pelo verificador (confira os gates; o relatório não é aprovação):\n${lastRepairGuidance}` : ""),
            previousWroteNothing,
          });
    let prompt = promptBase;

    let diagnosis: EngineResult | null = null;
    const recovery = options.integrationFailure;
    const repairingIntegration = recovery?.repairByVerifier === true;
    if (recovery) {
      const guidancePrompt = testRepairGuidancePrompt({ language: options.language, sharedContract, ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}), phaseMarkdown: session.markdown, cause: recovery.cause, testCommand: context.testCommand });
      await writeAtomic(`${paths.prompts}/${evidencePrefix}.guidance.txt`, guidancePrompt);
      announce(`[${session.id}] validador diagnosticando a falha de integração; devolverá evidência, ação concreta e comando de regressão`);
      diagnosis = await chamarLeitor({ role: "verifier", phase: session, attempt: cycle, prompt: guidancePrompt });
      await writeAtomic(`${paths.logs}/${evidencePrefix}.guidance.log`, `${diagnosis.stdout}\n${diagnosis.stderr}`);
      integrationGuidance = diagnosis.stdout;
      const cause = `${recovery.cause}\n\nOrientação do validador para esta falha (não é aprovação):\n${diagnosis.stdout}`;
      lastCause = cause;
      lastGate = "gate 2 — suíte do projeto";
      prompt = repairingIntegration
        ? verifierRepairPrompt({ language: options.language, sharedContract, ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}), phaseMarkdown: session.markdown, cause, testCommand: context.testCommand, systemInstall: options.systemInstall === true, ...(context.e2eCommand ? { e2eCommand: context.e2eCommand } : {}) })
        : fixPrompt({ ...context, gate: "gate 2 — suíte do projeto", cause, previousWroteNothing: false });
    }
    if (falhaNaPreparacaoNode) prompt += `\n\n## Dependency preparation — unresolved environment failure\n${falhaNaPreparacaoNode}`;

    await writeAtomic(`${paths.prompts}/${evidencePrefix}.cycle-${cycle}.txt`, prompt);

    const signatureBefore = await treeSignature(arvore);
    let result: EngineResult;
    if (diagnosis && !gate0(diagnosis, options.engine).green) result = diagnosis;
    else if (repairingIntegration) {
      if (verifierRepairs >= maxVerifierRepairs) throw new Error("o orçamento de reparo da integração foi esgotado");
      verifierRepairs += 1;
      recovery!.repairBudget.used = verifierRepairs;
      verificarTudo = true;
      const tasks = tasksDaFase(session.markdown);
      await options.aprovadas?.revogar(session.id, tasks, tasks.map(task => task.index));
      announce(`[${session.id}] a devolução ao executor não resolveu a integração; o validador executará a correção (${verifierRepairs}/${maxVerifierRepairs})`);
      result = await chamarLeitor({ role: "verifier", repair: true, phase: session, attempt: cycle, prompt });
    } else result = await chamar({ role: "builder", phase: session, attempt: cycle, prompt });
    await writeAtomic(`${paths.logs}/${evidencePrefix}.cycle-${cycle}.log`, `${result.stdout}\n${result.stderr}`);

    const recusa = detectCredentialRejection(`${result.stdout}\n${result.stderr}`);
    if (recusa !== null) throw new CredencialRecusada(recusa);
    /*
     * A negação de permissão é diagnóstico, não parada (§108): a fase segue para
     * os gates, que julgam o que ficou. O §106 parava aqui quando a sessão não
     * concluía; com o executor liberado, uma negação não diz mais que o ambiente
     * impede a fase.
     */
    const negacoes = result.negacoes ?? [];
    if (negacoes.length > 0) {
      const lista = negacoes.slice(0, 6).join(", ") + (negacoes.length > 6 ? ` e mais ${negacoes.length - 6}` : "");
      announce(`[${session.id}] a sessão do executor teve comando(s) negado(s) por permissão: ${lista} — registrado, a fase segue para os gates`);
    }

    // Limite de uso não é defeito da implementação: espera e repete a MESMA
    // fase, sem consumir ciclo de correção.
    const limit = result.timedOut || result.providerFailure ? null : detectRateLimit(`${result.stdout}\n${result.stderr}`, options.engine);
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
    let testeAgora = options.resolveTest ? await options.resolveTest() : options.testCommand;
    if (testeAgora && testeAgora.command !== options.testCommand?.command) {
      announce(`[${session.id}] comando de teste detectado: ${testeAgora.command} (${testeAgora.source})`);
    }

    const wrote = gate1(signatureBefore, await treeSignature(arvore));
    previousWroteNothing = !wrote;
    if (!wrote) announce(`[${session.id}] a sessão não escreveu nada; validando o código existente`);

    let noChangeNote = wrote ? "" : "A sessão anterior terminou sem alterar nenhum arquivo. ";

    /*
     * G4 — a aplicação faz o que foi pedido.
     *
     * Só roda depois do G3 verde, e por isso não encarece a fase que ainda está
     * errada: abrir o produto para percorrer um fluxo que o código nem tem
     * gastaria uma sessão e um navegador para descobrir o que o gate 3 já sabia.
     */
    let reparoDeFluxo = false;
    let falhaDoRoteiro = false;
    let falhaDeSessao = Boolean(result.timedOut || result.providerFailure);
    const passouNosFluxos = async (cycleAtual: number, contestacao?: string, rejeitados?: readonly string[]): Promise<boolean> => {
      reparoDeFluxo = false;
      const fluxos = options.flows;
      if (!fluxos) return true;
      const passagem = verifierRepairs > 0 ? `${cycleAtual}-after-repair-${verifierRepairs}` : `${cycleAtual}`;
      const avancar = async (cause: string, roteiros?: readonly string[]): Promise<boolean> => {
        await event("retry", `correção do roteiro G4 no próximo ciclo, preservando produto e G2/G3 aprovados: ${cause}`, cycleAtual);
        cycle = cycleAtual + 1;
        cicloCorrente = cycle;
        announce(`[${session.id}] ciclo de correção ${cycle}/${maxCycles}: corrigindo somente a verificação G4; implementação e G2/G3 preservados`);
        relatar({ kind: "phase", id: session.id, state: "em andamento", cycle, detail: `ciclo ${cycle}/${maxCycles} · correção do G4` });
        return await passouNosFluxos(cycle, undefined, roteiros);
      };

      gate("G4", "corrente", cycleAtual);
      let g4: Awaited<ReturnType<typeof gate4>>;
      try {
        g4 = await gate4({
          projectRoot: arvore,
          workflows: fluxos.workflows,
          ...(contestacao ? { roteiroContestado: contestacao, roteirosQueFalharam: fluxosQueFalharamPorUltimo } : {}),
          ...(fluxos.regressao ? { regressao: fluxos.regressao } : {}),
          ...(rejeitados ? { rejectedScripts: rejeitados } : {}),
          startCommand: await fluxos.resolveStart(),
          author: async (workflow, rejected, baseUrl, contextoDaPassagem) => {
            const priorCause = causasDosRoteiros.get(workflow.number);
            const previousScript = rascunhosDosFluxos.get(workflow.number) ?? (rejected.length > 0 || priorCause
              ? await readFile(join(arvore, FLOWS_DIR, flowScriptName(workflow.number)), "utf8").catch(() => undefined)
              : undefined);
            const prompt = flowPrompt({
              language: options.language,
              workflow: { number: workflow.number, name: workflow.name, steps: workflow.steps },
              baseUrl,
              sharedContract,
              phaseMarkdown: session.markdown,
              ...((rejected.length > 0 || priorCause) ? { rejected: [...rejected, ...(priorCause ? [priorCause] : [])] } : {}),
              ...(previousScript ? { previousScript } : {}),
              passagem: contextoDaPassagem,
            });
            const arquivo = `${evidencePrefix}.flow-${workflow.number}-${passagem}-${randomUUID()}`;
            const response = await chamarRevisao("flow-author", prompt, arquivo, cycleAtual);
            const draft = extractFlowScript(response);
            // Um roteiro publicável será lido do disco na próxima correção,
            // incluindo patches que o Core aplicar depois desta resposta.
            if (draft && checkFlowScript(draft, workflow).length > 0) rascunhosDosFluxos.set(workflow.number, draft);
            else rascunhosDosFluxos.delete(workflow.number);
            return response;
          },
          /*
           * A triagem é um leitor independente, como o verificador e o roteirista:
           * só lê, e passa pela mesma proteção contra credencial e limite de uso.
           */
          triagem: async (entrada) => {
            triagensNoCiclo += 1;
            return await chamarRevisao("flow-triage", triagePrompt({
                language: options.language,
                phaseMarkdown: session.markdown,
                sharedContract,
                workflow: { number: entrada.workflow.number, name: entrada.workflow.name, steps: entrada.workflow.steps },
                script: entrada.script,
                failure: entrada.failure,
                snapshot: entrada.snapshot,
                serverErrors: entrada.serverErrors,
              }), `${evidencePrefix}.triagem-${passagem}-${triagensNoCiclo}`, cycleAtual);
          },
          ...(fluxos.runner !== undefined ? { runner: fluxos.runner } : {}),
          ...(fluxos.port !== undefined ? { port: fluxos.port } : {}),
          ...(fluxos.preferredPort !== undefined ? { preferredPort: fluxos.preferredPort } : {}),
          announce: (message) => announce(`[${session.id}] ${message}`),
        });
      } catch (erro) {
        if (erro instanceof FalhaDeRevisao && erro.retryable && cycleAtual < maxCycles) return await avancar(erro.message, rejeitados);
        throw erro;
      }
      reparoDeFluxo = !g4.green && g4.triagem?.tipo === "PRODUTO";
      falhaDoRoteiro = !g4.green && (g4.scriptFailed === true || g4.triagem?.tipo === "ROTEIRO");
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
      const evidencia = g4.output || (!g4.green ? g4.cause : "");
      if (evidencia !== "") {
        await writeAtomic(`${paths.logs}/${evidencePrefix}.flow-run-${passagem}.log`, evidencia);
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
      lastCause = g4.toolMissing === true || falhaDoRoteiro ? g4.cause : `${noChangeNote}${g4.cause}`;
      if (g4.toolMissing === true) {
        announce(`[${session.id}] o runner de fluxos não está instalado; o executor vai instalá-lo no projeto`);
      } else if (g4.startupFailed === true) {
        // Dito na tela também: quem olha o log precisa saber que o produto não
        // subiu, e não que um fluxo reprovou.
        announce(`[${session.id}] gate 4: a aplicação não subiu; nenhum fluxo foi percorrido`);
      } else if (g4.scriptFailed === true) {
        announce(`[${session.id}] gate 4: o roteiro falhou por si mesmo, não o produto — defeito do harness`);
      }
      if (falhaDoRoteiro && cycleAtual < maxCycles) {
        const reprovados = fluxosQueFalharamPorUltimo.length > 0 ? fluxosQueFalharamPorUltimo
          : [...new Set([...(fluxos.regressao ?? []), ...fluxos.workflows].map(workflow => workflow.number))];
        for (const number of reprovados) causasDosRoteiros.set(number, g4.cause);
        return await avancar(g4.cause, reprovados);
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
                const conteudo = await readFile(join(arvore, FLOWS_DIR, flowScriptName(numero)), "utf8").catch(() => "");
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

    /**
     * Reparar e julgar são sessões diferentes, ainda que usem o mesmo modelo.
     * O orçamento pertence à fase e não renova a cada tentativa do executor.
     * Instalar dependências pode corrigir G2 sem mudar arquivos versionados:
     * quem confirma o reparo são os gates executados novamente, nunca a fala
     * do reparador nem a presença de um diff.
     */
    const repararComVerificador = async (cause: string): Promise<boolean> => {
      if (verifierRepairs >= maxVerifierRepairs) return false;
      verifierRepairs += 1;
      if (options.integrationFailure) options.integrationFailure.repairBudget.used = verifierRepairs;
      verificarTudo = true;
      const tasks = tasksDaFase(session.markdown);
      await options.aprovadas?.revogar(session.id, tasks, tasks.map((task) => task.index));
      const repairPrompt = verifierRepairPrompt({
        language: options.language,
        sharedContract,
        ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}),
        phaseMarkdown: session.markdown,
        cause: integrationGuidance ? `${cause}\n\nOrientação do validador já levantada para a integração:\n${integrationGuidance}` : cause,
        testCommand: testeAgora?.command ?? null,
        ...(context.e2eCommand ? { e2eCommand: context.e2eCommand } : {}),
        systemInstall: options.systemInstall === true,
      });
      const nome = `${evidencePrefix}.repair-${verifierRepairs}-cycle-${cycle}`;
      await writeAtomic(`${paths.prompts}/${nome}.txt`, repairPrompt);
      announce(`[${session.id}] verificador corrigindo a falha (${verifierRepairs}/${maxVerifierRepairs}); os gates serão executados novamente por sessões independentes`);
      await event("retry", `reparo ${verifierRepairs}/${maxVerifierRepairs} pelo verificador: ${cause.split("\n")[0] ?? ""}`, cycle);
      gate("G0", "corrente", cycle);
      const repairSignatureBefore = await treeSignature(arvore);
      const repair = await chamarLeitor({ role: "verifier", repair: true, phase: session, attempt: cycle, prompt: repairPrompt });
      lastRepairGuidance = `${repair.stdout}\n${repair.stderr}`.trim();
      await writeAtomic(`${paths.logs}/${nome}.log`, `${repair.stdout}\n${repair.stderr}`);
      const repairWrote = gate1(repairSignatureBefore, await treeSignature(arvore));
      gate("G1", repairWrote ? "verde" : "neutro", cycle);
      if (repairWrote) {
        previousWroteNothing = false;
        noChangeNote = "";
      }
      const reparoTerminou = gate0(repair, options.engine);
      gate("G0", reparoTerminou.green ? "verde" : "vermelho", cycle);
      if (!reparoTerminou.green) {
        // O trabalho parcial fica na árvore. A correção seguinte recebe o
        // diagnóstico original e o erro desta tentativa, sem afirmar sucesso.
        lastCause = `${cause}\n\nO reparo assistido pelo verificador não concluiu: ${reparoTerminou.cause}`;
        falhaDeSessao ||= Boolean(repair.timedOut || repair.providerFailure);
        announce(`[${session.id}] reparo do verificador não concluiu; o trabalho foi preservado para o executor`);
        return false;
      }
      if (options.resolveTest) testeAgora = await options.resolveTest();
      return true;
    };

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
      for (;;) {
        /*
         * Antes de qualquer gate rodar o produto: configuração e esquema.
         *
         * Aqui e não no preflight porque quem entrega o `.env.example` e a
         * migração é o executor, e ele os entrega no meio da fase. A cada ciclo
         * porque cada fase acrescenta tabela.
         */
        const passagem = verifierRepairs > 0 ? `${cycle}-after-repair-${verifierRepairs}` : `${cycle}`;
        const g2 = await comBancosDeTeste(arvore, options.testRunner ?? defaultTestRunner, async testar => {
          const ambiente = await prepararAmbiente(arvore, testar);
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
            await writeAtomic(`${paths.logs}/${evidencePrefix}.migrate-${passagem}.log`, ambiente.saidaDaMigracao);
          }

          if (await prepararDependenciasNode(cycle)) {
            if (options.resolveTest) testeAgora = await options.resolveTest();
          }
          gate("G2", "corrente", cycle);
          return gate2(arvore, testeAgora?.command ?? null, testar, options.systemInstall === true);
        });
        gate("G2", g2.green ? "verde" : "vermelho", cycle);
        if (!g2.green) {
          if (await prepararDependenciasNode(cycle, g2.cause)) {
            if (options.resolveTest) testeAgora = await options.resolveTest();
            continue;
          }
          lastGate = g2.gate;
          // Ferramenta ausente não ganha o prefixo de "não escreveu nada": a sessão
          // corretamente não mexeu no código, porque o defeito é de ambiente.
          lastCause = (g2.toolMissing === true ? g2.cause : `${noChangeNote}${g2.cause}`) +
            (falhaNaPreparacaoNode ? `\n\n${falhaNaPreparacaoNode}` : "");
          if (g2.toolMissing === true) {
            announce(
              `[${session.id}] o runner de testes não está instalado; ` +
                (options.systemInstall === true
                  ? "o executor tem acesso de sistema para instalá-lo"
                  : "o executor vai instalá-lo como dependência do projeto"),
            );
          }
          if (await repararComVerificador(lastCause)) continue;
          break;
        } else {
          if (!g2.skipped) {
            await registrarInstalacaoNode(arvore);
            falhaNaPreparacaoNode = "";
          }
          if (g2.skipped) announce(`[${session.id}] gate 2 pulado: nenhum comando de teste resolvido`);
          gate("G3", "corrente", cycle);
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
          const jaAprovadas = verificarTudo ? [] : options.aprovadas?.jaAprovadas(session.id, tasksDestaFase, options.architecture?.sha12) ?? [];
          const indicesAprovados = new Set(jaAprovadas.map((task) => task.index));
          if (jaAprovadas.length > 0) {
            announce(
              `[${session.id}] ${jaAprovadas.length} de ${session.taskCount} task(s) já verificadas com este texto; ` +
                "não vou reperguntar sobre elas",
            );
          }

          const verificationPrompt = verifyPrompt({
            language: options.language,
            sharedContract,
            ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}),
            phaseMarkdown: session.markdown,
            taskCount: session.taskCount,
            ...(jaAprovadas.length > 0
              ? { tasksJaAprovadas: jaAprovadas.map((task) => ({ index: task.index, title: task.title })) }
              : {}),
          });
          await writeAtomic(`${paths.prompts}/${evidencePrefix}.verify-${passagem}.txt`, verificationPrompt);
          let verification = await chamarLeitor({
            role: "verifier",
            phase: session,
            attempt: cycle,
            prompt: verificationPrompt,
          });
          await writeAtomic(`${paths.logs}/${evidencePrefix}.verify-${passagem}.log`, `${verification.stdout}\n${verification.stderr}`);
          let g0Verifier = gate0(verification, options.engine);
          let g3 = gate3(verification.stdout, session.taskCount, indicesAprovados);
          const formatPrefix = `${evidencePrefix}.verify-${passagem}.format-1`;
          if (g0Verifier.green && !g3.green && g3.repairable !== true) {
            announce(`[${session.id}] resposta do verificador com protocolo inválido; pedindo uma correção de formato somente-leitura, sem reabrir o executor`);
            const retryPrompt = verifyRetryPrompt(verificationPrompt, verification.stdout, g3.cause);
            await writeAtomic(`${paths.prompts}/${formatPrefix}.txt`, retryPrompt);
            verification = await chamarLeitor({
              role: "verifier",
              phase: session,
              attempt: cycle,
              prompt: retryPrompt,
            });
            await writeAtomic(`${paths.logs}/${formatPrefix}.log`, `${verification.stdout}\n${verification.stderr}`);
            g0Verifier = gate0(verification, options.engine);
            g3 = gate3(verification.stdout, session.taskCount, indicesAprovados);
            if (!g0Verifier.green) falhaDeSessao = true;
          }
          if (!g0Verifier.green) {
            gate("G3", "vermelho", cycle);
            lastGate = g0Verifier.gate;
            lastCause = `A sessão de verificação independente não concluiu: ${g0Verifier.cause}`;
            falhaDeSessao ||= Boolean(verification.timedOut || verification.providerFailure);
            break;
          }

          if (!g3.green && g3.repairable !== true) {
            gate("G3", "vermelho", cycle);
            lastGate = g3.gate;
            lastCause = `O verificador devolveu protocolo inválido após uma recuperação somente-leitura; ` +
              `não é diagnóstico de implementação e não será enviado ao executor como reparo.\n${g3.cause}\n` +
              `Resposta preservada em ${paths.logs}/${formatPrefix}.log`;
            falhaDeSessao = true;
            break;
          }
          // O reparo exige uma leitura completa, não leituras completas para sempre.
          // Só um veredito com cobertura e índices válidos encerra essa obrigação.
          verificarTudo = false;
          for (const verdict of parseVerification(verification.stdout)) {
            if (verdict.done && verdict.missing.startsWith("ADVISORY:")) {
              announce(`[${session.id}] TASK ${verdict.index} — observação não bloqueante: ${verdict.missing.slice("ADVISORY:".length).trim()}`);
            }
          }
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
          if (g3.done.length > 0) await options.aprovadas?.aprovar(session.id, tasksDestaFase, g3.done, cycle, now, options.architecture?.sha12);
          gate("G3", g3.green ? "verde" : "vermelho", cycle);
          if (!g3.green) {
            lastGate = g3.gate;
            lastCause = `${noChangeNote}${g3.cause}`;
            if (g3.repairable === true && await repararComVerificador(lastCause)) continue;
            break;
          } else if (!(await passouNosFluxos(cycle, contestacaoDoRoteiro))) {
            // A causa já foi registrada por `passouNosFluxos`; o ciclo segue.
            if (reparoDeFluxo && await repararComVerificador(lastCause)) continue;
            break;
          } else {
            const commit = options.commitsEnabled
              ? await commitPhase(arvore, session.number, session.title)
              : { committed: false, message: "commits desabilitados: nenhum repositório Git" };

            if (commit.bloqueios && commit.bloqueios.length > 0) {
              await recolher(cycle);
              await event("blocked", `commit bloqueado: ${commit.bloqueios.map((bloqueio) => bloqueio.caminho).join(", ")}`, cycle);
              relatar({ kind: "phase", id: session.id, state: "falhou", cycle, detail: "commit bloqueado" });
              announce(`[${session.id}] gates verdes, mas o commit foi BLOQUEADO — ${commit.message}`);
              return { status: "commit-blocked", bloqueios: commit.bloqueios, cause: commit.message, cycles: cycle };
            }

            if (!commit.committed && commit.message.includes("já estava implementada")) {
              await concluir("já implementada em HEAD", cycle);
              relatar({ kind: "phase", id: session.id, state: "concluído", cycle, detail: "já implementada" });
              announce(`[${session.id}] JÁ IMPLEMENTADA — gates verdes, nada a commitar`);
              return { status: "already-implemented", cycles: cycle };
            }

            await recolher(cycle);
            await concluir(commit.message, cycle);
            relatar({ kind: "phase", id: session.id, state: "concluído", cycle, detail: commit.committed ? "commitada" : "completa" });
            announce(`[${session.id}] COMPLETA${commit.committed ? ` — ${commit.message}` : ""}`);
            return { status: "complete", committed: commit.committed, message: commit.message, cycles: cycle };
          }
        }
      }
    }

    if (falhaDeSessao) {
      announce(`[${session.id}] a sessão não entregou resultado utilizável; parando com o parcial preservado, sem abrir outra chamada de construção automaticamente`);
      break;
    }
    if (falhaDoRoteiro) break;

    if (declaredComplete(result.stdout) && lastGate) {
      // A palavra do executor nunca supera um gate vermelho.
      announce(`[${session.id}] o executor declarou conclusão, mas ${lastGate} reprovou`);
    }
    if (cycle >= maxCycles) break;
    announce(`[${session.id}] nova chamada de construção ${cycle + 1}/${maxCycles}; motivo: ${lastGate}: ${lastCause.split("\n").slice(0, 3).join(" ")}`);
    await event("retry", `${lastGate}: ${lastCause}`, cycle);
    cycle += 1;
  }
  } catch (erro) {
    if (erro instanceof LimiteEsgotado) return { status: "rate-limit-exhausted", waits };
    if (erro instanceof FalhaDeRevisao) {
      await event("blocked", `gate 0 — engine: ${erro.message}`, cicloCorrente);
      relatar({ kind: "phase", id: session.id, state: "falhou", cycle: cicloCorrente, detail: "sessão de revisão G4 interrompida" });
      announce(`[${session.id}] ${erro.message}`);
      return { status: "failed", gate: "gate 0 — engine", cause: erro.message, cycles: cicloCorrente };
    }
    if (erro instanceof PrincipalAlterada) {
      const cause = `a árvore principal mudou durante o trabalho em worktree (${erro.caminhos.join(", ")}). ` +
        `A fase foi interrompida antes de aceitar o resultado do agente. Nada foi apagado, registrado ou integrado. ` +
        `As alterações da principal continuam em ${options.projectRoot}; o trabalho isolado, se houver, será preservado separadamente. ` +
        "Confira as alterações antes de retomar; com agentes concorrentes, esta conferência não determina quem escreveu.";
      await event("blocked", cause, cicloCorrente);
      announce(`[${session.id}] PARADA DE ISOLAMENTO — ${cause}`);
      return { status: "commit-blocked", bloqueios: erro.caminhos.map((caminho) => ({ caminho, motivo: "árvore principal alterada durante trabalho isolado" })), cause, cycles: cicloCorrente };
    }
    if (erro instanceof AutoridadeViolada) {
      /*
       * O agente mexeu no Git por conta própria. Nada desta fase é registrado
       * nem integrado, e nada é desfeito: mover a ref de volta seria reescrever
       * o que a pessoa pode já ter visto — ou publicado.
       */
      const publicou = publicacaoProvavel(erro.movidas);
      const cause =
        `o ${erro.papel} mexeu no Git por conta própria — referências movidas durante a chamada: ${erro.movidas.join(", ")}. ` +
        "Só o Core registra e publica: nada desta fase foi registrado nem integrado, e o que o agente fez não foi desfeito. " +
        `${publicou ? "O rastreio remoto mudou: o agente provavelmente fez push — confira o remoto. " : ""}` +
        "Confira com `git log --all --oneline -10` e `git reflog`, decida o que manter, e rode `capivara build` de novo.";
      await event("blocked", `referências movidas pelo agente: ${erro.movidas.join(", ")}`, cicloCorrente);
      relatar({ kind: "phase", id: session.id, state: "falhou", cycle: cicloCorrente, detail: "git por fora do Core" });
      announce(`[${session.id}] PARADA DE AUTORIDADE — ${cause}`);
      return {
        status: "commit-blocked",
        bloqueios: erro.movidas.map((ref) => ({ caminho: ref, motivo: "referência movida pelo agente durante a chamada" })),
        cause,
        cycles: cicloCorrente,
      };
    }
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
    // No worktree, quem guarda o parcial é o build paralelo, num branch da fase.
    if (!noWorktree && (await hasPendingChanges(options.projectRoot))) {
      announce("           o trabalho desta fase ficou na árvore; antes de rodar de novo:");
      announce("           git add -A && git commit -m \"wip: trabalho parcial\"   → o loop revalida a fase e segue");
    }
    return { status: "credential-rejected", engine: options.engine, evidence: erro.evidencia, cycles: cicloCorrente };
  }

  await recolher(cicloCorrente);
  await event("blocked", `${lastGate ?? "desconhecido"}: ${lastCause.split("\n")[0] ?? ""}`, cicloCorrente);
  relatar({ kind: "phase", id: session.id, state: "falhou", cycle: cicloCorrente, detail: lastGate ?? "sem gate" });

  /*
   * A fase parou deixando trabalho na árvore, e o preflight da próxima execução
   * exige árvore limpa. Sem dizer isto aqui, o operador cai num beco: o loop
   * para por causa do trabalho parcial e depois se recusa a retomar por causa do
   * mesmo trabalho parcial.
   */
  if (!noWorktree && (await hasPendingChanges(options.projectRoot))) {
    announce(`[${session.id}] o trabalho parcial desta fase ficou na árvore. Antes de rodar de novo, escolha uma:`);
    announce("           git add -A && git commit -m \"wip: trabalho parcial\"   → o loop revalida a fase e segue");
    announce("           git checkout -- . && git clean -fd                      → descarta e a fase recomeça do zero");
  }

  return { status: "failed", gate: lastGate ?? "gate 0 — engine", cause: lastCause, cycles: cicloCorrente };
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

