/**
 * O protocolo do auditor.
 *
 * Texto plano, cada chave na primeira coluna. Não é Markdown: um bloco cercado,
 * um marcador de lista ou indentação quebram o parse, e é por isso que o prompt
 * diz isso com todas as letras.
 *
 * Saída estruturalmente inválida repete SÓ o auditor, sobre a mesma evidência.
 * O escritor não paga por um erro de formato de quem o auditou.
 */

export type AuditStatus = "APPROVED" | "REJECTED";

export interface Finding {
  /** Seção ou ID onde está o defeito. */
  where: string;
  /** O que está errado. */
  problem: string;
  /** Como corrigir. Sem isso, a devolução não ajuda quem escreve. */
  fix: string;
}

export interface Remark {
  where: string;
  observation: string;
}

export interface AuditVerdict {
  status: AuditStatus;
  findings: Finding[];
  remarks: Remark[];
  reason: string;
}

export type AuditParse =
  | { ok: true; verdict: AuditVerdict }
  | { ok: false; defects: string[] };

const STATUS = /^CAPIVARA_AUDIT_STATUS:\s*(.+?)\s*$/;
const FINDING = /^CAPIVARA_FINDING:\s*(.*)$/;
const REMARK = /^CAPIVARA_REMARK:\s*(.*)$/;
const REASON = /^CAPIVARA_REASON:\s*(.*)$/;

export function parseAudit(output: string): AuditParse {
  const defects: string[] = [];
  const statuses: string[] = [];
  const reasons: string[] = [];
  const findings: Finding[] = [];
  const remarks: Remark[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    const status = STATUS.exec(line);
    if (status) {
      statuses.push((status[1] ?? "").trim());
      continue;
    }

    const finding = FINDING.exec(line);
    if (finding) {
      const fields = (finding[1] ?? "").split("|").map((field) => field.trim());
      if (fields.length < 3 || fields.slice(0, 3).some((field) => field === "")) {
        defects.push(
          `finding incompleto: "${line.trim()}" — todo CAPIVARA_FINDING traz três campos separados por "|": onde | o que está errado | como corrigir`,
        );
        continue;
      }
      const [where, problem, ...rest] = fields;
      const fix = rest.join(" | ").trim();
      if (fix === problem) {
        defects.push(`o terceiro campo do finding em "${where}" apenas repete o problema; ele deve dizer o que fazer`);
        continue;
      }
      findings.push({ where: where!, problem: problem!, fix });
      continue;
    }

    const remark = REMARK.exec(line);
    if (remark) {
      const fields = (remark[1] ?? "").split("|").map((field) => field.trim());
      if (fields.length < 2 || fields[0] === "" || fields[1] === "") {
        defects.push(`ressalva incompleta: "${line.trim()}" — use onde | observação`);
        continue;
      }
      remarks.push({ where: fields[0]!, observation: fields.slice(1).join(" | ").trim() });
      continue;
    }

    const reason = REASON.exec(line);
    if (reason) reasons.push((reason[1] ?? "").trim());
  }

  if (statuses.length !== 1) {
    defects.push(
      statuses.length === 0
        ? "nenhum CAPIVARA_AUDIT_STATUS na resposta"
        : `${statuses.length} linhas CAPIVARA_AUDIT_STATUS; emita exatamente uma`,
    );
  }

  const status = statuses[0];
  if (status !== undefined && status !== "APPROVED" && status !== "REJECTED") {
    defects.push(`status inválido: "${status}"; use APPROVED ou REJECTED`);
  }

  if (reasons.length !== 1 || (reasons[0] ?? "") === "") {
    defects.push("emita exatamente um CAPIVARA_REASON, não vazio");
  }

  if (status === "REJECTED" && findings.length === 0) {
    defects.push("REJECTED sem nenhum CAPIVARA_FINDING; uma devolução sem defeito não diz ao escritor o que corrigir");
  }

  if (status === "APPROVED" && findings.length > 0) {
    defects.push("APPROVED com CAPIVARA_FINDING; o que não bloqueia é CAPIVARA_REMARK");
  }

  if (defects.length > 0) return { ok: false, defects };

  return {
    ok: true,
    verdict: { status: status as AuditStatus, findings, remarks, reason: reasons[0] ?? "" },
  };
}

export function formatVerdict(verdict: AuditVerdict): string {
  const lines = [`CAPIVARA_AUDIT_STATUS: ${verdict.status}`];
  for (const finding of verdict.findings) {
    lines.push(`CAPIVARA_FINDING: ${finding.where} | ${finding.problem} | ${finding.fix}`);
  }
  for (const remark of verdict.remarks) {
    lines.push(`CAPIVARA_REMARK: ${remark.where} | ${remark.observation}`);
  }
  lines.push(`CAPIVARA_REASON: ${verdict.reason}`);
  return lines.join("\n");
}
