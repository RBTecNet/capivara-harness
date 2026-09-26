/**
 * G4 — a aplicação faz o que foi pedido.
 *
 * O §28 do plano é o buraco que este módulo fecha. Os outros quatro gates
 * perguntam se o engine terminou, se a sessão escreveu, se a suíte passa e se o
 * código implementa as tasks — e o build D do piloto 6 respondeu sim às quatro
 * com a tela de cadastro de membros sem cadastrar ninguém. Nenhum deles abre o
 * produto.
 *
 * Este abre. Cada fluxo do esqueleto vira um roteiro Playwright, escrito por uma
 * sessão que não implementou a fase, guardado em `.capivara/flows/` e rodado
 * PELO LOOP contra a aplicação de pé. O veredito é o código de saída do
 * processo, não a narrativa de quem escreveu — como no gate 2, e pela mesma
 * razão.
 *
 * O roteiro fica no projeto de propósito: o fluxo da fase 2 continua sendo
 * exercitado na fase 7, e é assim que uma regressão aparece na fase em que foi
 * causada.
 */

import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkeletonWorkflow } from "../contract/index.js";
import { extractFlowScript, stepLabel } from "../prompts/index.js";
import { comandoDeMigracao } from "./ambiente.js";
import { FLOW_HELPER, bancosDeclarados, criarAmbienteDaPassagem, renderFlowHelper } from "./passagem.js";

/** Onde os roteiros moram, relativo à raiz do projeto. */
export const FLOWS_DIR = join(".capivara", "flows");

export const FLOW_CONFIG = "playwright.config.mjs";

/**
 * A primeira linha de todo roteiro que o harness grava.
 *
 * Ela diz sob qual AMBIENTE o roteiro foi escrito. Até a v2 a passagem rodava
 * contra o banco e o diretório pessoal da máquina, os roteiros em paralelo, e o
 * roteirista não tinha como rodar um comando do projeto. Um roteiro escrito para
 * aquilo — que lê um arquivo que ninguém criou, ou conta com um estado que não
 * existe mais — reprova um produto certo. Sem a marca, o roteiro é reescrito uma
 * vez, e custa uma sessão de roteirista em vez de um ciclo do executor.
 */
export const FLOW_MARK = "// capivara-flow: v2 — passagem isolada, em sequência";

/** O roteiro gravado foi escrito para o ambiente de hoje? */
export function roteiroAtual(conteudo: string): boolean {
  return conteudo.startsWith(FLOW_MARK);
}

function comMarca(script: string): string {
  return `${FLOW_MARK}\n${script.startsWith(FLOW_MARK) ? script.slice(FLOW_MARK.length).replace(/^\n/, "") : script}\n`;
}

/** A porta em que o gate sobe o produto. Alta e fixa: nada disputa com ela. */
/**
 * A porta preferida do gate 4. Preferida, não fixa.
 *
 * Ela era fixa, e isso derrubou a fase 2 do `MCP_teste2` no último ciclo: o
 * executor subiu a aplicação para conferir o próprio trabalho, disse ter
 * encerrado o processo e não encerrou. O Playwright achou a porta ocupada e
 * recusou — "is already used, make sure that nothing is running on the port" —,
 * e o gate relatou que a aplicação não subiu. Defeito de ambiente cobrado como
 * defeito de produto, no ciclo em que não havia mais volta.
 *
 * Um número fixo transforma qualquer processo esquecido — do executor, de outro
 * run, de outro projeto — em reprovação. A porta passa a ser escolhida livre a
 * cada passagem, e esta fica como primeira tentativa por ser a conhecida.
 */
export const FLOW_PORT = 47533;

/**
 * Uma porta que ninguém está usando agora.
 *
 * Tenta a preferida e, ocupada, pede uma efêmera ao sistema. A janela entre
 * fechar o servidor de teste e o Playwright abrir o dele é pequena e real; ela
 * existia antes com número fixo, e continua existindo — a diferença é que agora
 * a colisão é improvável em vez de garantida por qualquer órfão.
 */
export async function portaLivre(preferida = FLOW_PORT): Promise<number> {
  const tentar = async (porta: number): Promise<number | null> =>
    await new Promise((resolve) => {
      const servidor = createServer();
      servidor.once("error", () => resolve(null));
      servidor.listen(porta, "127.0.0.1", () => {
        const endereco = servidor.address();
        const escolhida = typeof endereco === "object" && endereco ? endereco.port : porta;
        servidor.close(() => resolve(escolhida));
      });
    });

  return (await tentar(preferida)) ?? (await tentar(0)) ?? preferida;
}

