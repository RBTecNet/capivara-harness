/**
 * Assinatura da árvore e commit por fase.
 *
 * A assinatura responde a uma pergunta só: alguma coisa mudou entre o antes e o
 * depois da sessão? Ela é SINAL, não veredito — uma fase já implementada faz o
 * executor corretamente não escrever nada, e reprovar por isso seria um falso
 * negativo. Quem decide são os gates 2 e 3.
 *
 * Sem repositório Git, a assinatura vem de uma varredura com as mesmas
 * exclusões: o loop roda igual, só não commita.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * O plano de controle nunca conta como trabalho da fase.
 *
 * Sem esta exclusão, os prompts e logs que o próprio loop grava fariam o gate 1
 * dizer que a sessão escreveu código, e o commit da fase levaria junto o
 * histórico interno do run para o repositório de quem chamou.
 */
const CONTROL_PLANE_PATHSPEC = [".", ":(exclude).capivara"];

const EXCLUDED = new Set([
  ".git", "node_modules", "vendor", "dist", "build", "target", "__pycache__",
  ".venv", "venv", ".next", ".nuxt", ".cache", "coverage", ".capivara",
]);

export async function isRepository(projectRoot: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function isClean(projectRoot: string): Promise<boolean> {
  try {
    const { stdout } = await run("git", ["status", "--porcelain", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
    return stdout.trim() === "";
  } catch {
    return true;
  }
}

async function walkSignature(projectRoot: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (EXCLUDED.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute).catch(() => null);
      if (!info || info.size > 8 * 1024 * 1024) continue;
      hash.update(relative(projectRoot, absolute));
      hash.update(await readFile(absolute).catch(() => Buffer.alloc(0)));
    }
  };
  await walk(projectRoot);
  return hash.digest("hex").slice(0, 16);
}

/** Hash do estado observável da árvore. Não muta o índice do Git. */
export async function treeSignature(projectRoot: string): Promise<string> {
  if (!(await isRepository(projectRoot))) return walkSignature(projectRoot);
  try {
    const status = await run("git", ["status", "--porcelain", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
    const diff = await run("git", ["diff", "HEAD", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot, maxBuffer: 64 * 1024 * 1024 });
    const untracked = await run("git", ["ls-files", "--others", "--exclude-standard", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
    const hash = createHash("sha256").update(status.stdout).update(diff.stdout);
    for (const path of untracked.stdout.split("\n").filter(Boolean).sort()) {
      hash.update(path);
      hash.update(await readFile(join(projectRoot, path)).catch(() => Buffer.alloc(0)));
    }
    return hash.digest("hex").slice(0, 16);
  } catch {
    return walkSignature(projectRoot);
  }
}

export async function hasPendingChanges(projectRoot: string): Promise<boolean> {
  if (!(await isRepository(projectRoot))) return false;
  return !(await isClean(projectRoot));
}

export interface CommitResult {
  committed: boolean;
  message: string;
}

/** Um commit por fase verde. Nunca muda de branch, nunca faz push. */
export async function commitPhase(projectRoot: string, phaseNumber: number, title: string): Promise<CommitResult> {
  if (!(await isRepository(projectRoot))) return { committed: false, message: "sem repositório Git: nenhum commit criado" };
  if (!(await hasPendingChanges(projectRoot))) {
    return { committed: false, message: "nada a commitar: a fase já estava implementada em HEAD" };
  }
  const message = `feat(phase-${phaseNumber}): ${title}`;
  await run("git", ["add", "-A", "--", ...CONTROL_PLANE_PATHSPEC], { cwd: projectRoot });
  await run("git", ["commit", "-q", "-m", message], { cwd: projectRoot });
  return { committed: true, message };
}

/**
 * A especificação entra no histórico do produto.
 *
 * Até aqui, `.capivara/` era excluída de tudo — e com razão, para o plano de
 * controle não contar como trabalho da fase nem poluir o commit. O efeito
 * colateral era que o código nascia versionado e a especificação que o gerou,
 * não: quem clonasse o repositório encontrava a aplicação sem as decisões que a
 * produziram.
 *
 * Só os artefatos publicados — o esqueleto e o plano — num commit próprio, no
 * momento em que cada estágio fecha o seu gate. Nada de `runs/` nem de
 * `handoffs/`: aquilo é estado do run, e o `.gitignore` escrito na árvore de
 * artefatos já os mantém de fora.
 *
 * Os DOIS estágios versionam, e o gate vai na mensagem. Enquanto só o `init`
 * chamava isto, o esqueleto entrava no histórico e o plano executável — que é o
 * artefato que o loop de fato consome — ficava de fora, com a mensagem do commit
 * anunciando um RALPH READY que aquele estágio nem alcança.
 */
export async function commitSpecification(projectRoot: string, gate: "PLAN READY" | "RALPH READY"): Promise<CommitResult> {
  if (!(await isRepository(projectRoot))) return { committed: false, message: "sem repositório Git: a especificação não foi versionada" };

  // Pathspec explícito: nada do trabalho em andamento de quem chamou entra junto.
  await run("git", ["add", "--", ".capivara/init"], { cwd: projectRoot });
  const staged = await run("git", ["diff", "--cached", "--name-only", "--", ".capivara/init"], { cwd: projectRoot });
  if (staged.stdout.trim() === "") return { committed: false, message: "a especificação versionada já é esta" };

  const message = `docs(capivara): especificação ${gate}`;
  await run("git", ["commit", "-q", "-m", message, "--", ".capivara/init"], { cwd: projectRoot });
  return { committed: true, message };
}
