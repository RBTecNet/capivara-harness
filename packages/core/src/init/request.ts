/**
 * Resolução do pedido do desenvolvedor.
 *
 * Texto direto, `@arquivo` ou `--file`. A fonte é hasheada porque ela define a
 * identidade do run: o mesmo pedido retoma o mesmo run, e um pedido alterado
 * começa outro em vez de reaproveitar entrevista e documentos de um pedido que
 * já não é aquele.
 */

import { readFile } from "node:fs/promises";
import { sha12 } from "../contract/stamps.js";
import { safeProjectPath } from "../state/paths.js";

export type RequestOrigin = "text" | "file";

export interface DeveloperRequest {
  text: string;
  origin: RequestOrigin;
  /** Caminho relativo ao projeto quando veio de arquivo. */
  path: string | null;
  sha12: string;
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
