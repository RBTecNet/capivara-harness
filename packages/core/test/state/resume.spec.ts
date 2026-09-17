import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEvent,
  createRunState,
  nextSubject,
  replayEvents,
  restoreRun,
  runIdFor,
  runPaths,
  writeRunState,
} from "../../src/state/index.js";
import type { RunEvent } from "../../src/state/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-resume-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const DOCUMENTS = ["project-description.md", "user-stories.md", "database-schema.md", "project-phases.md"] as const;

function event(overrides: Partial<RunEvent>): RunEvent {
  return {
    timestamp: "2026-09-16T22:00:00.000Z",
    stage: "audit",
    subject: "-",
    attempt: 1,
    status: "complete",
    detail: "",
    ...overrides,
  };
}

describe("runIdFor", () => {
  it("a mesma entrada produz o mesmo run — é o que permite retomar", () => {
    expect(runIdFor("init", "um prompt")).toBe(runIdFor("init", "um prompt"));
  });

  it("entrada diferente produz outro run — evidência antiga não aceita plano novo", () => {
    expect(runIdFor("build", "plano A")).not.toBe(runIdFor("build", "plano B"));
  });
});

describe("replayEvents", () => {
  it("considera concluído o assunto cuja última transição foi complete", () => {
    const progress = replayEvents([
      event({ subject: "project-description.md", status: "started" }),
      event({ subject: "project-description.md", status: "complete" }),
    ]);
    expect(progress.completed).toEqual(["project-description.md"]);
  });

  it("assunto concluído e depois reaberto deixa de contar como concluído", () => {
    const progress = replayEvents([
      event({ subject: "user-stories.md", status: "complete" }),
      event({ subject: "user-stories.md", status: "retry", attempt: 2, detail: "auditor devolveu" }),
    ]);
    expect(progress.completed).toEqual([]);
    expect(progress.attempts["user-stories.md"]).toBe(2);
  });

  it("propaga bloqueio e pausa do último evento", () => {
    expect(replayEvents([event({ status: "blocked" })]).status).toBe("blocked");
    expect(replayEvents([event({ status: "paused" })]).status).toBe("paused");
  });

  it("log vazio não quebra", () => {
    const progress = replayEvents([]);
    expect(progress).toMatchObject({ events: 0, completed: [], status: "running", lastEvent: null });
  });
});

describe("nextSubject", () => {
  it("retoma do primeiro assunto pendente, sem repetir o aprovado", () => {
    const progress = replayEvents([
      event({ subject: DOCUMENTS[0], status: "complete" }),
      event({ subject: DOCUMENTS[1], status: "complete" }),
    ]);
    expect(nextSubject(progress, DOCUMENTS)).toBe("database-schema.md");
  });

  it("devolve null quando tudo foi concluído", () => {
    const progress = replayEvents(DOCUMENTS.map((subject) => event({ subject, status: "complete" })));
    expect(nextSubject(progress, DOCUMENTS)).toBeNull();
  });

  it("serve tanto a cadeia documental quanto as fases do loop", () => {
    const progress = replayEvents([event({ subject: "P01", status: "complete" }), event({ subject: "P02", status: "complete" })]);
    expect(nextSubject(progress, ["P01", "P02", "P03"])).toBe("P03");
  });
});

describe("restoreRun", () => {
  it("devolve null quando o run não existe", async () => {
    expect(await restoreRun(projectRoot, "init-inexistente")).toBeNull();
  });

  it("o log vence o snapshot quando o processo morreu entre a transição e o resumo", async () => {
    const runId = runIdFor("init", "prompt");
    const state = createRunState({ runId, command: "init", language: "pt-BR" });
    await writeRunState(projectRoot, { ...state, stage: "interview", subject: "project-description.md", attempt: 1 });

    const events = runPaths(projectRoot, runId).events;
    await appendEvent(events, event({ subject: "project-description.md", status: "complete", stage: "publish" }));
    await appendEvent(events, event({ subject: "user-stories.md", status: "started", stage: "interview", attempt: 1 }));

    const restored = await restoreRun(projectRoot, runId);
    expect(restored?.snapshotWasStale).toBe(true);
    expect(restored?.state.subject).toBe("user-stories.md");
    expect(restored?.progress.completed).toEqual(["project-description.md"]);
    expect(nextSubject(restored!.progress, DOCUMENTS)).toBe("user-stories.md");
  });

  it("snapshot alinhado ao log não é reportado como velho", async () => {
    const runId = runIdFor("build", "plano");
    const state = createRunState({ runId, command: "build", language: "pt-BR" });
    await writeRunState(projectRoot, { ...state, stage: "implement", subject: "P01", attempt: 2 });
    await appendEvent(runPaths(projectRoot, runId).events, event({ stage: "implement", subject: "P01", attempt: 2, status: "retry" }));

    const restored = await restoreRun(projectRoot, runId);
    expect(restored?.snapshotWasStale).toBe(false);
  });
});
