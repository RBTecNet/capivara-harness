import { Command } from "commander";
import { listProviders, renderProviderList } from "./commands/providers.js";
import { VERSION } from "./version.js";

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
      process.stdout.write(options.json ? `${JSON.stringify(listing, null, 2)}\n` : `${renderProviderList(listing)}\n`);
    });

  return program;
}
