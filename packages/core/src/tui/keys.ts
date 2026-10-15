/**
 * Bytes do terminal em teclas.
 *
 * Com o terminal em modo raw, cada tecla chega como bytes crus: uma seta é
 * `ESC [ A`, o Enter é `\r`, o Ctrl-C é `\x03` — e nenhum deles vira sinal ou
 * linha sozinho. Esta é a única tradução deles para o resto do programa.
 *
 * A colagem chega marcada. Com o *bracketed paste* ligado (`ESC [ ? 2004 h`), o
 * terminal cerca o texto colado por `ESC [ 200 ~` e `ESC [ 201 ~`, e ele vira UMA
 * tecla `paste` com o texto inteiro. É isso que deixa a lista de escolhas
 * recusar uma colagem em vez de ler a primeira linha dela como resposta — o
 * defeito que fez o wizard antigo ser só numérico.
 *
 * Um pedaço pode chegar partido entre dois `data` (a colagem longa sempre chega),
 * por isso o decodificador guarda estado entre as chamadas.
 */

export type Key =
  | { type: "char"; text: string }
  | { type: "paste"; text: string }
  | {
      type:
        | "up"
        | "down"
        | "left"
        | "right"
        | "home"
        | "end"
        | "pageup"
        | "pagedown"
        | "enter"
        | "escape"
        | "backspace"
        | "tab"
        | "ctrl-c"
        | "ctrl-d"
        | "ctrl-u";
    };

const ESC = "\u001B";
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;

/** Liga e desliga a marcação de colagem no terminal. */
export const BRACKETED_PASTE_ON = `${ESC}[?2004h`;
export const BRACKETED_PASTE_OFF = `${ESC}[?2004l`;

const SEQUENCES: Record<string, Key["type"]> = {
  "[A": "up",
  "[B": "down",
  "[C": "right",
  "[D": "left",
  OA: "up",
  OB: "down",
  OC: "right",
  OD: "left",
  "[H": "home",
  "[F": "end",
  OH: "home",
  OF: "end",
  "[1~": "home",
  "[4~": "end",
  "[7~": "home",
  "[8~": "end",
  "[5~": "pageup",
  "[6~": "pagedown",
};

export class KeyDecoder {
  private pending = "";
  private pasting: string | null = null;

  /** Traduz o pedaço que chegou; o que ficou incompleto espera o próximo. */
  feed(chunk: string): Key[] {
    let input = this.pending + chunk;
    this.pending = "";
    const keys: Key[] = [];

    while (input.length > 0) {
      if (this.pasting !== null) {
        const end = input.indexOf(PASTE_END);
        if (end === -1) {
          // O fim da marca pode estar partido: guarda a cauda que ainda pode sê-lo.
          const keep = partialSuffix(input, PASTE_END);
          this.pasting += input.slice(0, input.length - keep);
          this.pending = input.slice(input.length - keep);
          return keys;
        }
        keys.push({ type: "paste", text: normalizeNewlines(this.pasting + input.slice(0, end)) });
        this.pasting = null;
        input = input.slice(end + PASTE_END.length);
        continue;
      }

      if (input.startsWith(PASTE_START)) {
        this.pasting = "";
        input = input.slice(PASTE_START.length);
        continue;
      }

      const char = input[0]!;
      if (char === ESC) {
        if (input.length === 1) {
          // ESC sozinho no fim do pedaço: é a tecla Esc. Sequências chegam
          // inteiras num mesmo `data` na prática; a de colagem é a exceção, e
          // ela é tratada acima pela marca completa.
          keys.push({ type: "escape" });
          input = "";
          continue;
        }
        if (PASTE_START.startsWith(input)) {
          this.pending = input;
          return keys;
        }
        const match = /^\u001B(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(input);
        if (match) {
          const type = SEQUENCES[match[1]!];
          if (type !== undefined) keys.push({ type } as Key);
          input = input.slice(match[0].length);
          continue;
        }
        if (/^\u001B\[[0-9;]*$/.test(input)) {
          this.pending = input;
          return keys;
        }
        keys.push({ type: "escape" });
        input = input.slice(1);
        continue;
      }

      input = input.slice(1);
      if (char === "\r" || char === "\n") keys.push({ type: "enter" });
      else if (char === "\u007F" || char === "\b") keys.push({ type: "backspace" });
      else if (char === "\t") keys.push({ type: "tab" });
      else if (char === "\u0003") keys.push({ type: "ctrl-c" });
      else if (char === "\u0004") keys.push({ type: "ctrl-d" });
      else if (char === "\u0015") keys.push({ type: "ctrl-u" });
      else if (char >= " ") {
        // Caractere fora do plano básico chega como par substituto: os dois juntos.
        const code = char.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff && input.length > 0) {
          keys.push({ type: "char", text: char + input[0]! });
          input = input.slice(1);
        } else {
          keys.push({ type: "char", text: char });
        }
      }
      // Os demais controles não significam nada aqui e são ignorados.
    }
    return keys;
  }
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Quantos caracteres do fim de `text` podem ser o começo de `marker`. */
function partialSuffix(text: string, marker: string): number {
  for (let size = Math.min(marker.length - 1, text.length); size > 0; size -= 1) {
    if (marker.startsWith(text.slice(text.length - size))) return size;
  }
  return 0;
}
