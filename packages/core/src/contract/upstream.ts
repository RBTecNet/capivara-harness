/**
 * O pacote de reparo documental (BUILD → PLAN → INIT), como contrato (§125 H; spec §8).
 *
 * O build às vezes descobre que o defeito não é do código: o critério de
 * aceitação contradiz a arquitetura, o contrato de um componente não pode ser
 * cumprido como foi escrito. Antes, isso virava ciclos gastos contra uma
 * impossibilidade, ou um agente "resolvendo" por conta própria. Aqui o
 * encaminhamento é um pacote com forma fixa, e esta função pura diz se ele é
 * íntegro e coerente — o estado `UPSTREAM_REPAIR_REQUIRED` só existe com um
 * pacote que passe por ela, e quem recebe (o PLAN, o INIT) chama a mesma
 * função na entrada. Sem pacote válido, nenhum agente é convocado.
 *
 * Nada aqui decide o reparo; só se o diagnóstico está completo, se as provas
 * conferem pelo hash e se o documento diagnosticado ainda é o publicado.
 */

import { sha12 } from "./stamps.js";

export const UPSTREAM_REPAIR_CONTRACT = "capivara-upstream-repair/v1" as const;

export type EtapaDestino = "plan" | "init";

export type EstadoDoReparoUpstream =
  /** Publicado; espera a etapa destinatária. */
  | "UPSTREAM_REPAIR_REQUIRED"
  /** O usuário autorizou o impacto mostrado, além do defeito. */
  | "SCOPE_AUTHORIZED"
  /** O usuário abortou a recuperação; o pacote fica como registro. */
  | "ABORTED";

/** Os documentos que cada etapa revisa: o PLAN corrige arquitetura e fases; o INIT, o produto. */
export const DOCUMENTOS_DA_ETAPA: Record<EtapaDestino, readonly string[]> = {
  plan: ["project-phases.md", "architecture.md", "environment.json"],
  init: ["skeleton.md"],
};

export const OPCOES_DE_ESCOPO = ["CONTINUAR COM ESCOPO AMPLIADO", "ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE"] as const;
export type DecisaoDeEscopo = (typeof OPCOES_DE_ESCOPO)[number];

export interface ImpactoUpstream {
  phases: number[];
  components: string[];
  contracts: string[];
}

export interface UpstreamManifest {
  contract: typeof UPSTREAM_REPAIR_CONTRACT;
  repairId: string;
  createdAt: string;
  origin: { runId: string; phaseId: string; gate: string; cycle: number; defectId: string };
  source: "build";
  target: EtapaDestino;
  /** O documento diagnosticado, na versão em que o defeito foi provado. */
  document: { name: string; contract: string; sha12: string };
  state: EstadoDoReparoUpstream;
  /** O que o reparo pode alcançar além da fase de origem. */
  impact: ImpactoUpstream;
  /** Os hashes dos outros dois arquivos do pacote: o manifesto amarra o conjunto. */
  files: { "diagnosis.md": string; "evidence.json": string };
  /** A decisão do usuário, presa ao impacto que lhe foi mostrado. */
  authorization?: { decision: DecisaoDeEscopo; impactSha12: string; at: string };
}

export interface UpstreamEvidence {
  artifacts: { path: string; sha12: string; lines?: string }[];
  handoffs: string[];
  /** As tentativas no BUILD antes do encaminhamento: o último recurso tem de ser o último. */
  recovery: { strategy: string; result: string; cycle: number }[];
  /** A escada do defeito acabou sem estratégia com informação nova. */
  exhausted: boolean;
}

/** As seções que o diagnóstico tem de ter, nesta ordem de leitura. */
export const SECOES_DO_DIAGNOSTICO = ["Defeito", "Observado", "Esperado", "Contornos tentados", "Limites da edição"] as const;

export interface PacoteLido {
  /** O nome da pasta: tem de ser o `repairId`. */
  pasta: string;
  manifest: unknown;
  diagnosis: string;
  /** O texto cru do evidence.json: o hash é dele, não de uma reserialização. */
  evidenceRaw: string;
}

export type ResultadoDoPacote = { ok: true; manifest: UpstreamManifest; evidence: UpstreamEvidence } | { ok: false; errors: string[] };

const SHA12 = /^[0-9a-f]{12}$/u;
const ID_DO_REPARO = /^UR-[a-z0-9-]+-P\d+-[A-Za-z]\d+-D\d+-c\d+$/u;

