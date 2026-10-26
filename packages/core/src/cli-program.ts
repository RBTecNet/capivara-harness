import { stat } from "node:fs/promises";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import { listProviders, renderProviderList } from "./commands/providers.js";
import { diagnose, renderDiagnosis } from "./commands/doctor.js";
import { DEFAULT_LIMITS, createAgentBridge } from "./commands/agent.js";
import { FLOW_REVIEWS } from "./provider/flow-review.js";
import { ensureApiCredential, registerApiLogin } from "./commands/api-login.js";
import { createPrivateLineInput } from "./commands/private-input.js";
import { BUILD_ROLES, INIT_ROLES, describeRoles, renderUnresolved, rolesFromFlags, unresolvedRoles, type CliRoleFlags } from "./commands/options.js";
import {
  InitBlockedError,
  baseRegistrada,
  readArchitectureState,
  readRequestState,
  readSkeletonState,
  requestFromLibrary,
  requestFromPrompt,
  resolveRequest,
  runInit,
  runPlan,
} from "./init/index.js";
import { configuredMcpUrl, resolveMcpEndpoint, resolveMcpProject, createMcpClient, enviarLevantamento, projetoExiste, fetchProjectMaterial, listLibraryProjects, registrarMemorias, type MemoriaParaRegistrar } from "./mcp/index.js";
import type { McpClient, ProjectMaterial } from "./mcp/index.js";
import type { InitOptions } from "./init/index.js";
import { commitSpecification, iniciarRepositorio, relatorioDoBuild, runBuild } from "./loop/index.js";
import type { EscolhaNumerada } from "./loop/index.js";
import {
  BACK,
  BuildPhaseTracker,
  WorkerTracker,
  PLAN_COLUMNS,
  PLAN_LEGEND,
  PlanPhaseTracker,
  apresentarConclusao,
  apresentarParada,
  HarnessProgress,
  createLiveRegion,
  detectLanguage,
  UBUNTU_AUBERGINE,
  paint,
  abrirModal,
  interactiveQuestionBox,
  interviewChoices,
  questionBox,
  renderAnswerContext,
  renderDashboard,
  renderQuestion,
  renderSplash,
  supportsColor,
  supportsTrueColor,
} from "./tui/index.js";
import type { Choice, EntradaDeTeclado, InterviewInput, Janela, Parada, SaidaDeTela } from "./tui/index.js";
import { paradaDeProntidao, paradaDoEstagio, type Estagio } from "./commands/paradas.js";
import { runWizard, runWizardDePapeis, runWizardDoPedido } from "./commands/wizard.js";
import { InputEndedError, PerguntaRetiradaError, createLineIO } from "./commands/line-io.js";
import { chooseInBox, createKeyPrompter, createKeySession } from "./commands/key-io.js";
import type { KeySession } from "./commands/key-io.js";
import { escolhaDaMudanca, escolhaDeColisao, respostaDaMudanca } from "./commands/escolhas-sem-painel.js";
import { PauseGate, modalDaFase, teclasDoBuild, textoDaFase } from "./commands/build-controls.js";
import { disponibilidadeDoParalelo, estrategiaSalva, larguraDoPlanoNaPasta, prepararExecucao } from "./commands/execucao.js";
import { ARQUIVO_DE_EXECUCAO, gravarArquivoDeExecucao } from "./config/execucao.js";
import type { WorkerProgress } from "./loop/progress.js";
import { teclaNaCaixaDeAgentes } from "./tui/build-workers.js";
import { LogsDosAgentes, descreverEventoDoAgente, descreverProgressoDaFase } from "./tui/worker-logs.js";
import { abrirPainel, reduzirPainel, renderPainelDoAgente, type Medidas as MedidasDoPainel } from "./tui/worker-log-panel.js";
import { KeyDecoder } from "./tui/keys.js";
import { box } from "./tui/dashboard.js";
import { renderSelect, type SelectSpec } from "./tui/select.js";
import type { WizardIO } from "./commands/wizard.js";
import type { LineIO } from "./commands/line-io.js";
import { contratoDaRetomada, isCliProvider, isDirectProvider, listarDicas, listarEfforts, listarModelos } from "./provider/index.js";
import type { RoleName } from "./provider/index.js";
import { runIdFor, runPaths, safeProjectPath, writeAtomic } from "./state/index.js";
import { architectureViewForPhase, sha12, type DecisaoDeEscopo } from "./contract/index.js";
import { conferirReparosNaEntrada } from "./loop/upstream.js";
import { MAX_DOMINIOS, SurveyBlockedError, runSurvey } from "./survey/index.js";
import { ChangeBlockedError, renderQuestion as renderPerguntaDaMudanca, runChange } from "./change/index.js";
import type { DecisaoDeColisao } from "./survey/index.js";
import { VERSION } from "./version.js";
import { registerConfigCommand } from "./commands/config.js";
import { PromptEngineerError, engineerPrompt, promptLanguage } from "./prompt-engineer/index.js";
import { renderCommand } from "./tui/wizard.js";

interface CommonFlags extends CliRoleFlags {
  project?: string;
  language?: string;
  splash?: boolean;
  modal?: boolean;
}

function style() {
  return { enabled: supportsColor() };
}

/**
 * A sessão de teclas de um comando sem painel (`change`, `survey`).
 *
 * Abre no começo do comando, como a do build: tecla batida enquanto o modelo
 * trabalha ficaria no buffer do terminal e responderia a pergunta no instante em
 * que ela abrisse. Sem TTY ou com `CAPIVARA_LINE_INPUT=1`, nenhuma — e quem
 * pergunta usa a leitura de linha de sempre.
 */
function abrirTeclas(): KeySession | null {
  if (stdin.isTTY !== true || stdout.isTTY !== true || process.env.CAPIVARA_LINE_INPUT === "1") return null;
  return createKeySession({ input: stdin, write: (texto) => void stdout.write(texto), columns: () => stdout.columns ?? 100 });
}

/** A escolha embaixo do que já está na tela, com as medidas do terminal deste processo. */
function escolherEmbaixo(teclas: KeySession, title: string, text: readonly string[], choices: readonly Choice[], defaultIndex = 0): Promise<number> {
  return chooseInBox(teclas, {
    title,
    text,
    choices,
    defaultIndex,
    write: (texto) => void stdout.write(texto),
    dimensions: () => ({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 40 }),
    style: style(),
  });
}

/**
 * A entrada dos wizards.
 *
 * Com uma pessoa no terminal — entrada E saída em TTY —, a escolha é uma lista
 * com cursor dentro da moldura do painel (`key-io.ts`). Em pipe, arquivo, CI ou
 * `CAPIVARA_LINE_INPUT=1`, é a leitura de linha numerada de sempre: um roteiro
 * escrito para o wizard continua respondendo do mesmo jeito.
 */
function abrirEntradaDoWizard(subtitulo: string): { io: WizardIO; close: () => void; teclas: boolean } {
  if (stdin.isTTY === true && stdout.isTTY === true && process.env.CAPIVARA_LINE_INPUT !== "1") {
    const teclas = createKeyPrompter({
      input: stdin,
      write: (texto) => void stdout.write(texto),
      dimensions: () => ({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 40 }),
      style: style(),
      version: VERSION,
      subtitle: subtitulo,
      environment: process.env,
      onResize: (listener) => {
        stdout.on("resize", listener);
        return () => void stdout.off("resize", listener);
      },
    });
    return { io: teclas, close: () => teclas.close(), teclas: true };
  }
  return { ...createPrivateLineInput(stdin, stdout), teclas: false };
}

/**
 * Onde a parada é mostrada.
 *
 * O terminal é o mesmo objeto de sempre; o que muda é que agora alguém pode
 * dizer que não quer a telinha — `--no-modal`, ou `CAPIVARA_MODAL=never` para
 * quem roda o harness dentro de outra ferramenta. Sem TTY nada disso importa: o
 * modal não abre e o texto puro sai igual.
 */
function janela(flags: { modal?: boolean }): Janela {
  const semModal = flags.modal === false || process.env.CAPIVARA_MODAL === "never";
  return {
    entrada: stdin as unknown as EntradaDeTeclado,
    saida: stdout as unknown as SaidaDeTela,
    style: style(),
    ...(semModal ? { semModal: true } : {}),
  };
}

/**
 * O teto de linhas de fase que o painel recebe.
 *
 * É teto de PEDIDO, não de desenho: o painel encolhe até caber na altura do
 * terminal. Existe só para um plano de cinquenta fases não fazer o laço de
 * ajuste renderizar cinquenta vezes.
 */
const MAX_LINHAS_DE_FASE = 30;

/** Quantas linhas do log a telinha carrega. O resto está no arquivo. */
const LINHAS_DE_EVIDENCIA = 5_000;

/**
 * A primeira evidência que existe em disco, lida para dentro da telinha.
 *
 * Só a primeira: os caminhos vêm em ordem de utilidade, e o log do gate que
 * reprovou explica a parada melhor do que o `events.tsv` inteiro.
 */
async function lerEvidencia(projectRoot: string, caminhos: readonly string[] | undefined): Promise<string[]> {
  for (const caminho of caminhos ?? []) {
    const conteudo = await readFile(resolve(projectRoot, caminho), "utf8").catch(() => null);
    if (conteudo === null || conteudo.trim() === "") continue;
    const linhas = conteudo.trimEnd().split("\n");
    return linhas.length > LINHAS_DE_EVIDENCIA
      ? [`(as primeiras ${linhas.length - LINHAS_DE_EVIDENCIA} linha(s) estão só em ${caminho})`, ...linhas.slice(-LINHAS_DE_EVIDENCIA)]
      : linhas;
  }
  return [];
}

/**
 * O que faltou no comando, perguntado em vez de recusado.
 *
 * Quem escreveu `capivara init --fresh` já disse o estágio, a pasta e o pedido.
 * Faltou dizer com que modelo — e a resposta do harness era recusar o comando
 * inteiro e imprimir as duas formas de passar a flag, o que manda a pessoa
 * reescrever tudo o que ela já tinha escrito.
 *
 * Agora ele pergunta só o que falta, e só para os papéis que ESTE comando usa.
 * Sem terminal — CI, pipe, `ssh` sem tty — nada muda: a mensagem completa sai
 * como antes, porque um comando que abre pergunta num CI é um comando que trava.
 */
async function completarPapeis<T extends CliRoleFlags>(comando: string, faltando: readonly string[], flags: T): Promise<T | null> {
  if (stdin.isTTY !== true) return null;

  const entrada = abrirEntradaDoWizard(`${comando} · falta o modelo`);
  try {
    const escolha = await runWizardDePapeis({
      io: entrada.io,
      cwd: process.cwd(),
      comando,
      faltando: faltando as RoleName[],
      current: rolesFromFlags(flags),
      listModels: (providerId) => listarModelos(providerId, process.env, undefined, (message) => entrada.io.write(`${message}\n`)),
      listEfforts: (providerId, model) => listarEfforts(providerId, model),
      listModelHints: (providerId) => listarDicas(providerId),
      ...mundoDoWizard(),
    });
    if (escolha === null) return null;

    const completo = { ...flags } as Record<string, unknown>;
    for (const [chave, valor] of Object.entries(escolha.global)) if (valor) completo[chave] = valor;
    for (const [papel, escolhido] of Object.entries(escolha.roles)) {
      if (escolhido?.provider) completo[`${papel}Provider`] = escolhido.provider;
      if (escolhido?.model) completo[`${papel}Model`] = escolhido.model;
    }
    return completo as T;
  } finally {
    entrada.close();
  }
}

/**
 * O que o wizard precisa do mundo: disco e base documental.
 *
 * Um lugar só porque há três entradas para o wizard — o completo, o atalho dos
 * papéis e o atalho do pedido — e a primeira coisa que divergiu quando o atalho
 * nasceu foi justamente isto: o atalho do pedido não recebia as funções da base,
 * e as duas origens que dependem dela sumiam da lista sem nenhum aviso.
 */
function mundoDoWizard() {
  const cliente = (url: string) => createMcpClient(resolveMcpEndpoint(url)!, { timeoutSeconds: 15 });
  const defaultMcpUrl = configuredMcpUrl();
  return {
    configureApi: ensureApiCredential,
    /*
     * O wizard conecta de verdade para listar os projetos. Perguntar o nome do
     * projeto num campo livre deixaria o erro de digitação para o run descobrir;
     * aqui ele custa uma mensagem.
     */
    listMcpProjects: async (url: string) => {
      const client = cliente(url);
      await client.initialize();
      return listLibraryProjects(client);
    },
    listMcpPrompts: async (url: string) => {
      const client = cliente(url);
      await client.initialize();
      return await client.listPrompts();
    },
    readMcpPrompt: async (url: string, name: string) => {
      const client = cliente(url);
      await client.initialize();
      return await client.prompt(name);
    },
    ...(defaultMcpUrl ? { defaultMcpUrl } : {}),
    // O passo de estratégia do build (§97): o que está salvo, se o paralelo roda aqui, e a largura do plano.
    readExecution: estrategiaSalva,
    parallelAvailability: disponibilidadeDoParalelo,
    planWidth: larguraDoPlanoNaPasta,
    fileExists: (path: string) => stat(path).then((info) => info.isFile()).catch(() => false),
    directoryExists: (path: string) => stat(path).then((info) => info.isDirectory()).catch(() => false),
  };
}

/**
 * O pedido, perguntado quando ele não veio.
 *
 * `capivara init --fresh --provider codex` é um comando completo menos uma
 * coisa: o que construir. A resposta era um `EmptyRequestError` com stack trace
 * — o pior desfecho possível, porque parece defeito do harness e não pergunta
 * nada. Agora ele pergunta, com as mesmas origens do wizard.
 */
