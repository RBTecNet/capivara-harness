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
 * controle que não é versionado (skills e roteiros do gate 4), a especificação
 * em `.capivara/init` quando não foi commitada, o `.env` e o `node_modules`. Cópia, nunca link: um `npm install` dentro do worktree
 * escreveria, pelo link, nas dependências da árvore principal.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { sha12 } from "../contract/stamps.js";
import { adicionarExatamente, admitirArvore, admitirIntervalo, alteracoesParaCommit, commitAdmitido, lerStatus, type Bloqueio } from "./admissao.js";
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

/**
 * Os arquivos ficam só de leitura; as pastas não, para o worktree poder ser
 * removido no fim da fase.
 */
async function somenteLeitura(pasta: string): Promise<void> {
  for (const entrada of await readdir(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) await somenteLeitura(caminho);
    else if (entrada.isFile()) await chmod(caminho, 0o444);
  }
}

/** Remove um worktree que tenha sobrado de um run que caiu, e o branch dele. */
async function limparSobra(projectRoot: string, dir: string, branch: string): Promise<void> {
  await git(projectRoot, ["worktree", "remove", "--force", dir]).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
  await git(projectRoot, ["worktree", "prune"]).catch(() => undefined);
  await git(projectRoot, ["branch", "-D", branch]).catch(() => undefined);
}

/** O parcial de uma tentativa anterior da fase, encontrado ao reabri-la (§111). */
export interface ParcialRetomado {
  /** O branch que o guarda, com o sha no nome — o da fase é recriado. */
  branch: string;
  commit: string;
  /** Foi reaplicado sobre o HEAD integrado, como alteração ainda não commitada — no todo ou em parte. */
  aplicado: boolean;
  /**
   * Os arquivos do parcial que conflitaram e ficaram com a versão da árvore
   * integrada (§113). Vazio quando o parcial voltou inteiro.
   */
  foraDoParcial: string[];
  motivo?: string;
}

/**
 * O branch da fase guarda trabalho que o HEAD não tem? Então é o `wip` de uma
 * tentativa anterior, e vai para um branch próprio antes de `limparSobra`
 * apagá-lo (§111). No `build-6e34384deccd` a retomada apagou o `wip(P04)` que já
 * tinha passado no G3 — faltava só a porta — e a fase recomeçou do zero.
 */
async function guardarSobra(projectRoot: string, branch: string): Promise<{ branch: string; commit: string } | null> {
  const commit = await git(projectRoot, ["rev-parse", "--verify", "--quiet", `${branch}^{commit}`]).catch(() => "");
  if (commit === "") return null;
  if ((await git(projectRoot, ["rev-list", "--count", `HEAD..${commit}`]).catch(() => "0")) === "0") return null;
  const preservado = `${branch}-parcial-${commit.slice(0, 7)}`;
  await git(projectRoot, ["branch", "-f", preservado, commit]);
  return { branch: preservado, commit };
}

/**
 * O parcial reaplicado no worktree novo, como alteração não commitada: o commit
 * da fase continua sendo um só, sobre o HEAD integrado, e a integração não muda.
 *
 * Arquivo que conflita fica com a versão do HEAD, e o resto do parcial volta
 * (§113). No `teste_luna` a reaplicação era tudo ou nada, e um único arquivo
 * compartilhado (`testes/compartilhado/api-fundacao.test.ts`) jogou fora os
 * outros sete da P04 e cinco da P05. Nada é resolvido por conteúdo: o arquivo
 * em conflito é o do HEAD, inteiro, e a lista sai no anúncio. Se o git recusa
 * por outro motivo, ou se nada do parcial sobra, a árvore volta ao HEAD.
 */
