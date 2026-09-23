import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MARCA_DO_HARNESS, ambienteEhDescartavel, comandoDeMigracao, prepararAmbiente, semearAmbiente } from "../../src/loop/ambiente.js";
import { ehEsquemaAusente, errosDoServidor } from "../../src/loop/flows.js";

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
    expect(await readFile(join(projectRoot, ".env"), "utf8")).toContain("DB_NAME=locadora.db\nPORT=3000\n");
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

describe("o esquema, que é a outra metade do ambiente", () => {
  const manifesto = async (scripts: Record<string, string>) =>
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "app", scripts }), "utf8");

  it("lê o comando que o projeto declara, e não inventa nenhum", async () => {
    await manifesto({ migrate: "node migra.js" });
    expect(await comandoDeMigracao(projectRoot)).toBe("npm run migrate");

    await manifesto({ test: "vitest" });
    expect(await comandoDeMigracao(projectRoot)).toBeNull();
  });

  it("aplica a migração no ambiente que o próprio harness criou", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DB_NAME=app.db\n", "utf8");
    await manifesto({ migrate: "node migra.js" });

    const executados: string[] = [];
    const preparo = await prepararAmbiente(projectRoot, async (comando) => {
      executados.push(comando);
      return { exitCode: 0, output: "" };
    });

    expect(executados).toEqual(["npm run migrate"]);
    expect(preparo.anuncios.join(" ")).toContain("esquema do banco aplicado");
    expect(await ambienteEhDescartavel(projectRoot)).toBe(true);
  });

  it("NÃO migra o .env do desenvolvedor: migração cria e altera esquema", async () => {
    await writeFile(join(projectRoot, ".env"), "DB_URL=postgres://producao/real\n", "utf8");
    await writeFile(join(projectRoot, ".env.example"), "DB_URL=postgres://localhost/x\n", "utf8");
    await manifesto({ migrate: "node migra.js" });

    const executados: string[] = [];
    await prepararAmbiente(projectRoot, async (comando) => {
      executados.push(comando);
      return { exitCode: 0, output: "" };
    });

    expect(executados).toEqual([]);
    expect(await ambienteEhDescartavel(projectRoot)).toBe(false);
  });

  it("migra de novo a cada passagem: cada fase acrescenta tabela", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DB_NAME=app.db\n", "utf8");
    await manifesto({ migrate: "node migra.js" });

    const executados: string[] = [];
    const executar = async (comando: string) => {
      executados.push(comando);
      return { exitCode: 0, output: "" };
    };

    await prepararAmbiente(projectRoot, executar);
    await prepararAmbiente(projectRoot, executar);
    expect(executados).toHaveLength(2);
  });

  it("conta quando a migração falha, com a saída dela", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DB_NAME=app.db\n", "utf8");
    await manifesto({ migrate: "node migra.js" });

    const preparo = await prepararAmbiente(projectRoot, async () => ({ exitCode: 1, output: "SyntaxError na migração" }));
    expect(preparo.migracaoFalhou).toContain("SyntaxError");
    expect(preparo.anuncios.join(" ")).toContain("FALHOU");
  });

  it("marca o ambiente que criou, para reconhecer o próprio depois", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DB_NAME=app.db\n", "utf8");
    await semearAmbiente(projectRoot);
    expect((await readFile(join(projectRoot, ".env"), "utf8")).startsWith(MARCA_DO_HARNESS)).toBe(true);
  });

  it("reconhece esquema ausente em mais de um banco", () => {
    expect(ehEsquemaAusente(["⨯ Error: no such table: clientes"])).toBe(true);
    expect(ehEsquemaAusente(['error: relation "clientes" does not exist'])).toBe(true);
    expect(ehEsquemaAusente(["Error: Table 'app.clientes' doesn't exist"])).toBe(true);
    expect(ehEsquemaAusente(["Error: connect ECONNREFUSED"])).toBe(false);
  });
});
