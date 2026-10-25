/**
 * Assinatura da árvore e commit por fase.
 *
 * A assinatura responde a uma pergunta só: alguma coisa mudou entre o antes e o
 * depois da sessão? Ela é SINAL, não veredito — uma fase já implementada faz o
 * executor corretamente não escrever nada, e reprovar por isso seria um falso
 * negativo. Quem decide são os gates 2 e 3.
 *
 * Sem repositório Git, a assinatura vem de uma varredura com as mesmas
 * exclusões: o loop roda igual, só não commita.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { adicionarExatamente, admitirArvore, alteracoesParaCommit, commitAdmitido, descreverBloqueios, lerStatus, orientacaoDeBloqueio, type Bloqueio } from "./admissao.js";
import { renderEscolhaNumerada, type EscolhaNumerada } from "./escolha.js";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Saída de diff e de log de projeto grande cabe aqui; o padrão do execFile (1 MiB) não. */
const GRANDE = { maxBuffer: 64 * 1024 * 1024, encoding: "utf8" as const };

/**
 * O plano de controle nunca conta como trabalho da fase.
 *
 * Sem esta exclusão, os prompts e logs que o próprio loop grava fariam o gate 1
 * dizer que a sessão escreveu código, e o commit da fase levaria junto o
 * histórico interno do run para o repositório de quem chamou.
 */
const CONTROL_PLANE_PATHSPEC = [".", ":(exclude).capivara"];

const EXCLUDED = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "target", "__pycache__",
  ".venv", "venv", ".next", ".nuxt", ".cache", "coverage", ".capivara",
]);

export async function isRepository(projectRoot: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Só o plano de controle existe nesta pasta?
 *
 * A pergunta é a do `git status`, feita sem git: existe algum arquivo fora de
 * `.capivara/`? Nada mais é ignorado de propósito — nem `node_modules`, nem
 * `dist`. É que o `git init` só é seguro quando a resposta é não: com qualquer
 * arquivo na árvore, o repositório novo nasce sujo, e o preflight recusa o build
 * por uma sujeira que fomos nós que criamos.
 */
async function apenasPlanoDeControle(projectRoot: string): Promise<boolean> {
  const vazio = async (directory: string): Promise<boolean> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      if (entry.name === ".capivara" || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        if (!(await vazio(join(directory, entry.name)))) return false;
        continue;
      }
      return false;
    }
    return true;
  };
  return await vazio(projectRoot);
}

/**
 * O repositório que o build precisa, criado por ele.
 *
 * Dezesseis fases, cada fase um commit: sem repositório, `commitPhase` não faz
 * nada e **não existe ponto de retorno nenhum** — se a fase 12 estragar o que a 4
 * construiu, não há para onde voltar. E há um segundo custo, que o `assitencia`
 * mediu no gate 3: uma regra transversal fala de "arquivos versionados", o
 * verificador vai conferir, não encontra metadado de versionamento e devolve
 * `INCOMPLETE` — uma task correta reprovada por uma pergunta que o harness deixou
 * sem resposta.
 *
 * Só em pasta vazia, e é a pasta com que o ciclo normal começa: `init` e `plan`
 * escrevem apenas dentro de `.capivara/`. Sobre trabalho que já existe, o harness
 * não inventa repositório — quem tem código sem git tem um motivo, e o commit
 * inicial de uma árvore alheia é decisão de quem a escreveu.
 */
