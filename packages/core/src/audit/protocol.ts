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

import { phaseReferences } from "../contract/phase-references.js";
import { lerProtocolo } from "../contract/protocolo.js";

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
  /**
   * A classe que o auditor do plano declarou (etapa 2 da redução). Só as de
   * `CLASSES_QUE_BLOQUEIAM` podem devolver o plano, e só depois de o Core
   * conferir o que cada uma exige (`audit/admissibilidade.ts`). Ausente nos
   * achados de outras auditorias, que não usam classe.
   */
  classe?: string;
}

/** As classes de achado que o protocolo reconhece no primeiro campo. */
const CLASSES = /^(?:CONTRADICTION|INTERFACE|DEPENDENCY|OTHER)$/iu;

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
  /**
   * A fase de onde a decisão veio, quando o harness sabe — a auditoria do plano
   * faz uma chamada por fase (§127). Sem ela, a resposta do desenvolvedor
   * chegava como achado sem endereço e ia a TODAS as fases. Ela SOMA às fases
   * que o endereço cita, nunca as substitui (`enderecoDaDecisao`).
   */
  phase?: number;
}

/**
 * O endereço do achado que leva uma decisão de volta (§127): o `where` do
 * auditor, com a fase que o levantou na frente quando ele não a cita. A emenda
 * vai à fase que levantou E às que o endereço nomeia ("P1.T2 e P3.T4"); a
 * triagem de materialidade põe as mesmas fases na mesa.
 */
