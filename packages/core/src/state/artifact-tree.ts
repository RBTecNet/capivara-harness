/**
 * Criação da árvore de artefatos.
 *
 * Escreve `.capivara/.gitignore` ignorando `runs/` e `handoffs/`: o plano de
 * controle é
 * estado do run, não do produto, e não pertence ao histórico do repositório de
 * quem chamou. As exclusões por pathspec no loop já garantem isso mecanicamente;
 * o arquivo evita que a pasta apareça como ruído para quem roda `git status`.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { artifactPaths } from "./paths.js";

/*
 * `handoffs/` entra junto com `runs/`.
 *
 * O commit da especificação já dizia, em comentário, que nem um nem outro
 * pertencem ao histórico — mas só `runs/` estava aqui. O efeito apareceu no
 * piloto 6: o `plan` terminava, deixava os handoffs por rastrear, e o `build`
 * recusava começar porque a árvore não estava limpa. O desenvolvedor que
 * seguisse os dois estágios na ordem certa era barrado no terceiro.
 */
/*
 * E `flows/`, `skills/` e `memorias/`, pela mesma razão — e pelo mesmo caminho.
 *
 * As três nasceram depois desta lista e ninguém voltou a ela. O efeito apareceu
 * no `assistencia2`: o build parou no meio de uma fase, e o próprio harness
 * mandou rodar `git add -A && git commit -m "wip"` — que teria levado os roteiros
 * do gate 4 e o `.gitignore` para o repositório do produto. Os commits de fase
 * excluem `.capivara/` por pathspec; a instrução que o harness dá ao
 * desenvolvedor não excluía, e as duas regras discordavam em silêncio.
 *
 * `init/` fica de FORA desta lista de propósito: é a especificação, e ela entra no
 * histórico pelo `commitSpecification`. `design/` também: é do desenvolvedor.
 */
export const CONTROL_PLANE_IGNORE = [
  "# Estado dos runs: plano de controle, não pertence ao histórico.",
  "runs/",
  "handoffs/",
  "flows/",
  "skills/",
  "memorias/",
  "",
].join("\n");

export async function ensureArtifactTree(projectRoot: string): Promise<void> {
  const paths = artifactPaths(projectRoot);
  await mkdir(paths.init, { recursive: true });
  await mkdir(paths.handoffs, { recursive: true });
  await mkdir(paths.runs, { recursive: true });
  await writeAtomic(join(paths.root, ".gitignore"), CONTROL_PLANE_IGNORE);
}
