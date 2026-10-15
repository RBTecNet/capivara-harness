/**
 * O que um commit automático da Capivara pode levar para o histórico (§100).
 *
 * Todo commit que a Capivara faz sozinha — o da fase, o do parcial, o de
 * recuperação, o inicial, o da especificação — e todo cherry-pick da
 * integração passam por aqui antes. O `.gitignore` não é a proteção: um `.env`
 * que ninguém ignorou entrava no `git add -A` como qualquer arquivo, e uma vez no
 * histórico o segredo está em todo clone e em todo push.
 *
 * A política é determinística e fechada, em duas camadas:
 *
 * - **pelo nome**: arquivos que são credencial por convenção — `.env` e
 *   `.env.<qualquer>` (menos os exemplos que o §46 manda versionar), chaves
 *   `.key`, chaves de SSH, repositórios de chaves (`.p12`, `.pfx`, `.jks`,
 *   `.keystore`) e arquivos de credencial (`.netrc`, `.pgpass`,
 *   `.git-credentials`);
 * - **pelo conteúdo**: qualquer arquivo com um bloco PEM de chave PRIVADA, seja
 *   qual for o nome; e o `.pem` que não traz nem certificado nem chave pública
 *   reconhecível é tratado como suspeito — um certificado público passa.
 *
 * O que ela não faz, e não promete: achar um segredo arbitrário dentro de um
 * arquivo de nome comum (`config.ts` com uma senha literal). Isso não tem
 * detecção garantida; a política cobre os caminhos conhecidos e as chaves.
 *
 * Quem consome decide o que fazer com o bloqueio, e nunca apaga nada: commit de
 * PUBLICAÇÃO (fase, inicial, especificação, integração) não acontece; commit de
 * RECUPERAÇÃO (parcial, rollback) leva o resto e guarda o bloqueado fora do Git.
 * A mensagem diz o caminho e o motivo — nunca o conteúdo.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ARQUIVO_DE_AMBIENTE, ambienteEhDescartavel } from "./ambiente.js";

const run = promisify(execFile);
const GRANDE = { maxBuffer: 64 * 1024 * 1024 };

export interface Bloqueio {
  caminho: string;
  /** Por que não entra. Nunca traz o conteúdo do arquivo. */
  motivo: string;
}

/** Acima disto o conteúdo não é lido: o nome ainda vale, e o `.pem` grande demais é suspeito. */
const LIMITE_DE_LEITURA = 2 * 1024 * 1024;

const EXEMPLO_DE_AMBIENTE = /^\.env\.(?:example|sample|template|dist|defaults)$/i;
const CHAVE_PRIVADA = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/;
const BLOCO_PUBLICO = /-----BEGIN (?:CERTIFICATE|TRUSTED CERTIFICATE|X509 CRL|CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST|PUBLIC KEY|RSA PUBLIC KEY)-----/;

/** O motivo pelo NOME do arquivo, ou nulo. */
export function motivoPeloNome(caminho: string): string | null {
  const nome = caminho.split("/").pop() ?? caminho;
  if (EXEMPLO_DE_AMBIENTE.test(nome)) return null;
  if (/^\.env(?:\..+)?$/i.test(nome)) return "arquivo de ambiente (.env), que guarda credenciais";
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(nome)) return "chave privada de SSH";
  if (/\.key$/i.test(nome)) return "chave privada (.key)";
  if (/\.(?:p12|pfx|jks|keystore)$/i.test(nome)) return "repositório de chaves privadas";
  if (/^(?:\.netrc|\.pgpass|\.git-credentials)$/.test(nome)) return "arquivo de credenciais";
  return null;
}

/** Só pelo nome: é o que se sabe de um caminho sem abrir o arquivo. */
export function arquivoSensivel(caminho: string): boolean {
  return motivoPeloNome(caminho) !== null;
}

/**
 * O motivo pelo CONTEÚDO, ou nulo. `conteudo` nulo é arquivo que não se pôde
 * ler (grande demais, ilegível): só o `.pem` vira suspeito por isso.
 */
