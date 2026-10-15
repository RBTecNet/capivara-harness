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
 * Se nem sozinha ela fecha, ela falhou como falharia no serial.
 *
 * Nada aqui é decidido por modelo. A ordem, o agente e o desfecho da integração
 * saem do escalonador, do git e da suíte.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "../state/atomic.js";
import { appendEvent } from "../state/events.js";
import { runPaths } from "../state/paths.js";
import { prepararAmbiente } from "./ambiente.js";
import { bloqueadas, dependenciasEfetivas, proximas, type EstadoNaAgenda } from "./escalonador.js";
import { gate2, type TestRunner } from "./gates.js";
import type { Isolamento } from "./isolamento.js";
import type { BuildProgressListener, WorkerProgressListener } from "./progress.js";
import type { PhaseOutcome } from "./runner.js";
import type { PhaseSession } from "./split.js";
import {
  abrirWorktree,
  cabeca,
  desfazerSemApagar,
  fecharWorktree,
  guardarParcial,
  impedimentosDaPrincipal,
  integrar,
  mexeuNasDependencias,
  trazerRoteiros,
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
}

export interface ParaleloOptions {
  projectRoot: string;
  runId: string;
  /** Na ordem do plano. */
  sessions: readonly PhaseSession[];
  agentes: readonly AgenteDoPool[];
  maxConcurrency: number;
  keepGoing: boolean;
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
  /** Roda `npm install` e a migração do ambiente na árvore principal; substituível no teste. */
  instalar?: (comando: string, cwd: string) => Promise<{ exitCode: number; output: string }>;
  systemInstall: boolean;
  /** A porta do gate 4 que o primeiro agente prefere; os seguintes, as vizinhas. */
  portaBase: number;
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

function descreverFalha(outcome: PhaseOutcome): string {
  if (outcome.status === "failed") return `${outcome.gate}: ${outcome.cause}`;
  if (outcome.status === "credential-rejected") return `o provider ${outcome.engine} recusou a credencial: ${outcome.evidence}`;
  if (outcome.status === "rate-limit-exhausted") return "limite de uso esgotado";
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
  const relatorios = new Map<string, PhaseOutcome>();
  const porId = new Map(options.sessions.map((session) => [session.id, session]));
  const naFilaDeIntegracao = filaUnica();
  const rodando = new Map<string, Promise<void>>();
  const livres = Array.from({ length: Math.min(options.maxConcurrency, options.agentes.length) }, (_, indice) => indice);
  let parada: ParaleloResultado["parada"] = null;
  let suspenso: string | null = null;
  let fatal = false;
  /**
   * O primeiro erro que ninguém tratou (§99). Ele não derruba o laço na hora:
   * derrubar deixava os outros agentes rodando sem lock e integrando depois de o
   * build ter saído. Ele para tudo o que é novo, espera os que estão rodando, e
   * só então sobe — como no serial, mas sem órfãos.
   */
  let erroInesperado: { erro: unknown } | null = null;

  const evento = async (subject: string, status: "complete" | "retry" | "blocked", detail: string): Promise<void> => {
    await appendEvent(paths.events, { timestamp: options.now().toISOString(), stage: "implement", subject, attempt: 1, status, detail });
  };
  const agente = (slot: number, estado: "livre" | "preparando" | "trabalhando" | "integrando", phaseId: string | null, detail = ""): void =>
    options.onWorker?.({ slot, state: estado, phaseId, detail });

  for (const session of options.sessions) {
    if (options.jaFechada(session)) {
      estados.set(session.id, "integrada");
      relatorios.set(session.id, { status: "already-implemented", cycles: 0 });
    }
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
  ): Promise<{ desfecho: "integrada" } | { desfecho: "refazer"; motivo: string } | { desfecho: "falhou"; outcome: PhaseOutcome }> =>
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
            cause: "não foi integrada: uma falha fatal anterior deixou a árvore principal precisando de atenção, e nada mais entra nela neste build",
            cycles: 0,
          },
        };
      }
      try {
        return await integrarNaFila(session, worktree, slot);
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
      }
    });

  const integrarNaFila = async (
    session: PhaseSession,
    worktree: Worktree,
    slot: number,
  ): Promise<{ desfecho: "integrada" } | { desfecho: "refazer"; motivo: string } | { desfecho: "falhou"; outcome: PhaseOutcome }> => {
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
      });
      if (desfeita.limpo) return { desfecho: "refazer", motivo };
      /*
       * A árvore voltou a ser a de antes da integração: nada a commitar, e por
       * isso o preflight seguinte não tem o que mandar commitar. O que estava
       * nela não se perdeu — está no branch guardado, para quem quiser ler.
       */
      return pararSemTocar(
        `${motivo}; e a árvore principal foi alterada durante a integração (${desfeita.arquivos.join(", ")}). ` +
          `Nada da integração reprovada ficou na árvore: o HEAD e os arquivos voltaram a ser os de antes da fase. ` +
          `Nada se perdeu: o que estava na árvore está no branch ${desfeita.guardado} (git show ${desfeita.guardado}), ` +
          `e o trabalho da fase no branch ${worktree.branch}`,
      );
    };

    const { impedimentos, naoVersionados } = await impedimentosDaPrincipal(projectRoot, worktree);
    if (impedimentos.length > 0) {
      return pararSemTocar(
        `a árvore principal tem alterações que não são do integrador (${impedimentos.join(", ")}); ` +
          `integrar por cima as sobrescreveria ou faria a suíte julgar uma árvore que não é o HEAD. ` +
          `Nada foi tocado; o trabalho da fase está no branch ${worktree.branch}`,
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
      };
    }

    if (integracao.status === "integrada") {
      /*
       * A fase pode ter acrescentado dependência. A árvore principal não tem
       * o `node_modules` do worktree, e a suíte integrada reprovaria por um
       * pacote que só faltava instalar.
       */
      if (mexeuNasDependencias(integracao.arquivos) && options.instalar) {
        const temManifesto = await readFile(join(projectRoot, "package.json"), "utf8").then(() => true, () => false);
        if (temManifesto) {
          announce(`[${session.id}] a fase mexeu nas dependências; instalando na árvore integrada`);
          const instalado = await options.instalar("npm install --no-audit --no-fund", projectRoot);
          if (instalado.exitCode !== 0) {
            return desfazer(`npm install falhou na árvore integrada: ${instalado.output.split("\n").slice(-3).join(" ").trim()}`);
          }
        }
      }

      /*
       * O mesmo preparo que o runner faz antes do gate 2 no worktree (§99): o
       * `.env` semeado do `.env.example` e a migração do ambiente descartável.
       * Sem ele, a suíte que lê o ambiente reprovava aqui o que passou lá, e a
       * fase era refeita até falhar.
       */
      const ambiente = await prepararAmbiente(projectRoot, options.instalar);
      for (const aviso of ambiente.anuncios) announce(`[${session.id}] árvore integrada: ${aviso}`);
      if (ambiente.saidaDaMigracao !== "") {
        await writeAtomic(`${paths.logs}/${session.id}.migrate-integracao.log`, ambiente.saidaDaMigracao);
      }

      const comando = await options.comandoDeTeste();
      const g2 = await gate2(projectRoot, comando, options.testRunner, options.systemInstall);
      if (!g2.green) {
        return desfazer(`a suíte da árvore integrada reprovou: ${g2.cause.split("\n")[0] ?? ""}`);
      }
      const roteiros = await trazerRoteiros(worktree, projectRoot);
      announce(
        `[${session.id}] integrada: ${integracao.commits} commit(s) na árvore principal` +
          `${comando ? ", suíte verde com as fases já integradas" : ""}${roteiros > 0 ? `, ${roteiros} roteiro(s) do gate 4 trazidos` : ""}`,
      );
    } else {
      announce(`[${session.id}] nada a integrar: a fase já estava implementada na base`);
    }
    return { desfecho: "integrada" };
  };

  const lancar = async (session: PhaseSession, slot: number): Promise<void> => {
    const pool = options.agentes[slot]!;
    let worktree: Worktree | null = null;
    let manterBranch = false;
    try {
      agente(slot, "preparando", session.id);
      try {
        const aberto = await abrirWorktree(projectRoot, options.runId, session.id, options.environment);
        worktree = aberto.worktree;
        announce(
          `[${session.id}] agente ${slot + 1} (${pool.label}) num worktree próprio` +
            `${aberto.copiado.length > 0 ? `; copiado: ${aberto.copiado.join(", ")}` : ""}`,
        );
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

      agente(slot, "trabalhando", session.id);
      const outcome = await options.rodar(session, {
        workRoot: worktree.dir,
        worker: slot,
        engine: pool.engine,
        systemInstall: pool.systemInstall,
        preferredPort: options.portaBase + slot,
      });

      if (outcome.status === "complete" || outcome.status === "already-implemented") {
        const integracao = await integrarFase(session, worktree, slot);
        if (integracao.desfecho === "integrada") {
          estados.set(session.id, "integrada");
          relatorios.set(session.id, outcome);
          await evento(session.id, "complete", outcome.status === "complete" ? `integrada: ${outcome.message}` : "integrada: já implementada");
          options.onProgress?.({ kind: "phase", id: session.id, state: "concluído", cycle: outcome.cycles, detail: "integrada" });
          await options.aposIntegrar(session, outcome);
          agente(slot, "livre", null, `${session.id} integrada`);
          return;
        }
        if (integracao.desfecho === "refazer" && !exclusivas.has(session.id)) {
          exclusivas.add(session.id);
          estados.set(session.id, "pendente");
          await options.esquecer(session);
          await evento(session.id, "retry", `${integracao.motivo}; volta à fila para rodar sozinha sobre a árvore integrada`);
          announce(`[${session.id}] ${integracao.motivo}. A integração foi desfeita; a fase volta à fila para rodar SOZINHA sobre a árvore integrada`);
          options.onProgress?.({ kind: "phase", id: session.id, state: "aguardando", cycle: 0, detail: "refaz sozinha" });
          agente(slot, "livre", null, `${session.id} conflito`);
          return;
        }
        const falha: PhaseOutcome =
          integracao.desfecho === "falhou"
            ? integracao.outcome
            : { status: "failed", gate: "gate 2 — suíte do projeto", cause: `mesmo rodando sozinha, a fase não fechou na árvore integrada: ${integracao.motivo}`, cycles: outcome.cycles };
        manterBranch = true;
        // Verde no worktree, fora do produto: o que se aprovou dela só existe no branch (§99).
        await options.esquecer(session);
        await registrarFalha(session, falha, slot);
        return;
      }

      // Parou num gate: o parcial vai para o branch da fase, fora do produto.
      manterBranch = await guardarParcial(worktree, `wip(${session.id}): trabalho parcial, gates não fecharam`);
      if (manterBranch) {
        announce(`[${session.id}] o trabalho parcial ficou no branch ${worktree.branch}, fora da árvore principal (git log ${worktree.branch})`);
      }
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
        await guardarParcial(worktree, `wip(${session.id}): trabalho parcial, a fase parou num erro inesperado`);
        manterBranch = true;
        announce(`[${session.id}] o trabalho da fase ficou no branch ${worktree.branch}, fora da árvore principal`);
      }
      if (estados.get(session.id) !== "integrada") {
        await options.esquecer(session).catch(() => undefined);
        await registrarFalha(session, { status: "failed", gate: "gate 0 — engine", cause: `erro inesperado: ${causa}`, cycles: 0 }, slot);
      } else {
        announce(`[${session.id}] erro inesperado depois de integrada: ${causa}`);
        agente(slot, "livre", null, `${session.id} erro inesperado`);
      }
    } finally {
      if (worktree) await fecharWorktree(projectRoot, worktree, { manterBranch }).catch(() => undefined);
      livres.push(slot);
      livres.sort((a, b) => a - b);
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
    if (parada === null && erroInesperado === null) {
      if (options.keepGoing) {
        for (const id of bloqueadas({ fases: options.sessions, estados, exclusivas, limite: 0 })) {
          estados.set(id, "bloqueada");
          announce(`[${id}] pulada: depende de uma fase que falhou`);
          options.onProgress?.({ kind: "phase", id, state: "pulado", cycle: 0, detail: "dependência falhou" });
        }
      }

      const candidatas = proximas({ fases: options.sessions, estados, exclusivas, limite: livres.length + rodando.size });
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
        for (const id of proximas({ fases: options.sessions, estados, exclusivas, limite })) {
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
