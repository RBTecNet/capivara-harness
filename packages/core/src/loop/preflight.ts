/**
 * Preflight do `capivara build`.
 *
 * Roda inteiro ANTES de qualquer chamada de modelo. Documento inválido, plano
 * stale ou árvore suja terminam aqui, sem cobrar nada: descobrir isso depois da
 * primeira sessão já teria custado uma chamada e um contexto inteiro.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkStamp, parsePhases } from "../contract/index.js";
import type { ContractError, StampInput } from "../contract/index.js";
import { artifactPaths } from "../state/paths.js";
import { resolveTestCommand, type TestCommand } from "./testcmd.js";
import { splitPhases, type PhaseSession } from "./split.js";
import { checkPrerequisites, describeMissing, detectPrerequisites, type PrerequisiteStatus } from "./prerequisites.js";

export interface PreflightOptions {
  projectRoot: string;
  runId: string;
  explicitTestCommand?: string;
  /** Estado do repositório, injetado para o preflight continuar testável. */
  git: { repository: boolean; clean: boolean };
  /** Quando ligado, faltar um pré-requisito é aviso: o executor vai instalar. */
  systemInstall?: boolean;
  environment?: NodeJS.ProcessEnv;
}

export interface PreflightWarning {
  code: string;
  message: string;
}

export type PreflightResult =
  | {
      ok: true;
      sessions: PhaseSession[];
      testCommand: TestCommand | null;
      commitsEnabled: boolean;
      prerequisites: PrerequisiteStatus[];
      warnings: PreflightWarning[];
    }
  | { ok: false; errors: string[]; contractErrors: ContractError[] };

export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  const init = artifactPaths(options.projectRoot).init;
  const errors: string[] = [];
  const warnings: PreflightWarning[] = [];

  const plan = await readFile(join(init, "project-phases.md"), "utf8").catch(() => null);
  if (plan === null) {
    return {
      ok: false,
      errors: ["não há .capivara/init/project-phases.md; rode `capivara init` antes de `capivara build`"],
      contractErrors: [],
    };
  }

  const split = splitPhases(plan, options.projectRoot, options.runId);
  if (!split.ok) {
    return {
      ok: false,
      errors: ["o plano não passa no contrato; nenhuma chamada de modelo foi feita"],
      contractErrors: split.errors,
    };
  }

  const parsed = parsePhases(plan);
  if (parsed.ok) {
    const inputs: StampInput[] = [];
    for (const name of ["project-description.md", "user-stories.md", "database-schema.md"]) {
      const content = await readFile(join(init, name), "utf8").catch(() => null);
      if (content !== null) inputs.push({ name, content });
    }
    for (const stale of checkStamp(parsed.document, inputs)) {
      // Documento stale é aviso alto, nunca bloqueio: o operador decide.
      warnings.push({ code: "stale", message: `${stale.message} → ${stale.hint}` });
    }
  }

  if (options.git.repository && !options.git.clean) {
    errors.push(
      "a árvore de trabalho tem alterações não commitadas; o loop precisa distinguir o que cada fase escreveu — " +
        "commite ou descarte antes de rodar",
    );
  }

  if (!options.git.repository) {
    warnings.push({
      code: "sem-git",
      message: "o projeto não é um repositório Git: o loop roda e pula os commits por fase",
    });
  }

  const testCommand = await resolveTestCommand(options.projectRoot, {
    ...(options.explicitTestCommand !== undefined ? { explicit: options.explicitTestCommand } : {}),
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
  });
  if (!testCommand) {
    warnings.push({
      code: "sem-suite",
      message:
        "nenhum comando de teste foi resolvido: o gate 2 será pulado e o verificador independente segura sozinho. " +
        "Use --test-cmd quando a suíte existir sob outro comando",
    });
  }

  // A stack decidida exige o quê, e o que existe nesta máquina? Descobrir aqui
  // custa uma chamada a `which`; descobrir na terceira fase custa três sessões.
  const description = await readFile(join(init, "project-description.md"), "utf8").catch(() => "");
  const prerequisites = await checkPrerequisites(detectPrerequisites(description));
  const missing = describeMissing(prerequisites, options.systemInstall === true);
  if (missing !== "") {
    if (options.systemInstall === true) warnings.push({ code: "instala-sistema", message: missing });
    else errors.push(missing);
  }

  if (errors.length > 0) return { ok: false, errors, contractErrors: [] };

  return {
    ok: true,
    sessions: split.sessions,
    testCommand,
    commitsEnabled: options.git.repository,
    prerequisites,
    warnings,
  };
}
