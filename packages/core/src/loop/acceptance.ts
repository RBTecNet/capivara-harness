/**
 * Aceitação operacional.
 *
 * Gate 2 verde significa "a suíte passa", não "o produto funciona". O piloto 1b
 * entregou 30 testes verdes sem que ninguém tivesse aplicado uma migração,
 * aberto uma conexão ou subido o servidor — os testes rodavam num repositório em
 * memória, e a camada de banco jamais foi exercitada.
 *
 * Esta fase final fecha essa lacuna sem reintroduzir um contrato operacional:
 * ela deriva os passos do próprio projeto, roda numa cópia limpa e exige que o
 * produto suba e continue de pé.
 *
 * Cópia limpa é o que prova que nada depende de estado não versionado: a
 * aplicação tem de funcionar a partir do que foi commitado.
 */

import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree } from "../provider/supervisor.js";
import { runtimeEnvironment } from "../provider/runtime-env.js";

export interface AcceptanceStep {
  id: string;
  command: string;
  /** Serviço não termina sozinho: sobe, fica de pé e é encerrado. */
  service: boolean;
  /** A janela própria do passo, em segundos; sem ela, a de serviço ou a de passo. */
  seconds?: number;
  /**
   * O executável de um aplicativo desktop: não é servidor — o percurso dos
   * fluxos não o sobe —, e passar nele é a prova, pela plataforma, do produto
   * que nem o navegador nem o terminal alcançam.
   */
  desktop?: boolean;
  /** O passo que esta máquina não pode executar, e por quê: a aceitação o registra como verificação inconclusiva. */
  inconclusiva?: string;
}

export interface StepResult {
  id: string;
  command: string;
  exitCode: number;
  output: string;
}

/**
 * De quem é a falha da aceitação (etapa 4 da redução): do produto — não instala,
 * não sobe, um fluxo reprova —, que o executor corrige; ou da ferramenta do
 * harness — o runner de fluxos ausente, o roteiro que falha por si, a porta do
 * gate tomada —, que nenhum reparo do produto resolve: é verificação inconclusiva.
 */
export type NaturezaDaFalha = "produto" | "ferramenta";

export type AcceptanceResult =
  | {
      accepted: true;
      steps: StepResult[];
      skipped: string;
      /** O que a aceitação não pôde percorrer pelos meios da plataforma: pendência, nunca prova. */
      pendencias?: string[];
    }
  | { accepted: false; steps: StepResult[]; failure: { id: string; cause: string; natureza: NaturezaDaFalha } };

/** O smoke dos fluxos essenciais, na sala limpa em que os passos acabaram de passar. */
export type ResultadoDoSmoke =
  | { ok: true; pendencias: string[] }
  | { ok: false; id: string; cause: string; natureza: NaturezaDaFalha };

/**
 * O que não atravessa para a cópia limpa.
 *
 * `.env` está aqui pelo motivo mais sério da lista: ele é o arquivo onde o
 * desenvolvedor põe a conexão do banco DELE. A aceitação instala, MIGRA e sobe o
 * produto — copiar o `.env` junto faria o harness rodar uma migração contra o
 * banco de produção de quem o chamou, sem nunca ter pedido licença. A cópia
 * recebe o `.env.example` como `.env`, que é exatamente o ambiente descartável
 * que as regras transversais do esqueleto prometem.
 */
const EXCLUDED = new Set([".git", "node_modules", ".capivara", "dist", "build", "coverage", ".next", ".venv", ".env"]);

/** Manifestos que o projeto pode declarar. Ausente é `null`. */
export interface Manifests {
  packageJson?: string | null;
  pyproject?: string | null;
  goMod?: string | null;
  cargoToml?: string | null;
  /** Página inicial de uma aplicação que roda direto no navegador. */
  indexHtml?: string | null;
  /** Os projetos .NET (`*.csproj`), com o caminho relativo à raiz e o conteúdo. */
  dotnet?: readonly { caminho: string; conteudo: string }[];
  /** Onde a aceitação roda: o sistema e se há tela para uma janela. Ausente é esta máquina. */
  plataforma?: { sistema: NodeJS.Platform; tela: boolean };
}

/**
 * Deriva os passos do ecossistema que o projeto declara.
 *
 * A primeira versão olhava só para `package.json`, porque foi escrita com o
 * piloto 1 na mão, que era Node. O piloto 2 é uma CLI Python: sem
 * `package.json`, a aceitação pularia inteira e a ferramenta declararia sucesso
 * sem ter tentado rodar nada.
 *
 * Continua sem adivinhação: o que o manifesto declara é o que o produto sabe
 * fazer. Ecossistema que eu não reconheço simplesmente não tem aceitação — e
 * isso não é reprovação.
 */
