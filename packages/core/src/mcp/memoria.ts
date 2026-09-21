/**
 * O que o harness devolve à base.
 *
 * Até aqui a conversa era de mão única: o harness lia o pedido, as memórias e as
 * skills. O que ele aprende durante um run — as decisões que a entrevista
 * fechou, onde o trabalho parou, a armadilha que o executor encontrou apanhando
 * — morria no `.capivara/` do projeto.
 *
 * Três origens, e cada uma tem um dono diferente:
 *
 * - **decisões** vêm do desenvolvedor, pela entrevista;
 * - **estado** vem do harness, que sabe o que fechou e o que falhou;
 * - **armadilhas** vêm do executor, que é quem apanha.
 *
 * Tudo entra como rascunho. Memória errada volta em TODOS os runs futuros do
 * projeto, e o custo de aprovar é um clique enquanto o custo de não revisar se
 * paga em cada execução seguinte.
 */

import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { McpClient } from "./client.js";

/** Onde o executor anota o que aprendeu, relativo à raiz do projeto. */
export const MEMORIAS_DIR = join(".capivara", "memorias");

export type Natureza = "decisao" | "armadilha" | "convencao" | "estado";

export interface MemoriaParaRegistrar {
  natureza: Natureza;
  titulo: string;
  conteudo: string;
  /** Que run e que fase a produziram. É o que permite desconfiar de uma velha. */
  procedencia: string;
}

/**
 * Envia as memórias, uma a uma, sem deixar o run cair por causa disso.
 *
 * A base é conveniência, não dependência (§34): um servidor fora do ar no fim de
 * um build não pode transformar um run bem-sucedido em falha. O que não subiu
 * fica anotado no log e no disco, e sobe na próxima.
 */
export async function registrarMemorias(
  client: McpClient,
  projeto: string,
  memorias: readonly MemoriaParaRegistrar[],
  announce: (mensagem: string) => void = () => {},
): Promise<{ registradas: number; falhas: number }> {
  let registradas = 0;
  let falhas = 0;

  for (const memoria of memorias) {
    try {
      await client.callTool("registrar_memoria", {
        projeto,
        natureza: memoria.natureza,
        titulo: memoria.titulo,
        conteudo: memoria.conteudo,
        procedencia: memoria.procedencia,
      });
      registradas += 1;
    } catch (erro) {
      falhas += 1;
      announce(`  não consegui registrar "${memoria.titulo}": ${erro instanceof Error ? erro.message : String(erro)}`);
    }
  }

  return { registradas, falhas };
}

/**
 * As decisões que a entrevista fechou, prontas para virar memória.
 *
 * Só as ACEITAS: uma resposta parcial ainda não é decisão, e registrá-la faria o
 * próximo run tratar como fechado o que ficou em aberto.
 */
export function decisoesComoMemorias(
  respostas: readonly { disposition: string; decision: string; questionId: string }[],
  perguntas: readonly { id: string; topic: string }[],
  procedencia: string,
): MemoriaParaRegistrar[] {
  const topicoDe = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta.topic]));

  return respostas
    .filter((resposta) => resposta.disposition === "ACCEPTED" && resposta.decision.trim() !== "")
    .map((resposta) => ({
      natureza: "decisao" as const,
      titulo: topicoDe.get(resposta.questionId) ?? resposta.questionId,
      conteudo: resposta.decision.trim(),
      procedencia,
    }));
}

export interface EstadoDoBuild {
  runId: string;
  fases: { id: string; title: string; status: string; gate?: string; cause?: string }[];
}

/**
 * Onde o trabalho está, escrito pelo harness.
 *
 * Esta é a única memória que não depende de alguém lembrar de anotar: ao fim de
 * um build o harness sabe exatamente o que fechou e o que falhou. E é a única
 * que SUBSTITUI a anterior — estado antigo não é histórico, é mentira.
 */
export function estadoComoMemoria(estado: EstadoDoBuild): MemoriaParaRegistrar {
  const fechadas = estado.fases.filter((fase) => fase.status === "complete" || fase.status === "already-implemented");
  const falhou = estado.fases.find((fase) => fase.status === "failed");
  const naoChegou = estado.fases.filter((fase) => fase.status === "pending" || fase.status === "skipped");

  const linhas = [
    `${fechadas.length} de ${estado.fases.length} fase(s) fechada(s).`,
    "",
    ...fechadas.map((fase) => `- ${fase.id} ${fase.title} — fechada`),
  ];

  if (falhou) {
    linhas.push(
      "",
      `**Parou em ${falhou.id} — ${falhou.title}.**`,
      falhou.gate ? `Reprovou no ${falhou.gate}.` : "",
      falhou.cause ? `Causa: ${falhou.cause.split("\n")[0] ?? ""}` : "",
    );
  }

  if (naoChegou.length > 0) {
    linhas.push("", `Não chegaram a rodar: ${naoChegou.map((fase) => fase.id).join(", ")}.`);
  }

  return {
    natureza: "estado",
    titulo: "Estado atual",
    conteudo: linhas.filter((linha) => linha !== "").join("\n"),
    procedencia: estado.runId,
  };
}

/**
 * O que o executor anotou durante a fase.
 *
 * Ele escreve arquivos — coisa que toda CLI sabe fazer — e o harness recolhe. A
 * alternativa era dar ao modelo uma ferramenta de escrita na base, que gravaria
 * sem revisão e dependeria de ele lembrar de chamá-la no meio do trabalho.
 *
 * Os arquivos são apagados depois de lidos: o que subiu já está na base, e
 * deixá-los faria a fase seguinte recolher tudo de novo.
 */
export async function recolherMemorias(projectRoot: string, procedencia: string): Promise<MemoriaParaRegistrar[]> {
  const pasta = join(projectRoot, MEMORIAS_DIR);
  const nomes = await readdir(pasta).catch(() => [] as string[]);

  const memorias: MemoriaParaRegistrar[] = [];
  for (const nome of nomes.filter((arquivo) => arquivo.endsWith(".md")).sort()) {
    const texto = await readFile(join(pasta, nome), "utf8").catch(() => "");
    if (texto.trim() === "") continue;

    memorias.push({
      // O executor classifica pelo nome do arquivo: `armadilha-*.md` é
      // armadilha, `convencao-*.md` é convenção, o resto é decisão. Pedir um
      // campo dentro do arquivo seria mais uma coisa para ele errar.
      natureza: nome.startsWith("armadilha") ? "armadilha" : nome.startsWith("convencao") ? "convencao" : "decisao",
      titulo: tituloDe(texto, nome),
      conteudo: texto.trim(),
      procedencia,
    });
  }

  if (memorias.length > 0) await rm(pasta, { recursive: true, force: true });
  return memorias;
}

/** O primeiro cabeçalho do arquivo, ou o nome dele. */
function tituloDe(texto: string, nome: string): string {
  const cabecalho = /^#{1,3}\s+(.+)$/m.exec(texto)?.[1]?.trim();
  return cabecalho && cabecalho !== "" ? cabecalho : nome.replace(/\.md$/, "").replace(/^(armadilha|convencao|decisao)-/, "");
}
