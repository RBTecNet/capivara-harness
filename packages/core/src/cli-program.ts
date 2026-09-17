import { Command } from "commander";
import { VERSION } from "./version.js";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("capivara")
    .description("Harness documental e loop de execução: do prompt à aplicação final")
    .version(VERSION, "-v, --version", "mostra a versão")
    .helpOption("-h, --help", "mostra esta ajuda");
  return program;
}