export function deriveAcceptance(manifests: Manifests): AcceptanceStep[] {
  // O projeto .NET de janela é o produto: um manifesto Node ao lado dele é ferramenta.
  const desktop = desktopDotnetSteps(manifests.dotnet ?? [], manifests.plataforma ?? estaPlataforma());
  if (desktop.length > 0) return desktop;

  const node = nodeSteps(manifests.packageJson ?? null);
  if (node.length > 0) return node;

  const python = pythonSteps(manifests.pyproject ?? null);
  if (python.length > 0) return python;

  if ((manifests.goMod ?? null) !== null) {
    return [{ id: "build", command: "go build ./...", service: false }];
  }
  if ((manifests.cargoToml ?? null) !== null) {
    return [{ id: "build", command: "cargo build --release", service: false }];
  }

  return staticSteps(manifests.indexHtml ?? null);
}

function nodeSteps(packageJson: string | null): AcceptanceStep[] {
  if (packageJson === null) return [];
  let scripts: Record<string, unknown> = {};
  try {
    scripts = ((JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts ?? {}) as Record<string, unknown>;
  } catch {
    return [];
  }

  const steps: AcceptanceStep[] = [{ id: "install", command: "npm install --no-audit --no-fund", service: false }];
  if (typeof scripts.build === "string") steps.push({ id: "build", command: "npm run build", service: false });
  if (typeof scripts.migrate === "string") steps.push({ id: "migrate", command: "npm run migrate", service: false });
  if (typeof scripts.start === "string") steps.push({ id: "start", command: "npm start", service: true });

  // Só install não prova nada sobre o produto.
  return steps.length > 1 ? steps : [];
}

/**
 * Para um pacote Python, aceitar é instalar e rodar o que ele declara.
 *
 * O ambiente virtual existe para que a aceitação não dependa de nada instalado
 * na máquina nem precise de sudo: o pacote tem de se instalar sozinho, a partir
 * do que foi commitado.
 */
function pythonSteps(pyproject: string | null): AcceptanceStep[] {
  if (pyproject === null) return [];

  const steps: AcceptanceStep[] = [
    { id: "venv", command: "python3 -m venv .venv-aceitacao", service: false },
    { id: "install", command: ".venv-aceitacao/bin/pip install --disable-pip-version-check -e .", service: false },
  ];

  /*
   * `[project.scripts]` declara os entrypoints do pacote. Leitura deliberadamente
   * rasa: o primeiro nome basta para provar que o console script foi instalado.
   *
   * O fim da seção é a próxima `[` OU o fim do texto, escrito `$(?![\s\S])`. Aqui
   * estava `\Z`, que em JavaScript não é âncora: é a letra Z. Num pyproject cujo
   * `[project.scripts]` fosse a ÚLTIMA seção — que é onde ele costuma estar — a
   * leitura devolvia vazio, o passo `start` sumia, e a aceitação de um projeto
   * Python terminava aprovando sem nunca ter executado o produto. A mesma
   * armadilha já tinha sido paga em `prerequisites.ts`, e esta ficou para trás:
   * a correção existindo num lugar e faltando no irmão.
   */
  const section = /^\[project\.scripts\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(pyproject)?.[1] ?? "";
  const entrypoint = /^\s*["']?([A-Za-z][A-Za-z0-9._-]*)["']?\s*=/m.exec(section)?.[1];
  if (entrypoint !== undefined) {
    steps.push({ id: "start", command: `.venv-aceitacao/bin/${entrypoint} --help`, service: true });
  }

  return steps;
}

/** Esta máquina: o sistema, e se há tela (no Linux, um DISPLAY ou um WAYLAND_DISPLAY). */
function estaPlataforma(): { sistema: NodeJS.Platform; tela: boolean } {
  const tela = process.platform !== "linux" || Boolean(process.env.DISPLAY) || Boolean(process.env.WAYLAND_DISPLAY);
  return { sistema: process.platform, tela };
}

/**
 * O aplicativo desktop .NET: compilar e iniciar, por 10 segundos (item 6 de
 * "atacar os pontos frágeis").
 *
 * A etapa 4 da redução tirou a prova fora do navegador, e o fluxo de um produto
 * de janela ficava sem prova nenhuma: o build terminava "verificação
 * inconclusiva", sempre. A prova que a plataforma dá é a mesma de um serviço:
 * o executável sobe e não termina com erro na janela, e a árvore de processos é
 * encerrada no fim. É de janela o projeto que diz isso no `.csproj` — WPF,
 * Windows Forms, WinUI, MAUI, Avalonia ou `WinExe`.
 *
 * Com alvo `net*-windows` fora do Windows, o projeto compila com
 * `-p:EnableWindowsTargeting=true`, e a execução não acontece: é "verificação
 * inconclusiva: plataforma", com esse motivo. O mesmo vale para o Linux sem
 * tela, onde nenhuma janela abre e a falha não diria nada do produto.
 */
function desktopDotnetSteps(projetos: readonly { caminho: string; conteudo: string }[], plataforma: { sistema: NodeJS.Platform; tela: boolean }): AcceptanceStep[] {
  const deJanela = projetos.find((projeto) =>
    /<(?:UseWPF|UseWindowsForms|UseWinUI|UseMaui)>\s*true\s*</iu.test(projeto.conteudo) ||
    /<OutputType>\s*WinExe\s*</iu.test(projeto.conteudo) ||
    /<PackageReference\s+Include="(?:Avalonia|Microsoft\.Maui[\w.]*)"/iu.test(projeto.conteudo),
  );
  if (!deJanela) return [];
  const alvoWindows = /<TargetFrameworks?>[^<]*\bnet[\d.]+-windows/iu.test(deJanela.conteudo);
  const foraDoWindows = plataforma.sistema !== "win32";
  const caminho = JSON.stringify(deJanela.caminho);
  return [
    { id: "build", command: `dotnet build ${caminho}${alvoWindows && foraDoWindows ? " -p:EnableWindowsTargeting=true" : ""}`, service: false },
    {
      id: "start",
      command: `dotnet run --no-build --project ${caminho}`,
      service: true,
      seconds: 10,
      desktop: true,
      ...((alvoWindows && foraDoWindows) || !plataforma.tela ? { inconclusiva: "plataforma" } : {}),
    },
  ];
}

export type CommandRunner = (command: string, cwd: string, seconds: number) => Promise<{ exitCode: number; output: string }>;

export const defaultRunner: CommandRunner = (command, cwd, seconds) =>
  new Promise((resolve) => {
    // Grupo próprio também aqui: um `npm run build` pode deixar watcher de pé, e
    // um passo que não termina segura o CLI do mesmo jeito que um serviço.
    const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: runtimeEnvironment() });
    let output = "";
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

    const encerrar = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(vigia);
      if (child.pid !== undefined) killTree(child.pid, "SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({ exitCode, output });
    };

    const vigia = setTimeout(() => {
      output += `\n[capivara] o passo excedeu ${seconds}s e foi encerrado`;
      encerrar(124);
    }, seconds * 1000);

    child.on("exit", (code, signal) => encerrar(code ?? (signal ? 124 : 1)));
    child.on("error", () => encerrar(127));
  });

/**
 * O entrypoint é aprovado por não falhar.
 *
 * Duas formas de passar, porque `npm start` significa coisas diferentes: um
 * servidor sobe e fica de pé; uma CLI roda e termina com código zero. As duas
 * são sucesso, e não há como saber de antemão qual delas o projeto é.
 *
 * Reprova só o que falha de verdade: código diferente de zero. Foi assim que a
 * aplicação do piloto 1 seria pega — ela caía na conexão com o banco — e é o que
 * evita reprovar uma CLI por ela fazer exatamente o que devia.
 */
export const serviceRunner: CommandRunner = (command, cwd, seconds) =>
  new Promise((resolve) => {
    /*
     * `detached` é o que torna o filho líder do próprio grupo, e sem isso a
     * morte não alcança os netos: o piloto 1b deixou um `node src/server.js`
     * rodando numa pasta temporária já apagada, com os pipes abertos, e o CLI
     * ficou preso porque o Node não encerra enquanto houver handle vivo.
     *
     * `npm start` cria pelo menos dois níveis — bash, npm, node — então matar o
     * filho direto nunca bastou.
     */
    const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: runtimeEnvironment() });
    let output = "";
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

    const encerrar = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(vigia);

      if (child.pid !== undefined) {
        killTree(child.pid, "SIGTERM");
        const duro = setTimeout(() => {
          if (child.pid !== undefined) killTree(child.pid, "SIGKILL");
        }, 1500);
        duro.unref();
      }

      // Solta os pipes: enquanto eles vivem, o event loop do CLI não termina.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();

      resolve({ exitCode, output });
    };

    // Sobreviveu à janela inteira: é um serviço e está de pé.
    const vigia = setTimeout(() => encerrar(0), seconds * 1000);

    // Terminou sozinho: vale o código com que terminou. Zero é uma CLI que fez o
    // seu trabalho; diferente de zero é um entrypoint que não sobe.
    child.on("exit", (code, signal) => encerrar(code ?? (signal ? 1 : 0)));
    child.on("error", () => encerrar(127));
  });

