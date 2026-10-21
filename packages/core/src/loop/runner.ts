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
import { join, relative } from "node:path";
import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { conflictPrompt, declarouRoteiroErrado, extractFlowScript, fixPrompt, flowPrompt, implementPrompt, triagePrompt, verifierRepairPrompt, verifyPrompt, type Triagem } from "../prompts/index.js";
import type { BuildProgressListener, LoopGate, LoopGateState } from "./progress.js";
import { alteracoesParaCommit, type Bloqueio } from "./admissao.js";
import { fotografarRefs, publicacaoProvavel, refsMovidas } from "./autoridade.js";
import { arquivosDasFases, arquivosMudados, comMarcadorDeConflito, commitPhase, estadoDoCodigo, existiamNaArvore, hasPendingChanges, restaurarDoEstado } from "./git.js";
import { declaredComplete, defaultTestRunner, gate0, gate2, gate3, type GateName, type GateResult, type TestRunner } from "./gates.js";
import { detectCredentialRejection, detectRateLimit, planWait } from "./ratelimit.js";
import { checkFlowScript, FLOW_MARK, FLOWS_DIR, flowScriptName, gate4, type FlowRunner } from "./flows.js";
import { shaDaTask, TasksAprovadas, tasksDaFase } from "./veredictos.js";
import { prepararAmbiente } from "./ambiente.js";
import { comBancosDeTeste } from "./test-databases.js";
import { sharedContractFromSkeleton } from "../prompts/acceptance-policy.js";
import { portaLivre } from "./ports.js";
import { faltaOPacoteDoRunner } from "./dependencias.js";
import { MEMORIAS_DIR, recolherMemorias, type MemoriaParaRegistrar } from "../mcp/index.js";
import { DOCUMENTOS_DA_ETAPA, ENVIRONMENT_CONTRACT, phaseReferences, sha12 } from "../contract/index.js";
import type { SkeletonWorkflow, TaskBlock } from "../contract/index.js";
import type { PhaseSession } from "./split.js";
import { resolveE2eCommand, type TestCommand } from "./testcmd.js";
import { falhaDeInstalacaoNode, inspecionarInstalacaoNode, MARCA_DE_INSTALACAO_NODE, registrarInstalacaoNode, runtimeNode } from "./instalacao-node.js";
import { comandoDeInstalacao, type ConciliacaoDaIntegracao } from "./worktree.js";
import { parseVerification, testRepairGuidancePrompt, verifyRetryPrompt } from "../prompts/verifier.js";
import { FLOW_REVIEWS, type FlowReviewPurpose } from "../provider/flow-review.js";
import type { FatiaDaArquitetura, TerritorioDoFluxo } from "./arquitetura.js";
import { emptyScope, LivroDeEvidencias, referenciaDeArtefato, type ArtifactRef, type EvidenceInputs } from "./evidencias.js";
import {
  assinaturaDaFalha,
  citacoes,
  defeitoCitado,
  orcamentoEfetivo,
  RegistroDeDefeitos,
  severidadeDoAchado,
  testesQueFalharam,
  type AcaoPlanejada,
  type Defect,
  type DefectGate,
  type DefeitoEncontrado,
  type Estrategia,
  type NaturezaDoDefeito,
  type OrcamentoDaRecuperacao,
} from "./defeitos.js";
import { camposDoDiagnostico, gravarHandoff, HANDOFF_CONTRACT, lerHandoff, renderHandoff } from "./handoff.js";
import { criarNarrador, type Transicao } from "./narrador.js";
import { escopoDaTask, impactoNaSuite, impactoNaTask, impactoNoFluxo } from "./impacto.js";
import { shaDaFase } from "./ledger.js";
import { documentosPublicados, pastaDosReparos, publicarReparo, validarReparo } from "./upstream.js";
import { bancosDeclarados } from "./passagem.js";
import type { ContratoDaRetomada } from "../provider/cli/types.js";

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
  /** O id da sessão que a CLI abriu ou retomou, do envelope (§125 E). Ausente quando a CLI não informa. */
  sessionId?: string;
  /** Tokens e custo da chamada, quando a CLI informa (§125 D: teto financeiro). */
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
}

export interface EngineCall {
  role: "builder" | "verifier";
  purpose?: FlowReviewPurpose;
  /** Sessão separada de reparo. Apenas o verificador recebe escrita nesta chamada. */
  repair?: boolean;
  /**
   * Retomar a sessão do verificador que diagnosticou o defeito (§125 E). Só em
   * reparo, só quando o provider declara retomada; o prompt leva o handoff
   * inteiro mesmo assim.
   */
  resumeSession?: string;
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
  /**
   * A fase volta de um conflito de integração com o commit aprovado reaplicado
   * e os marcadores nos arquivos em conflito (§125 F): a conciliação mexe só
   * neles, sem sessão de implementação, e os gates revalidam o que ela atingir.
   */
  conciliacao?: ConciliacaoDaIntegracao;
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
  /**
   * O registro de evidências do run (§125 B). O build passa um só para todas as
   * fases — no paralelo elas registram ao mesmo tempo —; ausente, a fase abre o
   * do run.
   */
  evidencias?: LivroDeEvidencias;
  /** Orçamentos da recuperação além de ciclos e reparos do verificador (§125 D); ausente usa os padrões. */
  orcamento?: Partial<Pick<OrcamentoDaRecuperacao, "porCiclo" | "porGate" | "porDefeito">>;
  /**
   * Como o provider do verificador retoma uma sessão (§125 E). Ausente ou null:
   * o reparo é sempre uma sessão nova do mesmo modelo com o handoff.
   */
  verifierResume?: ContratoDaRetomada | null;
  /** Tentar a retomada mesmo com a capacidade declarada como não verificada (`--verifier-resume`). */
  verifierResumeUnverified?: boolean;
  /** O território de um fluxo pela arquitetura, para o G4 saber se a regressão foi atingida (§125 C). */
  territorioDoFluxo?: (workflow: string, donos: ReadonlyMap<number, ReadonlySet<string>>) => TerritorioDoFluxo | null;
  /** `--rebuild-all`: o estado de recuperação e as provas anteriores da fase não valem; nada é apagado. */
  refazer?: boolean;
  /**
   * A fase já fechou com este texto, mas um documento que ela consome mudou (a
   * fatia da arquitetura): ela volta só para ser verificada contra o documento
   * novo — sem sessão de implementação, porque o código é o que já passou.
   */
  revalidar?: string;
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
  | {
      status: "failed";
      gate: GateName;
      cause: string;
      cycles: number;
      /**
       * Onde está a prova da parada, relativo à raiz do projeto (§125 G): o
       * handoff do defeito que parou e o log da evidência que reprovou. O nome
       * do log não se adivinha pelo número do ciclo — os ciclos são janelas de
       * orçamento, e os logs seguem as sessões.
       */
      evidencia?: string[];
    }
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

  /** O último id de sessão de cada revisão do G4: a triagem que diagnostica PRODUTO é o verificador que pode reparar (§125 E). */
  const sessoesDasRevisoes = new Map<FlowReviewPurpose, string>();
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
      if (resposta.sessionId) sessoesDasRevisoes.set(purpose, resposta.sessionId);
      else sessoesDasRevisoes.delete(purpose);
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

  const rascunhosDosFluxos = new Map<string, string>();
  const causasDosRoteiros = new Map<string, string>();

  /*
   * ------------------------------------------------------------------ vNext (§125)
   *
   * O laço de ciclos deixa de ser uma esteira. A fase tem um estado no plano de
   * controle — defeitos com identidade e história, o ciclo corrente, quantas
   * sessões de escrita já houve — e cada prova vira evidência com o conteúdo do
   * código contra o qual foi tirada. A ordem é sempre: verificar o que não tem
   * prova válida (G2, G3, G4, nessa dependência técnica), registrar o que falhou
   * como defeito, escolher a ação pela escada do defeito dentro do orçamento, e
   * depois da ação invalidar só o que a mudança atingiu. Nada se repete porque
   * outro gate falhou; nada se aprova sem aplicabilidade demonstrada.
   */
  const livro = options.evidencias ?? (await LivroDeEvidencias.abrir(paths.root, options.runId));
  const registro = await RegistroDeDefeitos.abrir(paths.root, options.runId, session.id, now, options.refazer === true);
  if (options.refazer === true) {
    // Quem pede para refazer tudo não confia no que está lá: as provas anteriores da fase deixam de valer, com o motivo.
    for (const { evidence, validity } of livro.daFase(session.id)) {
      if (validity.state !== "INVALIDATED") await livro.alterarValidade(evidence.evidenceId, "INVALIDATED", "--rebuild-all", "refazer", now);
    }
  }
  const estado = registro.estado;
  const orcamento: OrcamentoDaRecuperacao = orcamentoEfetivo(maxCycles, maxVerifierRepairs, options.orcamento);
  const narrar = criarNarrador({
    projectRoot: options.projectRoot,
    runId: options.runId,
    announce,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    now,
  });
  const tasksDestaFase = tasksDaFase(session.markdown);
  const contratoSha = sha12(sharedContract);
  const documentosDaFase = (): EvidenceInputs["documents"] => [
    { name: "fase", sha12: shaDaFase(session.markdown) },
    ...(options.architecture ? [{ name: "fatia", sha12: options.architecture.sha12 }] : []),
    { name: "contrato", sha12: contratoSha },
  ];
  const escopoDe = (task: TaskBlock) => escopoDaTask(task, options.architecture?.arquivos ?? []);
  /*
   * O roteirista e a triagem decidem PRODUTO × ROTEIRO lendo rotas e contratos;
   * eles recebem os contratos da fatia (sem a seção de fluxos), ao lado do
   * contrato compartilhado de sempre.
   */
  const contratoDosFluxos = options.architecture && options.architecture.contratos.length > 0
    ? `${sharedContract}\n\n## Contratos da arquitetura para esta fase\n${options.architecture.contratos.map((linha) => `- ${linha}`).join("\n")}`
    : sharedContract;

  /** Quantos ciclos esta execução abriu: é o que `--max-cycles` limita e o que a fase relata. */
  let ciclosAbertos = 1;
  /**
   * Sessões de escrita do executor NESTA execução: nomeiam prompts e logs e são
   * o `attempt` das chamadas, como antes (os logs de cada execução são
   * arquivados em `attempts/`). O total do run fica no registro de defeitos.
   */
  let sessoesNestaExecucao = 0;
  /** Reparos do verificador nesta execução: nomeiam as passagens, como antes. */
  let reparosNestaExecucao = options.integrationFailure?.repairBudget.used ?? 0;
  /**
   * Um reparo do verificador mudou o código desde a última verificação? Então as
   * aprovações anteriores voltam à verificação, dirigida pelo que mudou (§114).
   * Mudança só do executor mantém a memória de DONE do §75, com a lista do que
   * mudou para o verificador reabrir o que ele VIR quebrado.
   */
  let verificadorEscreveuDesdeOG3 = false;
  let previousWroteNothing = false;
  let ultimoRelatorioDeReparo = "";
  let contestacaoPendente: string | null = null;
  let proximoG4: { rejeitados?: string[] } | null = null;
  let julgandoParcial = false;
  /** A retomada sobre código que mudou começa por uma sessão do executor (ver o início do laço). */
  let retomarPeloExecutor: { defeitos: Defect[]; mudouDesde: string[] | null } | null = null;
  /** Quantas vezes seguidas cada gate passou sem que a prova dele se sustentasse (a guarda contra o laço do harness). */
  const verdesSemProva = new Map<string, number>();
  let execucoesG4NaPassagem = 0;
  let ultimaPassagemG4 = "";
  const codigo = { atual: await estadoDoCodigo(arvore) };

  const ordinal = (): number => Math.max(1, sessoesNestaExecucao);
  const passagemAtual = (): string =>
    reparosNestaExecucao > 0 ? `${ordinal()}-after-repair-${reparosNestaExecucao}` : `${ordinal()}`;
  const nomeDoGate = (gate: DefectGate): GateName =>
    gate === "G0" ? "gate 0 — engine" : gate === "G3" ? "gate 3 — verificação independente" : gate === "G4" ? "gate 4 — fluxos na aplicação" : "gate 2 — suíte do projeto";
  const progressoDaFase = (detail: string): void =>
    relatar({ kind: "phase", id: session.id, state: "em andamento", cycle: ciclosAbertos, detail });
  const transicao = (parcial: Omit<Transicao, "fase" | "ciclo" | "maxCiclos">): Promise<string> =>
    narrar({ fase: session.id, ciclo: ciclosAbertos, maxCiclos: maxCycles, ...parcial });

  /** Gravar log ou prompt sem nunca sobrescrever um anterior desta execução. */
  const gravarUnico = async (caminho: string, conteudo: string): Promise<string> => {
    let destino = caminho;
    for (let n = 2; await readFile(destino).then(() => true, () => false); n += 1) destino = caminho.replace(/(\.[a-z]+)$/u, `.${n}$1`);
    await writeAtomic(destino, conteudo);
    return destino;
  };
  const refDe = async (absoluto: string): Promise<ArtifactRef[]> => {
    const ref = await referenciaDeArtefato(paths.root, relative(paths.root, absoluto));
    return ref ? [ref] : [];
  };

  /** O ambiente que decide o resultado da suíte além do código: runtime, instalação, `.env`, bancos (§114). */
  const identidadeDoAmbiente = async (comando: string, fonte: string): Promise<string> => {
    const marca = await readFile(join(arvore, "node_modules", MARCA_DE_INSTALACAO_NODE), "utf8").catch(() => "");
    const ambienteEnv = await readFile(join(arvore, ".env"), "utf8").catch(() => "");
    // O que cada gerenciador reescreve a cada instalação: um `npm install` muda a prova sem mudar o código.
    const instalacoes: string[] = [];
    for (const arquivo of [".package-lock.json", ".modules.yaml", ".yarn-state.yml", ".yarn-integrity"]) {
      instalacoes.push(sha12(await readFile(join(arvore, "node_modules", arquivo), "utf8").catch(() => "")));
    }
    return sha12(JSON.stringify({ runtime: runtimeNode(), marca, instalacoes, env: sha12(ambienteEnv), bancos: Object.keys(await bancosDeclarados(arvore)).sort(), comando, fonte }));
  };

