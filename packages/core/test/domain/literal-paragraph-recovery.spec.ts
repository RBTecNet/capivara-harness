import { expect, it } from 'vitest';
import { recoverLiteralParagraphs, resolveLiteralExcerpt } from '../../src/domain/literal-source.js';

it('recovers an omitted complete paragraph as actual source, retaining the additional obligation and original quote', () => {
  const first = 'Use QuokkaDB in a local file.';
  const second = 'Records survive restarting the application.';
  const omitted = 'Tests must use an isolated database.';
  const last = 'Do not use external database services.';
  const source = `${first}\n\n${second}\n\n${omitted}\n\n${last}`;
  const raw = `## Persistence\n\n${source}\n\n## Other requirements\n\nUnrelated work.`;
  const quote = `${first}\n\n${second}\n\n${last}`;
  expect(resolveLiteralExcerpt(raw, quote)).toBeUndefined();
  const recovered = recoverLiteralParagraphs(raw, quote)!;
  expect(recovered).toMatchObject({ text: source, quote });
  expect(recovered.spans.map(span => raw.slice(span.start, span.end))).toEqual([first, second, last]);
  expect(recovered.includedGaps.map(span => raw.slice(span.start, span.end))).toEqual([`\n\n${omitted}\n\n`]);
  expect(raw.includes(recovered.text)).toBe(true);
  // Recovery is a separate provenance operation, never a relaxed literal match.
  expect(resolveLiteralExcerpt(raw, quote)).toBeUndefined();
});

it('can recover complete literal list lines while preserving skipped requirements and exact technology spelling', () => {
  const raw = '## Stack\r\n- FooDB\r\n- Node.js\r\n- Automated tests\r\n- React\r\n';
  const quote = '- FooDB\n- React';
  const recovered = recoverLiteralParagraphs(raw, quote)!;
  expect(recovered.text).toBe('FooDB\r\n- Node.js\r\n- Automated tests\r\n- React');
  expect(recovered.spans.map(span => raw.slice(span.start, span.end))).toEqual(['FooDB', 'React']);
  expect(recovered.includedGaps).toHaveLength(1);
  expect(raw.slice(recovered.includedGaps[0]!.start, recovered.includedGaps[0]!.end)).toContain('Automated tests');
});

it('accepts repeated anchors only when the entire ordered chain is unique and keeps their actual offsets', () => {
  const raw = 'End.\n\nStart.\n\nUnique.\n\nHidden must stay.\n\nEnd.\n\nStart.';
  const quote = 'Start.\n\nUnique.\n\nEnd.';
  expect(resolveLiteralExcerpt(raw, quote.split(/\n\s*\n/).join(' [...] '))).toBe('Start.\n\nUnique.\n\nHidden must stay.\n\nEnd.');
  const recovered = recoverLiteralParagraphs(raw, quote)!;
  expect(recovered.text).toBe('Start.\n\nUnique.\n\nHidden must stay.\n\nEnd.');
  expect(recovered.spans).toEqual([
    { start: raw.indexOf('Start.'), end: raw.indexOf('Start.') + 'Start.'.length },
    { start: raw.indexOf('Unique.'), end: raw.indexOf('Unique.') + 'Unique.'.length },
    { start: raw.lastIndexOf('End.'), end: raw.lastIndexOf('End.') + 'End.'.length },
  ]);
});

it.each([
  { raw: 'First.\n\nHidden.\n\nLast.\n\nFirst.\n\nLast.', quote: 'First.\n\nLast.' },
  { raw: 'Start.\n\nOther.\n\nEnd.\n\nStart.\n\nUnique.\n\nHiddenmuststay.\n\nEnd.', quote: 'Start.\n\nUnique.\n\nEnd.' },
  { raw: 'Last.\n\nHidden.\n\nFirst.', quote: 'First.\n\nLast.' },
  { raw: 'Start.\n\nDjango\n\nEnd.', quote: 'Start.\n\nGo\n\nEnd.' },
  { raw: 'Start.\n\nNode.js\n\nEnd.', quote: 'Start.\n\nNode\n\nEnd.' },
  { raw: 'Start.\n\nC++\n\nEnd.', quote: 'Start.\n\nC\n\nEnd.' },
  { raw: 'Keep the entire first clause.\n\nHidden.\n\nKeep the final clause.', quote: 'first clause.\n\nKeep the final clause.' },
  { raw: 'Keep the first clause.\n\nHidden.\n\nKeep the entire final clause.', quote: 'Keep the first clause.\n\nKeep the entire final' },
  { raw: 'First.\n\nHidden.\n\nLast.', quote: 'First. Hidden. Last.' },
  { raw: 'First.\n\nHidden.\n\nLast.', quote: 'First.\n\nInvented.\n\nLast.' },
])('rejects ambiguous, reordered, partial or lexically altered anchors: $quote', ({ raw, quote }) => {
  expect(recoverLiteralParagraphs(raw, quote)).toBeUndefined();
});

it('leaves already resolvable literal quotes and explicit omissions on the strict path', () => {
  const raw = 'First.\n\nHidden.\n\nLast.';
  expect(resolveLiteralExcerpt(raw, 'First. [...] Last.')).toBe(raw);
  expect(recoverLiteralParagraphs(raw, 'First. [...] Last.')).toBeUndefined();
  expect(recoverLiteralParagraphs(raw, raw)).toBeUndefined();
});