export async function iniciarRepositorio(
  projectRoot: string,
  opcoes: { comTrabalhoExistente?: boolean } = {},
): Promise<{ criado: boolean; motivo: string; commitInicial: boolean }> {
  if (await isRepository(projectRoot)) return { criado: false, motivo: "já é um repositório", commitInicial: false };

  const vazia = await apenasPlanoDeControle(projectRoot);
  if (!vazia && opcoes.comTrabalhoExistente !== true) {
    return {
      criado: false,
      commitInicial: false,
      motivo: "a pasta já tem arquivos: criar o repositório aqui é decisão de quem os escreveu",
    };
  }

  try {
    await run("git", ["init", "-q"], { cwd: projectRoot });
    await garantirIdentidade(projectRoot);
    // Instalação local não entra no primeiro snapshot antes de existir .gitignore.
    // O exclude local tem precedência menor que as regras explícitas do projeto.
    const exclude = resolve(projectRoot, (await run("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: projectRoot })).stdout.trim());
    await mkdir(dirname(exclude), { recursive: true });
    await appendFile(exclude, "\n# Capivara: dependências locais\nnode_modules/\n");

    /*
     * Árvore que já tem trabalho precisa do commit inicial, e não por capricho: o
     * preflight recusa build com alteração não commitada, para poder distinguir o
     * que cada fase escreveu. Sem este commit, criar o repositório deixaria o
     * projeto pior do que estava — bloqueado por uma sujeira que fomos nós que
     * criamos.
     *
     * O `.capivara/` fica fora, como fica de todo commit de fase: o plano de
     * controle não é trabalho do produto.
     */
    if (!vazia) {
      /*
       * O commit inicial leva o trabalho que já estava na pasta — e um `.env`
       * de quem a escreveu iria junto (§100). Com arquivo sensível, o
       * repositório nasce sem o commit: nada é apagado, e o preflight diz o que
       * ignorar antes de commitar.
       */
      const bloqueios = await admitirArvore(projectRoot, (await lerStatus(projectRoot)).map((entrada) => entrada.caminho));
      if (bloqueios.length > 0) {
        return {
          criado: true,
          commitInicial: false,
          motivo: `o commit inicial não foi feito: ${descreverBloqueios(bloqueios)}. ${orientacaoDeBloqueio(bloqueios, new Set())}`,
        };
      }
      // O mesmo commit admitido das fases, sobre os objetos (§101): o repositório ainda não tem HEAD.
      const caminhos = (await lerStatus(projectRoot)).map((entrada) => entrada.caminho);
      const publicado = await commitAdmitido(projectRoot, { caminhos, mensagem: "chore: estado inicial, antes do primeiro build" });
      if (publicado.status === "bloqueado") {
        return {
          criado: true,
          commitInicial: false,
          motivo: `o commit inicial não foi feito: ${descreverBloqueios(publicado.bloqueios)}. ${orientacaoDeBloqueio(publicado.bloqueios, new Set())}`,
        };
      }
      return { criado: true, motivo: "", commitInicial: publicado.status === "commitado" };
    }

    return { criado: true, motivo: "", commitInicial: false };
  } catch (erro) {
    return { criado: false, commitInicial: false, motivo: erro instanceof Error ? erro.message : String(erro) };
  }
}

export type EscolhaDeRepositorio = "criar" | "verificar" | "abortar";

/**
 * O que se pergunta quando falta o repositório numa árvore que já tem trabalho.
 *
 * Mesma gramática do pré-requisito de sistema ausente, porque é a mesma coisa:
 * algo que o build precisa e não está lá. Três saídas, e só uma segue em frente.
 */
export function escolhaSemRepositorio(): EscolhaNumerada {
  return {
    texto: [
      "Este projeto não é um repositório Git, e o build precisa de um.",
      "",
      "Duas razões, e nenhuma delas é gosto:",
      "  · cada fase verde vira um commit, e é o único ponto de retorno que existe — sem ele, uma",
      "    fase que quebre o que outra construiu não tem para onde voltar;",
      "  · critério que fale de arquivo versionado fica impossível de provar: o verificador vai",
      "    conferir, não encontra versionamento, e reprova uma task correta.",
    ],
    opcoes: [
      "criar o repositório agora e commitar o que já está aqui (respeitando o .gitignore)",
      "já criei em outro terminal; verifique de novo",
      "abortar",
    ],
  };
}

export function renderSemRepositorio(): string {
  return renderEscolhaNumerada(escolhaSemRepositorio());
}

/** Lê a escolha numérica; qualquer outra coisa é recusada, nunca adivinhada. */
export function lerEscolhaDeRepositorio(resposta: string): EscolhaDeRepositorio | null {
  const texto = resposta.trim();
  if (texto === "1") return "criar";
  if (texto === "2") return "verificar";
  if (texto === "3") return "abortar";
  return null;
}

/**
 * Quem assina os commits do repositório que nós criamos.
 *
 * Sem `user.email` configurado, `git commit` sai com código 128 e a mensagem
 * "Author identity unknown" — e antes disso derrubava o build inteiro, com a fase
 * verde e os gates todos passados. A suíte pegou na primeira execução: máquina de
 * teste não tem identidade global, e o `git init` novo fez o caminho existir.
 *
 * A identidade é LOCAL, só neste repositório, e só quando não há nenhuma que o
 * git consiga resolver — configuração de quem clonou nunca é sobrescrita. Quem
 * quiser assinar com o próprio nome roda `git config user.name` e os commits
 * seguintes já saem com ele.
 */
async function garantirIdentidade(projectRoot: string): Promise<void> {
  try {
    await run("git", ["var", "GIT_COMMITTER_IDENT"], { cwd: projectRoot });
    return;
  } catch {
    // Não há identidade resolvível: este repositório ganha uma, dele.
  }
  await run("git", ["config", "user.name", "capivara"], { cwd: projectRoot }).catch(() => undefined);
  await run("git", ["config", "user.email", "capivara@localhost"], { cwd: projectRoot }).catch(() => undefined);
}

export async function isClean(projectRoot: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["status", "--porcelain", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
    if (stdout.trim() === "") return true;
    // O `.env` que o harness semeou não é trabalho de ninguém, e nunca vai para commit (§100).
    return (await alteracoesParaCommit(projectRoot, CONTROL_PLANE_PATHSPEC)).length === 0;
  } catch {
    return true;
  }
}

async function walkSignature(projectRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (EXCLUDED.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info || info.size > 8 * 1024 * 1024) continue;
      hash.update(relative(projectRoot, absolute));
      hash.update(await readFile(absolute).catch(() => Buffer.alloc(0)));
    }
  };
  await walk(projectRoot);
  return hash.digest("hex").slice(0, 16);
}

/** Hash do estado observável da árvore. Não muta o índice do Git. */
export async function treeSignature(projectRoot: string): Promise<string> {
  if (!(await isRepository(projectRoot))) return walkSignature(projectRoot);
  try {
    const status = await run("git", ["status", "--porcelain", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
    const diff = await run("git", ["diff", "HEAD", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 });
    const untracked = await run("git", ["ls-files", "--others", "--exclude-standard", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
    const hash = createHash("sha256").update(status.stdout).update(diff.stdout);
    for (const path of untracked.stdout.split("\n").filter(Boolean).sort()) {
      hash.update(path);
      hash.update(await readFile(join(projectRoot, path)).catch(() => Buffer.alloc(0)));
    }
    return hash.digest("hex").slice(0, 16);
  } catch {
    return walkSignature(projectRoot);
  }
}

/**
 * O estado do código como CONTEÚDO, para as evidências (§125 B).
 *
 * `treeSignature` responde "algo mudou durante esta sessão?" e é relativa ao
 * HEAD: duas árvores limpas em commits diferentes dão a mesma assinatura. Uma
 * evidência precisa do contrário — dizer contra QUE código foi tirada, e que o
 * mesmo código continua lá depois de um commit de WIP ou de uma integração que
 * não tocou nele. Então: um índice temporário a partir do HEAD recebe exatamente
 * o que um commit da fase levaria (`alteracoesParaCommit`: sem `.capivara/`,
 * sem o `.env` do harness, sem artefato local ignorado) e `write-tree` dá o id
 * do conteúdo. O índice de quem chamou e as refs não são tocados; os objetos
 * ficam soltos no banco local, como os do commit admitido.
 *
 * Sem Git não há como dizer o que mudou: o estado vem prefixado pela assinatura
 * de varredura, igualdade ainda vale, e o impacto de qualquer mudança é
 * desconhecido.
 */
export async function estadoDoCodigo(projectRoot: string): Promise<{ head: string | null; tree: string | null }> {
  if (!(await isRepository(projectRoot))) return { head: null, tree: `sem-git:${await walkSignature(projectRoot)}` };
  const head = await run("git", ["rev-parse", "-q", "--verify", "HEAD"], { cwd: projectRoot }).then((r) => r.stdout.trim(), () => null);
  const pasta = await mkdtemp(join(tmpdir(), "capivara-estado-"));
  try {
    const comIndice = { ...process.env, GIT_INDEX_FILE: join(pasta, "index") };
    const git = (args: string[]) => run("git", args, { cwd: projectRoot, env: comIndice, ...GRANDE }).then((r) => r.stdout.trim());
    await git(head ? ["read-tree", head] : ["read-tree", "--empty"]);
    const caminhos = (await alteracoesParaCommit(projectRoot, CONTROL_PLANE_PATHSPEC)).map((entrada) => entrada.caminho);
    await adicionarExatamente(projectRoot, caminhos, "-A", comIndice);
    return { head, tree: await git(["write-tree"]) };
  } catch {
    return { head, tree: `sem-arvore:${await treeSignature(projectRoot)}` };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

const ID_DE_ARVORE = /^[0-9a-f]{40,64}$/;

/**
 * Os arquivos que diferem entre dois estados de conteúdo; null quando não dá
 * para saber (sem Git, ou árvore que não é do Git) — e aí ninguém pode afirmar
 * que uma prova continua valendo.
 */
export async function arquivosMudados(projectRoot: string, de: string | null, para: string | null): Promise<string[] | null> {
  if (de === null || para === null) return null;
  if (de === para) return [];
  if (!ID_DE_ARVORE.test(de) || !ID_DE_ARVORE.test(para)) return null;
  try {
    // `-z`: o nome vem como é (sem `-z`, acento e espaço voltam entre aspas e não casam com arquivo nenhum).
    const { stdout } = await run("git", ["diff-tree", "-r", "-z", "--name-only", "--no-renames", de, para], { cwd: projectRoot, ...GRANDE });
    return stdout.split("\0").filter(Boolean).sort();
  } catch {
    return null;
  }
}

/** O commit continua no histórico do HEAD? null quando não dá para saber (sem Git, commit desconhecido). */
export async function noHistoricoDoHead(projectRoot: string, commit: string): Promise<boolean | null> {
  if (!/^[0-9a-f]{7,64}$/u.test(commit) || !(await isRepository(projectRoot))) return null;
  const existe = await run("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: projectRoot }).then(() => true, () => false);
  if (!existe) return false;
  return run("git", ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd: projectRoot }).then(() => true, (erro: { code?: number }) => (erro.code === 1 ? false : null));
}

/**
 * Dos arquivos de um conflito, os que ainda têm marcador (§125 F). É a prova
 * TEXTUAL da conciliação, e só ela: arquivo sem marcador pode estar errado, e
 * quem diz é a suíte, o verificador e os fluxos.
 */
export async function comMarcadorDeConflito(projectRoot: string, arquivos: readonly string[]): Promise<string[]> {
  const restantes: string[] = [];
  for (const arquivo of arquivos) {
    // Ausente é decisão (o arquivo saiu); ilegível por outro motivo conta como ainda em conflito — nunca como resolvido.
    const conteudo = await readFile(join(projectRoot, arquivo), "utf8").catch((erro: NodeJS.ErrnoException) => (erro.code === "ENOENT" ? "" : null));
    // A abertura E o fechamento: uma linha "=======" sozinha é sublinhado de título, não conflito.
    if (conteudo === null || (/^<{7} /mu.test(conteudo) && /^>{7}(?: |$)/mu.test(conteudo))) restantes.push(arquivo);
  }
  return restantes;
}

/**
 * Volta estes arquivos ao conteúdo que tinham num estado (`estadoDoCodigo`):
 * o que existia lá é restaurado, o que não existia sai. O índice não é tocado.
 * Serve ao Core para manter uma ação dentro do escopo dela (§125 F); devolve
 * os que não pôde restaurar.
 */
export async function restaurarDoEstado(projectRoot: string, tree: string, arquivos: readonly string[]): Promise<string[]> {
  const falharam: string[] = [];
  if (!ID_DE_ARVORE.test(tree)) return [...arquivos];
  for (const arquivo of arquivos) {
    const existia = await run("git", ["cat-file", "-e", `${tree}:${arquivo}`], { cwd: projectRoot }).then(() => true, () => false);
    try {
      if (existia) await run("git", ["restore", `--source=${tree}`, "--worktree", "--", arquivo], { cwd: projectRoot, ...GRANDE });
      // Nem no estado nem no disco: o caminho não é o que o Git listou — falha dita, nunca "desfeito".
      else if (!(await stat(join(projectRoot, arquivo)).then(() => true, () => false))) falharam.push(arquivo);
      else await rm(join(projectRoot, arquivo), { force: true, recursive: true });
    } catch {
      falharam.push(arquivo);
    }
  }
  return falharam;
}

export async function hasPendingChanges(projectRoot: string): Promise<boolean> {
  if (!(await isRepository(projectRoot))) return false;
  return !(await isClean(projectRoot));
}

export interface CommitResult {
  committed: boolean;
  message: string;
  /** O commit não foi feito por causa destes arquivos (§100). Ausente quando nada foi bloqueado. */
  bloqueios?: Bloqueio[];
}

/**
 * A admissão do que um commit automático levaria (§100): o mesmo conjunto do
 * `git add -A`, conferido ANTES de tocar no índice.
 */
async function bloqueioDoCommit(projectRoot: string, pathspec: readonly string[]): Promise<CommitResult | null> {
  const entradas = await alteracoesParaCommit(projectRoot, pathspec);
  const bloqueios = await admitirArvore(projectRoot, entradas.map((entrada) => entrada.caminho));
  if (bloqueios.length === 0) return null;
  const rastreados = new Set(entradas.filter((entrada) => !entrada.naoVersionado).map((entrada) => entrada.caminho));
  return {
    committed: false,
    bloqueios,
    message: `commit bloqueado — arquivo sensível não entra no histórico: ${descreverBloqueios(bloqueios)}. ${orientacaoDeBloqueio(bloqueios, rastreados)}`,
  };
}

/**
 * Publica o commit pela admissão sobre os OBJETOS (`commitAdmitido`, §101): o
 * que for bloqueado ali mudou depois da conferência dos arquivos — e não vai.
 */
async function publicar(projectRoot: string, caminhos: readonly string[], message: string): Promise<CommitResult> {
  const resultado = await commitAdmitido(projectRoot, { caminhos, mensagem: message });
  if (resultado.status === "commitado") return { committed: true, message };
  if (resultado.status === "vazio") return { committed: false, message: "nada a commitar: a fase já estava implementada em HEAD" };
  return {
    committed: false,
    bloqueios: resultado.bloqueios,
    message:
      `commit bloqueado — o conteúdo preparado para o commit trouxe arquivo sensível que não estava na conferência: ` +
      `${descreverBloqueios(resultado.bloqueios)}. ${orientacaoDeBloqueio(resultado.bloqueios, new Set())}`,
  };
}

/** Um commit por fase verde. Nunca muda de branch, nunca faz push. */
export async function commitPhase(projectRoot: string, phaseNumber: number, title: string): Promise<CommitResult> {
  if (!(await isRepository(projectRoot))) return { committed: false, message: "sem repositório Git: nenhum commit criado" };
  if (!(await hasPendingChanges(projectRoot))) {
    return { committed: false, message: "nada a commitar: a fase já estava implementada em HEAD" };
  }
  const message = `feat(phase-${phaseNumber}): ${title}`;
  /*
   * Commit que falha não derruba fase verde.
   *
   * O commit é escrituração: a fase passou nos gates, o código está em disco, e o
   * trabalho está feito com ou sem histórico. Enquanto isto lançava, um
   * `git commit` recusado — identidade não configurada, hook do projeto, dono do
   * arquivo — matava o build com a fase pronta e os gates todos verdes, e a
   * mensagem que chegava ao desenvolvedor era o stack trace do git.
   */
  /*
   * A política de admissão vem ANTES do `add`, e vale no serial e no worktree
   * do paralelo (§100). Bloqueado, o commit não acontece e nada é apagado: o
   * runner para a fase, e o trabalho fica onde está.
   */
  const bloqueado = await bloqueioDoCommit(projectRoot, CONTROL_PLANE_PATHSPEC);
  if (bloqueado) return bloqueado;
  try {
    /*
     * Só o que a admissão viu, pelo nome exato — o `.env` do harness fica de
     * fora —, e conferido de novo nos objetos que vão ser publicados (§101).
     * O commit não roda os hooks do projeto: um `pre-commit` que fizesse
     * `git add` poria no commit o que nenhuma conferência viu.
     */
    const admitidos = (await alteracoesParaCommit(projectRoot, CONTROL_PLANE_PATHSPEC)).map((entrada) => entrada.caminho);
    return await publicar(projectRoot, admitidos, message);
  } catch (erro) {
    const causa = (erro instanceof Error ? erro.message : String(erro)).split("\n").slice(0, 4).join(" ").trim();
    return { committed: false, message: `a fase passou, mas o commit não foi criado: ${causa}` };
  }
}

/**
 * O reparo da entrega final entra no histórico pela mesma porta da fase (§125 G).
 *
 * A aceitação operacional chamava o executor na árvore principal e deixava o
 * que ele escreveu sem commit: a aplicação era declarada concluída com o
 * conserto fora do histórico, e o próximo `build` mandava commitar ou
 * descartar. Agora o Core commita — com a mesma política de admissão, sem os
 * hooks do projeto —, e só depois de a suíte e a aceitação passarem.
 */
export async function commitDaEntrega(projectRoot: string, tentativa: number): Promise<CommitResult> {
  if (!(await isRepository(projectRoot))) return { committed: false, message: "sem repositório Git: nenhum commit criado" };
  if (!(await hasPendingChanges(projectRoot))) return { committed: false, message: "nada a commitar: o reparo não mudou o produto" };
  const bloqueado = await bloqueioDoCommit(projectRoot, CONTROL_PLANE_PATHSPEC);
  if (bloqueado) return bloqueado;
  try {
    const admitidos = (await alteracoesParaCommit(projectRoot, CONTROL_PLANE_PATHSPEC)).map((entrada) => entrada.caminho);
    return await publicar(projectRoot, admitidos, `fix(entrega): preparação operacional (aceitação, tentativa ${tentativa})`);
  } catch (erro) {
    const causa = (erro instanceof Error ? erro.message : String(erro)).split("\n").slice(0, 4).join(" ").trim();
    return { committed: false, message: `a aceitação passou, mas o commit do reparo não foi criado: ${causa}` };
  }
}

/**
 * A especificação entra no histórico do produto.
 *
 * Até aqui, `.capivara/` era excluída de tudo — e com razão, para o plano de
 * controle não contar como trabalho da fase nem poluir o commit. O efeito
 * colateral era que o código nascia versionado e a especificação que o gerou,
 * não: quem clonasse o repositório encontrava a aplicação sem as decisões que a
 * produziram.
 *
 * Só os artefatos publicados — o esqueleto e o plano — num commit próprio, no
 * momento em que cada estágio fecha o seu gate. Nada de `runs/` nem de
 * `handoffs/`: aquilo é estado do run, e o `.gitignore` escrito na árvore de
 * artefatos já os mantém de fora.
 *
 * Os DOIS estágios versionam, e o gate vai na mensagem. Enquanto só o `init`
 * chamava isto, o esqueleto entrava no histórico e o plano executável — que é o
 * artefato que o loop de fato consome — ficava de fora, com a mensagem do commit
 * anunciando um RALPH READY que aquele estágio nem alcança.
 */
export async function commitSpecification(projectRoot: string, gate: "PLAN READY" | "RALPH READY"): Promise<CommitResult> {
  if (!(await isRepository(projectRoot))) return { committed: false, message: "sem repositório Git: a especificação não foi versionada" };

  // Pathspec explícito: nada do trabalho em andamento de quem chamou entra junto.
  const bloqueado = await bloqueioDoCommit(projectRoot, [".capivara/init"]);
  if (bloqueado) return { ...bloqueado, message: bloqueado.message.replace("rode `capivara build` de novo", "rode o estágio de novo") };
  const caminhos = (await lerStatus(projectRoot, [".capivara/init"])).map((entrada) => entrada.caminho);
  if (caminhos.length === 0) return { committed: false, message: "a especificação versionada já é esta" };

  const message = `docs(capivara): especificação ${gate}`;
  const publicado = await publicar(projectRoot, caminhos, message);
  return publicado.committed || publicado.bloqueios ? publicado : { committed: false, message: "a especificação versionada já é esta" };
}
