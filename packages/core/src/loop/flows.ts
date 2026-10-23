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
import { mkdir, readFile, readdir, realpath, rm, writeFile, stat } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve as resolvePath } from "node:path";
import type { SkeletonWorkflow } from "../contract/index.js";
import { FORA_DO_NAVEGADOR, extractFlowScript, lerForaDoNavegador, lerProvas, lerTriagem, stepLabel, type PassoSemProva, type ProvaCitada, type Triagem } from "../prompts/index.js";
import { comandoDeMigracao } from "./ambiente.js";
import { FLOW_HELPER, VARIAVEL_DO_INICIO, bancosDeclarados, criarAmbienteDaPassagem, renderFlowHelper } from "./passagem.js";
import { testeDotnetAprovado } from "./teste-declarado.js";
import { runtimeEnvironment } from "../provider/runtime-env.js";
import { portaLivre } from "./ports.js";
import { invalidFlowNetwork } from "./flow-network.js";
export { portaLivre } from "./ports.js";

/** Onde os roteiros moram, relativo à raiz do projeto. */
export const FLOWS_DIR = join(".capivara", "flows");

export const FLOW_CONFIG = "playwright.config.mjs";

/**
 * Onde o Playwright grava o que viu, relativo à pasta dos roteiros.
 *
 * O padrão dele é a pasta do `package.json` — a raiz do PRODUTO. No
 * `assistencia2` o `test-results/.last-run.json` foi parar no histórico da
 * aplicação. E é aqui que fica o retrato da página no instante da falha, que a
 * triagem lê: precisa de um lugar fixo, e do harness.
 */
export const FLOW_RESULTS = "resultados";

/**
 * A primeira linha de todo roteiro que o harness grava.
 *
 * Ela diz sob qual AMBIENTE o roteiro foi escrito. Até a v2 a passagem rodava
 * contra o banco e o diretório pessoal da máquina, os roteiros em paralelo, e o
 * roteirista não tinha como rodar um comando do projeto. Um roteiro escrito para
 * aquilo — que lê um arquivo que ninguém criou, ou conta com um estado que não
 * existe mais — reprova um produto certo. Sem a marca, o roteiro é reescrito uma
 * vez, e custa uma sessão de roteirista em vez de um ciclo do executor.
 *
 * A v3 (§109) é a do roteiro que pode reiniciar a aplicação. Os da v2 foram
 * escritos proibidos disso, e um deles — o fluxo 1 do `teste_haiku_v2` — trocou
 * o passo de reinício por uma anotação de pendência e passou sem executá-lo.
 */
