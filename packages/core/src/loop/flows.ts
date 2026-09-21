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
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkeletonWorkflow } from "../contract/index.js";
import { extractFlowScript, stepLabel } from "../prompts/index.js";

/** Onde os roteiros moram, relativo à raiz do projeto. */
export const FLOWS_DIR = join(".capivara", "flows");

export const FLOW_CONFIG = "playwright.config.mjs";

/** A porta em que o gate sobe o produto. Alta e fixa: nada disputa com ela. */
export const FLOW_PORT = 47533;

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
export function renderFlowConfig(options: { startCommand: string; port: number; timeoutSeconds?: number }): string {
  const url = `http://127.0.0.1:${options.port}`;
  return [
    "// Gerado pelo capivara a cada passagem do gate 4. Não edite: será sobrescrito.",
    "export default {",
    "  testDir: '.',",
    "  timeout: 60_000,",
    "  reporter: [['list']],",
    "  fullyParallel: false,",
    "  forbidOnly: true,",
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

export type FlowRunner = (projectRoot: string, scripts: string[]) => Promise<FlowRun>;

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
export function faltaORunner(output: string, exitCode: number): boolean {
  if (exitCode === 127) return true;
  return /could not determine executable|not found|Cannot find (module|package)|Please install|npx playwright install/i.test(output);
}

/**
 * Playwright, rodado pelo loop.
 *
 * `npx --no-install` é deliberado: instalar por conta própria, no meio de um
 * gate, esconderia do operador que o projeto não declarou a dependência. Sem o
 * runner, o gate diz o que falta e quem instala é o executor, como no gate 2.
 */
export const defaultFlowRunner: FlowRunner = async (projectRoot, scripts) =>
  new Promise((resolve) => {
    const child = execFile(
      "npx",
      ["--no-install", "playwright", "test", "--config", FLOW_CONFIG, ...scripts],
      { cwd: join(projectRoot, FLOWS_DIR), maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: "1" } },
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
  /** Como a aplicação sobe. Sem isto não há o que abrir. */
  startCommand: string | null;
  /** Chama a sessão independente que redige o roteiro. */
  author: (workflow: SkeletonWorkflow, rejected: string[]) => Promise<string>;
  runner?: FlowRunner;
  port?: number;
  /** Tentativas de redação por fluxo, contando a primeira. */
  maxDrafts?: number;
  announce?: (message: string) => void;
}

export type FlowGateResult =
  | { green: true; skipped: string; scripts: string[] }
  | { green: false; cause: string; toolMissing?: boolean; startupFailed?: boolean };

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
 * O gate inteiro: garante um roteiro por fluxo da fase e roda todos os que existem.
 *
 * Roda também os das fases anteriores porque um fluxo que passou a funcionar na
 * fase 2 e parou de funcionar na fase 5 é exatamente o defeito que ninguém pega
 * lendo código — e o roteiro para exercitá-lo já está escrito e pago.
 */
export async function gate4(options: FlowGateOptions): Promise<FlowGateResult> {
  const announce = options.announce ?? ((): void => {});
  const port = options.port ?? FLOW_PORT;
  const pasta = join(options.projectRoot, FLOWS_DIR);

  const jaEscritos = await existingFlowScripts(options.projectRoot);
  if (options.workflows.length === 0 && jaEscritos.length === 0) {
    return { green: true, skipped: "a fase não declara fluxos e nenhum roteiro anterior existe", scripts: [] };
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

  for (const workflow of options.workflows) {
    const arquivo = join(pasta, flowScriptName(workflow.number));
    const existente = await readFile(arquivo, "utf8").catch(() => null);
    if (existente !== null && checkFlowScript(existente, workflow).length === 0) continue;

    let rejeitado: string[] = [];
    let gravado = false;
    const tentativas = options.maxDrafts ?? 2;
    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      announce(
        `roteiro do workflow ${workflow.number} (${workflow.name})` + (tentativa > 1 ? ` — tentativa ${tentativa}` : ""),
      );
      const script = extractFlowScript(await options.author(workflow, rejeitado));
      const defeitos = checkFlowScript(script, workflow);
      if (defeitos.length === 0) {
        await writeFile(arquivo, `${script}\n`, "utf8");
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

  await writeFile(join(pasta, FLOW_CONFIG), renderFlowConfig({ startCommand: options.startCommand, port }), "utf8");

  const scripts = await existingFlowScripts(options.projectRoot);
  if (scripts.length === 0) return { green: true, skipped: "nenhum fluxo a percorrer", scripts: [] };

  const runner = options.runner ?? defaultFlowRunner;
  const run = await runner(options.projectRoot, scripts);

  if (run.toolMissing === true) {
    return {
      green: false,
      toolMissing: true,
      cause:
        "o runner de fluxos não está instalado: o gate 4 abre a aplicação com @playwright/test. " +
        `Instale-o como dependência de desenvolvimento do projeto e garanta o navegador ` +
        `(\`npx playwright install chromium\`). Saída:\n${tail(run.output)}`,
    };
  }

  if (run.exitCode !== 0 && falhouAoSubir(run.output)) {
    return {
      green: false,
      startupFailed: true,
      cause:
        `a aplicação NÃO SUBIU, e por isso nenhum fluxo chegou a ser percorrido — isto não é ` +
        `defeito dos fluxos.\n\nO gate 4 executa \`${options.startCommand}\` a partir da raiz do ` +
        `projeto, com PORT=${port} no ambiente, e espera http://127.0.0.1:${port} responder. ` +
        `O entrypoint precisa escutar na porta que vem em PORT e servir alguma resposta ali.` +
        `\n${tail(run.output)}`,
    };
  }

  if (run.exitCode !== 0) {
    return {
      green: false,
      cause:
        `a aplicação não cumpriu um fluxo declarado — o roteiro rodou contra o produto de pé em ` +
        `http://127.0.0.1:${port} e reprovou. Isto não é teste de unidade: um passo falhou onde o ` +
        `usuário passaria.\n${tail(run.output)}`,
    };
  }

  return { green: true, skipped: "", scripts };
}

/** As últimas linhas, que é onde o playwright escreve o que falhou. */
function tail(output: string, lines = 40): string {
  return output.split("\n").slice(-lines).join("\n").trim();
}