  /*
   * Depois de toda ação que pode mudar o código: o que a mudança atingiu perde a
   * validade, com o motivo; o que não atingiu continua de pé; o que não se pode
   * dizer fica desconhecido. É o Core quem grava — nenhum agente aprova nada.
   */
  const revalidar = async (evento: string): Promise<{ invalidadas: string[]; desconhecidas: string[]; preservadas: string[] }> => {
    codigo.atual = await estadoDoCodigo(arvore);
    const invalidadas: string[] = [];
    const desconhecidas: string[] = [];
    const preservadas: string[] = [];
    const docs = documentosDaFase();
    for (const { evidence, validity } of livro.daFase(session.id)) {
      if (validity.state === "INVALIDATED" || evidence.outcome === "REPAIR_REQUIRED" || evidence.gate === "G0" || evidence.gate === "G1") continue;
      const mudouDocumento = evidence.inputs.documents.find((doc) => {
        const atual = docs.find((cada) => cada.name === doc.name);
        return atual !== undefined && atual.sha12 !== doc.sha12;
      });
      if (mudouDocumento) {
        await livro.alterarValidade(evidence.evidenceId, "INVALIDATED", `documento mudou: ${mudouDocumento.name}`, evento, now);
        invalidadas.push(evidence.checkId);
        continue;
      }
      const arquivos = await arquivosMudados(arvore, evidence.inputs.code?.tree ?? null, codigo.atual.tree);
      const task = evidence.scope.tasks[0] !== undefined ? tasksDestaFase.find((cada) => cada.index === evidence.scope.tasks[0]) : undefined;
      const impacto = evidence.gate === "G3" && task ? impactoNaTask(arquivos, escopoDe(task)) : evidence.gate === "G4" ? impactoNoFluxo(arquivos, null) : impactoNaSuite(arquivos);
      if (impacto.impacto === "AFFECTED") {
        await livro.alterarValidade(evidence.evidenceId, "INVALIDATED", impacto.motivo, evento, now);
        invalidadas.push(evidence.checkId);
      } else if (impacto.impacto === "UNKNOWN") {
        await livro.alterarValidade(evidence.evidenceId, "UNKNOWN", impacto.motivo, evento, now);
        desconhecidas.push(evidence.checkId);
      } else {
        if (validity.state !== "VALID") await livro.alterarValidade(evidence.evidenceId, "VALID", "o conteúdo voltou a ser o da prova", evento, now);
        preservadas.push(evidence.checkId);
      }
    }
    return { invalidadas, desconhecidas, preservadas };
  };

  /** A estratégia é possível para o defeito, pela capacidade do run — sem olhar o orçamento. */
  const possivel = (estrategia: Estrategia, defeito: Defect): boolean => {
    if (estrategia === "verificador") return orcamento.reparosDoVerificador > 0;
    if (estrategia === "roteiro" || estrategia === "revisao") return options.flows !== undefined;
    if (estrategia === "conciliacao") return options.conciliacao !== undefined && defeito.nature === "integracao-conflito";
    return true;
  };
  /** Possível E com orçamento neste ciclo (o do verificador é por gate). */
  const disponivel = (estrategia: Estrategia, defeito: Defect): boolean => {
    if (!possivel(estrategia, defeito)) return false;
    if (estrategia !== "verificador") return true;
    const gate = defeito.gates.at(-1) ?? defeito.discovered.gate;
    return (registro.uso().verifierByGate[gate] ?? 0) < orcamento.reparosDoVerificador;
  };

  /** O custo de uma ação, dividido entre os defeitos que ela tratou: chamadas já contadas no consumir; tempo e US$ aqui. */
  const contarCusto = (defeitos: readonly Defect[], sessoes: readonly EngineResult[], comecou: number): void => {
    if (defeitos.length === 0) return;
    const segundos = (Date.now() - comecou) / 1000 / defeitos.length;
    const usd = sessoes.reduce((total, sessao) => total + (sessao.usage?.costUsd ?? 0), 0) / defeitos.length;
    for (const defeito of defeitos) {
      defeito.costs.seconds = Math.round((defeito.costs.seconds + segundos) * 10) / 10;
      defeito.costs.costUsd += usd;
    }
  };

  /*
   * Os arquivos do conflito, em duas espécies: os marcados (texto, com
   * `<<<<<<<`/`>>>>>>>`) e os que o Git não marca — binário, apagado de um
   * lado —, que ficaram com a versão da árvore integrada e só se resolvem por
   * decisão explícita: mudados por uma ação, ou mantidos com a linha
   * `CAPIVARA_MANTER_INTEGRADA: <arquivo>`. Nenhum lado vence por padrão.
   */
  const semMarcadorDoConflito = [...new Set([...(options.conciliacao?.binarios ?? []), ...(options.conciliacao?.apagados ?? []).map((apagado) => apagado.caminho)])];
  const conflitoAtual = {
    marcados: (options.conciliacao?.arquivos ?? []).filter((arquivo) => !semMarcadorDoConflito.includes(arquivo)),
    semMarcador: semMarcadorDoConflito,
  };
  const decididos = new Set<string>();
  /** Os arquivos que a conciliação pode tocar: os marcados e os que pedem decisão. */
  const arquivosDoConflito = (): string[] => [...new Set([...conflitoAtual.marcados, ...conflitoAtual.semMarcador])];
  /** As decisões que a sessão tomou: o que ela mudou entre os arquivos do conflito, e o que disse manter da integrada. */
  const registrarDecisoes = (mudados: readonly string[], saida: string): void => {
    const doConflito = new Set(arquivosDoConflito());
    for (const arquivo of mudados) if (doConflito.has(arquivo)) decididos.add(arquivo);
    for (const linha of saida.matchAll(/^\s*CAPIVARA_MANTER_INTEGRADA:\s*(.+?)\s*$/gmu)) {
      const arquivo = (linha[1] ?? "").replace(/^`|`$/gu, "");
      if (doConflito.has(arquivo)) decididos.add(arquivo);
    }
  };
  /** O que ainda está em conflito: marcador que sobrou, ou arquivo sem marcador que ninguém decidiu. */
  const conflitosRestantes = async (): Promise<string[]> => [
    ...(await comMarcadorDeConflito(arvore, conflitoAtual.marcados)),
    ...conflitoAtual.semMarcador.filter((arquivo) => !decididos.has(arquivo)),
  ];
  const detalheDoConflito = (restantes: readonly string[]): string => `conflito de integração: marcadores em ${restantes.join(", ")}`;
  /**
   * A prova TEXTUAL da conciliação: não sobrou marcador. A funcional vem depois,
   * dos gates sobre o que a resolução mudou — resolver texto não prova nada.
   */
  const validarConciliacao = async (): Promise<void> => {
    if (!options.conciliacao) return;
    const restantes = await conflitosRestantes();
    for (const defeito of estado.defects.filter((cada) => cada.nature === "integracao-conflito" && cada.status === "AWAITING_VALIDATION")) {
      const resultado = registro.validar(defeito, restantes.length > 0 ? { assinatura: assinaturaDaFalha(detalheDoConflito(restantes)) } : null, false);
      if (restantes.length > 0) {
        defeito.detail = detalheDoConflito(restantes);
        defeito.anchors.signature = assinaturaDaFalha(defeito.detail);
      }
      await transicao({
        tipo: "conflito",
        gate: "INTEGRACAO",
        defeitos: [defeito.defectId],
        motivo:
          resultado === "resolved"
            ? "conflito textual resolvido, sem marcador; a correção funcional ainda vai ser provada pelos gates"
            : resultado === "progress"
              ? `menos marcadores, ainda em ${restantes.join(", ")}`
              : `os marcadores continuam em ${restantes.join(", ")}`,
      });
    }
    await registro.salvar();
  };

  const defeitosConhecidos = () =>
    estado.defects.map((defeito) => ({ id: defeito.defectId, status: defeito.status, gate: defeito.gates.at(-1) ?? defeito.discovered.gate, summary: defeito.summary }));

  /** Registra o achado, grava o handoff quando o verificador diagnosticou, e diz na tela. */
  const achar = async (achado: DefeitoEncontrado, handoff?: { raw: string; sessionId?: string; purpose?: string; log?: string }): Promise<Defect> => {
    const { defeito, novo, reaberto } = registro.registrar(achado);
    if (handoff) {
      const campos = camposDoDiagnostico(handoff.raw);
      const identidade = { runId: options.runId, phaseId: session.id, gate: achado.gate, cycle: estado.cycle, defectId: defeito.defectId };
      const gravado = await gravarHandoff(paths.root, {
        contract: HANDOFF_CONTRACT,
        identity: identidade,
        createdAt: now().toISOString(),
        diagnosedBy: { role: "verifier", ...(handoff.purpose ? { purpose: handoff.purpose } : {}), ...(handoff.sessionId ? { sessionId: handoff.sessionId } : {}), ...(handoff.log ? { log: handoff.log } : {}) },
        ...campos,
        raw: handoff.raw,
        code: codigo.atual,
        documents: documentosDaFase(),
      });
      const relativo = relative(paths.root, gravado.caminho);
      if (!defeito.handoffs.includes(relativo)) defeito.handoffs.push(relativo);
      if (!defeito.criterion && campos.criterion) defeito.criterion = campos.criterion;
      if (!defeito.observed && campos.observed) defeito.observed = campos.observed;
      if (!defeito.expected && campos.expected) defeito.expected = campos.expected;
      if (!defeito.hypothesis && campos.hypothesis) defeito.hypothesis = campos.hypothesis;
    }
    await registro.salvar();
    if (novo || reaberto) {
      await transicao({
        tipo: "defeito",
        gate: achado.gate,
        defeitos: [defeito.defectId],
        motivo: `${reaberto ? "reaberto" : "novo"} (${defeito.severity}): ${defeito.summary}${handoff ? " · handoff do verificador gravado antes de qualquer reparo" : ""}`,
      });
    }
    return defeito;
  };

  /**
   * Valida os defeitos de um gate que esperavam pela verificação que acabou de
   * rodar. O defeito de integração não se valida pela suíte deste worktree: a
   * falha dele é da cópia limpa da árvore integrada, e quem a confere é a
   * integração — verde aqui não o resolve.
   */
  const validarDoGate = async (gate: DefectGate, reproduzidos: ReadonlyMap<string, { assinatura: string; testes?: number }>, regressao: boolean, integracao = false): Promise<void> => {
    // Aberto e não reproduzido também se resolve: outra ação (um reparo agrupado, uma correção vizinha) o consertou.
    const doGate = (cada: Defect): boolean =>
      cada.status === "AWAITING_VALIDATION" || ((cada.status === "OPEN" || cada.status === "ESCALATED") && !reproduzidos.has(cada.defectId));
    for (const defeito of estado.defects.filter((cada) => doGate(cada) && (cada.gates.at(-1) ?? cada.discovered.gate) === gate && (integracao || cada.nature !== "integracao-teste" || reproduzidos.has(cada.defectId)))) {
      const reproduzido = reproduzidos.get(defeito.defectId) ?? null;
      const resultado = registro.validar(defeito, reproduzido, regressao);
      await transicao({
        tipo: "resultado",
        gate,
        defeitos: [defeito.defectId],
        motivo:
          resultado === "resolved"
            ? "resolvido: a verificação independente não o reproduz"
            : resultado === "progress"
              ? "progresso: a falha mudou sem regressão; a estratégia pode continuar"
              : "sem progresso: a mesma falha (ou regressão); esta estratégia não se repete sem informação nova",
      });
    }
    await registro.salvar();
  };

  /** Uma sessão de escrita do executor: implementação ou correção localizada. */
  const sessaoDoExecutor = async (prompt: string): Promise<{ result: EngineResult; escreveu: boolean; ordinal: number }> => {
    estado.builderSessions += 1;
    sessoesNestaExecucao += 1;
    const ordinal = sessoesNestaExecucao;
    if (estado.implementation === "pending") estado.implementation = "started";
    await registro.salvar();
    await writeAtomic(`${paths.prompts}/${evidencePrefix}.cycle-${ordinal}.txt`, prompt);
    const antes = codigo.atual;
    gate("G0", "corrente", ciclosAbertos);
    const result = await chamarLeitor({ role: "builder", phase: session, attempt: ordinal, prompt });
    const log = await gravarUnico(`${paths.logs}/${evidencePrefix}.cycle-${ordinal}.log`, `${result.stdout}\n${result.stderr}`);
    const negacoes = result.negacoes ?? [];
    if (negacoes.length > 0) {
      const lista = negacoes.slice(0, 6).join(", ") + (negacoes.length > 6 ? ` e mais ${negacoes.length - 6}` : "");
      announce(`[${session.id}] a sessão do executor teve comando(s) negado(s) por permissão: ${lista} — registrado, a fase segue para os gates`);
    }
    codigo.atual = await estadoDoCodigo(arvore);
    const escreveu = antes.tree !== codigo.atual.tree;
    const g0 = gate0(result, options.engine);
    gate("G0", g0.green ? "verde" : "vermelho", ciclosAbertos);
    gate("G1", escreveu ? "verde" : "neutro", ciclosAbertos);
    previousWroteNothing = !escreveu;
    if (!escreveu) announce(`[${session.id}] a sessão não escreveu nada; validando o código existente`);
    await livro.registrar({
      phaseId: session.id, gate: "G0", checkId: `sessao-${ordinal}`, now,
      claim: "a sessão do executor terminou com resultado utilizável",
      outcome: g0.green ? "PASS" : "REPAIR_REQUIRED",
      inputs: { documents: documentosDaFase(), code: codigo.atual },
      scope: emptyScope(), supports: [], artifactRefs: await refDe(log),
    });
    await livro.registrar({
      phaseId: session.id, gate: "G1", checkId: `entrega-${ordinal}`, now,
      claim: escreveu ? "a sessão alterou o código do produto" : "a sessão não alterou nada (legítimo numa fase já implementada)",
      outcome: escreveu ? "PASS" : "PASS_WITH_WARNING",
      inputs: { documents: documentosDaFase(), code: codigo.atual },
      scope: emptyScope(), supports: [], artifactRefs: [],
    });
    const declarada = declarouRoteiroErrado(result.stdout);
    if (declarada) contestacaoPendente = declarada;
    return { result, escreveu, ordinal };
  };