export const FLOW_MARK = "// capivara-flow: v3 — passagem isolada, em sequência, com reinício";

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
export function checkFlowScript(
  script: string,
  workflow: SkeletonWorkflow,
  /**
   * Os nomes que a passagem anterior disse não existirem (`ReferenceError: x is
   * not defined`). Na P04 do `assistencia2` o roteirista recebeu o erro com a
   * linha, reescreveu, e devolveu o mesmo `${sufo}` — três vezes no mesmo run.
   */
  naoDefinidos: readonly string[] = [],
): FlowDefect[] {
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
  if (steps !== workflow.steps.length) {
    defects.push({
      problem: `o fluxo tem ${workflow.steps.length} passos e o roteiro declara ${steps} test.step`,
      hint: "um test.step por passo declarado, na ordem",
    });
  }

  const cases = [...script.matchAll(/(?<![\w$.])test\s*\(/g)].length;
  if (cases !== 1) {
    defects.push({
      problem: `o roteiro declara ${cases} caso de teste para um único fluxo`,
      hint: "somente um test para este fluxo; remova cenários adicionais e preserve os passos contratados",
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
   * Nenhum passo aprovado sem ser executado (§109).
   *
   * Proibido de reiniciar o servidor, o roteirista do fluxo 1 do `teste_haiku_v2`
   * trocou o passo por uma anotação de pendência e passou; o do fluxo 3 escreveu
   * `expect.soft(false)` e reprovou de propósito. Agora o reinício é possível, e
   * as duas saídas deixam de ser aceitas: asserção sobre uma constante não prova
   * nada do produto, e `CAPIVARA_REMARK` é do protocolo do auditor, não de um roteiro.
   */
  if (/\bexpect\s*(?:\.\s*soft\s*)?\(\s*(?:true|false)\s*[,)]/.test(script)) {
    defects.push({
      problem: "o roteiro afirma uma constante (`expect(true)` / `expect(false)`) em vez do produto",
      hint: "cada passo é executado de verdade e afirma o que o produto fez; para reiniciar o servidor, use `aplicacaoPropria` do ajudante",
    });
  }
  if (/CAPIVARA_REMARK|type:\s*['"`]pendente['"`]/.test(script)) {
    defects.push({
      problem: "o roteiro marca um passo como pendente em vez de executá-lo",
      hint: "nenhum passo é aprovado sem ser executado; percorra o passo — subir, parar e reiniciar a aplicação é possível com `aplicacaoPropria`",
    });
  }

  /*
   * `comandoDoProjeto` espera o comando terminar, e um servidor não termina: o
   * passo ficaria parado até o prazo do ajudante. Subir, parar e reiniciar a
   * aplicação é com `aplicacaoPropria` (§109), que espera ela responder e a
   * encerra de verdade.
   */
  if (/comandoDoProjeto\s*\([^)]*['"`](?:start|dev|serve|preview)['"`]/.test(script)) {
    defects.push({
      problem: "o roteiro sobe a aplicação com `comandoDoProjeto`, que espera o comando terminar",
      hint: "para subir, parar ou reiniciar a aplicação, use `aplicacaoPropria()` do ajudante: ela devolve `url`, `reiniciar()` e `encerrar()`",
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

  /*
   * Interceptar a própria API transforma o gate em teatro: a tela passa a ser
   * exercitada contra respostas inventadas pelo roteiro.
   *
   * Mas o serviço de TERCEIRO pode ser substituído — o prompt diz isso. A regra
   * olhava só se a URL continha `/api/`, e `https://brasilapi.com.br/api/cep/...`
   * contém: na P06 do `assistencia2` o roteirista substituiu a consulta de CEP,
   * certo, e foi recusado em todas as tentativas de todos os ciclos. URL absoluta
   * para outro host é de terceiro; relativa, glob ou local é do produto.
   */
  /*
   * Percorrer o fluxo é rodar o PRODUTO, não a suíte de testes dele (§134). Na
   * revisão adversarial, um roteiro "de terminal" num desktop rodava
   * `dotnet test --filter …` passo a passo e virava PASS de percurso — filtro que
   * não casa nada, ou só teste pulado, também sai com código 0.
   */
  if (rodaASuite(script)) {
    defects.push({
      problem: "o roteiro roda a suíte de testes do projeto em vez de percorrer o fluxo",
      hint: "percorra o fluxo rodando os comandos do próprio produto e afirmando o que ele faz; a suíte já roda no gate 2",
    });
  }

  if (invalidFlowNetwork(script)) {
    defects.push({
      problem: "o roteiro intercepta o backend do próprio produto",
      hint: "não fabricar respostas com fulfill/HAR. Para carregamento, segure e libere GET com continue; para indisponibilidade, aborte somente GET. Lista vazia e contagens usam dados reais da passagem; só serviço de terceiro pode ter resposta substituída",
    });
  }

  for (const nome of naoDefinidos) {
    if (usaSemDeclarar(script, nome)) {
      defects.push({
        problem: `o roteiro usa \`${nome}\`, que não existe — a passagem anterior morreu em \`ReferenceError: ${nome} is not defined\``,
        hint: `declare \`${nome}\` antes de usá-lo, ou use o nome que o roteiro de fato declara`,
      });
    }
  }

  return defects;
}

/**
 * O roteiro roda a suíte de testes do projeto? (§134) O `comandoDoProjeto` roda um
 * executável sem shell, e o fluxo se percorre pelo produto: a ferramenta de teste
 * com `test` como primeiro argumento (`dotnet test`, `npm test`/`t`, `go test`,
 * `cargo test`/`t`, `make test`), o runner de teste chamado direto, um shell com
 * `-c`, ou um argumento que aponta um projeto ou pasta de teste.
 */
function rodaASuite(script: string): boolean {
  const suiteNoTexto = /\b(?:dotnet|npm|pnpm|yarn|bun|go|cargo|make|just|rake|mvn|gradle\w*|composer|swift|mix|flutter)\s+(?:t|test|tests|tst|vstest)\b|\b(?:pytest|vitest|jest|mocha|phpunit|pest|rspec)\b|python\d?\s+-m\s+(?:pytest|unittest)/u;
  for (const chamada of script.matchAll(/comandoDoProjeto\s*\(\s*(['"`])([^'"`]+)\1\s*(?:,\s*\[([^\]]*)\])?/gu)) {
    const ferramenta = (chamada[2] ?? "").split("/").pop()!.toLowerCase();
    const argumentos = [...(chamada[3] ?? "").matchAll(/(['"`])((?:(?!\1).)*)\1/gu)].map((argumento) => argumento[2] ?? "");
    // Um shell só roda a suíte quando o `-c` dele a chama; `bash install.sh` é passo do produto.
    if (/^(?:bash|sh|zsh|dash|fish|cmd|cmd\.exe|pwsh|powershell)$/u.test(ferramenta)) {
      if (argumentos.some((argumento) => suiteNoTexto.test(argumento))) return true;
      continue;
    }
    if (/^(?:pytest|py\.test|vitest|jest|mocha|ava|tap|phpunit|pest|paratest|rspec|vstest\.console)$/u.test(ferramenta)) return true;
    const primeiro = argumentos.find((argumento) => !argumento.startsWith("-")) ?? "";
    if (/^(?:dotnet|npm|pnpm|yarn|bun|deno|go|cargo|make|just|rake|gradle|gradlew|mvn|mvnw|composer|swift|mix|flutter|dart)$/u.test(ferramenta) && /^(?:t|test|tests|tst|vstest|check|verify)$|^test:/u.test(primeiro)) return true;
    // `npm run test:unit`, `yarn run test`; e o script do projeto chamado com `test` (`./build.sh test`).
    if (/^(?:npm|pnpm|yarn|bun)$/u.test(ferramenta) && primeiro === "run" && /^test(?::|$)/u.test(argumentos[argumentos.indexOf(primeiro) + 1] ?? "")) return true;
    if (/\.(?:sh|bash|ps1|cmd|bat)$/u.test(ferramenta) && /^(?:t|test|tests)$/u.test(primeiro)) return true;
    if (/^python\d?(?:\.\d+)?$/u.test(ferramenta) && argumentos[0] === "-m" && /^(?:pytest|unittest|nose2?)$/u.test(argumentos[1] ?? "")) return true;
    // A ferramenta de execução apontada para um projeto ou script de teste (`dotnet run --project tests/X.Tests`, `node tests/x.test.js`).
    if (/^(?:dotnet|node|deno|bun|python\d?(?:\.\d+)?|go|java|ruby|php)$/u.test(ferramenta) &&
      argumentos.some((argumento) => /\.Tests?(?:\.(?:cs|fs|vb)proj)?\/?$|(?:^|\/)(?:tests?|specs?|__tests__)\/[^ ]*\.(?:(?:cs|fs|vb)proj|[cm]?[jt]s|py|go|rb|php|java)$|[._-](?:test|spec)\.[cm]?[jt]s$/u.test(argumento))) return true;
  }
  return false;
}

/** Os nomes que o runner disse não existirem. */
export function nomesNaoDefinidos(output: string): string[] {
  return [...new Set([...output.matchAll(/ReferenceError: ([A-Za-z_$][\w$]*) is not defined/g)].map((casou) => casou[1] ?? ""))].filter(
    (nome) => nome !== "",
  );
}

/**
 * O nome aparece e nenhuma declaração o introduz.
 *
 * Deliberadamente conservador: qualquer forma de declaração — variável, função,
 * classe, import, parâmetro, desestruturação — absolve o nome. Recusar um roteiro
 * certo custaria uma sessão; deixar passar um errado custa o que já custava.
 */
function usaSemDeclarar(script: string, nome: string): boolean {
  const n = nome.replace(/\$/g, "\\$");
  if (!new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(script)) return false;
  const declaracoes = [
    new RegExp(`\\b(?:const|let|var|function|class)\\s+${n}(?![\\w$])`),
    new RegExp(`\\b(?:const|let|var)\\s*[\\[{][^=]*(?<![\\w$])${n}(?![\\w$])[^=]*[\\]}]\\s*=`),
    new RegExp(`\\bimport\\b[^;]*(?<![\\w$])${n}(?![\\w$])[^;]*\\bfrom\\b`),
    new RegExp(`\\(([^()]*[,\\s{(])?${n}(?![\\w$])[^()]*\\)\\s*(?:=>|\\{)`),
    new RegExp(`(?<![\\w$.])${n}\\s*=>`),
  ];
  return !declaracoes.some((padrao) => padrao.test(script));
}

/**
 * A configuração que o LOOP escreve, não o modelo.
 *
 * Quem sobe a aplicação e onde ela responde é decisão do harness: se o roteiro
 * pudesse escolher, um roteiro poderia apontar para outro lugar e passar sem
 * nunca tocar no produto construído.
 */
export function renderFlowConfig(options: {
  /** `null`: nenhum roteiro da passagem abre a aplicação (§134) — sem `webServer`, nada sobe. */
  startCommand: string | null;
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
    `  outputDir: './${FLOW_RESULTS}',`,
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
    ...(options.startCommand === null ? ["};", ""] : servidorDoGate(options.startCommand, url, options.port, options.timeoutSeconds)),
  ].join("\n");
}

/** Como o gate sobe a aplicação que o roteiro abre. */
function servidorDoGate(startCommand: string, url: string, port: number, timeoutSeconds: number | undefined): string[] {
  return [
    "  webServer: {",
    `    command: ${JSON.stringify(startCommand)},`,
    `    url: '${url}',`,
    "    reuseExistingServer: false,",
    `    timeout: ${(timeoutSeconds ?? 180) * 1000},`,
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
    `    env: { PORT: '${port}', HOST: '127.0.0.1' },`,
    /*
     * A saída da aplicação entra na do gate (§111). O padrão do runner é jogar o
     * stdout fora: no `build-6e34384deccd` a aplicação escreveu "Parallel Lab em
     * http://127.0.0.1:3000" — ela lia `PORTA`, não `PORT` — e o gate só soube
     * dizer "Timed out waiting 180000ms", no último ciclo da P04.
     */
    "    stdout: 'pipe',",
    "    cwd: '../..',",
    "  },",
    "};",
    "",
  ];
}

/**
 * O roteiro abre a aplicação servida? (§134)
 *
 * O roteiro de um programa de terminal percorre o fluxo só com `comandoDoProjeto`:
 * não abre página, não fala HTTP, não sobe instância. Para ele o gate não sobe
 * servidor — subir um CLI como `webServer` é esperar uma porta que ele nunca abre.
 * Qualquer sinal de navegador, de requisição ou de endereço, ou uma assinatura que
 * não se lê, mantém o servidor: na dúvida, o roteiro roda como sempre rodou.
 */
export function roteiroUsaOServidor(script: string): boolean {
  // Sinais de página, de requisição ao produto ou de HTTP na própria máquina — em qualquer lugar do roteiro.
  // Outro esquema local (`postgres://localhost/agenda`) é argumento de um CLI, não servidor do produto.
  if (/aplicacaoPropria|https?:\/\/(?:localhost|127\.0\.0\.1)\b|\bbaseURL\b|\bnewContext\b|\bnewPage\b|\bfetch\s*\(|\bgoto\s*\(|\b(?:chromium|firefox|webkit)\s*\.|\.\s*(?:page|browser|context|request)\b|\bpage\s*\./u.test(script)) return true;
  // Toda fixture desestruturada — a do teste e a dos ganchos (`beforeEach`, `beforeAll`…).
  for (const fixtures of script.matchAll(/\(\s*\{([^}]*)\}[^)]*\)\s*=>|function\s*[\w$]*\s*\(\s*\{([^}]*)\}/gu)) {
    if (/\b(?:page|request|context|browser|baseURL)\b/u.test(fixtures[1] ?? fixtures[2] ?? "")) return true;
  }
  // E o teste com assinatura legível, sem fixture nenhuma; qualquer outra forma roda como sempre rodou.
  const titulo = String.raw`(?:` + "`(?:[^`\\\\]|\\\\.)*`" + String.raw`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")`;
  const semFixture = new RegExp(String.raw`(?<![\w$.])test\s*\(\s*` + titulo + String.raw`\s*,\s*(?:\{[^{}]*\}\s*,\s*)?async\s*(?:function\s*[\w$]*\s*)?\(\s*(?:\{\s*\})?\s*\)`, "u");
  return !semFixture.test(script);
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
  /*
   * Só as linhas do RUNNER. As que começam com `[WebServer]` são da aplicação, e
   * um `TypeError: x is not a function` dela é defeito do produto — lido junto,
   * mandava reescrever um roteiro que estava certo.
   */
  const doRunner = output
    .split("\n")
    .filter((linha) => !/^\s*\[WebServer\]/.test(linha))
    .join("\n");
  /*
   * `ReferenceError`: na P04 do `assistencia2` o roteirista escreveu `${sufo}`
   * por `${sufixo}`, e o roteiro morreu antes do primeiro passo — cobrado do
   * produto.
   */
  return /strict mode violation|resolved to \d+ elements|Cannot find name|SyntaxError|Unexpected token|is not a function|Cannot read propert|ReferenceError|is not defined/i.test(
    doRunner,
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
    /Cannot find module ['"`][^'"`\n]*[\\/]@playwright[\\/]test[\\/]cli\.js/i,
    /Please install @playwright\/test/i,
    // O navegador, que é metade do runner: sem ele nada abre.
    /npx playwright install/i,
    /Executable doesn't exist at/i,
  ].some((padrao) => padrao.test(output));
}

/**
 * Playwright, rodado pelo loop.
 *
 * Resolve apenas a ferramenta já preparada no preflight. Nenhuma instalação
 * implícita durante o gate. A instalação privada é a mais próxima dos roteiros
 * e deve fornecer também o CLI, evitando duas versões do Playwright no processo.
 */
export const defaultFlowRunner: FlowRunner = async (projectRoot, scripts, env = {}) => {
  projectRoot = resolvePath(projectRoot);
  const local = join(projectRoot, "node_modules/@playwright/test/cli.js");
  const tools = join(projectRoot, ".capivara/node_modules/@playwright/test/cli.js");
  const cli = await stat(tools).then(() => tools, () => local);
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [cli, "test", "--config", FLOW_CONFIG, ...scripts],
      { cwd: join(projectRoot, FLOWS_DIR), maxBuffer: 32 * 1024 * 1024, env: runtimeEnvironment({ ...process.env, ...env, CI: "1" }) },
      (error, stdout, stderr) => {
        const saida = `${stdout}${stderr}`;
        const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        const ausente = faltaORunner(saida, code);
        resolve({ exitCode: code, output: saida, ...(ausente ? { toolMissing: true } : {}) });
      },
    );
    child.stdin?.end();
  });
};

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
  /**
   * Os fluxos cujos roteiros falharam na passagem que o executor contestou.
   *
   * A contestação reescrevia só os roteiros DA FASE. Na P04 do `assistencia2`
   * quem falhava era o roteiro de regressão da P02, o executor contestou certo
   * duas vezes, e as duas reescritas foram para os roteiros que nem tinham rodado.
   * Sem esta lista, vale o comportamento antigo.
   */
  roteirosQueFalharam?: string[];
  /**
   * A triagem: devolve o texto cru da sessão que decide de quem é a falha.
   *
   * Sem ela, o gate faz o que fazia antes — o rastro vai ao executor.
   */
  triagem?: (entrada: EntradaDaTriagem) => Promise<string>;
  port?: number;
  /**
   * A porta tentada primeiro, quando não é a de sempre.
   *
   * No build paralelo (§97) cada agente prefere uma porta diferente: dois gates
   * 4 que testassem a mesma porta livre ao mesmo tempo achariam-na livre os dois,
   * e o segundo servidor a subir encontraria a porta tomada.
   */
  preferredPort?: number;
  /** Tentativas de redação por fluxo, contando a primeira. */
  maxDrafts?: number;
  /**
   * O contrato que o roteirista leu — o compartilhado e o da fase (§133).
   *
   * É contra ele que se confere o trecho de quem diz que o produto não se usa num
   * navegador. Sem ele, a marca não é aceita: nenhum fluxo sai da cobrança por
   * uma frase que ninguém pôde conferir.
   */
  contratoCertificado?: string;
  /**
   * Os fluxos que alguma fase já percorreu num navegador — todos, não só a
   * regressão que esta passagem roda (§133). Para eles a marca não vale.
   */
  jaPercorridos?: readonly string[];
  /**
   * Sem `start`, perguntar de novo ao roteirista se o fluxo se percorre num
   * navegador, antes de cobrar o entrypoint. O runner liga uma vez por fase (§133).
   */
  confirmarSemStart?: boolean;
  /** Os fluxos que já avançaram passos no navegador numa passagem anterior desta fase (§134): para eles a marca não vale. */
  jaAbertos?: readonly string[];
  /** O próximo ciclo substitui estes roteiros antes de executá-los outra vez. */
  rejectedScripts?: readonly string[];
  announce?: (message: string) => void;
}

/** O que a triagem recebe de UM roteiro que falhou. */
export interface EntradaDaTriagem {
  workflow: SkeletonWorkflow;
  script: string;
  failure: string;
  snapshot: string;
  serverErrors: string[];
}

/**
 * O retrato da página no instante de cada falha, por roteiro.
 *
 * O Playwright grava um `error-context.md` por teste que falhou, com a árvore de
 * acessibilidade da página. O roteiro é identificado pela linha `Location`, e não
 * pelo nome da pasta, que o Playwright encurta e sanitiza.
 */
export async function retratosDaFalha(projectRoot: string): Promise<Map<string, string>> {
  const base = join(projectRoot, FLOWS_DIR, FLOW_RESULTS);
  const retratos = new Map<string, string>();
  const pastas = await readdir(base).catch(() => [] as string[]);
  for (const pasta of pastas) {
    const contexto = await readFile(join(base, pasta, "error-context.md"), "utf8").catch(() => null);
    if (contexto === null) continue;
    const roteiro = /Location:\s*([^\s:]+\.spec\.ts)/.exec(contexto)?.[1];
    const retrato = /#\s*Page snapshot\s*```(?:yaml)?\n([\s\S]*?)```/.exec(contexto)?.[1];
    if (roteiro && retrato && !retratos.has(roteiro)) retratos.set(roteiro, retrato.trim());
  }
  return retratos;
}

/** O que a triagem disse, como o executor precisa ler. */
export function causaDaTriagem(triagem: Triagem, rastro: string): string {
  const titulo =
    triagem.tipo === "PRODUTO"
      ? "O gate 4 reprovou e a triagem diz que o defeito é do PRODUTO. Corrija isto:"
      : triagem.tipo === "CRITERIO"
        ? "O gate 4 reprovou e a triagem diz que o CRITÉRIO não decide o caso. Vale esta leitura, que ficou " +
          "registrada em .capivara/decisoes-do-build.md para o desenvolvedor revisar:"
        : "O gate 4 identificou um defeito no ROTEIRO. A implementação deve ser preservada; " +
          "a correção abaixo pertence ao teste do harness:";
  return [
    titulo,
    "",
    `- evidência: ${triagem.evidencia || "—"}`,
    `- onde: ${triagem.onde || "—"}`,
    `- critério: ${triagem.criterio || "—"}`,
    `- correção: ${triagem.correcao}`,
    "",
    "O rastro do runner, para conferir:",
    rastro,
  ].join("\n");
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
    const child = execFile("bash", ["-c", comando], { cwd, env: runtimeEnvironment({ ...process.env, ...env }), maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ exitCode: code, output: `${stdout}${stderr}` });
    });
    child.stdin?.end();
  });

/**
 * Os fluxos cujos roteiros FALHARAM, lidos da saída do Playwright.
 *
 * Só os que falharam: um roteiro que "não rodou" porque o anterior falhou não
 * tem defeito nenhum conhecido. Devolve números de workflow.
 */
export function fluxosQueFalharam(output: string, workflows: readonly SkeletonWorkflow[]): string[] {
  const falhos = new Set<string>();
  for (const linha of output.split("\n")) {
    if (!/^\s*(?:✘|×|\d+\))\s/.test(linha)) continue;
    const casou = /\b(workflow-[^\s/\\›]+?\.spec\.ts):\d+/.exec(linha);
    if (!casou) continue;
    const dono = workflows.find((workflow) => flowScriptName(workflow.number) === casou[1]);
    if (dono) falhos.add(dono.number);
  }
  return workflows.filter((workflow) => falhos.has(workflow.number)).map((workflow) => workflow.number);
}

/**
 * O passo do roteiro em que o fluxo falhou, lido da saída do Playwright
 * (`… › workflow-3.spec.ts:23:1 › … › passo 1: Cadastrar…`) — determinístico,
 * ao contrário do endereço que a triagem escreve em prosa (§127).
 */
export function passoQueFalhou(output: string, workflow: string): number | null {
  const arquivo = flowScriptName(workflow);
  for (const linha of output.split("\n")) {
    if (!linha.includes(arquivo)) continue;
    const casou = /›\s*passo\s+(\d+)(?:\s*:|\s*$)/iu.exec(linha);
    if (casou) return Number(casou[1]);
  }
  return null;
}

/** O que o roteirista ouve quando o projeto não tem `start` e o roteiro já existe (§133). */
export const MOTIVO_SEM_START =
  "o projeto ainda não declara um entrypoint `start`, e este roteiro abre a aplicação servida por HTTP: " +
  "se o contrato diz que o produto se usa num terminal, devolva o roteiro percorrendo o fluxo só com `comandoDoProjeto`, sem página (§134); " +
  `se ele não se usa nem num navegador nem num terminal, responda com a linha ${FORA_DO_NAVEGADOR} e a prova de cada passo; ` +
  "se ele se usa num navegador, devolva o roteiro como está (o executor declara o `start`)";

/** O fluxo que o gate não percorreu porque o contrato põe o produto fora do navegador (§133). */
export interface NaoPercorrido {
  number: string;
  /** A passagem do contrato que o roteirista citou, conferida. */
  trecho: string;
  /** Os testes da suíte que o roteirista citou como prova de cada passo (§134) — ainda não conferidos. */
  provas?: ProvaCitada[];
  /** Os passos que ele disse não ter teste que os exercite, e por quê (§134). */
  semProva?: PassoSemProva[];
}

/** Código-fonte de teste. Documento, dado, fixture ou relatório não é teste que rode. */
const FONTE_DE_TESTE = /\.(?:cs|fs|vb|py|go|rs|php|[cm]?[jt]sx?|rb|java|kts?|scala|swift|dart|exs?|cljs?|lua|c|cc|cpp|cxx|m|mm)$/iu;

/** O que o relatório TRX do G2 cobre: os testes .NET (§134). */
const FONTE_DOTNET = /\.(?:cs|fs|vb)$/iu;

/**
 * Onde não mora a suíte do projeto: o harness, dependências e ambientes virtuais
 * em qualquer profundidade, a saída de build do .NET em qualquer projeto, e as
 * pastas de build na raiz — um pacote Go chamado `build` continua sendo do projeto.
 */
const FORA_DA_SUITE = /(?:^|\/)(?:\.capivara|\.git|node_modules|vendor|\.?venv|site-packages|TestResults|obj)(?:\/|$)|(?:^|\/)bin\/(?:Debug|Release)(?:\/|$)|^(?:target|dist|build|bin)\//u;

/**
 * O teste citado como prova de um passo rodou e passou nesta execução da suíte? (§134)
 *
 * Devolve o motivo da recusa, ou `null`. O roteirista julga se o teste exercita o
 * passo; o Core confere que ele é do projeto e que o RUNNER relatou que ele rodou e
 * passou — `testes` é o que o relatório da suíte disse, teste a teste, sobre esta
 * árvore (`lerResultadosDotnet`). Ler o código não basta: três revisões
 * adversariais acharam, a cada rodada, um teste pulado que a leitura dava como
 * ativo. Hoje o relatório por teste existe para o .NET (TRX); nas outras suítes o
 * runner não o dá sem mudar o comando do projeto, e a citação é recusada — o
 * passo fica pendente e nomeado, nunca aprovado.
 *
 * O caminho é resolvido de verdade (link simbólico incluído) e tem de ficar dentro
 * do projeto, fora do harness, das dependências e da saída de build.
 */
export async function conferirCitacao(projectRoot: string, prova: ProvaCitada, testes?: ReadonlyMap<string, boolean> | null, suite?: string | null): Promise<string | null> {
  const citado = `${prova.arquivo} :: ${prova.teste}`;
  const arquivo = prova.arquivo.trim().replace(/^[`"']+|[`"']+$/g, "").replace(/\\/g, "/").replace(/^\.\//u, "");
  const normal = posix.normalize(arquivo);
  if (arquivo === "" || isAbsolute(arquivo) || /^[A-Za-z]:\//u.test(arquivo) || normal.startsWith("../") || normal === "..") return `a citação ${citado} aponta para fora do projeto`;
  if (FORA_DA_SUITE.test(normal)) return `a citação ${citado} aponta para um arquivo do harness, de dependência ou de build, não da suíte do projeto`;
  if (!FONTE_DE_TESTE.test(normal)) return `a citação ${citado} não é um arquivo de teste: a prova de um passo é um teste da suíte, não um documento ou um dado`;
  if (!FONTE_DOTNET.test(normal)) {
    return `a citação ${citado} é de uma suíte que não relata, teste a teste, o que rodou e passou: a prova pela suíte exige esse relatório do runner, e hoje ele existe para o .NET`;
  }
  const raiz = await realpath(projectRoot).catch(() => resolvePath(projectRoot));
  const real = await realpath(join(projectRoot, normal)).catch(() => null);
  if (real === null) return `o arquivo citado em ${citado} não existe no projeto`;
  const relativoReal = posix.normalize(relative(raiz, real).replace(/\\/g, "/"));
  if (relativoReal.startsWith("../") || isAbsolute(relativoReal) || FORA_DA_SUITE.test(relativoReal)) return `a citação ${citado} aponta para fora do projeto`;
  const conteudo = await readFile(real, "utf8").catch(() => null);
  if (conteudo === null) return `o arquivo citado em ${citado} não existe no projeto`;
  if (testes === undefined || testes === null) {
    return `a suíte não relatou quais testes rodaram nesta execução: ${citado} não tem prova de execução — o relatório TRX vem do \`dotnet test\` que o harness resolve, não de \`npm test\`, \`--test-cmd\` ou \`CAPIVARA_TEST_CMD\``;
  }
  // O arquivo tem de estar num projeto de teste que o comando rodou: o que fica fora não compila, nem roda.
  const projetos = [...(suite ?? "").matchAll(/dotnet\s+test\s+(?:--project\s+)?(?:'([^']+)'|"([^"]+)"|(\S+\.(?:cs|fs|vb)proj))/gu)].map((casou) => posix.normalize(posix.dirname(casou[1] ?? casou[2] ?? casou[3] ?? "")));
  if (projetos.length > 0 && !projetos.some((pasta) => pasta === "." || normal.startsWith(`${pasta}/`))) {
    return `${citado}: o arquivo está fora dos projetos de teste que a suíte rodou`;
  }
  const recusa = testeDotnetAprovado(conteudo, posix.extname(normal).slice(1), prova.teste, testes);
  return recusa === null ? null : `${citado}: ${recusa}`;
}

const SEM_SUITE = "nenhuma suíte do projeto rodou verde neste código, e só o teste que roda prova um passo";

/**
 * O que a suíte prova do fluxo que não se percorre (§134): cada passo com um teste
 * citado e conferido, ou nomeado sem prova, com o porquê.
 *
 * `suite` é o comando que passou NESTE código, no G2; sem ele, nenhuma citação vale
 * — teste que não rodou verde no código de agora não é prova de nada. Compilar,
 * abrir ou a suíte verde sozinha não provam passo nenhum: cada um precisa do seu
 * teste. O passo sem prova não vira defeito do produto nem pedido ao executor: é
 * a pendência que a guarda final nomeia.
 */
export async function conferirProvas(
  projectRoot: string,
  workflow: SkeletonWorkflow,
  citadas: { provas?: readonly ProvaCitada[]; semProva?: readonly PassoSemProva[] },
  suite: string | null,
  /** O que o relatório da suíte disse, teste a teste, sobre esta árvore; `null` sem relatório. */
  testes: ReadonlyMap<string, boolean> | null = null,
): Promise<{ provas: ProvaCitada[]; semProva: PassoSemProva[] }> {
  const provas: ProvaCitada[] = [];
  const semProva: PassoSemProva[] = [];
  for (let passo = 1; passo <= workflow.steps.length; passo += 1) {
    const dele = (citadas.provas ?? []).filter((prova) => prova.passo === passo);
    const disse = (citadas.semProva ?? []).find((sem) => sem.passo === passo)?.motivo;
    if (suite === null) {
      // A mesma frase de uma resposta refeita não se aninha: a decisão que não mudou não é registrada de novo.
      semProva.push({ passo, motivo: disse === undefined || disse.startsWith(SEM_SUITE) ? disse ?? SEM_SUITE : `${SEM_SUITE} (${disse})` });
      continue;
    }
    const recusas: string[] = [];
    let aceita: ProvaCitada | null = null;
    for (const prova of dele) {
      const recusa = await conferirCitacao(projectRoot, prova, testes, suite);
      if (recusa === null) {
        aceita = prova;
        break;
      }
      recusas.push(recusa);
    }
    if (aceita !== null) provas.push(aceita);
    else semProva.push({ passo, motivo: recusas.length > 0 ? recusas.join("; ") : disse ?? "nenhum teste da suíte foi citado para ele" });
  }
  return { provas, semProva };
}

export type FlowGateResult =
  /**
   * `output` é a saída crua do runner, quando ele chegou a correr.
   *
   * Ela precisa virar arquivo: o evento do run guarda só a primeira linha da
   * causa, e o painel some com o resto. Quando a fase 3 do MCP_teste reprovou
   * três vezes seguidas, não havia no disco uma linha do que o Playwright tinha
   * dito — e sem isso o diagnóstico vira adivinhação.
   */
  | { green: true; skipped: string; scripts: string[]; output?: string; naoPercorridos?: NaoPercorrido[]; perguntouSemStart?: boolean; abertos?: string[] }
  | {
      green: false;
      cause: string;
      output?: string;
      /** Fora do navegador, mesmo quando outro fluxo reprovou: a pendência é registrada de qualquer forma. */
      naoPercorridos?: NaoPercorrido[];
      /** A pergunta sem `start` chegou ao roteirista nesta passagem (§133): só então ela se gasta. */
      perguntouSemStart?: boolean;
      /** Os fluxos que avançaram passos no navegador nesta chamada (§134). */
      abertos?: string[];
      /** O veredito da triagem, quando ela correu e foi legível. */
      triagem?: Triagem;
      toolMissing?: boolean;
      startupFailed?: boolean;
      scriptFailed?: boolean;
      /** Os fluxos cujos roteiros falharam — é o que uma contestação vai reescrever. */
      falharam?: string[];
    };

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
 * As portas que a saída diz estarem em uso, quando ela diz (§107).
 *
 * "Porta ocupada" não basta para saber de quem é a falha: no `build-96756ca336b0`
 * o `EADDRINUSE` era da APLICAÇÃO, em 127.0.0.1:3001 — ela ignorava a `PORT` do
 * gate —, e o gate o atribuiu à porta dele, 47535, e ao ambiente. A porta vem do
 * fim da linha que acusa o uso: `listen EADDRINUSE: … 127.0.0.1:3001` no Node,
 * `http://127.0.0.1:47535 is already used` no Playwright. Linha sem número não
 * entra: sem porta, não há atribuição.
 */
export function portasEmUso(output: string): number[] {
  const portas = new Set<number>();
  for (const linha of output.split("\n")) {
    if (!/EADDRINUSE|address already in use|is already used/i.test(linha)) continue;
    const ultima = [...linha.matchAll(/:(\d{1,5})(?!\d)/g)].at(-1)?.[1];
    const porta = Number(ultima);
    if (ultima !== undefined && porta > 0 && porta < 65536) portas.add(porta);
  }
  return [...portas];
}

/**
 * As portas que a PRÓPRIA aplicação anunciou na saída (§111).
 *
 * Quando ela escuta noutra porta, o runner espera a do gate até estourar o
 * tempo, e a única pista é o que a aplicação escreveu ao subir: um endereço
 * (`http://127.0.0.1:3000`) ou "port 3000" / "porta 3000". Só as linhas
 * `[WebServer]`: as do runner trazem a URL do próprio gate.
 */
export function portasAnunciadas(output: string): number[] {
  const portas = new Set<number>();
  for (const linha of output.split("\n")) {
    if (!/^\s*\[WebServer\]/.test(linha)) continue;
    for (const casou of linha.matchAll(/\bhttps?:\/\/[^\s/:]+:(\d{1,5})(?!\d)|\bport[a]?\b\D{0,3}(\d{2,5})(?!\d)/gi)) {
      const porta = Number(casou[1] ?? casou[2]);
      if (porta > 0 && porta < 65536) portas.add(porta);
    }
  }
  return [...portas];
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
  const naoPercorridos: NaoPercorrido[] = [];
  const sinais: SinaisDaPassagem = { perguntouSemStart: false, abertos: new Set<string>() };
  const resultado = await percorrerFluxos(options, naoPercorridos, sinais);
  const abertos = [...sinais.abertos].filter((numero) => !(options.jaAbertos ?? []).includes(numero));
  return {
    ...resultado,
    ...(naoPercorridos.length > 0 ? { naoPercorridos } : {}),
    ...(sinais.perguntouSemStart ? { perguntouSemStart: true } : {}),
    ...(abertos.length > 0 ? { abertos } : {}),
  };
}

interface SinaisDaPassagem {
  perguntouSemStart: boolean;
  abertos: Set<string>;
}

/**
 * A linha citada diz que o produto se usa num navegador, e nada de nativo,
 * terminal ou biblioteca nela? (§134)
 *
 * Com a prova pela suíte, a marca deixou de ser só pendência: tirar do navegador
 * um fluxo web e citar testes o concluía sem nunca abrir a aplicação. Na revisão
 * adversarial, o roteirista citou a própria linha "usada no navegador" e o build
 * fechou com código 0. A linha que declara o navegador não tira ninguém dele; a
 * linha híbrida (desktop com WebView, exportação "sem interface web") continua
 * valendo.
 */
export function linhaDeNavegador(trecho: string): boolean {
  // A negação não declara navegador: "sem interface web", "não usa navegador". O "no" do português ("no navegador") não é negação.
  const linha = trecho.replace(/\b(?:sem|n[ãa]o\s+usa|n[ãa]o\s+tem|without)\s+(?:\w+\s+){0,2}?(?:navegador|browser|web|internet)\b/giu, " ");
  // 1. A web embutida num aplicativo (Electron, Tauri, WebView, Blazor Hybrid, MAUI) é desktop ou mobile.
  if (/electron|tauri|webview|blazor\s+hybrid|\bmaui\b/iu.test(linha)) return false;
  // 2. O toolkit nativo declarado: a linha é da janela ou do app, mesmo que fale da API web que consome.
  if (/avalonia|\bwpf\b|winforms|\bqt\b|\bgtk\b|swing|javafx|flutter|swiftui|jetpack|\bcompose\b|godot|unity|react\s+native|(?:aplicativo|app|interface|janela|cliente|desktop|ios|android)\s+(?:\w+\s+)?nativ/iu.test(linha)) return false;
  // 3. O navegador declarado: "aplicação ASP.NET acessada pelo navegador no desktop e no celular" é web.
  if (/navegador|browser|web\s?app|aplica(?:[çc][ãa]o|tivo)\s+web|sistema\s+web|portal\s+web|https?:|localhost|asp\.net|razor|blazor|chrome|firefox|safari/iu.test(linha) || /\b(?:PWA|SPA)\b/u.test(linha)) return true;
  // 4. A forma do aparelho, o terminal ou a biblioteca, sem navegador declarado.
  if (/desktop|android|\bios\b|iphone|ipad|tablet|celular|smartphone|mobile|m[óo]vel|\bjogo\b|\bgame\b|raspberry|kindle|terminal|linha de comando|\bcli\b|biblioteca|library|\bsdk\b|dispositivo|device/iu.test(linha)) return false;
  // 5. O resto que só a web tem: página, site, HTML, frontend e os frameworks dela.
  return /\bweb\b|p[áa]gina|\bsite\b|\bhtml\b|front[\s-]?end|\breact\b|preact|\bvue\b|angular|svelte|solid(?:js)?\b|ember|backbone|jquery|next\.?js|nuxt|remix|astro|\bvite\b|django|flask|jinja|rails|hotwire|laravel|livewire|phoenix|liveview|spring\s+mvc|\bjsp\b|thymeleaf|handlebars|\bejs\b|streamlit|gradio|htmx/iu.test(linha);
}

/** A linha descreve uma interface gráfica — navegador, janela ou aplicativo de aparelho? */
function linhaDeInterfaceGrafica(linha: string): boolean {
  return linhaDeNavegador(linha) ||
    /electron|tauri|webview|\bmaui\b|desktop|janela|avalonia|\bwpf\b|winforms|\bqt\b|\bgtk\b|swing|javafx|flutter|swiftui|jetpack|\bcompose\b|godot|unity|android|\bios\b|iphone|ipad|tablet|celular|smartphone|mobile|m[óo]vel|\bjogo\b|\bgame\b/iu.test(linha);
}

/**
 * O produto é de terminal, e só de terminal? (§134) Só então o G4 roda um
 * roteiro sem servidor. A Stack tem de declarar o uso no terminal (programa de
 * linha de comando, interface de terminal) e nenhuma interface gráfica. No
 * produto híbrido — desktop com um CLI de backup, web com migração pela linha de
 * comando —, o roteiro que não abre a aplicação roda como sempre rodou, com o
 * servidor: na revisão adversarial, uma linha de CLI qualquer na Stack deixava
 * um fluxo de janela ser "percorrido" por comandos.
 */
export function stackDeTerminal(stack: string): boolean {
  const linhas = stack.split(/\r?\n/u).filter((linha) => !linha.startsWith("#") && linha.trim() !== "");
  return linhas.some((linha) => /terminal|linha de comando|command[\s-]line|\bcli\b|\btui\b/iu.test(linha) && !/\bcli\b\s+(?:do|da|de|of)\s+|angular\s+cli|\bvue\s+cli/iu.test(linha)) &&
    !linhas.some((linha) => linhaDeInterfaceGrafica(linha));
}

/**
 * O trecho que o roteirista citou está no contrato que ele leu (§133)?
 *
 * Literal, a menos de espaço, caixa e marcação de Markdown; e com corpo — uma
 * palavra solta ("desktop") estaria em qualquer contrato. É o mesmo princípio da
 * citação do PLAN: a citação que não confere não tira nada da cobrança.
 */
export function citaOContrato(trecho: string, contrato: string): boolean {
  const normal = (texto: string): string => texto.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const citado = normal(trecho);
  // Dentro de uma linha: a citação que costura duas, ou pega o título, não é a frase de ninguém.
  return citado.split(" ").length >= 3 && contrato.split(/\r?\n/).some((linha) => !linha.startsWith("#") && normal(linha).includes(citado));
}

async function percorrerFluxos(options: FlowGateOptions, naoPercorridos: NaoPercorrido[], sinais: SinaisDaPassagem): Promise<FlowGateResult> {
  const announce = options.announce ?? ((): void => {});
  const preferida = options.preferredPort ?? FLOW_PORT;
  // `let`: a colisão na porta do próprio gate troca a porta uma vez (§107).
  let port = options.port ?? (await portaLivre(preferida));
  if (port !== preferida) announce(`porta ${port} para subir a aplicação; a preferida estava ocupada`);
  let baseUrl = `http://127.0.0.1:${port}`;
  const pasta = join(options.projectRoot, FLOWS_DIR);

  const regressao = options.regressao ?? [];
  if (options.workflows.length === 0 && regressao.length === 0) {
    return { green: true, skipped: "a fase não declara fluxos e nenhuma anterior deixou fluxo a revalidar", scripts: [] };
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
  /*
   * A marca do produto fora do navegador, nos três lugares onde o roteirista
   * responde: a redação, a reescrita e a contestação (§133). Vale só para um fluxo
   * desta fase que nenhuma fase percorreu num navegador, e só com o trecho
   * conferido na Stack que ele leu; roteiro de verdade na mesma resposta vence.
   * Sem conferência, é rascunho defeituoso como qualquer outro, e o fluxo continua
   * cobrado.
   */
  // Quem diz é o runner, que sabe qual fluxo foi percorrido e qual foi provado pela suíte (§134); sem ele, a regressão.
  const jaPercorridos = new Set(options.jaPercorridos ?? regressao.map((workflow) => workflow.number));
  /** Os fluxos que já avançaram passos no navegador, com a aplicação servida, nesta fase (§134). */
  const abertos = sinais.abertos;
  for (const numero of options.jaAbertos ?? []) abertos.add(numero);
  const foraDaResposta = async (workflow: SkeletonWorkflow, resposta: string): Promise<{ trecho: string } | { problema: string } | null> => {
    const trecho = lerForaDoNavegador(resposta);
    if (trecho === null || /\btest(?:\.step)?\s*\(/.test(extractFlowScript(resposta))) return null;
    if (!options.workflows.some((atual) => atual.number === workflow.number) || jaPercorridos.has(workflow.number)) {
      return { problema: `o fluxo ${workflow.number} já foi percorrido num navegador por uma fase anterior: a marca ${FORA_DO_NAVEGADOR} não vale para ele — devolva o roteiro` };
    }
    if (options.contratoCertificado === undefined || !citaOContrato(trecho, options.contratoCertificado)) {
      return { problema: `o trecho citado em ${FORA_DO_NAVEGADOR} não está no contrato (a Stack publicada) — copie palavra por palavra a linha que diz como o usuário chega ao produto, ou devolva o roteiro` };
    }
    if (linhaDeNavegador(trecho)) {
      return { problema: `a linha citada em ${FORA_DO_NAVEGADOR} diz que o produto se usa num navegador: o fluxo é percorrido nele — devolva o roteiro` };
    }
    if (abertos.has(workflow.number)) {
      return { problema: `o fluxo ${workflow.number} já avançou passos num percurso desta fase (no navegador ou no terminal): ele se percorre ali — devolva o roteiro corrigido` };
    }
    // A última resposta é a mais informada: substitui a anterior do mesmo fluxo, com as provas que trouxer (§134).
    const { provas, semProva } = lerProvas(resposta);
    const fluxo: NaoPercorrido = { number: workflow.number, trecho, ...(provas.length > 0 ? { provas } : {}), ...(semProva.length > 0 ? { semProva } : {}) };
    const anterior = naoPercorridos.findIndex((outro) => outro.number === workflow.number);
    if (anterior >= 0) naoPercorridos.splice(anterior, 1, fluxo);
    else {
      naoPercorridos.push(fluxo);
      announce(`fluxo ${workflow.number} (${workflow.name}) NÃO percorrido: o contrato descreve o produto fora do navegador — «${trecho}»`);
    }
    /*
     * O roteiro que existia para ele — web, inventado — sai do disco: é do harness,
     * e deixá-lo faria a passagem seguinte da fase rodá-lo de novo, sem perguntar.
     * Sem roteiro, o fluxo volta à redação, onde a decisão já tomada responde.
     */
    await rm(join(pasta, flowScriptName(workflow.number)), { force: true });
    return { trecho };
  };

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
    if (options.rejectedScripts?.includes(workflow.number) || (daFase && checkFlowScript(existente, workflow).length > 0)) aEscrever.push(workflow);
  }

  for (const workflow of aEscrever) {
    const arquivo = join(pasta, flowScriptName(workflow.number));
    const anterior = options.rejectedScripts?.includes(workflow.number) ? await readFile(arquivo, "utf8").catch(() => null) : null;
    let rejeitado: string[] = [];
    let gravado = false;
    const tentativas = options.maxDrafts ?? 2;
    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      announce(
        `roteiro do workflow ${workflow.number} (${workflow.name})` + (tentativa > 1 ? ` — tentativa ${tentativa}` : ""),
      );
      const resposta = await options.author(workflow, rejeitado, baseUrl, passagemDe(workflow));
      const fora = await foraDaResposta(workflow, resposta);
      if (fora !== null && "trecho" in fora) {
        gravado = true;
        break;
      }
      if (fora !== null) {
        rejeitado = [fora.problema];
        continue;
      }
      const script = extractFlowScript(resposta);
      const defeitos = checkFlowScript(script, workflow);
      if (anterior !== null && comMarca(script) === anterior) defeitos.push({ problem: "o roteirista devolveu o mesmo roteiro que já falhou", hint: "aplique o diagnóstico recebido antes de devolver o arquivo; não repetir o mesmo teste" });
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
          `em ${tentativas} tentativas:\n${rejeitado.map((linha) => `- ${linha}`).join("\n")}` +
          "\nIsto é do harness, não da implementação: o roteirista não entregou um roteiro válido.",
        scriptFailed: true,
        falharam: [workflow.number],
      };
    }
  }

  /*
   * Só os roteiros dos fluxos desta fase e das anteriores. O que estiver na
   * pasta e não pertencer a nenhum deles é resto de outro plano — rodá-lo
   * cobraria da fase um comportamento que ninguém prometeu nela.
   */
  const aPercorrer = async (): Promise<string[]> => {
    const noDisco = new Set(await existingFlowScripts(options.projectRoot));
    const foraDoNavegador = new Set(naoPercorridos.map((fluxo) => flowScriptName(fluxo.number)));
    return [...regressao, ...options.workflows]
      .map((workflow) => flowScriptName(workflow.number))
      .filter((nome, indice, todos) => todos.indexOf(nome) === indice && noDisco.has(nome) && !foraDoNavegador.has(nome));
  };
  // `let`: a contestação, a pergunta sem `start` e a reescrita podem tirar um fluxo do navegador (§133).
  let scripts = await aPercorrer();
  const semRoteiro = (): FlowGateResult => ({
    green: true,
    skipped: naoPercorridos.length > 0
      ? `fluxo(s) ${naoPercorridos.map((fluxo) => fluxo.number).join(", ")} não percorrido(s): o produto é usado fora do navegador — obrigação pendente, não aprovação`
      : "nenhum fluxo a percorrer",
    scripts: [],
  });

  if (scripts.length === 0) return semRoteiro();

  /*
   * Quem reescrever: o roteiro que falhou — seja da fase, seja da regressão —, e
   * só na falta dessa informação os da fase, como antes.
   */
  const alvos = (numeros: readonly string[] | undefined): SkeletonWorkflow[] => {
    const escolhidos = ordem.filter((workflow) => (numeros ?? []).includes(workflow.number));
    return escolhidos.length > 0 ? escolhidos : options.workflows;
  };

  /*
   * O executor contestou o roteiro: reescreve antes de rodar — e antes de cobrar o
   * `start` (§133). No desktop, o executor que não cria servidor contesta o roteiro
   * web; tratada depois da cobrança, a contestação nunca chegava ao roteirista.
   *
   * Ele acabou de ler o produto e o erro do seletor, e é a única parte do ciclo
   * que viu os dois. Quem reescreve é outra sessão, que lê o produto de novo —
   * então a contestação não vira licença para ignorar o fluxo, só troca quem é
   * corrigido primeiro.
   */
  if (options.roteiroContestado) {
    announce(`o executor contestou o roteiro: ${options.roteiroContestado}`);
    for (const workflow of alvos(options.roteirosQueFalharam)) {
      const arquivo = join(pasta, flowScriptName(workflow.number));
      const resposta = await options.author(
        workflow,
        [`o executor diz que este roteiro está errado, e não o produto: ${options.roteiroContestado}`],
        baseUrl,
        passagemDe(workflow),
      );
      const fora = await foraDaResposta(workflow, resposta);
      if (fora !== null && "trecho" in fora) continue;
      const script = extractFlowScript(resposta);
      const defeitos = fora !== null ? [{ problem: fora.problema, hint: "" }] : checkFlowScript(script, workflow);
      if (defeitos.length === 0) {
        await writeFile(arquivo, comMarca(script), "utf8");
        announce(`  roteiro do fluxo ${workflow.number} reescrito`);
      } else {
        announce(`  o roteiro reescrito do fluxo ${workflow.number} veio com defeito; mantive o anterior`);
      }
    }
    scripts = await aPercorrer();
    if (scripts.length === 0) return semRoteiro();
  }

  /*
   * A falta de `start` é cobrada aqui, depois da redação, e não antes (§133): é o
   * roteirista quem diz, lendo o contrato, se o produto se usa num navegador. No
   * Luna, cobrada antes, ela fez o executor criar `package.json` e um servidor
   * HTTP falso num aplicativo desktop.
   */
  const startCommand = options.startCommand;
  /*
   * Só o roteiro que abre a aplicação precisa dela de pé (§134). O de um programa
   * de terminal roda sem servidor e sem `start` — cobrá-lo de um CLI era pedir ao
   * executor um entrypoint HTTP que o produto não tem.
   */
  const produtoDeTerminal = options.contratoCertificado !== undefined && stackDeTerminal(options.contratoCertificado);
  const precisaDoServidor = async (): Promise<boolean> => {
    if (!produtoDeTerminal) return true;
    for (const nome of scripts) if (roteiroUsaOServidor(await readFile(join(pasta, nome), "utf8").catch(() => ""))) return true;
    return false;
  };
  const semComoSubir = (): FlowGateResult => ({
    green: false,
    cause:
      "o gate 4 não sabe como subir a aplicação: o projeto não declara um entrypoint (`start`) " +
      "que o loop possa executar. Declare-o no manifesto para que os fluxos possam ser percorridos. " +
      "O gate o executa com PORT e HOST no ambiente, e a aplicação precisa escutar nesse endereço.",
  });
  if (startCommand === null && (await precisaDoServidor())) {
    /*
     * Sem `start`, uma pergunta a mais, uma vez por fase (o runner decide quando):
     * o roteiro que já está no disco pode ter sido escrito como se o produto fosse
     * web. No Luna, três de cinco roteiristas inventaram seletores; sem esta volta,
     * o executor que não cria servidor para um desktop ficava sem saída (§133).
     */
    if (options.confirmarSemStart === true) {
      // Só quem escreveu roteiro que abre a aplicação: o de comandos não precisa de `start` (§134).
      const abrem = new Set<string>();
      for (const nome of scripts) if (!produtoDeTerminal || roteiroUsaOServidor(await readFile(join(pasta, nome), "utf8").catch(() => ""))) abrem.add(nome);
      const daFase = options.workflows.filter((workflow) =>
        !jaPercorridos.has(workflow.number) && abrem.has(flowScriptName(workflow.number)));
      // Só conta como feita quando chegou a alguém: a passagem que reprovou antes não a gasta.
      if (daFase.length > 0) sinais.perguntouSemStart = true;
      for (const workflow of daFase) {
        announce(`o projeto não declara \`start\`: o roteirista confirma se o fluxo ${workflow.number} se percorre num navegador`);
        const resposta = await options.author(workflow, [MOTIVO_SEM_START], baseUrl, passagemDe(workflow));
        const fora = await foraDaResposta(workflow, resposta);
        if (fora !== null) continue;
        const script = extractFlowScript(resposta);
        if (checkFlowScript(script, workflow).length === 0) await writeFile(join(pasta, flowScriptName(workflow.number)), comMarca(script), "utf8");
      }
      scripts = await aPercorrer();
      if (scripts.length === 0) return semRoteiro();
    }
    if (await precisaDoServidor()) return semComoSubir();
  }
  // `null`: nenhum roteiro desta passagem abre a aplicação, e nada sobe (§134).
  let servidor = (await precisaDoServidor()) ? startCommand : null;
  await writeFile(join(pasta, FLOW_CONFIG), renderFlowConfig({ startCommand: servidor, port, scripts }), "utf8");
  await writeFile(join(pasta, FLOW_HELPER), renderFlowHelper(), "utf8");

  const runner = options.runner ?? defaultFlowRunner;
  const executar = options.executar ?? executarNoShell;

  /*
   * Cada passagem num ambiente próprio, criado agora e apagado ao fim — inclusive
   * a segunda passagem depois de um roteiro reescrito, que não pode herdar o que a
   * primeira deixou.
   */
  const passagem = async (): Promise<FlowRun> => {
    const ambiente = await criarAmbienteDaPassagem(options.projectRoot, bancos);
    try {
      if (migracao !== null) {
        const migrou = await executar(migracao, options.projectRoot, ambiente.env);
        if (migrou.exitCode !== 0) {
          announce(`\`${migracao}\` falhou no banco novo da passagem (código ${migrou.exitCode}):\n${tail(migrou.output, 15)}`);
        }
      }
      // O comando de início vai junto: o ajudante sobe com ele a instância que o roteiro reinicia (§109).
      return await runner(options.projectRoot, scripts, { ...ambiente.env, [VARIAVEL_DO_INICIO]: startCommand ?? "" });
    } finally {
      await ambiente.limpar();
    }
  };

  /*
   * A porta do GATE tomada entre a escolha e a subida: outra porta, uma vez (§107).
   *
   * Só quando a saída aponta a porta que o gate escolheu — colisão em outra porta
   * é da aplicação, e trocar a do gate não a resolve. Uma vez por chamada do gate,
   * sem tocar no processo que ocupou a porta: ele não é nosso.
   */
  let portaTrocada = false;
  /*
   * O fluxo que falhou depois do primeiro passo avançou no navegador, ou no
   * terminal: ele se percorre ali, e a marca não vale mais para ele nesta fase (§134).
   * Falhar no primeiro passo não diz nada — é o caso do roteiro inventado para um
   * produto que não é web.
   */
  const anotarAbertos = (corrida: FlowRun): void => {
    // Vale também para o percurso no terminal: o fluxo que falhou depois do passo 1 foi percorrido ali (§134).
    if (corrida.exitCode === 0 || corrida.toolMissing === true || (servidor !== null && falhouAoSubir(corrida.output))) return;
    for (const numero of fluxosQueFalharam(corrida.output, ordem)) {
      if ((passoQueFalhou(corrida.output, numero) ?? 1) > 1) abertos.add(numero);
    }
  };
  const rodar = async (): Promise<FlowRun & { semStart?: true }> => {
    // A reescrita pode ter tirado um fluxo do navegador: roda só o que sobrou (§133).
    const atuais = await aPercorrer();
    if (atuais.join("\n") !== scripts.join("\n")) scripts = atuais;
    // A reescrita pode ter mudado o que o roteiro abre: a configuração acompanha, e sem `start` o entrypoint volta a ser cobrado (§134).
    const abre = await precisaDoServidor();
    if (abre && startCommand === null) return { exitCode: 1, output: "", semStart: true };
    servidor = abre ? startCommand : null;
    if (scripts.length > 0) await writeFile(join(pasta, FLOW_CONFIG), renderFlowConfig({ startCommand: servidor, port, scripts }), "utf8");
    if (scripts.length === 0) return { exitCode: 0, output: "" };
    const corrida = await passagem();
    anotarAbertos(corrida);
    if (portaTrocada || corrida.exitCode === 0 || !portasEmUso(corrida.output).includes(port)) return corrida;
    portaTrocada = true;
    const anterior = port;
    port = await portaLivre(0);
    baseUrl = `http://127.0.0.1:${port}`;
    announce(`a porta ${anterior} do gate foi ocupada antes de a aplicação subir; tentando de novo na ${port}, sem gastar ciclo`);
    await writeFile(join(pasta, FLOW_CONFIG), renderFlowConfig({ startCommand: servidor, port, scripts }), "utf8");
    const segunda = await passagem();
    anotarAbertos(segunda);
    return segunda;
  };

  announce(
    "passagem isolada: diretório pessoal descartável" +
      (Object.keys(bancos).length > 0 ? `, banco novo em ${Object.keys(bancos).sort().join(", ")}` : "") +
      (scripts.length > 1 ? `; ${scripts.length} roteiros em sequência` : ""),
  );


  /*
   * Reescreve os roteiros indicados, com as mesmas tentativas da primeira
   * redação, conferindo cada tentativa — inclusive contra os nomes que o erro
   * apontou. Uma tentativa só, sem conferência, deixou o mesmo `${sufo}` voltar e
   * a fase pagar um ciclo.
   */
  const reescrever = async (
    workflows: readonly SkeletonWorkflow[],
    motivo: string[],
    naoDefinidos: readonly string[] = [],
  ): Promise<string[]> => {
    const tentativas = options.maxDrafts ?? 2;
    const falhas: string[] = [];
    for (const workflow of workflows) {
      const arquivo = join(pasta, flowScriptName(workflow.number));
      const existente = await readFile(arquivo, "utf8").catch(() => null);
      let rejeitado = [...motivo];
      let problemas = ["nenhuma correção executável foi entregue"];
      for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
        const resposta = await options.author(workflow, rejeitado, baseUrl, passagemDe(workflow));
        const fora = await foraDaResposta(workflow, resposta);
        if (fora !== null && "trecho" in fora) {
          problemas = [];
          break;
        }
        const script = extractFlowScript(resposta);
        const defeitos = fora !== null ? [{ problem: fora.problema, hint: "" }] : checkFlowScript(script, workflow, naoDefinidos);
        if (defeitos.length === 0) {
          if (comMarca(script) === existente) {
            problemas = ["o roteirista não alterou o roteiro que acabou de falhar; não repetir o mesmo teste"];
            break;
          }
          await writeFile(arquivo, comMarca(script), "utf8");
          problemas = [];
          break;
        }
        problemas = defeitos.map((defect) => `${defect.problem} — ${defect.hint}`);
        rejeitado = [...rejeitado, ...problemas];
        announce(`  a reescrita do roteiro do fluxo ${workflow.number} voltou com defeito: ${defeitos[0]?.problem ?? ""}`);
      }
      if (problemas.length > 0) falhas.push(`workflow ${workflow.number}: ${problemas.join("; ")}`);
    }
    return falhas;
  };

  let run = await rodar();
  if (run.semStart === true) return semComoSubir();

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

    const falhas = await reescrever(alvos(fluxosQueFalharam(run.output, ordem)), [`o roteiro anterior falhou assim:\n${tail(run.output, 25)}`], nomesNaoDefinidos(run.output));
    if (falhas.length > 0) return {
      green: false, scriptFailed: true, output: run.output,
      falharam: fluxosQueFalharam(run.output, ordem),
      cause: `O roteirista não entregou uma correção executável. Isto é do harness; não executar de novo o roteiro antigo nem devolver o produto ao executor.\n${falhas.join("\n")}`,
    };

    run = await rodar();
    if (run.semStart === true) return semComoSubir();
    if (run.exitCode !== 0 && ehFalhaDoRoteiro(run.output)) {
      return {
        green: false,
        scriptFailed: true,
        output: run.output,
        falharam: fluxosQueFalharam(run.output, ordem),
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
        "Se a infraestrutura aprovada do projeto o declara, instale-o como declarado e garanta o navegador " +
        "(`npx playwright install chromium`); se não declara, não o acrescente ao projeto — ele é ferramenta do harness, " +
        `preparada em \`.capivara/\` antes do desenvolvimento, e as dependências do projeto são do plano. Saída:\n${tail(run.output)}`,
    };
  }

  /*
   * Porta ocupada: de QUEM é a porta decide de quem é a falha (§107).
   *
   * A do gate, tomada entre a escolha e a subida, é do ambiente — já houve uma
   * troca de porta em `rodar`, e esta é a segunda falha. Qualquer outra é a
   * aplicação escutando onde o gate não mandou: no `build-96756ca336b0` ela
   * ignorava a `PORT` e abria a 3001, que o gate 4 de outra fase já ocupava, e o
   * gate disse "porta 47535, do ambiente". Sem porta legível, não se atribui.
   */
  if (run.exitCode !== 0 && /is already used|EADDRINUSE|address already in use/i.test(run.output)) {
    const ocupadas = portasEmUso(run.output);
    const daAplicacao = ocupadas.filter((ocupada) => ocupada !== port);
    const cause = ocupadas.includes(port)
      ? `a porta ${port} do gate foi ocupada por outro processo antes de a aplicação subir` +
        (portaTrocada ? ", e isso já tinha acontecido com a anterior, nesta mesma passagem" : "") +
        `. Isto é do ambiente, não do seu código: nada precisa ser corrigido na implementação.`
      : daAplicacao.length > 0
        ? `a aplicação tentou escutar na porta ${daAplicacao.join(", ")}, e não na que o gate forneceu: PORT=${port}, ` +
          `HOST=127.0.0.1. É configuração do entrypoint, não do ambiente — trocar a porta do gate não resolve. ` +
          `\`${startCommand}\` precisa fazer a aplicação escutar na porta que vem em PORT e no host que vem em HOST; ` +
          `o projeto pode manter a própria variável, desde que o entrypoint aceite estas.`
        : `a aplicação não subiu por porta em uso, e a saída não diz qual porta. O gate forneceu PORT=${port} e ` +
          `HOST=127.0.0.1; confira se \`${startCommand}\` escuta nesse endereço.`;
    return { green: false, startupFailed: true, output: run.output, cause: `${cause}\n${tail(run.output)}` };
  }

  if (run.exitCode !== 0 && falhouAoSubir(run.output)) {
    /*
     * Escutou noutra porta (§111): a causa diz qual, como a da porta ocupada.
     * Se ela anunciou também a do gate, a porta não é a explicação.
     */
    const anunciadas = portasAnunciadas(run.output);
    if (anunciadas.length > 0 && !anunciadas.includes(port)) {
      return {
        green: false,
        startupFailed: true,
        output: run.output,
        cause:
          `a aplicação NÃO SUBIU na porta do gate: ela anunciou que escuta na porta ${anunciadas.join(", ")}, e o gate ` +
          `forneceu PORT=${port}, HOST=127.0.0.1 e esperou http://127.0.0.1:${port} até estourar o tempo. Nenhum fluxo ` +
          `chegou a ser percorrido. É configuração do entrypoint, não do ambiente: \`${options.startCommand}\` precisa ` +
          `fazer a aplicação escutar na porta que vem em PORT e no host que vem em HOST; o projeto pode manter a ` +
          `própria variável, desde que o entrypoint aceite estas.\n${tail(run.output)}`,
      };
    }
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
     * Antes do executor, a triagem: de quem é esta falha?
     *
     * ROTEIRO é resolvido aqui, sem gastar ciclo: o roteiro é reescrito com o
     * retrato da página e o motivo, e a passagem roda de novo — até duas correções
     * por passo declarado. PRODUTO e CRITERIO chegam ao executor como correção, não
     * como rastro.
     */
    const triar = async (corrida: FlowRun): Promise<{ triagem: Triagem; workflow: SkeletonWorkflow } | null> => {
      if (!options.triagem) return null;
      const numero = fluxosQueFalharam(corrida.output, ordem)[0];
      const workflow = ordem.find((candidato) => candidato.number === numero);
      if (!workflow) return null;
      const nome = flowScriptName(workflow.number);
      const entrada: EntradaDaTriagem = {
        workflow,
        script: await readFile(join(pasta, nome), "utf8").catch(() => ""),
        failure: tail(corrida.output, 60),
        snapshot: (await retratosDaFalha(options.projectRoot)).get(nome) ?? "",
        serverErrors: errosDoServidor(corrida.output),
      };
      // Sem `catch`: credencial recusada e limite de uso param o build pela mesma
      // via do roteirista (§83). Engolir aqui transformaria a parada em rastro.
      const triagem = lerTriagem(await options.triagem(entrada));
      if (triagem === null) {
        announce("a triagem não devolveu um veredito legível; o rastro vai ao executor como antes");
        return null;
      }
      announce(`triagem do fluxo ${workflow.number}: ${triagem.tipo} — ${triagem.correcao}`);
      return { triagem, workflow };
    };

    let triada = await triar(run);
    const correcoesDoRoteiro = new Set<string>();
    const correcoesPorPasso = new Map<string, number>();
    let passoEmFalha = "";
    while (triada?.triagem.tipo === "ROTEIRO") {
      const numero = Number(/›\s*passo\s+(\d+)(?:\s*:|\s*$)/im.exec(run.output)?.[1]);
      const passo = Number.isSafeInteger(numero) && numero >= 1 && numero <= triada.workflow.steps.length ? numero : null;
      passoEmFalha = passo === null ? `fluxo ${triada.workflow.number} (passo não identificado)` : `passo ${passo} do fluxo ${triada.workflow.number}`;
      const endereco = JSON.stringify([triada.workflow.number, passo]);
      const tentativas = correcoesPorPasso.get(endereco) ?? 0;
      if (tentativas >= 2) break;
      const chave = JSON.stringify([endereco, triada.triagem.onde, triada.triagem.correcao]);
      if (correcoesDoRoteiro.has(chave)) break;
      correcoesDoRoteiro.add(chave);
      correcoesPorPasso.set(endereco, tentativas + 1);
      const caminhoDoRoteiro = join(pasta, flowScriptName(triada.workflow.number));
      const antesDaCorrecao = await readFile(caminhoDoRoteiro, "utf8");
      let patchAplicado = false;
      const patch = triada.triagem.patch;
      if (patch) {
        const arquivo = join(pasta, flowScriptName(triada.workflow.number));
        const anterior = await readFile(arquivo, "utf8");
        const posicao = anterior.indexOf(patch.before);
        if (posicao >= 0 && anterior.indexOf(patch.before, posicao + 1) === -1) {
          const corrigido = anterior.slice(0, posicao) + patch.after + anterior.slice(posicao + patch.before.length);
          if (checkFlowScript(corrigido, triada.workflow, nomesNaoDefinidos(run.output)).length === 0) {
            await writeFile(arquivo, corrigido, "utf8");
            patchAplicado = true;
            announce(`correção pontual do roteiro do fluxo ${triada.workflow.number} aplicada; nenhuma nova chamada ao roteirista`);
          }
        }
      }
      if (!patchAplicado) {
        const retrato = (await retratosDaFalha(options.projectRoot)).get(flowScriptName(triada.workflow.number)) ?? "";
        announce(`o roteiro do fluxo ${triada.workflow.number} é que está errado; reescrevendo sem gastar ciclo do executor`);
        const falhas = await reescrever(
          [triada.workflow],
          [
            `a triagem leu a falha e diz que o ROTEIRO está errado, não o produto: ${triada.triagem.correcao}`,
            ...(triada.triagem.evidencia !== "" ? [`evidência: ${triada.triagem.evidencia}`] : []),
            ...(retrato !== "" ? [`a página, no instante da falha, era esta — escreva contra ela:\n${retrato}`] : []),
          ],
          nomesNaoDefinidos(run.output),
        );
        if (falhas.length > 0) return {
          green: false, scriptFailed: true, output: run.output,
          falharam: fluxosQueFalharam(run.output, ordem), triagem: triada.triagem,
          cause: `O roteirista não entregou uma correção executável. Isto é do harness; não executar de novo o roteiro antigo nem devolver o produto ao executor.\n${falhas.join("\n")}`,
        };
      }
      const numeroDaTriagem = triada.workflow.number;
      const saiuDoNavegador = naoPercorridos.some((fluxo) => fluxo.number === numeroDaTriagem);
      if (!saiuDoNavegador && await readFile(caminhoDoRoteiro, "utf8").catch(() => null) === antesDaCorrecao) return {
        green: false, scriptFailed: true, output: run.output,
        falharam: fluxosQueFalharam(run.output, ordem), triagem: triada.triagem,
        cause: `O roteirista não alterou o roteiro que já falhou no ${passoEmFalha}. Isto é do harness; ` +
          `não repetir o mesmo teste nem reconstruir o produto.\n${causaDaTriagem(triada.triagem, tail(run.output))}`,
      };
      run = await rodar();
      if (run.semStart === true) return semComoSubir();
      if (run.exitCode === 0) return scripts.length === 0 ? semRoteiro() : { green: true, skipped: "", scripts, output: run.output };
      triada = await triar(run);
    }

    if (triada?.triagem.tipo === "ROTEIRO") {
      return {
        green: false, scriptFailed: true, output: run.output,
        falharam: fluxosQueFalharam(run.output, ordem), triagem: triada.triagem,
        cause: `O roteiro continua incorreto após ${correcoesDoRoteiro.size} correção(ões); a falha está no ${passoEmFalha}. Isto é do harness: ` +
          `não pedir ao executor que altere produto aprovado por causa deste roteiro.\n${causaDaTriagem(triada.triagem, tail(run.output))}`,
      };
    }

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

    const rastro =
      `${cabecalho}a aplicação não cumpriu um fluxo declarado — o roteiro rodou contra o produto de pé em ` +
      `http://127.0.0.1:${port} e reprovou. Isto não é teste de unidade: um passo falhou onde o ` +
      `usuário passaria.\n${tail(run.output)}`;

    return {
      green: false,
      output: run.output,
      falharam: fluxosQueFalharam(run.output, ordem),
      ...(triada ? { triagem: triada.triagem } : {}),
      cause: triada ? causaDaTriagem(triada.triagem, rastro) : rastro,
    };
  }

  // Nada percorrido não é prova de percurso: sem roteiro restante, vale o registro de quem ficou fora (§133).
  return scripts.length === 0 ? semRoteiro() : { green: true, skipped: "", scripts, output: run.output };
}

/** As últimas linhas, que é onde o playwright escreve o que falhou. */
function tail(output: string, lines = 40): string {
  return output.split("\n").slice(-lines).join("\n").trim();
}
