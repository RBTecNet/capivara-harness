/**
 * As skills no disco, e quais delas cada fase recebe.
 *
 * Duas coisas precisam ser verdade aqui, e as duas custaram discussão para
 * chegar a esta forma. A skill tem que chegar ao executor pelo DISCO, com os
 * caminhos relativos que o próprio SKILL.md cita — senão o build volta a
 * depender de MCP e deixa de funcionar em três das cinco CLIs. E a seleção tem
 * que ser por cruzamento de listas fechadas, porque carregar uma skill de
 * frontend numa fase de banco é contexto pago competindo com o que importa.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ARQUIVO_BASE, SKILLS_DIR, areaDe, areaValida, escolherSkills, materializarSkill, renderSkillBlock } from "../../src/mcp/index.js";
import type { McpDocument } from "../../src/mcp/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-skills-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

function skill(nome: string, area: string, texto = "corpo da skill", files: McpDocument["files"] = []): McpDocument {
  return {
    uri: `capivara://projeto/docs/skill/${nome}`,
    name: nome,
    text: texto,
    kind: "skill",
    area,
    ...(files && files.length > 0 ? { files } : {}),
  };
}

describe("materializar no disco", () => {
  it("escreve a base como SKILL.md e preserva os caminhos das referências", async () => {
    const documento = skill("frontend-design", "frontend", "## Design\n\nConsult references/typography.md", [
      { path: "references/typography.md", content: Buffer.from("# Tipografia"), binary: false },
      { path: "referencias/tela.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), binary: true },
    ]);

    const escrita = await materializarSkill(projectRoot, documento);

    expect(escrita.pasta).toBe(join(SKILLS_DIR, "frontend-design"));
    const base = await readFile(join(projectRoot, escrita.pasta, ARQUIVO_BASE), "utf8");
    expect(base).toContain("Consult references/typography.md");

    // O caminho que o SKILL.md cita é o caminho que existe no disco: é isso que
    // permite ao modelo abrir o arquivo com a ferramenta de leitura de sempre.
    expect(await readFile(join(projectRoot, escrita.pasta, "references/typography.md"), "utf8")).toBe("# Tipografia");

    // Binário chega byte a byte: um print convertido para texto vira lixo.
    const imagem = await readFile(join(projectRoot, escrita.pasta, "referencias/tela.png"));
    expect([...imagem]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  /*
   * Uma skill atualizada que perdeu um arquivo não pode deixar o velho para
   * trás: o SKILL.md novo não o cita, ninguém vai olhar para ele de novo, e ele
   * fica no projeto parecendo conteúdo vivo.
   */
  it("reescrever a skill não deixa arquivo órfão", async () => {
    await materializarSkill(projectRoot, skill("s", "geral", "v1", [
      { path: "references/velho.md", content: Buffer.from("some"), binary: false },
    ]));
    await materializarSkill(projectRoot, skill("s", "geral", "v2", [
      { path: "references/novo.md", content: Buffer.from("fica"), binary: false },
    ]));

    const referencias = await readdir(join(projectRoot, SKILLS_DIR, "s", "references"));
    expect(referencias).toEqual(["novo.md"]);
  });

  it("caminho que escapa da pasta da skill é ignorado", async () => {
    await writeFile(join(projectRoot, "alvo.txt"), "original", "utf8");
    await materializarSkill(projectRoot, skill("s", "geral", "base", [
      { path: "../../../alvo.txt", content: Buffer.from("invadido"), binary: false },
    ]));
    expect(await readFile(join(projectRoot, "alvo.txt"), "utf8")).toBe("original");
  });
});

