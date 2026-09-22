/**
 * As dependências do próprio projeto, conferidas antes de gastar um ciclo.
 *
 * A fase 1 do MCP_teste2 queimou os três ciclos assim: o manifesto pedia `tsx`,
 * o `node_modules` não existia, o `npm test` morria sem achar o pacote, e o
 * executor — que não tem permissão de shell para instalar — acabou reescrevendo
 * o comando de teste do projeto para não precisar dele. Defeito de ambiente
 * virando mudança de produto, que é o que o §34.8 existe para impedir.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVISO_DO_RUNNER, dependenciasAusentes, descreverDependencias, faltaORunnerDeFluxos } from "../../src/loop/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-deps-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const manifesto = (conteudo: Record<string, unknown>) =>
  writeFile(join(projectRoot, "package.json"), JSON.stringify(conteudo), "utf8");

describe("as dependências declaradas estão instaladas?", () => {
  it("manifesto com dependência e sem node_modules é o caso do MCP_teste2", async () => {
    await manifesto({ name: "locadora", devDependencies: { tsx: "^4.20.5" } });

    const ausentes = await dependenciasAusentes(projectRoot);
    expect(ausentes).toEqual([{ manifesto: "package.json", pasta: "node_modules", comando: "npm install" }]);
  });

  it("com node_modules, nada a dizer", async () => {
    await manifesto({ name: "locadora", dependencies: { next: "^15" } });
    await mkdir(join(projectRoot, "node_modules"), { recursive: true });

    expect(await dependenciasAusentes(projectRoot)).toEqual([]);
  });

  /*
   * Um projeto que não declara dependência nenhuma não precisa instalar nada, e
   * exigir `node_modules` dele seria bloquear um build perfeitamente válido.
   */
  it("manifesto sem dependência nenhuma não exige instalação", async () => {
    await manifesto({ name: "sozinho", scripts: { test: "node --test" } });
    expect(await dependenciasAusentes(projectRoot)).toEqual([]);
  });

  it("projeto sem manifesto conhecido não é conferido", async () => {
    await writeFile(join(projectRoot, "go.mod"), "module x\n", "utf8");
    expect(await dependenciasAusentes(projectRoot)).toEqual([]);
  });

  it("manifesto ilegível não vira bloqueio: quem decide sobre ele é outro gate", async () => {
    await writeFile(join(projectRoot, "package.json"), "{ isto não é json", "utf8");
    expect(await dependenciasAusentes(projectRoot)).toEqual([]);
  });

  it("composer também, porque `vendor/` prova a mesma coisa", async () => {
    await rm(join(projectRoot, "package.json"), { force: true });
    await writeFile(join(projectRoot, "composer.json"), JSON.stringify({ require: { "laravel/framework": "^11" } }), "utf8");

    const ausentes = await dependenciasAusentes(projectRoot);
    expect(ausentes[0]?.comando).toBe("composer install");
  });

  /*
   * A mensagem não manda ninguém preparar o ambiente: instalar é trabalho do
   * executor, e o harness existe para que ele consiga sozinho. O que ela faz é
   * dizer o que vem pela frente e qual é o remédio se a CLI recusar o comando.
   */
  it("a mensagem diz quem resolve, e o que fazer quando não der", () => {
    const texto = descreverDependencias([{ manifesto: "package.json", pasta: "node_modules", comando: "npm install" }]);

    expect(texto).toContain("não estão instaladas");
    expect(texto).toContain("O executor instala na primeira sessão");
    expect(texto).toContain("não por defeito do código");
  });

  it("sem ausências, não há mensagem", () => {
    expect(descreverDependencias([])).toBe("");
  });
});

/**
 * O runner de fluxos é ferramenta do harness e mora no projeto.
 *
 * O gate 4 resolve `@playwright/test` a partir do projeto — é o que faz o
 * roteiro rodar com as dependências que o produto realmente tem. No MCP_teste2
 * a falta dele só apareceu no gate 4 da fase 2, com a aplicação pronta e o
 * roteiro escrito, e custou um ciclo inteiro.
 */
describe("o runner que o gate 4 usa", () => {
  const COM_FLUXO = "## Fluxos\n\n### workflow 1 — Cadastrar cliente\n- abre a tela\n";

  it("falta quando o esqueleto declara fluxo e o pacote não está instalado", async () => {
    expect(await faltaORunnerDeFluxos(projectRoot, COM_FLUXO)).toBe(true);
  });

  it("não falta quando está instalado", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(projectRoot, "node_modules", "@playwright", "test"), { recursive: true });
    expect(await faltaORunnerDeFluxos(projectRoot, COM_FLUXO)).toBe(false);
  });

  /*
   * Sem fluxo declarado o gate 4 não roda, e exigir o runner seria cobrar uma
   * dependência que o projeto não vai usar.
   */
  it("esqueleto sem fluxo nenhum não exige o runner", async () => {
    expect(await faltaORunnerDeFluxos(projectRoot, "## Fases\n- Phase 1: X\n")).toBe(false);
  });

  it("o aviso diz o custo e as duas saídas", () => {
    expect(AVISO_DO_RUNNER).toContain("custa um ciclo");
    expect(AVISO_DO_RUNNER).toContain("--no-flows");
  });
});