async function completarPedido(comando: string, projectRoot = process.cwd()): Promise<{ prompt?: string; file?: string; mcp?: string; mcpProject?: string } | null> {
  if (stdin.isTTY !== true) return null;

  const entrada = abrirEntradaDoWizard(`${comando} · falta o pedido`);
  try {
    const escolhido = await runWizardDoPedido({
      io: entrada.io,
      cwd: projectRoot,
      comando,
      ...mundoDoWizard(),
    });
    if (escolhido === null) return null;
    return {
      ...(escolhido.request !== undefined ? { prompt: escolhido.request } : {}),
      ...(escolhido.requestFile !== undefined ? { file: escolhido.requestFile } : {}),
      ...(escolhido.mcpUrl !== undefined ? { mcp: escolhido.mcpUrl } : {}),
      ...(escolhido.mcpProject !== undefined ? { mcpProject: escolhido.mcpProject } : {}),
    };
  } finally {
    entrada.close();
  }
}

/** Imprime a parada no formato único, com a telinha quando há terminal. */
async function mostrarParada(parada: Parada, projectRoot: string, flags: { modal?: boolean }): Promise<void> {
  await apresentarParada(parada, await lerEvidencia(projectRoot, parada.evidencia), janela(flags));
}

function roleFlags(command: Command, roles = ["writer", "auditor", "builder", "verifier"], languageDescription = "idioma da interface e dos documentos"): Command {
  command
    .option("--provider <id>", "provider padrão de todos os papéis")
    .option("--model <id>", "modelo padrão de todos os papéis")
    .option("--effort <nivel>", "intensidade de raciocínio; omitido significa desligado")
    .option("--credential <id>", "credencial salva, para providers de API direta")
    .option("--adapter <caminho>", "executável do adapter custom");
  for (const role of roles) {
    command
      .option(`--${role}-provider <id>`, `provider do papel ${role}`)
      .option(`--${role}-model <id>`, `modelo do papel ${role}`)
      .option(`--${role}-effort <nivel>`, `effort do papel ${role}`);
  }
  return command
    .option("--project <caminho>", "raiz do projeto", ".")
    .option("--language <idioma>", languageDescription)
    .option("--no-splash", "não mostra a abertura")
    .option("--no-modal", "não abre a telinha de parada; só o texto");
}

/**
 * `--ver` é apelido de `--version`.
 *
 * Não dá para declarar os dois no mesmo `.version()`: o commander recusa duas
 * flags longas na mesma opção. E declarar `--ver` como opção à parte a faria
 * aparecer duas vezes na ajuda, dizendo a mesma coisa. Traduzir no argv resolve
 * antes de o parser existir, que é onde um apelido pertence.
 */
export function withVersionAlias(argv: readonly string[]): string[] {
  return argv.map((argumento) => (argumento === "--ver" ? "--version" : argumento));
}

/**
 * O painel e as perguntas dos estágios documentais e do Prompt Engineer.
 *
 * `init` e `plan` são o mesmo orquestrador com estágios diferentes, e por isso
 * têm exatamente a mesma superfície interativa: o mesmo painel, a mesma janela
 * de log, a mesma caixa de pergunta, o mesmo impasse.
 *
 * Enquanto cada comando montava a sua, só o `init` tinha painel. O `plan` — que
 * é o estágio LONGO, dezenas de chamadas contra uma — escrevia linhas soltas e
 * ficava minutos calado durante cada fase, sem custo, sem papel ativo, sem
 * pulso. O estágio caro era o que menos mostrava o que estava acontecendo.
 *
 * Construir isto uma vez é o que garante que a próxima melhoria de painel chegue
 * nos dois: duas cópias divergem na primeira correção aplicada a uma só.
 */
function estagioInterativo(options: {
  estagio: "init" | "plan" | "prompt-engineer";
  projectRoot: string;
  runId: string;
  language: string;
  roles: ReturnType<typeof rolesFromFlags>;
  comPainel: boolean;
  /** O documento ou ferramenta apresentado na caixa da pergunta. */
  documento: string;
  /** O wizard já abriu a entrada; manter a fila preserva as respostas por pipe. */
  entrada?: LineIO;
}) {
  const { projectRoot, runId, roles, comPainel } = options;
  const engenharia = options.estagio === "prompt-engineer";
  const bridge = createAgentBridge({ projectRoot, runId, language: options.language, roles, limits: DEFAULT_LIMITS });
  /*
   * Com o painel na tela e uma pessoa no terminal, a resposta é escolhida
   * DENTRO da caixa da pergunta, por tecla (§93). A sessão de teclas é dona do
   * stdin enquanto o estágio roda — um readline aberto ao mesmo tempo leria as
   * mesmas teclas como linha —, e as demais perguntas do estágio passam pela
   * pergunta em linha dela.
   */
  const teclas =
    !options.entrada && comPainel && stdin.isTTY === true && stdout.isTTY === true && process.env.CAPIVARA_LINE_INPUT !== "1"
      ? createKeySession({ input: stdin, write: (text) => void stdout.write(text), columns: () => stdout.columns ?? 100 })
      : null;
  const terminal = options.entrada || teclas ? null : createInterface({ input: stdin, output: stdout });

  /*
   * A leitura é enfileirada, não `terminal.question()` direto: entrada vinda de
   * pipe ou arquivo chega inteira antes da primeira pergunta, o readline fecha
   * no fim dela, e a pergunta seguinte estoura em ERR_USE_AFTER_CLOSE.
   */
  const linhas = options.entrada ?? teclas?.line ?? createLineIO(terminal!, (text) => void stdout.write(text), { interactive: stdin.isTTY === true });
  const perguntar = async (prompt: string, decision: string, signal?: AbortSignal): Promise<string> => {
    try {
      return await linhas.ask(prompt, signal);
    } catch (error) {
      if (!(error instanceof InputEndedError)) throw error;
      if (engenharia) {
        throw new PromptEngineerError(`A entrada terminou antes de responder: ${decision}\nRode o mesmo comando num terminal ou forneça as respostas por pipe.`);
      }
      throw new InitBlockedError(
        [
          "A entrada terminou e ainda falta uma decisão:",
          "",
          `  ${decision}`,
          "",
          `Nada do que já foi publicado se perdeu: rode \`capivara ${options.estagio}\` para continuar.`,
        ].join("\n"),
        runId,
      );
    }
  };

  /*
   * O painel observa e nunca altera: ele lê os eventos que o orquestrador já
   * grava e se redesenha no lugar. Sem terminal, não desenha nada — as linhas de
   * progresso continuam sendo a saída, e o log segue legível.
   */
  const progress = new HarnessProgress({
    version: VERSION,
    command: options.estagio,
    project: basename(resolve(projectRoot)),
    roles: describeRoles(roles).filter((role) => engenharia ? role.role === "writer" : (INIT_ROLES as readonly string[]).includes(role.role)),
    provider: {
      perfil: `${roles.writer.provider}${roles.writer.model ? `:${roles.writer.model}` : ""}`,
      transporte: `${roles.writer.provider}-cli`,
      contabilidade: "por chamada",
    },
    style: style(),
    environment: process.env,
  });

  const live = createLiveRegion((text) => void stdout.write(text), comPainel, () => ({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 40 }));

  // A largura é lida a cada desenho: redimensionar a janela ajusta o painel na
  // repintura seguinte, sem precisar ouvir evento de resize.
  const larguraAtual = (): number => stdout.columns ?? 100;

  /*
   * O fundo só é pintado onde há cor verdadeira: em 16 cores, um tom escuro vira
   * um bloco chapado que atrapalha mais do que ajuda. CAPIVARA_BG troca o tom, e
   * "none" devolve o fundo do terminal.
   */
  const fundo = ((): string | undefined => {
    const escolhido = process.env.CAPIVARA_BG?.trim();
    if (escolhido === "none") return undefined;
    if (!supportsTrueColor(process.env)) return undefined;
    return escolhido && escolhido !== "" ? escolhido : UBUNTU_AUBERGINE;
  })();

  const desenhar = semDerrubarORun(
    () =>
      renderDashboard({
        ...progress.model(),
        width: larguraAtual(),
        height: stdout.rows ?? 40,
        ...(fundo !== undefined ? { background: fundo } : {}),
      }),
    VERSION,
  );
  const repaint = (): void => live.draw(desenhar());

  // O pulso é o que separa "trabalhando" de "morto" na tela.
  live.beat(() => {
    progress.tick();
    return desenhar();
  });

  const announce = (message: string): void => {
    progress.note(message.trim());
    if (live.enabled) repaint();
    else stdout.write(`${message}\n`);
  };

  /*
   * A tela de fases do `plan`.
   *
   * O `init` desenha o painel sem ela: ele não tem fases ainda, e uma tabela
   * vazia só ocuparia espaço. O `plan` é o estágio longo — dezenas de chamadas,
   * minutos calado dentro de cada uma — e era o que não mostrava nada além de
   * log passando.
   */
  const fases = new PlanPhaseTracker();
  const onPhaseProgress: NonNullable<InitOptions["onPhaseProgress"]> = (evento) => {
    fases.apply(evento);
    /*
     * Pede a tabela INTEIRA; quem corta é o painel.
     *
     * O teto era 12, fixo, e num plano de 18 fases isso deixava seis de fora
     * para sempre — com a janela presa no fim durante a auditoria, que roda em
     * paralelo e não tem "a fase corrente" para seguir. O painel já sabe
     * encolher linha a linha até caber na altura do terminal, então pedir tudo
     * mostra tudo em quem tem tela, e o corte continua existindo em quem não
     * tem.
     */
    if (!fases.vazio) progress.setPhases(fases.rows(), fases.summary(), MAX_LINHAS_DE_FASE, PLAN_COLUMNS, PLAN_LEGEND, fases.foco);
    if (evento.kind === "documento") progress.setStage(evento.etapa);
    repaint();
  };

  const onProgress: NonNullable<InitOptions["onProgress"]> = (evento) => {
    // O nome do produto vem do documento que o nomeia, assim que ele existe.
    if (evento.stage === "publish" && evento.subject === "skeleton") {
      readFile(join(projectRoot, ".capivara", "init", "skeleton.md"), "utf8")
        .then((conteudo) => {
          const titulo = /^#\s+(.+?)\s+—/m.exec(conteudo)?.[1];
          if (titulo) progress.setProject(titulo);
        })
        .catch(() => undefined);
    }
    repaint();
  };

  const call: InitOptions["call"] = async (chamada) => {
    const quem = engenharia
      ? chamada.stage === "authoring"
        ? "organizando o prompt estruturado"
        : chamada.subject === "prompt-engineer" ? "analisando lacunas do pedido" : "interpretando sua resposta"
      : `${chamada.role} · ${chamada.subject.replace(/\.md$/, "")}`;
    if (engenharia) progress.setStage(chamada.stage === "authoring" ? "authoring" : chamada.subject === "prompt-engineer" ? "analysis" : "interview");
    progress.beginCall(quem);
    repaint();
    const response = await bridge({
      role: chamada.role,
      stage: engenharia ? `prompt-engineer:${chamada.stage}` : chamada.stage,
      prompt: chamada.prompt,
      // A janela de log recebe o que a CLI conta enquanto trabalha; sem isso o
      // terminal fica com cara de travado durante minutos.
      onActivity: (line) => {
        progress.modelActivity(`${quem}: ${line}`);
        progress.note(`${quem}: ${line}`);
        repaint();
      },
    });
    progress.charge(response.usage);
    repaint();
    if (engenharia && (response.timedOut || response.engineError || response.exitCode !== 0)) {
      throw new PromptEngineerError(`O escritor falhou em ${chamada.stage}${response.timedOut ? ` (${response.timedOut})` : ` (código ${response.exitCode})`}.\n${response.stderr || response.stdout}`);
    }
    return {
      stdout: response.exitCode !== 0 ? [response.stdout, response.stderr].filter(Boolean).join("\n") : response.stdout,
      exitCode: response.exitCode,
      // O fato do envelope viaja como campo: é o orquestrador quem decide que
      // erro do motor não é resposta (HANDOFF §16).
      ...(response.engineError ? { engineError: true } : {}),
      ...(response.timedOut ? { timedOut: response.timedOut } : {}),
      ...(response.partialOutput ? { partialOutput: response.partialOutput } : {}),
      ...(response.usage
        ? {
            usage: {
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              ...(response.usage.costUsd !== undefined ? { costUsd: response.usage.costUsd } : {}),
            },
          }
        : {}),
    };
  };

  /*
   * A pergunta com prazo (o `plan`) pode ser retirada antes da resposta: o
   * `signal` aborta, a leitura pendente rejeita e a pergunta sai da tela — a
   * próxima tecla ou linha é da pergunta seguinte.
   */
  const ask: InitOptions["ask"] = async (question, index, total, opcoes) => {
    const sinal = opcoes?.signal;
    const retirar = (): void => teclas?.retirar();
    sinal?.addEventListener("abort", retirar, { once: true });
    try {
      return await perguntarAoDesenvolvedor(question, index, total, sinal);
    } catch (error) {
      if (!(error instanceof PerguntaRetiradaError)) throw error;
      progress.note("(sem resposta no prazo: o plan seguiu com a leitura recomendada)");
      return "";
    } finally {
      sinal?.removeEventListener("abort", retirar);
    }
  };

  const perguntarAoDesenvolvedor = async (question: Parameters<InitOptions["ask"]>[0], index: number, total: number, sinal?: AbortSignal): Promise<string> => {
    /*
     * Sem terminal não há a quem perguntar. Oferecer a pergunta a uma entrada
     * que não existe termina em ERR_USE_AFTER_CLOSE do readline — stack trace no
     * lugar de diagnóstico, no fim de horas de trabalho. Foi o que derrubou um
     * run inteiro do piloto 3 numa única pergunta.
     */
    if (stdin.isTTY !== true && !engenharia) {
      throw new InitBlockedError(
        [
          "O escritor precisa de uma decisão para seguir e não há terminal para perguntar:",
          "",
          `  ${question.decision}`,
          "",
          ...(question.options.length > 0
            ? question.options.map((option, posicao) => `  ${posicao + 1}) ${option.label}`)
            : ["  (pergunta aberta)"]),
          "",
          "Rode o mesmo comando num terminal para responder. Nada do que já foi publicado se perdeu.",
        ].join("\n"),
        runId,
      );
    }

    /*
     * A pergunta é desenhada DENTRO do painel, no lugar da janela de log —
     * enquanto a vez é do desenvolvedor não há nada acontecendo para registrar
     * ali. A linha de resposta fica colada embaixo da moldura, fora dela de
     * propósito: um painel que se repinta por cima de um prompt de leitura come
     * o que a pessoa está digitando.
     */
    if (engenharia) progress.setStage("interview");
    progress.waitingForDeveloper();
    if (live.enabled && teclas) {
      const screen = { question, index, total, document: options.documento, style: style() };
      const descartadas = teclas.takeEarly();
      if (descartadas > 0) progress.note(`(ignorei ${descartadas} tecla(s) batida(s) antes desta pergunta aparecer — responda olhando para ela)`);
      /*
       * A caixa cabe no terminal: na tela mínima da pergunta, cabeçalho, linha
       * de atividade, as duas bordas e o rodapé ocupam 6 linhas, e uma fica
       * livre para o cursor. O resto é dela.
       */
      const mostrar = (input: InterviewInput): void => {
        progress.asking(interactiveQuestionBox(screen, larguraAtual(), input, Math.max(8, (stdout.rows ?? 40) - 7)));
        repaint();
      };
      try {
        if (question.options.length === 0) {
          const spec = { label: "Sua resposta" };
          return (await teclas.text(spec, (state) => mostrar({ kind: "text", spec, state }))) ?? "";
        }
        const escolhas = interviewChoices(question, { leaveOpen: engenharia });
        for (;;) {
          const indice = (await teclas.select(escolhas.spec, (state) => mostrar({ kind: "select", choices: escolhas, state }))) ?? escolhas.spec.defaultIndex;
          const resposta = escolhas.answers[indice];
          if (resposta !== null && resposta !== undefined) return resposta;
          // Texto livre: Esc ou Enter vazio voltam às opções em vez de virar "não sei".
          const spec = { label: "Sua resposta", cancelable: true };
          const texto = await teclas.text(spec, (state) => mostrar({ kind: "text", spec, state }));
          if (texto !== null && texto.trim() !== "") return texto;
        }
      } catch (error) {
        if (!(error instanceof InputEndedError)) throw error;
        // Ctrl-D: a entrada acabou. Com a sessão fechada, `perguntar` cai no
        // mesmo bloqueio retomável que a leitura de linha já explica.
        teclas.close();
        return await perguntar("", question.decision, sinal);
      } finally {
        progress.asking(null);
      }
    }

    if (live.enabled) {
      const screen = { question, index, total, document: options.documento, style: style() };
      progress.asking(questionBox(screen, larguraAtual()));
      const painel = desenhar();
      live.draw(painel);
      try {
        const answer = await live.suspend(() => {
          // Uma pergunta longa fica completa no histórico. Repetir a decisão e
          // os números perto do campo evita responder sem saber qual é a dúvida.
          if (engenharia && painel.split("\n").length > (stdout.rows ?? 40)) {
            stdout.write(renderAnswerContext(screen, larguraAtual()));
          }
          return perguntar(paint(
            engenharia ? "  ▸ sua resposta (número ou texto; Enter deixa em aberto): " : "  ▸ sua resposta: ",
            "cyan", style(),
          ), question.decision, sinal);
        });
        return answer.trim().toLowerCase() === BACK ? "" : answer;
      } finally {
        progress.asking(null);
      }
    }

    stdout.write(renderQuestion({ question, index, total, document: options.documento, style: style() }));
    const answer = await perguntar(engenharia ? "Sua resposta (número ou texto; Enter deixa em aberto): " : "> ", question.decision, sinal);
    return answer.trim().toLowerCase() === BACK ? "" : answer;
  };

  return {
    progress,
    live,
    repaint,
    /** O que se passa ao orquestrador. */
    hooks: {
      announce,
      onProgress,
      onPhaseProgress,
      call,
      ask,
    },
    close: () => { live.release(); terminal?.close(); teclas?.close(); },
  };
}