describe("escolher por área", () => {
  const acervo = [
    skill("frontend-design", "frontend"),
    skill("api-rest", "backend"),
    skill("migrations", "dados"),
    skill("revisar-diff", "geral"),
  ];

  it("a fase recebe a área dela e as gerais, e nada além", () => {
    const selecao = escolherSkills(acervo, ["frontend"]);
    expect(selecao.inteiras.map((documento) => documento.name)).toEqual(["frontend-design", "revisar-diff"]);
    expect(selecao.noIndice.map((documento) => documento.name)).toEqual(["api-rest", "migrations"]);
  });

  it("fase com duas áreas recebe as duas", () => {
    const selecao = escolherSkills(acervo, ["backend", "dados"]);
    expect(selecao.inteiras.map((documento) => documento.name).sort()).toEqual(["api-rest", "migrations", "revisar-diff"]);
  });

  /*
   * Plano escrito antes de o campo existir não declara área. A degradação certa
   * é receber só o que é universal — nada quebra, e o conselho geral continua
   * chegando.
   */
  it("fase sem área declarada recebe só as gerais", () => {
    const selecao = escolherSkills(acervo, []);
    expect(selecao.inteiras.map((documento) => documento.name)).toEqual(["revisar-diff"]);
  });

  it("área inventada não vira campo livre", () => {
    expect(areaValida("Frontend")).toBe("frontend");
    expect(areaValida("mobile")).toBe("geral");
    expect(escolherSkills(acervo, ["mobile"]).inteiras.map((d) => d.name)).toEqual(["revisar-diff"]);
  });

  /*
   * O teto existe porque a área certa também cresce: oito skills de 4 KB são 32
   * KB repetidos a cada ciclo de correção. O que ele corta não desaparece — vai
   * para o índice, e o log diz. Skill escondida em silêncio é pior que ausente.
   */
  it("o teto corta, mas o cortado continua sabido", () => {
    const grandes = [
      skill("a", "frontend", "x".repeat(5000)),
      skill("b", "frontend", "y".repeat(5000)),
      skill("c", "frontend", "z".repeat(5000)),
    ];
    const selecao = escolherSkills(grandes, ["frontend"], { maxBytes: 11_000 });

    expect(selecao.inteiras.map((documento) => documento.name)).toEqual(["a", "b"]);
    expect(selecao.cortadas).toEqual(["c"]);
    expect(selecao.noIndice.map((documento) => documento.name)).toEqual(["c"]);
  });

  it("quando o teto aperta, a específica entra antes da geral", () => {
    const selecao = escolherSkills(
      [skill("geral-grande", "geral", "g".repeat(4000)), skill("da-fase", "frontend", "f".repeat(4000))],
      ["frontend"],
      { maxSkills: 1 },
    );
    expect(selecao.inteiras.map((documento) => documento.name)).toEqual(["da-fase"]);
  });
});

describe("o bloco que vai ao prompt", () => {
  const pastas = new Map([["capivara://projeto/docs/skill/frontend-design", ".capivara/skills/frontend-design"]]);

  it("abre a skill inteira e diz onde estão os arquivos dela", () => {
    const selecao = escolherSkills([skill("frontend-design", "frontend", "## Design\n\nUse escala modular.")], ["frontend"]);
    const bloco = renderSkillBlock(selecao, pastas);

    expect(bloco).toContain("Use escala modular");
    expect(bloco).toContain(".capivara/skills/frontend-design/");
    // O modelo precisa saber COMO ler o resto, não só que ele existe.
    expect(bloco).toContain("ferramenta de leitura");
  });

  it("a que ficou no índice aparece com o caminho, sem o texto", () => {
    const fora = skill("api-rest", "backend", "conteúdo que não deve aparecer");
    const selecao = escolherSkills([fora], ["frontend"]);
    const bloco = renderSkillBlock(selecao, new Map([[fora.uri, ".capivara/skills/api-rest"]]));

    expect(bloco).toContain("api-rest");
    expect(bloco).toContain(".capivara/skills/api-rest/SKILL.md");
    expect(bloco).not.toContain("conteúdo que não deve aparecer");
  });

  it("sem skill nenhuma, não há bloco", () => {
    expect(renderSkillBlock(escolherSkills([], ["frontend"]), new Map())).toBe("");
  });
});

/**
 * A costura entre a descrição que a base escreve e a leitura que o harness faz.
 *
 * Os dois lados tinham teste e a área chegava vazia mesmo assim: a base escrevia
 * "área frontend" com acento, e o padrão do harness usava `\b` antes do "á" —
 * que em JavaScript não casa. Toda skill vinha sem área, e uma fase de banco
 * recebia a skill de frontend. O teste unitário de cada lado passava; a primeira
 * execução real não.
 */
describe("a área atravessa o protocolo", () => {
  it("lê o marcador que a base escreve hoje", () => {
    expect(areaDe("skill · area=frontend · usado pelo projeto Biblioteca")).toBe("frontend");
    expect(areaDe("skill · area=dados · usado pelo projeto X")).toBe("dados");
  });

  it("descrição sem marcador não inventa área", () => {
    expect(areaDe("skill na área geral")).toBe("");
    expect(areaDe("")).toBe("");
  });
});