export interface AcceptanceOptions {
  projectRoot: string;
  /** Segundos por passo; o serviço usa a janela menor de estabilidade. */
  stepSeconds?: number;
  serviceSeconds?: number;
  runner?: CommandRunner;
  service?: CommandRunner;
  /** Desligar a cópia só existe para teste; um run de verdade sempre copia. */
  cleanRoom?: boolean;
  /**
   * Os fluxos essenciais percorridos na sala limpa, depois dos passos, pelos
   * meios da plataforma (etapa 4 da redução). Ausente: o projeto não tem fluxos,
   * ou o build roda sem eles.
   */
  smoke?: (room: string, contexto: { desktopSubiu: boolean }) => Promise<ResultadoDoSmoke>;
  /** O sistema e se há tela; ausente é esta máquina. Existe para teste, como `runner` e `service`. */
  plataforma?: { sistema: NodeJS.Platform; tela: boolean };
}

async function lerManifesto(projectRoot: string, nome: string): Promise<string | null> {
  return readFile(join(projectRoot, nome), "utf8").catch(() => null);
}

/** Os `.csproj` da raiz e de até duas pastas abaixo, fora das de build, dependências e testes. */
async function projetosDotnet(projectRoot: string): Promise<{ caminho: string; conteudo: string }[]> {
  const fora = new Set([...EXCLUDED, "bin", "obj", "test", "tests"]);
  const achados: { caminho: string; conteudo: string }[] = [];
  const visitar = async (relativo: string, profundidade: number): Promise<void> => {
    const entradas = await readdir(join(projectRoot, relativo), { withFileTypes: true }).catch(() => []);
    for (const entrada of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      const caminho = relativo === "" ? entrada.name : `${relativo}/${entrada.name}`;
      if (entrada.isFile() && entrada.name.endsWith(".csproj")) {
        const conteudo = await readFile(join(projectRoot, caminho), "utf8").catch(() => null);
        if (conteudo !== null) achados.push({ caminho, conteudo });
      } else if (entrada.isDirectory() && profundidade < 2 && !fora.has(entrada.name) && !/\.tests?$/iu.test(entrada.name)) {
        await visitar(caminho, profundidade + 1);
      }
    }
  };
  await visitar("", 0);
  return achados;
}

