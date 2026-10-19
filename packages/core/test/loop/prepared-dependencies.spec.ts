import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adoptPreparedDependencies } from "../../src/loop/prepared-dependencies.js";

const run = promisify(execFile);
let root: string;
const requirement = { technology: "SQLite", binary: "node", systemLevel: false,
  checkArgs: ["-e", "require('better-sqlite3')"] };
const git = async (args: string[]) => (await run("git", args, { cwd: root })).stdout.trim();
const write = async (path: string, content: string) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "capivara-prepared-deps-"));
  await git(["init", "-q"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await git(["commit", "--allow-empty", "-qm", "base"]);
  await write("backend/package.json", JSON.stringify({ dependencies: { "better-sqlite3": "^11.10.0" } }));
  await write("backend/node_modules/driver/index.js", "instalado");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("admite só o manifesto mínimo e seu lock, mantendo módulos no disco", async () => {
  await write("backend/package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: {
    "": { dependencies: { "better-sqlite3": "^11.10.0" } }, "node_modules/better-sqlite3": { version: "11.10.0" },
  } }));
  expect(await adoptPreparedDependencies(root, [requirement])).toBe(true);
  expect(await git(["ls-tree", "-r", "--name-only", "HEAD"])).toBe("backend/package-lock.json\nbackend/package.json");
  expect(await git(["status", "--porcelain"])).toBe("");
  expect(await readFile(join(root, "backend/node_modules/driver/index.js"), "utf8")).toBe("instalado");
  expect(await adoptPreparedDependencies(root, [requirement])).toBe(false);
});

it.each(["src/app.ts", ".env", "backend/extra.txt"])("não publica preparação junto de alteração alheia em %s", async path => {
  await write(path, "preservar");
  const head = await git(["rev-parse", "HEAD"]);
  expect(await adoptPreparedDependencies(root, [requirement])).toBe(false);
  expect(await git(["rev-parse", "HEAD"])).toBe(head);
  expect(await readFile(join(root, path), "utf8")).toBe("preservar");
});

it.each([
  { dependencies: { "better-sqlite3": "11", outro: "1" } },
  { dependencies: { "better-sqlite3": "11" }, scripts: { start: "node app.js" } },
])("manifesto que excede a instalação declarada continua pendente", async manifest => {
  await write("backend/package.json", JSON.stringify(manifest));
  expect(await adoptPreparedDependencies(root, [requirement])).toBe(false);
});

it("não adota alteração de manifesto já rastreado", async () => {
  await git(["add", "backend/package.json"]);
  await git(["commit", "-qm", "manifesto anterior"]);
  await write("backend/package.json", JSON.stringify({ dependencies: { "better-sqlite3": "12" } }));
  const head = await git(["rev-parse", "HEAD"]);
  expect(await adoptPreparedDependencies(root, [requirement])).toBe(false);
  expect(await git(["rev-parse", "HEAD"])).toBe(head);
});
