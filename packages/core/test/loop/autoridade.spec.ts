/**
 * Só o Core registra e publica no Git (§101).
 *
 * Duas fronteiras, com Git de verdade:
 *
 * - o AGENTE que roda `git commit`, `git stash` ou `git push` por conta própria
 *   — no serial, no worktree do paralelo, e na principal a partir do worktree;
 * - a JANELA entre a conferência dos arquivos e o que de fato vai para o commit:
 *   um hook `pre-commit` que prepara outra coisa, ou o disco que muda depois do
 *   `add`.
 *
 * O que se confere é o histórico e as referências, não mensagens.
 */

import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitPhase, runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { readEvents, replayEvents, runIdFor, runPaths } from "../../src/state/index.js";
import { sha12 } from "../../src/contract/index.js";

const run = promisify(execFile);

const SEGREDO = "SENHA_DO_BANCO=valor-real-que-nunca-pode-ir-para-o-historico";
const CHAVE_PRIVADA = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCsegredo\n-----END PRIVATE KEY-----\n";

let projectRoot: string;
let cache: string;

async function git(args: string[], cwd = projectRoot): Promise<string> {
  return (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
}

async function existe(caminho: string): Promise<boolean> {
  return stat(caminho).then(() => true, () => false);
}

async function escrever(caminho: string, conteudo: string, raiz = projectRoot): Promise<void> {
  await mkdir(join(raiz, caminho, ".."), { recursive: true });
  await writeFile(join(raiz, caminho), conteudo, "utf8");
}

async function repositorio(): Promise<void> {
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-autoridade-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-autoridade-cache-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

// ——— A janela entre a conferência e o commit ———

describe("a janela entre admissão e commit", () => {
  beforeEach(async () => {
    await repositorio();
    await escrever("README.md", "inicial\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "inicial"]);
  });

  async function hookPreCommit(script: string): Promise<void> {
    const arquivo = join(projectRoot, ".git", "hooks", "pre-commit");
    await writeFile(arquivo, `#!/bin/sh\n${script}\n`, "utf8");
    await chmod(arquivo, 0o755);
  }

  it("um pre-commit que prepara um .env depois da conferência não põe o .env no commit", async () => {
    await hookPreCommit(`printf '%s\\n' '${SEGREDO}' > .env.local && git add .env.local`);
    await escrever("src/app.ts", "export const app = 1;\n");

    const resultado = await commitPhase(projectRoot, 1, "Fundação");

    expect(resultado.committed, resultado.message).toBe(true);
    expect((await git(["show", "--name-only", "--format=", "HEAD"])).split("\n")).toEqual(["src/app.ts"]);
    expect(await git(["log", "--all", "-p", "--format=%H"])).not.toContain("valor-real");
  });

  it("um pre-commit que troca o conteúdo de um arquivo já conferido não muda o que é commitado", async () => {
    await hookPreCommit(`printf '%s' '${CHAVE_PRIVADA.replace(/\n/g, "\\n")}' > config/app.txt && git add config/app.txt`);
    await escrever("config/app.txt", "porta=3000\n");

    const resultado = await commitPhase(projectRoot, 2, "Configuração");

    expect(resultado.committed, resultado.message).toBe(true);
    expect(await git(["show", "HEAD:config/app.txt"])).toBe("porta=3000");
    expect(await git(["log", "--all", "-p", "--format=%H"])).not.toContain("PRIVATE KEY");
  });

  it("o que o agente deixou preparado no índice não entra junto, e continua preparado", async () => {
    await escrever(".env", `${SEGREDO}\n`);
    await git(["add", "-f", ".env"]);
    // A conferência vê o .env e bloqueia: nada é commitado, e o índice de quem preparou fica como estava.
    const resultado = await commitPhase(projectRoot, 3, "Cadastro");
    expect(resultado.committed).toBe(false);
    expect(await git(["log", "--format=%s", "-1"])).toBe("inicial");
    expect(await git(["diff", "--cached", "--name-only"])).toBe(".env");
  });
});

// ——— O agente que mexe no Git por conta própria ———

const FASE = (numero: number, titulo: string, depende: string): string =>
  [
    `## Phase ${numero}: ${titulo}`,
    "",
    `**Goal:** ${titulo} funciona · **Depends on:** ${depende} · **Covers:** workflow ${numero}`,
    "",
    `- [ ] **Task:** Entregar ${titulo.toLowerCase()}`,
    "  - **Acceptance criteria:**",
    `    - O arquivo de ${titulo.toLowerCase()} existe`,
    `  - **Traces:** US-${numero}.1`,
    "",
  ].join("\n");

const PLANO = [
  "# Autoridade — Project Phases",
  "",
  "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
  "",
  "## Overview",
  "",
  "Fundação, duas frentes independentes.",
  "",
  FASE(1, "Fundação", "none"),
  FASE(2, "Cadastro", "Phase 1"),
  FASE(3, "Relatório", "Phase 1"),
  "## Open Questions",
  "",
  "Nenhuma.",
  "",
].join("\n");

const RUN = (): string => runIdFor("build", sha12(PLANO));

const ESCRITAS: Record<string, { path: string; content: string }[]> = {
  P01: [{ path: "base.txt", content: "fundação\n" }],
  P02: [{ path: "cadastro.txt", content: "cadastro\n" }],
  P03: [{ path: "relatorio.txt", content: "relatório\n" }],
};

/** O que o executor de uma fase roda no shell dele, depois de escrever os arquivos. */
type Bypass = (raiz: string) => Promise<void>;

function motor(bypass: Record<string, Bypass> = {}, demora: Record<string, number> = {}) {
  const chamadas: EngineCall[] = [];
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    if (chamada.role === "verifier") return { exitCode: 0, stdout: "TASK 1: DONE", stderr: "", timedOut: null };
    await new Promise((resolve) => setTimeout(resolve, demora[chamada.phase.id] ?? 20));
    const raiz = chamada.root ?? projectRoot;
    for (const arquivo of ESCRITAS[chamada.phase.id] ?? []) await escrever(arquivo.path, arquivo.content, raiz);
    await bypass[chamada.phase.id]?.(raiz);
    return { exitCode: 0, stdout: "feito", stderr: "", timedOut: null };
  };
  return { call, chamadas };
}

function opcoes(engine: ReturnType<typeof motor>, anuncios: string[], extra: Partial<BuildOptions> = {}): BuildOptions {
  return {
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache },
    skipAcceptance: true,
    explicitTestCommand: "npm test",
    testRunner: async () => ({ exitCode: 0, output: "ok" }),
    announce: (mensagem) => anuncios.push(mensagem),
    ...extra,
  };
}

const PARALELO: Partial<BuildOptions> = {
  parallel: {
    maxConcurrency: 2,
    agentes: [
      { engine: "codex", label: "codex", systemInstall: true },
      { engine: "codex", label: "codex", systemInstall: true },
    ],
    resumo: [],
  },
};

async function concluidas(): Promise<string[]> {
  return replayEvents(await readEvents(runPaths(projectRoot, RUN()).events)).completed;
}

const commitDoAgente: Bypass = async (raiz) => {
  await git(["add", "-A", "--", ".", ":(exclude).capivara"], raiz);
  await git(["commit", "-q", "-m", "commit feito pelo agente"], raiz);
};

describe("o agente que mexe no Git — serial", () => {
  beforeEach(async () => {
    await repositorio();
    await escrever(".capivara/init/project-phases.md", PLANO);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "docs: plano"]);
  });

  it("commit do executor na árvore principal: a fase para, não é concluída, e nada é desfeito", async () => {
    const anuncios: string[] = [];
    const engine = motor({ P02: commitDoAgente });
    const outcome = await runBuild(opcoes(engine, anuncios, { systemInstall: true }));

    expect(outcome.exitCode, anuncios.join("\n")).toBe(2);
    expect(outcome.errors.join("\n")).toContain("refs/heads/main");
    // A P02 não foi registrada como concluída, e a P03 não rodou sobre ela.
    expect(await concluidas()).not.toContain("P02");
    expect(engine.chamadas.some((chamada) => chamada.phase.id === "P03")).toBe(false);
    // O Core não publicou commit seu da P02; o do agente continua lá — não se reescreve histórico.
    const historico = (await git(["log", "--format=%s"])).split("\n");
    expect(historico).toContain("commit feito pelo agente");
    expect(historico.some((linha) => linha.startsWith("feat(phase-2)"))).toBe(false);
    // O build declarou, antes, o que estava e o que não estava garantido.
    expect(anuncios.some((linha) => linha.startsWith("autoridade Git:") && linha.includes("nada impede"))).toBe(true);
  });

  it("git stash do executor: detectado, e o trabalho guardado no stash não se perde", async () => {
    const anuncios: string[] = [];
    const outcome = await runBuild(
      opcoes(motor({ P02: async (raiz) => void (await git(["stash", "push", "-u", "-q", "-m", "do agente"], raiz)) }), anuncios),
    );
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("refs/stash");
    expect(await git(["stash", "list"])).toContain("do agente");
  });

  it("push do executor com rastreio: detectado e dito como publicação provável", async () => {
    const remoto = await mkdtemp(join(tmpdir(), "capivara-remoto-"));
    try {
      await git(["init", "-q", "--bare"], remoto);
      await git(["remote", "add", "origin", remoto]);
      const outcome = await runBuild(
        opcoes(
          motor({
            P02: async (raiz) => {
              await commitDoAgente(raiz);
              await git(["push", "-q", "-u", "origin", "main"], raiz);
            },
          }),
          [],
        ),
      );
      expect(outcome.exitCode).toBe(2);
      expect(outcome.errors.join("\n")).toContain("refs/remotes/origin/main");
      expect(outcome.errors.join("\n")).toContain("push");
    } finally {
      await rm(remoto, { recursive: true, force: true });
    }
  });
});

