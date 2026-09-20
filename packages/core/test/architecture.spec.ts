/**
 * Os testes que protegem a tese do produto contra quem o implementa.
 *
 * O contrato só permanece único enquanto nenhum outro módulo recriar a
 * gramática por conta própria. É fácil demais, no meio de uma fase futura,
 * escrever um `/^## Phase/` no divisor do loop "só para ir rápido" — e é
 * exatamente assim que o harness e o ralph voltam a divergir.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLI_ADAPTERS, CLI_CATALOG, CLI_PROVIDERS } from "../src/provider/index.js";
import { INVARIANTS } from "../src/contract/index.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const CONTRACT = join(SRC, "contract");
const PACKAGE = new URL("../package.json", import.meta.url);

/** Marcadores que só o módulo do contrato pode conhecer. */
const GRAMMAR_MARKERS = [
  "## Phase",
  "### Phase",
  "**Task:**",
  "**Acceptance criteria:**",
  "**Feature tests:**",
  "**Design ref:**",
  "**Traces:**",
  "**Goal:**",
  "<!-- inputs:",
];

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await typescriptFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("arquitetura", () => {
  it("nenhum módulo fora de src/contract/ conhece a gramática de fases", async () => {
    const files = (await typescriptFiles(SRC)).filter((file) => !file.startsWith(CONTRACT));
    const violations: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      for (const marker of GRAMMAR_MARKERS) {
        if (content.includes(marker)) violations.push(`${file.slice(SRC.length + 1)} contém "${marker}"`);
      }
    }
    expect(violations, "a gramática pertence a src/contract/; importe parsePhases em vez de recriá-la").toEqual([]);
  });

  it("src/contract/ não está vazio — o teste acima precisa ter o que proteger", async () => {
    const files = await typescriptFiles(CONTRACT);
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("cada CLI tem id e variável de binário próprios", () => {
    const ids = CLI_ADAPTERS.map((adapter) => adapter.id);
    const variaveis = CLI_ADAPTERS.map((adapter) => adapter.binaryEnv);
    expect(new Set(ids).size, "dois adaptadores com o mesmo id").toBe(ids.length);
    expect(new Set(variaveis).size, "dois adaptadores apontando para a mesma variável").toBe(variaveis.length);
  });

  it("a lista de providers e o catálogo nascem dos adaptadores, não de cópias", () => {
    // Duas listas do mesmo conjunto divergem, e a que ninguém atualiza é sempre
    // a que o usuário lê.
    expect([...CLI_PROVIDERS]).toEqual(CLI_ADAPTERS.map((adapter) => adapter.id));
    expect(CLI_CATALOG.map((provider) => provider.id)).toEqual(CLI_ADAPTERS.map((adapter) => adapter.id));
  });

  it("todo adaptador monta uma chamada para cada nível de acesso", () => {
    for (const adapter of CLI_ADAPTERS) {
      for (const access of ["read-only", "workspace", "system"] as const) {
        const built = adapter.build({
          projectRoot: "/projeto",
          model: "",
          effort: "",
          access,
          binary: adapter.defaultBinary || "meu-adapter",
          env: {},
          command: "/usr/local/bin/meu-adapter",
        });
        expect(Array.isArray(built.args), `${adapter.id} não devolveu args`).toBe(true);
      }
    }
  });

  it("commander é a única dependência de runtime", async () => {
    const pkg = JSON.parse(await readFile(PACKAGE, "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["commander"]);
  });

  it("todo invariante registrado é implementado por algum módulo do contrato", async () => {
    const files = await typescriptFiles(CONTRACT);
    const implementation = (
      await Promise.all(
        files
          .filter((file) => !file.endsWith("invariants.ts") && !file.endsWith("doc.ts"))
          .map((file) => readFile(file, "utf8")),
      )
    ).join("\n");
    const missing = INVARIANTS.filter(
      (item) => item.enforcement === "rejects" && !implementation.includes(`"${item.code}"`),
    ).map((item) => item.code);
    expect(missing, "invariante registrado mas nunca reportado por nenhum validador").toEqual([]);
  });
});

/**
 * `init` e `plan` são o mesmo orquestrador com estágios diferentes, e por isso
 * têm a mesma superfície interativa. Enquanto cada comando montava a sua, só o
 * `init` ganhou painel: o `plan` — o estágio LONGO, dezenas de chamadas contra
 * uma — escrevia linhas soltas e ficava minutos calado dentro de cada fase.
 *
 * Duas cópias divergem na primeira correção aplicada a uma só. Este teste existe
 * para que a próxima melhoria de painel chegue nos dois sem ninguém lembrar.
 */
describe("os dois estágios do ciclo mostram a mesma coisa", () => {
  const cliProgram = async (): Promise<string> => readFile(join(SRC, "cli-program.ts"), "utf8");

  /*
   * Dois painéis, não três: `init` e `plan` compartilham um, e o `build` tem o
   * seu porque a caixa dele é outra — as FASES do plano executável, com os
   * gates de cada uma, no lugar do pipeline da documentação. O que não pode
   * voltar a existir é uma cópia por comando dentro do ciclo de documentação.
   */
  it("o painel da documentação é construído num lugar só", async () => {
    const fonte = await cliProgram();
    expect(fonte.split("new HarnessProgress(").length - 1).toBe(2);
    expect(fonte.split("createLiveRegion(").length - 1).toBe(2);
  });

  it("init e plan usam esse lugar", async () => {
    const fonte = await cliProgram();
    for (const estagio of ["init", "plan"]) {
      expect(fonte).toContain(`estagioInterativo({\n      estagio: "${estagio}",`);
    }
  });

  it("todo comando que desenha aceita desligar o painel, para pipe, arquivo e CI", async () => {
    const fonte = await cliProgram();
    expect(fonte.split('"--no-dashboard"').length - 1).toBe(3);
  });
});
