/**
 * O pacote de reparo documental no disco (§125 H; spec §8.1).
 *
 * `.capivara/repairs/upstream/<repair-id>/{manifest.json, diagnosis.md, evidence.json}`.
 * O conjunto é publicado de uma vez: montado numa pasta temporária ao lado,
 * validado relido do disco pela mesma função que a etapa destinatária usa, e
 * só então renomeado para o nome final — quem lê nunca vê um pacote pela
 * metade, e uma queda no meio deixa só a pasta temporária, que não tem o nome
 * de um reparo. Publicado, é imutável: o mesmo id não é reescrito; a única
 * mudança posterior é a decisão do usuário sobre o escopo, gravada no
 * manifesto e conferida de novo.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkUpstreamPackage,
  escopoDoReparo,
  idDoReparo,
  OPCOES_DE_ESCOPO,
  registrarDecisao,
  sha12,
  type DecisaoDeEscopo,
  type EtapaDestino,
  type ResultadoDoPacote,
  type UpstreamEvidence,
  type UpstreamManifest,
  UPSTREAM_REPAIR_CONTRACT,
} from "../contract/index.js";
import { writeAtomic } from "../state/atomic.js";
import { artifactPaths } from "../state/paths.js";

export function pastaDosReparos(projectRoot: string): string {
  return join(artifactPaths(projectRoot).root, "repairs", "upstream");
}

/** Os hashes dos documentos publicados que um reparo pode alcançar, lidos agora. */
export async function documentosPublicados(projectRoot: string): Promise<Record<string, string>> {
  const init = artifactPaths(projectRoot).init;
  const documentos: Record<string, string> = {};
  for (const nome of ["project-phases.md", "architecture.md", "environment.json", "skeleton.md"]) {
    const conteudo = await readFile(join(init, nome), "utf8").catch(() => null);
    if (conteudo !== null) documentos[nome] = sha12(conteudo);
  }
  return documentos;
}

export interface PedidoDeReparo {
  origin: UpstreamManifest["origin"];
  target: EtapaDestino;
  document: UpstreamManifest["document"];
  impact: UpstreamManifest["impact"];
  diagnosis: string;
  evidence: UpstreamEvidence;
  createdAt: string;
}

export type PublicacaoDoReparo = { ok: true; caminho: string; manifest: UpstreamManifest; jaExistia: boolean } | { ok: false; errors: string[] };

async function lerPasta(pasta: string, nome: string): Promise<{ manifest: unknown; diagnosis: string; evidenceRaw: string; pasta: string } | null> {
  const [manifesto, diagnosis, evidenceRaw] = await Promise.all([
    readFile(join(pasta, "manifest.json"), "utf8").catch(() => null),
    readFile(join(pasta, "diagnosis.md"), "utf8").catch(() => null),
    readFile(join(pasta, "evidence.json"), "utf8").catch(() => null),
  ]);
  if (manifesto === null || diagnosis === null || evidenceRaw === null) return null;
  let manifest: unknown = null;
  try {
    manifest = JSON.parse(manifesto);
  } catch {
    manifest = null;
  }
  return { manifest, diagnosis, evidenceRaw, pasta: nome };
}

/** Lê e valida um pacote publicado contra os documentos de agora. */
export async function validarReparo(projectRoot: string, repairId: string, documentos?: Record<string, string>): Promise<ResultadoDoPacote> {
  // O id vira caminho: nada de separador nem de "..".
  if (!/^UR-[A-Za-z0-9-]+$/u.test(repairId)) return { ok: false, errors: [`id de reparo inválido: ${repairId}`] };
  const lido = await lerPasta(join(pastaDosReparos(projectRoot), repairId), repairId);
  if (lido === null) return { ok: false, errors: [`pacote ${repairId} incompleto: faltam manifest.json, diagnosis.md ou evidence.json`] };
  try {
    return checkUpstreamPackage(lido, documentos ?? (await documentosPublicados(projectRoot)));
  } catch (erro) {
    // Manifesto com tipos trocados é recusado, nunca derruba a etapa que o confere.
    return { ok: false, errors: [`pacote ${repairId} malformado: ${erro instanceof Error ? erro.message : String(erro)}`] };
  }
}

