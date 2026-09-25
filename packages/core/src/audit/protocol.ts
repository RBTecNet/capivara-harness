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

import { desgrudarChaves } from "../contract/protocolo.js";

export type AuditStatus = "APPROVED" | "REJECTED";

export interface Finding {
  /** Seção ou ID onde está o defeito. */
  where: string;
  /** O que está errado. */
  problem: string;
  /** Como corrigir. Sem isso, a devolução não ajuda quem escreve. */
  fix: string;
  /**
   * Veio da conferência MECÂNICA, não do julgamento do auditor.
   *
   * A diferença decide quem resolve. "A task declara 5 critérios de aceite" é
   * aritmética: 5 é maior que 4, não há duas leituras possíveis, e perguntar ao
   * desenvolvedor qual delas vale é pedir que ele arbitre uma contagem. Já "a
   * decisão aceita exige exclusividade global" é leitura — e é dele.
   */
  mechanical?: boolean;
  /**
   * A fase a que o achado pertence, quando QUEM CHAMOU sabe.
   *
   * Não é o auditor que informa: ele escreve prosa, e medido no `assistencia2`
   * **24 de 25 achados não citavam a fase** — não por descuido, mas porque a
   * auditoria por fase já sabe de qual fase se trata e o endereço que ele escreve
   * é o título da task.
   *
   * Sem este campo, `affectedPhases` caía no seu fallback — "sem referência
   * utilizável, todas as fases" — e o resultado era o pior dos dois mundos: os 24
   * achados sem fase não eram entregues a ninguém, porque o único achado COM fase
   * definia sozinho o que reescrever; e a fase que ele nomeava era reescrita mesmo
   * já aprovada, perdendo a aprovação. O auditor reprovava tudo, para sempre, e as
   * fases aprovadas voltavam à fila.
   */
  phase?: number;
}

export interface Remark {
  where: string;
  observation: string;
}

/**
 * O que o auditor não pode decidir — e o escritor também não.
 *
 * O auditor tinha dois canais e nenhum deles chegava a tempo a quem decide: o
 * finding vai para o escritor, e a ressalva vai para o relatório, que só é lido
 * depois de o run terminar. Quando o que falta é uma DECISÃO — nenhuma fonte diz
 * qual das duas leituras vale —, mandar isso ao escritor é pedir que ele invente,
 * e mandar à ressalva é contar ao desenvolvedor depois que já não havia o que
 * fazer.
 *
 * O caminho até o desenvolvedor existia, mas era caro: ele só abria quando o
 * MESMO achado voltava pela segunda vez (o levantamento de auditoria) ou quando o
 * teto de devoluções estourava. Um ciclo inteiro de escrita e auditoria para
 * chegar a uma pergunta de dez segundos que o auditor já sabia fazer na primeira
 * leitura.
 *
 * As duas leituras são obrigatórias: uma decisão sem alternativas é pergunta
 * discursiva, e pergunta discursiva entra em laço — é a regra do §71, e ela vale
 * para quem quer que levante a pergunta.
 */
export interface AuditDecision {
  where: string;
  /** A decisão que falta, em forma de pergunta objetiva. */
  decision: string;
  /** As leituras possíveis, ao menos duas, cada uma respondendo a decisão inteira. */
  options: string[];
}

export interface AuditVerdict {
  status: AuditStatus;
  findings: Finding[];
  remarks: Remark[];
  /**
   * As decisões que o auditor devolveu ao desenvolvedor.
   *
   * Opcional porque o self-check mecânico monta vereditos à mão e nunca levanta
   * decisão: contagem não tem duas leituras. Quem vem do parser traz sempre a
   * lista, vazia quando não houve nenhuma.
   */
  decisions?: AuditDecision[];
  reason: string;
  /**
   * Verdadeiro quando a reprovação veio de um self-check, não do auditor.
   *
   * Defeito mecânico não é discordância: ele é determinístico, verificável em
   * código, e o escritor converge para ele — no piloto 3 uma fase foi de 74
   * critérios para 61 em uma devolução. Contar isso contra o teto de devoluções
   * do auditor esgotou o orçamento em contagem e sobrou uma rodada só para o
   * desacordo de verdade.
   */
  mechanical?: boolean;
}

