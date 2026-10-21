/**
 * O registro das evidências do build (§125 B; spec §4).
 *
 * Um gate verde era um fato de memória: valia até o fim do ciclo e sumia. O
 * build não sabia, depois de um reparo, quais provas continuavam valendo — e
 * por isso repetia tudo: a suíte, a verificação inteira, os fluxos. Aqui cada
 * prova vira um registro com o que ela afirma, contra o que foi tirada
 * (documentos e estado do código) e onde está o artefato que a sustenta. É o
 * Core quem registra e quem invalida: nenhum agente aprova escrevendo um status.
 *
 * O arquivo é append-only, como o `events.tsv`: uma linha `evidence` é
 * imutável, e a validade muda por linhas `validity` que se acumulam. A validade
 * corrente sai do replay; nada do histórico é reescrito, e uma evidência nova
 * do mesmo item substitui a aplicabilidade da anterior sem apagá-la.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { appendLine } from "../state/atomic.js";

export const EVIDENCE_CONTRACT = "capivara-evidence/v1" as const;

export type EvidenceGate = "G0" | "G1" | "G2" | "G3" | "G4" | "INTEGRACAO" | "ENTREGA";
export type EvidenceOutcome = "PASS" | "PASS_WITH_WARNING" | "REPAIR_REQUIRED" | "NOT_APPLICABLE";
export type EvidenceValidityState = "VALID" | "INVALIDATED" | "UNKNOWN";

/**
 * O código contra o qual a prova foi tirada.
 *
 * `tree` é a árvore de CONTEÚDO do que seria commitado (`estadoDoCodigo`), não a
 * assinatura relativa ao HEAD: duas árvores limpas em commits diferentes têm a
 * mesma assinatura e conteúdos diferentes. Sem Git, `tree` vem prefixado e não
 * permite dizer o que mudou — o impacto é desconhecido.
 */
export interface CodeState {
  head: string | null;
  tree: string | null;
}

export interface EvidenceInputs {
  /** A fase, a fatia da arquitetura, a task, o roteiro: o que a prova leu. */
  documents: { name: string; sha12: string }[];
  code: CodeState | null;
  command?: string;
  extra?: Record<string, string>;
}

/** Componente + contrato + comportamento: a granularidade da spec, sem grafo próprio. */
export interface EvidenceScope {
  components: string[];
  contracts: string[];
  artifacts: string[];
  flows: string[];
  tasks: number[];
}

/** Um artefato que a prova produziu, pelo caminho relativo ao run e pelo conteúdo. */
export interface ArtifactRef {
  path: string;
  sha12: string;
}

export interface Evidence {
  contract: typeof EVIDENCE_CONTRACT;
  evidenceId: string;
  runId: string;
  phaseId: string;
  gate: EvidenceGate;
  /** O item comprovado: `suite`, `task-2`, `fluxos`, `sessao-3`… estável dentro da fase. */
  checkId: string;
  createdAt: string;
  claim: string;
  outcome: EvidenceOutcome;
  inputs: EvidenceInputs;
  scope: EvidenceScope;
  supports: string[];
  artifactRefs: ArtifactRef[];
}

export interface EvidenceValidity {
  state: EvidenceValidityState;
  reason: string;
  /** O que invalidou: um reparo, uma revisão documental, a substituição por outra prova. */
  event: string;
  at: string;
}

export interface CurrentEvidence {
  evidence: Evidence;
  validity: EvidenceValidity;
}

type Linha =
  | ({ kind: "evidence" } & Evidence)
  | { kind: "validity"; contract: typeof EVIDENCE_CONTRACT; evidenceId: string; state: EvidenceValidityState; reason: string; event: string; at: string };

export function evidenciasDoRun(runRoot: string): string {
  return join(runRoot, "evidence.jsonl");
}

export function emptyScope(parcial: Partial<EvidenceScope> = {}): EvidenceScope {
  return { components: [], contracts: [], artifacts: [], flows: [], tasks: [], ...parcial };
}

/** O sha de um artefato em disco; ausente é vazio, e a referência fica sem prova. */
export async function referenciaDeArtefato(runRoot: string, relativo: string): Promise<ArtifactRef | null> {
  const conteudo = await readFile(join(runRoot, relativo)).catch(() => null);
  if (conteudo === null) return null;
  return { path: relativo, sha12: createHash("sha256").update(conteudo).digest("hex").slice(0, 12) };
}

/**
 * Onde está, hoje, o artefato que uma evidência cita.
 *
 * Cada execução nova do mesmo run move `logs/` e `prompts/` para
 * `attempts/<execução>/`. O caminho gravado continua o mesmo; o conteúdo é o
 * que identifica — o arquivo é procurado no lugar original e depois em cada
 * tentativa arquivada, e só vale o que tiver o mesmo sha.
 */
export async function localizarArtefato(runRoot: string, ref: ArtifactRef): Promise<string | null> {
  const confere = async (caminho: string): Promise<boolean> => {
    const conteudo = await readFile(caminho).catch(() => null);
    return conteudo !== null && createHash("sha256").update(conteudo).digest("hex").slice(0, 12) === ref.sha12;
  };
  const direto = join(runRoot, ref.path);
  if (await confere(direto)) return direto;
  const tentativas = await readdir(join(runRoot, "attempts")).catch(() => [] as string[]);
  for (const tentativa of tentativas.sort().reverse()) {
    const arquivado = join(runRoot, "attempts", tentativa, ref.path);
    if (await confere(arquivado)) return arquivado;
  }
  return null;
}