/** `workflow 2` e `workflow 2.1` viram nomes de arquivo estáveis. */
export function flowScriptName(workflowNumber: string): string {
  return `workflow-${workflowNumber.trim().replace(/[^0-9A-Za-z.]+/g, "-")}.spec.ts`;
}

export interface FlowDefect {
  problem: string;
  hint: string;
}

/** Comparação tolerante ao que não muda o sentido: caixa, acento, pontuação, espaço. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * O roteiro cobre o fluxo declarado?
 *
 * Esta é a resposta ao preço de deixar um modelo escrever a própria prova: ele
 * pode afrouxar a asserção, mas não pode deixar de citar o passo, nem pular o
 * teste, nem entregar um roteiro que só clica. O que não dá para verificar
 * mecanicamente — se a asserção é forte — continua sendo julgamento; o que dá,
 * é conferido aqui antes de qualquer navegador abrir.
 */
export function checkFlowScript(script: string, workflow: SkeletonWorkflow): FlowDefect[] {
  const defects: FlowDefect[] = [];
  const corpo = normalizar(script);

  if (script.trim() === "") {
    return [{ problem: "o roteiro veio vazio", hint: "devolva o arquivo inteiro num único bloco de código" }];
  }

  for (const [index, step] of workflow.steps.entries()) {
    const rotulo = normalizar(stepLabel(index, step));
    if (!corpo.includes(rotulo)) {
      defects.push({
        problem: `o passo ${index + 1} não aparece como test.step`,
        hint: `escreva \`await test.step('${stepLabel(index, step)}', …)\`, com o texto do passo como está no esqueleto`,
      });
    }
  }

  const steps = [...script.matchAll(/test\s*\.\s*step\s*\(/g)].length;
  if (steps < workflow.steps.length) {
    defects.push({
      problem: `o fluxo tem ${workflow.steps.length} passos e o roteiro declara ${steps} test.step`,
      hint: "um test.step por passo declarado, na ordem",
    });
  }

  const asserts = [...script.matchAll(/\bexpect\s*\(/g)].length;
  if (asserts < workflow.steps.length) {
    defects.push({
      problem: `o roteiro tem ${asserts} expect para ${workflow.steps.length} passos`,
      hint: "cada passo precisa afirmar o que o usuário veria depois dele; um passo que só clica não prova nada",
    });
  }

  for (const proibido of ["test.skip", "test.fixme", ".only("]) {
    if (script.includes(proibido)) {
      defects.push({
        problem: `o roteiro usa ${proibido}`,
        hint: "um fluxo que não roda não é um fluxo verificado; remova e entregue o roteiro que executa",
      });
    }
  }

  /*
   * O roteiro NÃO sobe a aplicação.
   *
   * Quem constrói, sobe e espera o produto responder é o harness — é o que dá ao
   * gate a autoridade de dizer que a aplicação está de pé. No `teste` o
   * roteirista escreveu oitenta linhas antes do primeiro passo: importava
   * `child_process`, subia um segundo servidor numa porta sua e ficava
   * consultando com `fetch` até responder. Esse servidor morria, e o gate
   * relatava "O servidor de teste encerrou antes de abrir a página" — uma
   * mensagem do próprio roteiro, sobre um servidor que o harness nem sabia que
   * existia, enquanto a aplicação de verdade estava de pé ao lado.
   */
  if (/from\s*['"`]node:child_process['"`]|from\s*['"`]child_process['"`]|require\s*\(\s*['"`](?:node:)?child_process['"`]/.test(script)) {
    defects.push({
      problem: "o roteiro sobe a própria aplicação",
      hint:
        "a aplicação JÁ ESTÁ DE PÉ quando o roteiro começa: o harness a constrói, sobe e espera responder. " +
        "Remova o child_process e use `page.goto('/rota')` com caminho relativo",
    });
  }

  /*
   * O ajudante roda o que um operador rodaria — instalar, migrar, semear. Nunca
   * construir nem subir: a aplicação já está de pé, e um `build` no meio da
   * passagem reescreve o que o servidor está servindo.
   */
  if (/comandoDoProjeto\s*\([^)]*['"`](?:start|dev|serve|preview|build)['"`]/.test(script)) {
    defects.push({
      problem: "o roteiro usa o ajudante para construir ou subir a aplicação",
      hint:
        "a aplicação JÁ ESTÁ DE PÉ: o harness a constrói e sobe antes do primeiro passo. Use `comandoDoProjeto` " +
        "só para o que o operador faria no terminal — instalar, migrar, semear",
    });
  }

  if (/(?:goto|fetch|request\s*\.\s*\w+)\s*\(\s*[`'"]https?:\/\/(?:127\.0\.0\.1|localhost)/.test(script)) {
    defects.push({
      problem: "o roteiro escolhe onde a aplicação está",
      hint:
        "a URL base é do harness, e é ela que garante que o roteiro fala com o produto que acabou de ser " +
        "construído; use caminho relativo, como `page.goto('/clientes')`",
    });
  }

  // Interceptar a própria API transforma o gate em teatro: a tela passa a ser
  // exercitada contra respostas inventadas pelo roteiro.
  if (/page\s*\.\s*route\s*\(\s*['"`][^'"`]*(\/api\/|localhost)/.test(script)) {
    defects.push({
      problem: "o roteiro intercepta o backend do próprio produto",
      hint: "o gate existe para exercitar o produto de verdade; só um serviço de terceiro pode ser substituído",
    });
  }

  return defects;
}

/**
 * A configuração que o LOOP escreve, não o modelo.
 *
 * Quem sobe a aplicação e onde ela responde é decisão do harness: se o roteiro
 * pudesse escolher, um roteiro poderia apontar para outro lugar e passar sem
 * nunca tocar no produto construído.
 */
export function renderFlowConfig(options: {
  startCommand: string;
  port: number;
  timeoutSeconds?: number;
  /** Os roteiros NA ORDEM em que rodam. Cada um depende do anterior. */
  scripts?: readonly string[];
}): string {
  const url = `http://127.0.0.1:${options.port}`;
  const scripts = options.scripts ?? [];
  return [
    "// Gerado pelo capivara a cada passagem do gate 4. Não edite: será sobrescrito.",
    "export default {",
    "  testDir: '.',",
    "  timeout: 60_000,",
    "  reporter: [['list']],",
    "  fullyParallel: false,",
    /*
     * Um de cada vez, na ordem do plano.
     *
     * Os roteiros compartilham a aplicação e o banco da passagem, e um fluxo pode
     * depender do que o anterior deixou — a senha trocada, o cadastro feito. Com
     * dois workers, o fluxo 4 do `assistencia2` rodou antes do fluxo 1 que ele
     * pressupunha. Cada roteiro vira um projeto que depende do anterior: é o jeito
     * do Playwright garantir ordem entre arquivos, e quando um falha os seguintes
     * não rodam sobre um estado que não se formou.
     */
    "  workers: 1,",
    "  forbidOnly: true,",
    ...(scripts.length > 0
      ? [
          "  projects: [",
          ...scripts.map((script, indice) => {
            const nome = JSON.stringify(script.replace(/\.spec\.ts$/, ""));
            const padrao = JSON.stringify(`**/${script}`);
            const anterior = indice > 0 ? `, dependencies: [${JSON.stringify((scripts[indice - 1] ?? "").replace(/\.spec\.ts$/, ""))}]` : "";
            return `    { name: ${nome}, testMatch: ${padrao}${anterior} },`;
          }),
          "  ],",
        ]
      : []),
    "  use: {",
    `    baseURL: '${url}',`,
    "    screenshot: 'only-on-failure',",
    "    video: 'off',",
    "    trace: 'off',",
    "  },",
    "  webServer: {",
    `    command: ${JSON.stringify(options.startCommand)},`,
    `    url: '${url}',`,
    "    reuseExistingServer: false,",
    `    timeout: ${(options.timeoutSeconds ?? 180) * 1000},`,
    /*
     * PORT e HOST, e mais nada.
     *
     * O gate subia a aplicação com NODE_ENV=test, o que era uma suposição nossa
     * sobre o produto alheio — e produto que se comporta diferente em teste faz
     * exatamente o contrário do que este gate existe para provar. No MCP_teste a
     * aplicação trocava de banco ao ver essa variável, exigia outra que ninguém
     * definiu e não subia; o executor levou "a aplicação não subiu" por culpa da
     * nossa configuração. O fluxo percorre o produto como ele é.
     */
    `    env: { PORT: '${options.port}', HOST: '127.0.0.1' },`,
    "    cwd: '../..',",
    "  },",
    "};",
    "",
  ].join("\n");
}

export interface FlowRun {
  exitCode: number;
  output: string;
  /** O runner de fluxos não está instalado — defeito de ambiente, não do produto. */
  toolMissing?: boolean;
}

/**
 * `env` é o ambiente da passagem — diretório pessoal e banco descartáveis. Ele vai
 * para o processo do runner e, dele, para a aplicação e para o roteiro.
 */
export type FlowRunner = (projectRoot: string, scripts: string[], env?: Record<string, string>) => Promise<FlowRun>;

/**
 * A saída diz que o runner não está instalado?
 *
 * Exportada para ser exercitável: a decisão vive aqui, e não numa regex escondida
 * dentro do runner que só um processo de verdade alcançaria.
 *
 * O padrão dizia `Cannot find module`, e o Node moderno diz `Cannot find
 * package`. No MCP_teste isso fez o executor receber "um passo falhou onde o
 * usuário passaria" quando o que faltava era `@playwright/test` — ele foi caçar
 * defeito no produto e quebrou o que estava de pé. Uma palavra no padrão custou
 * uma fase inteira.
 */
/**
 * A falha é do ROTEIRO, não do produto?
 *
 * O roteiro é escrito por um modelo que não viu a aplicação rodando, e há
 * defeitos que são dele: seletor que casa com dois elementos, import quebrado,
 * sintaxe inválida. No MCP_teste um `getByRole('alert')` casou com o alerta da
 * página e com o `__next-route-announcer__` que o Next injeta em toda rota — o
 * produto estava certo, e o executor foi chamado para consertá-lo.
 *
 * Isto é o §34.8 um nível acima: defeito do instrumento não vira defeito do
 * produto. Quando é do roteiro, quem reescreve é quem o escreveu.
 */
export function ehFalhaDoRoteiro(output: string): boolean {
  return /strict mode violation|resolved to \d+ elements|Cannot find name|SyntaxError|Unexpected token|is not a function|Cannot read propert/i.test(
    output,
  );
}

export function faltaORunner(output: string, exitCode: number): boolean {
  if (exitCode === 127) return true;
  return [
    // O npm dizendo que não achou o que executar.
    /could not determine executable/i,
    /playwright: (command )?not found/i,
    // O import do runner, e só dele: `Module not found` de um import do PRODUTO
    // é defeito do produto, e foi assim que a fase 3 do MCP_teste foi mandada
    // instalar um Playwright que já estava instalado.
    /Cannot find (module|package) ['"`]?@playwright\/test/i,
    /Please install @playwright\/test/i,
    // O navegador, que é metade do runner: sem ele nada abre.
    /npx playwright install/i,
    /Executable doesn't exist at/i,
  ].some((padrao) => padrao.test(output));
}

/**
 * Playwright, rodado pelo loop.
 *
 * `npx --no-install` é deliberado: instalar por conta própria, no meio de um
 * gate, esconderia do operador que o projeto não declarou a dependência. Sem o
 * runner, o gate diz o que falta e quem instala é o executor, como no gate 2.
 */
export const defaultFlowRunner: FlowRunner = async (projectRoot, scripts, env = {}) =>
  new Promise((resolve) => {
    const child = execFile(
      "npx",
      ["--no-install", "playwright", "test", "--config", FLOW_CONFIG, ...scripts],
      { cwd: join(projectRoot, FLOWS_DIR), maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env, CI: "1" } },
      (error, stdout, stderr) => {
        const saida = `${stdout}${stderr}`;
        const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        const ausente = faltaORunner(saida, code);
        resolve({ exitCode: code, output: saida, ...(ausente ? { toolMissing: true } : {}) });
      },
    );
    child.stdin?.end();
  });

/** Os roteiros já escritos, em ordem estável — a regressão das fases anteriores. */
export async function existingFlowScripts(projectRoot: string): Promise<string[]> {
  const entries = await readdir(join(projectRoot, FLOWS_DIR)).catch(() => [] as string[]);
  return entries.filter((name) => name.endsWith(".spec.ts")).sort();
}

export interface FlowGateOptions {
  projectRoot: string;
  /** Os fluxos que ESTA fase entrega. Vazio significa nada a exercitar ainda. */
  workflows: SkeletonWorkflow[];
  /**
   * Os fluxos das fases JÁ CONCLUÍDAS — a regressão.
   *
   * Tem que ser uma lista explícita, e não o que houver no disco. Rodar tudo o
   * que existe cobra da fase 1 uma interface que só a fase 3 constrói, e no
   * MCP_teste ainda ressuscitou roteiros de um esqueleto anterior: a fase de
   * banco reprovava por não ter a tela de cadastro que nunca prometeu.
   */
  regressao?: SkeletonWorkflow[];
  /** Como a aplicação sobe. Sem isto não há o que abrir. */
  startCommand: string | null;
  /** Chama a sessão independente que redige o roteiro. */
  /**
   * Chama a sessão que redige o roteiro.
   *
   * O `baseUrl` vem do gate porque é o gate quem escolhe a porta — quem monta o
   * prompt não tem como saber qual delas sobrou livre nesta passagem.
   */
  author: (workflow: SkeletonWorkflow, rejected: string[], baseUrl: string, passagem: PassagemDoFluxo) => Promise<string>;
  runner?: FlowRunner;
  /**
   * Roda a migração declarada no banco NOVO da passagem.
   *
   * Só roda quando o banco da passagem é nosso — um arquivo que acabou de ser
   * criado. Migrar o banco do `.env` do desenvolvedor é o que o §46 promete que
   * nunca acontece.
   */
  executar?: (comando: string, cwd: string, env: Record<string, string>) => Promise<{ exitCode: number; output: string }>;
  /**
   * O executor declarou que o roteiro é que está errado, e por quê.
   *
   * Quando isto vem preenchido, o roteiro é reescrito ANTES de rodar, com o
   * motivo dele na mão de quem reescreve. É a alternativa a remodelar o produto
   * para caber num seletor — e ela se corrige sozinha: se o produto estiver
   * mesmo errado, o roteiro novo reprova igual.
   */
  roteiroContestado?: string;
  port?: number;
  /** Tentativas de redação por fluxo, contando a primeira. */
  maxDrafts?: number;
  announce?: (message: string) => void;
}

/** O que o roteirista precisa saber sobre a passagem em que o roteiro dele vai rodar. */
export interface PassagemDoFluxo {
  /** Os fluxos que rodam ANTES deste, na mesma passagem, e onde estão os roteiros deles. */
  anteriores: Array<{ number: string; name: string; arquivo: string }>;
  /** As chaves de ambiente cujo banco começa vazio a cada passagem. */
  bancoNovo: string[];
  /** A migração que o harness aplica nesse banco antes de a aplicação subir. */
  migracao: string | null;
  /** O arquivo do ajudante, relativo à pasta dos roteiros. */
  ajudante: string;
}

const executarNoShell = async (
  comando: string,
  cwd: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; output: string }> =>
  new Promise((resolve) => {
    const child = execFile("bash", ["-c", comando], { cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ exitCode: code, output: `${stdout}${stderr}` });
    });
    child.stdin?.end();
  });

export type FlowGateResult =
  /**
   * `output` é a saída crua do runner, quando ele chegou a correr.
   *
   * Ela precisa virar arquivo: o evento do run guarda só a primeira linha da
   * causa, e o painel some com o resto. Quando a fase 3 do MCP_teste reprovou
   * três vezes seguidas, não havia no disco uma linha do que o Playwright tinha
   * dito — e sem isso o diagnóstico vira adivinhação.
   */
  | { green: true; skipped: string; scripts: string[]; output?: string }
  | { green: false; cause: string; output?: string; toolMissing?: boolean; startupFailed?: boolean; scriptFailed?: boolean };

/**
 * A aplicação nem chegou a subir.
 *
 * As três formas que o runner usa para dizer isso — estourou o tempo, saiu
 * cedo, não conseguiu iniciar — têm em comum o nome da configuração. Distinguir
 * importa: no primeiro run real do gate, a fase 1 recebeu "um passo falhou onde
 * o usuário passaria" quando nenhum passo tinha rodado, porque o produto não
 * subiu. O executor foi mandado consertar o fluxo em vez do entrypoint.
 */
function falhouAoSubir(output: string): boolean {
  return /config\.webServer/.test(output);
}

/**
 * O que a PRÓPRIA aplicação registrou enquanto o roteiro rodava.
 *
 * O runner de fluxos prefixa a saída do servidor com `[WebServer]`, e ela some
 * no meio de quarenta linhas de rastro do Playwright. É a informação mais cara
 * do gate 4: quando a aplicação erra a cada requisição, todo passo do roteiro
 * falha por timeout esperando um elemento que nunca vai ser renderizado — e o
 * relatório acusa o seletor.
 *
 * Foi assim que uma configuração de banco ausente virou "a aplicação não cumpriu
 * um fluxo declarado", e o executor foi consertar um formulário que estava
 * certo.
 */
export function errosDoServidor(output: string): string[] {
  const vistos = new Set<string>();

  for (const linha of output.split("\n")) {
    if (!/^\s*\[WebServer\]/.test(linha)) continue;
    if (!/⨯|\bError\b|\bFATAL\b|Unhandled|ECONNREFUSED/.test(linha)) continue;
    const limpa = linha.replace(/^\s*\[WebServer\]\s*/, "").trim();
    // Rastro de pilha não acrescenta: o que decide é a mensagem.
    if (limpa === "" || /^at\s/.test(limpa)) continue;
    vistos.add(limpa);
  }

  return [...vistos].slice(0, 5);
}

/**
 * O erro do servidor é de esquema ausente?
 *
 * Vale a pergunta separada porque a resposta muda quem trabalha. "no such table"
 * não é a tela errada nem o seletor errado: é o banco sem estrutura, e o conserto
 * é a migração que o projeto declara. Sem dizer isso, o executor lê "um passo
 * falhou onde o usuário passaria" e vai mexer no formulário.
 */
export function ehEsquemaAusente(erros: readonly string[]): boolean {
  return erros.some((erro) =>
    /no such table|no such column|relation "[^"]+" does not exist|Table '[^']+' doesn't exist|ER_NO_SUCH_TABLE|undefined table/i.test(erro),
  );
}

/**
 * O gate inteiro: garante um roteiro por fluxo da fase e roda todos os que existem.
 *
 * Roda também os das fases anteriores porque um fluxo que passou a funcionar na
 * fase 2 e parou de funcionar na fase 5 é exatamente o defeito que ninguém pega
 * lendo código — e o roteiro para exercitá-lo já está escrito e pago.
 */
export async function gate4(options: FlowGateOptions): Promise<FlowGateResult> {
  const announce = options.announce ?? ((): void => {});
  const port = options.port ?? (await portaLivre());
  if (port !== FLOW_PORT) announce(`porta ${port} para subir a aplicação; a preferida estava ocupada`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const pasta = join(options.projectRoot, FLOWS_DIR);

  const regressao = options.regressao ?? [];
  if (options.workflows.length === 0 && regressao.length === 0) {
    return { green: true, skipped: "a fase não declara fluxos e nenhuma anterior deixou fluxo a revalidar", scripts: [] };
  }

  if (options.startCommand === null) {
    return {
      green: false,
      cause:
        "o gate 4 não sabe como subir a aplicação: o projeto não declara um entrypoint (`start`) " +
        "que o loop possa executar. Declare-o no manifesto para que os fluxos possam ser percorridos.",
    };
  }

  await mkdir(pasta, { recursive: true });

  /*
   * A ordem da passagem: a regressão primeiro, na ordem em que as fases a
   * cumpriram, e depois os fluxos desta fase. É a ordem em que os roteiros rodam
   * e, por isso, a ordem em que um pode contar com o estado do outro.
   */
  const ordem = [...regressao, ...options.workflows].filter(
    (workflow, indice, todos) => todos.findIndex((outro) => outro.number === workflow.number) === indice,
  );
  const bancos = await bancosDeclarados(options.projectRoot);
  const migracao = Object.keys(bancos).length > 0 ? await comandoDeMigracao(options.projectRoot) : null;
  const passagemDe = (workflow: SkeletonWorkflow): PassagemDoFluxo => {
    const posicao = ordem.findIndex((outro) => outro.number === workflow.number);
    return {
      anteriores: ordem
        .slice(0, Math.max(0, posicao))
        .map((anterior) => ({ number: anterior.number, name: anterior.name, arquivo: join(FLOWS_DIR, flowScriptName(anterior.number)) })),
      bancoNovo: Object.keys(bancos).sort(),
      migracao,
      ajudante: FLOW_HELPER,
    };
  };

  /*
   * Quem precisa de roteiro: os fluxos desta fase sem roteiro válido, e os da
   * regressão cujo roteiro foi escrito para o ambiente antigo. Um roteiro de
   * regressão AUSENTE continua não sendo escrito aqui — ver o filtro `noDisco`.
   */
  const aEscrever: SkeletonWorkflow[] = [];
  for (const workflow of ordem) {
    const daFase = options.workflows.some((atual) => atual.number === workflow.number);
    const existente = await readFile(join(pasta, flowScriptName(workflow.number)), "utf8").catch(() => null);
    if (existente === null) {
      if (daFase) aEscrever.push(workflow);
      continue;
    }
    if (!roteiroAtual(existente)) {
      aEscrever.push(workflow);
      continue;
    }
    if (daFase && checkFlowScript(existente, workflow).length > 0) aEscrever.push(workflow);
  }

  for (const workflow of aEscrever) {
    const arquivo = join(pasta, flowScriptName(workflow.number));
    let rejeitado: string[] = [];
    let gravado = false;
    const tentativas = options.maxDrafts ?? 2;
    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      announce(
        `roteiro do workflow ${workflow.number} (${workflow.name})` + (tentativa > 1 ? ` — tentativa ${tentativa}` : ""),
      );
      const script = extractFlowScript(await options.author(workflow, rejeitado, baseUrl, passagemDe(workflow)));
      const defeitos = checkFlowScript(script, workflow);
      if (defeitos.length === 0) {
        await writeFile(arquivo, comMarca(script), "utf8");
        gravado = true;
        break;
      }
      rejeitado = defeitos.map((defect) => `${defect.problem} — ${defect.hint}`);
    }

    if (!gravado) {
      return {
        green: false,
        cause:
          `o roteiro do workflow ${workflow.number} (${workflow.name}) não passou na conferência estrutural ` +
          `em ${tentativas} tentativas:\n${rejeitado.map((linha) => `- ${linha}`).join("\n")}`,
      };
    }
  }

  /*
   * Só os roteiros dos fluxos desta fase e das anteriores. O que estiver na
   * pasta e não pertencer a nenhum deles é resto de outro plano — rodá-lo
   * cobraria da fase um comportamento que ninguém prometeu nela.
   */
  const noDisco = new Set(await existingFlowScripts(options.projectRoot));
  const scripts = [...regressao, ...options.workflows]
    .map((workflow) => flowScriptName(workflow.number))
    .filter((nome, indice, todos) => todos.indexOf(nome) === indice && noDisco.has(nome));

  if (scripts.length === 0) return { green: true, skipped: "nenhum fluxo a percorrer", scripts: [] };

  await writeFile(join(pasta, FLOW_CONFIG), renderFlowConfig({ startCommand: options.startCommand, port, scripts }), "utf8");
  await writeFile(join(pasta, FLOW_HELPER), renderFlowHelper(), "utf8");

  const runner = options.runner ?? defaultFlowRunner;
  const executar = options.executar ?? executarNoShell;

  /*
   * Cada passagem num ambiente próprio, criado agora e apagado ao fim — inclusive
   * a segunda passagem depois de um roteiro reescrito, que não pode herdar o que a
   * primeira deixou.
   */
  const rodar = async (): Promise<FlowRun> => {
    const ambiente = await criarAmbienteDaPassagem(options.projectRoot, bancos);
    try {
      if (migracao !== null) {
        const migrou = await executar(migracao, options.projectRoot, ambiente.env);
        if (migrou.exitCode !== 0) {
          announce(`\`${migracao}\` falhou no banco novo da passagem (código ${migrou.exitCode}):\n${tail(migrou.output, 15)}`);
        }
      }
      return await runner(options.projectRoot, scripts, ambiente.env);
    } finally {
      await ambiente.limpar();
    }
  };

  announce(
    "passagem isolada: diretório pessoal descartável" +
      (Object.keys(bancos).length > 0 ? `, banco novo em ${Object.keys(bancos).sort().join(", ")}` : "") +
      (scripts.length > 1 ? `; ${scripts.length} roteiros em sequência` : ""),
  );

  /*
   * O executor contestou o roteiro: reescreve antes de rodar.
   *
   * Ele acabou de ler o produto e o erro do seletor, e é a única parte do ciclo
   * que viu os dois. Quem reescreve é outra sessão, que lê o produto de novo —
   * então a contestação não vira licença para ignorar o fluxo, só troca quem é
   * corrigido primeiro.
   */
  if (options.roteiroContestado) {
    announce(`o executor contestou o roteiro: ${options.roteiroContestado}`);
    for (const workflow of options.workflows) {
      const arquivo = join(pasta, flowScriptName(workflow.number));
      const script = extractFlowScript(
        await options.author(
          workflow,
          [`o executor diz que este roteiro está errado, e não o produto: ${options.roteiroContestado}`],
          baseUrl,
          passagemDe(workflow),
        ),
      );
      const defeitos = checkFlowScript(script, workflow);
      if (defeitos.length === 0) {
        await writeFile(arquivo, comMarca(script), "utf8");
        announce(`  roteiro do fluxo ${workflow.number} reescrito`);
      } else {
        announce(`  o roteiro reescrito do fluxo ${workflow.number} veio com defeito; mantive o anterior`);
      }
    }
  }

  let run = await rodar();

  /*
   * Falhou por culpa do roteiro? Reescreve e roda de novo, UMA vez.
   *
   * Sem isto, um seletor ambíguo custa um ciclo inteiro do executor mexendo num
   * produto que funciona — e o roteiro, que continua gravado, falharia de novo
   * no ciclo seguinte. Uma sessão de roteirista é muito mais barata que um ciclo
   * de correção, e é quem tem o defeito na mão.
   */
  if (run.exitCode !== 0 && run.toolMissing !== true && ehFalhaDoRoteiro(run.output)) {
    announce("o roteiro falhou por conta própria (seletor ambíguo ou erro de escrita); reescrevendo");

    for (const workflow of options.workflows) {
      const arquivo = join(pasta, flowScriptName(workflow.number));
      const script = extractFlowScript(
        await options.author(workflow, [`o roteiro anterior falhou assim:\n${tail(run.output, 25)}`], baseUrl, passagemDe(workflow)),
      );
      const defeitos = checkFlowScript(script, workflow);
      if (defeitos.length === 0) await writeFile(arquivo, comMarca(script), "utf8");
    }

    run = await rodar();
    if (run.exitCode !== 0 && ehFalhaDoRoteiro(run.output)) {
      return {
        green: false,
        scriptFailed: true,
        output: run.output,
        cause:
          "o roteiro do fluxo falhou por si mesmo duas vezes — seletor ambíguo ou erro de escrita, não defeito do " +
          `produto. Isto é do harness, não da sua implementação; o roteiro está em ${FLOWS_DIR}/.\n${tail(run.output)}`,
      };
    }
  }

  if (run.toolMissing === true) {
    return {
      green: false,
      toolMissing: true,
      output: run.output,
      cause:
        "o runner de fluxos não está instalado: o gate 4 abre a aplicação com @playwright/test. " +
        `Instale-o como dependência de desenvolvimento do projeto e garanta o navegador ` +
        `(\`npx playwright install chromium\`). Saída:\n${tail(run.output)}`,
    };
  }

  /*
   * Porta ocupada não é a aplicação falhando.
   *
   * Com a porta escolhida livre a cada passagem isto virou raro, mas a janela
   * entre escolher e abrir é real. Quando acontece, a causa precisa dizer que é
   * do ambiente: no `MCP_teste2` a mensagem "a aplicação NÃO SUBIU" mandou o
   * executor procurar defeito num produto que subia — no último ciclo dele.
   */
  if (run.exitCode !== 0 && /is already used|EADDRINUSE/i.test(run.output)) {
    return {
      green: false,
      startupFailed: true,
      output: run.output,
      cause:
        `a porta ${port} foi ocupada por outro processo entre a escolha e a subida, e o gate não chegou a abrir a ` +
        `aplicação. Isto é do ambiente, não do seu código: nada precisa ser corrigido na implementação.\n${tail(run.output)}`,
    };
  }

  if (run.exitCode !== 0 && falhouAoSubir(run.output)) {
    return {
      green: false,
      startupFailed: true,
      output: run.output,
      cause:
        `a aplicação NÃO SUBIU, e por isso nenhum fluxo chegou a ser percorrido — isto não é ` +
        `defeito dos fluxos.\n\nO gate 4 executa \`${options.startCommand}\` a partir da raiz do ` +
        `projeto, com PORT=${port} no ambiente, e espera http://127.0.0.1:${port} responder. ` +
        `O entrypoint precisa escutar na porta que vem em PORT e servir alguma resposta ali.` +
        `\n${tail(run.output)}`,
    };
  }

  if (run.exitCode !== 0) {
    /*
     * Quando o servidor registrou erro, ELE vem primeiro na causa.
     *
     * A ordem é o conserto: o executor lê o começo da mensagem e age. Deixar o
     * erro da aplicação enterrado na cauda do rastro é o mesmo que escondê-lo.
     */
    const doServidor = errosDoServidor(run.output);
    const cabecalho =
      doServidor.length > 0
        ? `A APLICAÇÃO registrou erro enquanto o roteiro rodava. Comece por aqui: um passo que espera um ` +
          `elemento falha por timeout quando a página nem chega a renderizar, e aí o seletor é o sintoma, ` +
          `não a causa.\n${doServidor.map((linha) => `  ${linha}`).join("\n")}\n` +
          (ehEsquemaAusente(doServidor)
            ? `\nIsto é ESQUEMA AUSENTE: o banco existe e as tabelas não. O harness aplica a migração que o ` +
              `projeto declara no manifesto (\`migrate\`) antes de cada passagem dos gates — então ou ela não ` +
              `está declarada, ou ela não cria estas tabelas. É ali que se corrige, não no roteiro nem na tela.\n`
            : "") +
          "\n"
        : "";

    return {
      green: false,
      output: run.output,
      cause:
        `${cabecalho}a aplicação não cumpriu um fluxo declarado — o roteiro rodou contra o produto de pé em ` +
        `http://127.0.0.1:${port} e reprovou. Isto não é teste de unidade: um passo falhou onde o ` +
        `usuário passaria.\n${tail(run.output)}`,
    };
  }

  return { green: true, skipped: "", scripts, output: run.output };
}

/** As últimas linhas, que é onde o playwright escreve o que falhou. */
function tail(output: string, lines = 40): string {
  return output.split("\n").slice(-lines).join("\n").trim();
}