describe("o agente que mexe no Git — paralelo", () => {
  beforeEach(async () => {
    await repositorio();
    await escrever(".capivara/init/project-phases.md", PLANO);
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "docs: plano"]);
  });

  it("commit do agente no worktree: nada dele entra na principal, e o branch fica para exame", async () => {
    const anuncios: string[] = [];
    const outcome = await runBuild(opcoes(motor({ P02: commitDoAgente }, { P02: 20, P03: 120 }), anuncios, PARALELO));

    expect(outcome.exitCode).toBe(2);
    expect(await existe(join(projectRoot, "cadastro.txt"))).toBe(false);
    expect((await git(["log", "--format=%s", "main"])).split("\n")).not.toContain("commit feito pelo agente");
    expect(await git(["log", "--format=%s", "-1", `capivara/${RUN()}/P02`])).toBe("commit feito pelo agente");
    expect(outcome.errors.join("\n")).toContain("mexeu no Git");
    // A fase independente seguiu e entrou pelo integrador.
    expect(await existe(join(projectRoot, "relatorio.txt"))).toBe(true);
  });

  it("commit do agente direto na principal, a partir do worktree: o integrador percebe e nada mais entra", async () => {
    const anuncios: string[] = [];
    const naPrincipal: Bypass = async () => {
      await escrever("intruso.txt", "de fora\n");
      await git(["add", "intruso.txt"]);
      await git(["commit", "-q", "-m", "commit do agente na principal"]);
    };
    const outcome = await runBuild(opcoes(motor({ P02: naPrincipal }, { P02: 20, P03: 120 }), anuncios, PARALELO));

    expect(outcome.exitCode, anuncios.join("\n")).toBe(2);
    expect([...anuncios, ...outcome.errors].join("\n")).toContain("não é do integrador");
    // Nada foi integrado depois do commit de fora: nem a P02 nem a P03.
    const historico = (await git(["log", "--format=%s", "main"])).split("\n");
    expect(historico[0]).toBe("commit do agente na principal");
    expect(historico.some((linha) => linha.startsWith("feat(phase-2)") || linha.startsWith("feat(phase-3)"))).toBe(false);
  });
});

