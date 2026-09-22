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
import { dependenciasAusentes, descreverDependencias } from "../../src/loop/index.js";

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

  it("a mensagem diz o que falta, por que importa e o que rodar", () => {
    const texto = descreverDependencias([{ manifesto: "package.json", pasta: "node_modules", comando: "npm install" }]);

    expect(texto).toContain("não estão instaladas");
    expect(texto).toContain("não por defeito do código");
    expect(texto).toContain("npm install");
  });

  it("sem ausências, não há mensagem", () => {
    expect(descreverDependencias([])).toBe("");
  });
});