/**
 * Publica o pacote, ou recusa sem escrever nada. A validação é a da etapa
 * destinatária, sobre os bytes que ficaram no disco.
 */
export async function publicarReparo(projectRoot: string, pedido: PedidoDeReparo): Promise<PublicacaoDoReparo> {
  const repairId = idDoReparo(pedido.origin);
  const base = pastaDosReparos(projectRoot);
  const destino = join(base, repairId);
  const documentos = await documentosPublicados(projectRoot);
  const existente = await validarReparo(projectRoot, repairId, documentos);
  if (existente.ok) return { ok: true, caminho: destino, manifest: existente.manifest, jaExistia: true };

  const evidenceRaw = `${JSON.stringify(pedido.evidence, null, 2)}\n`;
  const manifest: UpstreamManifest = {
    contract: UPSTREAM_REPAIR_CONTRACT,
    repairId,
    createdAt: pedido.createdAt,
    origin: pedido.origin,
    source: "build",
    target: pedido.target,
    document: pedido.document,
    state: "UPSTREAM_REPAIR_REQUIRED",
    impact: pedido.impact,
    files: { "diagnosis.md": sha12(pedido.diagnosis), "evidence.json": sha12(evidenceRaw) },
  };
  const antes = checkUpstreamPackage({ pasta: repairId, manifest, diagnosis: pedido.diagnosis, evidenceRaw }, documentos);
  if (!antes.ok) return antes;

  await mkdir(base, { recursive: true });
  const temporaria = join(base, `.${repairId}.tmp-${randomUUID().slice(0, 8)}`);
  await mkdir(temporaria);
  try {
    await writeFile(join(temporaria, "diagnosis.md"), pedido.diagnosis, "utf8");
    await writeFile(join(temporaria, "evidence.json"), evidenceRaw, "utf8");
    await writeFile(join(temporaria, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const relido = await lerPasta(temporaria, repairId);
    const depois = relido ? checkUpstreamPackage(relido, documentos) : { ok: false as const, errors: ["o pacote gravado não pôde ser relido"] };
    if (!depois.ok) return depois;
    // Um pacote inválido com o mesmo id (de uma queda antiga) sai do caminho, guardado ao lado.
    await rename(destino, `${destino}.invalido-${randomUUID().slice(0, 8)}`).catch(() => undefined);
    await rename(temporaria, destino);
    return { ok: true, caminho: destino, manifest, jaExistia: false };
  } finally {
    await rm(temporaria, { recursive: true, force: true });
  }
}

/** Os pacotes que esperam uma etapa, cada um com o resultado da validação de agora. */
export async function reparosPendentes(projectRoot: string, target: EtapaDestino): Promise<{ repairId: string; resultado: ResultadoDoPacote }[]> {
  const base = pastaDosReparos(projectRoot);
  const nomes = (await readdir(base).catch(() => [] as string[])).filter((nome) => nome.startsWith("UR-") && !nome.includes(".invalido-")).sort();
  const documentos = await documentosPublicados(projectRoot);
  const pendentes: { repairId: string; resultado: ResultadoDoPacote }[] = [];
  for (const repairId of nomes) {
    const resultado = await validarReparo(projectRoot, repairId, documentos);
    // O inválido aparece também: a etapa diz por que não o aceita, em vez de ignorá-lo em silêncio.
    if (!resultado.ok || (resultado.manifest.target === target && resultado.manifest.state !== "ABORTED")) pendentes.push({ repairId, resultado });
  }
  return pendentes;
}

/**
 * A decisão do usuário sobre um reparo que alcança além do defeito (spec §8.2).
 * Só vale sobre um pacote válido agora, e para o impacto que ele mostra; a
 * recusa (abortar) muda o estado do pacote e mais nada.
 */
export async function decidirEscopo(projectRoot: string, repairId: string, decisao: DecisaoDeEscopo, now: () => Date = () => new Date()): Promise<ResultadoDoPacote> {
  const atual = await validarReparo(projectRoot, repairId);
  if (!atual.ok) return atual;
  const novo = registrarDecisao(atual.manifest, decisao, now().toISOString());
  await writeAtomic(join(pastaDosReparos(projectRoot), repairId, "manifest.json"), `${JSON.stringify(novo, null, 2)}\n`);
  return validarReparo(projectRoot, repairId);
}

export interface ConferenciaNaEntrada {
  /** Linhas para a tela: o que foi recusado, o que espera e o que foi decidido. */
  linhas: string[];
  /** Os pacotes válidos que continuam esperando esta etapa (não abortados). */
  pendentes: string[];
}

/**
 * A entrada da etapa destinatária (spec §8.1 e §8.2): todo pacote é conferido
 * de novo, com os documentos de agora; o inválido é dito e ignorado — nenhum
 * agente é chamado sobre ele —; o válido cujo reparo alcança além da fase de
 * origem pede a decisão do usuário, presa ao impacto mostrado. Sem quem
 * responda (`perguntar` ausente ou sem resposta), nada muda: o pacote espera.
 *
 * A edição automática do documento a partir do pacote não acontece aqui
 * (§125 H): a troca segura de um documento publicado — carimbos, identidade do
 * run, ledger — não foi demonstrável, e a especificação manda não automatizar
 * nesse caso. O que a etapa faz é conferir, mostrar e registrar a decisão.
 */
export async function conferirReparosNaEntrada(
  projectRoot: string,
  target: EtapaDestino,
  origem: (manifest: UpstreamManifest) => { phase: number; components: readonly string[]; contracts: readonly string[] },
  perguntar?: (texto: string, opcoes: readonly DecisaoDeEscopo[]) => Promise<DecisaoDeEscopo | null>,
  now: () => Date = () => new Date(),
): Promise<ConferenciaNaEntrada> {
  const linhas: string[] = [];
  const pendentes: string[] = [];
  for (const { repairId, resultado } of await reparosPendentes(projectRoot, target)) {
    if (!resultado.ok) {
      linhas.push(`reparo documental ${repairId} RECUSADO na entrada do ${target}: ${resultado.errors.join("; ")}`);
      continue;
    }
    const manifest = resultado.manifest;
    const escopo = escopoDoReparo(manifest, origem(manifest));
    const onde = `${manifest.document.name}, a partir de ${manifest.origin.phaseId}/${manifest.origin.defectId} (${manifest.origin.gate}, ciclo ${manifest.origin.cycle})`;
    if (escopo.localizado || manifest.state === "SCOPE_AUTHORIZED") {
      linhas.push(`reparo documental ${repairId} pendente: ${onde}; ${escopo.localizado ? "localizado no defeito" : "escopo ampliado já autorizado para este impacto"}`);
      pendentes.push(repairId);
      continue;
    }
    const alem = [
      ...(escopo.alem.phases.length > 0 ? [`fases ${escopo.alem.phases.join(", ")}`] : []),
      ...(escopo.alem.components.length > 0 ? [`componentes ${escopo.alem.components.join(", ")}`] : []),
      ...(escopo.alem.contracts.length > 0 ? [`contratos ${escopo.alem.contracts.join(", ")}`] : []),
    ].join("; ");
    const texto =
      `O reparo documental ${repairId} (${onde}) alcança além do defeito: ${alem}. ` +
      "Continuar autoriza só este impacto — o que já foi construído nessas fases será revalidado; extensão adicional exige nova aprovação. " +
      "Abortar encerra esta recuperação; um novo run só começa por comando seu.";
    const decisao = perguntar ? await perguntar(texto, OPCOES_DE_ESCOPO) : null;
    if (decisao === null) {
      linhas.push(`reparo documental ${repairId} espera decisão: ${alem}`);
      pendentes.push(repairId);
      continue;
    }
    const decidido = await decidirEscopo(projectRoot, repairId, decisao, now);
    if (!decidido.ok) {
      linhas.push(`reparo documental ${repairId}: a decisão não foi registrada — ${decidido.errors.join("; ")}`);
      continue;
    }
    linhas.push(`reparo documental ${repairId}: ${decisao}`);
    if (decidido.manifest.state !== "ABORTED") pendentes.push(repairId);
  }
  return { linhas, pendentes };
}

