/**
 * O que o `plan` já pagou e não precisa pagar de novo.
 *
 * O `build` tem ledger de fase desde sempre: fase fechada não se refaz. O `plan`
 * não tinha nada — e ele é o estágio caro. No `assitencia` foram 18 fases, 5.190
 * segundos de escritor, e o run parou duas vezes perto do fim: uma no impasse do
 * auditor, outra no ensaio do verificador. Nas duas, as 18 fases foram
 * reescritas do zero, e nas duas o que estava escrito estava certo.
 *
 * A chave é o PROMPT, não a saída.
 *
 * Guardar "a fase 5 já foi escrita" seria errado: se o esqueleto mudar, se uma
 * decisão nova entrar, ou se NÓS melhorarmos o prompt do escritor, a fase 5 de
 * ontem não serve mais. O sha do prompt carrega tudo isso junto — fatia do
 * esqueleto, regras transversais, gramática, tetos — e muda quando qualquer um
 * deles muda. Cache que se invalida sozinho não mente.
 *
 * O mesmo vale para a aprovação: a chave é o sha do prompt de auditoria, que
 * contém o texto da fase E o que o auditor foi instruído a julgar. Quando o eixo
 * do auditor muda — como mudou no §49 —, nenhuma aprovação velha sobrevive.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { sha12 } from "../contract/index.js";

/**
 * `v3` (§116): além das fases e das aprovações por auditoria, a memória guarda
 * o esqueleto, a arquitetura, as tasks aprovadas uma a uma e a base da
 * coerência. É o que faz uma retomada depois de o provider cair custar zero
 * chamadas pelo que já estava julgado — antes, as aprovações por task e a
 * coerência viviam só em memória e morriam com o processo.
 */
export const PLAN_CACHE_CONTRACT = "capivara-plan-cache/v3" as const;

export interface PlanCache {
  contract: typeof PLAN_CACHE_CONTRACT;
  runId: string;
  /** sha do prompt do esqueleto → o JSON que ele produziu. */
  esqueletos: Record<string, string>;
  /** sha do prompt do arquiteto → o JSON que ele produziu. */
  arquiteturas: Record<string, string>;
  /** sha do prompt de escrita → a fase que ele produziu. */
  escritas: Record<string, string>;
  /** sha do prompt de auditoria que aprovou. Valor é o instante, para quem for ler. */
  aprovadas: Record<string, string>;
  /** As chaves `sha-da-task:autoridade` já aprovadas pelo auditor. */
  tasksAprovadas: string[];
  /** A base da auditoria de coerência: a autoridade e a assinatura de cada critério aprovado. */
  coerencia: { authority: string; approved: Record<string, string> } | null;
  updatedAt: string;
}

export function planCachePath(projectRoot: string, runId: string): string {
  return join(artifactPaths(projectRoot).handoffs, `${runId}.plan-cache.json`);
}

function vazio(runId: string): PlanCache {
  return { contract: PLAN_CACHE_CONTRACT, runId, esqueletos: {}, arquiteturas: {}, escritas: {}, aprovadas: {}, tasksAprovadas: [], coerencia: null, updatedAt: new Date(0).toISOString() };
}

