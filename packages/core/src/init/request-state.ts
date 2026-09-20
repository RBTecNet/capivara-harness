/**
 * Qual pedido gerou o esqueleto.
 *
 * O `plan` retoma o esqueleto pelo id do run, e o id é o hash do pedido. Sem
 * saber o texto exato, o `plan` não encontra nada — e o texto exato não está no
 * esqueleto: está no arquivo que o desenvolvedor passou ao `init`.
 *
 * Enquanto isto não existia, o `plan` procurava o pedido num `pedido.md` fixo.
 * Quem rodou `capivara init --file docs/prd.txt` — que é o que o próprio wizard
 * monta — batia em "não encontrei o pedido em pedido.md" sem ter feito nada
 * errado, e não havia caminho de volta: nem `--file` o `plan` aceitava.
 *
 * Por isso o registro é um ponteiro único, e não um arquivo por run: quem o lê
 * ainda não sabe o id do run, que é justamente o que ele vem buscar. Ele guarda
 * o último pedido que produziu esqueleto — dois `init` no mesmo projeto deixam
 * o segundo, e `--file` continua existindo para escolher outro à mão.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha12 } from "../contract/stamps.js";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import type { DeveloperRequest } from "./request.js";

function requestPath(projectRoot: string): string {
  return join(artifactPaths(projectRoot).handoffs, "pedido.json");
}

export async function writeRequestState(projectRoot: string, request: DeveloperRequest): Promise<void> {
  await writeAtomic(requestPath(projectRoot), `${JSON.stringify(request, null, 2)}\n`);
}

/**
 * Devolve o pedido registrado, ou `null`.
 *
 * O hash é recalculado a partir do texto em vez de aceito como veio: é ele que
 * decide qual run será retomado, e um arquivo adulterado à mão apontaria para o
 * esqueleto de outro pedido.
 */
export async function readRequestState(projectRoot: string): Promise<DeveloperRequest | null> {
  try {
    const parsed = JSON.parse(await readFile(requestPath(projectRoot), "utf8")) as Partial<DeveloperRequest>;
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (text === "") return null;
    return {
      text,
      origin: parsed.origin === "file" ? "file" : "text",
      path: typeof parsed.path === "string" ? parsed.path : null,
      sha12: sha12(text),
    };
  } catch {
    return null;
  }
}
