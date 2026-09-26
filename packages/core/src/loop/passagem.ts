/**
 * O ambiente de UMA passagem do gate 4.
 *
 * Os roteiros rodavam contra o que houvesse na máquina: o banco do `.env` do
 * projeto e o diretório pessoal de quem roda. Isso derrubou a P02 do
 * `assistencia2` duas vezes com o produto certo. O fluxo "Instalação inicial"
 * precisava do arquivo de credenciais que o instalador grava em `~/`, ninguém
 * rodava o instalador, e o roteiro seguinte dependia da senha que o primeiro
 * trocaria — com os dois rodando ao mesmo tempo.
 *
 * Três coisas mudam juntas, porque metade delas não serve:
 *
 * - cada passagem começa do ZERO: um diretório pessoal vazio e, quando o projeto
 *   declara o banco como arquivo, um arquivo de banco novo. Sem isso um fluxo que
 *   troca uma senha passa na fase 2 e reprova na regressão da fase 3, porque a
 *   senha já foi trocada;
 * - o que um operador faria no terminal — instalar, migrar, semear — o roteiro faz
 *   pelo ajudante que o harness escreve (`capivara-comando.ts`), sempre com o
 *   ambiente desta passagem;
 * - os roteiros rodam em sequência, na ordem do plano, e cada um pode contar com
 *   o estado que os anteriores deixaram.
 *
 * E uma coisa que não muda: nada disto toca o diretório pessoal nem o banco do
 * desenvolvedor. Antes o gate escrevia no banco do `.env` dele.
 */

import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

/** O ajudante que o roteiro importa para rodar um comando do projeto. */
export const FLOW_HELPER = "capivara-comando.ts";

/**
 * A variável que diz ao ajudante onde está a raiz do projeto.
 *
 * O roteiro roda com o diretório de trabalho em `.capivara/flows/`, e o comando
 * do projeto tem de rodar na raiz — é lá que estão o manifesto e o `.env`.
 */
export const VARIAVEL_DA_RAIZ = "CAPIVARA_RAIZ";

/** Extensões de um banco que mora num arquivo. */
const ARQUIVO_DE_BANCO = /\.(sqlite3?|db3?)$/i;

/**
 * As chaves de ambiente que apontam para um banco em arquivo, e o arquivo.
 *
 * Lidas do `.env.example` — que o projeto versiona por regra — e do `.env`, se
 * houver. Não é adivinhação sobre o produto: é o próprio projeto dizendo, na
 * configuração que ele publica, que o banco é aquele arquivo. Quando o banco é um
 * servidor, não há chave, e o gate segue como antes.
 */