export async function readPlanCache(projectRoot: string, runId: string): Promise<PlanCache> {
  try {
    const parsed = JSON.parse(await readFile(planCachePath(projectRoot, runId), "utf8")) as Partial<PlanCache>;
    if (parsed.contract !== PLAN_CACHE_CONTRACT || parsed.runId !== runId) return vazio(runId);
    return {
      contract: PLAN_CACHE_CONTRACT,
      runId,
      esqueletos: parsed.esqueletos ?? {},
      arquiteturas: parsed.arquiteturas ?? {},
      escritas: parsed.escritas ?? {},
      aprovadas: parsed.aprovadas ?? {},
      tasksAprovadas: Array.isArray(parsed.tasksAprovadas) ? parsed.tasksAprovadas.filter((chave) => typeof chave === "string") : [],
      coerencia: parsed.coerencia && typeof parsed.coerencia.authority === "string" && parsed.coerencia.approved ? parsed.coerencia : null,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return vazio(runId);
  }
}

export async function writePlanCache(projectRoot: string, cache: PlanCache): Promise<void> {
  await writeAtomic(planCachePath(projectRoot, cache.runId), `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 * O acesso que o orquestrador usa, com a gravação já embutida.
 *
 * Gravar a cada fase, e não no fim: o valor inteiro deste cache está em
 * sobreviver ao run que morre no meio, e um cache que só é salvo no fim morre
 * junto com ele.
 *
 * A gravação é serializada por uma promessa em cadeia porque as fases são
 * escritas em paralelo — duas gravações simultâneas do mesmo arquivo perderiam
 * uma das duas.
 */
export class MemoriaDoPlano {
  private fila: Promise<void> = Promise.resolve();

  private constructor(
    private readonly projectRoot: string,
    private readonly cache: PlanCache,
    private readonly ativa: boolean,
  ) {}

  /** `fresh` desliga a memória: quem pediu para recomeçar do zero recomeça mesmo. */
  static async abrir(projectRoot: string, runId: string, fresh = false): Promise<MemoriaDoPlano> {
    const cache = fresh ? vazio(runId) : await readPlanCache(projectRoot, runId);
    return new MemoriaDoPlano(projectRoot, cache, !fresh);
  }

  /** O esqueleto que este prompt já produziu, ou `null`. */
  esqueletoEscrito(prompt: string): string | null {
    if (!this.ativa) return null;
    return this.cache.esqueletos[sha12(prompt)] ?? null;
  }

  guardarEsqueleto(prompt: string, json: string): void {
    this.cache.esqueletos[sha12(prompt)] = json;
    this.gravar();
  }

  /** A arquitetura que este prompt já produziu, ou `null`. */
  arquiteturaEscrita(prompt: string): string | null {
    if (!this.ativa) return null;
    return this.cache.arquiteturas[sha12(prompt)] ?? null;
  }

  guardarArquitetura(prompt: string, json: string): void {
    this.cache.arquiteturas[sha12(prompt)] = json;
    this.gravar();
  }

  /** As chaves de task já aprovadas numa execução anterior. */
  tasksAprovadas(): readonly string[] {
    return this.ativa ? [...this.cache.tasksAprovadas] : [];
  }

  guardarTasksAprovadas(chaves: readonly string[]): void {
    const conhecidas = new Set(this.cache.tasksAprovadas);
    const novas = chaves.filter((chave) => !conhecidas.has(chave));
    if (novas.length === 0) return;
    this.cache.tasksAprovadas.push(...novas);
    this.gravar();
  }

  /** A base da coerência aprovada numa execução anterior, ou `null`. */
  coerenciaGuardada(): { authority: string; approved: Record<string, string> } | null {
    return this.ativa ? this.cache.coerencia : null;
  }

  guardarCoerencia(estado: { authority: string; approved: Record<string, string> } | null): void {
    this.cache.coerencia = estado;
    this.gravar();
  }

  /** A fase que este prompt já produziu, ou `null`. */
  faseEscrita(prompt: string): string | null {
    if (!this.ativa) return null;
    return this.cache.escritas[sha12(prompt)] ?? null;
  }

  guardarFase(prompt: string, markdown: string): void {
    this.cache.escritas[sha12(prompt)] = markdown;
    this.gravar();
  }

  /** Esta auditoria exata já aprovou? */
  jaAprovada(promptDeAuditoria: string): boolean {
    if (!this.ativa) return false;
    return this.cache.aprovadas[sha12(promptDeAuditoria)] !== undefined;
  }

  guardarAprovacao(promptDeAuditoria: string): void {
    this.cache.aprovadas[sha12(promptDeAuditoria)] = new Date().toISOString();
    this.gravar();
  }

  private gravar(): void {
    this.cache.updatedAt = new Date().toISOString();
    const instantaneo: PlanCache = {
      ...this.cache,
      esqueletos: { ...this.cache.esqueletos },
      arquiteturas: { ...this.cache.arquiteturas },
      escritas: { ...this.cache.escritas },
      aprovadas: { ...this.cache.aprovadas },
      tasksAprovadas: [...this.cache.tasksAprovadas],
      coerencia: this.cache.coerencia ? { authority: this.cache.coerencia.authority, approved: { ...this.cache.coerencia.approved } } : null,
    };
    this.fila = this.fila.then(async () => {
      await writePlanCache(this.projectRoot, instantaneo).catch(() => undefined);
    });
  }

  /** Espera o que estiver na fila. O run não pode terminar antes de o cache ir ao disco. */
  async fechar(): Promise<void> {
    await this.fila;
  }
}