async function manifestosDe(projectRoot: string): Promise<Manifests> {
  return {
    packageJson: await lerManifesto(projectRoot, "package.json"),
    pyproject: await lerManifesto(projectRoot, "pyproject.toml"),
    goMod: await lerManifesto(projectRoot, "go.mod"),
    cargoToml: await lerManifesto(projectRoot, "Cargo.toml"),
    indexHtml: await lerManifesto(projectRoot, "index.html"),
    dotnet: await projetosDotnet(projectRoot),
  };
}

/**
 * Como a aplicação sobe, para quem precisa dela de pé — o smoke dos fluxos.
 *
 * Reusa a derivação da aceitação em vez de adivinhar de novo: o passo `service`
 * é, por definição, o que fica de pé. O build vem junto quando existe, porque um
 * produto compilado servido a partir de código velho responde e engana.
 */
export async function startCommandFor(projectRoot: string): Promise<string | null> {
  const steps = deriveAcceptance(await manifestosDe(projectRoot));

  // O executável de janela não é servidor: o percurso dos fluxos não o sobe.
  const service = steps.find((step) => step.service && step.desktop !== true);
  if (!service) return null;

  const build = steps.find((step) => step.id === "build");
  return build ? `${build.command} && ${service.command}` : service.command;
}

export async function runAcceptance(options: AcceptanceOptions): Promise<AcceptanceResult> {
  const steps = deriveAcceptance({ ...(await manifestosDe(options.projectRoot)), ...(options.plataforma !== undefined ? { plataforma: options.plataforma } : {}) });

  if (steps.length === 0 && !options.smoke) {
    return { accepted: true, steps: [], skipped: "o projeto não declara um ecossistema com build, instalação ou entrypoint: nada a aceitar operacionalmente" };
  }

  const runner = options.runner ?? defaultRunner;
  const service = options.service ?? serviceRunner;
  const stepSeconds = options.stepSeconds ?? 600;
  const serviceSeconds = options.serviceSeconds ?? 8;

  const room =
    options.cleanRoom === false
      ? options.projectRoot
      : await mkdtemp(join(tmpdir(), "capivara-aceitacao-"));

  try {
    if (room !== options.projectRoot) {
      await cp(options.projectRoot, room, {
        recursive: true,
        filter: (source) => !source.split("/").some((part) => EXCLUDED.has(part)),
      });

      /*
       * O ambiente da cópia sai do exemplo versionado, nunca do `.env` real.
       *
       * Sem isto, um produto que lê a conexão do ambiente não sobe na cópia
       * limpa e a aceitação reprovaria por falta de configuração — que é defeito
       * de ambiente cobrado como defeito de produto, o §34.8 de novo.
       */
      const exemplo = await readFile(join(options.projectRoot, ".env.example"), "utf8").catch(() => null);
      if (exemplo !== null) await writeFile(join(room, ".env"), exemplo, "utf8");
    }

    const results: StepResult[] = [];
    const inconclusivas: string[] = [];
    let desktopSubiu = false;
    for (const step of steps) {
      if (step.inconclusiva !== undefined) {
        inconclusivas.push(`aceitação · o passo "${step.id}" (${step.command}) não rodou nesta máquina: verificação inconclusiva: ${step.inconclusiva}`);
        continue;
      }
      const executar = step.service ? service : runner;
      const { exitCode, output } = await executar(step.command, room, step.seconds ?? (step.service ? serviceSeconds : stepSeconds));
      results.push({ id: step.id, command: step.command, exitCode, output });
      if (step.desktop === true && exitCode === 0) desktopSubiu = true;

      if (exitCode !== 0) {
        return {
          accepted: false,
          steps: results,
          failure: {
            id: step.id,
            cause:
              `A aceitação operacional falhou no passo "${step.id}" (${step.command}), numa cópia limpa do projeto` +
              ` — código ${exitCode}. Saída:\n${output.split("\n").slice(-60).join("\n").trim()}`,
            natureza: "produto",
          },
        };
      }
    }

    if (!options.smoke) return { accepted: true, steps: results, skipped: "", ...(inconclusivas.length > 0 ? { pendencias: inconclusivas } : {}) };
    const smoke = await options.smoke(room, { desktopSubiu });
    if (!smoke.ok) return { accepted: false, steps: results, failure: { id: smoke.id, cause: smoke.cause, natureza: smoke.natureza } };
    const pendencias = [...inconclusivas, ...smoke.pendencias];
    return { accepted: true, steps: results, skipped: "", ...(pendencias.length > 0 ? { pendencias } : {}) };
  } finally {
    if (room !== options.projectRoot) await rm(room, { recursive: true, force: true });
  }
}

