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

export const PLAN_CACHE_CONTRACT = "capivara-plan-cache/v1" as const;

export interface PlanCache {
  contract: typeof PLAN_CACHE_CONTRACT;
  runId: string;
  /** sha do prompt de escrita → a fase que ele produziu. */
  escritas: Record<string, string>;
  /** sha do prompt de auditoria que aprovou. Valor é o instante, para quem for ler. */
  aprovadas: Record<string, string>;
  updatedAt: string;
}

export function planCachePath(projectRoot: string, runId: string): string {
  return join(artifactPaths(projectRoot).handoffs, `${runId}.plan-cache.json`);
}

function vazio(runId: string): PlanCache {
  return { contract: PLAN_CACHE_CONTRACT, runId, escritas: {}, aprovadas: {}, updatedAt: new Date(0).toISOString() };
}

export async function readPlanCache(projectRoot: string, runId: string): Promise<PlanCache> {
  try {
    const parsed = JSON.parse(await readFile(planCachePath(projectRoot, runId), "utf8")) as Partial<PlanCache>;
    if (parsed.contract !== PLAN_CACHE_CONTRACT || parsed.runId !== runId) return vazio(runId);
    return {
      contract: PLAN_CACHE_CONTRACT,
      runId,
      escritas: parsed.escritas ?? {},
      aprovadas: parsed.aprovadas ?? {},
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
    const cache = fresh ? { ...(await readPlanCache(projectRoot, runId)), escritas: {}, aprovadas: {} } : await readPlanCache(projectRoot, runId);
    return new MemoriaDoPlano(projectRoot, cache, !fresh);
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
      escritas: { ...this.cache.escritas },
      aprovadas: { ...this.cache.aprovadas },
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
