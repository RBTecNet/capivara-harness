/**
 * Resolução do pedido do desenvolvedor.
 *
 * Texto direto, `@arquivo`, `--file` — ou a base documental, por MCP. A fonte é
 * hasheada porque ela define a identidade do run: o mesmo pedido retoma o mesmo
 * run, e um pedido alterado começa outro em vez de reaproveitar entrevista e
 * documentos de um pedido que já não é aquele.
 *
 * Isso vale igual para o pedido que veio da base: se ele for editado lá, o sha
 * muda e o run é outro. O harness não precisa saber que a origem é remota para
 * se comportar direito — precisa apenas ter o texto e o hash dele.
 */

import { readFile } from "node:fs/promises";
import { sha12 } from "../contract/stamps.js";
import { safeProjectPath } from "../state/paths.js";
import { uriDoPedido } from "../mcp/index.js";

export type RequestOrigin = "text" | "file" | "mcp";

export interface DeveloperRequest {
  text: string;
  origin: RequestOrigin;
  /** Caminho relativo ao projeto, ou o URI do recurso quando veio da base. */
  path: string | null;
  sha12: string;
  /**
   * O endereço da base, quando o pedido veio de uma.
   *
   * O URI diz de QUAL projeto o pedido é; só ele não diz ONDE está a base. Sem
   * o endereço, o `build` do mesmo projeto não tem como voltar lá sozinho — e
   * foi exatamente isso que fez um executor de frontend trabalhar sem a skill
   * de frontend que o próprio documento da fase mandava seguir.
   */
  base?: string;
}

/**
 * Um prompt guardado na base, já lido.
 *
 * Origem `mcp` como o pedido de projeto — é da base, e o `path` guarda de qual
 * prompt veio. A diferença é que aqui não há projeto: o prompt é o texto, e o
 * projeto que ele vai produzir ainda não existe.
 */
export function requestFromPrompt(nome: string, texto: string, base?: string): DeveloperRequest {
  const text = texto.trim();
  if (text === "") throw new EmptyRequestError();
  return {
    text,
    origin: "mcp",
    path: `prompt:${nome}`,
    sha12: sha12(text),
    ...(base && base.trim() !== "" ? { base: base.trim() } : {}),
  };
}

/** O pedido de um projeto da base documental, já lido. */
export function requestFromLibrary(projeto: string, texto: string, base?: string): DeveloperRequest {
  const text = texto.trim();
  if (text === "") throw new EmptyRequestError();
  return {
    text,
    origin: "mcp",
    path: uriDoPedido(projeto),
    sha12: sha12(text),
    ...(base && base.trim() !== "" ? { base: base.trim() } : {}),
  };
}

export class EmptyRequestError extends Error {
  constructor() {
    super("nenhum pedido informado. Passe o texto, um caminho com @ ou use --file <arquivo>.");
    this.name = "EmptyRequestError";
  }
}

export async function resolveRequest(
  projectRoot: string,
  options: { prompt?: string; file?: string },
): Promise<DeveloperRequest> {
  const explicitFile = options.file?.trim();
  const raw = options.prompt?.trim() ?? "";

  const fromFile = explicitFile || (raw.startsWith("@") ? raw.slice(1).trim() : "");
  if (fromFile) {
    const absolute = safeProjectPath(projectRoot, fromFile);
    const text = (await readFile(absolute, "utf8")).trim();
    if (text === "") throw new EmptyRequestError();
    return { text, origin: "file", path: fromFile, sha12: sha12(text) };
  }

  if (raw === "") throw new EmptyRequestError();
  return { text: raw, origin: "text", path: null, sha12: sha12(raw) };
}
