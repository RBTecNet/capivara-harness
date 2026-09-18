import { stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import { listProviders, renderProviderList } from "./commands/providers.js";
import { diagnose, renderDiagnosis } from "./commands/doctor.js";
import { DEFAULT_LIMITS, createAgentBridge } from "./commands/agent.js";
import { BUILD_ROLES, INIT_ROLES, describeRoles, renderUnresolved, rolesFromFlags, unresolvedRoles, type CliRoleFlags } from "./commands/options.js";
import { InitBlockedError, resolveRequest, runInit } from "./init/index.js";
import { runBuild } from "./loop/index.js";
import { BACK, HarnessProgress, createLiveRegion, detectLanguage, renderDashboard, renderQuestion, renderSplash, supportsColor } from "./tui/index.js";
import { createLineIO, runWizard } from "./commands/wizard.js";
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
      .description("Entrevista, escreve e audita os quatro documentos até RALPH READY")
      .argument("[pedido]", "o que você quer construir; aceita @arquivo")
      .option("--file <caminho>", "lê o pedido de um arquivo")
      .option("--max-audit-returns <n>", "devoluções do auditor por documento", "3")
      .option("--max-interview-rounds <n>", "rodadas de entrevista por documento", "3")
      .option("--fresh", "ignora o que este run já publicou e recomeça a cadeia do zero")
      .option("--no-dashboard", "não desenha o painel; só as linhas de progresso"),
  ).action(async (pedido: string | undefined, flags: CommonFlags & { file?: string; maxAuditReturns: string; maxInterviewRounds: string; fresh?: boolean; dashboard?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    const configured = rolesFromFlags(flags);
    const semProvider = unresolvedRoles(configured, INIT_ROLES);
    if (semProvider.length > 0) {
      stdout.write(`${renderUnresolved("init", semProvider)}\n`);
      process.exitCode = 2;
      return;
    }
    const request = await resolveRequest(projectRoot, {
      ...(pedido !== undefined ? { prompt: pedido } : {}),
      ...(flags.file !== undefined ? { file: flags.file } : {}),
    });
    const language = detectLanguage(request.text, flags.language);
    const roles = configured;

    // O init não constrói nada: mostrar o executor aqui só confunde quem lê.
    if (flags.splash !== false) {
      const papeis = describeRoles(roles).filter((role) => (INIT_ROLES as readonly string[]).includes(role.role));
      stdout.write(renderSplash({ version: VERSION, roles: papeis, style: style() }));
    }

    const runId = runIdFor("init", request.sha12);
    const bridge = createAgentBridge({ projectRoot, runId, language, roles, limits: DEFAULT_LIMITS });
    const terminal = createInterface({ input: stdin, output: stdout });

    /*
     * O painel observa e nunca altera: ele lê os eventos que o orquestrador já
     * grava e se redesenha no lugar. Sem terminal, não desenha nada — as linhas
     * de progresso continuam sendo a saída, e o log segue legível.
     */
    const progress = new HarnessProgress({
      version: VERSION,
      project: projectRoot,
      provider: {
        perfil: `${roles.writer.provider}${roles.writer.model ? `:${roles.writer.model}` : ""}`,
        transporte: `${roles.writer.provider}-cli`,
        contabilidade: "por chamada",
      },
      style: style(),
      ...(stdout.columns ? { width: Math.min(stdout.columns, 110) } : {}),
      environment: process.env,
    });
    const live = createLiveRegion((text) => void stdout.write(text), flags.dashboard !== false && stdout.isTTY === true);
    const repaint = (): void => live.draw(renderDashboard(progress.model()));

    try {
      const outcome = await runInit({
        projectRoot,
        request,
        language,
        maxAuditReturns: Number(flags.maxAuditReturns),
        maxInterviewRounds: Number(flags.maxInterviewRounds),
        ...(flags.fresh === true ? { fresh: true } : {}),
        announce: (message) => {
          progress.note(message.trim());
          if (live.enabled) repaint();
          else stdout.write(`${message}\n`);
        },
        onProgress: (evento) => {
          progress.apply(evento);
          repaint();
        },
        call: async (call) => {
          const response = await bridge({ role: call.role, stage: call.stage, prompt: call.prompt });
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
        },
        ask: async (question, index, total) => {
          // A pergunta é dona da tela enquanto durar: o painel solta a região e
          // o que estava desenhado vira histórico acima dela.
          live.release();
          stdout.write(renderQuestion({ question, index, total, document: "entrevista", style: style() }));
          const answer = await terminal.question("> ");
          return answer.trim().toLowerCase() === BACK ? "" : answer;
        },
        decideStandoff: async (rendered) => {
          live.release();
          stdout.write(`\n${rendered}\n`);
          return terminal.question('> (responda, ou "publicar" para aceitar como está) ');
        },
      });
      live.release();
      stdout.write(`\n${outcome.rendered}\n`);
      process.exitCode = outcome.readiness.ready ? 0 : 2;
    } catch (error) {
      if (error instanceof InitBlockedError) {
        live.release();
        stdout.write(`\n${error.message}\n`);
        process.exitCode = 2;
        return;
      }
      throw error;
    } finally {
      terminal.close();
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
      .option("--no-acceptance", "pula a aceitação operacional final"),
    ["builder", "verifier"],
  ).action(async (flags: CommonFlags & { testCmd?: string; maxCycles: string; keepGoing?: boolean; systemInstall?: boolean; acceptance?: boolean }) => {
    const projectRoot = flags.project ?? ".";
    const roles = rolesFromFlags(flags);
    const semProvider = unresolvedRoles(roles, BUILD_ROLES);
    if (semProvider.length > 0) {
      stdout.write(`${renderUnresolved("build", semProvider)}\n`);
      process.exitCode = 2;
      return;
    }
    const language = flags.language ?? "português do Brasil";

    if (flags.splash !== false) {
      const papeis = describeRoles(roles).filter((role) => (BUILD_ROLES as readonly string[]).includes(role.role));
      stdout.write(renderSplash({ version: VERSION, roles: papeis, style: style() }));
    }

    const outcome = await runBuild({
      projectRoot,
      language,
      engine: roles.builder.provider,
      ...(flags.testCmd !== undefined ? { explicitTestCommand: flags.testCmd } : {}),
      maxCycles: Number(flags.maxCycles),
      systemInstall: flags.systemInstall !== false,
      skipAcceptance: flags.acceptance === false,
      ...(flags.keepGoing !== undefined ? { keepGoing: flags.keepGoing } : {}),
      announce: (message) => stdout.write(`${message}\n`),
      call: async (call) => {
        const bridge = createAgentBridge({
          projectRoot,
          runId: "build",
          language,
          roles,
          limits: DEFAULT_LIMITS,
          systemInstall: flags.systemInstall !== false,
        });
        return bridge({ role: call.role, stage: "implement", prompt: call.prompt });
      },
    });

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
        fileExists: (path) => stat(path).then((info) => info.isFile()).catch(() => false),
        directoryExists: (path) => stat(path).then((info) => info.isDirectory()).catch(() => false),
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