async function reaplicarParcial(dir: string, commit: string): Promise<{ foraDoParcial: string[] } | { motivo: string }> {
  // O `merge --squash` deixa a mensagem dele, e um `git commit` sem `-m` a usaria.
  const semMensagem = async (): Promise<void> => {
    await rm(resolve(dir, await git(dir, ["rev-parse", "--git-path", "SQUASH_MSG"])), { force: true }).catch(() => undefined);
  };
  const voltarAoHead = async (): Promise<void> => {
    await git(dir, ["reset", "-q", "--hard", "HEAD"]).catch(() => undefined);
    await git(dir, ["clean", "-q", "-fd"]).catch(() => undefined);
    await semMensagem();
  };
  try {
    await git(dir, ["merge", "--squash", commit]);
    await git(dir, ["reset", "-q"]);
    await semMensagem();
    return { foraDoParcial: [] };
  } catch (erro) {
    const conflitos = (await git(dir, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").filter(Boolean);
    if (conflitos.length === 0) {
      await voltarAoHead();
      const saida = erro instanceof Error && "stderr" in erro ? String((erro as { stderr: unknown }).stderr) : String(erro);
      return { motivo: saida.split("\n").map((linha) => linha.trim()).find((linha) => linha !== "") ?? "o git recusou" };
    }
    try {
      for (const caminho of conflitos) {
        const noHead = await git(dir, ["cat-file", "-e", `HEAD:${caminho}`]).then(() => true, () => false);
        if (noHead) {
          await git(dir, ["checkout", "HEAD", "--", caminho]);
        } else {
          await git(dir, ["rm", "-q", "-f", "--cached", "--", caminho]);
          await rm(join(dir, caminho), { force: true });
        }
      }
      await git(dir, ["reset", "-q"]);
      await semMensagem();
    } catch (falha) {
      await voltarAoHead();
      return { motivo: `conflita com a árvore integrada em ${conflitos.join(", ")}, e a parte que não conflita não pôde ser separada: ${falha instanceof Error ? (falha.message.split("\n")[0] ?? "") : String(falha)}` };
    }
    if ((await git(dir, ["status", "--porcelain"])) === "") {
      return { motivo: `conflita com a árvore integrada em ${conflitos.join(", ")}, e não sobra nada do parcial fora deles` };
    }
    return { foraDoParcial: conflitos };
  }
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
): Promise<{ worktree: Worktree; copiado: string[]; retomado: ParcialRetomado | null }> {
  const base = await git(projectRoot, ["rev-parse", "HEAD"]);
  const branch = branchDaFase(runId, phaseId);
  const dir = join(pastaDosWorktrees(projectRoot, runId, environment), phaseId);
  const sobra = await guardarSobra(projectRoot, branch);
  await limparSobra(projectRoot, dir, branch);
  await mkdir(join(dir, ".."), { recursive: true });
  await git(projectRoot, ["worktree", "add", "-q", "-b", branch, dir, base]);
  let retomado: ParcialRetomado | null = null;
  if (sobra) {
    const reaplicado = await reaplicarParcial(dir, sobra.commit);
    retomado =
      "motivo" in reaplicado
        ? { ...sobra, aplicado: false, foraDoParcial: [], motivo: reaplicado.motivo }
        : { ...sobra, aplicado: true, foraDoParcial: reaplicado.foraDoParcial };
  }

  const copiado: string[] = [];
  for (const pasta of [join(".capivara", "skills"), FLOWS_DIR]) {
    if (!(await existe(join(projectRoot, pasta)))) continue;
    await mkdir(join(dir, pasta, ".."), { recursive: true });
    await copiarPasta(join(projectRoot, pasta), join(dir, pasta));
    // O resultado da passagem anterior é da árvore principal, não desta fase.
    await rm(join(dir, FLOWS_DIR, FLOW_RESULTS), { recursive: true, force: true });
    copiado.push(pasta);
  }
  /*
   * A especificação do projeto, quando não está versionada (§106).
   *
   * O prompt manda o executor ler `.capivara/init/skeleton.md`, e o checkout do
   * HEAD não o traz se o `init` não foi commitado — no `teste_haiku_v2` executor
   * e verificador trabalharam sem o esqueleto. Vai copiada e só de leitura: é
   * especificação, e o commit da fase já deixa `.capivara` de fora.
   */
  const especificacao = join(".capivara", "init");
  if ((await existe(join(projectRoot, especificacao))) && !(await rastreado(projectRoot, especificacao))) {
    await mkdir(join(dir, ".capivara"), { recursive: true });
    await copiarPasta(join(projectRoot, especificacao), join(dir, especificacao));
    await somenteLeitura(join(dir, especificacao));
    copiado.push(especificacao);
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

  return { worktree: { dir, branch, base }, copiado, retomado };
}

/**
 * Tira o worktree do disco. O branch só fica quando ainda guarda trabalho que
 * não chegou à árvore principal — o da fase que falhou, para quem quiser ler.
 */
/**
 * O commit aprovado de uma fase que conflitou na integração, num branch próprio (§110).
 *
 * O desfecho "refazer" fechava o worktree apagando o branch: no
 * `build-96756ca336b0` o verde da P04 (`8c9365e`) ficou sem referência, à
 * espera do `git gc`, e a fase seria refeita do zero. O branch novo aponta para
 * o MESMO commit — nada é copiado, reescrito ou integrado — e leva o sha no nome,
 * para nunca colidir com o branch da fase, que a nova rodada recria, nem com o de
 * outra tentativa.
 */
export async function preservarAprovado(projectRoot: string, worktree: Worktree): Promise<{ branch: string; commit: string }> {
  const commit = await git(projectRoot, ["rev-parse", "--verify", `${worktree.branch}^{commit}`]);
  const branch = `${worktree.branch}-aprovada-${commit.slice(0, 7)}`;
  await git(projectRoot, ["branch", "-f", branch, commit]);
  return { branch, commit };
}

export async function fecharWorktree(
  projectRoot: string,
  worktree: Worktree,
  opcoes: { manterBranch?: boolean; manterArvore?: boolean } = {},
): Promise<void> {
  // A guarda do parcial não pôde ser comprovada (§100): a pasta é a única cópia, e fica.
  if (opcoes.manterArvore === true) return;
  await git(projectRoot, ["worktree", "remove", "--force", worktree.dir]).catch(() => undefined);
  await rm(worktree.dir, { recursive: true, force: true });
  await git(projectRoot, ["worktree", "prune"]).catch(() => undefined);
  if (opcoes.manterBranch !== true) await git(projectRoot, ["branch", "-D", worktree.branch]).catch(() => undefined);
}

/**
 * Copia arquivos para fora do Git e COMPROVA a cópia: o sha256 de cada destino
 * tem de ser o da origem. Lança no primeiro que não confere — quem chama não
 * pode tratar como guardado o que não foi.
 */
async function copiarComProva(raiz: string, caminhos: readonly string[], destino: string): Promise<void> {
  for (const caminho of caminhos) {
    const origem = join(raiz, caminho);
    const alvo = join(destino, caminho);
    await mkdir(dirname(alvo), { recursive: true });
    await cp(origem, alvo, { preserveTimestamps: true });
    if ((await hashDoArquivo(origem)) !== (await hashDoArquivo(alvo))) throw new Error(`a cópia de ${caminho} difere do original`);
  }
}

/**
 * O branch da fase tem commits que a base não tem? Um agente que commitou por
 * conta própria (§101) deixa o worktree limpo e o trabalho só no branch: apagar
 * o branch seria perdê-lo.
 */
export async function branchTemTrabalho(projectRoot: string, worktree: Worktree): Promise<boolean> {
  const quantos = await git(projectRoot, ["rev-list", "--count", `${worktree.base}..${worktree.branch}`]).catch(() => "1");
  return quantos !== "0";
}

export interface ParcialGuardado {
  /** Há um commit novo no branch da fase. */
  guardado: boolean;
  /** Ficaram FORA do commit por serem sensíveis (§100) — copiados para `recuperacao`. */
  bloqueados: Bloqueio[];
  recuperacao: string | null;
  /**
   * A guarda não pôde ser comprovada: o worktree é a única cópia do trabalho e
   * não pode ser removido.
   */
  preservarArvore: boolean;
  motivo?: string;
}

/**
 * Guarda num commit o que a fase deixou por commitar no worktree.
 *
 * É o caso da fase que parou: no build serial o trabalho parcial ficava na
 * árvore, com a instrução de commitar ou descartar. Aqui a árvore some, e o que
 * ela tinha vai para o branch da fase — fora da árvore principal, que não recebe
 * nada que um gate não aprovou.
 *
 * É commit de RECUPERAÇÃO, e passa pela política de admissão (§100): o que for
 * sensível não entra no branch — é copiado, com prova, para a pasta de
 * recuperação do run, que o Git ignora; o resto é commitado. Qualquer passo que
 * falhe deixa o worktree no disco, em vez de o trabalho sumir com ele.
 */
export async function guardarParcial(worktree: Worktree, mensagem: string, pastaDeRecuperacao: string): Promise<ParcialGuardado> {
  const nada: ParcialGuardado = { guardado: false, bloqueados: [], recuperacao: null, preservarArvore: false };
  try {
    const entradas = await alteracoesParaCommit(worktree.dir);
    if (entradas.length === 0) return nada;
    const bloqueados = await admitirArvore(worktree.dir, entradas.map((entrada) => entrada.caminho));
    const fora = new Set(bloqueados.map((bloqueio) => bloqueio.caminho));
    const presentes: string[] = [];
    for (const caminho of fora) if (await existe(join(worktree.dir, caminho))) presentes.push(caminho);
    const recuperacao = presentes.length > 0 ? pastaDeRecuperacao : null;
    if (recuperacao) await copiarComProva(worktree.dir, presentes, recuperacao);

    const admitidos = entradas.map((entrada) => entrada.caminho).filter((caminho) => !fora.has(caminho));
    // Conferido de novo nos objetos que vão para o branch (§101): o que mudou depois da conferência não entra.
    const publicado = await commitAdmitido(worktree.dir, { caminhos: admitidos, mensagem });
    if (publicado.status === "bloqueado") {
      return {
        guardado: false,
        bloqueados: [...bloqueados, ...publicado.bloqueios],
        recuperacao,
        preservarArvore: true,
        motivo: "o conteúdo mudou depois da conferência e trouxe arquivo sensível",
      };
    }
    if (publicado.status === "vazio") return { ...nada, bloqueados, recuperacao };
    return { guardado: true, bloqueados, recuperacao, preservarArvore: false };
  } catch (erro) {
    return { ...nada, preservarArvore: true, motivo: erro instanceof Error ? (erro.message.split("\n")[0] ?? "") : String(erro) };
  }
}

export type Integracao =
  | { status: "integrada"; commits: number; arquivos: string[] }
  | { status: "nada a integrar" }
  | { status: "conflito"; arquivos: string[] }
  /**
   * O git recusou o cherry-pick sem conflito de conteúdo — a árvore principal
   * tinha algo no caminho. Não é da fase: refazê-la daria o mesmo (§99).
   */
  | { status: "recusada"; motivo: string };

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
  } catch (erro) {
    const arquivos = (await git(projectRoot, ["diff", "--name-only", "--diff-filter=U"]).catch(() => ""))
      .split("\n")
      .filter(Boolean);
    await git(projectRoot, ["cherry-pick", "--abort"]).catch(() => undefined);
    // `--abort` volta ao commit de antes da sequência; se não voltou, voltar à mão.
    if ((await git(projectRoot, ["rev-parse", "HEAD"]).catch(() => antes)) !== antes) await desfazerIntegracao(projectRoot, antes);
    /*
     * Conflito é só o que deixou arquivo em conflito. O resto — "seus arquivos
     * locais seriam sobrescritos", um não versionado no caminho — era chamado de
     * conflito, a fase era refeita, e recusava igual (§99).
     */
    if (arquivos.length > 0) return { status: "conflito", arquivos };
    const saida = erro instanceof Error && "stderr" in erro ? String((erro as { stderr: unknown }).stderr) : String(erro);
    return { status: "recusada", motivo: saida.split("\n").map((linha) => linha.trim()).filter(Boolean).slice(0, 4).join(" ") };
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

/** Os caminhos do `git status`, sem o plano de controle; `alterados` são os versionados. */
async function situacaoDaPrincipal(projectRoot: string): Promise<{ alterados: string[]; naoVersionados: string[] }> {
  const entradas = await lerStatus(projectRoot);
  return {
    alterados: entradas.filter((entrada) => !entrada.naoVersionado).map((entrada) => entrada.caminho),
    naoVersionados: entradas.filter((entrada) => entrada.naoVersionado).map((entrada) => entrada.caminho),
  };
}

/**
 * O que, na árvore principal, impede de integrar esta fase sem mexer no que não é do integrador (§99).
 *
 * A árvore principal do build paralelo só é escrita pelo integrador — mas a
 * suíte integrada e o `npm install` rodam nela, e o desenvolvedor pode ter
 * editado algo. Integrar por cima disso faria a suíte julgar uma árvore que não é
 * o HEAD, ou o git recusaria no meio. Então, ANTES do cherry-pick:
 *
 * - arquivo versionado alterado, qualquer um: a árvore não é mais o HEAD;
 * - arquivo não versionado que a fase traz: o cherry-pick o sobrescreveria.
 *
 * Não versionado fora do caminho da fase — o `.env` semeado, um relatório
 * ignorado — não impede: não muda o que a fase entrega nem é tocado por ela.
 *
 * Devolve também os não versionados que JÁ estavam: se a integração for
 * reprovada, é por eles que o desfazer sabe o que ela deixou (`desfazerSemApagar`).
 */
export async function impedimentosDaPrincipal(
  projectRoot: string,
  worktree: Worktree,
): Promise<{ impedimentos: string[]; naoVersionados: string[] }> {
  const { alterados, naoVersionados } = await situacaoDaPrincipal(projectRoot);
  const daFase = new Set((await git(projectRoot, ["diff", "--name-only", worktree.base, worktree.branch])).split("\n").filter(Boolean));
  return { impedimentos: [...alterados, ...naoVersionados.filter((caminho) => daFase.has(caminho))].sort(), naoVersionados };
}

async function hashDoArquivo(caminho: string): Promise<string> {
  return createHash("sha256").update(await readFile(caminho)).digest("hex");
}

/**
 * Desfaz a integração reprovada sem apagar nada e sem deixar nada dela na árvore (§99).
 *
 * O `reset --keep` recusa quando um arquivo que a integração trouxe foi
 * alterado depois — pela suíte, por exemplo. Duas saídas erradas foram
 * descartadas: deixar os commits reprovados no HEAD; e voltar o HEAD com
 * `--soft`, que deixava o código reprovado na árvore para o preflight seguinte
 * mandar commitar.
 *
 * Então: primeiro GUARDA, confere a guarda, e só então limpa.
 *
 * - **Versionados alterados** vão para um commit num branch de recuperação,
 *   montado com um índice temporário (o índice e a árvore da principal não são
 *   tocados). Só versionados: `add -u`, nunca `add -A` — um não versionado
 *   qualquer, como um `.env` que ninguém ignorou, viraria objeto do repositório.
 * - **Não versionados que a integração criou**, e versionados que a política
 *   de admissão bloqueia (§100: nome de segredo ou chave privada no conteúdo),
 *   são COPIADOS para a pasta de recuperação do run, que o Git ignora — fora de
 *   qualquer commit.
 * - **Não versionados que já estavam** não são copiados, commitados nem removidos.
 *
 * A guarda é comprovada antes de qualquer limpeza: cada cópia com o mesmo
 * sha256 do original, cada versionado com o mesmo blob no branch. Sem a prova,
 * nada é limpo — nenhum `reset --hard` — e o erro diz onde a árvore ficou.
 */
export async function desfazerSemApagar(
  projectRoot: string,
  antes: string,
  opcoes: { naoVersionadosAntes: readonly string[]; guardarEm: string; mensagem: string; pastaDeRecuperacao: string },
): Promise<{ limpo: true } | { limpo: false; arquivos: string[]; guardado: string; recuperacao: string | null }> {
  try {
    await desfazerIntegracao(projectRoot, antes);
    return { limpo: true };
  } catch {
    // O `--keep` recusou: há alteração no caminho. Segue para guardar e limpar.
  }

  const { alterados, naoVersionados } = await situacaoDaPrincipal(projectRoot);
  const jaEstavam = new Set(opcoes.naoVersionadosAntes);
  const novos = naoVersionados.filter((caminho) => !jaEstavam.has(caminho));
  const sensiveis = new Set((await admitirArvore(projectRoot, alterados)).map((bloqueio) => bloqueio.caminho));
  const noCommit = alterados.filter((caminho) => !sensiveis.has(caminho));
  const paraCopiar: string[] = [];
  for (const caminho of [...novos, ...alterados.filter((caminho) => sensiveis.has(caminho))]) {
    if (await existe(join(projectRoot, caminho))) paraCopiar.push(caminho);
  }
  const semProva = (oQue: string, erro?: unknown): Error =>
    new Error(
      `não limpei a árvore principal: não consegui comprovar a guarda de ${oQue}` +
        `${erro instanceof Error ? ` (${erro.message.split("\n")[0] ?? ""})` : ""}. ` +
        `Nada foi apagado; o HEAD ainda tem os commits da integração reprovada, e o estado de antes dela é ${antes}`,
    );

  // 1. A cópia local do que não pode ir para o Git, conferida byte a byte.
  const recuperacao = paraCopiar.length > 0 ? opcoes.pastaDeRecuperacao : null;
  try {
    if (recuperacao) await copiarComProva(projectRoot, paraCopiar, recuperacao);
  } catch (erro) {
    throw semProva(paraCopiar.join(", "), erro);
  }

  // 2. O commit de recuperação, só com versionados que não são segredo.
  const pasta = await mkdtemp(join(tmpdir(), "capivara-indice-"));
  let guardado: string;
  try {
    const comIndice = {
      cwd: projectRoot,
      env: { ...process.env, GIT_INDEX_FILE: join(pasta, "index"), GIT_LITERAL_PATHSPECS: "1" },
      ...GRANDE,
    };
    await run("git", ["read-tree", "HEAD"], comIndice);
    await adicionarExatamente(projectRoot, noCommit, "-u", comIndice.env);
    const arvore = (await run("git", ["write-tree"], comIndice)).stdout.trim();
    // Os objetos do que vai para o branch, conferidos (§101): o disco pode ter mudado depois da admissão.
    const sensiveisNaArvore = await admitirIntervalo(projectRoot, await git(projectRoot, ["rev-parse", "HEAD^{tree}"]), arvore);
    if (sensiveisNaArvore.length > 0) throw new Error(`a árvore de recuperação trouxe ${sensiveisNaArvore.map((bloqueio) => bloqueio.caminho).join(", ")}`);
    const commit = await git(projectRoot, ["commit-tree", arvore, "-p", "HEAD", "-m", opcoes.mensagem]);
    guardado = `${opcoes.guardarEm}-${commit.slice(0, 8)}`;
    await git(projectRoot, ["branch", guardado, commit]);
  } catch (erro) {
    throw semProva("os arquivos versionados", erro);
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }

  // 3. A prova: o branch tem cada versionado exatamente como está em disco.
  for (const caminho of noCommit) {
    const emDisco = await existe(join(projectRoot, caminho));
    const noBranch = await git(projectRoot, ["rev-parse", "--verify", "-q", `${guardado}:${caminho}`]).catch(() => null);
    const confere = emDisco ? noBranch !== null && noBranch === (await git(projectRoot, ["hash-object", "--", caminho])) : noBranch === null;
    if (!confere) throw semProva(caminho);
  }

  // 4. Só agora: a árvore volta a ser a de antes da integração.
  await git(projectRoot, ["reset", "-q", "--hard", antes]);
  for (const caminho of novos) await rm(join(projectRoot, caminho), { force: true });
  return { limpo: false, arquivos: [...alterados, ...novos].sort(), guardado, recuperacao };
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
  for (const entrada of entradas) {
    if (!entrada.isFile()) continue;
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await cp(join(origem, entrada.name), join(projectRoot, FLOWS_DIR, entrada.name), { force: true });
    trazidos += 1;
  }
  return trazidos;
}

/**
 * Os versionados que estão diferentes do HEAD na árvore principal, sem o plano de controle.
 *
 * Antes do cherry-pick, `impedimentosDaPrincipal` garante que não há nenhum. Se
 * houver depois de uma integração verde, quem os escreveu foram os passos que o
 * PRÓPRIO harness roda ali — instalação, migração, suíte —, e isso precisa ser
 * dito na hora, com o nome certo, e não descoberto pela fase seguinte como
 * "alteração que não é do integrador" (§102).
 */
export async function alteradosNaPrincipal(projectRoot: string): Promise<string[]> {
  return (await situacaoDaPrincipal(projectRoot)).alterados.sort();
}

/**
 * Como instalar as dependências na árvore principal sem reescrever o que é versionado (§102).
 *
 * `npm install` não é só instalação: ele também REESCREVE o lockfile quando
 * acha que o que leu do registro e o que está no `node_modules` divergem. No
 * primeiro piloto paralelo, o lockfile que o executor gerou no worktree não
 * tinha `"hasInstallScript": true` no `better-sqlite3`; o `npm install` da
 * integração o acrescentou, a árvore principal ficou com um versionado
 * alterado, e a fase seguinte, verde, foi barrada como se o desenvolvedor o
 * tivesse editado.
 *
 * Com lockfile, `npm ci`: instala exatamente o que o lockfile diz e nunca
 * escreve nele — e falha se ele não fechar com o `package.json`, que é defeito
 * da fase e deve reprovar a integração. Sem lockfile, `--no-package-lock`: o
 * `npm install` não cria um arquivo que a fase não trouxe.
 */
export async function comandoDeInstalacao(projectRoot: string): Promise<string> {
  for (const lockfile of ["package-lock.json", "npm-shrinkwrap.json"]) {
    if (await existe(join(projectRoot, lockfile))) return "npm ci --no-audit --no-fund";
  }
  return "npm install --no-audit --no-fund --no-package-lock";
}

/** O commit tocou o manifesto ou o lockfile de dependências do Node? */
export function mexeuNasDependencias(arquivos: readonly string[]): boolean {
  return arquivos.some((arquivo) => /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(arquivo));
}
