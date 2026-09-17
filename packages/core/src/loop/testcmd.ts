/**
 * Resolução do comando de teste do projeto.
 *
 * Redetectado a cada fase: num greenfield a suíte não existe na fase 1 e passa
 * a existir na 2, e um valor decidido uma vez no início ficaria errado para
 * sempre. Sem comando resolvido, o gate 2 é pulado com aviso alto e o
 * verificador independente segura sozinho — nunca um erro silencioso.
 *
 * O comando resolvido aqui é o MESMO que vai no prompt do executor. Se o agente
 * rodar outro runner, ele vê verde e o gate vê vermelho.
 */

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface TestCommand {
  command: string;
  source: string;
  /** Verdadeiro quando a suíte roda dentro de um container. */
  containerized: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function json(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface TestCommandOptions {
  /** `--test-cmd`, que tem a maior precedência. */
  explicit?: string;
  environment?: NodeJS.ProcessEnv;
}

export async function resolveTestCommand(
  projectRoot: string,
  options: TestCommandOptions = {},
): Promise<TestCommand | null> {
  const explicit = options.explicit?.trim();
  if (explicit) return { command: explicit, source: "--test-cmd", containerized: false };

  const fromEnvironment = (options.environment ?? process.env).CAPIVARA_TEST_CMD?.trim();
  if (fromEnvironment) return { command: fromEnvironment, source: "CAPIVARA_TEST_CMD", containerized: false };

  const has = async (name: string): Promise<boolean> => exists(join(projectRoot, name));

  // Sail tem precedência sobre composer: a suíte roda DENTRO do container, e
  // rodá-la no host faria todo gate 2 falhar, queimando ciclos de correção.
  if ((await has("artisan")) && (await has("vendor/bin/sail"))) {
    return { command: "vendor/bin/sail test", source: "Laravel Sail", containerized: true };
  }

  const composer = await json(join(projectRoot, "composer.json"));
  if (composer && typeof (composer.scripts as Record<string, unknown> | undefined)?.test !== "undefined") {
    return { command: "composer test", source: "composer.json scripts.test", containerized: false };
  }

  if (await has("artisan")) return { command: "php artisan test", source: "artisan", containerized: false };

  const packageJson = await json(join(projectRoot, "package.json"));
  if (packageJson && typeof (packageJson.scripts as Record<string, unknown> | undefined)?.test !== "undefined") {
    return { command: "npm test", source: "package.json scripts.test", containerized: false };
  }

  if (await has("pytest.ini")) return { command: "pytest", source: "pytest.ini", containerized: false };
  if (await has("pyproject.toml")) {
    const pyproject = await readFile(join(projectRoot, "pyproject.toml"), "utf8").catch(() => "");
    if (pyproject.includes("[tool.pytest")) return { command: "pytest", source: "pyproject.toml", containerized: false };
  }

  if (await has("go.mod")) return { command: "go test ./...", source: "go.mod", containerized: false };
  if (await has("Cargo.toml")) return { command: "cargo test", source: "Cargo.toml", containerized: false };

  return null;
}
