/**
 * A árvore própria de cada agente, e a volta do trabalho dele (§97).
 *
 * Dois agentes na mesma árvore se atropelam de três jeitos que nenhum gate
 * separa: um escreve no arquivo que o outro está lendo, a suíte de um roda com o
 * meio-trabalho do outro, e o commit de uma fase leva o código da vizinha. Por
 * isso cada fase do build paralelo roda num `git worktree` próprio, num branch
 * próprio, a partir da árvore INTEGRADA — e a árvore principal deixa de ser
 * escrita por agente: só o integrador mexe nela, uma fase por vez.
 *
 * Os worktrees ficam FORA do projeto, no cache do usuário. Dentro dele, a suíte
 * do projeto — que roda na raiz — encontraria os testes de cada worktree e os
 * rodaria junto; o `vitest` e o `jest` não ignoram `.capivara/`.
 *
 * O que um checkout não traz e a fase precisa vai junto, copiado: o plano de
 * controle que não é versionado (skills e roteiros do gate 4), o `.env` e o
 * `node_modules`. Cópia, nunca link: um `npm install` dentro do worktree
 * escreveria, pelo link, nas dependências da árvore principal.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { sha12 } from "../contract/stamps.js";
import { FLOW_RESULTS, FLOWS_DIR } from "./flows.js";

const run = promisify(execFile);
const GRANDE = { maxBuffer: 64 * 1024 * 1024 };

export interface Worktree {
  /** Onde o agente trabalha. */
  dir: string;
  branch: string;
  /** O commit da árvore integrada de onde ele partiu. */
  base: string;
}

/** `~/.cache/capivara/worktrees/<projeto>/<run>`, respeitando `XDG_CACHE_HOME`. */
export function pastaDosWorktrees(projectRoot: string, runId: string, environment: NodeJS.ProcessEnv = process.env): string {
  const cache = environment.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return join(cache, "capivara", "worktrees", sha12(resolve(projectRoot)), runId);
}

