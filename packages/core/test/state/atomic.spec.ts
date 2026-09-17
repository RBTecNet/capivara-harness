import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendLine, sweepTemporaries, writeAtomic } from "../../src/state/index.js";

const ATOMIC_MODULE = fileURLToPath(new URL("../../src/state/atomic.ts", import.meta.url));

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "capivara-atomic-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("writeAtomic", () => {
  it("escreve o conteúdo e cria o diretório", async () => {
    const target = join(workspace, "nested", "run.json");
    await writeAtomic(target, '{"a":1}\n');
    expect(await readFile(target, "utf8")).toBe('{"a":1}\n');
  });

  it("substitui o conteúdo anterior", async () => {
    const target = join(workspace, "run.json");
    await writeAtomic(target, "v1");
    await writeAtomic(target, "v2");
    expect(await readFile(target, "utf8")).toBe("v2");
  });

  it("não deixa temporário para trás no caminho feliz", async () => {
    await writeAtomic(join(workspace, "run.json"), "v1");
    expect((await readdir(workspace)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });
});

describe("kill -9 durante a escrita", () => {
  it("nunca deixa o alvo parcial ou inválido", async () => {
    const target = join(workspace, "run.json");
    const script = join(workspace, "writer.mjs");
    await writeFile(
      script,
      [
        `const { writeAtomic } = await import(${JSON.stringify(ATOMIC_MODULE)});`,
        `const payload = "x".repeat(300000);`,
        `for (let round = 0; ; round += 1) {`,
        `  await writeAtomic(${JSON.stringify(target)}, JSON.stringify({ round, payload }, null, 2) + "\\n");`,
        `}`,
      ].join("\n"),
      "utf8",
    );

    let observouArquivo = false;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const child = spawn(process.execPath, [script], { stdio: "ignore" });
      await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 25));
      child.kill("SIGKILL");
      await once(child, "exit");

      const content = await readFile(target, "utf8").catch(() => null);
      if (content === null) continue;
      observouArquivo = true;
      // O alvo só passa a existir pelo rename, então ou não existe, ou está inteiro.
      const parsed = JSON.parse(content) as { round: number; payload: string };
      expect(parsed.payload).toHaveLength(300000);
      expect(content.endsWith("\n")).toBe(true);
    }

    expect(observouArquivo, "nenhuma rodada chegou a escrever o alvo; o teste não provou nada").toBe(true);
  }, 30000);

  it("os temporários deixados pela morte do processo são varridos", async () => {
    await writeFile(join(workspace, ".run.json.999.abcdef.tmp"), "lixo de um processo morto", "utf8");
    await writeFile(join(workspace, ".run.json.998.123456.tmp"), "mais lixo", "utf8");
    expect(await sweepTemporaries(workspace)).toBe(2);
    expect(await readdir(workspace)).toEqual([]);
  });

  it("a varredura não reclama de diretório inexistente", async () => {
    expect(await sweepTemporaries(join(workspace, "ausente"))).toBe(0);
  });
});

describe("appendLine", () => {
  it("acrescenta linhas em ordem sem reescrever as anteriores", async () => {
    const target = join(workspace, "events.tsv");
    await appendLine(target, "primeira");
    await appendLine(target, "segunda");
    expect(await readFile(target, "utf8")).toBe("primeira\nsegunda\n");
  });
});
