/**
 * As fases que já fecharam, e com que texto.
 *
 * O id do run do build é o hash do PLANO inteiro. Isso resolve a retomada — rodar
 * de novo cai no mesmo run e as fases fechadas não são refeitas —, mas não
 * resolve o plano que CRESCEU: acrescentar uma fase muda o hash, o run é outro, e
 * as cinco fases que já estavam prontas voltam para a fila para serem
 * reverificadas uma a uma.
 *
 * Enquanto só existia `init → plan → build`, isso nunca acontecia: o plano
 * nascia inteiro e morria inteiro. O `change` acrescenta fase a uma aplicação
 * que já roda, e aí o custo aparece — cinco chamadas de verificador antes de
 * escrever a primeira linha do que foi pedido.
 *
 * O registro é por TEXTO, não por id. Uma fase cujo markdown mudou é outra fase,
 * ainda que com o mesmo número: ela volta a ser construída, que é exatamente o
 * que se quer quando alguém edita um critério.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactPaths } from "../state/paths.js";
import { writeAtomic } from "../state/atomic.js";
import { sha12 } from "../contract/stamps.js";
import { PLANNING_CONTRACT } from "../contract/environment.js";

export interface FaseFechada {
  id: string;
  title: string;
  /** O sha do markdown da fase quando ela fechou. */
  sha: string;
  runId: string;
  closedAt: string;
  /**
   * O sha da fatia da arquitetura com que ela fechou (§125), quando havia.
   *
   * O texto da fase pode ficar igual e o contrato que ela entrega ou consome
   * mudar — numa revisão da arquitetura, por exemplo. A aprovação anterior não
   * vale para um contrato que ela não viu: fase com fatia registrada diferente
   * da atual volta a ser construída. Entrada sem o campo (anterior a ele) vale
   * pelo texto, como sempre valeu.
   */
  sliceSha12?: string;
  /**
   * O HEAD do repositório quando ela fechou (§125 G), quando havia Git.
   *
   * "Fechada antes" é uma afirmação sobre o código, e o texto sozinho não a
   * sustenta: um `reset` ou um histórico reescrito tira o trabalho da árvore e
   * deixa o ledger dizendo o contrário. A fase só é pulada enquanto este
   * commit continuar no histórico do HEAD. Entrada sem o campo (anterior a
   * ele) vale como sempre valeu, e o anúncio diz que não foi conferida.
   */
  head?: string;
  /**
   * Fechou sem commit (o git recusou): o código ficou na árvore, fora do
   * histórico, e nenhum HEAD o contém. Não é pulada nas próximas execuções —
   * volta a ser verificada, porque o código pode ter sido descartado.
   */
  semCommit?: boolean;
  /**
   * Os fluxos que a fase fechou sem percorrer porque o contrato põe o produto fora
   * do navegador (§133). Ausente é o registro anterior ao campo: a fase percorreu
   * o que cobriu, como sempre.
   */
  foraDoNavegador?: { workflow: string; trecho: string }[];
}

function caminho(projectRoot: string): string {
  return join(artifactPaths(projectRoot).handoffs, "fases.json");
}

export function shaDaFase(markdown: string): string {
  return sha12(`${PLANNING_CONTRACT}\n${markdown.trim()}`);
}

export async function lerFasesFechadas(projectRoot: string): Promise<FaseFechada[]> {
  try {
    const bruto = await readFile(caminho(projectRoot), "utf8");
    const lido = JSON.parse(bruto) as unknown;
    if (!Array.isArray(lido)) return [];
    return lido.filter((item): item is FaseFechada => {
      const fase = (item ?? {}) as Partial<FaseFechada>;
      return typeof fase.id === "string" && typeof fase.sha === "string" && fase.sha !== "";
    });
  } catch {
    return [];
  }
}

/**
 * Anota que uma fase fechou.
 *
 * Substitui a entrada do mesmo id: o que interessa é o último texto que fechou,
 * e guardar o histórico aqui faria o arquivo crescer para sempre sem ninguém ler.
 */
export async function registrarFaseFechada(projectRoot: string, fase: FaseFechada): Promise<void> {
  const atuais = (await lerFasesFechadas(projectRoot)).filter((outra) => outra.id !== fase.id);
  await writeAtomic(caminho(projectRoot), `${JSON.stringify([...atuais, fase], null, 2)}\n`);
}