export class LivroDeEvidencias {
  /*
   * As linhas entram em fila: no build paralelo, fases diferentes registram ao
   * mesmo tempo no mesmo arquivo, e uma linha não pode cortar a outra.
   */
  private fila: Promise<void> = Promise.resolve();

  private constructor(
    private readonly arquivo: string,
    private readonly runId: string,
    private readonly registros: Evidence[],
    private readonly validade: Map<string, EvidenceValidity>,
  ) {}

  static async abrir(runRoot: string, runId: string): Promise<LivroDeEvidencias> {
    const arquivo = evidenciasDoRun(runRoot);
    const registros: Evidence[] = [];
    const validade = new Map<string, EvidenceValidity>();
    const bruto = await readFile(arquivo, "utf8").catch(() => "");
    for (const texto of bruto.split("\n")) {
      if (texto.trim() === "") continue;
      let linha: Linha;
      try {
        linha = JSON.parse(texto) as Linha;
      } catch {
        // A linha truncada por uma queda no meio da escrita é descartada; o resto vale.
        continue;
      }
      if (linha.contract !== EVIDENCE_CONTRACT) continue;
      if (linha.kind === "evidence" && typeof linha.evidenceId === "string") {
        const { kind: _kind, ...evidencia } = linha;
        registros.push(evidencia);
        validade.set(evidencia.evidenceId, { state: "VALID", reason: "registrada", event: "registro", at: evidencia.createdAt });
      } else if (linha.kind === "validity" && validade.has(linha.evidenceId)) {
        validade.set(linha.evidenceId, { state: linha.state, reason: linha.reason, event: linha.event, at: linha.at });
      }
    }
    return new LivroDeEvidencias(arquivo, runId, registros, validade);
  }

  private emFila(trabalho: () => Promise<void>): Promise<void> {
    const vez = this.fila.then(trabalho);
    this.fila = vez.catch(() => undefined);
    return vez;
  }

  /** Registra uma prova e retira a aplicabilidade da anterior do mesmo item. */
  async registrar(
    entrada: Omit<Evidence, "contract" | "evidenceId" | "createdAt" | "runId"> & { now?: () => Date },
  ): Promise<Evidence> {
    const { now = () => new Date(), ...dados } = entrada;
    const mesmoItem = this.registros.filter((registro) => registro.phaseId === dados.phaseId && registro.checkId === dados.checkId);
    const evidencia: Evidence = {
      contract: EVIDENCE_CONTRACT,
      evidenceId: `${dados.phaseId}.${dados.checkId}.${mesmoItem.length + 1}`,
      runId: this.runId,
      createdAt: now().toISOString(),
      ...dados,
    };
    const anterior = mesmoItem.at(-1);
    this.registros.push(evidencia);
    this.validade.set(evidencia.evidenceId, { state: "VALID", reason: "registrada", event: "registro", at: evidencia.createdAt });
    await this.emFila(() => appendLine(this.arquivo, JSON.stringify({ kind: "evidence", ...evidencia })));
    if (anterior && this.validade.get(anterior.evidenceId)?.state !== "INVALIDATED") {
      await this.alterarValidade(anterior.evidenceId, "INVALIDATED", `substituída por ${evidencia.evidenceId}`, "substituição", now);
    }
    return evidencia;
  }

  async alterarValidade(evidenceId: string, state: EvidenceValidityState, reason: string, event: string, now = () => new Date()): Promise<void> {
    if (!this.validade.has(evidenceId)) return;
    const atual = this.validade.get(evidenceId)!;
    if (atual.state === state && atual.reason === reason) return;
    const at = now().toISOString();
    this.validade.set(evidenceId, { state, reason, event, at });
    await this.emFila(() => appendLine(this.arquivo, JSON.stringify({ kind: "validity", contract: EVIDENCE_CONTRACT, evidenceId, state, reason, event, at })));
  }

  /** A prova mais recente de um item da fase, com a validade de agora. */
  atual(phaseId: string, checkId: string): CurrentEvidence | null {
    for (let indice = this.registros.length - 1; indice >= 0; indice -= 1) {
      const evidencia = this.registros[indice]!;
      if (evidencia.phaseId === phaseId && evidencia.checkId === checkId) {
        return { evidence: evidencia, validity: this.validade.get(evidencia.evidenceId)! };
      }
    }
    return null;
  }

  /** A mais recente de cada item da fase. */
  daFase(phaseId: string): CurrentEvidence[] {
    const vistos = new Set<string>();
    const saida: CurrentEvidence[] = [];
    for (let indice = this.registros.length - 1; indice >= 0; indice -= 1) {
      const evidencia = this.registros[indice]!;
      if (evidencia.phaseId !== phaseId || vistos.has(evidencia.checkId)) continue;
      vistos.add(evidencia.checkId);
      saida.push({ evidence: evidencia, validity: this.validade.get(evidencia.evidenceId)! });
    }
    return saida.reverse();
  }

  historico(): readonly Evidence[] {
    return this.registros;
  }

  validadeDe(evidenceId: string): EvidenceValidity | null {
    return this.validade.get(evidenceId) ?? null;
  }
}
