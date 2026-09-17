import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EVENTS_HEADER, appendEvent, formatEvent, parseEvent, readEvents } from "../../src/state/index.js";
import type { RunEvent } from "../../src/state/index.js";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "capivara-events-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const event = (overrides: Partial<RunEvent> = {}): RunEvent => ({
  timestamp: "2026-09-16T22:00:00.000Z",
  stage: "audit",
  subject: "user-stories.md",
  attempt: 1,
  status: "complete",
  detail: "aprovado",
  ...overrides,
});

describe("formato do evento", () => {
  it("faz round-trip", () => {
    const original = event();
    expect(parseEvent(formatEvent(original))).toEqual(original);
  });

  it("escapa tab e quebra de linha no detalhe, que corromperiam a coluna", () => {
    const original = event({ detail: "falhou:\tlinha 1\nlinha 2" });
    const line = formatEvent(original);
    expect(line.split("\t")).toHaveLength(6);
    expect(line).not.toContain("\n");
    expect(parseEvent(line)?.detail).toBe("falhou:\tlinha 1\nlinha 2");
  });

  it("rejeita linha com número de colunas errado", () => {
    expect(parseEvent("a\tb\tc")).toBeNull();
  });

  it("rejeita status desconhecido", () => {
    expect(parseEvent("2026-09-16T22:00:00.000Z\taudit\tx\t1\tinventado\tdetalhe")).toBeNull();
  });
});

describe("readEvents", () => {
  it("devolve lista vazia quando o log não existe", async () => {
    expect(await readEvents(join(workspace, "events.tsv"))).toEqual([]);
  });

  it("lê os eventos em ordem, ignorando cabeçalho", async () => {
    const path = join(workspace, "events.tsv");
    await writeFile(path, `${EVENTS_HEADER}\n`, "utf8");
    await appendEvent(path, event({ subject: "a" }));
    await appendEvent(path, event({ subject: "b" }));
    expect((await readEvents(path)).map((entry) => entry.subject)).toEqual(["a", "b"]);
  });

  it("descarta a última linha truncada sem perder o histórico anterior", async () => {
    const path = join(workspace, "events.tsv");
    await appendEvent(path, event({ subject: "a" }));
    await appendEvent(path, event({ subject: "b" }));
    await writeFile(path, `${await readFileText(path)}2026-09-16T22:00:02.000Z\taudit\tc`, "utf8");
    const events = await readEvents(path);
    expect(events.map((entry) => entry.subject)).toEqual(["a", "b"]);
  });
});

async function readFileText(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
