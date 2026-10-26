/**
 * Só o Core registra e publica no Git (§101).
 *
 * O executor é um modelo com um shell. Nada no prompt o impede de rodar
 * `git commit` ou `git push` — e um commit dele não passa pela admissão (§100),
 * nem pelos gates: ele entra no histórico por fora. Instrução não é proteção.
 *
 * O que é IMPEDIMENTO depende do provider, e foi medido, não suposto:
 *
 * - codex em `workspace-write` (o executor com `--no-system-install`): o
 *   sandbox do sistema operacional deixa o `.git` somente leitura — inclusive o
 *   do worktree, que mora no repositório principal —, corta a rede e recusa
 *   escrita fora do projeto. `git commit` e `git push` falham. Verificado com
 *   `codex sandbox -P :workspace` (codex-cli 0.162.1);
 * - qualquer provider com acesso de SISTEMA (o padrão do build): nada impede;
 * - claude, opencode, agy, cursor e custom em workspace: sem sandbox de sistema
 *   operacional verificado aqui sobre o `.git`; nada que a Capivara imponha.
 *
 * Onde não há impedimento, o que o Core impõe de forma determinística é
 * DETECÇÃO e CONTENÇÃO: as referências do repositório são fotografadas antes e
 * depois de cada chamada de agente. O commit novo em cima do HEAD de antes, no
 * mesmo branch, o Core absorve (`absorverCommits`): desfaz com `reset --soft`,
 * as alterações ficam na árvore, e a fase segue até o commit dela. Qualquer
 * outra referência movida — reset, stash, tag, troca de branch, outro branch, ou
 * o rastreio remoto que um `push` atualiza — é violação: a fase para, nada dela
 * é registrado nem integrado, e a tela diz quais refs mudaram. Isso não é
 * desfeito, e o `push` que não atualiza rastreio remoto não é detectável daqui.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const GRANDE = { maxBuffer: 64 * 1024 * 1024 };

export type FotoDasRefs = ReadonlyMap<string, string>;

/**
 * As referências de `root`, com o HEAD dela (para onde aponta e em que commit).
 *
 * `ignorar` são prefixos que outro dono pode mover durante a chamada: no
 * paralelo, o integrador move a principal e cria e apaga os branches das fases
 * enquanto os agentes trabalham — o branch DESTE worktree continua coberto pelo
 * HEAD dele. Sem repositório, a foto é vazia, e nada é violação.
 */
export async function fotografarRefs(root: string, ignorar: readonly string[] = []): Promise<FotoDasRefs> {
  const foto = new Map<string, string>();
  try {
    const { stdout } = await run("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: root, ...GRANDE });
    for (const linha of stdout.split("\n").filter(Boolean)) {
      const [nome, objeto] = linha.split(" ");
      if (!nome || !objeto || ignorar.some((prefixo) => nome.startsWith(prefixo))) continue;
      foto.set(nome, objeto);
    }
  } catch {
    return foto;
  }
  const cabeca = await run("git", ["rev-parse", "-q", "--verify", "HEAD"], { cwd: root }).then((resultado) => resultado.stdout.trim(), () => "");
  const simbolica = await run("git", ["symbolic-ref", "-q", "HEAD"], { cwd: root }).then((resultado) => resultado.stdout.trim(), () => "(destacado)");
  foto.set("HEAD", `${simbolica} ${cabeca}`);
  return foto;
}

/** As refs que mudaram, nasceram ou sumiram entre as duas fotos. */
export function refsMovidas(antes: FotoDasRefs, depois: FotoDasRefs): string[] {
  const nomes = new Set([...antes.keys(), ...depois.keys()]);
  return [...nomes].filter((nome) => antes.get(nome) !== depois.get(nome)).sort();
}

/**
 * Os commits que o agente fez em cima do HEAD de antes, no mesmo branch,
 * desfeitos sem perder nada: `reset --soft` para o commit de antes, e as
 * alterações ficam na árvore e no índice, para o commit da fase pelo Core.
 *
 * Só quando é exatamente isso: as refs movidas são o HEAD e o branch dele (no
 * worktree, só o HEAD, que cobre o branch da fase); o HEAD aponta para o mesmo
 * branch, nunca destacado; o commit de depois descende do de antes. Tag,
 * rastreio remoto e stash mudados são outra ref, e não passam. Depois do reset,
 * as refs são fotografadas de novo e têm de ser as de antes.
 *
 * Devolve quantos commits foram desfeitos, ou null quando o caso não é esse ou
 * o reset falhou — e aí é violação, como sempre.
 */
export async function absorverCommits(root: string, antes: FotoDasRefs, depois: FotoDasRefs, ignorar: readonly string[] = []): Promise<number | null> {
  const [ramo, de] = (antes.get("HEAD") ?? "").split(" ");
  const [ramoDepois, para] = (depois.get("HEAD") ?? "").split(" ");
  if (!ramo?.startsWith("refs/heads/") || ramo !== ramoDepois || !de || !para || de === para) return null;
  if (refsMovidas(antes, depois).some((nome) => nome !== "HEAD" && nome !== ramo)) return null;
  const descende = await run("git", ["merge-base", "--is-ancestor", de, para], { cwd: root }).then(() => true, () => false);
  if (!descende) return null;
  const quantos = await run("git", ["rev-list", "--count", `${de}..${para}`], { cwd: root }).then((resultado) => Number(resultado.stdout.trim()), () => 0);
  try {
    await run("git", ["reset", "-q", "--soft", de], { cwd: root });
  } catch {
    return null;
  }
  if (refsMovidas(antes, await fotografarRefs(root, ignorar)).length > 0) return null;
  return quantos;
}

/** Um `push` acompanhado: ele atualiza o rastreio remoto. */
export function publicacaoProvavel(movidas: readonly string[]): boolean {
  return movidas.some((nome) => nome.startsWith("refs/remotes/"));
}

/**
 * O que está garantido sobre o Git do executor, dito antes da primeira
 * chamada. Nunca diz "impedido" onde o executor tem o sistema inteiro.
 */
export function garantiaDeAutoridade(provider: string, systemInstall: boolean): string {
  if (systemInstall) {
    return (
      `${provider} com acesso de sistema: nada impede o executor de rodar git commit ou git push. ` +
      "O commit novo no mesmo branch o Core desfaz, mantendo as alterações; qualquer outra referência movida para a fase sem registrar nada, e não é desfeita; " +
      "use --no-system-install para restringir o executor ao workspace"
    );
  }
  if (provider === "codex") {
    return "codex em workspace-write: o sandbox deixa o .git somente leitura e corta a rede — git commit e git push falham; o Core confere as referências de qualquer forma";
  }
  return (
    `${provider} em workspace: sem sandbox de sistema verificado sobre o .git — o executor pode commitar. ` +
    "O commit novo no mesmo branch o Core desfaz, mantendo as alterações; qualquer outra referência movida para a fase sem registrar nada, e não é desfeita"
  );
}
