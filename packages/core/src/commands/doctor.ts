/**
 * `capivara doctor` — o que está pronto e o que falta, antes de gastar.
 *
 * Existe porque quase toda falha de primeira execução é de ambiente, não de
 * modelo: a CLI não está no PATH, a credencial não foi salva, a árvore está
 * suja, não há comando de teste. Descobrir isso depois da primeira chamada custa
 * uma chamada; descobrir aqui custa nada.
 */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { CLI_CATALOG, DIRECT_CATALOG, readCredentials } from "../provider/index.js";
import { artifactPaths } from "../state/paths.js";
import { isClean, isRepository } from "../loop/git.js";
import { resolveTestCommand } from "../loop/testcmd.js";
import { INIT_ARTIFACTS } from "../init/readiness.js";

const run = promisify(execFile);

export type Health = "ok" | "aviso" | "ausente";

export interface Diagnosis {
  area: string;
  item: string;
  health: Health;
  detail: string;
}

const MINIMUM_NODE_MAJOR = 22;

async function which(binary: string): Promise<string | null> {
  try {
    const { stdout } = await run("which", [binary]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export interface DoctorOptions {
  projectRoot: string;
  credentialsFile?: string;
  nodeVersion?: string;
  environment?: NodeJS.ProcessEnv;
}

export async function diagnose(options: DoctorOptions): Promise<Diagnosis[]> {
  const found: Diagnosis[] = [];
  const version = options.nodeVersion ?? process.version;
  const major = Number(/^v(\d+)/.exec(version)?.[1] ?? 0);

  found.push({
    area: "runtime",
    item: `Node ${version}`,
    health: major >= MINIMUM_NODE_MAJOR ? "ok" : "ausente",
    detail: major >= MINIMUM_NODE_MAJOR ? "" : `o capivara exige Node ${MINIMUM_NODE_MAJOR} ou maior`,
  });

  for (const provider of CLI_CATALOG) {
    if (provider.id === "custom") continue;
    const binary = options.environment?.[provider.binaryEnv]?.trim() || provider.defaultBinary;
    const path = await which(binary);
    found.push({
      area: "providers de CLI",
      item: provider.label,
      health: path ? "ok" : "ausente",
      detail: path ?? `${binary} não está no PATH; instale-o ou aponte ${provider.binaryEnv}`,
    });
  }

  const credentials = await readCredentials(options.credentialsFile);
  for (const provider of DIRECT_CATALOG) {
    const saved = credentials.filter((record) => record.provider === provider.id);
    found.push({
      area: "providers de API",
      item: provider.label,
      health: saved.length > 0 ? "ok" : "aviso",
      detail: saved.length > 0 ? `${saved.length} credencial(is) salva(s)` : "sem credencial salva",
    });
  }

  const repository = await isRepository(options.projectRoot);
  found.push({
    area: "projeto",
    item: "repositório Git",
    health: repository ? "ok" : "aviso",
    detail: repository
      ? (await isClean(options.projectRoot))
        ? "árvore limpa"
        : "árvore suja: o build aborta até você commitar ou descartar"
      : "sem repositório: o build roda e pula os commits por fase",
  });

  const testCommand = await resolveTestCommand(options.projectRoot, {
    ...(options.environment !== undefined ? { environment: options.environment } : {}),
  });
  found.push({
    area: "projeto",
    item: "comando de teste",
    health: testCommand ? "ok" : "aviso",
    detail: testCommand
      ? `${testCommand.command} (${testCommand.source})`
      : "nenhum resolvido: o gate 2 será pulado e o verificador segura sozinho",
  });

  const init = artifactPaths(options.projectRoot).init;
  const missing: string[] = [];
  for (const artefato of INIT_ARTIFACTS) {
    const content = await readFile(join(init, artefato), "utf8").catch(() => null);
    if (content === null) missing.push(artefato);
  }
  /*
   * Faltar o plano é um passo pendente, não um defeito: o `init` publica o
   * esqueleto e o `plan` publica o plano, e entre um e outro o projeto está num
   * estado legítimo. Faltar o esqueleto com o plano publicado é que é quebra —
   * o plano diz ter lido algo que não existe em disco.
   */
  const semEsqueleto = missing.includes("skeleton.md");
  found.push({
    area: "projeto",
    item: "documentação",
    health: missing.length === 0 ? "ok" : semEsqueleto && missing.length === 1 ? "ausente" : "aviso",
    detail:
      missing.length === 0
        ? "o esqueleto e o plano executável estão publicados"
        : missing.length === INIT_ARTIFACTS.length
          ? "nenhum artefato ainda: rode `capivara init`"
          : semEsqueleto
            ? "o plano existe sem o esqueleto que ele diz ter lido: rode `capivara init` de novo"
            : "o esqueleto está publicado e o plano não: rode `capivara plan`",
  });

  return found;
}

const SYMBOL: Record<Health, string> = { ok: "ok  ", aviso: "!   ", ausente: "x   " };

export function renderDiagnosis(diagnoses: readonly Diagnosis[]): string {
  const lines: string[] = [];
  let area = "";
  for (const diagnosis of diagnoses) {
    if (diagnosis.area !== area) {
      area = diagnosis.area;
      lines.push("", area);
    }
    lines.push(`  ${SYMBOL[diagnosis.health]}${diagnosis.item.padEnd(24)}${diagnosis.detail}`);
  }

  const blockers = diagnoses.filter((diagnosis) => diagnosis.health === "ausente");
  lines.push("");
  lines.push(
    blockers.length === 0
      ? "nada bloqueia a execução"
      : `${blockers.length} item(ns) bloqueiam: ${blockers.map((diagnosis) => diagnosis.item).join(", ")}`,
  );
  return lines.join("\n");
}
