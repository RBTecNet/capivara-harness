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
import type { FluxoNaArquitetura } from "./arquitetura.js";

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

/**
 * Um fluxo já percorrido, depois de uma mudança.
 *
 * Os arquivos do fluxo são os que a arquitetura fixa para os componentes que ele
 * atravessa e os que as fases desses componentes commitaram. Um arquivo mudado
 * entre eles atinge o fluxo; um arquivo novo ou alterado na mesma pasta deles —
 * um módulo descoberto por diretório, uma migração nova — ou na raiz do projeto
 * (manifesto, lockfile, configuração) deixa o fluxo desconhecido; só a mudança
 * inteira fora do território do fluxo deixa a prova dele de pé.
 */
export function impactoNoFluxo(
  arquivos: readonly string[] | null,
  fluxo: (FluxoNaArquitetura & { commitados: readonly string[] }) | null,
): ResultadoDoImpacto {
  if (arquivos === null) return semSaber();
  if (arquivos.length === 0) return nada();
  if (fluxo === null) {
    return { impacto: "UNKNOWN", motivo: "a arquitetura não diz por onde o fluxo passa", arquivos: [...arquivos] };
  }
  const territorio = new Set([...fluxo.arquivos, ...fluxo.commitados]);
  if (territorio.size === 0) {
    return { impacto: "UNKNOWN", motivo: "nenhum arquivo do fluxo é conhecido (componentes sem arquivos fixados e sem commit de fase)", arquivos: [...arquivos] };
  }
  const atingidos = arquivos.filter((arquivo) => territorio.has(arquivo));
  if (atingidos.length > 0) return { impacto: "AFFECTED", motivo: `a mudança toca arquivos do fluxo: ${lista(atingidos)}`, arquivos: atingidos };
  const pastas = new Set([...territorio].map((arquivo) => posix.dirname(arquivo)));
  const vizinhos = arquivos.filter((arquivo) => posix.dirname(arquivo) === "." || pastas.has(posix.dirname(arquivo)));
  if (vizinhos.length > 0) {
    return { impacto: "UNKNOWN", motivo: `a mudança está na raiz ou numa pasta do fluxo: ${lista(vizinhos)}`, arquivos: vizinhos };
  }
  return { impacto: "NONE", motivo: `a mudança (${lista(arquivos)}) fica fora dos componentes que o fluxo atravessa`, arquivos: [] };
}
