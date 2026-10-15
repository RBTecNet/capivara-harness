/**
 * A lista de escolha navegável.
 *
 * Substitui o "digite o número" quando há uma pessoa no terminal. As duas
 * regras que tornaram o wizard numérico continuam valendo, só que por outro
 * caminho:
 *
 * - **colagem não é resposta.** A colagem chega marcada (ver `keys.ts`) e a
 *   lista a recusa com um aviso. O defeito antigo era a primeira linha de um
 *   pedido colado ser lida como a escolha;
 * - **número continua escolhendo.** Quem decorou "3 é build" digita 3 — só que
 *   o número MOVE o cursor e o Enter confirma. Um dígito que confirmasse sozinho
 *   faria tecla perdida virar decisão, que é o defeito que o `line-io` existe
 *   para impedir.
 *
 * Função pura sobre um estado: o teste pergunta ao texto, e quem liga isto ao
 * terminal (`commands/key-io.ts`) só entrega as teclas.
 */

import { paint, truncateVisible, type Style } from "./ansi.js";
import type { Key } from "./keys.js";
import type { Choice } from "./wizard.js";

export interface SelectSpec {
  title: string;
  choices: readonly Choice[];
  /**
   * A opção em que o cursor começa e que o Enter aceita de imediato.
   *
   * Negativo, com `keepLabel`, é "manter o que já está": uma linha a mais, no
   * topo e sem número, para não deslocar a numeração das opções — no menu de
   * papel, o mesmo número significa o mesmo provider em todas as telas.
   */
  defaultIndex: number;
  keepLabel?: string;
  /** Esc desiste da lista: quem abriu recebe `cancelled` em vez de uma opção. */
  cancelable?: boolean;
}

export interface SelectState {
  /** Linha sob o cursor; com `keepLabel`, a linha 0 é a de manter. */
  cursor: number;
  /** Dígitos digitados em sequência, para chegar à opção 12. */
  digits: string;
  message: string | null;
}

export type SelectStep = { state: SelectState; chosen?: number; cancelled?: true };

function hasKeep(spec: SelectSpec): boolean {
  return spec.keepLabel !== undefined && spec.defaultIndex < 0;
}

function rowCount(spec: SelectSpec): number {
  return spec.choices.length + (hasKeep(spec) ? 1 : 0);
}

function rowOfChoice(spec: SelectSpec, index: number): number {
  return index + (hasKeep(spec) ? 1 : 0);
}

/** O que a linha devolve: o índice da opção, ou `defaultIndex` na linha de manter. */
function valueOfRow(spec: SelectSpec, row: number): number {
  if (hasKeep(spec)) return row === 0 ? spec.defaultIndex : row - 1;
  return row;
}

export function initialSelect(spec: SelectSpec): SelectState {
  const cursor = hasKeep(spec) ? 0 : rowOfChoice(spec, Math.min(Math.max(0, spec.defaultIndex), Math.max(0, spec.choices.length - 1)));
  return { cursor, digits: "", message: null };
}

export function reduceSelect(spec: SelectSpec, state: SelectState, key: Key): SelectStep {
  const rows = rowCount(spec);
  const move = (cursor: number): SelectStep => ({
    state: { cursor: ((cursor % rows) + rows) % rows, digits: "", message: null },
  });

  switch (key.type) {
    case "up":
      return move(state.cursor - 1);
    case "down":
    case "tab":
      return move(state.cursor + 1);
    case "home":
      return move(0);
    case "end":
      return move(rows - 1);
    case "pageup":
      return { state: { cursor: Math.max(0, state.cursor - 5), digits: "", message: null } };
    case "pagedown":
      return { state: { cursor: Math.min(rows - 1, state.cursor + 5), digits: "", message: null } };
    case "enter":
      return { state: { ...state, digits: "" }, chosen: valueOfRow(spec, state.cursor) };
    case "escape":
      return spec.cancelable ? { state, cancelled: true } : { state };
    case "paste":
      return {
        state: {
          ...state,
          digits: "",
          message: "Colagem ignorada: aqui é uma escolha. Use ↑ ↓ e Enter; o texto é pedido na pergunta seguinte.",
        },
      };
    case "char": {
      if (!/^\d$/.test(key.text)) {
        return { state: { ...state, digits: "", message: `Use ↑ ↓ ou o número da opção, de 1 a ${spec.choices.length}, e Enter.` } };
      }
      // "1" e depois "2" leva à 12 quando ela existe; senão o dígito novo recomeça.
      const accumulated = `${state.digits}${key.text}`;
      const candidates = [accumulated, key.text];
      for (const digits of candidates) {
        const number = Number(digits);
        if (number >= 1 && number <= spec.choices.length) {
          return { state: { cursor: rowOfChoice(spec, number - 1), digits, message: null } };
        }
      }
      return { state: { ...state, digits: "", message: `${key.text} não é uma das opções: são de 1 a ${spec.choices.length}.` } };
    }
    default:
      return { state };
  }
}

/**
 * A lista desenhada, cabendo em `maxRows` linhas.
 *
 * Uma lista maior que a janela rola com o cursor, e diz quanto ficou acima e
 * abaixo — opção que some sem aviso é opção que ninguém escolhe.
 */
export function renderSelect(spec: SelectSpec, state: SelectState, width: number, maxRows: number, style: Style): string[] {
  const rows = rowCount(spec);
  const room = Math.max(3, maxRows - (state.message ? 1 : 0));
  let start = 0;
  let end = rows;
  if (rows > room) {
    const visible = room - 2; // uma linha para "acima" e outra para "abaixo"
    start = Math.min(Math.max(0, state.cursor - Math.floor(visible / 2)), rows - visible);
    end = start + visible;
  }

  const lines: string[] = [];
  if (start > 0) lines.push(paint(`   ↑ mais ${start}`, "gray", style));
  for (let row = start; row < end; row += 1) {
    const selected = row === state.cursor;
    const pointer = selected ? paint("❯", "cyan", style) : " ";
    let label: string;
    if (hasKeep(spec) && row === 0) {
      label = `${paint("↵", "gray", style)}  ${spec.keepLabel!}`;
    } else {
      const index = valueOfRow(spec, row);
      const choice = spec.choices[index]!;
      const number = `${index + 1})`.padStart(String(spec.choices.length).length + 1);
      const isDefault = index === spec.defaultIndex ? paint(" (padrão)", "gray", style) : "";
      const hint = choice.hint ? paint(` — ${choice.hint}`, "gray", style) : "";
      const text = selected ? paint(choice.label, "bold", style) : choice.label;
      label = `${paint(number, selected ? "cyan" : "gray", style)} ${text}${isDefault}${hint}`;
    }
    lines.push(truncateVisible(` ${pointer} ${label}`, width));
  }
  if (end < rows) lines.push(paint(`   ↓ mais ${rows - end}`, "gray", style));
  if (state.message) lines.push(truncateVisible(paint(`   ${state.message}`, "yellow", style), width));
  return lines;
}
