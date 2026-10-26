/**
 * Os manifestos acima do projeto, antes e depois de uma sessão de preparação
 * (item 8 de "atacar os pontos frágeis").
 *
 * No run `build-948fc298f4fe` (Codex) o próprio agente relatou que alterou o
 * `package.json` e o `package-lock.json` da pasta acima do projeto, e não os
 * restaurou. A preparação instala no projeto; o que ela escreve fora dele não é
 * dela. Antes de cada sessão o Core guarda o conteúdo dos manifestos e travas
 * de cada pasta acima do projeto, até o `$HOME`; depois, o que mudou volta ao
 * que era — o que não existia é apagado —, e isso vira alerta no relatório.
 */

import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Os manifestos e as travas que uma instalação reescreve. */
export const MANIFESTOS_ACIMA = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.json", "composer.lock"] as const;

/** O conteúdo de cada manifesto acima do projeto, pelo caminho absoluto; `null` é o que não existia. */
export type FotoAcima = Map<string, { conteudo: Buffer | null; sha256: string | null }>;

/** As pastas acima do projeto, da mãe até o `$HOME` inclusive; fora do `$HOME`, até a raiz. */
export function pastasAcima(projectRoot: string, home = homedir()): string[] {
  const inicio = resolve(projectRoot);
  const casa = resolve(home);
  const dentroDaCasa = inicio.startsWith(`${casa}${sep}`);
  const pastas: string[] = [];
  for (let pasta = dirname(inicio); ; pasta = dirname(pasta)) {
    pastas.push(pasta);
    if ((dentroDaCasa && pasta === casa) || dirname(pasta) === pasta) break;
  }
  return pastas;
}

const sha = (conteudo: Buffer): string => createHash("sha256").update(conteudo).digest("hex");

export async function fotografarAcima(projectRoot: string, home?: string): Promise<FotoAcima> {
  const foto: FotoAcima = new Map();
  for (const pasta of pastasAcima(projectRoot, home)) {
    for (const nome of MANIFESTOS_ACIMA) {
      const caminho = join(pasta, nome);
      const conteudo = await readFile(caminho).catch(() => null);
      foto.set(caminho, { conteudo, sha256: conteudo === null ? null : sha(conteudo) });
    }
  }
  return foto;
}

/**
 * Devolve cada manifesto acima do projeto ao que a foto guardou, e diz o que
 * foi devolvido — relativo ao projeto, para quem lê saber onde fica. O que não
 * pôde voltar também é dito.
 */
export async function restaurarAcima(projectRoot: string, foto: FotoAcima): Promise<{ restaurados: string[]; naoVoltaram: string[] }> {
  const restaurados: string[] = [];
  const naoVoltaram: string[] = [];
  for (const [caminho, antes] of foto) {
    const agora = await readFile(caminho).catch(() => null);
    if ((agora === null ? null : sha(agora)) === antes.sha256) continue;
    const nome = relative(projectRoot, caminho);
    try {
      if (antes.conteudo === null) await rm(caminho, { force: true });
      else await writeFile(caminho, antes.conteudo);
      restaurados.push(antes.conteudo === null ? `${nome} (criado pela sessão; apagado)` : `${nome} (alterado pela sessão; restaurado)`);
    } catch (erro) {
      naoVoltaram.push(`${nome} (${erro instanceof Error ? erro.message : String(erro)})`);
    }
  }
  return { restaurados, naoVoltaram };
}