/** O hash do impacto, canônico: a autorização vale para ESTE impacto, e só para ele. */
export function shaDoImpacto(impacto: ImpactoUpstream): string {
  return sha12(
    JSON.stringify({
      phases: [...new Set(impacto.phases)].sort((a, b) => a - b),
      components: [...new Set(impacto.components.map((nome) => nome.toLowerCase()))].sort(),
      contracts: [...new Set(impacto.contracts)].sort(),
    }),
  );
}

/** O id de um pacote: run, fase, defeito e ciclo — um encaminhamento por defeito e ciclo. */
export function idDoReparo(origin: UpstreamManifest["origin"]): string {
  return `UR-${origin.runId.toLowerCase()}-${origin.phaseId}-${origin.defectId}-c${origin.cycle}`;
}

/** As seções do diagnóstico que faltam ou estão vazias. */
export function secoesFaltando(diagnostico: string): string[] {
  const faltam: string[] = [];
  for (const secao of SECOES_DO_DIAGNOSTICO) {
    const inicio = new RegExp(`^##\\s+${secao}\\s*$`, "mu").exec(diagnostico);
    if (!inicio) {
      faltam.push(secao);
      continue;
    }
    const resto = diagnostico.slice(inicio.index + inicio[0].length);
    const corpo = (/^##\s/mu.exec(resto) ? resto.slice(0, /^##\s/mu.exec(resto)!.index) : resto).trim();
    if (corpo === "") faltam.push(secao);
  }
  return faltam;
}

/**
 * O pacote é íntegro e coerente? Determinístico, antecipado, sem modelo.
 *
 * `documentos` são os hashes dos documentos PUBLICADOS agora: o pacote que
 * diagnosticou outra versão é velho — o defeito pode já ter sido corrigido, ou
 * mudado de lugar — e é recusado em vez de aplicado.
 */
export function checkUpstreamPackage(pacote: PacoteLido, documentos: Readonly<Record<string, string>>): ResultadoDoPacote {
  const errors: string[] = [];
  const m = pacote.manifest as Partial<UpstreamManifest> | null;
  if (!m || typeof m !== "object") return { ok: false, errors: ["manifest.json ilegível"] };
  if (m.contract !== UPSTREAM_REPAIR_CONTRACT) errors.push(`manifest.contract deve ser ${UPSTREAM_REPAIR_CONTRACT}`);
  if (typeof m.repairId !== "string" || !ID_DO_REPARO.test(m.repairId)) errors.push("manifest.repairId ausente ou fora do formato UR-<run>-<fase>-<defeito>-c<ciclo>");
  else if (m.repairId !== pacote.pasta) errors.push(`manifest.repairId (${m.repairId}) não é o nome da pasta (${pacote.pasta})`);
  const o = m.origin;
  if (!o || typeof o.runId !== "string" || !/^P\d+$/u.test(o.phaseId ?? "") || typeof o.gate !== "string" || !Number.isInteger(o.cycle) || (o.cycle ?? 0) < 1 || !/^[A-Za-z]\d+-D\d+$/u.test(o.defectId ?? "")) {
    errors.push("manifest.origin incompleto: run, fase, gate, ciclo e defeito");
  } else if (typeof m.repairId === "string" && m.repairId !== idDoReparo(o as UpstreamManifest["origin"])) {
    errors.push("manifest.repairId não corresponde à origem (run, fase, defeito, ciclo)");
  }
  if (m.source !== "build") errors.push("manifest.source deve ser build");
  if (m.target !== "plan" && m.target !== "init") errors.push("manifest.target deve ser plan ou init");
  const doc = m.document;
  if (!doc || typeof doc.name !== "string" || typeof doc.contract !== "string" || !SHA12.test(doc.sha12 ?? "")) {
    errors.push("manifest.document incompleto: nome, contrato e sha12 da versão diagnosticada");
  } else {
    if ((m.target === "plan" || m.target === "init") && !DOCUMENTOS_DA_ETAPA[m.target].includes(doc.name)) {
      errors.push(`${doc.name} não é documento da etapa ${m.target}: o reparo iria à autoridade errada`);
    }
    const publicado = documentos[doc.name];
    if (publicado === undefined) errors.push(`${doc.name} não está publicado: não há o que reparar`);
    else if (publicado !== doc.sha12) errors.push(`${doc.name} mudou desde o diagnóstico (${doc.sha12} → ${publicado}): o pacote é de outra versão`);
  }
  if (m.state !== "UPSTREAM_REPAIR_REQUIRED" && m.state !== "SCOPE_AUTHORIZED" && m.state !== "ABORTED") errors.push("manifest.state desconhecido");
  const impacto = m.impact;
  const impactoValido = !!impacto && Array.isArray(impacto.phases) && Array.isArray(impacto.components) && Array.isArray(impacto.contracts);
  if (!impactoValido) errors.push("manifest.impact incompleto: fases, componentes e contratos alcançados");
  if (m.authorization !== undefined) {
    if (!OPCOES_DE_ESCOPO.includes(m.authorization.decision)) errors.push("manifest.authorization.decision fora das opções");
    else if (impactoValido && m.authorization.impactSha12 !== shaDoImpacto(impacto)) {
      errors.push("a autorização foi dada para outro impacto: extensão adicional exige nova aprovação");
    }
    const esperado = m.authorization.decision === "ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE" ? "ABORTED" : "SCOPE_AUTHORIZED";
    if (m.state !== esperado) errors.push(`manifest.state (${m.state}) não corresponde à decisão registrada`);
  } else if (m.state === "SCOPE_AUTHORIZED" || m.state === "ABORTED") {
    errors.push(`manifest.state ${m.state} sem a decisão do usuário que o justifique`);
  }
  if (!m.files || m.files["diagnosis.md"] !== sha12(pacote.diagnosis)) errors.push("diagnosis.md não confere com o hash do manifesto");
  if (!m.files || m.files["evidence.json"] !== sha12(pacote.evidenceRaw)) errors.push("evidence.json não confere com o hash do manifesto");
  const faltam = secoesFaltando(pacote.diagnosis);
  if (faltam.length > 0) errors.push(`diagnosis.md sem as seções: ${faltam.join(", ")}`);

  let evidence: UpstreamEvidence | null = null;
  try {
    evidence = JSON.parse(pacote.evidenceRaw) as UpstreamEvidence;
  } catch {
    errors.push("evidence.json ilegível");
  }
  if (evidence) {
    if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0 || evidence.artifacts.some((item) => typeof item.path !== "string" || !SHA12.test(item.sha12 ?? ""))) {
      errors.push("evidence.json sem artefatos com caminho e sha12");
    }
    if (!Array.isArray(evidence.handoffs)) errors.push("evidence.json sem a lista de handoffs");
    if (!Array.isArray(evidence.recovery) || evidence.recovery.length === 0) errors.push("evidence.json sem o histórico de recuperação no BUILD: o encaminhamento é o último recurso");
    if (evidence.exhausted !== true) errors.push("evidence.json não registra a escada esgotada: ainda há estratégia compatível no BUILD");
  }
  return errors.length === 0 ? { ok: true, manifest: m as UpstreamManifest, evidence: evidence! } : { ok: false, errors };
}

