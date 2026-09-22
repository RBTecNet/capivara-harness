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
