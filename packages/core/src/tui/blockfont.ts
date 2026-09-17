/**
 * Fonte de blocos para o título.
 *
 * Só as letras que o produto usa. Uma fonte completa seria peso morto num
 * binário que carrega uma dependência de runtime só.
 */

const GLYPHS: Record<string, readonly string[]> = {
  C: [" ███ ", "█    ", "█    ", "█    ", " ███ "],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  V: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  B: ["████ ", "█   █", "████ ", "█   █", "████ "],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  " ": ["  ", "  ", "  ", "  ", "  "],
};

export const BLOCK_FONT_ROWS = 5;

/** Devolve as cinco linhas do texto em blocos; ignora o que não conhece. */
export function blockText(text: string): string[] {
  const letters = [...text.toUpperCase()].map((letter) => GLYPHS[letter]).filter((glyph): glyph is readonly string[] => glyph !== undefined);
  if (letters.length === 0) return Array.from({ length: BLOCK_FONT_ROWS }, () => "");
  return Array.from({ length: BLOCK_FONT_ROWS }, (_, row) => letters.map((glyph) => glyph[row] ?? "").join(" "));
}
