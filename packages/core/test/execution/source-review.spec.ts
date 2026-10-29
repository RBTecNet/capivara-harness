import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '../../src/execution/files.js';
import { interpretReview } from '../../src/execution/review.js';
import { substantiateSourceFinding, type SourceReviewCoverage } from '../../src/execution/source-review.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() { const root = await mkdtemp(join(tmpdir(), 'capivara-source-review-')); temporary.push(root); return root; }
const code = 'export function save(value) {\n  return value.trim();\n}\n';
const coverage = (complete: boolean, source = code): SourceReviewCoverage[] => [{ path: 'src/store.js', hash: digest(source), complete, ranges: [{ startLine: 1, endLine: complete ? 4 : 1 }] }];
const finding = (sourceEvidence?: unknown) => interpretReview(JSON.stringify({ approved: false, findings: [{ kind: 'product', evidenceType: 'source', file: 'src/store.js', observed: 'save throws when value is null.', expected: 'save accepts the documented optional input.', ...(sourceEvidence === undefined ? {} : { sourceEvidence }) }] })).findings[0]!;
async function prepare() { const root = await workspace(); await mkdir(join(root, 'src')); await writeFile(join(root, 'src/store.js'), code); return root; }

it('validates structured source citations when the affected file field names a directory',async()=>{
  const root=await prepare(),original={approved:false,findings:[{kind:'product-defect',file:'src/',observed:'save throws for null.',expected:'The optional input is accepted.',evidence:[{location:'src/store.js:2-2',observed:'The argument is dereferenced without guarding null.'}],evidenceType:'source'}]};
  const review=interpretReview(JSON.stringify(original)),finding=review.findings[0]!;
  expect(finding.evidence).toContain('src/store.js:2-2');
  const result=await substantiateSourceFinding(root,finding,coverage(true));
  expect(result.verified).toBe(true);expect(result.receipt?.sourceLocation?.startLine).toBe(2);
  expect(review.approved).toBe(false);expect(review.original).toBe(JSON.stringify(original));
  expect((await substantiateSourceFinding(root,finding,coverage(true,'stale'))).verified).toBe(false);
});

it('preserves a material finding against current source identity without claiming complete delivery or approving its verdict', async () => {
  const root = await prepare(), defect = finding(), before = structuredClone(defect);
  const result = await substantiateSourceFinding(root, defect, coverage(false));
  expect(result.verified).toBe(true);
  expect(result.receipt).toMatchObject({ path: 'src/store.js', hash: digest(code), complete: false, startLine: 1, endLine: 1, ranges: [{ startLine: 1, endLine: 1 }] });
  const omitted = await substantiateSourceFinding(root, defect, [{ path: 'src/store.js', hash: digest(code), complete: false, status: 'omitted', ranges: [] }]);
  expect(omitted.verified).toBe(true); expect(omitted.receipt).toMatchObject({ complete: false, startLine: 0, endLine: 0, ranges: [] });
  expect((await substantiateSourceFinding(root, defect, [])).verified).toBe(false);
  expect((await substantiateSourceFinding(root, defect, coverage(false, 'stale'))).verified).toBe(false);
  const fakeQuote = finding({ path: 'src/store.js', startLine: 2, endLine: 2, quote: 'return invented;', scope: 'range' });
  expect((await substantiateSourceFinding(root, fakeQuote, coverage(false))).verified).toBe(false);
  const outside = { ...defect, file: '../outside.js' };
  expect((await substantiateSourceFinding(root, outside, coverage(false))).verified).toBe(false);
  expect(defect).toEqual(before); expect(defect.disposition).toBe('defect');
  expect(interpretReview(JSON.stringify({ approved: false, findings: [defect.original] })).approved).toBe(false);
  expect(await readFile(join(root, 'src/store.js'), 'utf8')).toBe(code);
});

it('preserves a material narrative finding when its complete current source was delivered', async () => {
  const root = await prepare(), defect = finding();
  const result = await substantiateSourceFinding(root, defect, coverage(true));
  expect(result.verified).toBe(true); expect(result.receipt).toMatchObject({ path: 'src/store.js', hash: digest(code), complete: true });
  expect(defect.disposition).toBe('defect');
});

it('normalizes file locations while preserving the range, original rejection and material local defect', async () => {
  const root = await prepare();
  const raw = { kind: 'product', evidenceType: 'source', scope: 'unit', file: 'src/store.js:2-2', observed: 'save throws for null.', expected: 'The documented optional input works.' };
  const assessment = interpretReview(JSON.stringify({ approved: false, findings: [raw] })), defect = assessment.findings[0]!;
  const result = await substantiateSourceFinding(root, defect, coverage(true));
  expect(result.verified).toBe(true); expect(result.receipt).toMatchObject({ path: 'src/store.js', startLine: 2, endLine: 2 });
  expect(defect).toMatchObject({ file: 'src/store.js', sourceLocation: { reference: raw.file, startLine: 2, endLine: 2 }, original: raw, disposition: 'defect' });
  expect(assessment.decision).toBe('rejected'); expect(assessment.approved).toBe(false);
  expect(assessment.transformations).toContainEqual(expect.objectContaining({ path: 'findings[0].file', operation: 'normalize', original: raw.file }));
  const quoted = finding({ path: 'src/store.js', startLine: 2, endLine: 2, quote: 'return value.trim();', scope: 'range' });
  quoted.file = 'src/store.js:2:3-2:22';
  expect((await substantiateSourceFinding(root, quoted, coverage(false))).verified).toBe(true);
  const hashLocation = interpretReview(JSON.stringify({ approved: false, findings: [{ ...raw, file: 'src/store.js#L2-L2' }] })).findings[0]!;
  expect((await substantiateSourceFinding(root, hashLocation, coverage(true))).receipt).toMatchObject({ path: 'src/store.js', startLine: 2, endLine: 2 });
  expect((await substantiateSourceFinding(root, { ...defect, file: '../outside.js:2-2' }, coverage(true))).verified).toBe(false);
  expect(await readFile(join(root, 'src/store.js'), 'utf8')).toBe(code);
});

