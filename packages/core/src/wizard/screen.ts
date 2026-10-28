import { MASCOT_ART } from './mascot-art.js';
import type { Choice, WizardHistory } from './types.js';
import type { SelectState } from './keys.js';

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
export const plain = (text: string): string => text.replace(ANSI, '');
const cellWidth = (char: string): number => {
  if (/\p{Mark}|\u200d/u.test(char)) return 0;
  const point = char.codePointAt(0)!;
  return point >= 0x1100 && (point <= 0x115f || point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f || point >= 0xff01 && point <= 0xff60 || point >= 0xffe0 && point <= 0xffe6 || point >= 0x1f300 && point <= 0x1faff || point >= 0x20000 && point <= 0x3ffff) ? 2 : 1;
};
export const widthOf = (text: string): number => [...plain(text)].reduce((width, char) => width + cellWidth(char), 0);
const safe = (text: string): string => text.replace(/\u001b(?:\[[0-9;?]*[A-Za-z]|\][^\u0007]*(?:\u0007|$))|[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
export function clip(text: string, width: number): string {
  if (widthOf(text) <= width) return text;
  let output = ''; let used = 0;
  for (const part of text.match(/\u001b\[[0-9;?]*[A-Za-z]|[^]/gu) ?? []) {
    if (part.startsWith('\u001b')) output += part;
    else { const cells = cellWidth(part); if (used + cells > Math.max(0, width - 1)) break; output += part; used += cells; }
  }
  return `${output}…${text.includes('\u001b') ? '\u001b[0m' : ''}`;
}
const GLYPHS: Record<string, string[]> = {
  C: [' ███ ', '█    ', '█    ', '█    ', ' ███ '], A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  P: ['████ ', '█   █', '████ ', '█    ', '█    '], I: ['███', ' █ ', ' █ ', ' █ ', '███'],
  V: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '], R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
};
const COMPACT: Record<string, string[]> = { C: [' ██', '█  ', '█  ', '█  ', ' ██'], A: [' █ ', '█ █', '███', '█ █', '█ █'], P: ['██ ', '█ █', '██ ', '█  ', '█  '], I: ['███', ' █ ', ' █ ', ' █ ', '███'], V: ['█ █', '█ █', '█ █', '█ █', ' █ '], R: ['██ ', '█ █', '██ ', '█ █', '█ █'] };
const ASCII_CAPYBARA = ['       ___         ___', '      /   \\       /   \\', "     |     '-----'     |", '     |   --       --   |', '     |                 |', '     |    _________    |', '     |   /  .   .  \\   |', '      \\  \\_________/  /', "       '-------------'"];
export interface ScreenPrompt {
  title: string;
  choices?: readonly Choice[];
  selection?: SelectState;
  value?: string;
  fallback?: string;
  multiline?: boolean;
  secret?: boolean;
}
export interface WizardScreen {
  version: string; width: number; height: number;
  color: boolean; trueColor?: boolean;
  history: readonly WizardHistory[]; notes: readonly string[];
  prompt: ScreenPrompt;
}

/** A bounded, pure renderer: resizing never leaves rows outside the terminal. */
export function renderWizardScreen(model: WizardScreen): string {
  const width = Math.max(8, Math.floor(model.width));
  const height = Math.max(5, Math.floor(model.height) - 1);
  const inner = width - 2;
  const paint = (text: string, tone = '36'): string => model.color ? `\u001b[${tone}m${text}\u001b[0m` : text;
  const box = (title: string, body: string[]): string[] => {
    const label = clip(` ${title} `, inner);
    return [paint(`┌${label}${'─'.repeat(Math.max(0, inner - widthOf(label)))}┐`), ...body.map(line => `${paint('│')}${clip(line, inner)}${' '.repeat(Math.max(0, inner - widthOf(clip(line, inner))))}${paint('│')}`), paint(`└${'─'.repeat(inner)}┘`)];
  };
  const prompt = model.prompt;
  const footer = prompt.choices ? '↑ ↓ / j k move · número seleciona · Enter confirma · Esc volta · Ctrl-C sai'
    : prompt.multiline ? 'Enter quebra linha · . sozinho ou Ctrl-D termina · Esc volta · Ctrl-C sai' : 'Enter confirma · Ctrl-U apaga · Esc volta · Ctrl-C sai';
  const title = ` ${paint(safe(prompt.title), '1')}`;
  const header = [paint(` CAPIVARA ${model.version}`, '1;36'), paint(' WIZARD · MONTA O COMANDO COM VOCÊ', '90')];
  const budget = Math.max(1, height - header.length - 5);
  const wanted = prompt.choices?.length ?? (prompt.multiline ? Math.max(3, (prompt.value ?? '').split('\n').length) : 1);
  const rows = Math.max(1, Math.min(wanted, budget));
  const body: string[] = [title, ''];
  if (prompt.choices) {
    const cursor = prompt.selection?.cursor ?? 0;
    const start = Math.min(Math.max(0, cursor - Math.floor(rows / 2)), Math.max(0, prompt.choices.length - rows));
    for (let i = start; i < Math.min(prompt.choices.length, start + rows); i++) {
      const choice = prompt.choices[i]!;
      const line = ` ${i === cursor ? '▸' : ' '} ${i + 1}) ${safe(choice.label)}${choice.hint ? ` — ${safe(choice.hint)}` : ''}`;
      body.push(i === cursor ? paint(line, '1;36') : line);
    }
    if (prompt.selection?.message && body.length < budget + 2) body.push(paint(` ${prompt.selection.message}`, '33'));
  } else {
    const value = prompt.secret ? '*'.repeat(Math.min([...(prompt.value ?? '')].length, Math.max(1, inner - 5))) : safe(prompt.value ?? '');
    const shown = value || (prompt.fallback ? paint(safe(prompt.fallback), '90') : '');
    const lines = shown.split('\n').slice(-rows);
    lines.forEach((line, index) => body.push(` ${paint('▸')} ${line}${index === lines.length - 1 ? paint('█') : ''}`));
  }
  const question = box(prompt.choices ? 'ESCOLHA' : 'RESPOSTA', body);
  let room = height - header.length - question.length - 1;
  const middle: string[] = [];
  const wrap = (line: string): string[] => {
    const lines: string[] = []; let current = ''; let cells = 0;
    for (const char of line) {
      const size = cellWidth(char);
      if (cells + size > width - 2 && current) { lines.push(current); current = ''; cells = 0; }
      current += char; cells += size;
    }
    if (current) lines.push(current);
    return lines;
  };
  const notes = model.notes.flatMap(note => safe(note).split('\n').flatMap(wrap)).filter(Boolean).slice(0, Math.max(0, room));
  if (notes.length) { middle.push(...notes.map(note => paint(` ${note}`, '90'))); room -= notes.length; }
  if (room >= 3 && model.history.length) {
    const entries = model.history.slice(-Math.max(1, room - 2));
    middle.unshift(...box('SUAS ESCOLHAS', entries.map(item => ` ${paint(safe(item.question), '36')}  ${safe(item.answer.split('\n')[0] ?? '')}`)));
    room -= entries.length + 2;
  }
  if (width >= 64) {
    const art = model.color && model.trueColor ? MASCOT_ART.init.lines : ASCII_CAPYBARA;
    if (room >= art.length) {
      const leftWidth = Math.floor((width - Math.max(...art.map(widthOf))) / 2);
      const glyphs = leftWidth < 48 ? COMPACT : GLYPHS;
      const logo = Array.from({ length: 5 }, (_, row) => [...'CAPIVARA'].map(letter => glyphs[letter]?.[row] ?? '').join(' '));
      const title = widthOf(logo[0]!) + 3 <= leftWidth ? logo.map(line => paint(line, '36')) : [paint('CAPIVARA', '1;36'), paint(`v${model.version}`, '90')];
      const top = Math.floor((art.length - title.length) / 2);
      header.splice(0, 2, ...art.map((line, row) => {
        const label = `  ${title[row - top] ?? ''}`;
        return `${label}${' '.repeat(Math.max(0, leftWidth - widthOf(label)))}${line}`;
      }), paint('WIZARD · MONTA O COMANDO COM VOCÊ', '90'), paint('─'.repeat(width), '90'));
    }
  }
  return [...header, ...middle, ...question, paint(footer, '90')].slice(-height).map(line => clip(line, width)).join('\n');
}
