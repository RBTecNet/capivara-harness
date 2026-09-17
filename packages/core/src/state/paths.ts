/**
 * A árvore de artefatos, num só lugar.
 *
 * `.capivara/init/` é autoridade de leitura para o executor; `.capivara/runs/`
 * é plano de controle e nenhuma sessão de agente escreve lá. Concentrar os
 * caminhos aqui é o que permite testar essa fronteira mecanicamente em vez de
 * confiar na disciplina de cada chamador.
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const ARTIFACT_ROOT = ".capivara";

export interface ArtifactPaths {
  root: string;
  init: string;
  design: string;
  handoffs: string;
  runs: string;
}

export interface RunPaths {
  root: string;
  state: string;
  events: string;
  phases: string;
  prompts: string;
  logs: string;
  audits: string;
  lock: string;
}

export function artifactPaths(projectRoot: string): ArtifactPaths {
  const root = join(resolve(projectRoot), ARTIFACT_ROOT);
  return {
    root,
    init: join(root, "init"),
    design: join(root, "init", "design"),
    handoffs: join(root, "handoffs"),
    runs: join(root, "runs"),
  };
}

export function runPaths(projectRoot: string, runId: string): RunPaths {
  const root = join(artifactPaths(projectRoot).runs, runId);
  return {
    root,
    state: join(root, "run.json"),
    events: join(root, "events.tsv"),
    phases: join(root, "phases"),
    prompts: join(root, "prompts"),
    logs: join(root, "logs"),
    audits: join(root, "audits"),
    lock: join(root, ".lock"),
  };
}

/**
 * Resolve um caminho relativo ao projeto recusando qualquer escape.
 *
 * Um bundle de documentos é entrada não confiável: ele decide o que aterrissa
 * no repositório de quem chamou, e `../` numa string é tudo o que separa um
 * artefato de uma sobrescrita fora do projeto.
 */
export function safeProjectPath(projectRoot: string, relativePath: string): string {
  if (relativePath.includes("\0")) throw new Error(`caminho inválido: ${relativePath}`);
  if (isAbsolute(relativePath)) throw new Error(`caminho deve ser relativo ao projeto: ${relativePath}`);
  const base = resolve(projectRoot);
  const resolved = resolve(base, relativePath);
  const inside = relative(base, resolved);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`caminho escapa do projeto: ${relativePath}`);
  }
  return resolved;
}

/** Verdadeiro quando o caminho está sob `.capivara/runs/` — o plano de controle. */
export function isControlPlane(projectRoot: string, absolutePath: string): boolean {
  const runs = artifactPaths(projectRoot).runs;
  const resolved = resolve(absolutePath);
  return resolved === runs || resolved.startsWith(runs + sep);
}
