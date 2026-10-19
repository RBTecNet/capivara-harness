import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { abrirWorktree } from "../../src/loop/worktree.js";

const run = promisify(execFile);
let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it("retoma alterações e arquivos novos sem commit após interrupção, sem integrar o parcial", async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-worktree-interrompido-"));
  const git = async (...args: string[]): Promise<string> => (await run("git", args, { cwd: root })).stdout.trim();
  await git("init", "-q");
  await git("config", "user.name", "Teste");
  await git("config", "user.email", "teste@example.invalid");
  await writeFile(join(root, "base.txt"), "base\n");
  await git("add", "base.txt");
  await git("commit", "-qm", "base");
  const before = await git("rev-parse", "HEAD");
  const env = { ...process.env, XDG_CACHE_HOME: join(root, "cache") };
  const first = await abrirWorktree(root, "build-cancelado", "P01", env);
  await writeFile(join(first.worktree.dir, "base.txt"), "alteração recuperada\n");
  await writeFile(join(first.worktree.dir, "novo.ts"), "export const valor = 75;\n");
  const resumed = await abrirWorktree(root, "build-cancelado", "P01", env);
  expect(await readFile(join(resumed.worktree.dir, "base.txt"), "utf8")).toBe("alteração recuperada\n");
  expect(await readFile(join(resumed.worktree.dir, "novo.ts"), "utf8")).toContain("valor = 75");
  expect(resumed.retomado?.aplicado).toBe(true);
  expect(await git("rev-parse", "HEAD")).toBe(before);
  await expect(readFile(join(root, "novo.ts"), "utf8")).rejects.toThrow();
});

it("retoma parcial que cria gitignore com dist já versionado e modificado, preservando as fontes", async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-worktree-ignored-"));
  const git = async (...args: string[]): Promise<string> => (await run("git", args, { cwd: root })).stdout.trim();
  await git("init", "-q");
  await git("config", "user.name", "Teste");
  await git("config", "user.email", "teste@example.invalid");
  await mkdir(join(root, "server/dist"), { recursive: true });
  await writeFile(join(root, "server/dist/index.js"), "anterior\n");
  await git("add", "-A");
  await git("commit", "-qm", "base com dist versionado");
  const before = await git("rev-parse", "HEAD");
  const env = { ...process.env, XDG_CACHE_HOME: join(root, "cache") };
  const first = await abrirWorktree(root, "build-ignored", "P01", env);
  const dir = first.worktree.dir;
  await writeFile(join(dir, ".gitignore"), "dist\nnode_modules\n");
  await writeFile(join(dir, "server/dist/index.js"), "alteração preservada\n");
  await writeFile(join(dir, "server/dist/novo.js"), "artefato novo ignorado\n");
  await writeFile(join(dir, "fonte.ts"), "export const source = true;\n");

  const resumed = await abrirWorktree(root, "build-ignored", "P01", env);
  expect(resumed.retomado?.aplicado).toBe(true);
  expect(await readFile(join(resumed.worktree.dir, "server/dist/index.js"), "utf8")).toBe("alteração preservada\n");
  expect(await readFile(join(resumed.worktree.dir, "fonte.ts"), "utf8")).toContain("source = true");
  const branch = resumed.retomado!.branch;
  expect(await git("show", `${branch}:fonte.ts`)).toContain("source = true");
  await expect(git("cat-file", "-e", `${branch}:server/dist/novo.js`)).rejects.toThrow();
  expect(await git("rev-parse", "HEAD")).toBe(before);
  await expect(readFile(join(root, "fonte.ts"), "utf8")).rejects.toThrow();
});
