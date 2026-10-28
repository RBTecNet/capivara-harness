import { createHash } from 'node:crypto';

/** A structural planning failure is resumable only after its inputs actually change. */
export class PlanningFailure extends Error {
  readonly kind = 'planning';
  readonly recoverable = false;
  readonly fingerprint: string;
  constructor(readonly code: 'no-progress' | 'invalid-plan' | 'missing-requirement' | 'context-capacity', readonly details: string[], readonly scope = 'plan') {
    super(`${scope}: ${details.join('; ')}`);
    this.name = 'PlanningFailure';
    this.fingerprint = createHash('sha256').update(JSON.stringify({ code, scope, details })).digest('hex');
  }
}

/** Repeating an unchanged rejected state is not a recovery strategy. No sleeps hide it. */
export class PlanningProgress {
  private readonly seen = new Set<string>();
  private readonly attempts = new Map<string, number>();
  constructor(private readonly scope: string, private readonly maximumStates = 4) {}
  requireChange(state: unknown, explanation: string, problem = this.scope): void {
    const key = JSON.stringify(state);
    if (this.seen.has(key)) throw new PlanningFailure('no-progress', [explanation, 'O reparo não alterou o estado rejeitado. Uma nova tentativa exige mudança de entrada, capacidade ou estratégia executável.'], this.scope);
    const attempts = this.attempts.get(problem) ?? 0;
    if (attempts >= this.maximumStates) throw new PlanningFailure('no-progress', [explanation, 'As estratégias locais produziram estados distintos sem resolver o mesmo impedimento. O plano foi preservado para uma mudança explícita.'], this.scope);
    this.attempts.set(problem, attempts + 1);
    this.seen.add(key);
  }
}