  const contexto = async () => {
    const precisaDoRunner = sessoesNestaExecucao === 0 && (options.flows?.workflows.length ?? 0) > 0 && (await faltaOPacoteDoRunner(arvore));
    const temFluxos = (options.flows?.workflows.length ?? 0) + (options.flows?.regressao?.length ?? 0) > 0;
    return {
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
  };

  /** O que vai ao prompt de quem repara: o handoff de cada defeito, com o que mudou desde ele. */
  const causaDosDefeitos = async (defeitos: readonly Defect[]): Promise<string> => {
    const partes: string[] = [];
    for (const defeito of defeitos) {
      const handoff = defeito.handoffs.at(-1) ? await lerHandoff(join(paths.root, defeito.handoffs.at(-1)!)) : null;
      if (handoff) {
        const desde = await arquivosMudados(arvore, handoff.code?.tree ?? null, codigo.atual.tree);
        // O handoff é o diagnóstico; a falha observada vem junto quando ele não a reproduz (a saída da suíte, do fluxo).
        const observada = handoff.raw.includes(defeito.detail.slice(0, 200).trim()) ? "" : `\nLatest observed failure:\n\`\`\`\`\n${defeito.detail}\n\`\`\`\``;
        partes.push(`${renderHandoff(handoff, defeito, desde)}${observada}`);
      } else {
        partes.push(`### ${defeito.defectId} — ${defeito.gates.at(-1) ?? defeito.discovered.gate}: ${defeito.summary}\n${defeito.detail}`);
      }
    }
    return partes.join("\n\n");
  };

  // -------------------------------------------------------------- verificações

  let testeAgora: TestCommand | null = options.testCommand;

  /** G2 — a suíte do projeto, só quando não há prova válida para este conteúdo e este ambiente. */
  const g2Valido = async (): Promise<boolean> => {
    // Um defeito do G2 esperando validação só se resolve com a suíte rodando: a prova antiga não o valida.
    if (estado.defects.some((defeito) => defeito.status === "AWAITING_VALIDATION" && defeito.nature !== "integracao-teste" && (defeito.gates.at(-1) ?? defeito.discovered.gate) === "G2")) return false;
    const atual = livro.atual(session.id, "suite");
    if (!testeAgora) return atual !== null && atual.evidence.outcome === "NOT_APPLICABLE" && atual.evidence.inputs.code?.tree === codigo.atual.tree;
    if (!atual || atual.evidence.outcome !== "PASS" || atual.validity.state !== "VALID") return false;
    if (atual.evidence.inputs.code?.tree !== codigo.atual.tree || atual.evidence.inputs.command !== testeAgora.command) return false;
    return atual.evidence.inputs.extra?.["ambiente"] === (await identidadeDoAmbiente(testeAgora.command, testeAgora.source));
  };

  const verificarSuite = async (): Promise<"verde" | "vermelho"> => {
    for (;;) {
      const passagem = passagemAtual();
      let saidaDaSuite = "";
      const g2 = await comBancosDeTeste(arvore, options.testRunner ?? defaultTestRunner, async (testar) => {
        const ambiente = await prepararAmbiente(arvore, testar);
        for (const aviso of ambiente.anuncios) announce(`[${session.id}] ${aviso}`);
        if (ambiente.saidaDaMigracao !== "") {
          await writeAtomic(`${paths.logs}/${evidencePrefix}.migrate-${passagem}.log`, ambiente.saidaDaMigracao);
        }
        if (await prepararDependenciasNode(ordinal())) {
          if (options.resolveTest) testeAgora = await options.resolveTest();
        }
        gate("G2", "corrente", ciclosAbertos);
        const comSaida: TestRunner = async (command, cwd, env) => {
          const resultado = await testar(command, cwd, env);
          saidaDaSuite = resultado.output;
          return resultado;
        };
        return gate2(arvore, testeAgora?.command ?? null, comSaida, options.systemInstall === true);
      });
      gate("G2", g2.green ? "verde" : "vermelho", ciclosAbertos);
      if (!g2.green && (await prepararDependenciasNode(ordinal(), g2.cause))) {
        if (options.resolveTest) testeAgora = await options.resolveTest();
        continue;
      }
      const log = saidaDaSuite !== "" ? await gravarUnico(`${paths.logs}/${evidencePrefix}.g2-${passagem}.log`, `$ ${testeAgora?.command ?? ""}\n${saidaDaSuite}`) : null;
      const doG2 = estado.defects.filter((cada) => cada.status !== "RESOLVED" && cada.nature !== "integracao-teste" && (cada.gates.at(-1) ?? cada.discovered.gate) === "G2");
      if (g2.green && g2.skipped && doG2.length > 0) {
        const sumiu = await achar({
          gate: "G2",
          nature: doG2[0]!.nature,
          anchors: { tests: doG2[0]!.anchors.tests ?? [] },
          summary: "o comando de teste deixou de existir depois que a suíte falhou",
          detail: `O projeto deixou de declarar o comando de teste (${options.testCommand?.command ?? "o que a fase usava"}) depois que a suíte falhou. Uma suíte que some não está consertada: restaure o comando e corrija a falha.\n\n${doG2[0]!.detail}`,
        });
        gate("G2", "vermelho", ciclosAbertos);
        await validarDoGate("G2", new Map([[sumiu.defectId, { assinatura: sumiu.anchors.signature }]]), true);
        return "vermelho";
      }
      if (g2.green && g2.skipped) {
        announce(`[${session.id}] gate 2 pulado: nenhum comando de teste resolvido`);
        await livro.registrar({
          phaseId: session.id, gate: "G2", checkId: "suite", now,
          claim: "nenhum comando de teste resolvido: o G2 não se aplica",
          outcome: "NOT_APPLICABLE", inputs: { documents: documentosDaFase(), code: codigo.atual },
          scope: emptyScope(), supports: [], artifactRefs: [],
        });
        return "verde";
      }
      const comando = testeAgora?.command ?? "";
      // A marca da instalação entra ANTES da identidade do ambiente: senão a primeira prova verde nunca vale de novo.
      if (g2.green) await registrarInstalacaoNode(arvore);
      const evidencia = await livro.registrar({
        phaseId: session.id, gate: "G2", checkId: "suite", now,
        claim: `a suíte do projeto (${comando}) passa`,
        outcome: g2.green ? "PASS" : "REPAIR_REQUIRED",
        inputs: { documents: documentosDaFase(), code: codigo.atual, command: comando, extra: { ambiente: await identidadeDoAmbiente(comando, testeAgora?.source ?? "") } },
        scope: emptyScope({ components: options.architecture?.componentes ?? [] }),
        supports: [], artifactRefs: log ? await refDe(log) : [],
      });
      if (g2.green) {
        falhaNaPreparacaoNode = "";
        await validarDoGate("G2", new Map(), false);
        return "verde";
      }
      const causa = (g2.toolMissing === true ? g2.cause : `${previousWroteNothing ? "A sessão anterior terminou sem alterar nenhum arquivo. " : ""}${g2.cause}`) +
        (falhaNaPreparacaoNode ? `\n\n${falhaNaPreparacaoNode}` : "");
      if (g2.toolMissing === true) {
        announce(
          `[${session.id}] o runner de testes não está instalado; ` +
            (options.systemInstall === true ? "o executor tem acesso de sistema para instalá-lo" : "o executor vai instalá-lo como dependência do projeto"),
        );
      }
      const testes = testesQueFalharam(saidaDaSuite);
      const naturezaIntegracao = options.integrationFailure !== undefined && estado.defects.some((cada) => cada.nature === "integracao-teste" && cada.status !== "RESOLVED");
      const defeito = await achar({
        gate: "G2",
        nature: g2.toolMissing === true ? "ferramenta" : naturezaIntegracao ? "integracao-teste" : "suite",
        anchors: { tests: testes, quotes: citacoes(saidaDaSuite.slice(-20000)) },
        summary: g2.toolMissing === true ? "o runner de testes não está instalado" : `a suíte falhou (${testes.length > 0 ? `${testes.length} teste(s)` : "sem nome de teste legível"})`,
        detail: causa,
        evidenceId: evidencia.evidenceId,
      });
      await validarDoGate("G2", new Map([[defeito.defectId, { assinatura: defeito.anchors.signature, testes: testes.length }]]), false);
      return "vermelho";
    }
  };

  /** As tasks e o que cada uma precisa agora: nada, confirmação dirigida, ou verificação completa. */
  const planoDoG3 = async () => {
    const aprovadas: { index: number; title: string; mudancas?: string[] }[] = [];
    const confirmar: { index: number; title: string; mudancas: string[] | null }[] = [];
    const verificar: number[] = [];
    /** Aprovação sem conteúdo conhecido (anterior ao campo, ou de outro run) nunca dispensa a chamada. */
    let incerta = false;
    for (const task of tasksDestaFase) {
      const atual = livro.atual(session.id, `task-${task.index}`);
      const aprovacao = options.aprovadas?.aprovacao(session.id, task, options.architecture?.sha12) ?? null;
      const passou = atual && (atual.evidence.outcome === "PASS" || atual.evidence.outcome === "PASS_WITH_WARNING") && atual.validity.state !== "INVALIDATED";
      // A aprovação entre runs só sustenta o MESMO código sob o MESMO contrato compartilhado; senão é desconhecida.
      const arvoreDaProva = passou ? atual.evidence.inputs.code?.tree ?? null : aprovacao?.contratoSha === contratoSha ? aprovacao?.tree ?? null : null;
      // A prova deste run que caiu (documento revisado, reparo) é informação mais nova que o cache entre runs.
      if (!passou && (atual !== null || !aprovacao)) {
        verificar.push(task.index);
        continue;
      }
      if (arvoreDaProva !== null && arvoreDaProva === codigo.atual.tree) {
        aprovadas.push({ index: task.index, title: task.title });
        continue;
      }
      const arquivos = await arquivosMudados(arvore, arvoreDaProva, codigo.atual.tree);
      if (arquivos === null) incerta = true;
      const impacto = arvoreDaProva === null ? { impacto: "UNKNOWN" as const, arquivos: [] as string[] } : impactoNaTask(arquivos, escopoDe(task));
      /*
       * Desconhecido nunca é aprovado em silêncio (spec §3.3): a task vai à
       * consulta limitada — confirmada contra o que mudou, com TASK line própria
       * —, e não ao bloco "já DONE, siga em frente".
       */
      if (impacto.impacto === "AFFECTED") verificar.push(task.index);
      else confirmar.push({ index: task.index, title: task.title, mudancas: arquivos });
    }
    const exigeChamada = incerta || verificar.length > 0 || confirmar.length > 0;
    return { aprovadas, confirmar, verificar, exigeChamada };
  };

  const g3Valido = async (): Promise<boolean> => {
    if (estado.defects.some((defeito) => defeito.status === "AWAITING_VALIDATION" && (defeito.gates.at(-1) ?? defeito.discovered.gate) === "G3")) return false;
    return !(await planoDoG3()).exigeChamada;
  };

  /** Uma leitura do verificador; a que cai por sessão ganha UMA sessão nova, e depois para (§125 C). */
  const leituraDoVerificador = async (prompt: string, nome: string): Promise<{ resposta: EngineResult; g0: GateResult; log: string }> => {
    for (let tentativa = 1; ; tentativa += 1) {
      const sufixo = tentativa === 1 ? "" : `.session-${tentativa}`;
      await writeAtomic(`${paths.prompts}/${nome}${sufixo}.txt`, prompt);
      const resposta = await chamarLeitor({ role: "verifier", phase: session, attempt: ordinal(), prompt });
      const log = await gravarUnico(`${paths.logs}/${nome}${sufixo}.log`, `${resposta.stdout}\n${resposta.stderr}`);
      const g0 = gate0(resposta, options.engine);
      if (g0.green || resposta.providerFailure || tentativa >= 2) return { resposta, g0, log };
      announce(`[${session.id}] a sessão do verificador não concluiu (${g0.cause.split("\n")[0] ?? ""}); uma sessão nova, só deste gate, sem reabrir a construção`);
    }
  };

  /** G3 — o verificador independente, só sobre o que não tem prova válida. */
  const verificarTasks = async (): Promise<"verde" | "vermelho" | { parar: PhaseOutcome }> => {
    gate("G3", "corrente", ciclosAbertos);
    const plano = await planoDoG3();
    const pendentesDoG3 = estado.defects.filter((defeito) => defeito.status === "AWAITING_VALIDATION" && (defeito.gates.at(-1) ?? defeito.discovered.gate) === "G3");
    if (!plano.exigeChamada && pendentesDoG3.length === 0) {
      gate("G3", "verde", ciclosAbertos);
      return "verde";
    }
    if (plano.aprovadas.length > 0) {
      announce(`[${session.id}] ${plano.aprovadas.length} de ${session.taskCount} task(s) já verificadas com este texto; não vou reperguntar sobre elas`);
    }
    if (plano.confirmar.length > 0) {
      announce(`[${session.id}] ${plano.confirmar.length} task(s) aprovada(s) antes voltam à verificação: um reparo mudou o código desde então`);
    }
    const passagem = passagemAtual();
    const nome = `${evidencePrefix}.verify-${passagem}`;
    const verificationPrompt = verifyPrompt({
      language: options.language,
      sharedContract,
      ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}),
      phaseMarkdown: session.markdown,
      taskCount: session.taskCount,
      ...(plano.aprovadas.length > 0 ? { tasksJaAprovadas: plano.aprovadas } : {}),
      ...(plano.confirmar.length > 0 ? { tasksParaConfirmar: plano.confirmar } : {}),
      ...(estado.defects.length > 0 ? { defeitosConhecidos: defeitosConhecidos() } : {}),
    });
    const indicesAprovados = new Set([...plano.aprovadas, ...plano.confirmar].map((task) => task.index));
    let { resposta: verification, g0: g0Verifier, log } = await leituraDoVerificador(verificationPrompt, nome);
    let g3 = gate3(verification.stdout, session.taskCount, indicesAprovados);
    const formatPrefix = `${nome}.format-1`;
    if (g0Verifier.green && !g3.green && g3.repairable !== true) {
      announce(`[${session.id}] resposta do verificador com protocolo inválido; pedindo uma correção de formato somente-leitura, sem reabrir o executor`);
      const retryPrompt = verifyRetryPrompt(verificationPrompt, verification.stdout, g3.cause);
      await writeAtomic(`${paths.prompts}/${formatPrefix}.txt`, retryPrompt);
      verification = await chamarLeitor({ role: "verifier", phase: session, attempt: ordinal(), prompt: retryPrompt });
      log = await gravarUnico(`${paths.logs}/${formatPrefix}.log`, `${verification.stdout}\n${verification.stderr}`);
      g0Verifier = gate0(verification, options.engine);
      g3 = gate3(verification.stdout, session.taskCount, indicesAprovados);
    }
    if (!g0Verifier.green) {
      gate("G3", "vermelho", ciclosAbertos);
      return { parar: await pararPorSessao("gate 0 — engine", `A sessão de verificação independente não concluiu: ${g0Verifier.cause}`) };
    }
    if (!g3.green && g3.repairable !== true) {
      gate("G3", "vermelho", ciclosAbertos);
      return {
        parar: await pararPorSessao(
          g3.gate,
          "O verificador devolveu protocolo inválido após uma recuperação somente-leitura; " +
            `não é diagnóstico de implementação e não será enviado ao executor como reparo.\n${g3.cause}\n` +
            `Resposta preservada em ${paths.logs}/${formatPrefix}.log`,
        ),
      };
    }
    verificadorEscreveuDesdeOG3 = false;
    const vereditos = parseVerification(verification.stdout);
    for (const verdict of vereditos) {
      if (verdict.done && verdict.missing.startsWith("ADVISORY:")) {
        announce(`[${session.id}] TASK ${verdict.index} — observação não bloqueante: ${verdict.missing.slice("ADVISORY:".length).trim()}`);
      }
    }
    for (const reaberta of g3.reabertas) {
      announce(`[${session.id}] TASK ${reaberta.index} já estava aprovada e foi reaberta pelo verificador: ${reaberta.missing}`);
    }
    if (g3.reabertas.length > 0) await options.aprovadas?.revogar(session.id, tasksDestaFase, g3.reabertas.map((task) => task.index));
    // Aprovação com a árvore de agora só para quem o verificador JULGOU DONE nesta leitura; a omitida não ganha prova nova.
    const julgadasDone = new Set(parseVerification(verification.stdout).filter((verdict) => verdict.done).map((verdict) => verdict.index));
    const aprovadasAgora = g3.done.filter((indice) => julgadasDone.has(indice) || !plano.confirmar.some((task) => task.index === indice));
    if (aprovadasAgora.length > 0) {
      await options.aprovadas?.aprovar(session.id, tasksDestaFase, aprovadasAgora, ciclosAbertos, now, options.architecture?.sha12 ?? "", codigo.atual.tree ?? undefined, contratoSha);
    }
    const refs = await refDe(log);
    const provaDaTask = new Map<number, string>();
    for (const verdict of vereditos) {
      const task = tasksDestaFase.find((cada) => cada.index === verdict.index);
      if (!task) continue;
      const prova = await livro.registrar({
        phaseId: session.id, gate: "G3", checkId: `task-${verdict.index}`, now,
        claim: `a task ${verdict.index} (${task.title}) cumpre os critérios de aceite e a fatia da arquitetura`,
        outcome: verdict.done ? (verdict.missing.startsWith("ADVISORY:") ? "PASS_WITH_WARNING" : "PASS") : "REPAIR_REQUIRED",
        inputs: { documents: [...documentosDaFase(), { name: "task", sha12: shaDaTask(task) }], code: codigo.atual },
        scope: emptyScope({ tasks: [verdict.index], components: options.architecture?.componentes ?? [], artifacts: escopoDe(task).map((item) => item.path) }),
        supports: [], artifactRefs: refs,
      });
      provaDaTask.set(verdict.index, prova.evidenceId);
    }
    gate("G3", g3.green ? "verde" : "vermelho", ciclosAbertos);
    const reproduzidos = new Map<string, { assinatura: string }>();
    let novos = false;
    const conhecidos = estado.defects.map((defeito) => defeito.defectId);
    for (const verdict of vereditos.filter((cada) => !cada.done)) {
      const task = tasksDestaFase.find((cada) => cada.index === verdict.index);
      const antes = estado.defects.length;
      const defeito = await achar(
        {
          gate: "G3",
          nature: "task",
          severity: severidadeDoAchado(verdict.missing),
          anchors: { task: verdict.index, ...(task ? { taskSha: shaDaTask(task) } : {}), quotes: citacoes(verdict.missing) },
          // A mesma falha reescrita em outras palavras não é progresso: o que identifica é o critério que não se cumpre.
          // Sem o rótulo, a identidade é a task: prosa diferente para a mesma task não é progresso (spec §5.3).
          assinaturaDe: camposDoDiagnostico(verdict.missing).criterion || `task ${verdict.index} incompleta`,
          ...(provaDaTask.get(verdict.index) ? { evidenceId: provaDaTask.get(verdict.index)! } : {}),
          ...(options.architecture ? { components: options.architecture.componentes } : {}),
          summary: `TASK ${verdict.index}${task ? ` (${task.title})` : ""}: ${verdict.missing.split(/[;\n]/u)[0]?.slice(0, 160) ?? ""}`,
          detail: `TASK ${verdict.index}: INCOMPLETE — ${verdict.missing}${indicesAprovados.has(verdict.index) ? " (já tinha sido aprovada; o verificador a reabriu)" : ""}`,
          ...(defeitoCitado(verdict.missing, conhecidos) ? { tag: defeitoCitado(verdict.missing, conhecidos)! } : {}),
          diagnosedBy: { role: "verifier", ...(verification.sessionId ? { sessionId: verification.sessionId } : {}), log: relative(paths.root, log) },
        },
        { raw: `TASK ${verdict.index}: INCOMPLETE — ${verdict.missing}`, ...(verification.sessionId ? { sessionId: verification.sessionId } : {}), log: relative(paths.root, log) },
      );
      if (estado.defects.length > antes) novos = true;
      reproduzidos.set(defeito.defectId, { assinatura: defeito.anchors.signature });
    }
    await validarDoGate("G3", reproduzidos, novos);
    return g3.green ? "verde" : "vermelho";
  };

  // ------------------------------------------------------------------- G4

  /**
   * O G4 se aplica? Só a decisão — antes de qualquer porta, servidor, navegador
   * ou roteirista (§125 C; spec §3.2): sem fluxos, ou com a regressão inteira de
   * pé e nenhum fluxo próprio, é NOT_APPLICABLE sem custo.
   */
  const aplicabilidadeDoG4 = async (): Promise<{ aplicavel: false; motivo: string; apoios: string[] } | { aplicavel: true; regressao: SkeletonWorkflow[] }> => {
    const fluxos = options.flows;
    if (!fluxos) return { aplicavel: false, motivo: "build sem gate de fluxos", apoios: [] };
    const proprios = fluxos.workflows;
    const regressao = fluxos.regressao ?? [];
    if (proprios.length === 0 && regressao.length === 0) {
      return { aplicavel: false, motivo: "a fase não declara fluxos e nenhuma anterior deixou fluxo a revalidar", apoios: [] };
    }
    if (proprios.length > 0) return { aplicavel: true, regressao };
    const donos = await arquivosDasFases(arvore);
    let ultimoNecessario = -1;
    const apoios: string[] = [];
    for (const [indice, workflow] of regressao.entries()) {
      const prova = [...livro.historico()].reverse().find((evidencia) => evidencia.checkId === `fluxo-${workflow.number}` && evidencia.outcome === "PASS");
      if (!prova) {
        ultimoNecessario = indice;
        continue;
      }
      const arquivos = await arquivosMudados(arvore, prova.inputs.code?.tree ?? null, codigo.atual.tree);
      const doMapa = options.territorioDoFluxo?.(workflow.number, donos) ?? null;
      // Só o arquivo NOVO desde a prova é atribuído à fase corrente; o que já existia e nenhum commit de fase escreveu tem dono desconhecido.
      const semAutor = (arquivos ?? []).filter((arquivo) => ![...donos.values()].some((escritos) => escritos.has(arquivo)));
      const preexistentes = new Set(await existiamNaArvore(arvore, prova.inputs.code?.tree ?? null, semAutor));
      const territorio = doMapa === null ? null : { ...doMapa, classificar: (arquivo: string) => (preexistentes.has(arquivo) ? "desconhecido" as const : doMapa.classificar(arquivo)) };
      const roteiro = await readFile(join(arvore, FLOWS_DIR, flowScriptName(workflow.number)), "utf8").catch(() => "");
      const mesmoRoteiro = prova.inputs.documents.find((doc) => doc.name === `roteiro-${workflow.number}`)?.sha12 === sha12(roteiro);
      const impacto = impactoNoFluxo(arquivos, territorio);
      if (impacto.impacto !== "NONE" || !mesmoRoteiro) ultimoNecessario = indice;
      else apoios.push(prova.evidenceId);
    }
    if (ultimoNecessario < 0) {
      return { aplicavel: false, motivo: `a regressão (${regressao.map((workflow) => workflow.number).join(", ")}) continua provada: as mudanças desta fase ficam fora do território dos fluxos`, apoios };
    }
    return { aplicavel: true, regressao: regressao.slice(0, ultimoNecessario + 1) };
  };

  const g4Valido = async (): Promise<boolean> => {
    if (estado.defects.some((defeito) => defeito.status === "AWAITING_VALIDATION" && (defeito.gates.at(-1) ?? defeito.discovered.gate) === "G4")) return false;
    if (proximoG4 !== null || contestacaoPendente !== null) return false;
    const decisao = await aplicabilidadeDoG4();
    if (!decisao.aplicavel) {
      const atual = livro.atual(session.id, "fluxos");
      if (!atual || atual.evidence.outcome !== "NOT_APPLICABLE" || atual.evidence.inputs.code?.tree !== codigo.atual.tree) {
        await livro.registrar({
          phaseId: session.id, gate: "G4", checkId: "fluxos", now,
          claim: `G4 não se aplica: ${decisao.motivo}`, outcome: "NOT_APPLICABLE",
          inputs: { documents: documentosDaFase(), code: codigo.atual }, scope: emptyScope(), supports: decisao.apoios, artifactRefs: [],
        });
        if (options.flows) {
          gate("G4", "neutro", ciclosAbertos);
          await transicao({ tipo: "nao-aplicavel", gate: "G4", motivo: `${decisao.motivo}; nenhum servidor, navegador ou roteirista foi iniciado`, ...(decisao.apoios.length > 0 ? { preservadas: decisao.apoios } : {}) });
        }
      }
      return true;
    }
    const atual = livro.atual(session.id, "fluxos");
    if (atual === null || atual.validity.state !== "VALID" || atual.evidence.inputs.code?.tree !== codigo.atual.tree) return false;
    // NOT_APPLICABLE só vale aqui quando foi o PRÓPRIO G4 que decidiu (roteiro de regressão ausente), com a marca dele.
    return atual.evidence.outcome === "PASS" || (atual.evidence.outcome === "NOT_APPLICABLE" && atual.evidence.inputs.extra?.["marca"] === FLOW_MARK);
  };

  /** G4 — os fluxos na aplicação de pé: o que já existia, com a decisão e a evidência novas. */
  const verificarFluxos = async (): Promise<"verde" | "vermelho"> => {
    const fluxos = options.flows!;
    const decisao = await aplicabilidadeDoG4();
    const regressao = decisao.aplicavel ? decisao.regressao : [];
    const pedido = proximoG4;
    proximoG4 = null;
    const contestacao = contestacaoPendente;
    contestacaoPendente = null;
    let contestar: string | undefined;
    if (contestacao) {
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
        contestar = contestacao;
        announce(`[${session.id}] o executor contestou o roteiro em vez de mexer no produto: ${contestacao}`);
      } else {
        announce(`[${session.id}] contestação ignorada: este mesmo roteiro já foi contestado e reescrito nesta fase`);
      }
    }
    const passagemBase = passagemAtual();
    execucoesG4NaPassagem = ultimaPassagemG4 === passagemBase ? execucoesG4NaPassagem + 1 : 1;
    ultimaPassagemG4 = passagemBase;
    const passagem = execucoesG4NaPassagem === 1 ? passagemBase : `${passagemBase}.${execucoesG4NaPassagem}`;
    gate("G4", "corrente", ciclosAbertos);
    const startCommand = await fluxos.resolveStart();
    let g4: Awaited<ReturnType<typeof gate4>>;
    try {
      g4 = await gate4({
        projectRoot: arvore,
        workflows: fluxos.workflows,
        ...(contestar ? { roteiroContestado: contestar, roteirosQueFalharam: fluxosQueFalharamPorUltimo } : {}),
        ...(regressao.length > 0 ? { regressao } : {}),
        ...(pedido?.rejeitados ? { rejectedScripts: pedido.rejeitados } : {}),
        startCommand,
        author: async (workflow, rejected, baseUrl, contextoDaPassagem) => {
          const priorCause = causasDosRoteiros.get(workflow.number);
          const previousScript = rascunhosDosFluxos.get(workflow.number) ?? (rejected.length > 0 || priorCause
            ? await readFile(join(arvore, FLOWS_DIR, flowScriptName(workflow.number)), "utf8").catch(() => undefined)
            : undefined);
          const prompt = flowPrompt({
            language: options.language,
            workflow: { number: workflow.number, name: workflow.name, steps: workflow.steps },
            baseUrl,
            sharedContract: contratoDosFluxos,
            phaseMarkdown: session.markdown,
            ...((rejected.length > 0 || priorCause) ? { rejected: [...rejected, ...(priorCause ? [priorCause] : [])] } : {}),
            ...(previousScript ? { previousScript } : {}),
            passagem: contextoDaPassagem,
          });
          const arquivo = `${evidencePrefix}.flow-${workflow.number}-${passagem}-${randomUUID()}`;
          const response = await chamarRevisao("flow-author", prompt, arquivo, ciclosAbertos);
          const draft = extractFlowScript(response);
          if (draft && checkFlowScript(draft, workflow).length > 0) rascunhosDosFluxos.set(workflow.number, draft);
          else rascunhosDosFluxos.delete(workflow.number);
          return response;
        },
        triagem: async (entrada) => {
          triagensNoCiclo += 1;
          return await chamarRevisao("flow-triage", triagePrompt({
              language: options.language,
              phaseMarkdown: session.markdown,
              sharedContract: contratoDosFluxos,
              workflow: { number: entrada.workflow.number, name: entrada.workflow.name, steps: entrada.workflow.steps },
              script: entrada.script,
              failure: entrada.failure,
              snapshot: entrada.snapshot,
              serverErrors: entrada.serverErrors,
            }), `${evidencePrefix}.triagem-${passagem}-${triagensNoCiclo}`, ciclosAbertos);
        },
        ...(fluxos.runner !== undefined ? { runner: fluxos.runner } : {}),
        ...(fluxos.port !== undefined ? { port: fluxos.port } : {}),
        ...(fluxos.preferredPort !== undefined ? { preferredPort: fluxos.preferredPort } : {}),
        announce: (message) => announce(`[${session.id}] ${message}`),
      });
    } catch (erro) {
      if (!(erro instanceof FalhaDeRevisao) || !erro.retryable) throw erro;
      gate("G4", "vermelho", ciclosAbertos);
      const defeito = await achar({ gate: "G4", nature: "fluxo-revisao", anchors: {}, summary: "a sessão de revisão do G4 não concluiu", detail: erro.message });
      await validarDoGate("G4", new Map([[defeito.defectId, { assinatura: defeito.anchors.signature }]]), false);
      return "vermelho";
    }
    triagensNoCiclo = 0;
    if (g4.green === false && g4.triagem?.tipo === "CRITERIO") await registrarDecisaoDoBuild(options.projectRoot, session.id, ciclosAbertos, g4.triagem);
    const evidenciaDoG4 = g4.output || (!g4.green ? g4.cause : "");
    const logDoG4 = evidenciaDoG4 !== "" ? await gravarUnico(`${paths.logs}/${evidencePrefix}.flow-run-${passagem}.log`, evidenciaDoG4) : null;
    gate("G4", g4.green ? (g4.skipped !== "" ? "neutro" : "verde") : "vermelho", ciclosAbertos);
    const ordem = [...regressao, ...fluxos.workflows].filter((workflow, indice, todos) => todos.findIndex((outro) => outro.number === workflow.number) === indice);
    const roteiros: { name: string; sha12: string }[] = [];
    for (const workflow of ordem) {
      const conteudo = await readFile(join(arvore, FLOWS_DIR, flowScriptName(workflow.number)), "utf8").catch(() => "");
      roteiros.push({ name: `roteiro-${workflow.number}`, sha12: sha12(conteudo) });
    }
    const entradasDoG4: EvidenceInputs = {
      documents: [...documentosDaFase(), ...roteiros],
      code: codigo.atual,
      ...(startCommand ? { command: startCommand } : {}),
      extra: { marca: FLOW_MARK },
    };
    const refs = logDoG4 ? await refDe(logDoG4) : [];
    if (g4.green) {
      fluxosQueFalharamPorUltimo = [];
      if (g4.skipped !== "") announce(`[${session.id}] gate 4 pulado: ${g4.skipped}`);
      else announce(`[${session.id}] gate 4: ${g4.scripts.length} fluxo(s) percorrido(s) na aplicação de pé`);
      const geral = await livro.registrar({
        phaseId: session.id, gate: "G4", checkId: "fluxos", now,
        claim: g4.skipped !== "" ? `G4 não se aplica: ${g4.skipped}` : `os fluxos ${ordem.map((workflow) => workflow.number).join(", ")} passam na aplicação de pé`,
        outcome: g4.skipped !== "" ? "NOT_APPLICABLE" : "PASS",
        inputs: entradasDoG4, scope: emptyScope({ flows: ordem.map((workflow) => workflow.number), components: options.architecture?.componentes ?? [] }),
        supports: [], artifactRefs: refs,
      });
      if (g4.skipped === "") {
        for (const workflow of ordem) {
          await livro.registrar({
            phaseId: session.id, gate: "G4", checkId: `fluxo-${workflow.number}`, now,
            claim: `o fluxo ${workflow.number} (${workflow.name}) passa na aplicação de pé`, outcome: "PASS",
            inputs: entradasDoG4, scope: emptyScope({ flows: [workflow.number] }), supports: [geral.evidenceId], artifactRefs: refs,
          });
        }
      }
      await validarDoGate("G4", new Map(), false);
      return "verde";
    }
    fluxosQueFalharamPorUltimo = g4.falharam ?? [];
    const falhaDoRoteiro = g4.scriptFailed === true || g4.triagem?.tipo === "ROTEIRO";
    const causa = g4.toolMissing === true || falhaDoRoteiro ? g4.cause : `${previousWroteNothing ? "A sessão anterior terminou sem alterar nenhum arquivo. " : ""}${g4.cause}`;
    if (g4.toolMissing === true) announce(`[${session.id}] o runner de fluxos não está instalado; o executor vai instalá-lo no projeto`);
    else if (g4.startupFailed === true) announce(`[${session.id}] gate 4: a aplicação não subiu; nenhum fluxo foi percorrido`);
    else if (g4.scriptFailed === true) announce(`[${session.id}] gate 4: o roteiro falhou por si mesmo, não o produto — defeito do harness`);
    if (falhaDoRoteiro) {
      const reprovados = fluxosQueFalharamPorUltimo.length > 0 ? fluxosQueFalharamPorUltimo : [...new Set(ordem.map((workflow) => workflow.number))];
      for (const number of reprovados) causasDosRoteiros.set(number, g4.cause);
    }
    const evidencia = await livro.registrar({
      phaseId: session.id, gate: "G4", checkId: "fluxos", now,
      claim: "os fluxos declarados passam na aplicação de pé", outcome: "REPAIR_REQUIRED",
      inputs: entradasDoG4, scope: emptyScope({ flows: ordem.map((workflow) => workflow.number) }), supports: [], artifactRefs: refs,
    });
    const workflow = fluxosQueFalharamPorUltimo[0];
    const natureza: NaturezaDoDefeito = falhaDoRoteiro ? "fluxo-roteiro" : g4.toolMissing === true ? "fluxo-ferramenta" : g4.startupFailed === true || startCommand === null ? "fluxo-subida" : g4.triagem?.tipo === "CRITERIO" ? "fluxo-criterio" : "fluxo-produto";
    const tarefaDoCriterio = g4.triagem?.criterio ? tarefaPeloCriterio(tasksDestaFase, g4.triagem.criterio) : undefined;
    const triagemCrua = g4.triagem ? [`CAPIVARA_TRIAGEM: ${g4.triagem.tipo}`, `CRITERION: ${g4.triagem.criterio}`, `EVIDENCE: ${g4.triagem.evidencia}`, `LOCATION: ${g4.triagem.onde}`, `FIX: ${g4.triagem.correcao}`].join("\n") : "";
    const defeito = await achar(
      {
        gate: "G4",
        nature: natureza,
        anchors: {
          ...(workflow ? { workflow } : {}),
          ...(g4.triagem?.onde ? { step: g4.triagem.onde.slice(0, 120) } : {}),
          ...(tarefaDoCriterio ? { task: tarefaDoCriterio } : {}),
          quotes: citacoes(`${g4.triagem?.evidencia ?? ""}\n${g4.cause}`),
          version: roteiros.map((roteiro) => `${roteiro.name}@${roteiro.sha12}`).join(","),
        },
        summary: `${workflow ? `fluxo ${workflow}: ` : ""}${g4.cause.split("\n")[0]?.slice(0, 160) ?? ""}`,
        // A versão dos roteiros entra no texto: a mesma falha com outro roteiro é informação nova.
        detail: `${causa}\n\n(roteiros desta passagem: ${roteiros.map((roteiro) => `${roteiro.name}@${roteiro.sha12}`).join(", ") || "nenhum"})`,
        evidenceId: evidencia.evidenceId,
        ...(g4.triagem && natureza === "fluxo-produto" ? { diagnosedBy: { role: "verifier" as const, purpose: "flow-triage", ...(sessoesDasRevisoes.get("flow-triage") ? { sessionId: sessoesDasRevisoes.get("flow-triage")! } : {}) } } : {}),
      },
      g4.triagem && (natureza === "fluxo-produto" || natureza === "fluxo-criterio")
        ? { raw: triagemCrua, purpose: "flow-triage", ...(sessoesDasRevisoes.get("flow-triage") ? { sessionId: sessoesDasRevisoes.get("flow-triage")! } : {}), ...(logDoG4 ? { log: relative(paths.root, logDoG4) } : {}) }
        : undefined,
    );
    await validarDoGate("G4", new Map([[defeito.defectId, { assinatura: defeito.anchors.signature }]]), false);
    return "vermelho";
  };

  // ------------------------------------------------------------------ ações

  /** A ação planejada, executada; quem a valida é a próxima verificação do gate de cada defeito. */
  const executarAcao = async (acao: AcaoPlanejada): Promise<{ parar: PhaseOutcome } | null> => {
    const gates = [...new Set(acao.defeitos.map((defeito) => defeito.gates.at(-1) ?? defeito.discovered.gate))];
    const uso = registro.uso();
    const orcamentoDaAcao = [
      { escopo: "ciclo", usado: uso.repairs + 1, max: orcamento.porCiclo },
      ...gates.map((gate) => ({ escopo: gate, usado: (uso.byGate[gate] ?? 0) + 1, max: orcamento.porGate })),
      ...acao.defeitos.map((defeito) => ({ escopo: defeito.defectId, usado: (uso.byDefect[defeito.defectId] ?? 0) + 1, max: orcamento.porDefeito })),
    ];
    const rotuloDaEstrategia: Record<Estrategia, string> = {
      executor: acao.defeitos.length > 1 ? "executor, correção localizada agrupada" : "executor, correção localizada",
      verificador: "verificador que diagnosticou",
      roteiro: "reescrita do roteiro do G4",
      revisao: "nova sessão de revisão do G4",
      conciliacao: "conciliação dos trechos em conflito",
    };
    const testesFalhando = acao.defeitos.some((defeito) => defeito.nature === "suite" || defeito.nature === "integracao-teste")
      ? testesQueFalharam(acao.defeitos.map((defeito) => defeito.detail).join("\n")).length
      : undefined;

    if (acao.estrategia === "executor") {
      const ctx = await contexto();
      const gateTexto = gates.map(nomeDoGate).join(" + ");
      const causa = await causaDosDefeitos(acao.defeitos);
      const prompt = fixPrompt({
        ...ctx,
        gate: gateTexto,
        cause: causa + (ultimoRelatorioDeReparo ? `\n\nRelatório do último reparo assistido pelo verificador (confira os gates; o relatório não é aprovação):\n${ultimoRelatorioDeReparo}` : "") +
          (falhaNaPreparacaoNode ? `\n\n## Dependency preparation — unresolved environment failure\n${falhaNaPreparacaoNode}` : ""),
        previousWroteNothing,
      });
      registro.consumir(acao, { role: "builder", attempt: sessoesNestaExecucao + 1 }, testesFalhando);
      await registro.salvar();
      await transicao({ tipo: "estrategia", gate: gates.join("+"), defeitos: acao.defeitos.map((defeito) => defeito.defectId), estrategia: rotuloDaEstrategia.executor, agente: "executor", orcamento: orcamentoDaAcao, motivo: "reparo localizado com o handoff de cada defeito; não reabre a fase nem repete gates com prova válida", proximo: gates.join(", ") });
      announce(`[${session.id}] nova chamada de construção ${sessoesNestaExecucao + 1}; motivo: ${gateTexto}: ${acao.defeitos[0]?.summary ?? ""}`);
      await event("retry", `${gateTexto}: ${acao.defeitos.map((defeito) => defeito.detail).join("\n\n")}`, ciclosAbertos);
      progressoDaFase(`ciclo ${ciclosAbertos}/${maxCycles} · correção`);
      const ambienteAntes = testeAgora ? await identidadeDoAmbiente(testeAgora.command, testeAgora.source) : "";
      const comecou = Date.now();
      const arvoreAntes = codigo.atual.tree;
      const sessao = await sessaoDoExecutor(prompt);
      contarCusto(acao.defeitos, [sessao.result], comecou);
      if (acao.defeitos.some((defeito) => defeito.nature === "integracao-conflito")) {
        registrarDecisoes((await arquivosMudados(arvore, arvoreAntes, codigo.atual.tree)) ?? [], sessao.result.stdout);
      }
      const g0 = gate0(sessao.result, options.engine);
      if (!g0.green && (sessao.result.timedOut || sessao.result.providerFailure)) return { parar: await pararPorSessao("gate 0 — engine", g0.cause) };
      const mudouAmbiente = testeAgora ? ambienteAntes !== (await identidadeDoAmbiente(testeAgora.command, testeAgora.source)) : false;
      for (const defeito of acao.defeitos) {
        const tentativa = defeito.attempts.at(-1);
        if (tentativa) tentativa.changed = sessao.escreveu || mudouAmbiente || contestacaoPendente !== null;
      }
      registro.aguardarValidacao(acao.defeitos);
      // O defeito de engine se valida aqui mesmo: a sessão de correção terminou, ou não.
      const doEngine = acao.defeitos.filter((defeito) => defeito.nature === "engine");
      for (const defeito of doEngine) {
        registro.validar(defeito, g0.green ? null : { assinatura: assinaturaDaFalha(g0.cause) }, false);
        if (!g0.green) defeito.anchors.signature = assinaturaDaFalha(g0.cause);
      }
      if (!g0.green && doEngine.length === 0) {
        await achar({ gate: "G0", nature: "engine", anchors: {}, summary: "a sessão do executor não terminou com resultado utilizável", detail: g0.cause });
      }
      await registro.salvar();
      // O conflito não tem gate que o revalide neste worktree: os marcadores são conferidos aqui.
      if (acao.defeitos.some((defeito) => defeito.nature === "integracao-conflito")) await validarConciliacao();
      return null;
    }

    if (acao.estrategia === "conciliacao") {
      const conflito = options.conciliacao!;
      const permitidos = new Set(arquivosDoConflito());
      const apagados = conflito.apagados ?? [];
      const ctx = await contexto();
      const historico = [
        ...apagados.map((apagado) => `${apagado.caminho}: apagado ${apagado.por === "fase" ? "por esta fase; a árvore integrada o alterou" : "pela árvore integrada; esta fase o alterou"}`),
        ...(conflito.binarios ?? []).map((arquivo) => `${arquivo}: sem marcador (binário); está com a versão da árvore integrada, e a desta fase está no branch ${conflito.aprovado.branch}`),
        ...(conflito.historico ? [conflito.historico] : []),
      ].join("\n");
      const pendentes = conflitoAtual.semMarcador.filter((arquivo) => !decididos.has(arquivo));
      const prompt = conflictPrompt({ ...ctx, arquivos: [...permitidos], ...(pendentes.length > 0 ? { semMarcador: pendentes } : {}), ...(historico !== "" ? { historico } : {}) });
      registro.consumir(acao, { role: "builder", attempt: sessoesNestaExecucao + 1 });
      await registro.salvar();
      await transicao({
        tipo: "estrategia", gate: "INTEGRACAO", defeitos: acao.defeitos.map((defeito) => defeito.defectId), estrategia: rotuloDaEstrategia.conciliacao,
        agente: `executor, só em ${[...permitidos].join(", ")}`, orcamento: orcamentoDaAcao,
        motivo: `os dois lados são aprovados (HEAD ${conflito.principal.slice(0, 12)} e ${conflito.aprovado.branch}); não reimplementa a fase nem consome ciclo de implementação`,
        proximo: "marcadores; depois os gates sobre o que a conciliação mudou",
      });
      announce(`[${session.id}] conciliando o conflito de integração em ${[...permitidos].join(", ")}; nada fora desses arquivos pode mudar`);
      await event("retry", `conciliação do conflito de integração em ${[...permitidos].join(", ")}`, ciclosAbertos);
      progressoDaFase(`ciclo ${ciclosAbertos}/${maxCycles} · conciliação`);
      const antes = codigo.atual.tree;
      const sessao = await sessaoDoExecutor(prompt);
      const g0 = gate0(sessao.result, options.engine);
      if (!g0.green && (sessao.result.timedOut || sessao.result.providerFailure)) return { parar: await pararPorSessao("gate 0 — engine", g0.cause) };
      // O escopo é do Core, não da boa vontade do agente: o que mudou fora dos arquivos em conflito volta.
      const mudados = (await arquivosMudados(arvore, antes, codigo.atual.tree)) ?? [];
      const fora = mudados.filter((arquivo) => !permitidos.has(arquivo));
      if (fora.length > 0 && antes !== null) {
        const naoVoltaram = await restaurarDoEstado(arvore, antes, fora);
        codigo.atual = await estadoDoCodigo(arvore);
        announce(
          `[${session.id}] a conciliação mexeu fora dos arquivos em conflito (${fora.join(", ")}); o Core desfez essas mudanças` +
            `${naoVoltaram.length > 0 ? `, menos ${naoVoltaram.join(", ")}, que não puderam voltar` : ""}`,
        );
        await event("retry", `conciliação fora do escopo desfeita: ${fora.join(", ")}`, ciclosAbertos);
      }
      const dentro = mudados.filter((arquivo) => permitidos.has(arquivo));
      const decididosAntes = decididos.size;
      registrarDecisoes(dentro, sessao.result.stdout);
      for (const defeito of acao.defeitos) {
        const tentativa = defeito.attempts.at(-1);
        if (tentativa) tentativa.changed = dentro.length > 0 || decididos.size > decididosAntes;
      }
      registro.aguardarValidacao(acao.defeitos);
      await registro.salvar();
      await validarConciliacao();
      return null;
    }

    if (acao.estrategia === "verificador") {
      reparosNestaExecucao += 1;
      if (options.integrationFailure) options.integrationFailure.repairBudget.used = reparosNestaExecucao;
      verificadorEscreveuDesdeOG3 = true;
      const diagnostico = acao.defeitos[0]!.diagnosedBy;
      const contrato = options.verifierResume ?? null;
      const podeRetomar = diagnostico?.sessionId !== undefined && contrato !== null &&
        (contrato.estado === "garantido" || options.verifierResumeUnverified === true) && contrato.elevacao === "por-invocacao";
      const causa = await causaDosDefeitos(acao.defeitos);
      const repairPrompt = verifierRepairPrompt({
        language: options.language,
        sharedContract,
        ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}),
        phaseMarkdown: session.markdown,
        cause: causa,
        testCommand: testeAgora?.command ?? null,
        ...((await resolveE2eCommand(arvore)) ? { e2eCommand: (await resolveE2eCommand(arvore))! } : {}),
        systemInstall: options.systemInstall === true,
      });
      const nome = `${evidencePrefix}.repair-${reparosNestaExecucao}-cycle-${ordinal()}`;
      await writeAtomic(`${paths.prompts}/${nome}.txt`, repairPrompt);
      registro.consumir(acao, { role: "verifier", attempt: ordinal() }, testesFalhando);
      await registro.salvar();
      await transicao({
        tipo: "estrategia", gate: gates.join("+"), defeitos: acao.defeitos.map((defeito) => defeito.defectId), estrategia: rotuloDaEstrategia.verificador,
        agente: podeRetomar ? `verificador, pedindo a retomada da sessão ${diagnostico!.sessionId} (só confirmada pelo id que o provider devolver)` : "verificador, sessão nova do mesmo modelo com o handoff",
        orcamento: [...orcamentoDaAcao, ...gates.map((gate) => ({ escopo: `verificador ${gate}`, usado: (uso.verifierByGate[gate] ?? 0) + 1, max: orcamento.reparosDoVerificador }))],
        motivo: "o executor não resolveu (ou o defeito não tem diagnóstico do verificador); quem reparar não valida a própria mudança", proximo: `${gates.join(", ")} por sessão independente`,
      });
      announce(`[${session.id}] verificador corrigindo a falha (${reparosNestaExecucao}); os gates serão executados novamente por sessões independentes`);
      await event("retry", `reparo ${reparosNestaExecucao}/${orcamento.reparosDoVerificador} pelo verificador: ${acao.defeitos[0]?.summary ?? ""}`, ciclosAbertos);
      gate("G0", "corrente", ciclosAbertos);
      const antes = codigo.atual;
      const ambienteAntesDoReparo = testeAgora ? await identidadeDoAmbiente(testeAgora.command, testeAgora.source) : "";
      const comecouReparo = Date.now();
      let repair = await chamarLeitor({ role: "verifier", repair: true, phase: session, attempt: ordinal(), prompt: repairPrompt, ...(podeRetomar ? { resumeSession: diagnostico!.sessionId! } : {}) });
      const sessoesDoReparo: EngineResult[] = [repair];
      let retomada = podeRetomar && repair.sessionId === diagnostico!.sessionId;
      if (podeRetomar && !retomada) {
        // Outra sessão não é retomada — mas o prompt leva o handoff inteiro: ela É a sessão nova do fallback, e o trabalho dela fica.
        announce(`[${session.id}] a sessão ${diagnostico!.sessionId} não foi retomada (${repair.sessionId ? `o provider abriu ${repair.sessionId}` : "sem id no envelope"}); a sessão aberta recebeu o handoff e vale como a sessão nova`);
      }
      if (podeRetomar && !gate0(repair, options.engine).green) {
        // A sessão pedida não entregou resultado utilizável: UMA sessão nova com o handoff, e o transcrito da primeira fica.
        await gravarUnico(`${paths.logs}/${nome}.retomada.log`, `${repair.stdout}\n${repair.stderr}`);
        announce(`[${session.id}] a sessão pedida não concluiu; sessão nova do mesmo modelo com o handoff`);
        repair = await chamarLeitor({ role: "verifier", repair: true, phase: session, attempt: ordinal(), prompt: repairPrompt });
        sessoesDoReparo.push(repair);
        retomada = false;
      }
      contarCusto(acao.defeitos, sessoesDoReparo, comecouReparo);
      for (const defeito of acao.defeitos) {
        const tentativa = defeito.attempts.at(-1);
        if (tentativa) tentativa.agent = { ...tentativa.agent, ...(repair.sessionId ? { sessionId: repair.sessionId } : {}), resumed: retomada };
      }
      ultimoRelatorioDeReparo = `${repair.stdout}\n${repair.stderr}`.trim();
      const log = await gravarUnico(`${paths.logs}/${nome}.log`, `${repair.stdout}\n${repair.stderr}`);
      codigo.atual = await estadoDoCodigo(arvore);
      const escreveu = antes.tree !== codigo.atual.tree;
      const mudouAmbiente = testeAgora ? ambienteAntesDoReparo !== (await identidadeDoAmbiente(testeAgora.command, testeAgora.source)) : false;
      for (const defeito of acao.defeitos) {
        const tentativa = defeito.attempts.at(-1);
        // O reparo pode mudar o ambiente sem rastro que o harness meça (instalação de sistema): só "nada" quando nada mesmo.
        if (tentativa) tentativa.changed = escreveu || mudouAmbiente || options.systemInstall === true;
      }
      gate("G1", escreveu ? "verde" : "neutro", ciclosAbertos);
      if (escreveu) previousWroteNothing = false;
      const terminou = gate0(repair, options.engine);
      gate("G0", terminou.green ? "verde" : "vermelho", ciclosAbertos);
      await livro.registrar({
        phaseId: session.id, gate: "G0", checkId: `reparo-${reparosNestaExecucao}`, now,
        claim: "a sessão de reparo do verificador terminou com resultado utilizável (o relatório dela não é aprovação)",
        outcome: terminou.green ? "PASS" : "REPAIR_REQUIRED",
        inputs: { documents: documentosDaFase(), code: codigo.atual }, scope: emptyScope(), supports: [], artifactRefs: await refDe(log),
      });
      registro.aguardarValidacao(acao.defeitos);
      await registro.salvar();
      /*
       * O reparo do verificador pode instalar, recompilar e mexer no ambiente
       * fora do código (§114): quem confirma é a suíte rodando de novo, nunca a
       * fala do reparador nem a ausência de diff.
       */
      const suiteAtual = livro.atual(session.id, "suite");
      if (suiteAtual && suiteAtual.validity.state !== "INVALIDATED") {
        await livro.alterarValidade(suiteAtual.evidence.evidenceId, "INVALIDATED", "o reparo do verificador pode ter mudado o ambiente fora do código", `reparo ${reparosNestaExecucao}`, now);
      }
      if (!terminou.green) {
        if (repair.timedOut || repair.providerFailure) return { parar: await pararPorSessao("gate 0 — engine", `${acao.defeitos[0]?.detail ?? ""}\n\nO reparo assistido pelo verificador não concluiu: ${terminou.cause}`) };
        announce(`[${session.id}] reparo do verificador não concluiu; o trabalho foi preservado para o executor`);
      }
      if (options.resolveTest) testeAgora = await options.resolveTest();
      return null;
    }

    // Roteiro e revisão do G4: a ação é a próxima passagem do G4, com o que foi decidido.
    registro.consumir(acao, { role: "verifier", attempt: ordinal() });
    registro.aguardarValidacao(acao.defeitos);
    await registro.salvar();
    if (acao.estrategia === "roteiro") {
      const reprovados = acao.defeitos.map((defeito) => defeito.anchors.workflow).filter((numero): numero is string => numero !== undefined);
      proximoG4 = { rejeitados: reprovados.length > 0 ? reprovados : fluxosQueFalharamPorUltimo };
    } else {
      proximoG4 = {};
    }
    await transicao({ tipo: "estrategia", gate: "G4", defeitos: acao.defeitos.map((defeito) => defeito.defectId), estrategia: rotuloDaEstrategia[acao.estrategia], agente: "roteirista G4", orcamento: orcamentoDaAcao, motivo: "corrige só a verificação G4; produto e provas de G2/G3 preservados", proximo: "G4" });
    await event("retry", `correção do roteiro G4 no próximo ciclo, preservando produto e G2/G3 aprovados: ${acao.defeitos[0]?.detail ?? ""}`, ciclosAbertos);
    progressoDaFase(`ciclo ${ciclosAbertos}/${maxCycles} · correção do G4`);
    return null;
  };

  // --------------------------------------------------------------- paradas

  /**
   * A causa de quem para: o gate é o do defeito que está vermelho AGORA — o
   * aberto mais recente, antes dos que só esperam validação —, e o texto traz
   * todos, com ele primeiro.
   */
  const causaDaParada = (): { gate: GateName; cause: string } => {
    const pendentes = estado.defects.filter((defeito) => defeito.status !== "RESOLVED");
    const vermelhos = pendentes.filter((defeito) => defeito.status === "OPEN" || defeito.status === "ESCALATED");
    const primeiro = vermelhos.at(-1) ?? pendentes.at(-1);
    const abertos = primeiro ? [primeiro, ...pendentes.filter((defeito) => defeito !== primeiro)] : pendentes;
    return {
      // A revisão do G4 que caiu é falha de sessão de um leitor: gate 0, como sempre foi relatada.
      gate: primeiro ? (primeiro.nature === "fluxo-revisao" ? "gate 0 — engine" : nomeDoGate(primeiro.gates.at(-1) ?? primeiro.discovered.gate)) : "gate 0 — engine",
      cause: abertos.map((defeito) => defeito.detail).join("\n\n") || "a fase parou sem defeito registrado",
    };
  };

  /** O pacote de reparo documental publicado nesta parada, relativo à raiz do projeto. */
  let pacoteUpstream: string | null = null;

  /**
   * O último recurso (§125 H; spec §8): a escada do BUILD acabou sem
   * informação nova, e o verificador disse — no diagnóstico, com `UPSTREAM:` —
   * que o defeito é do documento aprovado. O Core monta o pacote do que já
   * está registrado (handoff, tentativas, provas), valida e publica; só então
   * o defeito vira `UPSTREAM_REPAIR_REQUIRED`. Pacote recusado não vira estado,
   * e nenhum agente é chamado para inventar a correção.
   */
  const encaminharUpstream = async (): Promise<void> => {
    const contratos: Record<string, string> = {
      "project-phases.md": "capivara-phases/v2",
      "architecture.md": "capivara-architecture/v1",
      "environment.json": ENVIRONMENT_CONTRACT,
      "skeleton.md": "capivara-skeleton/v2",
    };
    const daRaiz = (relativo: string): string => relative(options.projectRoot, join(paths.root, relativo));
    for (const defeito of estado.defects.filter((cada) => cada.status === "OPEN" || cada.status === "ESCALATED")) {
      const ultimo = defeito.handoffs.at(-1);
      const handoff = ultimo ? await lerHandoff(join(paths.root, ultimo)) : null;
      const alegacao = (handoff?.upstream ?? "") || camposDoDiagnostico(defeito.rediagnoses.at(-1)?.excerpt ?? "").upstream;
      const alvo = /^\s*INIT\b/iu.test(alegacao) ? "init" : /^\s*PLAN\b/iu.test(alegacao) ? "plan" : null;
      if (alvo === null) continue;
      if (alvo === "init") {
        // A especificação manda habilitar o INIT só depois de o caminho do PLAN estar provado (§8.3): a alegação fica no handoff.
        announce(`[${session.id}] o verificador aponta o INIT em ${defeito.defectId}; o encaminhamento ao INIT não está habilitado nesta versão (primeiro o PLAN), e o diagnóstico fica no handoff`);
        continue;
      }
      // Só os documentos da etapa destino: citar um de outra etapa não muda a autoridade do reparo.
      const nome = DOCUMENTOS_DA_ETAPA[alvo].find((documento) => alegacao.includes(documento)) ?? DOCUMENTOS_DA_ETAPA[alvo][0]!;
      const documentos = await documentosPublicados(options.projectRoot);
      const gateDoDefeito = defeito.gates.at(-1) ?? defeito.discovered.gate;
      const artefatos = livro.daFase(session.id).map(({ evidence }) => evidence)
        .filter((evidencia) => evidencia.outcome === "REPAIR_REQUIRED" && evidencia.gate === gateDoDefeito)
        .flatMap((evidencia) => evidencia.artifactRefs.map((ref) => ({ path: daRaiz(ref.path), sha12: ref.sha12 })));
      const tentativas = defeito.attempts.filter((tentativa) => tentativa.result !== "pending");
      const diagnosis = [
        "## Defeito", `${defeito.defectId} (${defeito.nature}, ${gateDoDefeito}): ${defeito.summary}${defeito.criterion ? `\nCritério: ${defeito.criterion}` : ""}`, "",
        "## Observado", defeito.observed || defeito.detail.split("\n").slice(0, 12).join("\n"), "",
        "## Esperado", defeito.expected || "o critério da fase satisfeito pelo código, sem contradizer o documento aprovado", "",
        "## Contornos tentados", ...tentativas.map((tentativa) => `- ciclo ${tentativa.cycle}, ${tentativa.strategy}: ${tentativa.result}`), "",
        "## Limites da edição", alegacao, "",
      ].join("\n");
      const publicado = await publicarReparo(options.projectRoot, {
        origin: { runId: options.runId, phaseId: session.id, gate: gateDoDefeito, cycle: estado.cycle, defectId: defeito.defectId },
        target: alvo,
        document: { name: nome, contract: contratos[nome]!, sha12: documentos[nome] ?? "" },
        /*
         * O que o reparo pode alcançar, pelo grafo da arquitetura e não pela
         * redação da alegação: um contrato (architecture.md) ou a infraestrutura
         * (environment.json) atingem as fases que consomem os componentes desta;
         * o critério de uma fase (project-phases.md) atinge ela e as que a
         * alegação nomeia. A pergunta de escopo, na entrada do PLAN, sai daqui.
         */
        impact: {
          phases: [...new Set([
            session.number,
            ...phaseReferences(alegacao),
            ...(nome === "project-phases.md" ? [] : options.architecture?.consumidoras ?? []),
          ])].sort((a, b) => a - b),
          components: options.architecture?.componentes ?? [],
          contracts: nome === "architecture.md" ? options.architecture?.contratosProprios ?? [] : [],
        },
        diagnosis,
        evidence: {
          artifacts: artefatos,
          handoffs: defeito.handoffs.map(daRaiz),
          recovery: tentativas.map((tentativa) => ({ strategy: tentativa.strategy, result: tentativa.result, cycle: tentativa.cycle })),
          exhausted: true,
        },
        createdAt: now().toISOString(),
      });
      if (!publicado.ok) {
        announce(`[${session.id}] o encaminhamento documental de ${defeito.defectId} foi recusado — ${publicado.errors.join("; ")}; nenhum agente é chamado para inventar a correção`);
        continue;
      }
      defeito.status = "UPSTREAM_REPAIR_REQUIRED";
      defeito.upstream = publicado.manifest.repairId;
      await registro.salvar();
      pacoteUpstream = relative(options.projectRoot, publicado.caminho);
      await transicao({
        tipo: "upstream",
        gate: gateDoDefeito,
        defeitos: [defeito.defectId],
        motivo: `reparo documental necessário no ${alvo.toUpperCase()} (${nome}): pacote ${publicado.manifest.repairId} validado e publicado em ${pacoteUpstream}`,
        proximo: `capivara ${alvo}`,
      });
      return;
    }
  };

  /** O handoff do defeito que parou e os logs da última prova reprovada do gate dele, relativos à raiz do projeto. */
  const evidenciaDaParada = async (gateDaFalha: GateName): Promise<string[]> => {
    const daRaiz = (relativo: string): string => relative(options.projectRoot, join(paths.root, relativo));
    const pendentes = estado.defects.filter((defeito) => defeito.status !== "RESOLVED");
    const primeiro = pendentes.filter((defeito) => defeito.status === "OPEN" || defeito.status === "ESCALATED").at(-1) ?? pendentes.at(-1);
    const caminhos = (primeiro?.handoffs ?? []).slice(-1).map(daRaiz);
    const gate = primeiro ? primeiro.gates.at(-1) ?? primeiro.discovered.gate : null;
    const reprovada = livro.daFase(session.id).map(({ evidence }) => evidence)
      .filter((evidencia) => evidencia.outcome === "REPAIR_REQUIRED" && (gate === null || evidencia.gate === gate || nomeDoGate(evidencia.gate as DefectGate) === gateDaFalha))
      .at(-1);
    for (const ref of reprovada?.artifactRefs ?? []) caminhos.push(daRaiz(ref.path));
    if (estado.defects.length > 0) caminhos.push(daRaiz(join("defects", `${session.id}.json`)));
    if (pacoteUpstream !== null) caminhos.unshift(pacoteUpstream);
    return [...new Set(caminhos)];
  };

  const fecharFalha = async (gateDaFalha: GateName, causa: string, motivo: string): Promise<PhaseOutcome> => {
    for (const defeito of estado.defects) registro.escalar(defeito);
    estado.ultimoEstado = { tree: codigo.atual.tree, at: now().toISOString() };
    await registro.salvar();
    await transicao({ tipo: "parada", gate: gateDaFalha, defeitos: estado.defects.filter((defeito) => defeito.status === "ESCALATED").map((defeito) => defeito.defectId), motivo });
    await recolher(ciclosAbertos);
    await event("blocked", `${gateDaFalha}: ${causa.split("\n")[0] ?? ""}`, ciclosAbertos);
    relatar({ kind: "phase", id: session.id, state: "falhou", cycle: ciclosAbertos, detail: gateDaFalha });
    if (!noWorktree && (await hasPendingChanges(options.projectRoot))) {
      announce(`[${session.id}] o trabalho parcial desta fase ficou na árvore. Antes de rodar de novo, escolha uma:`);
      announce("           git add -A && git commit -m \"wip: trabalho parcial\"   → o loop revalida a fase e segue");
      announce("           git checkout -- . && git clean -fd                      → descarta e a fase recomeça do zero");
      announce("           ou rode `capivara build` de novo sem mexer: o Core reconhece o próprio parcial e continua dos defeitos registrados");
    }
    const evidencia = await evidenciaDaParada(gateDaFalha);
    return { status: "failed", gate: gateDaFalha, cause: causa, cycles: ciclosAbertos, ...(evidencia.length > 0 ? { evidencia } : {}) };
  };

  /** A sessão não entregou resultado utilizável: para com o parcial preservado (§115.17). */
  const pararPorSessao = async (gateDaFalha: GateName, causa: string): Promise<PhaseOutcome> => {
    announce(`[${session.id}] a sessão não entregou resultado utilizável; parando com o parcial preservado, sem abrir outra chamada de construção automaticamente`);
    return fecharFalha(gateDaFalha, causa, "a sessão de um agente não entregou resultado utilizável; parcial e defeitos preservados para a retomada");
  };

  /** Todas as provas válidas: commit pelo Core e conclusão. */
  const fechar = async (): Promise<PhaseOutcome> => {
    if (options.conciliacao) {
      // A última barreira: nenhum arquivo com marcador de conflito entra no commit da fase (§125 F).
      const comMarca = await comMarcadorDeConflito(arvore, (await alteracoesParaCommit(arvore)).map((entrada) => entrada.caminho));
      if (comMarca.length > 0) {
        return fecharFalha("gate 2 — suíte do projeto", `${detalheDoConflito(comMarca)}: o Core não commita marcador de conflito`, "marcadores de conflito restantes na árvore da fase");
      }
    }
    delete estado.ultimoEstado;
    await registro.salvar();
    const commit = options.commitsEnabled
      ? await commitPhase(arvore, session.number, session.title)
      : { committed: false, message: "commits desabilitados: nenhum repositório Git" };
    if (commit.bloqueios && commit.bloqueios.length > 0) {
      await recolher(ciclosAbertos);
      await event("blocked", `commit bloqueado: ${commit.bloqueios.map((bloqueio) => bloqueio.caminho).join(", ")}`, ciclosAbertos);
      relatar({ kind: "phase", id: session.id, state: "falhou", cycle: ciclosAbertos, detail: "commit bloqueado" });
      announce(`[${session.id}] gates verdes, mas o commit foi BLOQUEADO — ${commit.message}`);
      return { status: "commit-blocked", bloqueios: commit.bloqueios, cause: commit.message, cycles: ciclosAbertos };
    }
    if (!commit.committed && commit.message.includes("já estava implementada")) {
      await concluir("já implementada em HEAD", ciclosAbertos);
      relatar({ kind: "phase", id: session.id, state: "concluído", cycle: ciclosAbertos, detail: "já implementada" });
      announce(`[${session.id}] JÁ IMPLEMENTADA — gates verdes, nada a commitar`);
      return { status: "already-implemented", cycles: ciclosAbertos };
    }
    if (options.commitsEnabled && !commit.committed && noWorktree) {
      /*
       * No worktree, o commit É a entrega (§125 G): sem ele a integração não
       * acha nada, o worktree é fechado e o trabalho se perde. A fase para,
       * o parcial vai para o branch dela, e a causa é a do git.
       */
      return fecharFalha("gate 0 — engine", `a fase passou nos gates, mas o commit no worktree não foi criado: ${commit.message}. O trabalho fica no branch da fase`, "commit da fase recusado pelo git no worktree");
    }
    if (options.commitsEnabled && !commit.committed) announce(`[${session.id}] gates verdes, mas o commit não foi criado — ${commit.message}; o código fica na árvore, fora do histórico`);
    await recolher(ciclosAbertos);
    await concluir(commit.message, ciclosAbertos);
    relatar({ kind: "phase", id: session.id, state: "concluído", cycle: ciclosAbertos, detail: commit.committed ? "commitada" : "completa" });
    announce(`[${session.id}] COMPLETA${commit.committed ? ` — ${commit.message}` : ""}`);
    return { status: "complete", committed: commit.committed, message: commit.message, cycles: ciclosAbertos };
  };

  /**
   * Na retomada, o defeito que espera um reparo documental é reconferido
   * (§125 H): o pacote ainda válido e pendente para a fase de novo, sem gastar
   * ciclos contra o que o documento impede; o pacote velho (documento
   * revisado), abortado ou sumido devolve o defeito à escada.
   */
  const reconferirUpstream = async (): Promise<PhaseOutcome | null> => {
    for (const defeito of estado.defects.filter((cada) => cada.status === "UPSTREAM_REPAIR_REQUIRED")) {
      const pacote = defeito.upstream ? await validarReparo(options.projectRoot, defeito.upstream) : null;
      if (pacote?.ok && pacote.manifest.state !== "ABORTED") {
        pacoteUpstream = relative(options.projectRoot, join(pastaDosReparos(options.projectRoot), pacote.manifest.repairId));
        return fecharFalha(
          nomeDoGate(defeito.gates.at(-1) ?? defeito.discovered.gate),
          `${defeito.detail}\n\nREPARO DOCUMENTAL PENDENTE: o pacote ${pacote.manifest.repairId} continua válido e o documento não mudou; o BUILD não repara o que o documento impede.`,
          "reparo documental pendente: o pacote continua válido",
        );
      }
      defeito.status = "OPEN";
      await transicao({ tipo: "upstream", defeitos: [defeito.defectId], motivo: `o pacote ${defeito.upstream ?? "?"} não vale mais (${pacote && !pacote.ok ? pacote.errors[0] ?? "inválido" : "abortado ou ausente"}): o defeito volta à escada do BUILD` });
    }
    await registro.salvar();
    return null;
  };

  // ------------------------------------------------------------------ laço

  try {
    const pendenteDocumental = await reconferirUpstream();
    if (pendenteDocumental) return pendenteDocumental;
    if (options.integrationFailure) {
      /*
       * A falha de integração chega com o diagnóstico do verificador (§114),
       * que vira o handoff do defeito ANTES de qualquer reparo; a escada decide
       * quem repara — o executor guiado por ele, ou o próprio verificador.
       */
      const recovery = options.integrationFailure;
      // Uma janela própria: o orçamento que a fase gastou no worktree não recusa a recuperação da integração.
      if (estado.implementation === "done") registro.novoCiclo();
      estado.implementation = "done";
      /*
       * A suíte que passou no worktree anterior não prova nada agora: a cópia
       * limpa reprovou, e a diferença costuma estar no que o Git não vê
       * (artefato de build ignorado, dependência aquecida). A suíte deste
       * worktree roda de novo depois da ação.
       */
      const suiteAnterior = livro.atual(session.id, "suite");
      if (suiteAnterior && suiteAnterior.validity.state !== "INVALIDATED") {
        await livro.alterarValidade(suiteAnterior.evidence.evidenceId, "INVALIDATED", "a suíte da árvore integrada reprovou: a prova do worktree anterior não vale para a cópia limpa", `integração ${recovery.attempt}`, now);
      }
      const guidancePrompt = testRepairGuidancePrompt({ language: options.language, sharedContract, ...(options.architecture ? { architectureSlice: options.architecture.texto } : {}), phaseMarkdown: session.markdown, cause: recovery.cause, testCommand: (await options.resolveTest?.())?.command ?? options.testCommand?.command ?? null });
      await writeAtomic(`${paths.prompts}/${evidencePrefix}.guidance.txt`, guidancePrompt);
      announce(`[${session.id}] validador diagnosticando a falha de integração; devolverá evidência, ação concreta e comando de regressão`);
      const diagnosis = await chamarLeitor({ role: "verifier", phase: session, attempt: 1, prompt: guidancePrompt });
      const logDoDiagnostico = await gravarUnico(`${paths.logs}/${evidencePrefix}.guidance.log`, `${diagnosis.stdout}\n${diagnosis.stderr}`);
      const g0Diagnostico = gate0(diagnosis, options.engine);
      if (!g0Diagnostico.green) return await pararPorSessao("gate 0 — engine", g0Diagnostico.cause);
      await achar(
        {
          gate: "G2", nature: "integracao-teste",
          anchors: { tests: testesQueFalharam(recovery.cause), quotes: citacoes(recovery.cause) },
          summary: "a suíte da árvore integrada reprovou",
          detail: `${recovery.cause}\n\nOrientação do validador para esta falha (não é aprovação):\n${diagnosis.stdout}`,
          diagnosedBy: { role: "verifier", ...(diagnosis.sessionId ? { sessionId: diagnosis.sessionId } : {}), log: relative(paths.root, logDoDiagnostico) },
        },
        { raw: diagnosis.stdout, ...(diagnosis.sessionId ? { sessionId: diagnosis.sessionId } : {}), log: relative(paths.root, logDoDiagnostico) },
      );
      /*
       * A falha é da cópia limpa da árvore integrada, não deste worktree quente:
       * rodar a suíte aqui antes de agir poderia dar verde e mandar integrar de
       * novo o mesmo defeito. A primeira coisa é a ação; a prova final é a
       * integração.
       */
      // A integração reprovou de novo: é a validação da tentativa anterior (progresso, ou não).
      const doDefeito = estado.defects.filter((defeito) => defeito.nature === "integracao-teste" && defeito.status !== "RESOLVED").at(-1);
      if (doDefeito) await validarDoGate("G2", new Map([[doDefeito.defectId, { assinatura: doDefeito.anchors.signature }]]), false, true);
      // A segunda volta da integração começa pelo verificador (§114); o executor continua na escada.
      if (doDefeito && recovery.repairByVerifier) doDefeito.order = ["verificador", "executor"];
      const acao = registro.planejar(orcamento, disponivel);
      if (acao === null) {
        // Sem ação possível, integrar de novo seria repetir a mesma falha: para com o diagnóstico.
        const { gate: gateDaFalha, cause } = causaDaParada();
        return await fecharFalha(gateDaFalha, cause, "a recuperação da integração não tem estratégia disponível com informação nova");
      }
      const parada = await executarAcao(acao);
      if (parada) return parada.parar;
      await revalidar(`ação ${estado.actions}`);
    } else if (options.conciliacao) {
      /*
       * A volta de um conflito de integração (§125 F; spec §7). A fase já foi
       * aprovada; os dois commits estão guardados; o worktree tem o aprovado
       * sobre a árvore integrada e só os arquivos em conflito com marcador. Não
       * há sessão de implementação: o defeito é o conflito, com a escada dele
       * (conciliação localizada, depois o executor com o handoff), e o que a
       * resolução mudar é revalidado pelas provas, como qualquer reparo.
       */
      const conflito = options.conciliacao;
      if (estado.implementation === "done") registro.novoCiclo();
      estado.implementation = "done";
      await registro.salvar();
      /*
       * A lista do checkpoint não basta: um parcial de conciliação anterior
       * (wip) pode trazer marcadores em arquivo que não conflitou desta vez.
       * Todo arquivo mudado em relação ao HEAD é varrido.
       */
      const comMarca = await comMarcadorDeConflito(arvore, (await alteracoesParaCommit(arvore)).map((entrada) => entrada.caminho));
      conflitoAtual.marcados = [...new Set([...conflitoAtual.marcados, ...comMarca])];
      const restantes = await conflitosRestantes();
      await transicao({
        tipo: "conflito",
        gate: "INTEGRACAO",
        motivo:
          `conflito ao integrar em ${arquivosDoConflito().join(", ") || "nenhum arquivo"}: os dois commits continuam guardados ` +
          `(HEAD ${conflito.principal.slice(0, 12)} e o aprovado ${conflito.aprovado.commit.slice(0, 12)} em ${conflito.aprovado.branch}); ` +
          "a fase não é reimplementada — só os trechos em conflito são conciliados, e os gates revalidam o que a conciliação atingir",
      });
      if (restantes.length > 0) {
        const doConflito = await achar({
          gate: "INTEGRACAO",
          nature: "integracao-conflito",
          anchors: {},
          summary: `conflito de integração em ${arquivosDoConflito().join(", ")}`,
          detail: detalheDoConflito(restantes),
          ...(conflito.historico ? { observed: conflito.historico } : {}),
          ...(options.architecture ? { components: options.architecture.componentes } : {}),
        });
        while (registro.porId(doConflito.defectId)?.status !== "RESOLVED") {
          const acao = registro.planejar(orcamento, disponivel);
          if (acao === null) {
            return await fecharFalha(
              "gate 2 — suíte do projeto",
              `${doConflito.detail}\nOs dois lados continuam guardados: o HEAD da árvore principal e o branch ${conflito.aprovado.branch}.`,
              "o conflito não foi conciliado dentro do orçamento; nada aprovado foi descartado",
            );
          }
          const parada = await executarAcao(acao);
          if (parada) return parada.parar;
        }
      }
      const efeito = await revalidar("conciliação");
      await transicao({
        tipo: "revalidacao",
        motivo: "depois da conciliação, só o que ela (e a árvore integrada) mudou volta a ser verificado",
        ...(efeito.preservadas.length > 0 ? { preservadas: [...new Set(efeito.preservadas)] } : {}),
        ...(efeito.invalidadas.length + efeito.desconhecidas.length > 0 ? { invalidadas: [...new Set([...efeito.invalidadas, ...efeito.desconhecidas])] } : {}),
      });
    } else if (options.revalidar !== undefined) {
      if (estado.implementation === "done") registro.novoCiclo();
      estado.implementation = "done";
      await registro.salvar();
      const efeito = await revalidar("revalidação documental");
      await transicao({
        tipo: "retomada",
        motivo: `revalidação: ${options.revalidar}; o código é o que já passou, sem sessão de implementação`,
        ...(efeito.invalidadas.length > 0 ? { invalidadas: efeito.invalidadas } : {}),
        ...(efeito.preservadas.length > 0 ? { preservadas: efeito.preservadas } : {}),
      });
    } else if (estado.implementation === "done" && estado.inicio !== undefined && estado.inicio !== null && estado.inicio === codigo.atual.tree && estado.ultimoEstado !== undefined) {
      // O parcial foi descartado, como a parada oferece: o código é o de antes da implementação, e a fase recomeça do zero.
      estado.implementation = "pending";
      await registro.salvar();
      await transicao({ tipo: "retomada", motivo: "o código voltou a ser o de antes da implementação (parcial descartado): a fase recomeça do zero; o histórico dos defeitos fica" });
    } else if (estado.implementation === "done") {
      registro.novoCiclo();
      await registro.salvar();
      const quandoParou = estado.ultimoEstado?.tree ?? null;
      await revalidar("retomada");
      const abertos = estado.defects.filter((defeito) => defeito.status !== "RESOLVED");
      /*
       * Retomar sem sessão de implementação só vale sobre o MESMO código em que
       * a fase parou. Se ele mudou — a árvore integrada andou, o parcial voltou
       * em parte ou nem voltou —, quem retoma é o executor, com o handoff dos
       * defeitos e o que mudou, e só então os gates julgam.
       */
      const mudouDesde = quandoParou === null ? null : await arquivosMudados(arvore, quandoParou, codigo.atual.tree);
      const mesmoCodigo = quandoParou !== null && quandoParou === codigo.atual.tree;
      await transicao({
        tipo: "retomada",
        motivo: mesmoCodigo
          ? `a implementação já aconteceu neste run (${estado.builderSessions} sessão(ões) do executor) e o código é o mesmo de quando a fase parou: segue das provas que não valem${abertos.length > 0 ? ` e dos defeitos ${abertos.map((defeito) => defeito.defectId).join(", ")}` : ""}, sem nova sessão de implementação`
          : `a implementação já aconteceu neste run, mas o código mudou desde que a fase parou${mudouDesde && mudouDesde.length > 0 ? ` (${mudouDesde.slice(0, 6).join(", ")}${mudouDesde.length > 6 ? ", …" : ""})` : ""}: o executor retoma com o handoff dos defeitos antes de os gates julgarem`,
      });
      if (!mesmoCodigo) retomarPeloExecutor = { defeitos: abertos, mudouDesde };
    }

    await event("started", estado.implementation === "done" ? `retomada: ${estado.defects.filter((defeito) => defeito.status !== "RESOLVED").length} defeito(s) aberto(s)` : "implementação", ciclosAbertos);
    announce(estado.implementation === "done" ? `[${session.id}] ${session.title} — retomada` : `[${session.id}] ${session.title}`);
    progressoDaFase(estado.implementation === "done" ? "retomada" : "implementação");

    if (estado.implementation !== "done") {
      gate("G0", "corrente", ciclosAbertos);
      if (!options.environmentApproved) await prepararDependenciasNode(1);
      if (runtimeRecusado) {
        const cause = `O ambiente Node/npm foi recusado por engines. Reinicie a Capivara com uma versão compatível com o projeto; nenhuma sessão de construção foi iniciada.\n${falhaNaPreparacaoNode}`;
        gate("G0", "neutro", ciclosAbertos);
        gate("G2", "vermelho", ciclosAbertos);
        await event("blocked", cause, ciclosAbertos);
        relatar({ kind: "phase", id: session.id, state: "falhou", cycle: ciclosAbertos, detail: cause });
        return { status: "failed", gate: "gate 2 — suíte do projeto", cause, cycles: 0 };
      }
      const ctx = await contexto();
      const prompt = implementPrompt(ctx) + (falhaNaPreparacaoNode ? `\n\n## Dependency preparation — unresolved environment failure\n${falhaNaPreparacaoNode}` : "");
      if (estado.inicio === undefined) estado.inicio = codigo.atual.tree;
      const sessao = await sessaoDoExecutor(prompt);
      // Sessão que caiu sem entregar nada não é implementação feita: a retomada a refaz.
      if (!sessao.result.providerFailure && !(sessao.result.timedOut && !sessao.escreveu)) estado.implementation = "done";
      await registro.salvar();
      if (options.resolveTest) {
        const detectado = await options.resolveTest();
        if (detectado && detectado.command !== options.testCommand?.command) announce(`[${session.id}] comando de teste detectado: ${detectado.command} (${detectado.source})`);
        testeAgora = detectado;
      }
      const g0 = gate0(sessao.result, options.engine);
      if (sessao.result.providerFailure) return await pararPorSessao("gate 0 — engine", (g0 as { cause: string }).cause);
      if (sessao.result.timedOut) {
        if (!sessao.escreveu) return await pararPorSessao("gate 0 — engine", (g0 as { cause: string }).cause);
        // O tempo acabou com trabalho escrito: o parcial é julgado uma vez, sem outra sessão de construção.
        julgandoParcial = true;
        announce(`[${session.id}] a sessão do executor foi encerrada pelo limite do harness depois de escrever; julgando o parcial uma vez, sem outra sessão de construção`);
      } else if (!g0.green) {
        await achar({ gate: "G0", nature: "engine", anchors: {}, summary: "a sessão do executor não terminou com resultado utilizável", detail: g0.cause });
      }
    } else if (options.resolveTest) {
      testeAgora = await options.resolveTest();
    }

    if (retomarPeloExecutor !== null) {
      const { defeitos, mudouDesde } = retomarPeloExecutor;
      if (defeitos.length > 0) {
        const parada = await executarAcao({ estrategia: "executor", defeitos });
        if (parada) return parada.parar;
      } else {
        const ctx = await contexto();
        const prompt = fixPrompt({
          ...ctx,
          gate: "gate 0 — engine",
          cause: `A fase parou numa execução anterior sem defeito registrado (a sessão não concluiu). O código mudou desde então${mudouDesde && mudouDesde.length > 0 ? `: ${mudouDesde.join(", ")}` : ""}. Leia o código atual e complete a fase.`,
          previousWroteNothing: false,
        });
        const sessao = await sessaoDoExecutor(prompt);
        const g0 = gate0(sessao.result, options.engine);
        if (!g0.green && (sessao.result.timedOut || sessao.result.providerFailure)) return await pararPorSessao("gate 0 — engine", g0.cause);
      }
      await revalidar("retomada pelo executor");
    }

    for (;;) {
      // A ordem é a dependência técnica: o G3 parte da suíte verde, o G4 do G3.
      const g0Aberto = estado.defects.some((defeito) => defeito.nature === "engine" && defeito.status === "OPEN");
      const pendente = g0Aberto ? null : !(await g2Valido()) ? "G2" : !(await g3Valido()) ? "G3" : !(await g4Valido()) ? "G4" : null;
      if (pendente === null && !g0Aberto) return await fechar();
      if (pendente !== null) {
        const resultado = pendente === "G2" ? await verificarSuite() : pendente === "G3" ? await verificarTasks() : await verificarFluxos();
        if (typeof resultado === "object") return resultado.parar;
        if (resultado === "verde") {
          // Se o gate passa e a validade dele continua falsa para o mesmo conteúdo, o defeito é do harness: parar, não repetir.
          verdesSemProva.set(pendente, (verdesSemProva.get(pendente) ?? 0) + 1);
          if ((verdesSemProva.get(pendente) ?? 0) > 3) {
            return await fecharFalha(
              nomeDoGate(pendente),
              `Isto é do harness: o ${pendente} passou ${verdesSemProva.get(pendente)} vezes seguidas sem que a prova dele valesse para o mesmo conteúdo; a fase para em vez de repetir o gate.`,
              "defeito do harness: verde sem prova que se sustente",
            );
          }
          continue;
        }
      }
      if (julgandoParcial) {
        const { gate: gateDaFalha, cause } = causaDaParada();
        return await pararPorSessao(gateDaFalha, cause);
      }
      for (;;) {
        const acao = registro.planejar(orcamento, disponivel);
        if (acao !== null) {
          const parada = await executarAcao(acao);
          if (parada) return parada.parar;
          verdesSemProva.clear();
          const efeito = await revalidar(`ação ${estado.actions}`);
          if (efeito.invalidadas.length > 0 || efeito.desconhecidas.length > 0) {
            await transicao({
              tipo: "revalidacao",
              motivo: "a ação mudou o código: só o que ela atingiu volta a ser verificado",
              ...(efeito.preservadas.length > 0 ? { preservadas: [...new Set(efeito.preservadas)] } : {}),
              invalidadas: [...new Set([...efeito.invalidadas, ...efeito.desconhecidas])],
            });
          } else if (efeito.preservadas.length > 0) {
            await transicao({ tipo: "preservada", preservadas: [...new Set(efeito.preservadas)], motivo: "a ação não mudou o código do produto: as provas continuam valendo" });
          }
          break;
        }
        if (registro.semSaida(possivel)) {
          const { gate: gateDaFalha, cause } = causaDaParada();
          if (declaredComplete(estado.defects.map((defeito) => defeito.detail).join("\n"))) announce(`[${session.id}] o executor declarou conclusão, mas ${gateDaFalha} reprovou`);
          await encaminharUpstream();
          if (pacoteUpstream !== null) {
            return await fecharFalha(
              gateDaFalha,
              `${cause}\n\nREPARO DOCUMENTAL NECESSÁRIO: o defeito é do documento aprovado, segundo o diagnóstico, e o BUILD esgotou os reparos compatíveis. ` +
                `O pacote validado está em ${pacoteUpstream}; nenhum documento foi alterado.`,
              "esgotamento técnico com encaminhamento documental validado",
            );
          }
          return await fecharFalha(gateDaFalha, cause, "esgotamento técnico: nenhuma estratégia restante tem informação nova para os defeitos abertos");
        }
        if (ciclosAbertos >= maxCycles) {
          const { gate: gateDaFalha, cause } = causaDaParada();
          return await fecharFalha(gateDaFalha, cause, `os ${maxCycles} ciclo(s) desta execução se esgotaram; estado, código e evidências preservados para a retomada`);
        }
        ciclosAbertos += 1;
        registro.novoCiclo();
        await registro.salvar();
        await event("started", `ciclo de correção ${ciclosAbertos}`, ciclosAbertos);
        announce(`[${session.id}] ciclo de correção ${ciclosAbertos}/${maxCycles}`);
        progressoDaFase(`ciclo ${ciclosAbertos}/${maxCycles}`);
        const preservadas = livro.daFase(session.id).filter((evidencia) => evidencia.validity.state === "VALID" && evidencia.evidence.outcome !== "REPAIR_REQUIRED" && (evidencia.evidence.gate === "G2" || evidencia.evidence.gate === "G3" || evidencia.evidence.gate === "G4"));
        // Verde é o gate cuja prova vale para ESTE conteúdo — não o que tem alguma evidência válida.
        if (await g2Valido()) gate("G2", "verde", ciclosAbertos);
        if (await g3Valido()) gate("G3", "verde", ciclosAbertos);
        const fluxosAgora = livro.atual(session.id, "fluxos");
        if (options.flows && fluxosAgora && fluxosAgora.validity.state === "VALID" && fluxosAgora.evidence.outcome !== "REPAIR_REQUIRED" && fluxosAgora.evidence.inputs.code?.tree === codigo.atual.tree) gate("G4", "verde", ciclosAbertos);
        await transicao({
          tipo: "ciclo",
          defeitos: estado.defects.filter((defeito) => defeito.status === "OPEN" || defeito.status === "ESCALATED").map((defeito) => defeito.defectId),
          motivo: "o orçamento do ciclo anterior se esgotou; contadores renovados, código, histórico e evidências preservados, sem voltar à implementação",
          ...(preservadas.length > 0 ? { preservadas: [...new Set(preservadas.map((evidencia) => evidencia.evidence.checkId))] } : {}),
        });
      }
    }
  } catch (erro) {
    if (erro instanceof LimiteEsgotado) return { status: "rate-limit-exhausted", waits };
    if (erro instanceof FalhaDeRevisao) {
      await event("blocked", `gate 0 — engine: ${erro.message}`, ciclosAbertos);
      relatar({ kind: "phase", id: session.id, state: "falhou", cycle: ciclosAbertos, detail: "sessão de revisão G4 interrompida" });
      announce(`[${session.id}] ${erro.message}`);
      return { status: "failed", gate: "gate 0 — engine", cause: erro.message, cycles: ciclosAbertos };
    }
    if (erro instanceof PrincipalAlterada) {
      const cause = `a árvore principal mudou durante o trabalho em worktree (${erro.caminhos.join(", ")}). ` +
        `A fase foi interrompida antes de aceitar o resultado do agente. Nada foi apagado, registrado ou integrado. ` +
        `As alterações da principal continuam em ${options.projectRoot}; o trabalho isolado, se houver, será preservado separadamente. ` +
        "Confira as alterações antes de retomar; com agentes concorrentes, esta conferência não determina quem escreveu.";
      await event("blocked", cause, ciclosAbertos);
      announce(`[${session.id}] PARADA DE ISOLAMENTO — ${cause}`);
      return { status: "commit-blocked", bloqueios: erro.caminhos.map((caminho) => ({ caminho, motivo: "árvore principal alterada durante trabalho isolado" })), cause, cycles: ciclosAbertos };
    }
    if (erro instanceof AutoridadeViolada) {
      const publicou = publicacaoProvavel(erro.movidas);
      const cause =
        `o ${erro.papel} mexeu no Git por conta própria — referências movidas durante a chamada: ${erro.movidas.join(", ")}. ` +
        "Só o Core registra e publica: nada desta fase foi registrado nem integrado, e o que o agente fez não foi desfeito. " +
        `${publicou ? "O rastreio remoto mudou: o agente provavelmente fez push — confira o remoto. " : ""}` +
        "Confira com `git log --all --oneline -10` e `git reflog`, decida o que manter, e rode `capivara build` de novo.";
      await event("blocked", `referências movidas pelo agente: ${erro.movidas.join(", ")}`, ciclosAbertos);
      relatar({ kind: "phase", id: session.id, state: "falhou", cycle: ciclosAbertos, detail: "git por fora do Core" });
      announce(`[${session.id}] PARADA DE AUTORIDADE — ${cause}`);
      return {
        status: "commit-blocked",
        bloqueios: erro.movidas.map((ref) => ({ caminho: ref, motivo: "referência movida pelo agente durante a chamada" })),
        cause,
        cycles: ciclosAbertos,
      };
    }
    if (!(erro instanceof CredencialRecusada)) throw erro;

    await event("blocked", `credencial recusada pelo provider ${options.engine}: ${erro.evidencia}`, ciclosAbertos);
    relatar({ kind: "phase", id: session.id, state: "falhou", cycle: ciclosAbertos, detail: "credencial recusada" });
    announce(`[${session.id}] o provider ${options.engine} recusou a credencial — isto não é defeito da fase:`);
    announce(`           ${erro.evidencia}`);
    announce(`           renove com \`${options.engine} login\` e rode \`capivara build\` de novo`);
    if (!noWorktree && (await hasPendingChanges(options.projectRoot))) {
      announce("           o trabalho desta fase ficou na árvore; antes de rodar de novo:");
      announce("           git add -A && git commit -m \"wip: trabalho parcial\"   → o loop revalida a fase e segue");
    }
    return { status: "credential-rejected", engine: options.engine, evidence: erro.evidencia, cycles: ciclosAbertos };
  }
}

/** A task cujo critério a triagem citou — a âncora comum entre G3 e G4 (§125 D). */
function tarefaPeloCriterio(tasks: readonly TaskBlock[], criterio: string): number | undefined {
  const normal = (texto: string): string => texto.toLowerCase().replace(/[^a-z0-9à-ú]+/gu, " ").trim();
  const alvo = normal(criterio);
  if (alvo.length < 12) return undefined;
  const achadas = tasks.filter((task) => task.acceptanceCriteria.some((linha) => normal(linha).includes(alvo) || alvo.includes(normal(linha))));
  return achadas.length === 1 ? achadas[0]!.index : undefined;
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

