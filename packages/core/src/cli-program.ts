import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import { listProviders, renderProviderList } from "./commands/providers.js";
import { diagnose, renderDiagnosis } from "./commands/doctor.js";
import { DEFAULT_LIMITS, createAgentBridge } from "./commands/agent.js";
import { BUILD_ROLES, INIT_ROLES, describeRoles, renderUnresolved, rolesFromFlags, unresolvedRoles, type CliRoleFlags } from "./commands/options.js";
import {
  InitBlockedError,
  baseRegistrada,
  readRequestState,
  readSkeletonState,
  requestFromLibrary,
  resolveRequest,
  runInit,
  runPlan,
} from "./init/index.js";
import { createMcpClient, fetchProjectMaterial, listLibraryProjects, registrarMemorias, type MemoriaParaRegistrar } from "./mcp/index.js";
import type { ProjectMaterial } from "./mcp/index.js";
import type { InitOptions } from "./init/index.js";
import { commitSpecification, runBuild } from "./loop/index.js";
import {
  BACK,
  BuildPhaseTracker,
  HarnessProgress,
  createLiveRegion,
  detectLanguage,
  UBUNTU_AUBERGINE,
  paint,
  questionBox,
  renderDashboard,
  renderQuestion,
  renderSplash,
  supportsColor,
  supportsTrueColor,
} from "./tui/index.js";
import { runWizard } from "./commands/wizard.js";
import { InputEndedError, createLineIO } from "./commands/line-io.js";
import { listarEfforts, listarModelos } from "./provider/index.js";
import { runIdFor } from "./state/index.js";
import { VERSION } from "./version.js";

interface CommonFlags extends CliRoleFlags {
  project?: string;
  language?: string;
  splash?: boolean;
}

function style() {
  return { enabled: supportsColor() };
}

