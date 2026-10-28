import { describe, expect, it } from 'vitest';
import { classifyReviewFailure, interpretReview } from '../../src/execution/review.js';

describe('protocolo de revisão RC2', () => {
  it('preserva defeito concreto mesmo quando o parecer o rotula como estilo ou cobrança de testes', () => {
    const original = JSON.stringify({ approved: false, findings: [{
      severity: 'style', material: false,
      observed: 'Missing tests: executing the CLI cannot create the SQLite database: EROFS.',
      expected: 'The documented CLI creates the database in the supplied writable data directory.',
      evidence: 'Actual exit code 1; open(/work/data/app.sqlite) failed.',
      fix: 'Resolve the database path and supply a writable location.',
    }] });
    const result = interpretReview(original);
    expect(result.findings).toHaveLength(1);
    expect(result).toMatchObject({ decision: 'rejected', original });
  });

  it('torna explícita uma reprovação sem achados em vez de aprovar ou esclarecer indefinidamente', () => {
    const original = '{"approved":false,"findings":[]}';
    const result = interpretReview(original);
    expect(result).toMatchObject({ decision: 'unresolved', approved: false, original });
    expect(result.transformations.some(change => change.reason.startsWith('rejection-without-actionable-findings'))).toBe(true);
  });

  it('preserva sugestões e exige resolução explícita quando todos os achados da reprovação são consultivos', () => {
    const original = JSON.stringify({ approved: false, findings: [{ material: false, message: 'Prefer another code style.' }] });
    const result = interpretReview(original);
    expect(result).toMatchObject({ decision: 'unresolved', approved: false, original });
    expect(result.findings).toHaveLength(1);
    expect(result.advisories).toHaveLength(1);
    expect(result.actionableFindings).toHaveLength(0);
    expect(result.transformations).toHaveLength(2);
  });

  it('não aceita aprovação contraditória nem interpreta elogio dentro de uma reprovação como aprovação', () => {
    const original = JSON.stringify({ approved: true, issues: [{ kind: 'product', observed: 'Command exits 1.', expected: 'Command exits 0.', evidence: 'Observed on the declared CLI.', fix: 'Repair the branch.' }] });
    const result = interpretReview(original);
    expect(result.decision).toBe('rejected');
    expect(result.actionableFindings[0]?.text).toContain('Observed on the declared CLI.');
    expect(interpretReview('No material defects were found in parsing, but saving fails.').approved).toBe(false);
    expect(interpretReview('The implementation fails. An example response would be {"approved":true,"findings":[]}').decision).toBe('unresolved');
    expect(interpretReview('Approved.')).toMatchObject({ decision: 'approved', findings: [] });
  });

  it('classifica restrição do sandbox pelo contexto sem apagar o mesmo defeito em ambiente gravável', () => {
    const failure = { exitCode: 1, stdout: '', stderr: 'EROFS: read-only file system, open /work/data/app.sqlite', cancelled: false, timedOut: false };
    expect(classifyReviewFailure(failure, { purpose: 'verification', writeScope: 'read-only' })).toBe('instrument');
    expect(classifyReviewFailure(failure, { purpose: 'verification', writeScope: 'isolated-workspace', sandboxApplied: true })).toBe('instrument');
    expect(classifyReviewFailure(failure, { purpose: 'verification', writeScope: 'isolated-workspace' })).toBe('product');
    expect(classifyReviewFailure({ ...failure, exitCode: 0 }, { purpose: 'verification', writeScope: 'read-only' })).toBeNull();
  });
});
