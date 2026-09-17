import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";
import { listProviders, renderProviderList } from "./commands/providers.js";
import { diagnose, renderDiagnosis } from "./commands/doctor.js";
import { DEFAULT_LIMITS, createAgentBridge } from "./commands/agent.js";
import { describeRoles, rolesFromFlags, type CliRoleFlags } from "./commands/options.js";
import { InitBlockedError, resolveRequest, runInit } from "./init/index.js";
import { runBuild } from "./loop/index.js";
import { BACK, detectLanguage, renderCommand, renderQuestion, renderSplash, supportsColor } from "./tui/index.js";
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
      .option("--max-interview-rounds <n>", "rodadas de entrevista por documento", "3"),
  ).action(async (pedido: string | undefined, flags: CommonFlags & { file?: string; maxAuditReturns: string; maxInterviewRounds: string }) => {
    const projectRoot = flags.project ?? ".";
    const request = await resolveRequest(projectRoot, {
      ...(pedido !== undefined ? { prompt: pedido } : {}),
      ...(flags.file !== undefined ? { file: flags.file } : {}),
    });
    const language = detectLanguage(request.text, flags.language);
    const roles = rolesFromFlags(flags);

    if (flags.splash !== false) stdout.write(renderSplash({ version: VERSION, roles: describeRoles(roles), style: style() }));

    const runId = runIdFor("init", request.sha12);
    const bridge = createAgentBridge({ projectRoot, runId, language, roles, limits: DEFAULT_LIMITS });
    const terminal = createInterface({ input: stdin, output: stdout });

    try {
      const outcome = await runInit({
        projectRoot,
        request,
        language,
        maxAuditReturns: Number(flags.maxAuditReturns),
        maxInterviewRounds: Number(flags.maxInterviewRounds),
        announce: (message) => stdout.write(`${message}\n`),
        call: async (call) => {
          const response = await bridge({ role: call.role, stage: call.stage, prompt: call.prompt });
          return { stdout: response.stdout, exitCode: response.exitCode };
        },
        ask: async (question, index, total) => {
          stdout.write(renderQuestion({ question, index, total, document: "entrevista", style: style() }));
          const answer = await terminal.question("> ");
          return answer.trim().toLowerCase() === BACK ? "" : answer;
        },
        decideStandoff: async (rendered) => {
          stdout.write(`\n${rendered}\n`);
          return terminal.question('> (responda, ou "publicar" para aceitar como está) ');
        },
      });
      stdout.write(`\n${outcome.rendered}\n`);
      process.exitCode = outcome.readiness.ready ? 0 : 2;
    } catch (error) {
      if (error instanceof InitBlockedError) {
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
    const language = flags.language ?? "português do Brasil";

    if (flags.splash !== false) {
      stdout.write(renderSplash({ version: VERSION, roles: describeRoles(roles).filter((role) => role.role === "builder" || role.role === "verifier"), style: style() }));
    }

    const outcome = await runBuild({
      projectRoot,
      language,
      engine: roles.builder.provider || "codex",
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

    for (const error of outcome.errors) stdout.write(`${error}\n`);
    process.exitCode = outcome.exitCode;
  });

  program
    .command("wizard")
    .description("Monta o comando interativamente e imprime o equivalente")
    .argument("[comando]", "init ou build", "init")
    .action(async (comando: string) => {
      const terminal = createInterface({ input: stdin, output: stdout });
      try {
        const target = comando === "build" ? "build" : "init";
        const answers = {
          command: target as "init" | "build",
          global: {} as { provider?: string; model?: string },
          roles: {},
        } as Parameters<typeof renderCommand>[0];

        if (target === "init") {
          const request = await terminal.question("O que você quer construir? ");
          if (request.trim()) answers.request = request.trim();
        }
        const provider = await terminal.question("Provider padrão (codex, claude, opencode, …): ");
        if (provider.trim()) answers.global.provider = provider.trim();
        const model = await terminal.question("Modelo (vazio para o padrão do provider): ");
        if (model.trim()) answers.global.model = model.trim();

        stdout.write(`\nComando equivalente:\n\n  ${renderCommand(answers)}\n\n`);
      } finally {
        terminal.close();
      }
    });

  return program;
}