export type AuditParse =
  | { ok: true; verdict: AuditVerdict }
  | { ok: false; defects: string[] };

const STATUS = /^CAPIVARA_AUDIT_STATUS:\s*(.+?)\s*$/;
const FINDING = /^CAPIVARA_FINDING:\s*(.*)$/;
const REMARK = /^CAPIVARA_REMARK:\s*(.*)$/;
const DECISION = /^CAPIVARA_DECISION:\s*(.*)$/;
const REASON = /^CAPIVARA_REASON:\s*(.*)$/;

/** As cinco chaves do protocolo, para achá-las onde quer que tenham parado. */
const CHAVES = "CAPIVARA_(?:AUDIT_STATUS|FINDING|REMARK|DECISION|REASON)";

/**
 * Tolerar a embalagem, nunca o conteúdo.
 *
 * O plano do `MCP_teste2` morreu por uma quebra de linha. O auditor escreveu
 * "Vou conferir o calendário das datas…CAPIVARA_AUDIT_STATUS: APPROVED" — a
 * frase de abertura e a chave grudadas, sem `\n` no meio. O veredito era bom:
 * aprovado, com uma ressalva e um motivo. O parser não achou a chave na coluna
 * 1, o auditor repetiu o mesmo hábito na segunda tentativa, e o run inteiro
 * parou com oito fases prontas e duas emendas pendentes.
 *
 * Isso é defeito de forma, e defeito de forma não pode custar um run — é a mesma
 * regra do §34.8. O verificador do build já lê as linhas TASK "ignorando prosa
 * em volta e indentação acidental"; aqui a régua era outra, e a diferença só
 * aparecia com um modelo de hábitos diferentes.
 *
 * O que é tolerado: a chave colada no fim de uma frase, indentação, um marcador
 * de lista na frente e o negrito do Markdown em volta. O que NÃO é tolerado
 * continua igual: três campos num finding, um status, um motivo.
 */
export function desembrulhar(output: string): string {
  return desgrudarChaves(output, `${CHAVES}:`)
    .split("\n")
    .map((linha) =>
      linha
        .trim()
        // Marcador de lista ou citação antes da chave.
        .replace(new RegExp(`^[-*>\\s]+(?=\\*{0,2}${CHAVES})`), "")
        // O negrito que sobrou depois da chave: **CAPIVARA_FINDING:** …
        // O de antes já saiu com o marcador, porque `*` está na classe acima.
        .replace(new RegExp(`^(${CHAVES}:)\\*\\*`), "$1"),
    )
    .join("\n");
}

export function parseAudit(rawOutput: string): AuditParse {
  const output = desembrulhar(rawOutput);
  const defects: string[] = [];
  const statuses: string[] = [];
  const reasons: string[] = [];
  const findings: Finding[] = [];
  const remarks: Remark[] = [];
  const decisions: AuditDecision[] = [];

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

    const decision = DECISION.exec(line);
    if (decision) {
      const fields = (decision[1] ?? "").split("|").map((field) => field.trim()).filter((field) => field !== "");
      if (fields.length < 4) {
        defects.push(
          `decisão incompleta: "${line.trim()}" — todo CAPIVARA_DECISION traz onde | a decisão que falta | ` +
            "uma leitura | outra leitura, com ao menos duas leituras",
        );
        continue;
      }
      const [where, pergunta, ...leituras] = fields;
      decisions.push({ where: where!, decision: pergunta!, options: leituras });
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
    verdict: { status: status as AuditStatus, findings, remarks, decisions, reason: reasons[0] ?? "" },
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
  for (const decision of verdict.decisions ?? []) {
    lines.push(`CAPIVARA_DECISION: ${decision.where} | ${decision.decision} | ${decision.options.join(" | ")}`);
  }
  lines.push(`CAPIVARA_REASON: ${verdict.reason}`);
  return lines.join("\n");
}