/**
 * Aplicação que roda direto no navegador, sem build nem servidor.
 *
 * O piloto 4 entregou exatamente isso — `index.html` mais módulos e CSS — e a
 * aceitação foi pulada inteira: "o projeto não declara um ecossistema com build,
 * instalação ou entrypoint". Um produto que funciona saiu sem nenhuma prova
 * operacional, e teria saído igual se o `index.html` referenciasse um arquivo
 * que a cópia limpa não tem.
 *
 * Não há servidor para subir nem processo para ficar de pé, então a prova é
 * outra: a página existe e tudo o que ela pede existe junto. É pouco, mas é
 * exatamente o que quebra numa cópia limpa — e é o que o gate 2 não vê, porque
 * a suíte testa módulos, não a montagem da página.
 */
function staticSteps(indexHtml: string | null): AcceptanceStep[] {
  if (indexHtml === null || indexHtml.trim() === "") return [];

  /*
   * Referência local, não remota: `https://…` é responsabilidade de quem
   * publica, e âncora (`#`) não é arquivo. `set -e` faria o `for` abortar antes
   * da mensagem, então o erro é reportado por quem o encontra.
   */
  const verificaAssets = [
    "referencias=$(grep -oE '(src|href)=\"[^\"]+\"' index.html",
    "| sed -E 's/.*=\"([^\"]+)\"/\\1/'",
    "| grep -vE '^(https?:)?//' | grep -v '^#' | grep -v '^data:' | sort -u)",
    "; faltando=0",
    "; for referencia in $referencias; do",
    "  arquivo=${referencia%%[?#]*}",
    "; [ -f \"$arquivo\" ] || { echo \"index.html aponta para $arquivo, que não existe na cópia limpa\"; faltando=1; }",
    "; done",
    "; [ $faltando -eq 0 ] && echo \"index.html e todos os arquivos que ele referencia existem\"",
  ].join(" ");

  return [{ id: "página", command: verificaAssets, service: false }];
}