export function branchDaFase(runId: string, phaseId: string): string {
  return `capivara/${runId}/${phaseId}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, ...GRANDE });
  return stdout.trim();
}

/** Este git sabe criar worktree? (2.5 em diante.) */
export async function suportaWorktree(projectRoot: string): Promise<boolean> {
  try {
    await git(projectRoot, ["worktree", "list", "--porcelain"]);
    return true;
  } catch {
    return false;
  }
}

async function existe(caminho: string): Promise<boolean> {
  return stat(caminho).then(() => true, () => false);
}

async function rastreado(projectRoot: string, caminho: string): Promise<boolean> {
  try {
    return (await git(projectRoot, ["ls-files", "--", caminho])) !== "";
  } catch {
    return false;
  }
}

/**
 * Copia uma pasta inteira, com reflink quando o sistema de arquivos deixa.
 *
 * `node_modules` tem centenas de megabytes; em btrfs e xfs o `cp --reflink`
 * copia em milissegundos sem ocupar disco. Onde não há `cp` do GNU, o `fs.cp`
 * do Node faz o mesmo, mais devagar.
 */
async function copiarPasta(origem: string, destino: string): Promise<void> {
  try {
    await run("cp", ["-a", "--reflink=auto", origem, destino], GRANDE);
  } catch {
    await cp(origem, destino, { recursive: true, verbatimSymlinks: true, force: true });
  }
}

/** Remove um worktree que tenha sobrado de um run que caiu, e o branch dele. */
async function limparSobra(projectRoot: string, dir: string, branch: string): Promise<void> {
  await git(projectRoot, ["worktree", "remove", "--force", dir]).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
  await git(projectRoot, ["worktree", "prune"]).catch(() => undefined);
  await git(projectRoot, ["branch", "-D", branch]).catch(() => undefined);
}

/**
 * O worktree da fase, partindo do HEAD integrado, com o que o checkout não traz.
 *
 * Devolve também o que foi copiado, para a tela dizer: um `node_modules`
 * replicado em silêncio vira "por que o disco encheu" daqui a dez fases.
 */
export async function abrirWorktree(
  projectRoot: string,
  runId: string,
  phaseId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ worktree: Worktree; copiado: string[] }> {
  const base = await git(projectRoot, ["rev-parse", "HEAD"]);
  const branch = branchDaFase(runId, phaseId);
  const dir = join(pastaDosWorktrees(projectRoot, runId, environment), phaseId);
  await limparSobra(projectRoot, dir, branch);
  await mkdir(join(dir, ".."), { recursive: true });
  await git(projectRoot, ["worktree", "add", "-q", "-b", branch, dir, base]);

  const copiado: string[] = [];
  for (const pasta of [join(".capivara", "skills"), FLOWS_DIR]) {
    if (!(await existe(join(projectRoot, pasta)))) continue;
    await mkdir(join(dir, pasta, ".."), { recursive: true });
    await copiarPasta(join(projectRoot, pasta), join(dir, pasta));
    // O resultado da passagem anterior é da árvore principal, não desta fase.
    await rm(join(dir, FLOWS_DIR, FLOW_RESULTS), { recursive: true, force: true });
    copiado.push(pasta);
  }
  for (const arquivo of [join(".capivara", ".gitignore"), ".env"]) {
    if (!(await existe(join(projectRoot, arquivo))) || (await rastreado(projectRoot, arquivo))) continue;
    await cp(join(projectRoot, arquivo), join(dir, arquivo));
    copiado.push(arquivo);
  }
  if ((await existe(join(projectRoot, "node_modules"))) && !(await existe(join(dir, "node_modules")))) {
    await copiarPasta(join(projectRoot, "node_modules"), join(dir, "node_modules"));
    copiado.push("node_modules");
  }

  return { worktree: { dir, branch, base }, copiado };
}

/**
 * Tira o worktree do disco. O branch só fica quando ainda guarda trabalho que
 * não chegou à árvore principal — o da fase que falhou, para quem quiser ler.
 */
export async function fecharWorktree(projectRoot: string, worktree: Worktree, opcoes: { manterBranch?: boolean } = {}): Promise<void> {
  await git(projectRoot, ["worktree", "remove", "--force", worktree.dir]).catch(() => undefined);
  await rm(worktree.dir, { recursive: true, force: true });
  await git(projectRoot, ["worktree", "prune"]).catch(() => undefined);
  if (opcoes.manterBranch !== true) await git(projectRoot, ["branch", "-D", worktree.branch]).catch(() => undefined);
}

/**
 * Guarda num commit o que a fase deixou por commitar no worktree.
 *
 * É o caso da fase que parou: no build serial o trabalho parcial ficava na
 * árvore, com a instrução de commitar ou descartar. Aqui a árvore some, e o que
 * ela tinha vai para o branch da fase — fora da árvore principal, que não recebe
 * nada que um gate não aprovou.
 */
export async function guardarParcial(worktree: Worktree, mensagem: string): Promise<boolean> {
  try {
    await git(worktree.dir, ["add", "-A", "--", ".", ":(exclude).capivara"]);
    if ((await git(worktree.dir, ["diff", "--cached", "--name-only"])) === "") return false;
    await git(worktree.dir, ["commit", "-q", "--no-verify", "-m", mensagem]);
    return true;
  } catch {
    return false;
  }
}

export type Integracao =
  | { status: "integrada"; commits: number; arquivos: string[] }
  | { status: "nada a integrar" }
  | { status: "conflito"; arquivos: string[] };

/**
 * Os commits da fase, aplicados um a um sobre a árvore principal.
 *
 * `cherry-pick` e não `merge`: o histórico continua sendo um commit por fase,
 * `feat(phase-N)`, em fila, como no build serial — quem lê o `git log` de um
 * build paralelo não precisa saber que ele foi paralelo. Conflito não é resolvido
 * por ninguém: o cherry-pick é desfeito e a fase volta para a fila, para rodar
 * sozinha sobre a árvore nova.
 */
export async function integrar(projectRoot: string, worktree: Worktree): Promise<Integracao> {
  const lista = await git(projectRoot, ["rev-list", "--reverse", `${worktree.base}..${worktree.branch}`]);
  const commits = lista.split("\n").filter(Boolean);
  if (commits.length === 0) return { status: "nada a integrar" };

  const antes = await git(projectRoot, ["rev-parse", "HEAD"]);
  try {
    await git(projectRoot, ["cherry-pick", "--allow-empty", "--keep-redundant-commits", ...commits]);
  } catch {
    const arquivos = (await git(projectRoot, ["diff", "--name-only", "--diff-filter=U"]).catch(() => ""))
      .split("\n")
      .filter(Boolean);
    await git(projectRoot, ["cherry-pick", "--abort"]).catch(() => undefined);
    // `--abort` volta ao commit de antes da sequência; se não voltou, voltar à mão.
    if ((await git(projectRoot, ["rev-parse", "HEAD"]).catch(() => antes)) !== antes) await desfazerIntegracao(projectRoot, antes);
    return { status: "conflito", arquivos };
  }
  const arquivos = (await git(projectRoot, ["diff", "--name-only", antes, "HEAD"])).split("\n").filter(Boolean);
  return { status: "integrada", commits: commits.length, arquivos };
}

/**
 * Garante que o repositório tem um commit para os worktrees partirem.
 *
 * Devolve true quando precisou criar — um commit vazio, que não muda arquivo
 * nenhum. Repositório que já tem histórico não é tocado.
 */
export async function garantirBase(projectRoot: string): Promise<boolean> {
  try {
    await git(projectRoot, ["rev-parse", "--verify", "-q", "HEAD"]);
    return false;
  } catch {
    await git(projectRoot, ["commit", "-q", "--allow-empty", "--no-verify", "-m", "chore: base do build paralelo"]);
    return true;
  }
}

/** O HEAD da árvore principal, para poder voltar a ele. */
export async function cabeca(projectRoot: string): Promise<string> {
  return git(projectRoot, ["rev-parse", "HEAD"]);
}

/**
 * Volta a árvore principal para antes de uma integração reprovada.
 *
 * `--keep`, e não `--hard`: só desfaz os commits que o integrador acabou de
 * aplicar, e recusa se houver alteração local nos arquivos que ele tocaria. Na
 * árvore principal do build paralelo ninguém escreve além do integrador — se
 * houver alteração, alguém escreveu, e apagar seria apagar o trabalho dessa
 * pessoa.
 */
export async function desfazerIntegracao(projectRoot: string, antes: string): Promise<void> {
  await git(projectRoot, ["reset", "-q", "--keep", antes]);
}

/**
 * Os roteiros do gate 4 que a fase escreveu, de volta à árvore principal.
 *
 * Eles não são versionados — `.capivara/flows/` fica fora do histórico —, então
 * o cherry-pick não os traz. Sem esta cópia, a fase seguinte abriria o worktree
 * dela sem os roteiros das anteriores, e a regressão do gate 4 reescreveria cada
 * um do zero.
 */
export async function trazerRoteiros(worktree: Worktree, projectRoot: string): Promise<number> {
  const origem = join(worktree.dir, FLOWS_DIR);
  const entradas = await readdir(origem, { withFileTypes: true }).catch(() => []);
  let trazidos = 0;
  await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
  for (const entrada of entradas) {
    if (!entrada.isFile()) continue;
    await cp(join(origem, entrada.name), join(projectRoot, FLOWS_DIR, entrada.name), { force: true });
    trazidos += 1;
  }
  return trazidos;
}

/** O commit tocou o manifesto ou o lockfile de dependências do Node? */
export function mexeuNasDependencias(arquivos: readonly string[]): boolean {
  return arquivos.some((arquivo) => /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(arquivo));
}
