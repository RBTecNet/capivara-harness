import { expect, it } from 'vitest';
import { KeyDecoder, reduceSelect, reduceText } from '../../src/wizard/keys.js';

it('decodifica Tab, Shift-Tab e mouse SGR fragmentados sem confundir Escape nem a colagem', () => {
  const decoder = new KeyDecoder();
  expect(decoder.feed('\u001b')).toEqual([]);
  expect(decoder.feed('[<64;12')).toEqual([]);
  expect(decoder.flushEscape()).toEqual([]);
  expect(decoder.feed(';9M\u001b[<65;12;9M\t\u001b[')).toEqual([
    { type: 'mouse', button: 64, x: 12, y: 9, release: false },
    { type: 'mouse', button: 65, x: 12, y: 9, release: false },
    { type: 'tab' },
  ]);
  expect(decoder.feed('Z\u001b[<0;')).toEqual([{ type: 'backtab' }]);
  expect(decoder.feed('25;10M\u001b[<0;25;10m')).toEqual([
    { type: 'mouse', button: 0, x: 25, y: 10, release: false },
    { type: 'mouse', button: 0, x: 25, y: 10, release: true },
  ]);
  expect(decoder.feed('\u001b[200~\t\u001b[<64;1;1M\u001b[201~')).toEqual([{ type: 'paste', text: '\t\u001b[<64;1;1M' }]);
  expect(decoder.feed('\u001b')).toEqual([]);
  expect(decoder.flushEscape()).toEqual([{ type: 'escape' }]);
  const state = { cursor: 2, digits: '', message: '' };
  expect(reduceSelect(state, { type: 'tab' }, 3).state.cursor).toBe(0);
  expect(reduceSelect(state, { type: 'backtab' }, 3).state.cursor).toBe(1);
  const mouse = { type: 'mouse' as const, button: 64, x: 1, y: 1, release: false };
  expect(reduceSelect(state, mouse, 3).state).toBe(state);
  expect(reduceText('Pedido', mouse).value).toBe('Pedido');
});