export function motivoPeloConteudo(caminho: string, conteudo: Buffer | null): string | null {
  const ehPem = /\.pem$/i.test(caminho);
  if (conteudo === null) return ehPem ? "arquivo PEM que não pôde ser lido: tratado como suspeito" : null;
  const texto = conteudo.toString("latin1");
  if (CHAVE_PRIVADA.test(texto)) return "contém uma chave privada (bloco PEM)";
  if (ehPem && !BLOCO_PUBLICO.test(texto)) return "arquivo PEM sem certificado nem chave pública reconhecível: tratado como suspeito";
  return null;
}

export function avaliarArquivo(caminho: string, conteudo: Buffer | null): Bloqueio | null {
  const motivo = motivoPeloNome(caminho) ?? motivoPeloConteudo(caminho, conteudo);
  return motivo === null ? null : { caminho, motivo };
}

async function lerSeCouber(arquivo: string): Promise<Buffer | null | "ausente"> {
  const info = await stat(arquivo).catch(() => null);
  if (info === null) return "ausente";
  if (!info.isFile() || info.size > LIMITE_DE_LEITURA) return null;
  return readFile(arquivo).catch(() => null);
}

/**
 * Os bloqueios entre arquivos da ÁRVORE de trabalho. Caminho que não existe é
 * remoção — tirar um arquivo do histórico nunca é bloqueado.
 */
export async function admitirArvore(root: string, caminhos: readonly string[]): Promise<Bloqueio[]> {
  const bloqueios: Bloqueio[] = [];
  const unicos = [...new Set(caminhos)].sort();
  // Em lotes: uma árvore inicial pode ter milhares de arquivos.
  for (let inicio = 0; inicio < unicos.length; inicio += 32) {
    const lote = unicos.slice(inicio, inicio + 32);
    const avaliados = await Promise.all(
      lote.map(async (caminho) => {
        const conteudo = await lerSeCouber(join(root, caminho));
        return conteudo === "ausente" ? null : avaliarArquivo(caminho, conteudo);
      }),
    );
    for (const bloqueio of avaliados) if (bloqueio) bloqueios.push(bloqueio);
  }
  return bloqueios;
}

/**
 * Os bloqueios entre o que os commits `base..ponta` TRAZEM — lido dos objetos
 * do Git, não da árvore. É o que a integração confere antes do cherry-pick:
 * ela não depende de o worker ter passado pela política (o agente pode ter
 * commitado por conta própria).
 */
export async function admitirIntervalo(root: string, base: string, ponta: string): Promise<Bloqueio[]> {
  const { stdout } = await run("git", ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", base, ponta], { cwd: root, ...GRANDE });
  const bloqueios: Bloqueio[] = [];
  for (const caminho of stdout.split("\0").filter(Boolean)) {
    let conteudo: Buffer | null = null;
    try {
      const tamanho = Number((await run("git", ["cat-file", "-s", `${ponta}:${caminho}`], { cwd: root })).stdout.trim());
      if (tamanho <= LIMITE_DE_LEITURA) {
        conteudo = (await run("git", ["cat-file", "blob", `${ponta}:${caminho}`], { cwd: root, encoding: "buffer", ...GRANDE })).stdout;
      }
    } catch {
      conteudo = null;
    }
    const bloqueio = avaliarArquivo(caminho, conteudo);
    if (bloqueio) bloqueios.push(bloqueio);
  }
  return bloqueios;
}

export interface EntradaDoStatus {
  caminho: string;
  naoVersionado: boolean;
}

/**
 * As entradas de um `git status --porcelain -z`, com os não versionados
 * listados um a um — o mesmo conjunto que um `git add -A` levaria.
 */
export async function lerStatus(root: string, pathspec: readonly string[] = [".", ":(exclude).capivara"]): Promise<EntradaDoStatus[]> {
  // Sem `trim`: o status começa com espaço quando só a árvore mudou (" M arquivo").
  const { stdout } = await run("git", ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...pathspec], { cwd: root, ...GRANDE });
  const entradas: EntradaDoStatus[] = [];
  const partes = stdout.split("\0");
  for (let indice = 0; indice < partes.length; indice += 1) {
    const parte = partes[indice] ?? "";
    if (parte.length < 4) continue;
    const codigo = parte.slice(0, 2);
    entradas.push({ caminho: parte.slice(3), naoVersionado: codigo === "??" });
    // Renomeação e cópia trazem o caminho de origem na entrada seguinte.
    if (codigo.includes("R") || codigo.includes("C")) indice += 1;
  }
  return entradas;
}

