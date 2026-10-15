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
import { renderSelect, type SelectSpec, type SelectState } from "./select.js";
import { renderTextField, type TextFieldSpec, type TextFieldState } from "./text-field.js";
import type { Choice } from "./wizard.js";

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

  // Quando a pergunta volta, o que faltou vem ANTES de tudo: é a única novidade
  // desta tela, e quem já respondeu uma vez não relê a evidência.
  if (question.pending && question.pending.trim() !== "") {
    lines.push(paint("Sua resposta foi registrada, mas ficou faltando:", "yellow", style));
    for (const line of wrap(question.pending, 76)) lines.push(paint(`  ${line}`, "yellow", style));
    lines.push("");
  }

  /*
   * Rótulo sem conteúdo não vai para a tela.
   *
   * Toda pergunta do MODELO tem evidência e motivo — o parser recusa sem eles. As
   * do harness nem sempre: o levantamento de auditoria põe as duas leituras dentro
   * das opções, onde a escolha é feita, e não tem o que dizer num bloco "por que
   * importa" além de encher a tela. Um rótulo cinza seguido de nada é ruído, e a
   * tela do levantamento tinha quatro linhas desse tipo antes da primeira opção.
   */
  if (question.evidence.trim() !== "") {
    lines.push(paint("Já descobri:", "gray", style));
    for (const line of wrapKeepingBreaks(question.evidence, 76)) lines.push(`  ${line}`);
    lines.push("");
  }
  lines.push(paint(question.decision, "bold", style));
  if (question.why.trim() !== "") {
    lines.push("");
    lines.push(paint("Por que importa:", "gray", style));
    for (const line of wrap(question.why, 76)) lines.push(`  ${line}`);
  }

  if (question.options.length > 0) {
    lines.push("");
    question.options.forEach((option, position) => {
      const recommended = option.label === question.recommended;
      const marker = recommended ? paint(" ← recomendada", "green", style) : "";
      lines.push(`  ${paint(String(position + 1), "cyan", style)}. ${option.label}${marker}`);
      for (const line of wrapKeepingBreaks(option.consequence, 72)) lines.push(`     ${paint(line, "gray", style)}`);
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

/**
 * Dobra respeitando as quebras que o texto já tem.
 *
 * `wrap` trata tudo como um parágrafo só, e isso apagava a estrutura de uma
 * evidência com lista dentro: o levantamento de auditoria mostra o que o
 * escritor entregou, item por item, e a tela devolvia tudo emendado numa frase —
 * exatamente o que a pergunta existe para separar.
 */
export function wrapKeepingBreaks(value: string, width: number): string[] {
  return value.split("\n").flatMap((linha) => (linha.trim() === "" ? [""] : wrap(linha, width)));
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

  if (question.pending?.trim()) {
    body.push(...wrap("Sua resposta foi registrada, mas ficou faltando:", inner).map((line) => paint(line, "yellow", style)));
    for (const line of wrap(question.pending, inner - 2)) body.push(paint(`  ${line}`, "yellow", style));
    body.push("");
  }

  // O mesmo corte do renderizador acima: rótulo vazio não ocupa linha.
  if (question.evidence.trim() !== "") {
    body.push(paint("Já descobri:", "gray", style));
    for (const line of wrapKeepingBreaks(question.evidence, inner - 2)) body.push(`  ${line}`);
    body.push("");
  }
  for (const line of wrap(question.decision, inner)) body.push(paint(line, "bold", style));
  if (question.why.trim() !== "") {
    body.push("");
    body.push(paint("Por que importa:", "gray", style));
    for (const line of wrap(question.why, inner - 2)) body.push(`  ${line}`);
  }

  if (question.options.length > 0) {
    body.push("");
    question.options.forEach((option, position) => {
      body.push(...optionLabelLines(question, position, inner, style));
      for (const line of wrapKeepingBreaks(option.consequence, inner - 5)) body.push(`     ${paint(line, "gray", style)}`);
    });
    if (question.recommendationBasis) {
      body.push("");
      for (const line of wrap(`recomendo porque: ${question.recommendationBasis}`, inner - 2)) {
        body.push(`  ${paint(line, "gray", style)}`);
      }
    }
  }

  body.push("");
  const instruction = question.options.length > 0
    ? `responda com o número, com texto livre, "use as recomendações", "não sei" ou "${BACK}"`
    : `responda com texto livre, "não sei" ou "${BACK}"`;
  body.push(...wrap(instruction, inner).map((line) => paint(line, "gray", style)));

  return { title: `PERGUNTA ${screen.index}/${screen.total} · ${screen.document.replace(/\.md$/, "")}`, body };
}

function optionLabelLines(question: Question, position: number, width: number, style: Style): string[] {
  const option = question.options[position]!;
  const recommended = option.label === question.recommended;
  const prefix = `  ${position + 1}. `;
  const lines = wrapKeepingBreaks(`${option.label}${recommended ? " ← recomendada" : ""}`, Math.max(1, width - prefix.length));
  return lines.map((line, index) => `${index === 0 ? paint(prefix, "cyan", style) : " ".repeat(prefix.length)}${recommended ? paint(line, "green", style) : line}`);
}

/** Repete a decisão perto da entrada quando a pergunta ultrapassa a tela. */
export function renderAnswerContext(screen: QuestionScreen, width: number): string {
  const { question, style } = screen;
  const inner = Math.max(20, width - 4);
  return [
    "",
    paint(`Para responder · pergunta ${screen.index}/${screen.total}:`, "cyan", style),
    ...wrap(question.decision, inner).map((line) => paint(line, "bold", style)),
    ...question.options.flatMap((_, index) => optionLabelLines(question, index, inner, style)),
    "",
  ].join("\n");
}

/**
 * As saídas de uma pergunta da entrevista, como linhas de uma lista.
 *
 * Cada linha devolve a MESMA string que a resposta digitada devolveria — o
 * número da opção, `não sei`, ou vazio no prompt-engineer — para o classificador
 * não saber, nem precisar saber, que a resposta veio de uma lista. `null` é o
 * texto livre: a lista abre um campo, e o que for escrito ali segue como hoje.
 */
export interface InterviewChoices {
  spec: SelectSpec;
  answers: readonly (string | null)[];
}

export function interviewChoices(question: Question, options: { leaveOpen?: boolean } = {}): InterviewChoices {
  const choices: Choice[] = question.options.map((option) => ({
    label: `${option.label}${option.label === question.recommended ? " ← recomendada" : ""}`,
  }));
  const answers: (string | null)[] = question.options.map((_, index) => String(index + 1));
  choices.push({ label: "responder com texto livre", hint: "o que nenhuma opção cobre, ou uma combinação delas" });
  answers.push(null);
  if (options.leaveOpen) {
    choices.push({ label: "deixar em aberto", hint: "o prompt registra a dúvida sem decidir" });
    answers.push("");
  } else {
    choices.push({ label: "não sei", hint: "fica em aberto para decidir depois" });
    answers.push("não sei");
  }
  const recommended = question.options.findIndex((option) => option.label === question.recommended);
  return { spec: { title: question.decision, choices, defaultIndex: recommended >= 0 ? recommended : 0 }, answers };
}

export type InterviewInput =
  | { kind: "select"; choices: InterviewChoices; state: SelectState }
  | { kind: "text"; spec: TextFieldSpec; state: TextFieldState };

/**
 * A pergunta com a resposta DENTRO da caixa, para a entrada por tecla.
 *
 * O conteúdo é o de `questionBox`, menos a lista numerada e a instrução de
 * digitar: no lugar delas fica a lista com cursor, ou o campo de texto. A
 * consequência aparece só para a opção sob o cursor — repetida para todas, ela
 * empurrava a lista para fora da tela numa pergunta de quatro opções.
 *
 * `maxBody` é a altura que sobra no terminal. Uma caixa maior que a tela faz
 * cada redesenho — a cada tecla e a cada pulso — empurrar a sobra para o
 * histórico do terminal, duplicada. O "por que importa" cede primeiro e a
 * evidência depois — mostrar o que já se sabe é o que separa a entrevista de um
 * interrogatório (ver o topo deste arquivo); a decisão e a resposta nunca.
 */
export function interactiveQuestionBox(
  screen: QuestionScreen,
  width: number,
  input: InterviewInput,
  maxBody = Infinity,
): { title: string; body: string[] } {
  const { question, style } = screen;
  const inner = Math.max(20, width - 4);

  const pending: string[] = [];
  if (question.pending?.trim()) {
    pending.push(...wrap("Sua resposta foi registrada, mas ficou faltando:", inner).map((line) => paint(line, "yellow", style)));
    for (const line of wrap(question.pending, inner - 2)) pending.push(paint(`  ${line}`, "yellow", style));
    pending.push("");
  }
  const decision = wrap(question.decision, inner).map((line) => paint(line, "bold", style));
  const evidence = question.evidence.trim() === "" ? [] : wrapKeepingBreaks(question.evidence, inner - 2).map((line) => `  ${line}`);
  const why = question.why.trim() === "" ? [] : wrap(question.why, inner - 2).map((line) => `  ${line}`);

  const answer: string[] = [""];
  const keys = (text: string): string[] => ["", ...wrap(text, inner).map((line) => paint(line, "gray", style))];
  if (input.kind === "select") {
    const fixedRows = pending.length + decision.length + 6;
    const listRows = Math.max(4, Math.min(input.choices.spec.choices.length + 1, maxBody - fixedRows - 3));
    answer.push(...renderSelect(input.choices.spec, input.state, inner, listRows, style));
    const option = question.options[input.state.cursor];
    if (option) {
      for (const line of wrapKeepingBreaks(option.consequence, inner - 5)) answer.push(`   ${paint(`↳ ${line}`, "gray", style)}`);
      if (option.label === question.recommended && question.recommendationBasis) {
        for (const line of wrap(`recomendo porque: ${question.recommendationBasis}`, inner - 5)) answer.push(`     ${paint(line, "gray", style)}`);
      }
    }
    answer.push(...keys("↑ ↓ move · número leva à opção · Enter confirma"));
  } else {
    answer.push(paint("Sua resposta:", "cyan", style));
    answer.push(...renderTextField(input.spec, input.state, inner, 4, style));
    answer.push(...keys(input.spec.cancelable ? "Enter envia · Esc volta às opções" : "Enter envia · Enter vazio deixa para decidir depois"));
  }

  const build = (evidenceShown: string[], whyShown: string[]): string[] => [
    ...pending,
    ...(evidenceShown.length > 0 ? [paint("Já descobri:", "gray", style), ...evidenceShown, ""] : []),
    ...decision,
    ...(whyShown.length > 0 ? ["", paint("Por que importa:", "gray", style), ...whyShown] : []),
    ...answer,
  ];

  let evidenceShown = evidence;
  let whyShown = why;
  let body = build(evidenceShown, whyShown);
  if (body.length > maxBody && why.length > 0) {
    whyShown = [];
    body = build(evidenceShown, whyShown);
  }
  if (body.length > maxBody && evidence.length > 0) {
    // A evidência encolhe até caber, e diz quanto ficou de fora; se nada dela
    // couber, sai com o rótulo — rótulo sem conteúdo é ruído.
    const keep = Math.max(0, evidence.length - (body.length - maxBody) - 1);
    evidenceShown = keep > 0 ? [...evidence.slice(0, keep), paint(`  … mais ${evidence.length - keep} linha(s)`, "gray", style)] : [];
    body = build(evidenceShown, whyShown);
  }

  return { title: `PERGUNTA ${screen.index}/${screen.total} · ${screen.document.replace(/\.md$/, "")}`, body };
}
