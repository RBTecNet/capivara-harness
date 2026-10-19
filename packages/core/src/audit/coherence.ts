import { planAddresses } from "../contract/index.js";
import type { AuditVerdict, Finding } from "./protocol.js";

interface Criterion { address: string; text: string; taskTitle: string }
const signature = (criterion: Criterion): string => JSON.stringify([criterion.taskTitle, criterion.text]);

/** Aprovação global vale para a mesma relação, sob a mesma autoridade. */
export class CoherenceMemory {
  private authority: string | undefined;
  private approved = new Map<string, string>();

  /** O estado, para a memória em disco; `null` enquanto nada foi aprovado. */
  exportar(): { authority: string; approved: Record<string, string> } | null {
    return this.authority === undefined ? null : { authority: this.authority, approved: Object.fromEntries(this.approved) };
  }

  /** A base aprovada numa execução anterior, sob a autoridade de então. */
  importar(estado: { authority: string; approved: Record<string, string> } | null): void {
    if (!estado) return;
    this.authority = estado.authority;
    this.approved = new Map(Object.entries(estado.approved));
  }

  changed(criteria: readonly Criterion[], authority: string): string[] | undefined {
    if (this.authority !== authority) return undefined;
    const current = new Map(criteria.map(criterion => [criterion.address, signature(criterion)]));
    return [...new Set([...this.approved.keys(), ...current.keys()])]
      .filter(address => this.approved.get(address) !== current.get(address));
  }

  reconcile(verdict: AuditVerdict, criteria: readonly Criterion[], authority: string): AuditVerdict {
    if (verdict.status === "APPROVED") {
      this.authority = authority;
      this.approved = new Map(criteria.map(criterion => [criterion.address, signature(criterion)]));
      return verdict;
    }
    if (this.authority !== authority) return verdict;
    const current = new Map(criteria.map(criterion => [criterion.address, signature(criterion)]));
    const unchanged = (finding: Finding): boolean => {
      const references = planAddresses(finding.where);
      const keys = new Set(references.map(ref => `P${ref.phase}.T${ref.task}${ref.criterion === undefined ? "" : `.C${ref.criterion}`}`));
      if (keys.size < 2) return false;
      return [...keys].every(key => {
        const resolved = [...current.keys()].filter(address => address === key || address.startsWith(`${key}.C`));
        const previous = [...this.approved.keys()].filter(address => address === key || address.startsWith(`${key}.C`));
        return resolved.length > 0 && resolved.length === previous.length
          && resolved.every(address => current.get(address) === this.approved.get(address));
      });
    };
    const repeated = verdict.findings.filter(unchanged);
    if (repeated.length === 0) return verdict;
    const findings = verdict.findings.filter(finding => !repeated.includes(finding));
    return {
      ...verdict, status: findings.length === 0 ? "APPROVED" : "REJECTED", findings,
      remarks: [...verdict.remarks, ...repeated.map(finding => ({
        where: finding.where,
        observation: `${finding.problem} (coerência já aprovada: referências e decisões não mudaram; nenhuma evidência nova citada)`,
      }))],
    };
  }
}
