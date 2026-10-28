type ControlKeyType = 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown' | 'enter' | 'escape' | 'backspace' | 'ctrl-c' | 'ctrl-d' | 'ctrl-u' | 'tab' | 'backtab';
export type Key = { type: 'char' | 'paste'; text: string } | { type: ControlKeyType } | {
  type: 'mouse';
  /** Raw SGR button bits; 64/65 are wheel up/down. Coordinates are 1-based. */
  button: number;
  x: number;
  y: number;
  release: boolean;
};
const ESC = '\u001b';
const START = `${ESC}[200~`;
const END = `${ESC}[201~`;
export const BRACKETED_PASTE_ON = `${ESC}[?2004h`;
export const BRACKETED_PASTE_OFF = `${ESC}[?2004l`;
const sequences: Record<string, ControlKeyType> = { '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left', OA: 'up', OB: 'down', OC: 'right', OD: 'left', '[H': 'home', '[F': 'end', '[1~': 'home', '[4~': 'end', '[5~': 'pageup', '[6~': 'pagedown', '[Z': 'backtab' };

/** Retains partial escape sequences and paste markers across terminal chunks. */
export class KeyDecoder {
  private pending = '';
  private paste: string | null = null;
  flushEscape(): Key[] {
    if (this.pending !== ESC || this.paste !== null) return [];
    this.pending = '';
    return [{ type: 'escape' }];
  }
  feed(chunk: string): Key[] {
    let input = this.pending + chunk; this.pending = '';
    const keys: Key[] = [];
    while (input) {
      if (this.paste !== null) {
        const end = input.indexOf(END);
        if (end < 0) {
          let keep = Math.min(input.length, END.length - 1);
          while (keep > 0 && !END.startsWith(input.slice(-keep))) keep--;
          this.paste += input.slice(0, input.length - keep);
          this.pending = keep ? input.slice(-keep) : '';
          return keys;
        }
        keys.push({ type: 'paste', text: (this.paste + input.slice(0, end)).replace(/\r\n?/g, '\n') });
        this.paste = null; input = input.slice(end + END.length); continue;
      }
      if (input.startsWith(START)) { this.paste = ''; input = input.slice(START.length); continue; }
      if (input.startsWith(ESC)) {
        const mouse = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/.exec(input);
        if (mouse) {
          const button = Number(mouse[1]), x = Number(mouse[2]), y = Number(mouse[3]);
          if ([button, x, y].every(Number.isSafeInteger) && x > 0 && y > 0) keys.push({ type: 'mouse', button, x, y, release: mouse[4] === 'm' });
          input = input.slice(mouse[0].length); continue;
        }
        if (/^\u001b\[<\d*(?:;\d*(?:;\d*)?)?$/.test(input)) { this.pending = input; break; }
        if (START.startsWith(input) || /^\u001b\[[0-9;]*$/.test(input) || input === `${ESC}O`) { this.pending = input; break; }
        const match = /^\u001b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(input);
        if (match) { const type = sequences[match[1]!]; if (type) keys.push({ type }); input = input.slice(match[0].length); continue; }
        keys.push({ type: 'escape' }); input = input.slice(1); continue;
      }
      const char = String.fromCodePoint(input.codePointAt(0)!); input = input.slice(char.length);
      const controls: Record<string, ControlKeyType> = { '\r': 'enter', '\n': 'enter', '\t': 'tab', '\u007f': 'backspace', '\b': 'backspace', '\u0003': 'ctrl-c', '\u0004': 'ctrl-d', '\u0015': 'ctrl-u' };
      const type = controls[char];
      if (type) keys.push({ type });
      else if (char >= ' ') keys.push({ type: 'char', text: char });
    }
    return keys;
  }
}

export interface SelectState { cursor: number; digits: string; message: string; }
export function reduceSelect(state: SelectState, key: Key, count: number): { state: SelectState; chosen?: number } {
  if (key.type === 'enter') return { state, chosen: state.cursor };
  if (key.type === 'paste') return { state: { ...state, message: 'Escolha uma opção primeiro; cole o pedido no campo seguinte.' } };
  let cursor = state.cursor;
  if (key.type === 'up' || key.type === 'backtab' || key.type === 'char' && key.text === 'k') cursor = (cursor - 1 + count) % count;
  else if (key.type === 'down' || key.type === 'tab' || key.type === 'char' && key.text === 'j') cursor = (cursor + 1) % count;
  else if (key.type === 'home') cursor = 0;
  else if (key.type === 'end') cursor = count - 1;
  else if (key.type === 'pageup') cursor = Math.max(0, cursor - 10);
  else if (key.type === 'pagedown') cursor = Math.min(count - 1, cursor + 10);
  else if (key.type === 'char' && /^\d$/.test(key.text)) {
    let digits = state.digits + key.text;
    if (Number(digits) > count) digits = key.text;
    const index = Number(digits) - 1;
    return { state: { cursor: index >= 0 && index < count ? index : cursor, digits, message: '' } };
  } else return { state };
  return { state: { cursor, digits: '', message: '' } };
}
export function reduceText(value: string, key: Key, multiline = false): { value: string; submitted?: string } {
  if (key.type === 'char' || key.type === 'paste') return { value: value + (multiline ? key.text : key.text.replace(/\r?\n/g, ' ')) };
  if (key.type === 'backspace') return { value: [...value].slice(0, -1).join('') };
  if (key.type === 'ctrl-u') return { value: multiline ? value.slice(0, value.lastIndexOf('\n') + 1) : '' };
  if (key.type === 'ctrl-d' && multiline) return { value, submitted: value.trim() };
  if (key.type === 'enter') {
    if (!multiline) return { value, submitted: value };
    const lines = value.split('\n');
    if (lines.at(-1)?.trim() === '.') return { value, submitted: lines.slice(0, -1).join('\n').trim() };
    return { value: `${value}\n` };
  }
  return { value };
}
