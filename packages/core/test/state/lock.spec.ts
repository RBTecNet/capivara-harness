import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockBusyError, acquireLock, isProcessAlive, liveLockOwner, runPaths } from "../../src/state/index.js";

let projectRoot = "";
const RUN = "init-abc123abc123";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-lock-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const base = { projectRoot: "", runId: RUN, command: "init", hostname: "maquina-de-teste" };

function options(overrides: Partial<Parameters<typeof acquireLock>[0]> = {}) {
  return { ...base, projectRoot, ...overrides };
}

describe("isProcessAlive", () => {
  it("reconhece o próprio processo", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("rejeita pid inválido", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });
});

describe("acquireLock", () => {
  it("adquire e registra o dono", async () => {
    const lock = await acquireLock(options());
    expect(lock.owner.pid).toBe(process.pid);
    expect(lock.owner.runId).toBe(RUN);
    await lock.release();
  });

  it("um segundo run com dono vivo falha com mensagem acionável", async () => {
    const lock = await acquireLock(options({ isAlive: () => true }));
    await expect(acquireLock(options({ isAlive: () => true }))).rejects.toBeInstanceOf(LockBusyError);
    await expect(acquireLock(options({ isAlive: () => true }))).rejects.toThrow(/já está em execução no pid/);
    await lock.release();
  });

  it("depois do release o lock volta a ser adquirível", async () => {
    const first = await acquireLock(options());
    await first.release();
    const second = await acquireLock(options());
    expect(second.owner.pid).toBe(process.pid);
    await second.release();
  });

  it("lock órfão é recuperado e a quarentena não fica para trás", async () => {
    const first = await acquireLock(options({ isAlive: () => true }));
    // O processo morre sem liberar: o diretório e o owner.json continuam lá.
    const recovered = await acquireLock(options({ isAlive: () => false }));
    expect(recovered.owner.pid).toBe(process.pid);

    const runDirectory = runPaths(projectRoot, RUN).root;
    const restos = (await readdir(runDirectory)).filter((entry) => entry.includes("quarantine"));
    expect(restos).toEqual([]);
    expect(first.path).toBe(recovered.path);
    await recovered.release();
  });

  it("lock sem owner.json é tratado como órfão", async () => {
    await mkdir(runPaths(projectRoot, RUN).lock, { recursive: true });
    const lock = await acquireLock(options({ isAlive: () => true }));
    expect(lock.owner.pid).toBe(process.pid);
    await lock.release();
  });

  it("lock de outra máquina nunca é recuperado automaticamente", async () => {
    const paths = runPaths(projectRoot, RUN);
    await mkdir(paths.lock, { recursive: true });
    await writeFile(
      join(paths.lock, "owner.json"),
      JSON.stringify({ pid: 4242, hostname: "outra-maquina", startedAt: "2026-09-16T00:00:00.000Z", runId: RUN, command: "init" }),
      "utf8",
    );
    await expect(acquireLock(options({ isAlive: () => false }))).rejects.toThrow(/outra-maquina/);
  });
});

describe("quem está rodando agora", () => {
  it("sem lock, não há dono", async () => {
    expect(await liveLockOwner({ projectRoot, runId: "build-1" })).toBeNull();
  });

  it("com o dono vivo, devolve o dono: é o que explica a árvore suja", async () => {
    const lock = await acquireLock({ projectRoot, runId: "build-1", command: "build" });
    try {
      const dono = await liveLockOwner({ projectRoot, runId: "build-1" });
      expect(dono?.pid).toBe(process.pid);
    } finally {
      await lock.release();
    }
  });

  it("dono morto não é dono: o run anterior caiu e este pode rodar", async () => {
    const lock = await acquireLock({ projectRoot, runId: "build-1", command: "build" });
    try {
      expect(await liveLockOwner({ projectRoot, runId: "build-1", isAlive: () => false })).toBeNull();
    } finally {
      await lock.release();
    }
  });

  it("lock liberado não deixa dono para trás", async () => {
    const lock = await acquireLock({ projectRoot, runId: "build-1", command: "build" });
    await lock.release();
    expect(await liveLockOwner({ projectRoot, runId: "build-1" })).toBeNull();
  });
});

describe("o plano de controle fica fora do histórico", () => {
  it("ignora runs e handoffs, que é o que o commit da especificação promete", async () => {
    const { ensureArtifactTree, CONTROL_PLANE_IGNORE } = await import("../../src/state/index.js");
    await ensureArtifactTree(projectRoot);

    const escrito = await readFile(join(projectRoot, ".capivara", ".gitignore"), "utf8");
    expect(escrito).toBe(CONTROL_PLANE_IGNORE);
    expect(escrito).toContain("runs/");
    // Sem esta linha o `plan` deixa a árvore suja e o `build` recusa começar.
    expect(escrito).toContain("handoffs/");
  });

  /*
   * O teste acima conferia duas pastas, e o harness escreve cinco. As três que
   * nasceram depois da lista — roteiros, skills, memórias — vazavam para o
   * repositório do produto no `git add -A` que o PRÓPRIO harness manda rodar
   * quando uma fase pára no meio. Este teste pergunta ao git, não à lista: se uma
   * pasta nova entrar no plano de controle e ficar de fora do `.gitignore`, ele
   * falha.
   */
  it("o git não enxerga nenhuma pasta interna — e enxerga a especificação", async () => {
    const { ensureArtifactTree } = await import("../../src/state/index.js");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const git = promisify(execFile);

    await git("git", ["init", "-q"], { cwd: projectRoot });
    await ensureArtifactTree(projectRoot);
    for (const pasta of ["runs", "handoffs", "flows", "skills", "memorias", "init"]) {
      await mkdir(join(projectRoot, ".capivara", pasta), { recursive: true });
      await writeFile(join(projectRoot, ".capivara", pasta, "arquivo.txt"), "x", "utf8");
    }

    const { stdout } = await git("git", ["add", "-A", "--dry-run"], { cwd: projectRoot });
    for (const interna of ["runs", "handoffs", "flows", "skills", "memorias"]) {
      expect(stdout, interna).not.toContain(`.capivara/${interna}/`);
    }
    // A especificação É do histórico: é o que `commitSpecification` versiona.
    expect(stdout).toContain(".capivara/init/");
  });
});
