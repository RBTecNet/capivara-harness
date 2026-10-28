import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { digest } from './files.js';
import type { ReviewFinding } from './review.js';

/** Engine receipts describe source actually supplied, rather than a model's claim to have read it. */
export interface SourceReviewCoverage {
  path: string;
  hash: string | null;
  complete: boolean;
  status?: string;
  startLine?: number;
  endLine?: number;
  ranges?: readonly { startLine: number; endLine: number }[];
}
export interface SourceFindingEvidence {
  path: string;
  hash?: string;
  startLine?: number;
  endLine?: number;
  quote?: string;
  scope?: 'range' | 'whole-file';
  /** Polarity is declared structurally; the controller never guesses it from narrative keywords. */
  claim?: 'quoted-source' | 'absence';
}
export interface SourceFindingReceipt {
  path: string;
  hash: string | null;
  exists?: boolean;
  complete: boolean;
  startLine: number;
  endLine: number;
  quote?: string;
}
export interface SourceFindingSubstantiation {
  verified: boolean;
  reason: string;
  receipt?: SourceFindingReceipt;
}
type Finding = Pick<ReviewFinding, 'file' | 'original'> & { sourceEvidence?: unknown };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const denied = (reason: string): SourceFindingSubstantiation => ({ verified: false, reason });
const normalized = (value: string): string => value.replaceAll('\\', '/');

async function safeSource(workspace: string, path: string, allowMissing = false): Promise<{ path: string; absolute: string; exists: boolean }> {
  const base = resolve(workspace), absolute = resolve(base, path), lexical = relative(base, absolute);
  if (!lexical || lexical === '..' || lexical.startsWith(`..${sep}`)) throw new Error('The cited source path is outside the project.');
  const canonicalRoot = await realpath(base);
  const within = (candidate: string): void => {
    const actual = relative(canonicalRoot, candidate);
    if (!actual || actual === '..' || actual.startsWith(`..${sep}`)) throw new Error('The cited source link escapes the project.');
  };
  const inspect = async (candidate: string, depth = 0): Promise<{ canonical: string; exists: boolean }> => {
    within(candidate);
    if (depth > 32) throw new Error('The cited source link cannot be resolved safely.');
    try { const canonical = await realpath(candidate); within(canonical); return { canonical, exists: true }; }
    catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // ENOENT is meaningful only after validating its existing ancestors and
      // dangling links. A missing target outside the workspace is not a product receipt.
      let ancestor = candidate;
      for (;;) {
        const info = await lstat(ancestor).catch(failure => { if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failure; });
        if (info?.isSymbolicLink()) return inspect(resolve(dirname(ancestor), await readlink(ancestor), relative(ancestor, candidate)), depth + 1);
        if (info) {
          const parent = await realpath(ancestor), rel = relative(canonicalRoot, parent);
          if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('The missing source ancestor escapes the project.');
          const canonical = resolve(parent, relative(ancestor, candidate)); within(canonical);
          return { canonical, exists: false };
        }
        const parent = dirname(ancestor);
        if (parent === ancestor) throw new Error('The missing source has no verifiable project ancestor.');
        ancestor = parent;
      }
    }
  };
  const selected = await inspect(resolve(canonicalRoot, lexical));
  return { path: normalized(relative(canonicalRoot, selected.canonical)), absolute, exists: selected.exists };
}

/**
 * Substantiates access to current source and literal quotations. It does not
 * approve the product or decide whether a semantic defect is correct. Findings
 * and their original verdict remain untouched when more source is required.
 */
