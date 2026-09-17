/**
 * `events.tsv` — o log append-only de transições.
 *
 * O snapshot `run.json` é conveniência; a autoridade da retomada é este log.
 * Snapshot pode estar velho quando o processo morre entre uma transição e a
 * gravação do resumo; o log, não, porque cada linha é escrita e sincronizada no
 * momento da transição e nenhuma linha anterior é jamais reescrita.
 */

import { readFile } from "node:fs/promises";
import { appendLine } from "./atomic.js";

export const EVENTS_HEADER = "timestamp\tstage\tsubject\tattempt\tstatus\tdetail";

export type EventStatus = "started" | "complete" | "retry" | "blocked" | "paused" | "skipped";

export interface RunEvent {
  timestamp: string;
  stage: string;
  /** O que a transição trata: um documento, uma fase, ou `-` quando global. */
  subject: string;
  attempt: number;
  status: EventStatus;
  detail: string;
}

const STATUSES = new Set<EventStatus>(["started", "complete", "retry", "blocked", "paused", "skipped"]);

/** TSV não tem escape padronizado; um campo que contenha tab ou quebra corromperia a coluna. */
function encodeField(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r?\n/g, "\\n");
}

function decodeField(value: string): string {
  return value.replace(/\\(.)/g, (_, char: string) => (char === "t" ? "\t" : char === "n" ? "\n" : char));
}

export function formatEvent(event: RunEvent): string {
  return [
    event.timestamp,
    encodeField(event.stage),
    encodeField(event.subject),
    String(event.attempt),
    event.status,
    encodeField(event.detail),
  ].join("\t");
}

export function parseEvent(line: string): RunEvent | null {
  const columns = line.split("\t");
  if (columns.length !== 6) return null;
  const status = columns[4] ?? "";
  if (!STATUSES.has(status as EventStatus)) return null;
  const attempt = Number(columns[3]);
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return {
    timestamp: columns[0] ?? "",
    stage: decodeField(columns[1] ?? ""),
    subject: decodeField(columns[2] ?? ""),
    attempt,
    status: status as EventStatus,
    detail: decodeField(columns[5] ?? ""),
  };
}

export async function appendEvent(path: string, event: RunEvent): Promise<void> {
  await appendLine(path, formatEvent(event));
}

/**
 * Lê o log inteiro, ignorando o cabeçalho e linhas ilegíveis.
 *
 * Uma linha truncada por queda de energia no meio da última escrita não pode
 * derrubar a retomada: ela é descartada e todo o histórico anterior continua
 * válido, que é a razão de o log ser append-only.
 */
export async function readEvents(path: string): Promise<RunEvent[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const events: RunEvent[] = [];
  for (const line of content.split("\n")) {
    if (line === "" || line === EVENTS_HEADER || line.startsWith("#")) continue;
    const event = parseEvent(line);
    if (event) events.push(event);
  }
  return events;
}