// ——— O impedimento real do provider, onde existe ———

async function temCodex(): Promise<boolean> {
  return run("codex", ["--version"]).then(() => true, () => false);
}

describe("o sandbox de workspace do codex", async () => {
  const disponivel = await temCodex();

  it.skipIf(!disponivel)("impede git commit no projeto e no worktree, e recusa a rede (codex sandbox -P :workspace)", async () => {
    await repositorio();
    await escrever("a.txt", "a\n");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "base"]);
    const worktree = await mkdtemp(join(tmpdir(), "capivara-sbx-wt-"));
    await rm(worktree, { recursive: true, force: true });
    await git(["worktree", "add", "-q", "-b", "fase", worktree]);
    try {
      await escrever("b.txt", "b\n");
      await escrever("c.txt", "c\n", worktree);
      const tentar = (cwd: string, comando: string) =>
        run("codex", ["sandbox", "-P", ":workspace", "-C", cwd, "--", "sh", "-c", comando]).then(
          (saida) => `${saida.stdout}${saida.stderr}`,
          (erro: { stdout?: string; stderr?: string }) => `${erro.stdout ?? ""}${erro.stderr ?? ""}`,
        );
      await tentar(projectRoot, "git add b.txt && git commit -qm 'do agente' && echo COMMIT_OK");
      await tentar(worktree, "git add c.txt && git commit -qm 'do agente' && echo COMMIT_OK");
      const rede = await tentar(projectRoot, "git ls-remote https://github.com/git/git.git >/dev/null 2>&1 && echo REDE_OK || echo REDE_RECUSADA");

      expect(await git(["log", "--format=%s"])).toBe("base");
      expect(await git(["log", "--format=%s", "fase"])).toBe("base");
      expect(rede).toContain("REDE_RECUSADA");
    } finally {
      await git(["worktree", "remove", "--force", worktree]).catch(() => undefined);
    }
  });
});