function roleFlags(command: Command, roles = ["writer", "auditor", "builder", "verifier"]): Command {
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
    .option("--language <idioma>", "idioma da interface e dos documentos")
    .option("--no-splash", "não mostra a abertura");
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
 * O painel e as perguntas dos dois estágios do ciclo.
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
  estagio: "init" | "plan";
  projectRoot: string;
  runId: string;
  language: string;
  roles: ReturnType<typeof rolesFromFlags>;
  comPainel: boolean;
  /** Como a caixa de pergunta se apresenta: o init entrevista, o plan detalha fase. */
  documento: string;
}) {
  const { projectRoot, runId, roles, comPainel } = options;
  const bridge = createAgentBridge({ projectRoot, runId, language: options.language, roles, limits: DEFAULT_LIMITS });
  const terminal = createInterface({ input: stdin, output: stdout });

  /*
   * A leitura é enfileirada, não `terminal.question()` direto: entrada vinda de
   * pipe ou arquivo chega inteira antes da primeira pergunta, o readline fecha
   * no fim dela, e a pergunta seguinte estoura em ERR_USE_AFTER_CLOSE.
   */
  const linhas = createLineIO(terminal, (text) => void stdout.write(text));
  const perguntar = async (prompt: string, decision: string): Promise<string> => {
    try {
      return await linhas.ask(prompt);
    } catch (error) {
      if (!(error instanceof InputEndedError)) throw error;
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
    roles: describeRoles(roles).filter((role) => (INIT_ROLES as readonly string[]).includes(role.role)),
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

  const desenhar = (): string =>
    renderDashboard({
      ...progress.model(),
      width: larguraAtual(),
      height: stdout.rows ?? 40,
      ...(fundo !== undefined ? { background: fundo } : {}),
    });
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
    const quem = `${chamada.role} · ${chamada.subject.replace(/\.md$/, "")}`;
    progress.beginCall(quem);
    repaint();
    const response = await bridge({
      role: chamada.role,
      stage: chamada.stage,
      prompt: chamada.prompt,
      // A janela de log recebe o que a CLI conta enquanto trabalha; sem isso o
      // terminal fica com cara de travado durante minutos.
      onActivity: (line) => {
        progress.note(`${quem}: ${line}`);
        repaint();
      },
    });
    progress.charge(response.usage);
    repaint();
    return {
      stdout: response.stdout,
      exitCode: response.exitCode,
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

  const ask: InitOptions["ask"] = async (question, index, total) => {
    /*
     * Sem terminal não há a quem perguntar. Oferecer a pergunta a uma entrada
     * que não existe termina em ERR_USE_AFTER_CLOSE do readline — stack trace no
     * lugar de diagnóstico, no fim de horas de trabalho. Foi o que derrubou um
     * run inteiro do piloto 3 numa única pergunta.
     */
    if (stdin.isTTY !== true) {
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
    progress.waitingForDeveloper();
    if (live.enabled) {
      progress.asking(questionBox({ question, index, total, document: options.documento, style: style() }, larguraAtual()));
      repaint();
      live.release();
      progress.asking(null);
      const answer = await perguntar(paint("  ▸ sua resposta: ", "cyan", style()), question.decision);
      return answer.trim().toLowerCase() === BACK ? "" : answer;
    }

    stdout.write(renderQuestion({ question, index, total, document: options.documento, style: style() }));
    const answer = await perguntar("> ", question.decision);
    return answer.trim().toLowerCase() === BACK ? "" : answer;
  };

  /*
   * Sem terminal não há a quem perguntar, e o orquestrador já sabe parar com o
   * impasse na tela quando ninguém decide.
   */
  const decideStandoff: InitOptions["decideStandoff"] = async (rendered: string) => {
    progress.waitingForDeveloper();
    if (live.enabled) {
      progress.asking({ title: "IMPASSE · precisa da sua decisão", body: rendered.split("\n") });
      repaint();
      live.release();
      progress.asking(null);
      return perguntar(paint('  ▸ sua decisão (ou "publicar" para aceitar como está): ', "cyan", style()), "o impasse do auditor");
    }
    stdout.write(`\n${rendered}\n`);
    return perguntar('> (responda, ou "publicar" para aceitar como está) ', "o impasse do auditor");
  };

  return {
    progress,
    live,
    repaint,
    /** O que se passa ao orquestrador; `decideStandoff` só existe com terminal. */
    hooks: {
      announce,
      onProgress,
      call,
      ask,
      ...(stdin.isTTY === true ? { decideStandoff } : {}),
    },
    close: () => terminal.close(),
  };
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
  const url = flags.mcp?.trim();
  const projeto = flags.mcpProject?.trim();
  if (!url && !projeto) return null;

  if (!url || !projeto) {
    escrever("erro: --mcp e --mcp-project andam juntos: a URL diz onde é a base, o projeto diz o que ler dela.");
    return "erro";
  }

  try {
    const client = createMcpClient({ url });
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
  program
    .name("capivara")
    .description("Harness documental e loop de execução: do prompt à aplicação final")
    .version(VERSION, "-v, --version", "mostra a versão")
    .helpOption("-h, --help", "mostra esta ajuda");

  const providers = program.command("providers").description("Inspeciona os modelos disponíveis");
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
      .command("init")
      .description("Entrevista e desenha as fases do projeto até PLAN READY")
      .argument("[pedido]", "o que você quer construir; aceita @arquivo")
      .option("--file <caminho>", "lê o pedido de um arquivo")
      .option("--mcp <url>", "base documental por MCP, como http://localhost:7777/mcp")
      .option("--mcp-project <nome>", "de qual projeto da base vêm o pedido e os documentos")
      .option("--max-audit-returns <n>", "devoluções do auditor por documento", "3")
      .option("--max-interview-rounds <n>", "rodadas de entrevista", "3")
      .option("--fresh", "ignora o que este run já publicou e recomeça do zero")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso")
      .option("--no-commit", "não versiona a especificação ao chegar em PLAN READY"),
  ).action(async (pedido: string | undefined, flags: CommonFlags & { file?: string; mcp?: string; mcpProject?: string; maxAuditReturns: string; maxInterviewRounds: string; fresh?: boolean; dashboard?: boolean; commit?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    const configured = rolesFromFlags(flags);
    const semProvider = unresolvedRoles(configured, INIT_ROLES);
    if (semProvider.length > 0) {
      stdout.write(`${renderUnresolved("init", semProvider)}\n`);
      process.exitCode = 2;
      return;
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

    const request = material
      ? requestFromLibrary(flags.mcpProject!, material.request, flags.mcp)
      : await resolveRequest(projectRoot, {
          ...(pedido !== undefined ? { prompt: pedido } : {}),
          ...(flags.file !== undefined ? { file: flags.file } : {}),
        });
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

    try {
      const outcome = await runInit({
        projectRoot,
        request,
        ...(material ? { library: material.documents } : {}),
        ...(material && flags.mcp && flags.mcpProject
          ? {
              onMemorias: async (memorias) => {
                const client = createMcpClient({ url: flags.mcp! }, { timeoutSeconds: 20 });
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

      process.exitCode = outcome.readiness.ready ? 0 : 2;
    } catch (error) {
      if (error instanceof InitBlockedError) {
        ui.progress.halted(error.message.split("\n")[0] ?? "");
        ui.repaint();
        ui.live.release();
        stdout.write(`\n${error.message}\n`);
        process.exitCode = 2;
        return;
      }
      throw error;
    } finally {
      ui.close();
    }
  });

  roleFlags(
    program
      .command("plan")
      .description("Detalha as fases que o init produziu, até RALPH READY")
      .option("--file <caminho>", "lê o pedido de um arquivo; por padrão, o mesmo que o init usou")
      .option("--max-audit-returns <n>", "devoluções do auditor", "3")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso")
      .option("--no-commit", "não versiona a especificação ao chegar em RALPH READY"),
    ["writer", "auditor", "verifier"],
  ).action(async (flags: CommonFlags & { file?: string; maxAuditReturns: string; dashboard?: boolean; commit?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    const roles = rolesFromFlags(flags);
    const semProvider = unresolvedRoles(roles, INIT_ROLES);
    if (semProvider.length > 0) {
      stdout.write(`${renderUnresolved("plan", semProvider)}\n`);
      process.exitCode = 2;
      return;
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

    try {
      const outcome = await runPlan({
        projectRoot,
        request,
        language,
        maxAuditReturns: Number(flags.maxAuditReturns),
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

      process.exitCode = outcome.readiness.ready ? 0 : 2;
    } catch (error) {
      if (error instanceof InitBlockedError) {
        ui.progress.halted(error.message.split("\n")[0] ?? "");
        ui.repaint();
        ui.live.release();
        stdout.write(`\n${error.message}\n`);
        process.exitCode = 2;
        return;
      }
      throw error;
    } finally {
      ui.close();
    }
  });

  roleFlags(
    program
      .command("build")
      .description("Constrói a aplicação a partir da documentação RALPH READY")
      .option("--test-cmd <comando>", "comando de teste do projeto (gate 2)")
      .option("--max-cycles <n>", "ciclos de correção por fase", "3")
      .option("--keep-going", "continua mesmo depois de uma fase falhar")
      .option("--no-system-install", "mantém o executor dentro do workspace, sem instalar pacotes de sistema")
      .option("--no-acceptance", "pula a aceitação operacional final")
      .option("--no-flows", "pula o gate 4: não abre a aplicação para percorrer os fluxos do esqueleto")
      .option("--mcp <url>", "base documental por MCP, de onde vêm as skills do projeto")
      .option("--mcp-project <nome>", "de qual projeto da base vêm as skills")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso"),
    ["builder", "verifier"],
  ).action(async (flags: CommonFlags & { testCmd?: string; maxCycles: string; keepGoing?: boolean; systemInstall?: boolean; acceptance?: boolean; flows?: boolean; mcp?: string; mcpProject?: string; dashboard?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    const roles = rolesFromFlags(flags);
    const semProvider = unresolvedRoles(roles, BUILD_ROLES);
    if (semProvider.length > 0) {
      stdout.write(`${renderUnresolved("build", semProvider)}\n`);
      process.exitCode = 2;
      return;
    }
    const language = flags.language ?? "português do Brasil";

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
    const painelBuild = new HarnessProgress({
      version: VERSION,
      command: "build",
      project: basename(resolve(projectRoot)),
      roles: describeRoles(roles).filter((role) => (BUILD_ROLES as readonly string[]).includes(role.role)),
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

    const desenharBuild = (): string => {
      painelBuild.setPhases(fases.rows(), fases.summary(), 12);
      return renderDashboard({
        ...painelBuild.model(),
        width: larguraBuild(),
        height: stdout.rows ?? 40,
        ...(fundoBuild !== undefined ? { background: fundoBuild } : {}),
      });
    };
    const repaintBuild = (): void => liveBuild.draw(desenharBuild());
    liveBuild.beat(() => {
      painelBuild.tick();
      return desenharBuild();
    });

    // O build pergunta ao desenvolvedor quando falta pré-requisito — mas só
    // quando há um desenvolvedor para responder. Sem terminal, faltar
    // pré-requisito continua sendo erro de preflight, e não um palpite.
    const terminalBuild = stdin.isTTY === true ? createInterface({ input: stdin, output: stdout }) : null;
    const linhasBuild = terminalBuild ? createLineIO(terminalBuild, (text) => void stdout.write(text)) : null;

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
     * O build também consulta a base — é dela que vêm as skills que serão
     * materializadas. Se ela não responder, o run segue com o que já está em
     * `.capivara/skills/` de uma execução anterior: a base é conveniência, não
     * dependência (§34).
     */
    const herdada = baseRegistrada(pedidoRegistrado);
    if (herdada && (flags.mcp ?? "").trim() === "") {
      flags.mcp = herdada.url;
      flags.mcpProject = herdada.projeto;
      stdout.write(`base do projeto: ${herdada.projeto} em ${herdada.url} (registrada pelo init)\n`);
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
              const client = createMcpClient({ url: flags.mcp! }, { timeoutSeconds: 20 });
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

    const outcome = await runBuild({
      projectRoot,
      skeleton: esqueletoDoBuild,
      skipFlows: flags.flows === false,
      ...(materialDoBuild && materialDoBuild !== "erro" ? { library: materialDoBuild.documents } : {}),
      ...(devolverMemorias ? { onMemorias: devolverMemorias } : {}),
      ...(terminalBuild
        ? {
            askPrerequisite: async (rendered: string) => {
              stdout.write(`\n${rendered}\n`);
              // Entrada esgotada é "abortar": faltando pré-requisito e sem quem
              // decida, instalar por conta própria seria um palpite caro.
              return await linhasBuild!.ask("> ").catch((error: unknown) => {
                if (error instanceof InputEndedError) return "3";
                throw error;
              });
            },
            installPrerequisites: async (prompt: string) => {
              const bridge = createAgentBridge({
                projectRoot,
                runId: "build",
                language,
                roles,
                limits: DEFAULT_LIMITS,
                systemInstall: flags.systemInstall !== false,
              });
              await bridge({ role: "builder", stage: "preflight", prompt });
            },
          }
        : {}),
      language,
      engine: roles.builder.provider,
      ...(flags.testCmd !== undefined ? { explicitTestCommand: flags.testCmd } : {}),
      maxCycles: Number(flags.maxCycles),
      systemInstall: flags.systemInstall !== false,
      skipAcceptance: flags.acceptance === false,
      ...(flags.keepGoing !== undefined ? { keepGoing: flags.keepGoing } : {}),
      announce: (message) => {
        painelBuild.note(message.trim());
        if (liveBuild.enabled) repaintBuild();
        else stdout.write(`${message}\n`);
      },
      onPlanned: (planejadas) => {
        fases.plan(planejadas);
        repaintBuild();
      },
      onProgress: (evento) => {
        fases.apply(evento);
        if (evento.kind === "phase") painelBuild.setStage(`${evento.id} · ${evento.detail}`);
        repaintBuild();
      },
      call: async (call) => {
        const bridge = createAgentBridge({
          projectRoot,
          runId: "build",
          language,
          roles,
          limits: DEFAULT_LIMITS,
          systemInstall: flags.systemInstall !== false,
        });
        const quem = `${call.role} · ${call.phase.id}`;
        painelBuild.beginCall(quem);
        repaintBuild();
        const resposta = await bridge({
          role: call.role,
          stage: "implement",
          prompt: call.prompt,
          // Sem isto o terminal fica com cara de travado durante os minutos em
          // que a sessão do executor trabalha.
          onActivity: (line) => {
            painelBuild.note(`${quem}: ${line}`);
            repaintBuild();
          },
        });
        painelBuild.charge(resposta.usage);
        repaintBuild();
        return resposta;
      },
    });

    liveBuild.release();
    terminalBuild?.close();

    // Nada a reimprimir: o `announce` acima já é a saída do build, e
    // `outcome.errors` existe para quem consome o resultado como dado.
    process.exitCode = outcome.exitCode;
  });

  /**
   * O wizard monta o comando e reexecuta ESTE MESMO programa com o argv que
   * acabou de imprimir. Nada de um segundo caminho de execução: o que ele ensina
   * é literalmente o que ele roda.
   */
  const wizard = async (): Promise<void> => {
    const terminal = createInterface({ input: stdin, output: stdout });
    let resultado;
    try {
      resultado = await runWizard({
        io: createLineIO(terminal, (text) => void stdout.write(text)),
        cwd: process.cwd(),
        listModels: (providerId) => listarModelos(providerId),
        listEfforts: (providerId, model) => listarEfforts(providerId, model),
        /*
         * O wizard conecta de verdade para listar os projetos. Perguntar o nome
         * do projeto num campo livre deixaria o erro de digitação para o run
         * descobrir; aqui ele custa uma mensagem.
         */
        listMcpProjects: async (url) => {
          const client = createMcpClient({ url }, { timeoutSeconds: 15 });
          await client.initialize();
          return listLibraryProjects(client);
        },
        ...(process.env.CAPIVARA_MCP_URL ? { defaultMcpUrl: process.env.CAPIVARA_MCP_URL } : {}),
        fileExists: (path) => stat(path).then((info) => info.isFile()).catch(() => false),
        directoryExists: (path) => stat(path).then((info) => info.isDirectory()).catch(() => false),
        requestRecorded: async (root) => (await readRequestState(root)) !== null,
      });
    } finally {
      terminal.close();
    }

    if (!resultado) {
      process.exitCode = 2;
      return;
    }
    if (!resultado.execute) {
      stdout.write("Nada foi executado. O comando acima faz o mesmo quando você quiser.\n");
      return;
    }
    await program.parseAsync(resultado.argv, { from: "user" });
  };

  program.command("wizard").description("Monta o comando interativamente e executa").action(wizard);
  program.action(wizard);

  return program;
}