it('substantiates a concrete real defect from matching source while preserving its original claim and code', async () => {
  const root = await prepare();
  const defect = finding({ path: 'src/store.js', hash: digest(code), startLine: 2, endLine: 2, quote: 'return value.trim();', scope: 'range' });
  const before = structuredClone(defect), result = await substantiateSourceFinding(root, defect, coverage(false));
  expect(result.verified).toBe(true); expect(result.receipt).toMatchObject({ startLine: 2, endLine: 2, complete: false });
  expect(defect).toEqual(before); expect(defect.original).toEqual(before.original);
  expect(await readFile(join(root, 'src/store.js'), 'utf8')).toBe(code);
});

it('does not accept an invented quote, stale hash or impossible line range', async () => {
  const root = await prepare();
  const valid = { path: 'src/store.js', hash: digest(code), startLine: 2, endLine: 2, quote: 'return value.trim();', scope: 'range' };
  for (const invalid of [{ ...valid, quote: 'return null;' }, { ...valid, hash: digest('stale') }, { ...valid, startLine: 20, endLine: 20 }]) expect((await substantiateSourceFinding(root, finding(invalid), coverage(true))).verified).toBe(false);
  expect((await substantiateSourceFinding(root, finding(), coverage(true, 'stale'))).verified).toBe(false);
});

it('requires complete current coverage for a declared absence or whole-file claim', async () => {
  const root = await prepare();
  const absent = { path: 'src/store.js', hash: digest(code), scope: 'whole-file', claim: 'absence' };
  expect((await substantiateSourceFinding(root, finding(absent), coverage(false))).verified).toBe(false);
  expect((await substantiateSourceFinding(root, finding({ ...absent, scope: 'range' }), coverage(true))).verified).toBe(false);
  expect((await substantiateSourceFinding(root, finding(absent), coverage(true))).verified).toBe(true);
});

it('refuses source paths and links escaping the project without reading them as evidence', async () => {
  const root = await prepare(), outside = await workspace(); await writeFile(join(outside, 'secret.js'), code);
  const outsideFinding = { ...finding(), file: join(outside, 'secret.js') };
  expect((await substantiateSourceFinding(root, outsideFinding, [{ path: join(outside, 'secret.js'), hash: digest(code), complete: true }])).verified).toBe(false);
  if (process.platform !== 'win32') {
    await symlink(join(outside, 'secret.js'), join(root, 'src/link.js'));
    expect((await substantiateSourceFinding(root, { ...finding(), file: 'src/link.js' }, [{ path: 'src/link.js', hash: digest(code), complete: true }])).verified).toBe(false);
  }
});

it('preserves a material missing-file finding when the delivered missing receipt is still true', async () => {
  const root = await prepare(), missing = { ...finding(), file: 'src/new/Page.tsx' }, original = structuredClone(missing);
  const result = await substantiateSourceFinding(root, missing, [{ path: 'src/new/Page.tsx', hash: null, complete: false, status: 'missing', ranges: [] }]);
  expect(result.verified).toBe(true);
  expect(result.receipt).toMatchObject({ path: 'src/new/Page.tsx', hash: null, exists: false });
  expect(missing).toEqual(original); expect(missing.disposition).toBe('defect');
});

it('does not infer absence from an omitted, unreadable or stale missing-source receipt', async () => {
  const root = await prepare(), missing = { ...finding(), file: 'src/new.js' };
  for (const status of ['omitted', 'unreadable']) expect((await substantiateSourceFinding(root, missing, [{ path: 'src/new.js', hash: null, complete: false, status }])).verified).toBe(false);
  expect((await substantiateSourceFinding(root, finding(), [{ path: 'src/store.js', hash: null, complete: false, status: 'missing' }])).verified).toBe(false);
});

it('never validates an invented quote from a missing file and rejects dangling links to external missing targets', async () => {
  const root = await prepare(), outside = await workspace();
  const quoted = { ...finding({ path: 'src/absent.js', startLine: 1, endLine: 1, quote: 'invented source' }), file: 'src/absent.js' };
  expect((await substantiateSourceFinding(root, quoted, [{ path: 'src/absent.js', hash: null, complete: false, status: 'missing' }])).verified).toBe(false);
  if (process.platform !== 'win32') {
    await symlink(join(outside, 'not-created'), join(root, 'src/dangling'));
    const missing = { ...finding(), file: 'src/dangling/Page.tsx' };
    expect((await substantiateSourceFinding(root, missing, [{ path: 'src/dangling/Page.tsx', hash: null, complete: false, status: 'missing' }])).verified).toBe(false);
  }
});
