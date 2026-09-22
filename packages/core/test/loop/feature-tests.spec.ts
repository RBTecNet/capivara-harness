/**
 * A busca dos nomes na árvore de verdade.
 *
 * É a metade mecânica do gate 3: a que não muda de opinião entre um ciclo e o
 * seguinte. Na fase 4 do MCP_teste o mesmo verificador aprovou a task 6 no
 * ciclo 1 e a reprovou no ciclo 2, sobre o mesmo código — dois buracos reais,
 * achados um por ciclo.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { procurarTestesNomeados } from "../../src/loop/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-nomeados-"));
  await mkdir(join(projectRoot, "tests"), { recursive: true });
  await writeFile(
    join(projectRoot, "tests", "21-locacoes.spec.ts"),
    'test("consulta_preserva_contratacao", async () => {});\n',
    "utf8",
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const nomes = [
  { task: 6, name: "consulta_sem_sessao" },
  { task: 6, name: "consulta_preserva_contratacao" },
];

describe("procurar os testes nomeados", () => {
  it("diz qual nome existe na árvore e qual não existe", async () => {
    expect(await procurarTestesNomeados(projectRoot, nomes)).toEqual([
      { task: 6, name: "consulta_sem_sessao", found: false },
      { task: 6, name: "consulta_preserva_contratacao", found: true },
    ]);
  });

  /*
   * Um `node_modules` de projeto real tem dezenas de milhares de arquivos, e um
   * deles pode conter qualquer string. Varrê-lo custaria minutos e ainda daria
   * a resposta errada.
   */
  it("não procura dentro de node_modules nem de .capivara", async () => {
    for (const pasta of ["node_modules", ".capivara"]) {
      await mkdir(join(projectRoot, pasta, "x"), { recursive: true });
      await writeFile(join(projectRoot, pasta, "x", "a.ts"), "consulta_sem_sessao", "utf8");
    }

    const achados = await procurarTestesNomeados(projectRoot, nomes);
    expect(achados.find((teste) => teste.name === "consulta_sem_sessao")?.found).toBe(false);
  });

  it("sem nomes, não varre nada e devolve vazio", async () => {
    expect(await procurarTestesNomeados(projectRoot, [])).toEqual([]);
  });

  it("árvore inexistente não derruba o gate: devolve todos como ausentes", async () => {
    const achados = await procurarTestesNomeados(join(projectRoot, "nao-existe"), nomes);
    expect(achados.every((teste) => !teste.found)).toBe(true);
  });
});