/**
 * Quem rodou, para o `run.json`.
 *
 * O campo existia e nascia vazio. Diagnosticar o `MCP_teste2` exigiu adivinhar
 * qual CLI tinha sido usada — e a resposta mudava o veredito, porque o acesso de
 * sistema que o executor recebe é escolhido pelo adaptador de cada uma.
 */
/**
 * O painel NUNCA pode derrubar o run.
 *
 * `repaint` é chamado de dentro do `announce` e do `onProgress`, que rodam dentro
 * do laço do orquestrador: uma exceção no desenho sobe por ali e mata um run de
 * horas por causa de uma linha de moldura. O desenho é a parte mais mexida do
 * produto e a menos essencial dele — a execução não depende de haver tela.
 *
 * Então ele é envelopado aqui, no lugar onde a tela encontra a execução, e não
 * dentro de `renderDashboard`: engolir a exceção lá esconderia o defeito de quem
 * o escreveu. Aqui ela vira uma linha visível, o run continua, e o log guarda o
 * que aconteceu.
 */
function semDerrubarORun(desenhar: () => string, versao: string): () => string {
  let avisado = false;
  return () => {
    try {
      return desenhar();
    } catch (erro) {
      const causa = erro instanceof Error ? erro.message : String(erro);
      if (!avisado) avisado = true;
      return `capivara v${versao} · o painel falhou ao desenhar (${causa}); a execução segue — use --no-dashboard para só as linhas de progresso`;
    }
  };
}

function snapshotDePapeis(roles: ReturnType<typeof rolesFromFlags>, usados: readonly string[]): Record<string, { provider: string; model: string; effort: string }> {
  const registro: Record<string, { provider: string; model: string; effort: string }> = {};
  for (const papel of usados) {
    const config = roles[papel as keyof typeof roles];
    if (config) registro[papel] = { provider: config.provider, model: config.model, effort: config.effort };
  }
  return registro;
}

/**
 * O texto de um prompt guardado na base.
 *
 * Terceira origem de um pedido, ao lado do texto digitado e do arquivo. Sem
 * `--mcp` não há onde procurar, e dizer isso é mais útil que devolver lista
 * vazia: quem escreveu `--prompt` quer um prompt de algum lugar.
 */
async function lerPromptDaBase(
  flags: { mcp?: string; prompt?: string },
  escrever: (linha: string) => void,
): Promise<{ texto: string; nome: string } | "erro"> {
  const nome = (flags.prompt ?? "").trim();
  let endpoint;
  try { endpoint = resolveMcpEndpoint(flags.mcp); }
  catch (error) {
    escrever(`erro: ${error instanceof Error ? error.message : "configuração MCP inválida"}`);
    return "erro";
  }
  if (!endpoint) {
    escrever("erro: --prompt precisa de uma base MCP; adicione em capivara config ou informe --mcp.");
    return "erro";
  }
  flags.mcp = endpoint.url;
  const client = createMcpClient(endpoint, { timeoutSeconds: 20 });

  /*
   * Nome errado ensina os certos.
   *
   * Errar o nome de um prompt é o caso comum — eles são muitos e parecidos — e
   * a mensagem que só diz "não existe" obriga a abrir a interface da base para
   * descobrir o que existe. A lista custa uma chamada e resolve ali.
   */
  const comOsQueExistem = async (primeira: string): Promise<"erro"> => {
    const disponiveis = await client.listPrompts().catch(() => []);
    escrever(
      [
        primeira,
        ...(disponiveis.length > 0
          ? ["", "Os prompts desta base:", ...disponiveis.map((item) => `  ${item.name} — ${item.title}`)]
          : []),
      ].join("\n"),
    );
    return "erro";
  };

  try {
    await client.initialize();
    const texto = await client.prompt(nome);
    if (texto.trim() === "") return await comOsQueExistem(`erro: o prompt "${nome}" está vazio nesta base.`);
    escrever(`prompt "${nome}" carregado da base`);
    return { texto, nome };
  } catch (erro) {
    return await comOsQueExistem(
      `erro: não consegui ler o prompt "${nome}" (${erro instanceof Error ? erro.message : String(erro)})`,
    );
  }
}

/**
 * O material do projeto na base documental, quando o operador pediu por ela.
 *
 * Devolve `null` quando não há base a consultar — e aí o pedido vem por texto ou
 * arquivo, como sempre veio. Devolve `"erro"` quando havia base e ela não
 * respondeu: seguir em frente com o pedido digitado seria construir outra coisa
 * sem avisar.
 */
async function lerDaBase(
  flags: { mcp?: string; mcpProject?: string },
  escrever: (mensagem: string) => void,
  modo: { tolerante?: boolean } = {},
): Promise<ProjectMaterial | null | "erro"> {
  Object.assign(flags, resolveMcpProject(flags));
  const url = flags.mcp?.trim();
  const projeto = flags.mcpProject?.trim();
  if (!url && !projeto) return null;

  if (!url || !projeto) {
    escrever("erro: --mcp e --mcp-project andam juntos: a URL diz onde é a base, o projeto diz o que ler dela.");
    return "erro";
  }

  try {
    const endpoint = resolveMcpEndpoint(url)!;
    flags.mcp = endpoint.url;
    const client = createMcpClient(endpoint);
    await client.initialize();
    const material = await fetchProjectMaterial(client, projeto);
    escrever(
      `base documental: ${client.server?.name ?? "servidor"} — pedido do projeto ${projeto}` +
        `, ${material.documents.length} documento(s) selecionado(s)`,
    );
    for (const documento of material.documents) escrever(`  · ${documento.name}`);
    return material;
  } catch (erro) {
    const causa = erro instanceof Error ? erro.message : String(erro);
    /*
     * No `init`, sem base não há pedido: parar é o certo. No `build`, o material
     * já foi materializado antes — seguir com o que está no disco é o certo, e
     * parar seria transformar conveniência em dependência.
     */
    if (modo.tolerante === true) {
      escrever(`aviso: a base documental não respondeu (${causa}); seguindo com o que já está em .capivara/`);
      return null;
    }
    escrever(`erro: ${causa}`);
    return "erro";
  }
}