export function enderecoDaDecisao(decisao: Pick<AuditDecision, "where" | "phase">): string {
  if (decisao.phase === undefined) return decisao.where;
  const citadas = phaseReferences(decisao.where);
  return citadas.includes(decisao.phase) ? decisao.where : `Phase ${decisao.phase} · ${decisao.where}`;
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
  | {
      ok: true;
      verdict: AuditVerdict;
      /**
       * O que o parser consertou sozinho, uma linha por conserto, para o
       * orquestrador anunciar. Vazio quando a resposta já veio no protocolo.
       */
      applied: string[];
    }
  | { ok: false; defects: string[] };

const STATUS = /^CAPIVARA_AUDIT_STATUS:\s*(.+?)\s*$/;
const FINDING = /^CAPIVARA_FINDING:\s*(.*)$/;
const REMARK = /^CAPIVARA_REMARK:\s*(.*)$/;
const DECISION = /^CAPIVARA_DECISION:\s*(.*)$/;
const REASON = /^CAPIVARA_REASON:\s*(.*)$/;

/** As cinco chaves do protocolo, para a leitura tolerante achá-las onde quer que tenham parado. */
const CHAVES = "CAPIVARA_(?:AUDIT_STATUS|FINDING|REMARK|DECISION|REASON)";

/**
 * O travessão no lugar do primeiro "|": o caso do `teste_openrouter3`.
 *
 * O auditor de coerência do run `init-dc741f0d7b92` achou dois defeitos reais
 * — uma rota consumida duas fases antes de ser entregue, e uma contagem que
 * nenhuma decisão autorizava — e escreveu o primeiro como
 * `Architecture — <problema> | <correção>`. Dois campos para o parser, que
 * recusou a resposta inteira; o auditor repetiu o hábito na segunda tentativa,
 * e o `plan` parou com seis fases escritas e os dois achados certos na mão.
 *
 * É defeito de forma com toda a informação presente, e a regra do §34.8 vale:
 * forma não custa um run. Quando um finding tem EXATAMENTE dois campos e o
 * primeiro é `<localização> — <descrição>`, com a localização curta e
 * reconhecível como endereço e a descrição não vazia, ele é lido como os três
 * campos que o protocolo pede. Nada é inventado: os três textos são os que o
 * auditor escreveu, só que separados onde ele quis separar.
 *
 * O que NÃO é recuperado, de propósito: três campos (já está certo), dois
 * campos sem travessão (não há como saber onde a localização acaba), um hífen
 * (aparece dentro de prosa e de identificadores; não é separador inequívoco),
 * uma cabeça que é frase (vírgula, ponto-e-vírgula, mais de quatro palavras),
 * ou uma descrição ou correção vazias.
 */
const TRAVESSAO = /\s[\u2014\u2013]\s/u;

/** Palavras com que o protocolo e os prompts endereçam seções sem número. */
const SECOES_CONHECIDAS =
  /^(?:architecture|arquitetura|overview|stack|phases?|fases?|tasks?|tarefas?|components?|componentes?|contracts?|contratos?|flows?|fluxos?|infrastructure|infraestrutura|data|dados|traces|rules?|regras?|entities|entidades|workflows?|stories|story)$/iu;

function localizacaoReconhecivel(where: string): boolean {
  if (where === "" || where.length > 48) return false;
  if (/[,;!?|]/u.test(where)) return false;
  const palavras = where.split(/\s+/u);
  if (palavras.length > 4) return false;
  return (
    palavras.length === 1 ||
    /\d/u.test(where) ||
    where.includes("·") ||
    SECOES_CONHECIDAS.test(palavras[0] ?? "")
  );
}

function recuperarTravessao(fields: readonly string[]): { fields: string[]; nota: string } | null {
  if (fields.length !== 2) return null;
  const [cabeca, fix] = fields as [string, string];
  const corte = TRAVESSAO.exec(cabeca);
  if (!corte) return null;
  const where = cabeca.slice(0, corte.index).trim();
  const problem = cabeca.slice(corte.index + corte[0].length).trim();
  if (!localizacaoReconhecivel(where) || problem === "" || fix === "") return null;
  return {
    fields: [where, problem, fix],
    nota: `finding em "${where}" veio com travessão no lugar do primeiro "|"; lido como localização | problema | correção, sem nova chamada`,
  };
}

/**
 * O status como o auditor o escreveu, na palavra do protocolo.
 *
 * O prompt pede a resposta na língua do projeto, e o auditor obediente escreve
 * `APROVADO`; outro fecha a linha com ponto. Os dois eram "status inválido", e
 * uma aprovação limpa parava o plano. A palavra é embalagem; o que não é uma
 * delas continua inválido.
 */
const SINONIMOS: Record<string, AuditStatus> = {
  APPROVED: "APPROVED",
  APROVADO: "APPROVED",
  APROVADA: "APPROVED",
  REJECTED: "REJECTED",
  REPROVADO: "REJECTED",
  REPROVADA: "REJECTED",
  REJEITADO: "REJECTED",
  REJEITADA: "REJECTED",
};

function statusDoProtocolo(escrito: string): string {
  const palavra = escrito.trim().replace(/[.!;,]+$/u, "").trim().toUpperCase();
  return SINONIMOS[palavra] ?? palavra;
}

export function parseAudit(rawOutput: string): AuditParse {
  const output = lerProtocolo(rawOutput, CHAVES);
  const defects: string[] = [];
  const applied: string[] = [];
  const statuses: string[] = [];
  const reasons: string[] = [];
  const findings: Finding[] = [];
  const remarks: Remark[] = [];
  const decisions: AuditDecision[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    const status = STATUS.exec(line);
    if (status) {
      // A caixa, o ponto final e a língua são embalagem: "approved.", "APROVADO" são APPROVED.
      statuses.push(statusDoProtocolo(status[1] ?? ""));
      continue;
    }

    const finding = FINDING.exec(line);
    if (finding) {
      let fields = (finding[1] ?? "").split("|").map((field) => field.trim());
      const classe = fields.length >= 4 && CLASSES.test(fields[0] ?? "") ? (fields[0] ?? "").toUpperCase() : undefined;
      if (classe !== undefined) fields = fields.slice(1);
      const recuperado = recuperarTravessao(fields);
      if (recuperado) {
        fields = recuperado.fields;
        applied.push(recuperado.nota);
      }
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
      findings.push({ where: where!, problem: problem!, fix, ...(classe !== undefined ? { classe } : {}) });
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

  const escrito = statuses[0];
  if (escrito !== undefined && escrito !== "APPROVED" && escrito !== "REJECTED") {
    defects.push(`status inválido: "${escrito}"; use APPROVED ou REJECTED`);
  }

  // O motivo ausente é motivo vazio: a aprovação que não diz por quê continua sendo uma aprovação lida.
  if (reasons.length > 1) {
    defects.push("emita exatamente um CAPIVARA_REASON");
  }

  if (escrito === "REJECTED" && findings.length === 0) {
    defects.push("REJECTED sem nenhum CAPIVARA_FINDING; uma devolução sem defeito não diz ao escritor o que corrigir");
  }

  if (defects.length > 0) return { ok: false, defects };

  /*
   * APPROVED com CAPIVARA_FINDING: o status é irrelevante. O achado foi
   * escrito, e quem decide se ele bloqueia é o Core (`admitir`), como qualquer
   * outro — não o rótulo que o acompanha.
   */
  const status: AuditStatus = findings.length > 0 ? "REJECTED" : (escrito as AuditStatus);
  if (escrito === "APPROVED" && findings.length > 0) {
    applied.push(`a auditoria veio APPROVED com ${findings.length} CAPIVARA_FINDING; os achados seguem para a admissibilidade do Core, como qualquer outro`);
  }

  return {
    ok: true,
    verdict: { status, findings, remarks, decisions, reason: reasons[0] ?? "" },
    applied,
  };
}

export function formatVerdict(verdict: AuditVerdict): string {
  const lines = [`CAPIVARA_AUDIT_STATUS: ${verdict.status}`];
  for (const finding of verdict.findings) {
    lines.push(`CAPIVARA_FINDING: ${finding.classe !== undefined ? `${finding.classe} | ` : ""}${finding.where} | ${finding.problem} | ${finding.fix}`);
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
