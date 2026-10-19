/**
 * O campo de texto, quando a entrada é tecla a tecla.
 *
 * No modo de linha, uma colagem de três linhas numa pergunta de uma linha
 * respondia a pergunta com a primeira e as duas seguintes com o resto. Aqui a
 * colagem chega inteira (ver `keys.ts`) e fica no campo: numa linha, as quebras
 * viram espaço; no campo de várias linhas, ficam como estão. Só o Enter — ou o
 * ponto sozinho, no de várias — entrega a resposta.
 */

import { paint, truncateVisible, type Style } from "./ansi.js";
import type { Key } from "./keys.js";

export interface TextFieldSpec {
  label: string;
  /** O que o Enter num campo vazio aceita; aparece apagado dentro do campo. */
  placeholder?: string;
  multiline?: boolean;
  /** Nunca desenhar o valor de uma chave ou senha. */
  secret?: boolean;
  /** Esc desiste do campo — na entrevista, volta para a lista de opções. */
  cancelable?: boolean;
}

export interface TextFieldState {
  value: string;
}

export type TextFieldStep =
  | { state: TextFieldState; submitted?: undefined; ended?: undefined; cancelled?: undefined }
  | { state: TextFieldState; submitted: string; ended?: undefined; cancelled?: undefined }
  | { state: TextFieldState; ended: true; submitted?: undefined; cancelled?: undefined }
  | { state: TextFieldState; cancelled: true; submitted?: undefined; ended?: undefined };

function dropLastCodePoint(value: string): string {
  const chars = [...value];
  chars.pop();
  return chars.join("");
}

export function reduceTextField(spec: TextFieldSpec, state: TextFieldState, key: Key): TextFieldStep {
  const { value } = state;
  switch (key.type) {
    case "char":
      return { state: { value: value + key.text } };
    case "paste":
      return { state: { value: value + (spec.multiline ? key.text : key.text.replace(/\s*\n\s*/g, " ")) } };
    case "backspace":
      return { state: { value: dropLastCodePoint(value) } };
    case "ctrl-u": {
      if (!spec.multiline) return { state: { value: "" } };
      const cut = value.lastIndexOf("\n");
      return { state: { value: cut === -1 ? "" : value.slice(0, cut + 1) } };
    }
    case "enter": {
      if (!spec.multiline) return { state, submitted: value };
      const lines = value.split("\n");
      // O ponto sozinho na última linha fecha o texto, como no modo de linha.
      if (lines[lines.length - 1]!.trim() === ".") return { state, submitted: lines.slice(0, -1).join("\n").trim() };
      return { state: { value: `${value}\n` } };
    }
    case "escape":
      return spec.cancelable ? { state, cancelled: true } : { state };
    case "ctrl-d":
      if (spec.multiline) return { state, submitted: value.trim() };
      return value === "" ? { state, ended: true } : { state };
    default:
      return { state };
  }
}

/** O campo desenhado; no de várias linhas, só as últimas que cabem. */
export function renderTextField(spec: TextFieldSpec, state: TextFieldState, width: number, maxRows: number, style: Style): string[] {
  const cursor = paint("█", "cyan", style);
  if (spec.secret) return [` ${paint("▸", "cyan", style)} ${"*".repeat(Math.min([...state.value].length, Math.max(1, width - 5)))}${cursor}`];
  if (!spec.multiline) {
    const shown = state.value === "" && spec.placeholder ? `${cursor}${paint(spec.placeholder, "gray", style)}` : `${state.value}${cursor}`;
    // Texto mais largo que o campo mostra o fim, que é onde se está digitando.
    const room = Math.max(4, width - 4);
    const visible = state.value.length + 1 > room && !(state.value === "" && spec.placeholder) ? `…${state.value.slice(-(room - 2))}${cursor}` : shown;
    return [` ${paint("▸", "cyan", style)} ${visible}`];
  }

  const lines = state.value.split("\n");
  const room = Math.max(1, maxRows);
  const hidden = Math.max(0, lines.length - room);
  const out: string[] = [];
  if (hidden > 0) out.push(paint(`   ↑ mais ${hidden} linha(s)`, "gray", style));
  const visible = lines.slice(hidden + (hidden > 0 ? 1 : 0));
  visible.forEach((line, index) => {
    const last = index === visible.length - 1;
    out.push(truncateVisible(` ${paint(">", "gray", style)} ${line}${last ? cursor : ""}`, width));
  });
  return out;
}