export function createProgram(): Command {
  const program = new Command();
  let entradaDoWizard: ReturnType<typeof createLineIO> | undefined;
  program
    .name("capivara")
    .description("Harness documental e loop de execução: do prompt à aplicação final")
    .version(VERSION, "-v, --version", "mostra a versão")
    .helpOption("-h, --help", "mostra esta ajuda");

  registerConfigCommand(program);
  registerApiLogin(program);

  const providers = program.command("providers").description("Inspeciona os modelos disponíveis");
  providers.command("models <provider>").description("Lista os modelos de uma API ou CLI sem iniciar uma tarefa")
    .option("--json", "emite uma lista JSON")
    .action(async (provider: string, options: { json?: boolean }) => {
      if (!isCliProvider(provider) && !isDirectProvider(provider)) {
        process.stderr.write("Provider desconhecido. Use capivara providers list para consultar os disponíveis.\n");
        process.exitCode = 2;
        return;
      }
      const models = await listarModelos(provider, process.env, undefined, (message) => void process.stderr.write(`${message}\n`));
      if (options.json) stdout.write(`${JSON.stringify(models)}\n`);
      else if (models.length > 0) stdout.write(`${models.join("\n")}\n`);
      if (models.length === 0) {
        process.stderr.write(`Não foi possível listar modelos de ${provider}. Você pode informar um identificador com --model <id>.\n`);
        process.exitCode = 2;
      }
    });
  providers
    .command("list")
    .description("Lista os providers e o estado de configuração de cada um")
    .option("--json", "emite JSON")
    .action(async (options: { json?: boolean }) => {
      const listing = await listProviders();
      stdout.write(options.json ? `${JSON.stringify(listing, null, 2)}\n` : `${renderProviderList(listing)}\n`);
    });

  program
    .command("doctor")
    .description("Diagnostica ambiente, providers, projeto e documentação antes de gastar")
    .option("--project <caminho>", "raiz do projeto", ".")
    .option("--json", "emite JSON")
    .action(async (options: { project?: string; json?: boolean }) => {
      const diagnoses = await diagnose({ projectRoot: options.project ?? "." });
      stdout.write(options.json ? `${JSON.stringify(diagnoses, null, 2)}\n` : `${renderDiagnosis(diagnoses)}\n`);
      process.exitCode = diagnoses.some((diagnosis) => diagnosis.health === "ausente") ? 1 : 0;
    });

  roleFlags(
    program
      .command("prompt-engineer")
      .description("Esclarece lacunas de um prompt cru e gera um prompt Ponytail reutilizável, em inglês por padrão")
      .argument("[pedido]", "o prompt cru; aceita @arquivo")
      .option("--file <caminho>", "lê o prompt cru de um arquivo")
      .option("--prompt <nome>", "usa um prompt guardado na base, pelo nome")
      .option("--mcp <url>", "base documental por MCP")
      .option("--mcp-project <nome>", "projeto da base que fornece o pedido e o contexto")
      .option("--saida <caminho>", "arquivo do prompt, relativo ao projeto", "prompt-engineered.md")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso")
      .option("--max-interview-rounds <n>", "rodadas de descoberta de lacunas", "3"),
    ["writer"],
    "idioma do prompt final: en ou pt (padrão en); perguntas em português",
  ).action(async (pedido: string | undefined, flags: CommonFlags & { file?: string; prompt?: string; mcp?: string; mcpProject?: string; saida: string; maxInterviewRounds: string; dashboard?: boolean }) => {
    const projectRoot = resolve(flags.project ?? ".");
    const announce = (message: string): void => { stdout.write(`${message}\n`); };
    let ui: ReturnType<typeof estagioInterativo> | undefined;
    try {
      const language = promptLanguage(flags.language);
      const maxRounds = Number(flags.maxInterviewRounds);
      if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) {
        throw new Error("--max-interview-rounds deve ser um inteiro entre 1 e 20.");
      }
      const output = safeProjectPath(projectRoot, flags.saida);
      let escolhas = flags;
      let roles = rolesFromFlags(escolhas);
      const missing = unresolvedRoles(roles, ["writer"]);
      if (missing.length > 0) {
        const completo = await completarPapeis("prompt-engineer", missing, escolhas);
        if (completo === null) {
          announce(renderUnresolved("prompt-engineer", missing, roles));
          process.exitCode = 2;
          return;
        }
        escolhas = completo;
        roles = rolesFromFlags(escolhas);
      }

      let sources = {
        ...(pedido !== undefined ? { prompt: pedido } : {}),
        ...(flags.file !== undefined ? { file: flags.file } : {}),
      };
      if (!sources.prompt && !sources.file && !flags.mcpProject && !flags.prompt && !flags.mcp) {
        const escolhido = await completarPedido("prompt-engineer", projectRoot);
        if (escolhido) {
          sources = escolhido;
          if (escolhido.mcp) flags.mcp = escolhido.mcp;
          if (escolhido.mcpProject) flags.mcpProject = escolhido.mcpProject;
        }
      }

      const material = flags.mcpProject ? await lerDaBase(flags, announce) : null;
      if (material === "erro") { process.exitCode = 2; return; }
      const guardado = !material && flags.prompt ? await lerPromptDaBase(flags, announce) : null;
      if (guardado === "erro") { process.exitCode = 2; return; }
      if (!material && !guardado && flags.mcp && !sources.prompt && !sources.file) {
        throw new Error("Informe --mcp-project <nome> ou --prompt <nome> para escolher o prompt da base.");
      }
      const request = material
        ? requestFromLibrary(flags.mcpProject!, material.request, flags.mcp)
        : guardado
          ? requestFromPrompt(guardado.nome, guardado.texto, flags.mcp)
          : await resolveRequest(projectRoot, sources);
      if (request.origin === "file" && request.path && safeProjectPath(projectRoot, request.path) === output) {
        throw new Error("--saida deve ser diferente do arquivo do prompt cru; escolha outro destino.");
      }
      const comPainel = flags.dashboard !== false && stdout.isTTY === true;
      if (flags.splash !== false && !comPainel) {
        stdout.write(renderSplash({ version: VERSION, roles: describeRoles(roles).filter((role) => role.role === "writer"), style: style() }));
      }

      ui = estagioInterativo({
        estagio: "prompt-engineer",
        projectRoot,
        runId: `prompt-engineer-${request.sha12}`,
        language: "português do Brasil",
        roles,
        comPainel,
        documento: "Prompt Engineer",
        ...(entradaDoWizard ? { entrada: entradaDoWizard } : {}),
      });
      ui.progress.setStage("receiving");
      ui.hooks.announce(`Prompt recebido${request.path ? ` de ${request.path}` : " por texto"}. Vou analisar as lacunas; aguarde o modelo. As perguntas aparecerão aqui para você responder.`);
      const result = await engineerPrompt({
        projectRoot,
        request,
        language,
        maxRounds,
        ...(material ? { library: material.documents } : {}),
        announce: ui.hooks.announce,
        writer: ui.hooks.call,
        askQuestion: ui.hooks.ask,
      });
      ui.progress.setStage("publish");
      ui.hooks.announce(`Gravando o prompt em ${output}.`);
      await writeAtomic(output, result.prompt);
      ui.progress.completed("prompt salvo; pronto para reutilizar");
      ui.repaint();
      ui.live.release();
      stdout.write(`\n${result.prompt}\n`);
      announce(`Prompt salvo em ${output}`);
      if (result.coverage === "open" || result.limitReached) {
        announce(`O prompt registra ${result.openQuestions.length} lacuna(s) ainda aberta(s)${result.limitReached ? "; o limite de descoberta foi atingido" : ""}.`);
      }
      announce(`Para usar na Capivara:\n  ${renderCommand({ command: "init", requestFile: flags.saida, projectRoot, global: {}, roles: {} })}`);
      process.exitCode = 0;
    } catch (error) {
      ui?.progress.halted(error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error));
      ui?.repaint();
      ui?.live.release();
      announce(`erro: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    } finally {
      ui?.close();
    }
  });

  roleFlags(
    program
      .command("change")
      .description("Acrescenta ou altera funcionalidade numa aplicação que a capivara já construiu")
      .argument("[pedido]", "o que mudar; aceita @arquivo")
      .option("--file <caminho>", "lê o pedido de mudança de um arquivo")
      .option("--prompt <nome>", "usa um prompt guardado na base, pelo nome")
      .option("--mcp <url>", "base documental por MCP, de onde vem o prompt"),
    ["writer"],
  ).action(async (pedido: string | undefined, flags: CommonFlags & { file?: string; prompt?: string; mcp?: string }) => {
    const projectRoot = flags.project ?? ".";
    let escolhas = flags;
    let roles = rolesFromFlags(escolhas);
    const semProvider = unresolvedRoles(roles, ["writer"]);
    if (semProvider.length > 0) {
      const completo = await completarPapeis("change", semProvider, escolhas);
      if (completo === null) {
        stdout.write(`${renderUnresolved("change", semProvider, roles)}\n`);
        process.exitCode = 2;
        return;
      }
      escolhas = completo;
      roles = rolesFromFlags(escolhas);
    }

    const guardado = flags.prompt ? await lerPromptDaBase(flags, (linha) => stdout.write(`${linha}\n`)) : null;
    if (guardado === "erro") {
      process.exitCode = 2;
      return;
    }

    let deOndeVem: { prompt?: string; file?: string } = {
      ...(pedido !== undefined ? { prompt: pedido } : {}),
      ...(flags.file !== undefined ? { file: flags.file } : {}),
    };
    if (!guardado && deOndeVem.prompt === undefined && deOndeVem.file === undefined) {
      const perguntado = await completarPedido("change");
      if (perguntado !== null) deOndeVem = perguntado;
    }

    let request: { text: string };
    try {
      request = guardado ? { text: guardado.texto } : await resolveRequest(projectRoot, deOndeVem);
    } catch (error) {
      await mostrarParada(
        {
          natureza: "decisão",
          oQue: error instanceof Error ? error.message : String(error),
          deQuem: "de ninguém: falta dizer o que mudar",
          custou: "nenhuma sessão gasta — o change nem começou",
          paraSeguir: ["passe o pedido: `capivara change \"o que mudar\"`, `capivara change @mudanca.md` ou `--file <arquivo>`"],
        },
        projectRoot,
        flags,
      );
      process.exitCode = 2;
      return;
    }

    const language = flags.language ?? detectLanguage(request.text, flags.language);
    if (flags.splash !== false) {
      stdout.write(renderSplash({ version: VERSION, roles: describeRoles(roles).filter((role) => role.role === "writer"), style: style() }));
    }

    const runId = runIdFor("init", sha12(request.text));
    const bridge = createAgentBridge({ projectRoot, runId, language, roles, limits: DEFAULT_LIMITS });

    let parada: Parada | null = null;
    const teclasChange = abrirTeclas();
    const terminalChange = !teclasChange && stdin.isTTY === true ? createInterface({ input: stdin, output: stdout }) : null;
    const linhasChange = terminalChange ? createLineIO(terminalChange, (texto) => void stdout.write(texto), { interactive: true }) : null;

    try {
      const resultado = await runChange({
        projectRoot,
        language,
        request: request.text,
        announce: (linha) => void stdout.write(`${linha}\n`),
        call: async (chamada) => await bridge({ role: "writer", stage: `change:${chamada.subject}`, prompt: chamada.prompt }),
        ...(teclasChange
          ? {
              /*
               * Por lista (§96): cada linha devolve o que `lerResposta` já lê —
               * o número da opção —, e o texto livre segue como texto.
               */
              ask: async (question, indice, total) => {
                const escolha = escolhaDaMudanca(question, indice, total);
                try {
                  for (;;) {
                    const escolhida = await escolherEmbaixo(teclasChange, escolha.title, escolha.text, escolha.choices, escolha.defaultIndex);
                    const resposta = respostaDaMudanca(question, escolhida);
                    if (resposta !== null) return resposta;
                    const livre = await teclasChange.line.ask(paint("  ▸ sua resposta (Enter vazio volta às opções): ", "cyan", style()));
                    if (livre.trim() !== "") return livre;
                  }
                } catch (error) {
                  // Entrada esgotada é Enter: a recomendada, como na leitura de linha.
                  if (error instanceof InputEndedError) return "";
                  throw error;
                }
              },
            }
          : linhasChange
          ? {
              ask: async (question, indice, total) => {
                stdout.write(renderPerguntaDaMudanca(question, indice, total));
                return await linhasChange.ask("\n  sua resposta [Enter aceita a recomendada]: ").catch(() => "");
              },
            }
          : {}),
      });

      stdout.write(
        [
          "",
          `${resultado.novas.length} fase(s) acrescentada(s) ao plano:`,
          ...resultado.novas.map((fase) => `  Phase ${fase.number}: ${fase.title} — ${fase.goal}`),
          "",
          ...(resultado.avisos.length > 0 ? [...resultado.avisos.map((aviso) => `  aviso: ${aviso}`), ""] : []),
          "Para construir o que foi planejado:",
          "  capivara build",
          "",
          "As fases que já estavam fechadas não são refeitas enquanto o texto, a fatia da arquitetura e o commit delas continuarem os mesmos.",
          "",
        ].join("\n"),
      );
      process.exitCode = 0;
    } catch (error) {
      if (error instanceof ChangeBlockedError) {
        parada = paradaDoEstagio(error, "change");
        process.exitCode = 2;
      } else throw error;
    } finally {
      terminalChange?.close();
      teclasChange?.close();
    }

    // Depois do `finally`: a telinha põe o terminal em modo raw, e o readline
    // aberto disputaria cada tecla com ela.
    if (parada) await mostrarParada(parada, projectRoot, flags);
  });

  roleFlags(
    program
      .command("survey")
      .description("Levanta uma aplicação que já existe: domínios, regras, dados e contratos")
      .option("--saida <caminho>", "onde gravar o levantamento", "./levantamento")
      .option("--max-dominios <n>", "teto de domínios do mapa", String(MAX_DOMINIOS))
      .option("--mcp <url>", "base documental por MCP, onde o levantamento vira projeto")
      .option("--mcp-project <nome>", "força o slug do projeto; o padrão é o nome da aplicação levantada"),
    ["writer"],
  ).action(async (flags: CommonFlags & { saida?: string; maxDominios?: string; mcp?: string; mcpProject?: string }) => {
    const projectRoot = flags.project ?? ".";
    let escolhas = flags;
    let roles = rolesFromFlags(escolhas);
    const semProvider = unresolvedRoles(roles, ["writer"]);
    if (semProvider.length > 0) {
      const completo = await completarPapeis("survey", semProvider, escolhas);
      if (completo === null) {
        stdout.write(`${renderUnresolved("survey", semProvider, roles)}\n`);
        process.exitCode = 2;
        return;
      }
      escolhas = completo;
      roles = rolesFromFlags(escolhas);
    }

    const language = flags.language ?? "português do Brasil";
    if (flags.splash !== false) {
      stdout.write(renderSplash({ version: VERSION, roles: describeRoles(roles).filter((role) => role.role === "writer"), style: style() }));
    }

    /*
     * A ponte grava logs e prompts sob a raiz que recebe. Aqui ela recebe a
     * SAÍDA, nunca a aplicação levantada: um levantamento que suja o repositório
     * de outra pessoa é um levantamento que ninguém deixa rodar duas vezes.
     */
    const saida = resolve(flags.saida ?? "./levantamento");
    const runId = runIdFor("survey", sha12(resolve(projectRoot)));
    const bridge = createAgentBridge({ projectRoot: saida, runId, language, roles, limits: DEFAULT_LIMITS });

    /*
     * A base, quando há uma. O cliente é criado aqui e as três perguntas que o
     * levantamento faz são traduzidas para o protocolo — ele não sabe o que é
     * MCP, e não precisa saber.
     */
    let paradaDoSurvey: Parada | null = null;
    const teclasSurvey = abrirTeclas();
    const terminalSurvey = !teclasSurvey && stdin.isTTY === true ? createInterface({ input: stdin, output: stdout }) : null;
    const linhasSurvey = terminalSurvey ? createLineIO(terminalSurvey, (texto) => void stdout.write(texto), { interactive: true }) : null;

    const mcpUrl = configuredMcpUrl(flags.mcp);
    const base = mcpUrl
      ? await (async () => {
          let client: McpClient;
          try {
            const endpoint = resolveMcpEndpoint(mcpUrl)!;
            flags.mcp = endpoint.url;
            client = createMcpClient(endpoint, { timeoutSeconds: 30 });
          } catch (error) {
            stdout.write(`aviso: ${error instanceof Error ? error.message : "configuração MCP inválida"}; o levantamento fica somente nos arquivos locais\n`);
            return null;
          }
          const conectado = await client
            .initialize()
            .then(() => true)
            .catch((erro: unknown) => {
              stdout.write(`aviso: a base não respondeu (${erro instanceof Error ? erro.message : String(erro)})\n`);
              return false;
            });

          return {
            existe: async (slug: string) => (conectado ? await projetoExiste(client, slug) : null),
            enviar: async (slug: string, markdown: string) =>
              await enviarLevantamento(client, { projeto: slug, nome: "", conteudo: markdown, procedencia: runId }),
            ...(flags.mcpProject ? { projeto: flags.mcpProject } : {}),
            ...(teclasSurvey
              ? {
                  decidir: async (slug: string): Promise<DecisaoDeColisao> => {
                    const escolha = escolhaDeColisao(slug);
                    // Entrada esgotada não mexe na base, como na leitura de linha.
                    const escolhida = await escolherEmbaixo(teclasSurvey, escolha.title, escolha.text, escolha.choices, escolha.defaultIndex).catch(() => 2);
                    return escolha.decisoes[escolhida] ?? "local";
                  },
                }
              : linhasSurvey
              ? {
                  decidir: async (slug: string): Promise<DecisaoDeColisao> => {
                    stdout.write(
                      [
                        "",
                        `  1) atualizar o levantamento de "${slug}" (o pedido escrito lá é preservado)`,
                        `  2) criar um projeto novo ao lado, com outro nome`,
                        "  3) não mexer na base; ficar só com os arquivos locais",
                        "",
                      ].join("\n"),
                    );
                    const resposta = await linhasSurvey.ask("  o que faço? [1] ").catch(() => "3");
                    return resposta.trim() === "2" ? "novo" : resposta.trim() === "3" ? "local" : "atualizar";
                  },
                }
              : {}),
          };
        })()
      : null;

    try {
      const resultado = await runSurvey({
        projectRoot,
        outputRoot: saida,
        language,
        announce: (linha) => void stdout.write(`${linha}\n`),
        ...(base ? { base } : {}),
        ...(flags.maxDominios !== undefined ? { maxDomains: Number(flags.maxDominios) } : {}),
        call: async (request) =>
          await bridge({ role: "writer", stage: `survey:${request.subject}`, prompt: request.prompt }),
      });

      const { survey, coverage } = resultado;

      stdout.write(
        [
          "",
          `Levantamento de ${survey.application}:`,
          `  ${survey.domains.length} domínio(s), ${survey.rules.length} regra(s), ${survey.flows.length} fluxo(s), ${survey.entities.length} entidade(s)`,
          `  ${survey.rules.filter((rule) => rule.layer === "contrato").length} contrato(s) externo(s) — o que precisa sobreviver a uma troca de stack`,
          `  ${survey.rules.filter((rule) => rule.divergence !== "").length} divergência(s) entre o que o código faz e o que parecia querer fazer`,
          `  ${survey.questions.length} pergunta(s) que o código não responde`,
          `  cobertura: ${coverage.claimed} de ${coverage.total} arquivo(s) de código reivindicados por algum domínio`,
          "",
          ...resultado.written.map((caminho) => `  ${caminho}`),
          "",
          "Para reescrever, diga o que muda — a stack de destino e o que fica de fora — e rode o init:",
          ...(resultado.destino?.enviado === true
            ? [
                `  o pedido já está rascunhado no projeto "${resultado.destino.slug}"; abra-o na interface do doc-center`,
                `  capivara init --mcp ${flags.mcp} --mcp-project ${resultado.destino.slug}`,
              ]
            : [`  capivara init --file ${join(saida, "levantamento.md")}`]),
          "",
        ].join("\n"),
      );
      process.exitCode = 0;
    } catch (error) {
      if (error instanceof SurveyBlockedError) {
        paradaDoSurvey = paradaDoEstagio(error, "survey", runId);
        process.exitCode = 2;
      } else throw error;
    } finally {
      terminalSurvey?.close();
      teclasSurvey?.close();
    }

    if (paradaDoSurvey) await mostrarParada(paradaDoSurvey, saida, flags);
  });

  roleFlags(
    program
      .command("init")
      .description("Entrevista e desenha as fases do projeto até PLAN READY")
      .argument("[pedido]", "o que você quer construir; aceita @arquivo")
      .option("--file <caminho>", "lê o pedido de um arquivo")
      .option("--prompt <nome>", "usa um prompt guardado na base, pelo nome")
      .option("--mcp <url>", "base documental por MCP, como http://localhost:7777/mcp")
      .option("--mcp-project <nome>", "de qual projeto da base vêm o pedido e os documentos")
      .option("--max-audit-returns <n>", "devoluções do auditor por documento", "3")
      .option("--max-interview-rounds <n>", "rodadas de entrevista", "3")
      .option("--fresh", "ignora o que este run já publicou e recomeça do zero")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso")
      .option("--no-commit", "não versiona a especificação ao chegar em PLAN READY"),
  ).action(async (pedido: string | undefined, flags: CommonFlags & { file?: string; prompt?: string; mcp?: string; mcpProject?: string; maxAuditReturns: string; maxInterviewRounds: string; fresh?: boolean; dashboard?: boolean; commit?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    let escolhas = flags;
    let configured = rolesFromFlags(escolhas);
    const semProvider = unresolvedRoles(configured, INIT_ROLES);
    if (semProvider.length > 0) {
      const completo = await completarPapeis("init", semProvider, escolhas);
      if (completo === null) {
        stdout.write(`${renderUnresolved("init", semProvider, configured)}\n`);
        process.exitCode = 2;
        return;
      }
      escolhas = completo;
      configured = rolesFromFlags(escolhas);
    }
    /*
     * A terceira forma de dizer o que construir.
     *
     * Quem busca é o harness, não o modelo: o pedido e os documentos do projeto
     * são o insumo do run, e insumo não pode depender de alguém lembrar de
     * chamar uma ferramenta. O que chega aqui é texto com sha, indistinguível
     * de um arquivo lido do disco — e é assim que o resto do ciclo continua
     * funcionando sem saber que existe uma base documental.
     */
    const material = await lerDaBase(flags, (mensagem) => stdout.write(`${mensagem}\n`));
    if (material === "erro") {
      process.exitCode = 2;
      return;
    }

    /*
     * Três origens, nesta ordem de precedência: o projeto da base, um prompt
     * guardado, e o que veio pela linha de comando. Quem aponta um projeto quer
     * o pedido dele; quem aponta um prompt quer aquele texto.
     */
    const guardado = flags.prompt ? await lerPromptDaBase(flags, (linha) => stdout.write(`${linha}\n`)) : null;
    if (guardado === "erro") {
      process.exitCode = 2;
      return;
    }

    /*
     * Sem pedido, pergunta — em vez de estourar.
     *
     * `capivara init --fresh --provider codex` é um comando completo menos uma
     * coisa, e a resposta era um EmptyRequestError com stack trace: parece
     * defeito do harness, e não pergunta nada a quem está ali para responder.
     */
    let deOndeVem: { prompt?: string; file?: string } = {
      ...(pedido !== undefined ? { prompt: pedido } : {}),
      ...(flags.file !== undefined ? { file: flags.file } : {}),
    };
    if (!material && !guardado && deOndeVem.prompt === undefined && deOndeVem.file === undefined) {
      const perguntado = await completarPedido("init");
      if (perguntado !== null) deOndeVem = perguntado;
    }

    let request: { text: string; origin: "text" | "file" | "mcp"; path: string | null; sha12: string };
    try {
      request = material
        ? requestFromLibrary(flags.mcpProject!, material.request, flags.mcp)
        : guardado
          ? requestFromPrompt(guardado.nome, guardado.texto, flags.mcp)
          : await resolveRequest(projectRoot, deOndeVem);
    } catch (erro) {
      await mostrarParada(
        {
          natureza: "decisão",
          oQue: erro instanceof Error ? erro.message : String(erro),
          deQuem: "de ninguém: falta dizer o que construir",
          custou: "nenhuma sessão gasta — o init nem começou",
          paraSeguir: [
            "passe o pedido no comando: `capivara init \"o que construir\"`, `capivara init @pedido.md` ou `--file <arquivo>`",
            "ou rode `capivara` sem argumento nenhum e responda pelo wizard",
          ],
        },
        projectRoot,
        flags,
      );
      process.exitCode = 2;
      return;
    }
    const language = detectLanguage(request.text, flags.language);
    const roles = configured;

    /*
     * Com o painel ligado, o splash seria um segundo cabeçalho: o painel já traz
     * o mesmo título, a mesma capivara e os mesmos papéis. Sem painel — saída
     * para arquivo, pipe, CI — ele continua sendo a abertura.
     */
    const comPainel = flags.dashboard !== false && stdout.isTTY === true;
    if (flags.splash !== false && !comPainel) {
      const papeis = describeRoles(roles).filter((role) => (INIT_ROLES as readonly string[]).includes(role.role));
      stdout.write(renderSplash({ version: VERSION, roles: papeis, style: style() }));
    }

    const runId = runIdFor("init", request.sha12);
    const ui = estagioInterativo({
      estagio: "init",
      projectRoot,
      runId,
      language,
      roles,
      comPainel,
      documento: "entrevista",
    });

    /*
     * O repositório nasce aqui, que é o único momento em que a pasta é
     * garantidamente vazia.
     *
     * O build passou a exigir repositório (§75.5), e exigir no fim da cadeia
     * significa exigir de quem já andou horas sem ele. O `init` roda antes de
     * qualquer arquivo de produto existir: criar o repositório agora não tem
     * dúvida de dono, e tem um segundo efeito que o relatório vinha cobrando —
     * "sem repositório Git: a especificação não foi versionada". Com ele, a
     * especificação é versionada no momento em que fecha o gate.
     *
     * `--no-commit` é a saída de quem não quer que o harness versione nada.
     */
    if (flags.commit !== false) {
      const repositorio = await iniciarRepositorio(projectRoot);
      if (repositorio.criado) stdout.write("repositório Git criado: a especificação e cada fase do build entram no histórico\n");
    }

    let parada: Parada | null = null;
    try {
      const outcome = await runInit({
        projectRoot,
        roles: snapshotDePapeis(roles, INIT_ROLES),
        request,
        ...(material ? { library: material.documents } : {}),
        ...(material && flags.mcp && flags.mcpProject
          ? {
              onMemorias: async (memorias) => {
                const client = createMcpClient(resolveMcpEndpoint(flags.mcp)!, { timeoutSeconds: 20 });
                await client.initialize();
                await registrarMemorias(client, flags.mcpProject!, memorias, (mensagem) => stdout.write(`${mensagem}\n`));
              },
            }
          : {}),
        language,
        maxAuditReturns: Number(flags.maxAuditReturns),
        maxInterviewRounds: Number(flags.maxInterviewRounds),
        providers: { writer: roles.writer.provider, auditor: roles.auditor.provider, verifier: roles.verifier.provider },
        ...(flags.fresh === true ? { fresh: true } : {}),
        // O init entrega as fases e para em PLAN READY: quem as detalha é o plan.
        stage: "init",
        ...ui.hooks,
      });
      ui.live.release();
      stdout.write(`\n${outcome.rendered}\n`);

      // A especificação entra no histórico do produto junto com o código que ela
      // gera; sem isso, quem clona o repositório encontra a aplicação sem as
      // decisões que a produziram.
      if (outcome.readiness.ready && flags.commit !== false) {
        const commit = await commitSpecification(projectRoot, "PLAN READY");
        stdout.write(`${commit.committed ? `versionado: ${commit.message}` : commit.message}\n`);
      }

      if (!outcome.readiness.ready) parada = paradaDeProntidao(outcome.readiness, "init", outcome.runId);
      process.exitCode = outcome.readiness.ready ? 0 : 2;
    } catch (error) {
      if (error instanceof InitBlockedError) {
        ui.progress.halted(error.message.split("\n")[0] ?? "");
        ui.repaint();
        ui.live.release();
        parada = paradaDoEstagio(error, "init", error.runId);
        process.exitCode = 2;
      } else throw error;
    } finally {
      ui.close();
    }

    // A telinha só depois de o readline do estágio fechar: os dois leem o mesmo
    // stdin, e quem estivesse aberto comeria as setas.
    if (parada) await mostrarParada(parada, projectRoot, flags);
  });

  roleFlags(
    program
      .command("plan")
      .description("Detalha as fases que o init produziu, até RALPH READY")
      .option("--file <caminho>", "lê o pedido de um arquivo; por padrão, o mesmo que o init usou")
      .option("--max-audit-returns <n>", "devoluções do auditor", "3")
      .option("--prazo-da-pergunta <min>", "minutos que uma pergunta espera resposta antes de o plan seguir com a leitura recomendada", "10")
      .option("--fresh", "reescreve todas as fases; ignora o que execuções anteriores já produziram")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso")
      .option("--no-commit", "não versiona a especificação ao chegar em RALPH READY"),
    ["writer", "auditor", "verifier"],
  ).action(async (flags: CommonFlags & { file?: string; maxAuditReturns: string; prazoDaPergunta: string; fresh?: boolean; dashboard?: boolean; commit?: boolean }) => {
    const prazoEmMinutos = Number(flags.prazoDaPergunta);
    if (!Number.isFinite(prazoEmMinutos) || prazoEmMinutos <= 0) {
      stdout.write("erro: --prazo-da-pergunta deve ser um número de minutos maior que zero.\n");
      process.exitCode = 1;
      return;
    }
    const projectRoot = flags.project ?? ".";
    let escolhas = flags;
    let roles = rolesFromFlags(escolhas);
    const semProvider = unresolvedRoles(roles, INIT_ROLES);
    if (semProvider.length > 0) {
      const completo = await completarPapeis("plan", semProvider, escolhas);
      if (completo === null) {
        stdout.write(`${renderUnresolved("plan", semProvider, roles)}\n`);
        process.exitCode = 2;
        return;
      }
      escolhas = completo;
      roles = rolesFromFlags(escolhas);
    }

    /*
     * O `plan` retoma o esqueleto pelo id do run, e o id vem do pedido. É o
     * mesmo pedido que gerou as fases: mudar o texto muda o run, e o plan não
     * herdaria o esqueleto de outro.
     *
     * Por isso ele não pergunta nada: o `init` registrou qual pedido usou, e é
     * esse que o `plan` retoma. `--file` existe para o caso de haver mais de um
     * `init` no projeto; `pedido.md` fica como último recurso, para quem tinha
     * o registro e apagou `.capivara/`.
     */
    const request = flags.file
      ? await resolveRequest(projectRoot, { file: flags.file }).catch(() => null)
      : ((await readRequestState(projectRoot)) ?? (await resolveRequest(projectRoot, { file: "pedido.md" }).catch(() => null)));
    if (!request) {
      stdout.write(
        [
          flags.file
            ? `não consegui ler o pedido em ${flags.file}`
            : "não encontrei qual pedido o init usou, e também não há um pedido.md",
          "",
          "O plan retoma o esqueleto pelo mesmo pedido que gerou as fases. Aponte-o:",
          "",
          "    capivara plan --file <o mesmo arquivo que você passou ao init>",
          "",
        ].join("\n"),
      );
      process.exitCode = 2;
      return;
    }

    const language = detectLanguage(request.text, flags.language);
    const runId = runIdFor("init", request.sha12);

    /*
     * O reparo documental que o build encaminhou é conferido aqui, na entrada
     * da etapa destinatária, antes de qualquer chamada (§125 H; spec §8). O
     * pacote inválido é dito e ignorado; o que alcança além do defeito pede a
     * decisão de quem está no terminal. A edição automática do documento a
     * partir do pacote não está habilitada: a troca segura não foi demonstrável.
     */
    const arquiteturaDoPlan = (await readArchitectureState(projectRoot, runId))?.architecture ?? null;
    const conferencia = await conferirReparosNaEntrada(
      projectRoot,
      "plan",
      (manifest) => {
        const numero = Number(manifest.origin.phaseId.replace(/^\D+/u, ""));
        const vista = arquiteturaDoPlan ? architectureViewForPhase(arquiteturaDoPlan, numero) : null;
        return {
          phase: numero,
          components: vista ? vista.own.map((componente) => componente.name) : manifest.impact.components,
          contracts: vista ? vista.own.flatMap((componente) => componente.contracts) : [],
        };
      },
      stdin.isTTY === true
        ? async (texto: string, opcoes: readonly DecisaoDeEscopo[]): Promise<DecisaoDeEscopo | null> => {
            const terminal = createInterface({ input: stdin, output: stdout });
            try {
              stdout.write(`\n${texto}\n${opcoes.map((opcao, indice) => `  ${indice + 1}) ${opcao}`).join("\n")}\n`);
              // EOF (Ctrl+D) fecha a interface sem responder: vale como "decidir depois", não como espera infinita.
              const resposta = (await Promise.race([
                terminal.question("Escolha (vazio deixa a decisão para depois): "),
                new Promise<string>((resolver) => terminal.once("close", () => resolver(""))),
              ])).trim();
              return opcoes[Number(resposta) - 1] ?? null;
            } finally {
              terminal.close();
            }
          }
        : undefined,
    );
    for (const linha of conferencia.linhas) stdout.write(`${linha}\n`);
    if (conferencia.pendentes.length > 0) {
      stdout.write(
        "a edição automática do documento a partir do pacote não está habilitada nesta versão (§125 H): revise o trecho indicado em " +
          "diagnosis.md; o build revalida só as fases cujo texto ou fatia da arquitetura mudar.\n",
      );
    }

    /*
     * O `plan` é o estágio LONGO — dezenas de chamadas contra uma do `init` — e
     * era o que não tinha painel: escrevia linhas soltas e ficava minutos calado
     * dentro de cada fase, sem custo, sem papel ativo, sem pulso na tela.
     */
    const comPainel = flags.dashboard !== false && stdout.isTTY === true;
    if (flags.splash !== false && !comPainel) {
      const papeis = describeRoles(roles).filter((role) => (INIT_ROLES as readonly string[]).includes(role.role));
      stdout.write(renderSplash({ version: VERSION, roles: papeis, style: style() }));
    }

    const ui = estagioInterativo({
      estagio: "plan",
      projectRoot,
      runId,
      language,
      roles,
      comPainel,
      // O plan não entrevista o produto: ele pergunta o que só a escrita da fase descobre.
      documento: "fase",
    });

    let parada: Parada | null = null;
    try {
      const outcome = await runPlan({
        projectRoot,
        request,
        language,
        maxAuditReturns: Number(flags.maxAuditReturns),
        planQuestionTimeoutMs: prazoEmMinutos * 60_000,
        ...(flags.fresh === true ? { fresh: true } : {}),
        providers: { writer: roles.writer.provider, auditor: roles.auditor.provider, verifier: roles.verifier.provider },
        ...ui.hooks,
      });

      ui.live.release();
      stdout.write(`\n${outcome.rendered}\n`);

      // O plano executável é o artefato que o loop consome: ele precisa estar no
      // histórico tanto quanto o esqueleto que o gerou.
      if (outcome.readiness.ready && flags.commit !== false) {
        const commit = await commitSpecification(projectRoot, "RALPH READY");
        stdout.write(`${commit.committed ? `versionado: ${commit.message}` : commit.message}\n`);
      }

      if (!outcome.readiness.ready) parada = paradaDeProntidao(outcome.readiness, "plan", outcome.runId);
      process.exitCode = outcome.readiness.ready ? 0 : 2;
    } catch (error) {
      if (error instanceof InitBlockedError) {
        ui.progress.halted(error.message.split("\n")[0] ?? "");
        ui.repaint();
        ui.live.release();
        parada = paradaDoEstagio(error, "plan", error.runId);
        process.exitCode = 2;
      } else throw error;
    } finally {
      ui.close();
    }

    // A telinha só depois de o readline do estágio fechar: os dois leem o mesmo
    // stdin, e quem estivesse aberto comeria as setas.
    if (parada) await mostrarParada(parada, projectRoot, flags);
  });

  roleFlags(
    program
      .command("build")
      .description("Constrói a aplicação a partir da documentação RALPH READY")
      .option("--test-cmd <comando>", "comando de teste do projeto (gate 2)")
      .option("--max-cycles <n>", "ciclos de correção por fase", "3")
      .option("--max-verifier-repairs <n>", "reparos pelo validador por fase (0 desliga; requer CLI)", "1")
      .option("--repairs-per-cycle <n>", "ações de reparo por ciclo de cada fase (padrão 6)")
      .option("--repairs-per-gate <n>", "ações de reparo de um gate em cada ciclo (padrão 2)")
      .option("--repairs-per-defect <n>", "tentativas contra o mesmo defeito em cada ciclo (padrão 3)")
      .option("--verifier-resume", "o reparo do validador retoma a sessão que diagnosticou, mesmo sem retomada comprovada na CLI; se o id não voltar igual, segue em sessão nova com o handoff")
      .option("--keep-going", "continua mesmo depois de uma fase falhar")
      .option("--no-system-install", "mantém o executor dentro do workspace, sem instalar pacotes de sistema")
      .option("--no-acceptance", "pula a aceitação operacional final")
      .option("--no-flows", "pula o percurso dos fluxos do esqueleto na aceitação final (o desfecho fica em verificação inconclusiva)")
      .option("--rebuild-all", "refaz todas as fases, inclusive as fechadas em runs anteriores")
      .option("--no-git", "não cria repositório Git em pasta nova; sem ele não há commit por fase")
      .option("--mcp <url>", "base documental por MCP, de onde vêm as skills do projeto")
      .option("--mcp-project <nome>", "de qual projeto da base vêm as skills")
      .option("--serial", "uma fase por vez — o padrão; vence o que estiver em .capivara/execucao.json")
      .option("--parallel <n>", "até n fases ao mesmo tempo (2 a 8), cada uma num git worktree próprio")
      .option("--workers-as-builder", "todos os agentes usam o executor atual, substituindo os agentes salvos no projeto")
      .option(
        "--worker <spec>",
        "um agente do pool paralelo: provider=codex,model=…,effort=…,system-install=no (repetível; substitui os agentes salvos)",
        (valor: string, anteriores: string[]) => [...anteriores, valor],
        [] as string[],
      )
      .option("--save-execution", "grava a estratégia desta execução em .capivara/execucao.json, para as próximas")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso"),
    ["builder", "verifier"],
  ).action(async (flags: CommonFlags & { testCmd?: string; maxCycles: string; maxVerifierRepairs: string; repairsPerCycle?: string; repairsPerGate?: string; repairsPerDefect?: string; verifierResume?: boolean; keepGoing?: boolean; systemInstall?: boolean; acceptance?: boolean; flows?: boolean; rebuildAll?: boolean; git?: boolean; mcp?: string; mcpProject?: string; dashboard?: boolean; serial?: boolean; parallel?: string; worker?: string[]; workersAsBuilder?: boolean; saveExecution?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    const requestedRepairs = Number(flags.maxVerifierRepairs);
    if (!Number.isSafeInteger(requestedRepairs) || requestedRepairs < 0 || requestedRepairs > 10) {
      stdout.write("erro: --max-verifier-repairs deve ser um inteiro entre 0 e 10.\n");
      process.exitCode = 2;
      return;
    }
    // Os orçamentos da recuperação (§125 D): ciclos e as três escalas, cada uma um inteiro positivo.
    const orcamento: { porCiclo?: number; porGate?: number; porDefeito?: number } = {};
    for (const [flag, valor, campo] of [
      ["--max-cycles", flags.maxCycles, null],
      ["--repairs-per-cycle", flags.repairsPerCycle, "porCiclo"],
      ["--repairs-per-gate", flags.repairsPerGate, "porGate"],
      ["--repairs-per-defect", flags.repairsPerDefect, "porDefeito"],
    ] as const) {
      if (valor === undefined) continue;
      const numero = Number(valor);
      if (!Number.isSafeInteger(numero) || numero < 1 || numero > 50) {
        stdout.write(`erro: ${flag} deve ser um inteiro entre 1 e 50.\n`);
        process.exitCode = 2;
        return;
      }
      if (campo !== null) orcamento[campo] = numero;
    }
    let escolhas = flags;
    let roles = rolesFromFlags(escolhas);
    const semProvider = unresolvedRoles(roles, BUILD_ROLES);
    if (semProvider.length > 0) {
      const completo = await completarPapeis("build", semProvider, escolhas);
      if (completo === null) {
        stdout.write(`${renderUnresolved("build", semProvider, roles)}\n`);
        process.exitCode = 2;
        return;
      }
      escolhas = completo;
      roles = rolesFromFlags(escolhas);
    }
    const language = flags.language ?? "português do Brasil";
    const verifierRepairs = isCliProvider(roles.verifier.provider) ? requestedRepairs : 0;
    if (requestedRepairs > 0 && verifierRepairs === 0) {
      stdout.write("O validador usa API direta: fornecerá orientação de correção ao construtor; reparos automáticos exigem um validador via CLI.\n");
    }

    /*
     * Serial ou paralelo (§97), resolvido ANTES de qualquer tela: flag
     * contraditória, arquivo malformado ou agente que não pode construir param
     * aqui, sem uma chamada de modelo — e sem nunca virar serial em silêncio.
     */
    const execucao = await prepararExecucao({
      projectRoot,
      flags: {
        ...(flags.serial === true ? { serial: true } : {}),
        ...(flags.parallel !== undefined ? { parallel: flags.parallel } : {}),
        ...((flags.worker ?? []).length > 0 ? { worker: flags.worker } : {}),
        ...(flags.workersAsBuilder === true ? { workersAsBuilder: true } : {}),
      },
      roles,
      systemInstall: flags.systemInstall !== false,
    });
    if (!execucao.ok) {
      stdout.write(`${execucao.erros.join("\n")}\n`);
      process.exitCode = 2;
      return;
    }
    if (flags.saveExecution === true) {
      await gravarArquivoDeExecucao(projectRoot, execucao.estrategia);
      stdout.write(`estratégia de execução salva em ${ARQUIVO_DE_EXECUCAO}: as próximas execuções deste projeto a usam sem flag\n`);
    }
    const paralela = execucao.estrategia.mode === "parallel";
    const agentesNaTela = paralela ? new WorkerTracker(execucao.agentes.map((agente) => agente.label)) : null;
    /*
     * O log de cada agente (§98): um buffer limitado na memória, para a tela, e
     * o arquivo completo na pasta do run, que só existe depois de o loop dizer
     * qual é o run. Separados por agente desde a origem — a chamada diz de qual
     * agente é —, nunca por leitura do texto.
     */
    const logsDosAgentes = paralela ? new LogsDosAgentes(execucao.agentes.length) : null;
    let agenteSelecionado = 0;
    let pastaDosLogs: string | null = null;
    const arquivosDosAgentes = new Map<string, WriteStream>();
    const gravarNoLog = (slot: number, fluxo: "out" | "err", texto: string): void => {
      if (pastaDosLogs === null) return;
      const caminho = join(pastaDosLogs, `agente-${slot + 1}.${fluxo}.log`);
      let arquivo = arquivosDosAgentes.get(caminho);
      if (!arquivo) {
        mkdirSync(pastaDosLogs, { recursive: true });
        arquivo = createWriteStream(caminho, { flags: "a" });
        // Disco cheio não derruba o build: o log é evidência, não trabalho.
        arquivo.on("error", () => undefined);
        arquivosDosAgentes.set(caminho, arquivo);
      }
      arquivo.write(texto);
    };
    const marcarNoLog = (slot: number, texto: string, inicio: boolean): void => {
      if (!logsDosAgentes) return;
      if (inicio) logsDosAgentes.comecarChamada(slot, texto, Date.now());
      else {
        logsDosAgentes.log(slot)?.fecharParciais();
        logsDosAgentes.terminarChamada(slot, texto);
      }
      const linha = `\n${inicio ? "▶" : "■"} [${new Date().toISOString()}] ${texto}\n`;
      gravarNoLog(slot, "out", linha);
      gravarNoLog(slot, "err", linha);
    };
    const eventoDoAgente = (slot: number, texto: string): void => logsDosAgentes?.eventosDe(slot)?.registrar(texto, new Date());

    const comPainel = flags.dashboard !== false && stdout.isTTY === true;
    if (flags.splash !== false && !comPainel) {
      const papeis = describeRoles(roles).filter((role) => (BUILD_ROLES as readonly string[]).includes(role.role));
      stdout.write(renderSplash({ version: VERSION, roles: papeis, style: style() }));
    }

    /*
     * O painel do build.
     *
     * As fases são a informação que o build tem e o init não: quantas faltam, e
     * em que gate a corrente está parada. A tela mostrava a fase corrente e mais
     * nada, e "escreveu mas a suíte reprovou" ficava indistinguível de "o engine
     * morreu" — dois diagnósticos opostos, o mesmo silêncio.
     */
    const fases = new BuildPhaseTracker();
    // O plano inteiro, para a parada poder dizer "3 de 8" em vez de só "3".
    let totalDeFases = 0;
    const painelBuild = new HarnessProgress({
      version: VERSION,
      command: "build",
      project: basename(resolve(projectRoot)),
      /*
       * No paralelo quem constrói são os agentes, não o builder: mostrar o
       * builder aqui diria que um modelo está trabalhando quando são outros.
       */
      roles: describeRoles(roles)
        .filter((role) => (BUILD_ROLES as readonly string[]).includes(role.role))
        .map((role) =>
          paralela && role.role === "builder"
            ? { role: "agentes", provider: [...new Set(execucao.agentes.map((agente) => agente.label))].join(", "), model: "" }
            : role,
        ),
      provider: {
        perfil: `${roles.builder.provider}${roles.builder.model ? `:${roles.builder.model}` : ""}`,
        transporte: `${roles.builder.provider}-cli`,
        contabilidade: "por chamada",
      },
      style: style(),
      environment: process.env,
    });

    const liveBuild = createLiveRegion((text) => void stdout.write(text), comPainel, () => ({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 40 }));
    const larguraBuild = (): number => stdout.columns ?? 100;
    const fundoBuild = ((): string | undefined => {
      const escolhido = process.env.CAPIVARA_BG?.trim();
      if (escolhido === "none") return undefined;
      if (!supportsTrueColor(process.env)) return undefined;
      return escolhido && escolhido !== "" ? escolhido : UBUNTU_AUBERGINE;
    })();

    const desenharBuild = semDerrubarORun(() => {
      painelBuild.setPhases(fases.rows(), fases.summary(), MAX_LINHAS_DE_FASE);
      painelBuild.setWorkers(agentesNaTela?.rows() ?? null, teclasBuild && agentesNaTela ? agenteSelecionado : undefined);
      return renderDashboard({
        ...painelBuild.model(),
        width: larguraBuild(),
        height: stdout.rows ?? 40,
        ...(fundoBuild !== undefined ? { background: fundoBuild } : {}),
      });
    }, VERSION);
    const repaintBuild = (): void => liveBuild.draw(desenharBuild());
    liveBuild.beat(() => {
      painelBuild.tick();
      return desenharBuild();
    });

    // O build pergunta ao desenvolvedor quando falta pré-requisito — mas só
    // quando há um desenvolvedor para responder. Sem terminal, faltar
    // pré-requisito continua sendo erro de preflight, e não um palpite.
    //
    // Com o painel na tela, a decisão é uma lista numa caixa embaixo dele
    // (§94). A sessão de teclas abre JÁ AQUI, e não na hora da pergunta: tecla
    // batida durante o build ficaria no buffer do terminal e responderia a
    // pergunta no instante em que ela abrisse — o defeito do `assistencia2`.
    const teclasBuild =
      comPainel && stdin.isTTY === true && stdout.isTTY === true && process.env.CAPIVARA_LINE_INPUT !== "1"
        ? createKeySession({ input: stdin, write: (text) => void stdout.write(text), columns: () => stdout.columns ?? 100 })
        : null;
    const terminalBuild = !teclasBuild && stdin.isTTY === true ? createInterface({ input: stdin, output: stdout }) : null;
    const linhasBuild = terminalBuild ? createLineIO(terminalBuild, (text) => void stdout.write(text), { interactive: true }) : null;
    const escolherNoBuild = (titulo: string, escolha: EscolhaNumerada): Promise<string> =>
      liveBuild.suspend(() =>
        chooseInBox(teclasBuild!, {
          title: titulo,
          text: escolha.texto,
          choices: escolha.opcoes.map((label) => ({ label })),
          write: (text) => void stdout.write(text),
          dimensions: () => ({ columns: stdout.columns ?? 100, rows: stdout.rows ?? 40 }),
          style: style(),
        }).then((indice) => String(indice + 1), (error: unknown) => {
          // Entrada esgotada é abortar, como na leitura de linha.
          if (error instanceof InputEndedError) return String(escolha.opcoes.length);
          throw error;
        }),
      );

    /*
     * Pausar e ver uma fase (§95). Só existem com a sessão de teclas: sem
     * terminal não há quem aperte, e sem painel não há onde mostrar.
     */
    const pausa = new PauseGate();
    let telaAberta: Promise<void> | null = null;
    let buildTerminou = false;
    const verFases = (): void => {
      if (telaAberta || !teclasBuild) return;
      telaAberta = mostrarFases().catch((erro: unknown) => {
        // Sessão fechada no meio — o terminal volta, e o build segue o desfecho.
        stdout.write("\u001B[?25h\u001B[?1049l");
        if (!(erro instanceof InputEndedError)) throw erro;
      });
    };
    const verLogDoAgente = (slot: number): void => {
      if (telaAberta || !teclasBuild || !logsDosAgentes || !agentesNaTela) return;
      telaAberta = mostrarLogDoAgente(slot).catch((erro: unknown) => {
        stdout.write("\u001B[?25h\u001B[?1049l");
        if (!(erro instanceof InputEndedError)) throw erro;
      });
    };
    /*
     * O log de um agente, em tela alternativa (§98). Redesenha no máximo dez
     * vezes por segundo e só quando algo mudou — o log do agente, os eventos
     * dele, o relógio, o tamanho da janela —: um agente que despeja milhares de
     * linhas por segundo não congela a tela, e a tela não segura o build.
     */
    const mostrarLogDoAgente = async (inicial: number): Promise<void> => {
      if (!teclasBuild || !logsDosAgentes || !agentesNaTela) return;
      const logs = logsDosAgentes;
      const agentes = agentesNaTela;
      const sessao = teclasBuild;
      try {
        await liveBuild.hold(async () => {
          stdout.write("\u001B[?1049h\u001B[?25l\u001B[2J");
          let estado = abrirPainel(inicial);
          let medidas: MedidasDoPainel = { saida: { total: 0, visiveis: 1 }, eventos: { total: 0, visiveis: 0 } };
          let assinatura = "";
          const desenhar = (forcar: boolean): void => {
            const agora = Date.now();
            const tela = { columns: stdout.columns ?? 100, rows: stdout.rows ?? 40 };
            const atual = `${estado.slot}|${logs.versao(estado.slot)}|${Math.floor(agora / 1000)}|${tela.columns}x${tela.rows}|${buildTerminou}`;
            if (!forcar && atual === assinatura) return;
            assinatura = atual;
            const agente = agentes.rows()[estado.slot]!;
            const fase = agente.phaseId ? fases.rows().find((linha) => linha.id === agente.phaseId) : undefined;
            const log = logs.log(estado.slot)!;
            const desenho = renderPainelDoAgente(
              {
                agente,
                ...(fase ? { fase } : {}),
                linhas: log.ver(),
                descartadas: log.descartadas,
                eventos: logs.eventosDe(estado.slot)?.ver() ?? [],
                agora,
                inicioDaChamada: logs.inicioDaChamada(estado.slot),
                arquivo: pastaDosLogs
                  ? `${relative(resolve(projectRoot), join(pastaDosLogs, `agente-${estado.slot + 1}.out.log`))} (stderr em .err.log)`
                  : null,
                totalDeAgentes: logs.quantos,
                buildTerminou,
              },
              estado,
              tela,
              style(),
            );
            medidas = desenho.medidas;
            stdout.write(`\u001B[H${desenho.linhas.map((linha) => `${linha}\u001B[K`).join("\n")}\u001B[J`);
          };
          await new Promise<void>((pronto) => {
            const decodificador = new KeyDecoder();
            const aoRedimensionar = (): void => {
              stdout.write("\u001B[2J");
              desenhar(true);
            };
            const relogio = setInterval(() => desenhar(false), 100);
            const fechar = (): void => {
              clearInterval(relogio);
              stdout.off("resize", aoRedimensionar);
              soltar();
              pronto();
            };
            const soltar = sessao.capture((texto) => {
              for (const tecla of decodificador.feed(texto)) {
                const passo = reduzirPainel(estado, tecla, medidas, logs.quantos);
                if (passo.fechar) return fechar();
                estado = passo.estado;
                if (estado.slot !== agenteSelecionado) agenteSelecionado = estado.slot;
                desenhar(true);
              }
            });
            stdout.on("resize", aoRedimensionar);
            desenhar(true);
          });
          stdout.write("\u001B[?25h\u001B[?1049l");
        });
      } finally {
        telaAberta = null;
        repaintBuild();
      }
    };
    const mostrarFases = async (): Promise<void> => {
      if (!teclasBuild) return;
      const TELA_ALTERNATIVA = "\u001B[?1049h\u001B[?25l";
      const TELA_NORMAL = "\u001B[?25h\u001B[?1049l";
      try {
        await liveBuild.hold(async () => {
          let cursor = Math.max(0, fases.rows().findIndex((linha) => linha.state === "em andamento"));
          for (;;) {
            const linhas = fases.rows();
            const spec: SelectSpec = {
              title: "Qual fase?",
              choices: linhas.map((linha) => ({
                label: `${linha.id}  ${linha.title}`,
                hint: `${linha.state}${linha.detail && linha.detail !== linha.state ? ` · ${linha.detail}` : ""}`,
              })),
              defaultIndex: Math.min(cursor, linhas.length - 1),
              cancelable: true,
            };
            stdout.write(TELA_ALTERNATIVA);
            const escolhida = await teclasBuild.select(spec, (state) => {
              const largura = Math.min(110, stdout.columns ?? 100);
              const corpo = [
                ...renderSelect(spec, state, largura - 2, Math.max(4, (stdout.rows ?? 40) - 6), style()),
                "",
                buildTerminou
                  ? paint(" o build terminou · Esc mostra o resultado", "yellow", style())
                  : paint(" ↑ ↓ move · Enter abre a fase · Esc volta ao painel — o build segue rodando", "gray", style()),
              ];
              stdout.write(`\u001B[2J\u001B[H${box("VER FASE", corpo, largura, style()).join("\n")}`);
            });
            if (escolhida === null) break;
            cursor = escolhida;
            const fase = linhas[escolhida]!;
            const modal = modalDaFase(fase, await textoDaFase(projectRoot, fase.id), painelBuild.model().events, style());
            // A telinha tem o próprio leitor de teclas; a sessão só repassa os bytes.
            let soltar: (() => void) | null = null;
            await abrirModal(modal, {
              entrada: {
                isTTY: true,
                setRawMode: () => undefined,
                resume: () => undefined,
                pause: () => undefined,
                on: (_evento, ouvinte) => {
                  soltar = teclasBuild.capture((texto) => ouvinte(texto));
                },
                off: () => soltar?.(),
              },
              saida: stdout,
              style: style(),
            });
          }
          stdout.write(TELA_NORMAL);
        });
      } finally {
        telaAberta = null;
        repaintBuild();
      }
    };
    if (teclasBuild) {
      painelBuild.setKeys(teclasDoBuild(pausa.state, paralela));
      teclasBuild.onIdle((tecla) => {
        // A escolha de agente só existe no paralelo, e só move um cursor: nada aqui espera nada.
        if (agentesNaTela && logsDosAgentes) {
          const passo = teclaNaCaixaDeAgentes(agenteSelecionado, tecla, logsDosAgentes.quantos);
          if (passo) {
            agenteSelecionado = passo.selecionado;
            if (passo.abrir) verLogDoAgente(agenteSelecionado);
            else repaintBuild();
            return true;
          }
        }
        if (tecla.type !== "char") return false;
        const letra = tecla.text.toLowerCase();
        if (letra === "p") {
          const efeito = pausa.toggle();
          painelBuild.note(
            efeito === "pedida"
              ? "pausa pedida: o build para antes da próxima chamada de modelo"
              : efeito === "cancelada"
                ? "pedido de pausa desfeito"
                : "build retomado",
          );
          painelBuild.setKeys(teclasDoBuild(pausa.state, paralela));
          repaintBuild();
          return true;
        }
        // Antes de o plano ser anunciado não há fase para ver — e é ali que o
        // build ainda pode estar fazendo uma pergunta própria.
        if (letra === "f" && fases.rows().length > 0) {
          verFases();
          return true;
        }
        return false;
      });
    }

    /*
     * O esqueleto do `init` é o que diz quais fluxos existem. Ele é carregado
     * aqui, e não dentro do loop, porque quem o guarda é o estágio de
     * documentação: o loop importado pelo init não pode importar o init de volta.
     */
    const pedidoRegistrado = await readRequestState(projectRoot);
    const esqueletoDoBuild = pedidoRegistrado
      ? await readSkeletonState(projectRoot, runIdFor("init", pedidoRegistrado.sha12))
      : null;
    /*
     * E a arquitetura estruturada que o `plan` guardou ao lado dela (§125): o
     * build a confere contra o `architecture.md` publicado antes de entregar a
     * fatia de cada fase.
     */
    const arquiteturaDoBuild = pedidoRegistrado
      ? (await readArchitectureState(projectRoot, runIdFor("init", pedidoRegistrado.sha12)))?.architecture ?? null
      : null;

    /*
     * O build também consulta a base — é dela que vêm as skills que serão
     * materializadas. Se ela não responder, o run segue com o que já está em
     * `.capivara/skills/` de uma execução anterior: a base é conveniência, não
     * dependência (§34).
     */
    const herdada = baseRegistrada(pedidoRegistrado);
    Object.assign(flags, resolveMcpProject(flags, herdada));
    if (herdada && flags.mcpProject) {
      stdout.write(`base do projeto: ${flags.mcpProject} (registrada pelo init; flags, ambiente e configuração global definem o endpoint atual)\n`);
    }

    const materialDoBuild = await lerDaBase(flags, (mensagem) => stdout.write(`${mensagem}\n`), { tolerante: true });

    /*
     * A volta para a base. Só existe quando o operador apontou uma: sem `--mcp`,
     * o build continua sendo o que sempre foi, e o que o executor anotar fica em
     * `.capivara/memorias/` para alguém ler.
     */
    const devolverMemorias =
      flags.mcp && flags.mcpProject
        ? async (memorias: MemoriaParaRegistrar[]): Promise<void> => {
            try {
              const client = createMcpClient(resolveMcpEndpoint(flags.mcp)!, { timeoutSeconds: 20 });
              await client.initialize();
              const resultado = await registrarMemorias(client, flags.mcpProject!, memorias, (mensagem) =>
                stdout.write(`${mensagem}\n`),
              );
              if (resultado.registradas > 0) {
                stdout.write(
                  `${resultado.registradas} memória(s) enviada(s) à base como rascunho; aprove na interface para valerem\n`,
                );
              }
            } catch (erro) {
              // Um servidor fora do ar no fim de um build não transforma um run
              // bem-sucedido em falha: a base é conveniência, não dependência.
              stdout.write(`aviso: não consegui enviar as memórias à base (${erro instanceof Error ? erro.message : String(erro)})\n`);
            }
          }
        : undefined;

    const anunciar = (message: string): void => {
      painelBuild.note(message.trim());
      if (liveBuild.enabled) repaintBuild();
      else stdout.write(`${message}\n`);
    };
    // O serial pedido explicitamente diz de onde veio; o paralelo é resumido pelo loop, depois do preflight.
    if (!paralela) for (const linha of execucao.resumo) anunciar(linha);

    const outcome = await runBuild({
      projectRoot,
      roles: {
        ...snapshotDePapeis(roles, BUILD_ROLES),
        ...(paralela ? Object.fromEntries(execucao.agentes.map((agente, slot) => [
          `worker-${slot + 1}`,
          { provider: agente.config.provider, model: agente.config.model, effort: agente.config.effort },
        ])) : {}),
      },
      ...(paralela && execucao.estrategia.mode === "parallel"
        ? {
            parallel: {
              maxConcurrency: execucao.estrategia.maxConcurrency,
              agentes: execucao.agentes.map((agente) => ({ engine: agente.config.provider, label: agente.label, systemInstall: agente.systemInstall })),
              resumo: execucao.resumo,
            },
            onWorker: (evento: WorkerProgress) => {
              agentesNaTela?.apply(evento);
              eventoDoAgente(evento.slot, descreverEventoDoAgente(evento));
              repaintBuild();
            },
          }
        : {}),
      skeleton: esqueletoDoBuild,
      architecture: arquiteturaDoBuild,
      skipFlows: flags.flows === false,
      ...(flags.rebuildAll === true ? { rebuildAll: true } : {}),
      ...(flags.git === false ? { gitInit: false } : {}),
      ...(materialDoBuild && materialDoBuild !== "erro" ? { library: materialDoBuild.documents } : {}),
      ...(devolverMemorias ? { onMemorias: devolverMemorias } : {}),
      ...(terminalBuild || teclasBuild
        ? {
            /*
             * A falta de repositório é perguntada pelo mesmo caminho do
             * pré-requisito ausente, porque é a mesma categoria de coisa: algo
             * que o build precisa e não está lá. Entrada esgotada é abortar.
             */
            askGit: async (rendered: string, escolha: EscolhaNumerada) =>
              teclasBuild ? escolherNoBuild("SEM REPOSITÓRIO GIT · precisa da sua decisão", escolha) : liveBuild.suspend(async () => {
                stdout.write(`\n${rendered}\n`);
                return await linhasBuild!.ask("> ").catch((error: unknown) => {
                  if (error instanceof InputEndedError) return "3";
                  throw error;
                });
              }),
            // A pergunta sai do alcance do painel: sem isso o pulso seguinte a
            // apagava, e o preflight ficava esperando uma resposta invisível.
            askPrerequisite: async (rendered: string, escolha: EscolhaNumerada) =>
              teclasBuild ? escolherNoBuild("PRÉ-REQUISITO AUSENTE · precisa da sua decisão", escolha) : liveBuild.suspend(async () => {
                stdout.write(`\n${rendered}\n`);
                // Entrada esgotada é "abortar": faltando pré-requisito e sem quem
                // decida, instalar por conta própria seria um palpite caro.
                return await linhasBuild!.ask("> ").catch((error: unknown) => {
                  if (error instanceof InputEndedError) return "3";
                  throw error;
                });
              }),
            installPrerequisites: async (prompt: string) => {
              const started = Date.now();
              painelBuild.beginCall("preparação do ambiente");
              repaintBuild();
              const bridge = createAgentBridge({
                projectRoot,
                runId: "build",
                language,
                roles,
                limits: DEFAULT_LIMITS,
                systemInstall: flags.systemInstall !== false,
              });
              const response = await bridge({ role: "builder", stage: "preflight", prompt,
                onActivity: line => {
                  painelBuild.modelActivity(`preparação: ${line}`, started);
                  painelBuild.note(`preparação: ${line}`);
                  repaintBuild();
                },
              });
              painelBuild.charge(response.usage);
              repaintBuild();
              return response;
            },
          }
        : {}),
      language,
      engine: roles.builder.provider,
      ...(flags.testCmd !== undefined ? { explicitTestCommand: flags.testCmd } : {}),
      maxCycles: Number(flags.maxCycles),
      maxVerifierRepairs: verifierRepairs,
      ...(Object.keys(orcamento).length > 0 ? { orcamento } : {}),
      verifierResume: contratoDaRetomada(roles.verifier.provider),
      ...(flags.verifierResume === true ? { verifierResumeUnverified: true } : {}),
      systemInstall: flags.systemInstall !== false,
      skipAcceptance: flags.acceptance === false,
      ...(flags.keepGoing !== undefined ? { keepGoing: flags.keepGoing } : {}),
      announce: anunciar,
      onPlanned: (planejadas, contexto) => {
        totalDeFases = planejadas.length;
        if (contexto?.runId) {
          pastaDosLogs = runPaths(projectRoot, contexto.runId).logs;
          mkdirSync(pastaDosLogs, { recursive: true });
        }
        fases.plan(planejadas);
        if (contexto?.testCommand) painelBuild.setNote(`Teste: ${contexto.testCommand}`);
        repaintBuild();
      },
      onProgress: (evento) => {
        fases.apply(evento);
        if (evento.kind === "phase") painelBuild.setStage(`${evento.id} · ${evento.detail}`);
        // O gate que mudou vai aos eventos do agente que está naquela fase — pelo id, não pelo texto.
        for (const agente of agentesNaTela?.rows() ?? []) {
          if (agente.phaseId === evento.id) eventoDoAgente(agente.slot, descreverProgressoDaFase(evento));
        }
        repaintBuild();
      },
      call: async (call) => {
        /*
         * No paralelo, a chamada vem com o agente e a árvore dela: o executor é
         * o modelo daquele agente, e os dois papéis trabalham no worktree da
         * fase. O verificador continua sendo o mesmo para todos.
         */
        const agente = call.worker !== undefined ? execucao.agentes[call.worker] : undefined;
        const bridge = createAgentBridge({
          projectRoot: call.root ?? projectRoot,
          ...(call.environment ? { environment: call.environment } : {}),
          runId: "build",
          language,
          roles: agente ? { ...roles, builder: agente.config } : roles,
          limits: DEFAULT_LIMITS,
          systemInstall: agente ? agente.systemInstall : flags.systemInstall !== false,
        });
        // O número é do agente, e só o executor é de um agente: o verificador é um só.
        const review = call.purpose ? FLOW_REVIEWS[call.purpose] : null;
        const quem = `${review ? review.label : call.role === "builder" && call.worker !== undefined ? `agente ${call.worker + 1}` : call.repair ? "verificador em reparo" : call.role} · ${call.phase.id}`;
        // A pausa segura AQUI: nenhuma sessão de agente fica pela metade.
        await pausa.wait(() => {
          painelBuild.paused(`antes de ${quem} · p retoma`);
          painelBuild.setKeys(teclasDoBuild(pausa.state, paralela));
          repaintBuild();
        });
        painelBuild.setKeys(teclasBuild ? teclasDoBuild(pausa.state, paralela) : null);
        painelBuild.beginCall(quem);
        repaintBuild();
        const slot = logsDosAgentes && call.worker !== undefined ? call.worker : null;
        const papel = `${review?.label ?? (call.role === "builder" ? "executor" : "verificador")} · ${call.phase.id} · ${call.parte ? `parte ${call.parte}` : `tentativa ${call.attempt}`}`;
        if (slot !== null) marcarNoLog(slot, papel, true);
        const comecou = Date.now();
        let resposta: Awaited<ReturnType<typeof bridge>>;
        try {
          if (pastaDosLogs) {
            const effective = call.role === "builder" && agente ? agente.config : roles[call.role];
            await appendFile(join(pastaDosLogs, "calls.jsonl"), `${JSON.stringify({
              timestamp: new Date().toISOString(), role: call.role, repair: call.repair === true,
              purpose: call.purpose ?? null, resumeSession: call.resumeSession ?? null, wallSeconds: DEFAULT_LIMITS.wallSeconds,
              phase: call.phase.id, attempt: call.attempt, part: call.parte ?? null, worker: call.worker ?? null,
              provider: effective.provider, model: effective.model, effort: effective.effort,
              root: call.root ?? projectRoot, node: process.version, abi: process.versions.modules,
              e2ePort: call.environment?.E2E_PORT ?? null,
            })}\n`).catch(() => undefined);
          }
          resposta = await bridge({
            role: call.role,
            stage: call.purpose ?? (call.repair ? "repair" : "implement"),
            ...(call.purpose ? { purpose: call.purpose } : {}),
            ...(call.repair === true ? { repair: true } : {}),
            ...(call.resumeSession !== undefined ? { resumeSessionId: call.resumeSession } : {}),
            prompt: call.prompt,
            ...(slot !== null
              ? {
                  onOutput: (pedaco: string, fluxo: "out" | "err") => {
                    logsDosAgentes!.log(slot)?.anexar(fluxo, pedaco);
                    gravarNoLog(slot, fluxo, pedaco);
                  },
                }
              : {}),
            // Sem isto o terminal fica com cara de travado durante os minutos em
            // que a sessão do executor trabalha.
            onActivity: (line) => {
              painelBuild.modelActivity(`${quem}: ${line}`, comecou);
              painelBuild.note(`${quem}: ${line}`);
              if (slot !== null) {
                agentesNaTela?.activity(slot, call.phase.id, line);
                eventoDoAgente(slot, `${call.phase.id} · ${line}`);
              }
              repaintBuild();
            },
          });
        } catch (erro) {
          if (slot !== null) marcarNoLog(slot, `${papel}: a chamada não terminou (${erro instanceof Error ? erro.message.split("\n")[0] : String(erro)})`, false);
          throw erro;
        }
        if (slot !== null) {
          const segundos = Math.round((Date.now() - comecou) / 1000);
          marcarNoLog(slot, `${papel}: terminou com código ${resposta.exitCode} em ${segundos}s${resposta.timedOut ? ` · interrompida: ${resposta.timedOut}` : ""}`, false);
        }
        painelBuild.charge(resposta.usage);
        repaintBuild();
        return resposta;
      },
    });

    liveBuild.release();
    terminalBuild?.close();
    // Quem está lendo uma fase quando o build termina fecha a leitura primeiro:
    // o desfecho abre a própria telinha, e duas telas alternativas se pisariam.
    buildTerminou = true;
    if (telaAberta) await telaAberta;
    for (const arquivo of arquivosDosAgentes.values()) arquivo.end();
    // Antes da telinha da parada: ela põe o terminal em modo raw por conta própria.
    teclasBuild?.close();
    painelBuild.setKeys(null);

    /*
     * O desfecho, no formato único.
     *
     * Aqui o build não reimprimia nada: `announce` tinha contado a falha durante
     * a execução, e a última linha da tela era o que a rolagem tivesse deixado.
     * Quem voltava ao terminal de manhã não sabia se as oito fases fecharam, se
     * parou na terceira, nem se o que estava feito continuava valendo — e era
     * por isso que toda parada virava uma pergunta.
     */
    const relatorio = relatorioDoBuild(outcome, totalDeFases > 0 ? { totalDeFases } : {});
    if (relatorio.tipo === "parada") await mostrarParada(relatorio.parada, projectRoot, flags);
    else await apresentarConclusao(relatorio.conclusao, [], janela(flags));

    process.exitCode = outcome.exitCode;
  });

  /**
   * O wizard monta o comando e reexecuta ESTE MESMO programa com o argv que
   * acabou de imprimir. Nada de um segundo caminho de execução: o que ele ensina
   * é literalmente o que ele roda.
   */
  const wizard = async (): Promise<void> => {
    const entrada = abrirEntradaDoWizard("wizard · monta o comando com você");
    let resultado;
    try {
      resultado = await runWizard({
        io: entrada.io,
        cwd: process.cwd(),
        listModels: (providerId) => listarModelos(providerId, process.env, undefined, (message) => entrada.io.write(`${message}\n`)),
        listEfforts: (providerId, model) => listarEfforts(providerId, model),
        listModelHints: (providerId) => listarDicas(providerId),
        /*
         * O wizard conecta de verdade para listar os projetos. Perguntar o nome
         * do projeto num campo livre deixaria o erro de digitação para o run
         * descobrir; aqui ele custa uma mensagem.
         */
        ...mundoDoWizard(),
        requestRecorded: async (root) => (await readRequestState(root)) !== null,
      });
    } finally {
      /*
       * A fila de linhas segue aberta para o prompt-engineer quando ela veio de
       * pipe: a entrevista dele pode estar no mesmo roteiro. A entrada por tecla
       * sempre fecha aqui — o estágio abre a própria, e o terminal precisa sair
       * do modo raw antes disso.
       */
      if (entrada.teclas || !resultado?.execute || resultado.answers.command !== "prompt-engineer") entrada.close();
    }

    if (!resultado) {
      process.exitCode = 2;
      return;
    }
    if (!resultado.execute) {
      stdout.write("Nada foi executado. O comando acima faz o mesmo quando você quiser.\n");
      return;
    }
    if (resultado.answers.command === "prompt-engineer" && !entrada.teclas) {
      // O pipe pode conter a entrevista depois do wizard; a fila continua sendo a mesma.
      entradaDoWizard = entrada.io;
      try { await program.parseAsync(resultado.argv, { from: "user" }); }
      finally { entradaDoWizard = undefined; entrada.close(); }
    } else {
      await program.parseAsync(resultado.argv, { from: "user" });
    }
  };

  program.command("wizard").description("Monta o comando interativamente e executa").action(wizard);
  program.action(wizard);

  return program;
}