/**
 * O reparo fica no defeito, ou alcança mais? Mais é qualquer outra fase, ou
 * componente/contrato que não é da fase de origem — já construído ou não.
 */
export function escopoDoReparo(manifest: UpstreamManifest, daOrigem: { phase: number; components: readonly string[]; contracts: readonly string[] }): { localizado: boolean; alem: ImpactoUpstream } {
  const componentes = new Set(daOrigem.components.map((nome) => nome.toLowerCase()));
  const contratos = new Set(daOrigem.contracts);
  const alem: ImpactoUpstream = {
    phases: manifest.impact.phases.filter((numero) => numero !== daOrigem.phase),
    components: manifest.impact.components.filter((nome) => !componentes.has(nome.toLowerCase())),
    contracts: manifest.impact.contracts.filter((contrato) => !contratos.has(contrato)),
  };
  return { localizado: alem.phases.length === 0 && alem.components.length === 0 && alem.contracts.length === 0, alem };
}

/** A decisão do usuário, registrada no manifesto: um manifesto novo, nunca o mesmo editado. */
export function registrarDecisao(manifest: UpstreamManifest, decision: DecisaoDeEscopo, at: string): UpstreamManifest {
  return {
    ...manifest,
    state: decision === "ABORTAR A RECUPERAÇÃO E INICIAR NOVAMENTE" ? "ABORTED" : "SCOPE_AUTHORIZED",
    authorization: { decision, impactSha12: shaDoImpacto(manifest.impact), at },
  };
}
