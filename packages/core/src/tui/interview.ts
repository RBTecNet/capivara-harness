/**
 * A tela da entrevista.
 *
 * Uma pergunta por vez, com a evidência antes da pergunta. Mostrar o que já se
 * sabe é o que separa uma entrevista de um interrogatório: sem isso o
 * desenvolvedor repete o que já está no prompt e perde a paciência antes da
 * terceira pergunta.
 */

import { paint, type Style } from "./ansi.js";
import type { Question } from "../interview/types.js";

export interface QuestionScreen {
  question: Question;
  index: number;
  total: number;
  document: string;
  style: Style;
}

export const BACK = "voltar";

export function renderQuestion(screen: QuestionScreen): string {
  const { question, style } = screen;
  const lines: string[] = [""];

  lines.push(paint(`${screen.document} · pergunta ${screen.index}/${screen.total}`, "gray", style));
  lines.push("");
  lines.push(paint("Já descobri:", "gray", style));
  for (const line of wrap(question.evidence, 76)) lines.push(`  ${line}`);
  lines.push("");
  lines.push(paint(question.decision, "bold", style));
  lines.push("");
  lines.push(paint("Por que importa:", "gray", style));
  for (const line of wrap(question.why, 76)) lines.push(`  ${line}`);

  if (question.options.length > 0) {
    lines.push("");
    question.options.forEach((option, position) => {
      const recommended = option.label === question.recommended;
      const marker = recommended ? paint(" ← recomendada", "green", style) : "";
      lines.push(`  ${paint(String(position + 1), "cyan", style)}. ${option.label}${marker}`);
      for (const line of wrap(option.consequence, 72)) lines.push(`     ${paint(line, "gray", style)}`);
    });
    if (question.recommendationBasis) {
      lines.push("");
      lines.push(paint(`  recomendo porque: ${question.recommendationBasis}`, "gray", style));
    }
  }

  lines.push("");
  lines.push(
    paint(
      question.options.length > 0
        ? `responda com o número, com texto livre, "use as recomendações", "não sei" ou "${BACK}"`
        : `responda com texto livre, "não sei" ou "${BACK}"`,
      "gray",
      style,
    ),
  );
  lines.push("");
  return lines.join("\n");
}

export function wrap(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current !== "") lines.push(current);
    current = "";
  };
  for (const word of words) {
    // Palavra maior que a largura é quebrada à força: deixá-la vazar
    // desalinharia todo o restante da tela.
    if (word.length > width) {
      flush();
      for (let start = 0; start < word.length; start += width) lines.push(word.slice(start, start + width));
      continue;
    }
    if (current === "") current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      flush();
      current = word;
    }
  }
  flush();
  return lines.length > 0 ? lines : [""];
}

/**
 * A mesma pergunta, dobrada para caber dentro do painel.
 *
 * O conteúdo é o de `renderQuestion` — evidência antes da pergunta, opções
 * numeradas, recomendação marcada — só que sem as margens verticais e limitado à
 * largura da moldura, para virar o corpo de uma caixa em vez de uma tela solta.
 */
export function questionBox(screen: QuestionScreen, width: number): { title: string; body: string[] } {
  const { question, style } = screen;
  const inner = Math.max(20, width - 4);
  const body: string[] = [];

  body.push(paint("Já descobri:", "gray", style));
  for (const line of wrap(question.evidence, inner - 2)) body.push(`  ${line}`);
  body.push("");
  for (const line of wrap(question.decision, inner)) body.push(paint(line, "bold", style));
  body.push("");
  body.push(paint("Por que importa:", "gray", style));
  for (const line of wrap(question.why, inner - 2)) body.push(`  ${line}`);

  if (question.options.length > 0) {
    body.push("");
    question.options.forEach((option, position) => {
      const marcada = option.label === question.recommended ? paint(" ← recomendada", "green", style) : "";
      body.push(`  ${paint(String(position + 1), "cyan", style)}. ${option.label}${marcada}`);
      for (const line of wrap(option.consequence, inner - 5)) body.push(`     ${paint(line, "gray", style)}`);
    });
    if (question.recommendationBasis) {
      body.push("");
      for (const line of wrap(`recomendo porque: ${question.recommendationBasis}`, inner - 2)) {
        body.push(`  ${paint(line, "gray", style)}`);
      }
    }
  }

  body.push("");
  body.push(
    paint(
      question.options.length > 0
        ? `responda com o número, com texto livre, "use as recomendações", "não sei" ou "${BACK}"`
        : `responda com texto livre, "não sei" ou "${BACK}"`,
      "gray",
      style,
    ),
  );

  return { title: `PERGUNTA ${screen.index}/${screen.total} · ${screen.document.replace(/\.md$/, "")}`, body };
}
