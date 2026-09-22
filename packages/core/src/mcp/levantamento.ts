/**
 * O levantamento subindo para a base.
 *
 * O documento fica em disco de qualquer jeito — a base é conveniência, não
 * dependência (§34). O que subir acrescenta é o caminho inteiro: o levantamento
 * vira um projeto da base, com um pedido de reescrita já rascunhado, e o `init`
 * seguinte lê os dois de lá sem ninguém copiar arquivo nenhum.
 *
 * Falhar aqui não pode derrubar o levantamento. Ele já custou uma sessão por
 * domínio e está escrito; perdê-lo porque um servidor não respondeu seria trocar
 * o trabalho pelo transporte.
 */

import type { McpClient } from "./client.js";
import { listLibraryProjects } from "./library.js";

/**
 * O slug do projeto, a partir do nome da aplicação levantada.
 *
 * A mesma regra do `doc-center` — minúsculas, números e hífen —, porque é ele
 * que vai gravar. Divergir aqui faria o harness perguntar por `Locadora Antiga`
 * e a base criar `locadora-antiga`, e a checagem de "já existe" nunca casaria.
 */
export function slugDoProjeto(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Já existe projeto com este slug?
 *
 * `null` quando a base não respondeu — que é diferente de "não existe". Tratar
 * silêncio como ausência criaria um projeto novo por cima de outro no primeiro
 * soluço de rede.
 */
export async function projetoExiste(client: McpClient, slug: string): Promise<boolean | null> {
  try {
    const projetos = await listLibraryProjects(client);
    return projetos.some((projeto) => projeto.slug === slug);
  } catch {
    return null;
  }
}

export interface EnvioDoLevantamento {
  projeto: string;
  nome: string;
  conteudo: string;
  procedencia: string;
}

export interface ResultadoDoEnvio {
  ok: boolean;
  /** O que a base respondeu, ou por que não deu. */
  mensagem: string;
}

export async function enviarLevantamento(client: McpClient, envio: EnvioDoLevantamento): Promise<ResultadoDoEnvio> {
  try {
    const resposta = await client.callTool("registrar_levantamento", {
      projeto: envio.projeto,
      nome: envio.nome,
      conteudo: envio.conteudo,
      procedencia: envio.procedencia,
    });
    return { ok: true, mensagem: resposta.trim() };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}
