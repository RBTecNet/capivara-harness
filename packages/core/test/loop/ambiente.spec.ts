import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { semearAmbiente } from "../../src/loop/ambiente.js";
import { errosDoServidor } from "../../src/loop/flows.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-ambiente-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("o .env que ninguém criou", () => {
  it("cria o .env a partir do exemplo, com os mesmos valores", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DB_NAME=locadora.db\nPORT=3000\n", "utf8");

    const mensagem = await semearAmbiente(projectRoot);
    expect(mensagem).toContain(".env.example");
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toBe("DB_NAME=locadora.db\nPORT=3000\n");
  });

  it("NUNCA sobrescreve o .env do desenvolvedor — ele pode apontar para o banco dele", async () => {
    await writeFile(join(projectRoot, ".env"), "DB_URL=postgres://producao/real\n", "utf8");
    await writeFile(join(projectRoot, ".env.example"), "DB_URL=postgres://localhost/exemplo\n", "utf8");

    expect(await semearAmbiente(projectRoot)).toBeNull();
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toContain("producao/real");
  });

  it("não inventa ambiente quando não há exemplo", async () => {
    expect(await semearAmbiente(projectRoot)).toBeNull();
    await expect(readFile(join(projectRoot, ".env"), "utf8")).rejects.toThrow();
  });

  it("exemplo vazio não vira .env vazio", async () => {
    await writeFile(join(projectRoot, ".env.example"), "   \n", "utf8");
    expect(await semearAmbiente(projectRoot)).toBeNull();
  });

  it("é silencioso quando não há o que fazer: ruído por ciclo ninguém lê", async () => {
    await writeFile(join(projectRoot, ".env"), "x=1", "utf8");
    expect(await semearAmbiente(projectRoot)).toBeNull();
  });
});

describe("o que a aplicação registrou", () => {
  const saida = [
    "  ✘  1 workflow-1.spec.ts:3:1 › workflow 1 — Cadastro de clientes (1.0m)",
    "    Error: locator.fill: Test timeout of 60000ms exceeded.",
    "[WebServer] (node:27489) ExperimentalWarning: SQLite is an experimental feature",
    "[WebServer] ⨯ Error: DB_NAME deve indicar um nome de arquivo dentro da pasta do projeto ou um caminho absoluto.",
    "[WebServer]     at <unknown> (.next/server/chunks/ssr/x.js:5:5423)",
    "[WebServer] ⨯ Error: DB_NAME deve indicar um nome de arquivo dentro da pasta do projeto ou um caminho absoluto.",
  ].join("\n");

  it("separa o erro do servidor do rastro do roteiro", () => {
    const erros = errosDoServidor(saida);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain("DB_NAME deve indicar");
  });

  it("ignora aviso, rastro de pilha e o que não é do servidor", () => {
    const erros = errosDoServidor(saida);
    expect(erros.some((erro) => erro.includes("ExperimentalWarning"))).toBe(false);
    expect(erros.some((erro) => erro.startsWith("at "))).toBe(false);
    expect(erros.some((erro) => erro.includes("locator.fill"))).toBe(false);
  });

  it("não acha erro onde não há", () => {
    expect(errosDoServidor("[WebServer] pronto em http://127.0.0.1:3000\n  ✓ 2 passed")).toEqual([]);
  });
});