export async function substantiateSourceFinding(workspace: string, finding: Finding, coverage: readonly SourceReviewCoverage[]): Promise<SourceFindingSubstantiation> {
  const raw = finding.sourceEvidence ?? (record(finding.original) ? finding.original.sourceEvidence : undefined);
  if (raw !== undefined && !record(raw)) return denied('The sourceEvidence certificate is malformed; recover its source reference without editing the product.');
  const certificate = record(raw) ? raw : undefined;
  const path = certificate?.path ?? finding.file;
  if (typeof path !== 'string' || !path.trim()) return denied('The source finding has no concrete file reference; supply the current source before authorizing an edit.');
  if (certificate && (typeof certificate.path !== 'string' || !certificate.path.trim())) return denied('An explicit sourceEvidence certificate needs its own path.');
  let selected: Awaited<ReturnType<typeof safeSource>>, bytes: Buffer;
  try { selected = await safeSource(workspace, path, true); }
  catch (error) { return denied(`The cited current source is unavailable or outside the workspace: ${error instanceof Error ? error.message : String(error)}`); }
  if (!selected.exists) {
    const receipts: SourceReviewCoverage[] = [];
    for (const receipt of coverage) {
      if (receipt.status !== 'missing' || receipt.hash !== null) continue;
      try { const current = await safeSource(workspace, receipt.path, true); if (!current.exists && current.path === selected.path) receipts.push(receipt); }
      catch { /* A permission or ancestor failure is not evidence of source absence. */ }
    }
    if (!receipts.length) return denied('The file is currently absent, but no matching missing-source receipt was supplied to the reviewer. Resolve the original claim against the current source inventory.');
    if (certificate) {
      if (finding.file) {
        try { if ((await safeSource(workspace, finding.file, true)).path !== selected.path) return denied('The missing finding file and sourceEvidence path refer to different files.'); }
        catch { return denied('The missing finding file cannot be safely reconciled with sourceEvidence.'); }
      }
      if (certificate.quote !== undefined || certificate.hash !== undefined && certificate.hash !== null || certificate.claim !== 'absence' || certificate.scope !== 'whole-file') return denied('An absent file cannot substantiate a quoted source certificate. Use the current missing-source receipt for an explicit absence claim.');
    }
    return { verified: true, reason: 'A supplied missing-source receipt is confirmed by current ENOENT with safe project ancestors. Preserve the material missing-file finding; creating the required source is an executable product repair.', receipt: { path: selected.path, hash: null, exists: false, complete: true, startLine: 0, endLine: 0 } };
  }
  try { bytes = await readFile(selected.absolute); }
  catch (error) { return denied(`The cited source could not be read consistently: ${error instanceof Error ? error.message : String(error)}`); }
  if (bytes.includes(0)) return denied('The cited file is not a text source; obtain an appropriate executable or binary proof.');
  const hash = digest(bytes), lines = bytes.toString('utf8').split(/\r?\n/);
  const receipts: SourceReviewCoverage[] = [];
  for (const receipt of coverage) {
    try { if ((await safeSource(workspace, receipt.path)).path === selected.path && receipt.hash === hash) receipts.push(receipt); }
    catch { /* An unavailable or unsafe coverage receipt cannot authorize an edit. */ }
  }
  const full = receipts.some(receipt => receipt.complete);
  if (!certificate) return full ? {
    verified: true,
    reason: 'The complete current file was supplied. Preserve the material source finding for review; no certificate overhead is required for a fully supplied file.',
    receipt: { path: selected.path, hash, exists: true, complete: true, startLine: 1, endLine: lines.length },
  } : denied('The finding cites source that was omitted, excerpted or changed since delivery. Supply the complete current file and resolve the original finding before requesting a product edit.');
  if (finding.file) {
    try { if ((await safeSource(workspace, finding.file)).path !== selected.path) return denied('The finding file and its sourceEvidence path refer to different files; resolve the citation without editing code.'); }
    catch { return denied('The finding file cannot be reconciled with its sourceEvidence path.'); }
  }
  if (certificate.hash !== undefined && (typeof certificate.hash !== 'string' || certificate.hash !== hash)) return denied('The sourceEvidence hash does not identify the current file; fetch current source before resolving the finding.');
  if (certificate.scope !== undefined && certificate.scope !== 'range' && certificate.scope !== 'whole-file') return denied('The sourceEvidence scope is invalid.');
  if (certificate.claim !== undefined && certificate.claim !== 'quoted-source' && certificate.claim !== 'absence') return denied('The sourceEvidence claim is invalid.');
  if (certificate.claim === 'absence' && certificate.scope !== 'whole-file') return denied('An absence claim requires whole-file scope and complete current source coverage; a range cannot establish absence elsewhere.');
  if (certificate.scope === 'whole-file' && !full) return denied('The whole-file claim has only incomplete or stale source coverage. Supply the complete current file before resolving the finding.');
  if (certificate.claim === 'absence' && certificate.quote === undefined) return {
    verified: true,
    reason: 'The absence claim refers to a complete current source receipt. Its semantic validity remains the reviewer’s responsibility; no defect was discarded.',
    receipt: { path: selected.path, hash, exists: true, complete: true, startLine: 1, endLine: lines.length },
  };
  const start = certificate.startLine, end = certificate.endLine, quote = certificate.quote;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1 || typeof end !== 'number' || !Number.isInteger(end) || end < start || end > lines.length) return denied('The sourceEvidence line range does not exist in the current file.');
  if (typeof quote !== 'string' || !quote.trim()) return denied('The sourceEvidence certificate needs a nonempty literal source quotation.');
  const actual = lines.slice(start - 1, end).join('\n'), literal = quote.replaceAll('\r\n', '\n');
  if (!actual.includes(literal)) return denied('The sourceEvidence quote is absent from the declared current lines; resolve the original finding with actual source before editing.');
  return {
    verified: true,
    reason: 'The literal source quotation and its line range match current bytes. The material finding remains preserved for semantic review.',
    receipt: { path: selected.path, hash, exists: true, complete: full, startLine: start, endLine: end, quote },
  };
}
