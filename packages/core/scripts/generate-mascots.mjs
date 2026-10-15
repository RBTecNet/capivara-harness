/**
 * Gera src/tui/mascots-data.ts a partir dos desenhos aprovados em docs/mascote/.
 *
 * Os `.ans` são saída do chafa, renderizados uma vez e guardados como texto: o
 * runtime não depende do chafa nem de imagem nenhuma. Como cada um foi refeito,
 * e a partir de qual imagem, está em docs/mascote/LEIA.md.
 *
 * Só códigos de cor (SGR) entram. Qualquer outro comando de terminal no arquivo
 * — mover cursor, esconder cursor — faz o script falhar, porque no painel ele
 * deslocaria todo o resto do desenho.
 */
import { readFile, writeFile } from "node:fs/promises";

/*
 * Hoje todos os estágios usam a capivara de capacete. As outras tentativas
 * (variante B, cabeças, adesivo) ficaram grandes demais ou ilegíveis no
 * terminal e estão registradas em docs/mascote/LEIA.md. Para dar a um estágio
 * um desenho próprio, basta apontá-lo para outro arquivo aqui.
 */
const SOURCES = {
  init: "build-busto-40x13.ans",
  plan: "build-busto-40x13.ans",
  build: "build-busto-40x13.ans",
};

const ESC = "\u001B";
const RESET = `${ESC}[0m`;
const anyControl = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const sgr = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

// Cada arquivo entra uma vez; estágios que apontam para o mesmo desenho o compartilham.
const arts = [];
const files = [...new Set(Object.values(SOURCES))];
for (const [index, file] of files.entries()) {
  const text = await readFile(new URL(`../../../docs/mascote/${file}`, import.meta.url), "utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);

  for (const line of lines) {
    const foreign = (line.match(anyControl) ?? []).filter((code) => !code.endsWith("m") || code.includes("?"));
    if (foreign.length > 0) throw new Error(`${file}: comando de terminal que não é cor: ${JSON.stringify(foreign[0])}`);
    if (!line.endsWith(RESET)) throw new Error(`${file}: linha sem reset no fim; a cor vazaria para a próxima`);
  }

  const widths = new Set(lines.map((line) => line.replace(sgr, "").length));
  if (widths.size !== 1) throw new Error(`${file}: linhas de larguras diferentes (${[...widths].join(", ")})`);

  arts.push(`/** ${file} */\nconst ART_${index}: readonly string[] = [\n${lines.map((line) => `  ${JSON.stringify(line)},`).join("\n")}\n];`);
}

const entries = Object.entries(SOURCES).map(
  ([stage, file]) => `  ${stage}: { source: ${JSON.stringify(file)}, lines: ART_${files.indexOf(file)} },`,
);

const output = `/**
 * As mascotes, uma por estágio.
 *
 * GERADO por scripts/generate-mascots.mjs a partir de docs/mascote/ — não editar
 * à mão. Para trocar um desenho, troque o \`.ans\` e rode o script.
 */

${arts.join("\n\n")}

export const MASCOT_ART = {
${entries.join("\n")}
} as const;
`;

const target = new URL("../src/tui/mascots-data.ts", import.meta.url);
await writeFile(target, output, "utf8");
console.log(`escrito: ${target.pathname}`);
