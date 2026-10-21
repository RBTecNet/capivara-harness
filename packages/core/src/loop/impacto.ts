/**
 * O que uma mudança atinge (§125 B; spec §3.3).
 *
 * Depois de um reparo, a pergunta não é "rodo tudo de novo?" — é "quais provas
 * continuam valendo?". A resposta é determinística e barata, nesta ordem: o
 * conteúdo é o mesmo (nada atingido); o arquivo mudado está no escopo da prova
 * (atingida); não dá para provar nem uma coisa nem outra (desconhecido). O
 * desconhecido nunca é aprovado em silêncio: quem o recebe resolve com a menor
 * verificação suficiente.
 *
 * Granularidade de componente + contrato + comportamento, com o que o PLAN e o
 * Git já dizem — os arquivos que a arquitetura fixa e os que cada fase
 * commitou. Nada de grafo próprio, nada de análise semântica do código.
 */

import { posix } from "node:path";
import { projectPaths, type TaskBlock } from "../contract/index.js";
import type { TerritorioDoFluxo } from "./arquitetura.js";

export type Impacto = "NONE" | "AFFECTED" | "UNKNOWN";

export interface ResultadoDoImpacto {
  impacto: Impacto;
  motivo: string;
  /** Os arquivos que decidiram: os que caem no escopo, ou os que não se sabe. */
  arquivos: string[];
}

function lista(arquivos: readonly string[], max = 4): string {
  return arquivos.slice(0, max).join(", ") + (arquivos.length > max ? ` e mais ${arquivos.length - max}` : "");
}

const nada = (): ResultadoDoImpacto => ({ impacto: "NONE", motivo: "o código é o mesmo da prova", arquivos: [] });
const semSaber = (): ResultadoDoImpacto => ({
  impacto: "UNKNOWN",
  motivo: "não há como saber o que mudou desde a prova (sem histórico Git do conteúdo)",
  arquivos: [],
});

/** Um caminho está no escopo? Igual, ou dentro de um diretório do escopo. */
function noEscopo(arquivo: string, escopo: readonly { path: string; directory: boolean }[]): boolean {
  return escopo.some((item) => item.path === arquivo || (item.directory && arquivo.startsWith(`${item.path.replace(/\/$/u, "")}/`)));
}

/** A suíte prova o produto inteiro: qualquer arquivo do produto que mude a atinge. */
export function impactoNaSuite(arquivos: readonly string[] | null): ResultadoDoImpacto {
  if (arquivos === null) return semSaber();
  if (arquivos.length === 0) return nada();
  return { impacto: "AFFECTED", motivo: `${arquivos.length} arquivo(s) do produto mudaram: ${lista(arquivos)}`, arquivos: [...arquivos] };
}

/** Os arquivos que uma task cita, mais os que a arquitetura fixa para os componentes da fase. */
export function escopoDaTask(task: TaskBlock, arquivosDosComponentes: readonly string[] = []): { path: string; directory: boolean }[] {
  const texto = [task.title, ...task.acceptanceCriteria, task.designRef].filter(Boolean).join("\n");
  const citados = projectPaths(texto);
  const vistos = new Set(citados.map((item) => item.path));
  for (const arquivo of arquivosDosComponentes) {
    if (vistos.has(arquivo)) continue;
    vistos.add(arquivo);
    citados.push({ path: arquivo, directory: arquivo.endsWith("/") });
  }
  return citados;
}

/**
 * A verificação de uma task depois de uma mudança.
 *
 * Atingida quando a mudança toca o que a task cita ou o que a arquitetura fixa
 * para a fase: ela é verificada de novo, inteira. Fora disso, desconhecido —
 * a mudança pode tocar a task por um caminho que nenhum documento nomeia —, e o
 * verificador recebe a task como já aprovada com a lista do que mudou: a
 * consulta limitada da spec, na chamada que já ia acontecer.
 */
export function impactoNaTask(arquivos: readonly string[] | null, escopo: readonly { path: string; directory: boolean }[]): ResultadoDoImpacto {
  if (arquivos === null) return semSaber();
  if (arquivos.length === 0) return nada();
  const atingidos = arquivos.filter((arquivo) => noEscopo(arquivo, escopo));
  if (atingidos.length > 0) return { impacto: "AFFECTED", motivo: `a mudança toca o que a task cita: ${lista(atingidos)}`, arquivos: atingidos };
  return { impacto: "UNKNOWN", motivo: `mudaram ${lista(arquivos)}, que a task não cita`, arquivos: [...arquivos] };
}

/** Manifesto, lockfile, migração, configuração e exemplo de ambiente: tocam todo o produto. */
const DE_TODOS = /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements[^/]*\.txt|go\.(?:mod|sum)|Cargo\.(?:toml|lock)|composer\.(?:json|lock)|\.env\.example|[^/]*\.config\.[cm]?[jt]s|tsconfig[^/]*\.json)$|(?:^|\/)(?:migrations?|migracoes|db\/migrate)\//u;

/**
 * Um fluxo já percorrido, depois de uma mudança.
 *
 * Só fica de pé quando TODO arquivo mudado tem dono demonstrado fora do fecho
 * de dependências dos componentes que o fluxo atravessa — fixado pela
 * arquitetura ou escrito pelos commits de fases que não tocam esses
 * componentes — e não é manifesto, lockfile, migração ou configuração, nem vive
 * na raiz ou numa pasta onde o fluxo também tem arquivo (um módulo descoberto
 * por diretório, uma migração nova). Dono desconhecido é desconhecido, nunca
 * "fora".
 */
export function impactoNoFluxo(arquivos: readonly string[] | null, territorio: TerritorioDoFluxo | null): ResultadoDoImpacto {
  if (arquivos === null) return semSaber();
  if (arquivos.length === 0) return nada();
  if (territorio === null) {
    return { impacto: "UNKNOWN", motivo: "a arquitetura não diz por onde o fluxo passa", arquivos: [...arquivos] };
  }
  const doFluxo = new Set([...territorio.arquivos, ...territorio.commitados]);
  const atingidos = arquivos.filter((arquivo) => doFluxo.has(arquivo) || territorio.classificar(arquivo) === "dentro");
  if (atingidos.length > 0) return { impacto: "AFFECTED", motivo: `a mudança toca arquivos do fluxo: ${lista(atingidos)}`, arquivos: atingidos };
  const pastas = new Set([...doFluxo].map((arquivo) => posix.dirname(arquivo)));
  const incertos = arquivos.filter((arquivo) =>
    posix.dirname(arquivo) === "." || DE_TODOS.test(arquivo) || pastas.has(posix.dirname(arquivo)) || territorio.classificar(arquivo) === "desconhecido",
  );
  if (incertos.length > 0) {
    return { impacto: "UNKNOWN", motivo: `não se demonstra que a mudança fica fora do fluxo: ${lista(incertos)}`, arquivos: incertos };
  }
  return { impacto: "NONE", motivo: `todo arquivo mudado (${lista(arquivos)}) tem dono fora dos componentes que o fluxo atravessa`, arquivos: [] };
}
