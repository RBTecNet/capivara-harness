/**
 * O `plan` precisa do pedido que o `init` usou — e só ele sabe qual foi.
 *
 * O id do run é o hash do pedido, e é por ele que o `plan` reencontra o
 * esqueleto. Enquanto o `plan` procurava esse texto num `pedido.md` fixo, quem
 * rodasse `capivara init --file docs/prd.txt` — que é o que o próprio wizard
 * monta — ficava parado em "não encontrei o pedido em pedido.md" sem ter feito
 * nada errado.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRequestState, writeRequestState } from "../../src/init/index.js";
import { sha12 } from "../../src/contract/stamps.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-pedido-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const pedido = {
  text: "um controle de gastos pessoais",
  origin: "file" as const,
  path: "docs/prd.txt",
  sha12: sha12("um controle de gastos pessoais"),
};

describe("o registro de qual pedido gerou o esqueleto", () => {
  it("devolve o mesmo pedido, com o mesmo hash — é o hash que reencontra o run", async () => {
    await writeRequestState(projectRoot, pedido);
    const lido = await readRequestState(projectRoot);
    expect(lido).toEqual(pedido);
  });

  it("guarda o caminho de onde o pedido veio, e não exige que seja pedido.md", async () => {
    await writeRequestState(projectRoot, pedido);
    expect((await readRequestState(projectRoot))?.path).toBe("docs/prd.txt");
  });

  /*
   * O hash é recalculado do texto em vez de aceito como veio: é ele que decide
   * qual esqueleto será retomado, e um arquivo editado à mão apontaria o `plan`
   * para o run de outro pedido.
   */
  it("recalcula o hash a partir do texto, ignorando o que estiver gravado", async () => {
    await mkdir(join(projectRoot, ".capivara", "handoffs"), { recursive: true });
    await writeFile(
      join(projectRoot, ".capivara", "handoffs", "pedido.json"),
      JSON.stringify({ ...pedido, sha12: "0000deadbeef" }),
    );
    expect((await readRequestState(projectRoot))?.sha12).toBe(pedido.sha12);
  });

  it("projeto sem registro devolve null, e quem chamou decide o que fazer", async () => {
    expect(await readRequestState(projectRoot)).toBeNull();
  });

  it("registro ilegível devolve null em vez de derrubar o comando", async () => {
    await mkdir(join(projectRoot, ".capivara", "handoffs"), { recursive: true });
    await writeFile(join(projectRoot, ".capivara", "handoffs", "pedido.json"), "isto não é JSON");
    expect(await readRequestState(projectRoot)).toBeNull();
  });

  it("registro sem texto devolve null: um pedido vazio não reencontra run nenhum", async () => {
    await writeRequestState(projectRoot, { ...pedido, text: "   " });
    expect(await readRequestState(projectRoot)).toBeNull();
  });
});
