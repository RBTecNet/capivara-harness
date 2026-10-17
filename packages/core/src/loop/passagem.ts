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

/** O comando com que o gate sobe a aplicação; o ajudante o usa para subir outra instância (§109). */
export const VARIAVEL_DO_INICIO = "CAPIVARA_INICIO";

/**
 * O arquivo onde o ajudante anota cada processo que subiu (§109).
 *
 * Um roteiro que sobe uma instância e morre antes de encerrá-la deixaria um
 * servidor órfão segurando o banco e a porta. A passagem lê esta lista ao fim e
 * encerra o que sobrou — só o que o ajudante anotou, nunca um processo alheio.
 */
export const VARIAVEL_DOS_PROCESSOS = "CAPIVARA_PROCESSOS";

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
      [VARIAVEL_DOS_PROCESSOS]: join(raiz, "processos.txt"),
      ...bancos,
    },
    bancoNovo: Object.keys(declarados).sort(),
    limpar: async () => {
      await encerrarOrfaos(join(raiz, "processos.txt"));
      await rm(raiz, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/**
 * Encerra o grupo de cada processo que o ajudante anotou e ainda está vivo.
 *
 * O ajudante sobe cada instância como líder de um grupo próprio (`detached`), e
 * o grupo leva junto o que o comando de início criou — `npm` cria shell e node.
 */
export async function encerrarOrfaos(lista: string): Promise<void> {
  const pids = (await readFile(lista, "utf8").catch(() => ""))
    .split("\n")
    .map((linha) => Number(linha.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
  for (const pid of pids) {
    try {
      if (process.platform === "win32") process.kill(pid, "SIGKILL");
      else process.kill(-pid, "SIGKILL");
    } catch {
      // Já tinha saído: é o caso comum, o roteiro encerrou o que subiu.
    }
  }
}

/**
 * O ajudante, escrito pelo harness a cada passagem como a configuração.
 *
 * Duas portas para o terminal, com o ambiente da passagem:
 *
 * - `comandoDoProjeto` roda UM comando na raiz, com prazo — instalar, migrar,
 *   semear, ler o que o produto gravou;
 * - `aplicacaoPropria` (§109) sobe OUTRA instância do produto, com o mesmo
 *   comando de início do gate, o mesmo ambiente e o mesmo arquivo de banco, numa
 *   porta livre só dela, e a reinicia ou encerra de verdade. É o que torna
 *   percorrível o passo "reiniciar o servidor e conferir o que persistiu": a
 *   instância do gate pertence ao Playwright e não pode ser reiniciada pelo
 *   roteiro. No `build-96756ca336b0` o roteiro era proibido de subir servidores,
 *   o ajudante não reiniciava nada, e a P05 bloqueou num passo que ninguém podia
 *   cumprir.
 *
 * Cada instância nasce líder de um grupo de processos e é anotada na lista da
 * passagem, que encerra ao fim o que o roteiro deixou de pé.
 */
export function renderFlowHelper(): string {
  return [
    "// Gerado pelo capivara a cada passagem do gate 4. Não edite: será sobrescrito.",
    "import { execFile, spawn, type ChildProcess } from 'node:child_process';",
    "import { appendFileSync } from 'node:fs';",
    "import { createServer } from 'node:net';",
    "",
    "/**",
    " * Roda um comando que o PROJETO declara — instalar, migrar, semear — na raiz do",
    " * projeto, com o ambiente desta passagem. Para subir, parar ou reiniciar a aplicação,",
    " * use `aplicacaoPropria`.",
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
    "export interface AplicacaoPropria {",
    "  /** Onde esta instância responde — use `${app.url}/rota` ou `page.goto(app.url + '/rota')`. */",
    "  url: string;",
    "  porta: number;",
    "  /** O processo de agora; muda a cada `reiniciar`. */",
    "  pid: () => number;",
    "  /** Encerra o processo de verdade, espera ele sair, e sobe de novo na mesma porta e no mesmo banco. */",
    "  reiniciar: () => Promise<void>;",
    "  /** Encerra e espera sair. Chame ao fim do passo que subiu a instância. */",
    "  encerrar: () => Promise<void>;",
    "  /** O que a instância escreveu até agora, para pôr na mensagem de uma asserção. */",
    "  saida: () => string;",
    "}",
    "",
    "const vivos = new Set<ChildProcess>();",
    "process.once('exit', () => {",
    "  for (const filho of vivos) matar(filho, 'SIGKILL');",
    "});",
    "",
    "function matar(filho: ChildProcess, sinal: NodeJS.Signals): void {",
    "  if (filho.pid === undefined) return;",
    "  try {",
    "    if (process.platform === 'win32') filho.kill(sinal);",
    "    else process.kill(-filho.pid, sinal);",
    "  } catch {",
    "    // já saiu",
    "  }",
    "}",
    "",
    "async function portaLivre(): Promise<number> {",
    "  return await new Promise((resolve, reject) => {",
    "    const servidor = createServer();",
    "    servidor.once('error', reject);",
    "    servidor.listen(0, '127.0.0.1', () => {",
    "      const endereco = servidor.address();",
    "      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;",
    "      servidor.close(() => resolve(porta));",
    "    });",
    "  });",
    "}",
    "",
    "/**",
    " * Sobe outra instância da aplicação, com o comando de início do gate, o ambiente desta",
    " * passagem e o MESMO arquivo de banco, numa porta livre só dela. A instância do gate",
    " * continua de pé em paralelo; esta é a que o roteiro pode reiniciar e encerrar.",
    " */",
    "export async function aplicacaoPropria(opcoes: { tempoMs?: number; ambiente?: Record<string, string> } = {}): Promise<AplicacaoPropria> {",
    `  const raiz = process.env.${VARIAVEL_DA_RAIZ};`,
    `  const comando = process.env.${VARIAVEL_DO_INICIO};`,
    `  if (!raiz || !comando) throw new Error('aplicacaoPropria: ${VARIAVEL_DA_RAIZ} ou ${VARIAVEL_DO_INICIO} ausente — este ajudante só roda dentro do gate 4');`,
    "  const prazo = opcoes.tempoMs ?? 120_000;",
    "  const porta = await portaLivre();",
    "  const url = `http://127.0.0.1:${porta}`;",
    "  let filho: ChildProcess | undefined;",
    "  let saida = '';",
    "",
    "  const saiu = (processo: ChildProcess): Promise<void> =>",
    "    processo.exitCode !== null || processo.signalCode !== null",
    "      ? Promise.resolve()",
    "      : new Promise((resolve) => processo.once('exit', () => resolve()));",
    "",
    "  const subir = async (): Promise<void> => {",
    "    const atual = spawn(comando, {",
    "      cwd: raiz,",
    "      env: { ...process.env, ...opcoes.ambiente, PORT: String(porta), HOST: '127.0.0.1' },",
    "      shell: true,",
    "      detached: process.platform !== 'win32',",
    "      stdio: ['ignore', 'pipe', 'pipe'],",
    "    });",
    "    filho = atual;",
    "    vivos.add(atual);",
    "    atual.once('exit', () => vivos.delete(atual));",
    `    const lista = process.env.${VARIAVEL_DOS_PROCESSOS};`,
    "    if (lista && atual.pid !== undefined) appendFileSync(lista, `${atual.pid}\\n`);",
    "    atual.stdout?.on('data', (pedaco) => (saida += String(pedaco)));",
    "    atual.stderr?.on('data', (pedaco) => (saida += String(pedaco)));",
    "    const limite = Date.now() + prazo;",
    "    for (;;) {",
    "      if (atual.exitCode !== null || atual.signalCode !== null) {",
    "        throw new Error(`aplicacaoPropria: a instância saiu antes de responder em ${url}:\\n${saida.slice(-2000)}`);",
    "      }",
    "      try {",
    "        await fetch(url, { signal: AbortSignal.timeout(2_000) });",
    "        return;",
    "      } catch {",
    "        if (Date.now() > limite) {",
    "          matar(atual, 'SIGKILL');",
    "          throw new Error(`aplicacaoPropria: nada respondeu em ${url} em ${prazo} ms:\\n${saida.slice(-2000)}`);",
    "        }",
    "        await new Promise((resolve) => setTimeout(resolve, 250));",
    "      }",
    "    }",
    "  };",
    "",
    "  const encerrar = async (): Promise<void> => {",
    "    const atual = filho;",
    "    if (!atual) return;",
    "    const fim = saiu(atual);",
    "    matar(atual, 'SIGTERM');",
    "    const aindaVivo = setTimeout(() => matar(atual, 'SIGKILL'), 5_000);",
    "    await fim;",
    "    clearTimeout(aindaVivo);",
    "    // O grupo inteiro: o comando de início pode ter deixado filhos.",
    "    matar(atual, 'SIGKILL');",
    "  };",
    "",
    "  await subir();",
    "  return {",
    "    url,",
    "    porta,",
    "    pid: () => filho?.pid ?? 0,",
    "    reiniciar: async () => {",
    "      await encerrar();",
    "      await subir();",
    "    },",
    "    encerrar,",
    "    saida: () => saida,",
    "  };",
    "}",
    "",
  ].join("\n");
}