/**
 * O que um `git add -A` levaria, menos o `.env` que o PRÓPRIO harness criou.
 *
 * O §46 manda o harness semear o `.env` a partir do `.env.example` para os
 * gates rodarem. Esse arquivo é do harness — a marca na primeira linha diz —, e
 * não é trabalho da fase: ele nunca entra em commit, e também não BLOQUEIA o
 * commit nem deixa a árvore "suja". Bloquear o próprio artefato faria todo
 * projeto sem `.env` no `.gitignore` parar em toda fase. Sem a marca, o arquivo é
 * de quem o escreveu, e volta a ser sensível como qualquer `.env`. Com a marca e
 * valores reais editados, continua fora do histórico: só não para o build.
 */
export async function alteracoesParaCommit(root: string, pathspec?: readonly string[]): Promise<EntradaDoStatus[]> {
  const entradas = await lerStatus(root, pathspec);
  const doHarness = await ambienteEhDescartavel(root);
  return entradas.filter((entrada) => !(doHarness && entrada.naoVersionado && entrada.caminho === ARQUIVO_DE_AMBIENTE));
}

/**
 * `git add` de EXATAMENTE estes caminhos — nenhum outro, nenhum curinga.
 *
 * A lista vai por arquivo (`--pathspec-from-file`), não por argumento: uma
 * fase que cria milhares de arquivos estouraria o limite da linha de comando.
 * `modo` é `-A` (inclui não versionados admitidos) ou `-u` (só versionados).
 */
export async function adicionarExatamente(
  root: string,
  caminhos: readonly string[],
  modo: "-A" | "-u",
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (caminhos.length === 0) return;
  const pasta = await mkdtemp(join(tmpdir(), "capivara-pathspec-"));
  try {
    const lista = join(pasta, "caminhos");
    await writeFile(lista, `${caminhos.join("\0")}\0`);
    await run("git", ["add", modo, `--pathspec-from-file=${lista}`, "--pathspec-file-nul"], {
      cwd: root,
      env: { ...env, GIT_LITERAL_PATHSPECS: "1" },
      ...GRANDE,
    });
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

/** `.env (arquivo de ambiente…); certs/a.key (chave privada…)` — caminho e motivo, nada mais. */
export function descreverBloqueios(bloqueios: readonly Bloqueio[]): string {
  return bloqueios.map((bloqueio) => `${bloqueio.caminho} (${bloqueio.motivo})`).join("; ");
}

/**
 * O que fazer, em passos que não perdem nada e não reescrevem o histórico.
 * `rastreados` são os que já estão no repositório: tirá-los do índice não os
 * apaga do disco, e o que já foi publicado continua no histórico antigo.
 */
export function orientacaoDeBloqueio(bloqueios: readonly Bloqueio[], rastreados: ReadonlySet<string>): string {
  const novos = bloqueios.filter((bloqueio) => !rastreados.has(bloqueio.caminho)).map((bloqueio) => bloqueio.caminho);
  const antigos = bloqueios.filter((bloqueio) => rastreados.has(bloqueio.caminho)).map((bloqueio) => bloqueio.caminho);
  const passos: string[] = [];
  if (novos.length > 0) passos.push(`adicione ${novos.join(", ")} ao .gitignore (ou mova para fora do projeto)`);
  if (antigos.length > 0) {
    passos.push(
      `${antigos.join(", ")} já é rastreado: \`git rm --cached ${antigos.join(" ")}\` e adicione ao .gitignore — o arquivo fica em disco; ` +
        "o histórico antigo não é reescrito, então troque a credencial se ela já foi publicada",
    );
  }
  return `Nada foi commitado nem apagado. Para seguir: ${passos.join("; ")}; depois rode \`capivara build\` de novo.`;
}
