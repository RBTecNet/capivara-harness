/**
 * O relatório final do `init`.
 *
 * Diz o que foi decidido, o que foi assumido, o que ficou em aberto e quanto
 * custou. Um harness que só diz "pronto" obriga o desenvolvedor a abrir os
 * quatro documentos para descobrir o que a ferramenta entendeu do pedido dele.
 */

import type { Checkpoint } from "../interview/types.js";
import type { Remark } from "../audit/protocol.js";
import type { Readiness } from "./readiness.js";

export interface RoleCost {
  role: string;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  milliseconds: number;
}

export interface InitReport {
  ready: boolean;
  published: string[];
  phases: number;
  tasks: number;
  mvpCutPhase: number;
  coverage: { stories: number; entities: number; workflows: number };
  checkpoint: Checkpoint;
  remarks: { document: string; remark: Remark }[];
  costs: RoleCost[];
  readiness: Readiness;
}

export function renderReport(report: InitReport): string {
  const lines: string[] = [];

  lines.push("## Artefatos");
  for (const path of report.published) lines.push(`  ${path}`);

  lines.push("", "## Plano");
  lines.push(`  ${report.phases} fase(s), ${report.tasks} task(s); MVP fecha na fase ${report.mvpCutPhase}`);
  lines.push(
    `  cobertura: ${report.coverage.stories} stories · ${report.coverage.entities} entidades · ${report.coverage.workflows} workflows`,
  );

  lines.push("", "## Decisões confirmadas");
  if (report.checkpoint.decisions.length === 0) lines.push("  (nenhuma)");
  for (const decision of report.checkpoint.decisions) lines.push(`  · ${decision.topic}: ${decision.decision}`);

  if (report.checkpoint.assumptions.length > 0) {
    lines.push("", "## Suposições assumidas");
    for (const assumption of report.checkpoint.assumptions) {
      lines.push(`  · ${assumption.topic}: ${assumption.statement} (${assumption.basis})`);
    }
  }

  if (report.checkpoint.deferrals.length > 0 || report.checkpoint.ambiguities.length > 0) {
    lines.push("", "## Em aberto");
    for (const item of [...report.checkpoint.deferrals, ...report.checkpoint.ambiguities]) {
      lines.push(`  · ${item.topic}: ${item.statement}`);
    }
  }

  if (report.remarks.length > 0) {
    lines.push("", "## Ressalvas do auditor (não bloqueantes)");
    for (const entry of report.remarks) {
      lines.push(`  · ${entry.document} · ${entry.remark.where}: ${entry.remark.observation}`);
    }
  }

  lines.push("", "## Custo");
  for (const cost of report.costs) {
    const tokens =
      cost.inputTokens === null || cost.outputTokens === null
        ? "tokens não medidos"
        : `${cost.inputTokens} entrada / ${cost.outputTokens} saída`;
    lines.push(`  ${cost.role.padEnd(9)} ${cost.calls} chamada(s) · ${tokens} · ${Math.round(cost.milliseconds / 1000)}s`);
  }

  lines.push("", report.ready ? "RALPH READY — rode `capivara build` para construir a aplicação." : "NOT READY");
  return lines.join("\n");
}
