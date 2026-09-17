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
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree } from "../provider/supervisor.js";

export interface AcceptanceStep {
  id: string;
  command: string;
  /** Serviço não termina sozinho: sobe, fica de pé e é encerrado. */
  service: boolean;
}

export interface StepResult {
  id: string;
  command: string;
  exitCode: number;
  output: string;
}

export type AcceptanceResult =
  | { accepted: true; steps: StepResult[]; skipped: string }
  | { accepted: false; steps: StepResult[]; failure: { id: string; cause: string } };

/** Diretórios que não atravessam para a cópia limpa. */
const EXCLUDED = new Set([".git", "node_modules", ".capivara", "dist", "build", "coverage", ".next", ".venv"]);

/**
 * Deriva os passos do próprio projeto.
 *
 * Sem contrato operacional e sem adivinhação: o que o `package.json` declara é o
 * que o produto sabe fazer. Um projeto que não declara nada não é reprovado —
 * ele simplesmente não tem o que aceitar operacionalmente.
 */
export function deriveAcceptance(packageJson: string | null): AcceptanceStep[] {
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

export type CommandRunner = (command: string, cwd: string, seconds: number) => Promise<{ exitCode: number; output: string }>;

export const defaultRunner: CommandRunner = (command, cwd, seconds) =>
  new Promise((resolve) => {
    // Grupo próprio também aqui: um `npm run build` pode deixar watcher de pé, e
    // um passo que não termina segura o CLI do mesmo jeito que um serviço.
    const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
 * Serviço aprovado é serviço que continua de pé.
 *
 * Não há contrato dizendo porta nem rota, então a prova possível é esta: subiu,
 * não morreu, e não gritou. É fraca de propósito — e teria pego a aplicação que
 * este piloto entregou, porque ela cairia na conexão com o banco.
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
    const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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

    // Sobreviveu à janela inteira: está de pé.
    const vigia = setTimeout(() => encerrar(0), seconds * 1000);

    child.on("exit", (code) => encerrar(code === 0 ? 1 : (code ?? 1)));
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
}

export async function runAcceptance(options: AcceptanceOptions): Promise<AcceptanceResult> {
  const manifest = await readFile(join(options.projectRoot, "package.json"), "utf8").catch(() => null);
  const steps = deriveAcceptance(manifest);

  if (steps.length === 0) {
    return { accepted: true, steps: [], skipped: "o projeto não declara build, migração nem entrypoint: nada a aceitar operacionalmente" };
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
    }

    const results: StepResult[] = [];
    for (const step of steps) {
      const executar = step.service ? service : runner;
      const { exitCode, output } = await executar(step.command, room, step.service ? serviceSeconds : stepSeconds);
      results.push({ id: step.id, command: step.command, exitCode, output });

      if (exitCode !== 0) {
        return {
          accepted: false,
          steps: results,
          failure: {
            id: step.id,
            cause:
              `A aceitação operacional falhou no passo "${step.id}" (${step.command}), numa cópia limpa do projeto` +
              ` — código ${exitCode}. Saída:\n${output.split("\n").slice(-60).join("\n").trim()}`,
          },
        };
      }
    }

    return { accepted: true, steps: results, skipped: "" };
  } finally {
    if (room !== options.projectRoot) await rm(room, { recursive: true, force: true });
  }
}