export async function bancosDeclarados(projectRoot: string): Promise<Record<string, string>> {
  const bancos: Record<string, string> = {};

  for (const nome of [".env.example", ".env"]) {
    const conteudo = await readFile(join(projectRoot, nome), "utf8").catch(() => "");
    for (const linha of conteudo.split("\n")) {
      const casou = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
      if (!casou?.[1]) continue;
      const valor = (casou[2] ?? "").replace(/^['"]|['"]$/g, "").replace(/^file:/, "");
      if (ARQUIVO_DE_BANCO.test(valor)) bancos[casou[1]] = valor;
    }
  }

  return bancos;
}

/**
 * Onde as ferramentas da máquina guardam o que já baixaram.
 *
 * Trocar o diretório pessoal troca, junto, o lugar onde o Playwright procura o
 * navegador, o npm o cache, o cargo o registro. Sem isto o gate relataria "o
 * navegador não está instalado" numa máquina que o tem. Cada valor é o PADRÃO da
 * ferramenta calculado a partir do diretório pessoal real, e só entra quando a
 * variável ainda não existe — para a ferramenta, é o mesmo lugar de sempre.
 */
export function ferramentasDaMaquina(
  ambiente: NodeJS.ProcessEnv,
  pessoal: string = homedir(),
  plataforma: NodeJS.Platform = process.platform,
): Record<string, string> {
  const cache =
    ambiente.XDG_CACHE_HOME ??
    (plataforma === "darwin" ? join(pessoal, "Library", "Caches") : join(pessoal, ".cache"));

  const navegadores =
    plataforma === "win32"
      ? join(ambiente.LOCALAPPDATA ?? join(pessoal, "AppData", "Local"), "ms-playwright")
      : join(cache, "ms-playwright");

  const padroes: Record<string, string> = {
    PLAYWRIGHT_BROWSERS_PATH: navegadores,
    npm_config_cache: join(pessoal, ".npm"),
    YARN_GLOBAL_FOLDER: join(pessoal, ".yarn", "berry"),
    COREPACK_HOME: join(cache, "node", "corepack"),
    CARGO_HOME: join(pessoal, ".cargo"),
    RUSTUP_HOME: join(pessoal, ".rustup"),
    GOPATH: join(pessoal, "go"),
    ...(plataforma === "win32" || plataforma === "darwin" ? {} : { XDG_CACHE_HOME: cache }),
  };

  return Object.fromEntries(Object.entries(padroes).filter(([chave]) => ambiente[chave] === undefined));
}

export interface AmbienteDaPassagem {
  /** O que vai para o processo do runner — e, dele, para a aplicação e o roteiro. */
  env: Record<string, string>;
  /** As chaves de banco que agora apontam para um arquivo novo. */
  bancoNovo: string[];
  limpar: () => Promise<void>;
}

/**
 * Um diretório pessoal vazio e, quando há, um banco novo.
 *
 * Temporário e apagado ao fim: nada de uma passagem sobrevive à seguinte, e é
 * isso que torna a regressão reproduzível.
 */
export async function criarAmbienteDaPassagem(
  projectRoot: string,
  declarados: Record<string, string>,
  ambiente: NodeJS.ProcessEnv = process.env,
): Promise<AmbienteDaPassagem> {
  const raiz = await mkdtemp(join(tmpdir(), "capivara-g4-"));
  const pessoal = join(raiz, "home");
  const dados = join(raiz, "dados");
  await mkdir(pessoal, { recursive: true });
  await mkdir(dados, { recursive: true });

  // O mesmo nome de arquivo, noutro lugar: um produto que confere a extensão
  // continua achando o que espera.
  const bancos = Object.fromEntries(
    Object.entries(declarados).map(([chave, valor]) => [chave, join(dados, basename(valor))]),
  );

  return {
    env: {
      ...ferramentasDaMaquina(ambiente),
      HOME: pessoal,
      USERPROFILE: pessoal,
      XDG_CONFIG_HOME: join(pessoal, ".config"),
      XDG_DATA_HOME: join(pessoal, ".local", "share"),
      XDG_STATE_HOME: join(pessoal, ".local", "state"),
      [VARIAVEL_DA_RAIZ]: projectRoot,
      ...bancos,
    },
    bancoNovo: Object.keys(declarados).sort(),
    limpar: async () => {
      await rm(raiz, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * O ajudante, escrito pelo harness a cada passagem como a configuração.
 *
 * É a única porta do roteiro para o terminal. O roteiro continua proibido de
 * importar `child_process`: foi assim que um roteirista subiu um segundo servidor
 * e o gate relatou a morte dele como defeito do produto. O ajudante roda UM
 * comando, na raiz, com o ambiente da passagem, e com prazo.
 */
export function renderFlowHelper(): string {
  return [
    "// Gerado pelo capivara a cada passagem do gate 4. Não edite: será sobrescrito.",
    "import { execFile } from 'node:child_process';",
    "",
    "/**",
    " * Roda um comando que o PROJETO declara — instalar, migrar, semear — na raiz do",
    " * projeto, com o ambiente desta passagem. Nunca para construir ou subir a aplicação:",
    " * ela já está de pé.",
    " */",
    "export async function comandoDoProjeto(",
    "  comando: string,",
    "  args: string[] = [],",
    "  opcoes: { entrada?: string; tempoMs?: number } = {},",
    "): Promise<{ codigo: number; saida: string }> {",
    `  const raiz = process.env.${VARIAVEL_DA_RAIZ};`,
    `  if (!raiz) throw new Error('comandoDoProjeto: ${VARIAVEL_DA_RAIZ} ausente — este ajudante só roda dentro do gate 4');`,
    "  return await new Promise((resolve) => {",
    "    const filho = execFile(",
    "      comando,",
    "      args,",
    "      { cwd: raiz, env: process.env, timeout: opcoes.tempoMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 },",
    "      (erro, stdout, stderr) => {",
    "        const codigo = erro ? (typeof (erro as { code?: unknown }).code === 'number' ? (erro as { code: number }).code : 1) : 0;",
    "        resolve({ codigo, saida: `${stdout}${stderr}` });",
    "      },",
    "    );",
    "    filho.stdin?.end(opcoes.entrada ?? '');",
    "  });",
    "}",
    "",
  ].join("\n");
}
