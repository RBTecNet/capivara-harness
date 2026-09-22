/**
 * `run.json` — o snapshot do run, e a identidade estável de um run.
 *
 * A identidade deriva do que o run consome: o mesmo prompt retoma o mesmo run,
 * e um `project-phases.md` alterado produz outra identidade. Isso não é um
 * detalhe de nomeação: é o que impede que a evidência de um plano anterior
 * aceite silenciosamente um plano diferente.
 */

import { readFile } from "node:fs/promises";
import { sha12 } from "../contract/stamps.js";
import { writeAtomic } from "./atomic.js";
import { runPaths } from "./paths.js";

export const RUN_CONTRACT = "capivara-run/v1" as const;

/** `survey` levanta uma aplicação existente; não constrói nem documenta produto novo. */
export type RunCommand = "init" | "build" | "survey";

export type RunStage =
  | "preflight"
  | "inventory"
  | "interview"
  | "checkpoint"
  | "authoring"
  | "self-check"
  | "audit"
  | "publish"
  | "ready"
  | "split"
  | "implement"
  | "validate"
  | "verify"
  | "commit"
  | "complete";

export type RunStatus = "running" | "paused" | "blocked" | "complete";

/**
 * Fotografia do que foi resolvido para cada papel, gravada no snapshot.
 *
 * O vocabulário de papéis pertence a `provider/roles.ts`; aqui basta o registro
 * do que valeu neste run, sem acoplar o estado ao catálogo de providers.
 */
export interface RunRoleSnapshot {
  provider: string;
  model: string;
  effort: string;
}

export interface RunState {
  contract: typeof RUN_CONTRACT;
  runId: string;
  command: RunCommand;
  /** Idioma resolvido uma única vez, do prompt inicial, e nunca redetectado. */
  language: string;
  stage: RunStage;
  status: RunStatus;
  /** O que está sendo trabalhado agora: um documento, uma fase, ou "-". */
  subject: string;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  roles: Record<string, RunRoleSnapshot>;
  /** Hashes das fontes que definem a identidade deste run. */
  sources: { name: string; sha12: string }[];
}

export interface NewRunOptions {
  runId: string;
  command: RunCommand;
  language: string;
  roles?: Record<string, RunRoleSnapshot>;
  sources?: { name: string; sha12: string }[];
  now?: () => Date;
}

export function createRunState(options: NewRunOptions): RunState {
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  return {
    contract: RUN_CONTRACT,
    runId: options.runId,
    command: options.command,
    language: options.language,
    stage: "preflight",
    status: "running",
    subject: "-",
    attempt: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    roles: options.roles ?? {},
    sources: options.sources ?? [],
  };
}

export async function writeRunState(projectRoot: string, state: RunState, now = () => new Date()): Promise<void> {
  const paths = runPaths(projectRoot, state.runId);
  const snapshot: RunState = { ...state, updatedAt: now().toISOString() };
  await writeAtomic(paths.state, `${JSON.stringify(snapshot, null, 2)}\n`);
}

/** Devolve `null` quando o run não existe ou o snapshot é ilegível — nunca lança. */
export async function readRunState(projectRoot: string, runId: string): Promise<RunState | null> {
  const paths = runPaths(projectRoot, runId);
  try {
    const parsed = JSON.parse(await readFile(paths.state, "utf8")) as Partial<RunState>;
    if (parsed.contract !== RUN_CONTRACT || typeof parsed.runId !== "string") return null;
    return parsed as RunState;
  } catch {
    return null;
  }
}

/**
 * A identidade de um run deriva do que ele consome.
 *
 * O mesmo prompt retoma o mesmo run; um `project-phases.md` alterado produz
 * outra identidade, e a evidência do plano anterior não é aplicada em silêncio
 * a um plano diferente.
 */
export function runIdFor(command: RunCommand, identity: string): string {
  return `${command}-${sha12(identity)}`;
}
