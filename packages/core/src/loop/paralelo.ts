/**
 * O build paralelo: várias fases ao mesmo tempo, cada uma no seu worktree (§97).
 *
 * O que NÃO muda em relação ao serial é a parte que importa: cada fase passa
 * pelos mesmos cinco gates, no mesmo `runPhase`, com o mesmo verificador
 * independente, e só entra no produto com tudo verde. O que muda é onde ela roda
 * e como volta:
 *
 *   escalonador → worktree próprio → runPhase (gates no worktree)
 *     → fila de integração (uma fase por vez) → cherry-pick na árvore principal
 *     → suíte da árvore integrada → fase concluída
 *
 * A integração é serial de propósito. Duas fases verdes cada uma sobre a sua
 * base podem não ser verdes juntas, e a única forma de saber é rodar a suíte na
 * árvore com as duas. Se o cherry-pick conflita, ou a suíte da árvore integrada
 * reprova, a integração é desfeita e a fase volta para a fila para rodar
 * SOZINHA sobre a árvore nova — e aí, por construção, não há com quem conflitar.
 * Teste integrado reprovado também recebe diagnóstico e correção pelo executor,
 * com reparo limitado pelo verificador; exclusividade não consome essa janela.
 *
 * Nada aqui é decidido por modelo. A ordem, o agente e o desfecho da integração
 * saem do escalonador, do git e da suíte.
 */

import { readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { writeAtomic } from "../state/atomic.js";
import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { admitirIntervalo, alteracoesParaCommit, artefatosLocaisIgnorados, descreverBloqueios, lerStatus } from "./admissao.js";
import { prepararAmbiente } from "./ambiente.js";
import { criarBancosDeTeste } from "./test-databases.js";
import { bloqueadas, dependenciasEfetivas, proximas, type EstadoNaAgenda } from "./escalonador.js";
import { defaultTestRunner, gate2, type TestRunner } from "./gates.js";
import { falhaDeInstalacaoNode, inspecionarInstalacaoNode, registrarInstalacaoNode, MARCA_DE_INSTALACAO_NODE } from "./instalacao-node.js";
import type { Isolamento } from "./isolamento.js";
import type { BuildProgressListener, WorkerProgressListener } from "./progress.js";
import type { IntegrationFailure, PhaseOutcome } from "./runner.js";
import type { PhaseSession } from "./split.js";
import {
  abrirWorktree,
  abrirValidacaoIntegrada,
  alteradosNaPrincipal,
  branchTemTrabalho,
  branchDaFase,
  cabeca,
  comandoDeInstalacao,
  conferirWorktreeAprovado,
  desfazerSemApagar,
  fecharWorktree,
  guardarParcial,
  impedimentosDaPrincipal,
  integrar,
  mexeuNasDependencias,
  pastaDosWorktrees,
  preservarAprovado,
  trazerRoteiros,
  historicoDoConflito,
  type ConciliacaoDaIntegracao,
  type ParcialGuardado,
  type Worktree,
} from "./worktree.js";

export interface AgenteDoPool {
  /** O provider, para o limite de uso e o gate 0 lerem a saída certa. */
  engine: string;
  /** `codex/gpt-5.5 · high`, para a tela. */
  label: string;
  systemInstall: boolean;
}

export interface ExecucaoDaFase {
  workRoot: string;
  worker: number;
  engine: string;
  systemInstall: boolean;
  preferredPort: number;
  /** Conferência serializada com a integração; não observa cherry-pick pela metade. */
  conferirPrincipal: () => Promise<string[]>;
  integrationFailure?: IntegrationFailure;
  /** A fase volta de um conflito de integração para conciliar só o que conflitou (§125 F). */
  conciliacao?: ConciliacaoDaIntegracao;
}

export interface ParaleloOptions {
  projectRoot: string;
  runId: string;
  /** Na ordem do plano. */
  sessions: readonly PhaseSession[];
  agentes: readonly AgenteDoPool[];
  maxConcurrency: number;
  maxVerifierRepairs?: number;
  keepGoing: boolean;
  /** Refaz explicitamente mesmo uma fase aprovada cuja integração ficou suspensa. */
  rebuildAll?: boolean;
  /** A fase já fechada antes (neste run ou em outro): devolve true e o build não a refaz. */
  jaFechada: (session: PhaseSession) => boolean;
  rodar: (session: PhaseSession, execucao: ExecucaoDaFase) => Promise<PhaseOutcome>;
  /** A fase entrou no produto: ledger, regressão do gate 4, tudo o que o serial faz no verde. */
  aposIntegrar: (session: PhaseSession, outcome: PhaseOutcome) => Promise<void>;
  /**
   * As aprovações de task da fase saem do registro: o que se aprovou foi sobre um
   * código que não está na árvore principal. Antes de refazer depois de um
   * conflito, e em todo desfecho em que o trabalho da fase fica fora do produto
   * (§99) — senão a retomada carimba DONE em código que só existe num branch.
   */
  esquecer: (session: PhaseSession) => Promise<void>;
  isolamento: () => Promise<Isolamento>;
  /** O comando de teste da árvore principal, resolvido na hora — a fase pode tê-lo acabado de criar. */
  comandoDeTeste: () => Promise<string | null>;
  testRunner?: TestRunner;
  environmentApproved?: boolean;
  /** Roda `npm install` e a migração do ambiente na árvore principal; substituível no teste. */
  instalar?: TestRunner;
  systemInstall: boolean;
  /** A porta do gate 4 que o primeiro agente prefere; os seguintes, as vizinhas. */
  portaBase: number;
  /**
   * A fundação que o gate 4 exige ainda falta na árvore principal (§110): o
   * projeto não declara `start`. Perguntado uma vez, antes da primeira leva.
   */
  semEntrypoint?: () => Promise<boolean>;
  /** A fase percorre fluxos no gate 4. */
  comFluxos?: (session: PhaseSession) => boolean;
  /**
   * Os arquivos que a arquitetura do PLAN fixa para os componentes da fase:
   * duas fases que dividem um deles não rodam ao mesmo tempo (§125 F).
   */
  arquivosDaFase?: (session: PhaseSession) => readonly string[];
  announce: (message: string) => void;
  onProgress?: BuildProgressListener;
  onWorker?: WorkerProgressListener;
  environment?: NodeJS.ProcessEnv;
  now: () => Date;
}

export interface ParaleloResultado {
  /** As fases que rodaram ou foram puladas, na ordem do plano. */
  relatorios: { session: PhaseSession; outcome: PhaseOutcome }[];
  /** A fase que parou o build, quando parou. */
  parada: { session: PhaseSession; outcome: PhaseOutcome } | null;
}

type ResultadoDaIntegracao =
  | { desfecho: "integrada" }
  | { desfecho: "refazer"; motivo: string; testFailure?: true; conflito?: { arquivos: string[]; principal: string } }
  | { desfecho: "falhou"; outcome: PhaseOutcome };

/** O checkpoint de quem volta de um conflito (versão 2); a versão 1 é o commit aprovado à espera de integrar. */
interface CheckpointDoConflito {
  versao: 2;
  motivo: "conflito";
  arquivos: string[];
  principal: string;
  aprovado: { branch: string; commit: string };
}

function lerConflito(bruto: string | null): CheckpointDoConflito | null {
  if (bruto === null) return null;
  try {
    const lido = JSON.parse(bruto) as Partial<CheckpointDoConflito>;
    if (lido.versao !== 2 || lido.motivo !== "conflito" || !Array.isArray(lido.arquivos) || typeof lido.principal !== "string") return null;
    if (!lido.aprovado || typeof lido.aprovado.branch !== "string" || !/^[0-9a-f]{40,64}$/u.test(lido.aprovado.commit ?? "")) return null;
    return lido as CheckpointDoConflito;
  } catch {
    return null;
  }
}

function descreverFalha(outcome: PhaseOutcome): string {
  if (outcome.status === "failed") return `${outcome.gate}: ${outcome.cause}`;
  if (outcome.status === "credential-rejected") return `o provider ${outcome.engine} recusou a credencial: ${outcome.evidence}`;
  if (outcome.status === "rate-limit-exhausted") return "limite de uso esgotado";
  if (outcome.status === "commit-blocked") return outcome.cause;
  return outcome.status;
}

/** Uma fila de uma pessoa só: o que entra espera o anterior sair. */
function filaUnica(): <T>(trabalho: () => Promise<T>) => Promise<T> {
  let cauda: Promise<unknown> = Promise.resolve();
  return <T>(trabalho: () => Promise<T>): Promise<T> => {
    const vez = cauda.then(trabalho);
    cauda = vez.catch(() => undefined);
    return vez;
  };
}

export async function executarEmParalelo(options: ParaleloOptions): Promise<ParaleloResultado> {
  const { projectRoot, announce } = options;
  const paths = runPaths(projectRoot, options.runId);
  const estados = new Map<string, EstadoNaAgenda>();
  const exclusivas = new Set<string>();
  const recuperacoesDeTeste = new Map<string, IntegrationFailure>();
  const passagensDeIntegracao = new Map<string, number>();
  const relatorios = new Map<string, PhaseOutcome>();
  const porId = new Map(options.sessions.map((session) => [session.id, session]));
  const naFilaDeIntegracao = filaUnica();
  const rodando = new Map<string, Promise<void>>();
  const livres = Array.from({ length: Math.min(options.maxConcurrency, options.agentes.length) }, (_, indice) => indice);
  let parada: ParaleloResultado["parada"] = null;
  let suspenso: string | null = null;
  let fatal = false;
  const naoVersionadosIniciais = new Set((await alteracoesParaCommit(projectRoot)).filter((e) => e.naoVersionado).map((e) => e.caminho));
  const conferirPrincipal = (): Promise<string[]> => naFilaDeIntegracao(async () => {
    const alterados = (await alteracoesParaCommit(projectRoot))
      .filter((e) => !e.naoVersionado || (!naoVersionadosIniciais.has(e.caminho) && e.caminho !== `node_modules/${MARCA_DE_INSTALACAO_NODE}`))
      .map((e) => e.caminho).sort();
    if (alterados.length > 0) fatal = true;
    return alterados;
  });
  /**
   * O primeiro erro que ninguém tratou (§99). Ele não derruba o laço na hora:
   * derrubar deixava os outros agentes rodando sem lock e integrando depois de o
   * build ter saído. Ele para tudo o que é novo, espera os que estão rodando, e
   * só então sobe — como no serial, mas sem órfãos.
   */
  let erroInesperado: { erro: unknown } | null = null;
  /**
   * O HEAD da principal que o INTEGRADOR deixou (§101). Só ele a move; se ela
   * estiver noutro commit quando a próxima integração chega, alguém — um agente
   * com acesso de sistema — commitou nela por fora.
   */
  let cabecaConhecida: string | null = await cabeca(projectRoot).catch(() => null);
  let ultimaIntegrada: PhaseSession | null = null;
  /** O versionado que os passos do harness alteraram na árvore integrada (§102). */
  let sujeiraDoHarness: { session: PhaseSession; causa: string } | null = null;

  const evento = async (subject: string, status: "complete" | "retry" | "blocked", detail: string): Promise<void> => {
    await appendEvent(paths.events, { timestamp: options.now().toISOString(), stage: "implement", subject, attempt: 1, status, detail });
  };
  /** Onde o que não pode ir para o Git é guardado, por fase e instante (§99, §100). */
  const pastaDeRecuperacao = (session: PhaseSession): string =>
    join(paths.root, "recuperacao", `${session.id}-${options.now().toISOString().replace(/[:.]/g, "-")}`);
  const agente = (slot: number, estado: "livre" | "preparando" | "trabalhando" | "integrando", phaseId: string | null, detail = ""): void =>
    options.onWorker?.({ slot, state: estado, phaseId, detail });

  for (const session of options.sessions) {
    if (options.jaFechada(session)) {
      estados.set(session.id, "integrada");
      relatorios.set(session.id, { status: "already-implemented", cycles: 0 });
    }
  }

  /*
   * A fundação do gate 4, preparada uma vez antes do paralelo (§110).
   *
   * Sem `start`, cada fase com fluxo precisa criá-lo — e o servidor que honre
   * `PORT` e `HOST` mora na fundação compartilhada. No `build-96756ca336b0` a
   * P03 e a P04 escreveram o mesmo código na mesma `configuracao.ts`, cada uma no
   * seu worktree, e a P04 verde conflitou na integração. A primeira fase pendente
   * com fluxo roda SOZINHA — o mesmo mecanismo de quem volta de um conflito —, cria
   * o `start` pelos gates de sempre, e as seguintes abrem o worktree do HEAD que
   * já o tem. Com o `start` presente, nada disto acontece.
   */
  if (options.semEntrypoint && options.comFluxos) {
    const comFluxos = options.comFluxos;
    const preparadora = options.sessions.find((session) => estados.get(session.id) !== "integrada" && comFluxos(session));
    if (preparadora && (await options.semEntrypoint())) {
      exclusivas.add(preparadora.id);
      announce(
        `[${preparadora.id}] o projeto ainda não declara \`start\`, que o gate 4 exige: esta fase roda sozinha e o cria; ` +
          "as outras fases com fluxo saem depois, sobre a árvore que já o tem",
      );
    }
  }

  /** As fases como o escalonador as vê, com os arquivos que a arquitetura fixa para cada uma (§125 F). */
  const agendaveis = options.sessions.map((session) => ({ ...session, arquivos: options.arquivosDaFase?.(session) ?? [] }));

  /** O verde que conflitou na integração, por fase: onde ele ficou (§110). */
  const preservados = new Map<string, { branch: string; commit: string }>();
  const aprovados = new Map<string, PhaseOutcome>();
  const integracoesSuspensas = new Set<string>();
  const checkpointDaIntegracao = (id: string): string => join(paths.root, "integracoes", `${id}.json`);
  // Quem pede para refazer tudo descarta as integrações suspensas de execuções anteriores — uma vez, antes de qualquer fase sair.
  if (options.rebuildAll) {
    for (const session of options.sessions) await rm(checkpointDaIntegracao(session.id), { force: true });
  }

  for (const slot of livres) agente(slot, "livre", null);

  // Ajustes de dependência são ditos uma vez, antes de qualquer fase sair.
  for (const session of options.sessions) {
    const { ajuste } = dependenciasEfetivas(session, options.sessions);
    if (ajuste !== "" && estados.get(session.id) !== "integrada") announce(`[${session.id}] ${ajuste}`);
  }

  /** Integra, com a suíte da árvore integrada como juiz. Devolve o que fazer com a fase. */
  const integrarFase = async (
    session: PhaseSession,
    worktree: Worktree,
    slot: number,
  ): Promise<ResultadoDaIntegracao> =>
    naFilaDeIntegracao(async () => {
      /*
       * Depois de uma falha fatal a árvore principal precisa de alguém, e nada
       * mais entra nela (§99). A fase fica verde no branch dela, para a próxima
       * execução — e é perguntado aqui DENTRO da fila, porque a fatal pode ter
       * acontecido enquanto esta fase esperava a vez.
       */
      if (fatal) {
        return {
          desfecho: "falhou" as const,
          outcome: {
            status: "failed" as const,
            gate: "gate 2 — suíte do projeto" as const,
            cause: sujeiraDoHarness
              ? `não foi integrada: ${sujeiraDoHarness.causa}`
              : "não foi integrada: uma falha fatal anterior deixou a árvore principal precisando de atenção, e nada mais entra nela neste build",
            cycles: 0,
          },
        };
      }
      try {
        const atual = await cabeca(projectRoot);
        if (cabecaConhecida !== null && atual !== cabecaConhecida) {
          fatal = true;
          return {
            desfecho: "falhou" as const,
            outcome: {
              status: "commit-blocked" as const,
              bloqueios: [{ caminho: "HEAD da árvore principal", motivo: "movido por fora do integrador" }],
              cause:
                `a árvore principal recebeu commit que não é do integrador: o HEAD era ${cabecaConhecida.slice(0, 12)} e agora é ${atual.slice(0, 12)}. ` +
                "Só o Core registra no Git; nada mais é integrado neste build, e nada foi desfeito — confira com `git log --oneline -10` e `git reflog`",
              cycles: 0,
            },
          };
        }
        const resultado = await integrarNaFila(session, worktree, slot);
        if (resultado.desfecho === "integrada") ultimaIntegrada = session;
        return resultado;
      } catch (erro) {
        /*
         * A árvore principal ficou num estado que o integrador não sabe
         * desfazer — um `reset --keep` recusado porque alguém escreveu nela.
         * Nenhuma fase nova sai sobre isso, com ou sem --keep-going.
         */
        fatal = true;
        const causa = erro instanceof Error ? erro.message.split("\n")[0] ?? "" : String(erro);
        return {
          desfecho: "falhou",
          outcome: { status: "failed", gate: "gate 2 — suíte do projeto", cause: `a integração parou no meio e a árvore principal precisa de atenção: ${causa}`, cycles: 0 },
        };
      } finally {
        // O que o integrador deixou — integrado, desfeito ou intocado — é a nova referência.
        cabecaConhecida = await cabeca(projectRoot).catch(() => cabecaConhecida);
      }
    });

  const integrarNaFila = async (
    session: PhaseSession,
    worktree: Worktree,
    slot: number,
  ): Promise<ResultadoDaIntegracao> => {
    const passagem = (passagensDeIntegracao.get(session.id) ?? 0) + 1;
    passagensDeIntegracao.set(session.id, passagem);
    const integrationPrefix = passagem === 1 ? session.id : `${session.id}.integration-${passagem - 1}`;
    agente(slot, "integrando", session.id);
    options.onProgress?.({ kind: "phase", id: session.id, state: "em andamento", cycle: 0, detail: "integrando" });
    /** A árvore principal tem algo que não é do integrador: para tudo, sem tocar em nada (§99). */
    const pararSemTocar = (causa: string): { desfecho: "falhou"; outcome: PhaseOutcome } => {
      fatal = true;
      return { desfecho: "falhou", outcome: { status: "failed", gate: "gate 2 — suíte do projeto", cause: causa, cycles: 0 } };
    };
    const desfazer = async (motivo: string): Promise<{ desfecho: "refazer"; motivo: string } | { desfecho: "falhou"; outcome: PhaseOutcome }> => {
      const desfeita = await desfazerSemApagar(projectRoot, antes, {
        naoVersionadosAntes: naoVersionados,
        guardarEm: `${worktree.branch}-reprovada`,
        mensagem: `capivara: árvore principal quando a integração da ${session.id} foi reprovada (${motivo.split("\n")[0] ?? ""})`,
        pastaDeRecuperacao: pastaDeRecuperacao(session),
      });
      if (desfeita.limpo) {
        if (desfeita.recuperacao) announce(`[${session.id}] banco gerado na integração preservado fora do Git em ${desfeita.recuperacao}; a principal voltou ao estado anterior`);
        return { desfecho: "refazer", motivo };
      }
      /*
       * A árvore voltou a ser a de antes da integração: nada a commitar, e por
       * isso o preflight seguinte não tem o que mandar commitar. O que estava
       * nela não se perdeu — está no branch guardado, para quem quiser ler.
       */
      return pararSemTocar(
        `${motivo}; e a árvore principal foi alterada durante a integração (${desfeita.arquivos.join(", ")}). ` +
          `Nada da integração reprovada ficou na árvore: o HEAD e os arquivos voltaram a ser os de antes da fase. ` +
          `Nada se perdeu: os versionados estão no branch ${desfeita.guardado} (git show ${desfeita.guardado})` +
          `${desfeita.recuperacao ? `, e o que não é versionado ou pode ter segredo foi copiado, fora do Git, para ${desfeita.recuperacao}` : ""}; ` +
          `o trabalho da fase está no branch ${worktree.branch}`,
      );
    };
    const pararPorAmbiente = async (motivo: string): Promise<{ desfecho: "falhou"; outcome: PhaseOutcome }> => {
      const desfeita = await desfazer(motivo);
      if (desfeita.desfecho === "falhou") return desfeita;
      const commit = await cabeca(worktree.dir);
      await writeAtomic(checkpointDaIntegracao(session.id), JSON.stringify({ versao: 1, worktree, commit, outcome: aprovados.get(session.id) }));
      integracoesSuspensas.add(session.id);
      return pararSemTocar(
        `falha de ambiente na integração: ${motivo}. A fase aprovada não será reconstruída; ` +
          `o commit ${commit.slice(0, 12)} e o worktree ${worktree.dir} foram preservados no branch ${worktree.branch}. ` +
          "Retome o mesmo build após reparar o ambiente: o Core tentará integrar este mesmo commit sem chamar o construtor",
      );
    };

    /*
     * O que os commits da fase TRAZEM passa pela política de admissão antes do
     * cherry-pick (§100) — lido dos objetos do Git, não da palavra do worker:
     * o agente pode ter commitado por conta própria. Bloqueado, nada entra; o
     * branch fica, porque apagá-lo seria perder o trabalho, e a mensagem diz
     * que ele não deve ser publicado.
     */
    const sensiveis = await admitirIntervalo(projectRoot, worktree.base, worktree.branch);
    if (sensiveis.length > 0) {
      return {
        desfecho: "falhou",
        outcome: {
          status: "commit-blocked",
          bloqueios: sensiveis,
          cause:
            `a integração recusou a fase: os commits dela trazem arquivo sensível — ${descreverBloqueios(sensiveis)}. ` +
            `Nada entrou na árvore principal. O branch ${worktree.branch} foi mantido com esse conteúdo: não o publique; ` +
            `para descartá-lo, \`git branch -D ${worktree.branch}\``,
          cycles: 0,
        },
      };
    }

    const { impedimentos, naoVersionados } = await impedimentosDaPrincipal(projectRoot, worktree);
    if (impedimentos.length > 0) {
      return pararSemTocar(
        `a árvore principal tem alterações que não são do integrador (${impedimentos.join(", ")}); ` +
          `integrar por cima as sobrescreveria ou faria a suíte julgar uma árvore que não é o HEAD. ` +
          `Nada foi tocado; as alterações da principal continuam nela. O branch da fase é ${worktree.branch}; confira seu conteúdo antes de recuperar o trabalho`,
      );
    }
    const antes = await cabeca(projectRoot);
    const integracao = await integrar(projectRoot, worktree);
    if (integracao.status === "recusada") {
      return pararSemTocar(`o git recusou integrar a fase sem conflito de conteúdo: ${integracao.motivo}. O trabalho da fase está no branch ${worktree.branch}`);
    }
    if (integracao.status === "conflito") {
      return {
        desfecho: "refazer",
        motivo: `conflito ao integrar${integracao.arquivos.length > 0 ? ` em ${integracao.arquivos.join(", ")}` : ""}`,
        conflito: { arquivos: integracao.arquivos, principal: antes },
      };
    }

    if (integracao.status === "integrada") {
      /*
       * A fase pode ter acrescentado dependência. A árvore principal não tem
       * o `node_modules` do worktree, e a suíte integrada reprovaria por um
       * pacote que só faltava instalar.
       */
      let instalacoes = 0;
      const instalarNaPrincipal = async (motivo: string): Promise<{ exitCode: number; output: string }> => {
        const comando = await comandoDeInstalacao(projectRoot);
        announce(`[${session.id}] ${motivo}; instalando na árvore integrada com \`${comando}\``);
        instalacoes += 1;
        const resultado = await options.instalar!(comando, projectRoot);
        await writeAtomic(join(paths.logs, `${integrationPrefix}.install-integracao-${instalacoes}.log`), `$ ${comando}\nexit: ${resultado.exitCode}\n${resultado.output}`);
        if (resultado.exitCode === 0) await registrarInstalacaoNode(projectRoot);
        return resultado;
      };
      const instalacao = await inspecionarInstalacaoNode(projectRoot, options.environmentApproved ? { sondar: false } : {});
      const manifestoMudou = mexeuNasDependencias(integracao.arquivos) && instalacao.estado !== "nao-se-aplica";
      const precisaInstalar = manifestoMudou || instalacao.estado === "ausente" || instalacao.estado === "incompativel";
      if (precisaInstalar) {
        if (!options.instalar) return pararPorAmbiente(`${instalacao.motivo}; não há instalador configurado`);
        const instalado = await instalarNaPrincipal(manifestoMudou ? "a fase mexeu nas dependências" : instalacao.motivo);
        if (instalado.exitCode !== 0) {
          const motivo = `a instalação falhou; saída completa em ${join(paths.logs, `${integrationPrefix}.install-integracao-${instalacoes}.log`)}`;
          // Um lockfile incoerente é uma entrega incorreta, e não um runtime avariado.
          if (/npm (?:error|ERR!)[\s\S]*(?:package\.json and .*lock.*(?:in sync|sync)|Missing: .* from lock file|Invalid: lock file)/i.test(instalado.output)) {
            return desfazer(`${motivo}: manifesto e lockfile não estão sincronizados`);
          }
          return pararPorAmbiente(motivo);
        }
      }

      /*
       * O mesmo preparo que o runner faz antes do gate 2 no worktree (§99): o
       * `.env` semeado do `.env.example` e a migração do ambiente descartável.
       * Sem ele, a suíte que lê o ambiente reprovava aqui o que passou lá, e a
       * fase era refeita até falhar.
       */
      let validation: Awaited<ReturnType<typeof abrirValidacaoIntegrada>>;
      const validationEvidence = join(paths.root, "recuperacao", `${integrationPrefix}-suite-${randomUUID().slice(0, 12)}`);
      try { validation = await abrirValidacaoIntegrada(projectRoot, validationEvidence); }
      catch (error) { return pararPorAmbiente(`não foi possível preparar a cópia de validação do HEAD integrado: ${String(error)}`); }
      const bancosDeTeste = await criarBancosDeTeste(validation.dir, options.testRunner ?? defaultTestRunner).catch(async error => {
        await validation.fechar();
        throw error;
      });
      const migrar = options.instalar ? (command: string, cwd: string) => options.instalar!(command, cwd, bancosDeTeste.environment) : undefined;
      try {
        const ambiente = await prepararAmbiente(validation.dir, migrar);
        for (const aviso of ambiente.anuncios) announce(`[${session.id}] árvore integrada: ${aviso}`);
        if (ambiente.saidaDaMigracao !== "") {
          await writeAtomic(`${paths.logs}/${integrationPrefix}.migrate-integracao.log`, ambiente.saidaDaMigracao);
        }

        const comando = await options.comandoDeTeste();
        let tentativa = 0;
        let saida = "";
        const testar: TestRunner = async (command, cwd) => {
          const resultado = await bancosDeTeste.runner(command, cwd);
          saida = resultado.output;
          tentativa += 1;
          await writeAtomic(join(paths.logs, `${integrationPrefix}.g2-integracao-${tentativa}.log`), `$ ${command}\nexit: ${resultado.exitCode}\n${resultado.output}`);
          return resultado;
        };
        let g2 = await gate2(validation.dir, comando, testar, options.systemInstall);
        if (!g2.green && await falhaDeInstalacaoNode(projectRoot, saida)) {
          if (instalacoes === 0 && options.instalar) {
            const reparada = await instalarNaPrincipal("G2 identificou dependência ausente ou incompatível; reparo limitado sem reconstruir a fase aprovada");
            if (reparada.exitCode !== 0) return pararPorAmbiente(`o único reparo de dependências falhou; veja ${join(paths.logs, `${integrationPrefix}.install-integracao-${instalacoes}.log`)}`);
            await validation.atualizarDependencias();
            // A migração que usa o addon também deve rodar com a instalação reparada.
            const reparo = await prepararAmbiente(validation.dir, migrar);
            for (const aviso of reparo.anuncios) announce(`[${session.id}] árvore integrada: ${aviso}`);
            if (reparo.saidaDaMigracao !== "") await writeAtomic(join(paths.logs, `${integrationPrefix}.migrate-integracao-reparo.log`), reparo.saidaDaMigracao);
            g2 = await gate2(validation.dir, comando, testar, options.systemInstall);
          }
          if (!g2.green && await falhaDeInstalacaoNode(projectRoot, saida)) {
            return pararPorAmbiente(`G2 continua sem ambiente válido após ${instalacoes} tentativa(s) de instalação; saída completa em ${join(paths.logs, `${integrationPrefix}.g2-integracao-${tentativa}.log`)}`);
          }
        }
        if (!g2.green) {
          const reverted = await desfazer(`a suíte da árvore integrada reprovou: ${g2.cause}\nSaída completa em ${join(paths.logs, `${integrationPrefix}.g2-integracao-${tentativa}.log`)}`);
          return reverted.desfecho === "refazer" ? { ...reverted, testFailure: true } : reverted;
        }
        const changedSources = await validation.fontesAlteradas();
        if (changedSources.length > 0) {
          const reverted = await desfazer(`a suíte alterou fonte versionada durante a validação (${changedSources.join(", ")}); ela precisa passar sem modificar o código do commit. Evidência preservada em ${validationEvidence}`);
          return reverted.desfecho === "refazer" ? { ...reverted, testFailure: true } : reverted;
        }
        if (!g2.skipped) await registrarInstalacaoNode(projectRoot);
        /*
         * A árvore estava igual ao HEAD antes do cherry-pick, e a fila de
         * integração é de uma fase por vez: um versionado alterado agora foi
         * escrito pelo que o próprio harness rodou nela. A fase está integrada e
         * verde — os commits ficam —, mas nada mais entra por cima de uma árvore
         * que não é o HEAD, e o desenvolvedor sabe na hora de quem é a alteração.
         * Nada é descartado (§102).
         */
        const locais = await artefatosLocaisIgnorados(projectRoot, (await lerStatus(projectRoot)).map(entrada => entrada.caminho));
        if (locais.size > 0) announce(`[${session.id}] ${locais.size} arquivo(s) de artefatos e dependências locais ignoradas ficaram no disco; sem incluí-los no commit nem interromper as próximas fases`);
        const deixados = await alteradosNaPrincipal(projectRoot);
        if (deixados.length > 0) {
          fatal = true;
          sujeiraDoHarness ??= {
            session,
            causa:
              `a integração da ${session.id} deixou ${deixados.join(", ")} alterado(s) na árvore principal. ` +
              `Quem alterou foi o próprio harness — a instalação, a migração ou a suíte que ele roda na árvore integrada —, não você. ` +
              `Os commits da fase estão no HEAD e a suíte passou; nada foi descartado. ` +
              `Confira com \`git diff\` e descarte (\`git checkout -- ${deixados.join(" ")}\`) ou commite antes de retomar`,
          };
          announce(`[${session.id}] ATENÇÃO — ${sujeiraDoHarness.causa}`);
          // Nenhuma fase nova sai: ela trabalharia para ser recusada na integração.
          parada ??= { session, outcome: { status: "failed", gate: "gate 2 — suíte do projeto", cause: sujeiraDoHarness.causa, cycles: 0 } };
        }
        const roteiros = await trazerRoteiros(worktree, projectRoot);
        announce(
          `[${session.id}] integrada: ${integracao.commits} commit(s) na árvore principal` +
            `${comando ? ", suíte verde com as fases já integradas" : ""}${roteiros > 0 ? `, ${roteiros} roteiro(s) do gate 4 trazidos` : ""}`,
        );
      } finally { try { await bancosDeTeste.limpar(); } finally { await validation.fechar(); } }
    } else {
      announce(`[${session.id}] nada a integrar: a fase já estava implementada na base`);
    }
    // Instalação, migração e suíte podem deixar arquivos locais (p.ex. .env e
    // coverage). Registrados dentro da fila, não parecem escrita de um agente.
    for (const entrada of await alteracoesParaCommit(projectRoot)) {
      if (entrada.naoVersionado) naoVersionadosIniciais.add(entrada.caminho);
    }
    return { desfecho: "integrada" };
  };

  const lancar = async (session: PhaseSession, slot: number): Promise<void> => {
    const pool = options.agentes[slot]!;
    let worktree: Worktree | null = null;
    let manterBranch = false;
    /** A guarda do parcial não foi comprovada: o worktree não sai do disco (§100). */
    let manterArvore = false;
    let aprovadoRetomado: PhaseOutcome | null = null;
    let conciliacao: ConciliacaoDaIntegracao | null = null;
    try {
      agente(slot, "preparando", session.id);
      const anterior = preservados.get(session.id);
      if (anterior) announce(`[${session.id}] o commit aprovado antes (${anterior.commit.slice(0, 12)}) continua no branch ${anterior.branch}`);
      try {
        // O --rebuild-all limpou os checkpoints de ANTES desta execução; o que ela mesma gravou (um conflito) vale.
        const salvo = await readFile(checkpointDaIntegracao(session.id), "utf8").catch(() => null);
        // Versão 2: a fase volta de um conflito, para conciliar; a 1 é o aprovado à espera de integrar.
        const conflito = lerConflito(salvo);
        if (salvo !== null && conflito === null) {
          const checkpoint = JSON.parse(salvo) as { versao: number; worktree: Worktree; commit: string; outcome: PhaseOutcome };
          if (checkpoint.versao !== 1 || !checkpoint.worktree || !["complete", "already-implemented"].includes(checkpoint.outcome?.status) ||
            checkpoint.worktree.branch !== branchDaFase(options.runId, session.id) ||
            typeof checkpoint.worktree.dir !== "string" || resolve(checkpoint.worktree.dir) !== resolve(pastaDosWorktrees(projectRoot, options.runId, options.environment), session.id) ||
            !/^[0-9a-f]{40,64}$/.test(checkpoint.commit) || !/^[0-9a-f]{40,64}$/.test(checkpoint.worktree.base)) {
            throw new Error("registro da integração aprovada inválido; o branch foi mantido para inspeção");
          }
          // Não limpar/reaplicar o parcial: esse é exatamente o commit já aprovado.
          await conferirWorktreeAprovado(projectRoot, checkpoint.worktree, checkpoint.commit);
          worktree = checkpoint.worktree;
          aprovadoRetomado = checkpoint.outcome;
          integracoesSuspensas.add(session.id);
          manterBranch = true;
          manterArvore = true;
          announce(`[${session.id}] retomando a integração do commit já aprovado ${checkpoint.commit.slice(0, 12)}; nenhuma nova sessão de construção`);
        }
        const aberto = worktree === null ? await abrirWorktree(projectRoot, options.runId, session.id, options.environment, options.environmentApproved, conflito !== null) : null;
        if (aberto) {
          worktree = aberto.worktree;
          // abrirWorktree já guardou o commit anterior antes de recriar o branch.
          announce(
            `[${session.id}] agente ${slot + 1} (${pool.label}) num worktree próprio` +
              `${aberto.copiado.length > 0 ? `; copiado: ${aberto.copiado.join(", ")}` : ""}`,
          );
          for (const naoCopiado of aberto.naoCopiado) announce(`[${session.id}] dependências não copiadas: ${naoCopiado}; a instalação será preparada no worktree`);
        }
        const retomado = aberto?.retomado;
        if (retomado && conflito && worktree) {
          if (retomado.aplicado) {
            /*
             * O conflito volta para quem pode resolvê-lo sem jogar nada fora
             * (§125 F): o commit aprovado está sobre a árvore integrada, tudo o
             * que não conflitou já está no lugar, e só os marcadores esperam.
             */
            // A lista do checkpoint E a de agora: um parcial anterior pode ter deixado marcador em arquivo que não conflitou desta vez.
            const arquivos = [...new Set([...conflito.arquivos, ...(retomado.emConflito ?? [])])];
            const historico = await historicoDoConflito(projectRoot, conflito.aprovado.commit, conflito.principal, arquivos);
            conciliacao = {
              arquivos,
              ...(retomado.apagados && retomado.apagados.length > 0 ? { apagados: retomado.apagados } : {}),
              ...(retomado.binarios && retomado.binarios.length > 0 ? { binarios: retomado.binarios } : {}),
              principal: conflito.principal,
              aprovado: conflito.aprovado,
              ...(historico !== "" ? { historico } : {}),
            };
            announce(
              `[${session.id}] o commit aprovado (${conflito.aprovado.commit.slice(0, 12)}) voltou sobre a árvore integrada; ` +
                `${arquivos.length > 0 ? `os arquivos em conflito são ${arquivos.join(", ")} (marcadores nos de texto; binário e apagado pedem decisão), e a conciliação mexe só neles` : "nada conflita mais"}. ` +
                `Os dois lados continuam guardados: o HEAD e o branch ${conflito.aprovado.branch}`,
            );
          } else {
            // O aprovado não voltou: o que se aprovou sobre ele não está nesta árvore.
            await options.esquecer(session);
            announce(`[${session.id}] o commit aprovado (${conflito.aprovado.commit.slice(0, 12)}) não voltou — ${retomado.motivo ?? "o git recusou"}; a fase recomeça do HEAD, e o aprovado continua no branch ${conflito.aprovado.branch}`);
          }
        } else if (retomado) {
          announce(
            retomado.aplicado && retomado.foraDoParcial.length > 0
              ? `[${session.id}] o parcial da tentativa anterior (${retomado.commit.slice(0, 12)}) foi reaplicado em parte sobre a árvore integrada: ` +
                  `${retomado.foraDoParcial.join(", ")} conflitava e ficou com a versão da árvore integrada; o original continua no branch ${retomado.branch}`
              : retomado.aplicado
              ? `[${session.id}] o parcial da tentativa anterior (${retomado.commit.slice(0, 12)}) foi reaplicado sobre a árvore integrada; o original continua no branch ${retomado.branch}`
              : `[${session.id}] o parcial da tentativa anterior (${retomado.commit.slice(0, 12)}) não foi reaplicado — ${retomado.motivo}; a fase começa do HEAD, e o parcial continua no branch ${retomado.branch}`,
          );
        }
      } catch (erro) {
        const causa = erro instanceof Error ? erro.message.split("\n")[0] ?? "" : String(erro);
        const outcome: PhaseOutcome = { status: "failed", gate: "gate 0 — engine", cause: `não consegui criar o worktree da fase: ${causa}`, cycles: 0 };
        estados.set(session.id, "falhou");
        relatorios.set(session.id, outcome);
        await evento(session.id, "blocked", outcome.cause);
        options.onProgress?.({ kind: "phase", id: session.id, state: "falhou", cycle: 0, detail: "sem worktree" });
        if (!options.keepGoing) parada ??= { session, outcome };
        return;
      }

      if (!worktree) throw new Error("a fase não tem worktree");
      agente(slot, aprovadoRetomado ? "integrando" : "trabalhando", session.id);
      const outcome = aprovadoRetomado ?? await options.rodar(session, {
        workRoot: worktree.dir,
        worker: slot,
        engine: pool.engine,
        systemInstall: pool.systemInstall,
        preferredPort: options.portaBase + slot,
        conferirPrincipal,
        ...(recuperacoesDeTeste.has(session.id) ? { integrationFailure: recuperacoesDeTeste.get(session.id)! } : {}),
        ...(conciliacao ? { conciliacao } : {}),
      });

      if (outcome.status === "complete" || outcome.status === "already-implemented") {
        aprovados.set(session.id, outcome);
        const integracao = await integrarFase(session, worktree, slot);
        if (integracao.desfecho === "integrada") {
          estados.set(session.id, "integrada");
          relatorios.set(session.id, outcome);
          await evento(session.id, "complete", outcome.status === "complete" ? `integrada: ${outcome.message}` : "integrada: já implementada");
          options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: outcome.cycles, detail: "integrada" });
          await options.aposIntegrar(session, outcome);
          await rm(checkpointDaIntegracao(session.id), { force: true });
          integracoesSuspensas.delete(session.id);
          manterBranch = false;
          manterArvore = false;
          agente(slot, "livre", null, `${session.id} integrada`);
          return;
        }
        let recovery: IntegrationFailure | null = null;
        if (integracao.desfecho === "refazer" && integracao.testFailure) {
          const previous = recuperacoesDeTeste.get(session.id);
          if (!previous || previous.repairBudget.used < (options.maxVerifierRepairs ?? 0)) {
            recovery = {
              cause: integracao.motivo, attempt: (previous?.attempt ?? 0) + 1,
              repairByVerifier: previous !== undefined,
              repairBudget: previous?.repairBudget ?? { used: 0 },
            };
          }
        }
        if (integracao.desfecho === "refazer" && (recovery || (!integracao.testFailure && !exclusivas.has(session.id)))) {
          /*
           * O verde não é descartado antes da nova rodada (§110): o commit
           * aprovado ganha um branch próprio, dito no evento — a retomada o acha
           * no log, não só na tela.
           */
          const preservado = await preservarAprovado(projectRoot, worktree);
          await rm(checkpointDaIntegracao(session.id), { force: true });
          integracoesSuspensas.delete(session.id);
          // A próxima abertura reaplica o trabalho aprovado que não conflita.
          // Guardar só o branch de auditoria deixava o builder recomeçar do zero.
          manterBranch = true;
          manterArvore = false;
          preservados.set(session.id, preservado);
          if (recovery) recuperacoesDeTeste.set(session.id, recovery);
          exclusivas.add(session.id);
          estados.set(session.id, "pendente");
          if (integracao.desfecho === "refazer" && integracao.conflito) {
            /*
             * O conflito é gravado, não lembrado (§125 F): a reabertura — nesta
             * execução ou depois de uma queda — mantém os marcadores para a
             * conciliação. As aprovações ficam: cada uma sabe a árvore em que
             * foi dada, e o verificador as confere contra o que mudou.
             */
            const checkpoint: CheckpointDoConflito = { versao: 2, motivo: "conflito", ...integracao.conflito, aprovado: preservado };
            await writeAtomic(checkpointDaIntegracao(session.id), JSON.stringify(checkpoint));
          } else {
            await options.esquecer(session);
          }
          await evento(
            session.id,
            "retry",
            `${integracao.motivo}; ${recovery ? recovery.repairByVerifier ? "o validador executará a correção" : "o validador orientará a correção pelo executor" : "volta à fila para rodar sozinha sobre a árvore integrada"}; ` +
              `o commit aprovado ${preservado.commit.slice(0, 12)} ficou no branch ${preservado.branch}`,
          );
          announce(
            `[${session.id}] ${integracao.motivo}. A integração foi desfeita; ${recovery ? recovery.repairByVerifier ? "o validador executará o reparo no worktree" : "o validador dará diagnóstico e ação concreta ao executor" : "a fase volta à fila para rodar SOZINHA sobre a árvore integrada"}. ` +
              `O commit aprovado ${preservado.commit.slice(0, 12)} ficou no branch ${preservado.branch} (git log ${preservado.branch})`,
          );
          options.onProgress?.({ kind: "phase", id: session.id, state: "aguardando", cycle: 0, detail: recovery ? "corrigindo teste da integração" : "refaz sozinha" });
          agente(slot, "livre", null, `${session.id} ${recovery ? "correção de teste" : "conflito"}`);
          return;
        }
        const falha: PhaseOutcome =
          integracao.desfecho === "falhou"
            ? integracao.outcome
            : { status: "failed", gate: "gate 2 — suíte do projeto", cause: `mesmo rodando sozinha, a fase não fechou na árvore integrada: ${integracao.motivo}`, cycles: outcome.cycles };
        manterBranch = true;
        manterArvore ||= integracoesSuspensas.has(session.id);
        // O runner deixou "verde no worktree"; o que valeu foi a integração — o evento diz isso (relatório e retomada leem daqui).
        await evento(session.id, "blocked", descreverFalha(falha).split("\n")[0] ?? "");
        // Verde no worktree, fora do produto: o que se aprovou dela só existe no branch (§99).
        if (!integracoesSuspensas.has(session.id)) await options.esquecer(session);
        await registrarFalha(session, falha, slot);
        return;
      }

      // Parou num gate (ou o commit foi bloqueado): o parcial vai para o branch da fase, fora do produto.
      const parcial = await guardarParcial(
        worktree,
        `wip(${session.id}): trabalho parcial, ${outcome.status === "commit-blocked" ? "commit bloqueado pela política de admissão" : "gates não fecharam"}`,
        pastaDeRecuperacao(session),
      );
      manterBranch = parcial.guardado || parcial.preservarArvore || (await branchTemTrabalho(projectRoot, worktree));
      manterArvore = parcial.preservarArvore;
      anunciarParcial(session, worktree, parcial);
      /*
       * E as tasks que o verificador aprovou nesta tentativa foram aprovadas
       * sobre esse parcial. A retomada abre um worktree do HEAD, sem ele: se as
       * aprovações ficassem, o verificador seria instruído a carimbar DONE em
       * código que não está lá (§99).
       */
      await options.esquecer(session);
      await registrarFalha(session, outcome, slot);
    } catch (erro) {
      /*
       * O que ninguém tratou — o provider que lança, o disco que recusa (§99).
       * O parcial vai para o branch, como em qualquer falha; nada mais sai nem
       * entra na árvore principal; e o erro sobe só depois de os outros
       * agentes terminarem.
       */
      erroInesperado ??= { erro };
      fatal = true;
      const causa = erro instanceof Error ? erro.message.split("\n")[0] ?? "" : String(erro);
      if (worktree) {
        const parcial = await guardarParcial(worktree, `wip(${session.id}): trabalho parcial, a fase parou num erro inesperado`, pastaDeRecuperacao(session));
        manterBranch = true;
        manterArvore = parcial.preservarArvore;
        anunciarParcial(session, worktree, parcial);
      }
      if (estados.get(session.id) !== "integrada") {
        await options.esquecer(session).catch(() => undefined);
        await registrarFalha(session, { status: "failed", gate: "gate 0 — engine", cause: `erro inesperado: ${causa}`, cycles: 0 }, slot);
      } else {
        announce(`[${session.id}] erro inesperado depois de integrada: ${causa}`);
        agente(slot, "livre", null, `${session.id} erro inesperado`);
      }
    } finally {
      if (worktree) await fecharWorktree(projectRoot, worktree, { manterBranch, manterArvore }).catch(() => undefined);
      livres.push(slot);
      livres.sort((a, b) => a - b);
    }
  };

  /** O que aconteceu com o parcial, dito com caminhos e nunca com conteúdo. */
  const anunciarParcial = (session: PhaseSession, worktree: Worktree, parcial: ParcialGuardado): void => {
    if (parcial.guardado) {
      announce(`[${session.id}] o trabalho parcial ficou no branch ${worktree.branch}, fora da árvore principal (git log ${worktree.branch})`);
    }
    if (parcial.bloqueados.length > 0) {
      announce(
        `[${session.id}] fora do branch, por serem sensíveis: ${descreverBloqueios(parcial.bloqueados)}` +
          `${parcial.recuperacao ? ` — copiados, fora do Git, para ${parcial.recuperacao}` : ""}`,
      );
    }
    if (parcial.preservarArvore) {
      announce(
        `[${session.id}] não consegui comprovar a guarda do parcial${parcial.motivo ? ` (${parcial.motivo})` : ""}: ` +
          `o worktree ficou no disco, intacto, em ${worktree.dir}`,
      );
    }
  };

  const registrarFalha = async (session: PhaseSession, outcome: PhaseOutcome, slot: number): Promise<void> => {
    estados.set(session.id, "falhou");
    relatorios.set(session.id, outcome);
    options.onProgress?.({ kind: "phase", id: session.id, state: "falhou", cycle: "cycles" in outcome ? outcome.cycles : 0, detail: "falhou" });
    agente(slot, "livre", null, `${session.id} falhou`);
    const [primeira] = descreverFalha(outcome).split("\n");
    announce(`[${session.id}] PAROU — ${primeira ?? ""}`);
    // Credencial recusada vale para todos os agentes do mesmo provider: seguir seria colecionar falhas.
    if (!options.keepGoing || outcome.status === "credential-rejected" || fatal) {
      parada ??= { session, outcome };
      if (rodando.size > 1) {
        announce(`nenhuma fase nova sai; esperando ${rodando.size - 1} agente(s) em andamento terminarem — o que fechar verde ainda é integrado`);
      }
    }
  };

  for (;;) {
    if (parada === null && erroInesperado === null && !fatal) {
      if (options.keepGoing) {
        for (const id of bloqueadas({ fases: agendaveis, estados, exclusivas, limite: 0 })) {
          estados.set(id, "bloqueada");
          announce(`[${id}] pulada: depende de uma fase que falhou`);
          options.onProgress?.({ kind: "phase", id, state: "pulado", cycle: 0, detail: "dependência falhou" });
        }
      }

      const candidatas = proximas({ fases: agendaveis, estados, exclusivas, limite: livres.length + rodando.size });
      if (candidatas.length > 0) {
        /*
         * O isolamento é perguntado de novo a cada leva, sobre a árvore
         * integrada: o banco em servidor pode ter acabado de ser declarado.
         */
        const isolamento = await options.isolamento();
        const motivo = isolamento.ok ? null : [...isolamento.impedimentos, ...isolamento.motivos].join("; ");
        if (motivo !== suspenso) {
          if (motivo !== null) announce(`paralelismo suspenso — um agente por vez enquanto valer: ${motivo}`);
          else if (suspenso !== null) announce(`paralelismo retomado: até ${options.maxConcurrency} agentes`);
          suspenso = motivo;
        }
        const limite = motivo === null ? Math.min(options.maxConcurrency, options.agentes.length) : 1;
        for (const id of proximas({ fases: agendaveis, estados, exclusivas, limite })) {
          const slot = livres.shift();
          if (slot === undefined) break;
          const session = porId.get(id)!;
          estados.set(id, "rodando");
          const tarefa = lancar(session, slot).finally(() => rodando.delete(id));
          rodando.set(id, tarefa);
        }
      }
    }

    if (rodando.size === 0) break;
    // Uma rejeição aqui não sai do laço: os outros agentes ainda estão rodando (§99).
    await Promise.race(rodando.values()).catch((erro: unknown) => {
      erroInesperado ??= { erro };
      fatal = true;
    });
  }

  /*
   * Depois da última integração, a principal ainda é a que o integrador deixou?
   * Um agente que commitou nela depois disso não teria outra integração para
   * denunciá-lo (§101).
   */
  const conhecida = cabecaConhecida as string | null;
  const final = await cabeca(projectRoot).catch(() => conhecida);
  if (conhecida !== null && final !== conhecida) {
    const causa =
      `a árvore principal recebeu commit que não é do integrador: o HEAD era ${conhecida.slice(0, 12)} e agora é ${(final ?? "?").slice(0, 12)}. ` +
      "Nada foi desfeito — confira com `git log --oneline -10` e `git reflog`";
    announce(`PARADA DE AUTORIDADE — ${causa}`);
    const quem = (ultimaIntegrada as PhaseSession | null) ?? options.sessions[0];
    if (quem) {
      parada ??= {
        session: quem,
        outcome: { status: "commit-blocked", bloqueios: [{ caminho: "HEAD da árvore principal", motivo: "movido por fora do integrador" }], cause: causa, cycles: 0 },
      };
    }
  }

  // Atribuído dentro dos agentes: o TypeScript não vê, e estreitaria para nulo.
  const pendente = erroInesperado as { erro: unknown } | null;
  if (pendente !== null) throw pendente.erro;

  return {
    relatorios: options.sessions
      .filter((session) => relatorios.has(session.id))
      .map((session) => ({ session, outcome: relatorios.get(session.id)! })),
    parada,
  };
}
