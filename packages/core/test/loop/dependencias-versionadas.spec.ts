import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { alteracoesParaCommit, dependenciasLocaisIgnoradas, lerStatus } from "../../src/loop/admissao.js";
import { commitPhase, iniciarRepositorio, isClean } from "../../src/loop/git.js";
import { alteradosNaPrincipal } from "../../src/loop/worktree.js";

const run = promisify(execFile);
let root: string;
const generated = "server/node_modules/.vite/vitest/results.json";
const git = async (...args: string[]): Promise<string> => (await run("git", args, { cwd: root })).stdout.trim();
async function write(path: string, contents: string) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), contents);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-legacy-deps-"));
  await git("init", "-q");
  await git("config", "user.name", "Teste");
  await git("config", "user.email", "test@example.invalid");
  await write(".gitignore", "node_modules/\n");
  await write(generated, "cache legado\n");
  await write("src/app.ts", "fonte original\n");
  await git("add", "-A");
  await git("add", "-f", "--", generated);
  await git("commit", "-qm", "base");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("retoma com cache ignorado já versionado sem descartar bytes, esconder o status Git ou mover refs", async () => {
  const head = await git("rev-parse", "HEAD");
  await write(generated, "cache atualizado\n");
  expect(await isClean(root)).toBe(true);
  expect(await alteradosNaPrincipal(root)).toEqual([]);
  expect(await alteracoesParaCommit(root)).toEqual([]);
  expect((await lerStatus(root)).map(entry => entry.caminho)).toEqual([generated]);
  expect(await git("status", "--porcelain")).toContain(generated);
  expect(await git("rev-parse", "HEAD")).toBe(head);
  expect(await readFile(join(root, generated), "utf8")).toBe("cache atualizado\n");
});

it.each(["server/dist/index.js", "web/build/app.js", "coverage/report.json", "web/.vite/cache.json", "test-results/result.json", "playwright-report/index.html", "target/debug/programa", "src/__pycache__/modulo.pyc"])("artefato gerado %s ignorado e já versionado não provoca devolução", async path => {
  const folder = path.split("/").slice(-2, -1)[0]!;
  await write(".gitignore", `node_modules/\n${folder}/\n`);
  await write(path, "saída anterior\n");
  await git("add", ".gitignore");
  await git("add", "-f", "--", path);
  await git("commit", "-qm", "legado com saída gerada");
  await write(path, "saída atual\n");
  expect(await isClean(root)).toBe(true);
  expect(await alteradosNaPrincipal(root)).toEqual([]);
  expect(await readFile(join(root, path), "utf8")).toBe("saída atual\n");
  await write("src/app.ts", "correção funcional\n");
  expect((await commitPhase(root, 2, "Entrega")).committed).toBe(true);
  expect(await git("show", "--format=", "--name-only", "HEAD")).toBe("src/app.ts");
  expect(await git("show", `HEAD:${path}`)).toBe("saída anterior");
});

it.each(["src/app.ts", "package.json", "package-lock.json", "data/app.db"])("arquivo de produto %s continua protegido mesmo se casar com ignore", async path => {
  await write(path, "original\n");
  await git("add", "--", path);
  await git("commit", "-qm", "produto versionado");
  await write(".gitignore", `node_modules/\n${path}\n`);
  await git("add", ".gitignore");
  await git("commit", "-qm", "ignore não oculta produto versionado");
  await write(path, "edição a preservar\n");
  expect(await isClean(root)).toBe(false);
  expect(await alteradosNaPrincipal(root)).toEqual([path]);
});

it("commit do produto não leva cache ignorado, preservando o índice de quem chamou", async () => {
  await write(generated, "cache atualizado\n");
  await git("add", "-u", "--", generated);
  await write("src/app.ts", "fonte corrigida\n");
  const result = await commitPhase(root, 1, "Entrega");
  expect(result.committed).toBe(true);
  expect(await git("show", "--format=", "--name-only", "HEAD")).toBe("src/app.ts");
  expect(await git("show", `HEAD:${generated}`)).toBe("cache legado");
  expect(await git("diff", "--cached", "--name-only")).toBe(generated);
  expect(await readFile(join(root, generated), "utf8")).toBe("cache atualizado\n");
});

it.each(["src/app.ts", "package.json", "package-lock.json", "dist/app.js", "tests/snapshot.json", "src/node_modules.ts"])("%s continua sendo alteração do produto", async path => {
  await write(path, "conteúdo novo\n");
  await write(generated, "cache atualizado\n");
  expect(await isClean(root)).toBe(false);
  expect((await alteracoesParaCommit(root)).map(entry => entry.caminho)).toEqual([path]);
});

it("dependência deliberadamente fora do ignore continua protegida", async () => {
  await write(".gitignore", "node_modules/\n!/node_modules/\n/node_modules/*\n!/node_modules/manual.txt\n");
  await write("node_modules/manual.txt", "versão revisada\n");
  await git("add", ".gitignore", "node_modules/manual.txt");
  await git("commit", "-qm", "dependência deliberadamente mantida");
  await write("node_modules/manual.txt", "edição a preservar\n");
  await write(generated, "cache atualizado\n");
  expect(await isClean(root)).toBe(false);
  expect(await alteradosNaPrincipal(root)).toEqual(["node_modules/manual.txt"]);
});

it("nomes com espaços, curingas e quebras de linha continuam literais na consulta de ignore", async () => {
  const paths = ["node_modules/local [1]*.json", "server/node_modules/nome com espaço\nlinha.json"];
  for (const path of paths) await write(path, "cache local\n");
  expect(await dependenciasLocaisIgnoradas(root, [...paths, "src/node_modules.ts"])).toEqual(new Set(paths));
});

it.each([false, true])("repositório criado pelo harness exclui dependências locais, respeitando exceção explícita (%s)", async explicit => {
  await rm(join(root, ".git"), { recursive: true, force: true });
  await rm(join(root, ".gitignore"));
  await write("node_modules/package/index.js", "instalação local\n");
  const ignore = "!/node_modules/\n/node_modules/*\n!/node_modules/manual.txt\n";
  if (explicit) {
    await write(".gitignore", ignore);
    await write("node_modules/manual.txt", "dependência deliberadamente versionada\n");
  }
  const result = await iniciarRepositorio(root, { comTrabalhoExistente: true });
  expect(result).toMatchObject({ criado: true, commitInicial: true });
  expect(await git("ls-files")).toBe(explicit ? ".gitignore\nnode_modules/manual.txt\nsrc/app.ts" : "src/app.ts");
  expect(await isClean(root)).toBe(true);
  expect(await readFile(join(root, generated), "utf8")).toBe("cache legado\n");
  if (explicit) expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(ignore);
  else await expect(readFile(join(root, ".gitignore"))).rejects.toThrow();
});
