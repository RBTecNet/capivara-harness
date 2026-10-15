/**
 * A tela do wizard quando há uma pessoa no terminal.
 *
 * O wizard de linha imprimia uma pergunta embaixo da outra: quem chegava na
 * escolha do modelo do verificador já não via o que tinha escolhido para o
 * escritor, e a tela não se parecia em nada com o painel que vinha depois. Aqui
 * as escolhas ficam na mesma moldura do painel — a capivara e o título em cima,
 * o que já foi respondido numa caixa, a pergunta da vez em outra, e as teclas no
 * rodapé.
 *
 * Função pura sobre um modelo, como o painel: quem liga isto ao terminal é
 * `commands/key-io.ts`.
 */

import { paint, truncateVisible, type Style } from "./ansi.js";
import { box, header } from "./dashboard.js";
import { wrap } from "./interview.js";
import { renderSelect, type SelectSpec, type SelectState } from "./select.js";
import { renderTextField, type TextFieldSpec, type TextFieldState } from "./text-field.js";

export type WizardPrompt =
  | { kind: "select"; spec: SelectSpec; state: SelectState }
  | { kind: "text"; spec: TextFieldSpec; state: TextFieldState };

export interface WizardScreenModel {
  version: string;
  subtitle: string;
  /** O que já foi respondido, na ordem. */
  history: readonly { question: string; answer: string }[];
  /** O que o wizard disse desde a última resposta: avisos, erros, o comando montado. */
  notes: readonly string[];
  prompt: WizardPrompt;
  width: number;
  height?: number;
  style: Style;
  environment?: NodeJS.ProcessEnv;
}

const KEYS = {
  select: "↑ ↓ move · número leva à opção · Enter confirma · Ctrl-C sai",
  text: "Enter confirma · Ctrl-U apaga · Ctrl-C sai",
  multiline: "Enter quebra a linha · uma linha só com . ou Ctrl-D termina · Ctrl-C sai",
} as const;

/** Uma pergunta do wizard chega com a pontuação do modo de linha: `\nPasta [x]: `. */
export function cleanPrompt(prompt: string): string {
  return prompt.trim().replace(/\s*\[[^\]]*\]\s*:?\s*$/, "").replace(/:\s*$/, "").trim();
}

export function renderWizardScreen(model: WizardScreenModel): string {
  const width = Math.max(20, model.width);
  const inner = width - 2;
  const budget = model.height === undefined ? Infinity : Math.max(8, model.height - 1);
  const { style } = model;

  const keys = model.prompt.kind === "select" ? KEYS.select : model.prompt.spec.multiline ? KEYS.multiline : KEYS.text;
  const footer = paint(truncateVisible(keys, width), "gray", style);

  const title = model.prompt.kind === "select" ? model.prompt.spec.title : model.prompt.spec.label;
  const question = wrap(cleanPrompt(title), inner - 2).map((line) => ` ${paint(line, "bold", style)}`);
  const notes = model.notes
    .flatMap((note) => note.split("\n"))
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
  while (notes.length > 0 && notes[0] === "") notes.shift();
  while (notes.length > 0 && notes[notes.length - 1] === "") notes.pop();

  /*
   * A altura se reparte do que mais importa para o que menos: a pergunta e suas
   * opções primeiro, depois o que o wizard acabou de dizer, depois o histórico,
   * e a capivara só se ainda sobrar.
   */
  const fixed = 2 + question.length + 1; // moldura + pergunta + linha em branco
  const optionsWanted =
    model.prompt.kind === "select"
      ? model.prompt.spec.choices.length + 1 + (model.prompt.state.message ? 1 : 0)
      : model.prompt.spec.multiline
        ? Math.max(4, model.prompt.state.value.split("\n").length)
        : 1;
  const headerModel = {
    version: model.version,
    command: "init",
    subtitle: model.subtitle,
    style,
    ...(model.environment !== undefined ? { environment: model.environment } : {}),
  };
  const plainHeader = header(headerModel, width, false);
  let room = budget - fixed - 1 - plainHeader.length; // rodapé
  const optionsRows = Math.max(3, Math.min(optionsWanted, room));
  room -= optionsRows;

  const notesShown = notes.slice(-Math.max(0, Math.min(notes.length, room - 1)));
  room -= notesShown.length + (notesShown.length > 0 ? 1 : 0);

  const historyRows = Math.max(0, Math.min(model.history.length, room - 2));
  room -= historyRows > 0 ? historyRows + 2 : 0;

  const artwork = header(headerModel, width, true);
  const top = artwork.length - plainHeader.length <= room ? artwork : plainHeader;

  const lines: string[] = [...top];

  if (historyRows > 0) {
    const shown = model.history.slice(-historyRows);
    const labelWidth = Math.min(34, Math.max(...shown.map((item) => cleanPrompt(item.question).length)));
    lines.push(
      ...box(
        model.history.length > historyRows ? `SUAS ESCOLHAS · últimas ${historyRows} de ${model.history.length}` : "SUAS ESCOLHAS",
        shown.map((item) => {
          const label = truncateVisible(cleanPrompt(item.question), labelWidth).padEnd(labelWidth);
          return ` ${paint(label, "cyan", style)}  ${item.answer.split("\n")[0] ?? ""}`;
        }),
        width,
        style,
      ),
    );
  }

  const body: string[] = [];
  if (notesShown.length > 0) {
    body.push(...notesShown.map((line) => ` ${paint(line, "gray", style)}`), "");
  }
  body.push(...question, "");
  if (model.prompt.kind === "select") {
    body.push(...renderSelect(model.prompt.spec, model.prompt.state, inner, optionsRows, style));
  } else {
    body.push(...renderTextField(model.prompt.spec, model.prompt.state, inner, optionsRows, style));
  }
  lines.push(...box(model.prompt.kind === "select" ? "ESCOLHA" : "RESPOSTA", body, width, style));
  lines.push(footer);

  return lines.map((line) => truncateVisible(line, width)).join("\n");
}
