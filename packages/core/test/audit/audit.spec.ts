import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_RETURNS,
  formatVerdict,
  nextAuditAction,
  parseAudit,
  persistentFindings,
  renderStandoff,
  writerDid,
} from "../../src/audit/index.js";
import type { AuditAttempt, AuditVerdict } from "../../src/audit/index.js";
import { auditorPrompt } from "../../src/prompts/index.js";

const approved = ["CAPIVARA_AUDIT_STATUS: APPROVED", "CAPIVARA_REASON: fiel ao prompt e às decisões aceitas"].join("\n");
const rejected = [
  "CAPIVARA_AUDIT_STATUS: REJECTED",
  "CAPIVARA_FINDING: US-1.2 | o critério \"funciona corretamente\" não é verificável | substitua por uma condição observável com limite numérico",
  "CAPIVARA_REASON: critério não binário em US-1.2",
].join("\n");

describe("protocolo do auditor", () => {
  it("lê uma aprovação", () => {
    const parsed = parseAudit(approved);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.verdict.status).toBe("APPROVED");
  });

  it("lê uma devolução com finding de três campos", () => {
    const parsed = parseAudit(rejected);
    if (!parsed.ok) throw new Error(parsed.defects.join("; "));
    expect(parsed.verdict.findings[0]).toMatchObject({ where: "US-1.2" });
    expect(parsed.verdict.findings[0]?.fix).toContain("condição observável");
  });

  it("tolera CRLF e espaços em volta dos valores", () => {
    const parsed = parseAudit("CAPIVARA_AUDIT_STATUS:   APPROVED  \r\nCAPIVARA_REASON:  ok  \r\n");
    expect(parsed.ok).toBe(true);
  });

  it("ignora prosa em volta do bloco", () => {
    expect(parseAudit(`Claro! Aqui vai:\n${approved}\nEspero ter ajudado.`).ok).toBe(true);
  });

  it("faz round-trip com formatVerdict", () => {
    const parsed = parseAudit(rejected);
    if (!parsed.ok) throw new Error("esperava veredito");
    expect(parseAudit(formatVerdict(parsed.verdict))).toEqual(parsed);
  });
});

describe("saída inválida repete só o auditor", () => {
  const defectsOf = (output: string): string[] => {
    const parsed = parseAudit(output);
    return parsed.ok ? [] : parsed.defects;
  };

  it("REJECTED sem finding", () => {
    const defects = defectsOf("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_REASON: ruim");
    expect(defects.join(" ")).toContain("sem nenhum CAPIVARA_FINDING");
  });

  it("finding sem o campo de correção", () => {
    const defects = defectsOf("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: US-1.2 | está errado\nCAPIVARA_REASON: x");
    expect(defects.join(" ")).toContain("três campos");
  });

  it("finding cuja correção apenas repete o problema", () => {
    const defects = defectsOf(
      "CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: US-1.2 | critério vago | critério vago\nCAPIVARA_REASON: x",
    );
    expect(defects.join(" ")).toContain("apenas repete o problema");
  });

  it("APPROVED com finding", () => {
    const defects = defectsOf(
      "CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_FINDING: a | b | c\nCAPIVARA_REASON: x",
    );
    expect(defects.join(" ")).toContain("APPROVED com CAPIVARA_FINDING");
  });

  it("status ausente, duplicado ou inventado", () => {
    expect(defectsOf("CAPIVARA_REASON: x").join(" ")).toContain("nenhum CAPIVARA_AUDIT_STATUS");
    expect(defectsOf(`${approved}\nCAPIVARA_AUDIT_STATUS: REJECTED`).join(" ")).toContain("exatamente uma");
    expect(defectsOf("CAPIVARA_AUDIT_STATUS: TALVEZ\nCAPIVARA_REASON: x").join(" ")).toContain("status inválido");
  });

  it("razão ausente ou vazia", () => {
    expect(defectsOf("CAPIVARA_AUDIT_STATUS: APPROVED").join(" ")).toContain("CAPIVARA_REASON");
    expect(defectsOf("CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON:   ").join(" ")).toContain("CAPIVARA_REASON");
  });

  it("aprovação com ressalva é válida e não bloqueia", () => {
    const parsed = parseAudit(`CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REMARK: Overview | poderia citar o limite de reservas\nCAPIVARA_REASON: ok`);
    if (!parsed.ok) throw new Error(parsed.defects.join("; "));
    expect(parsed.verdict.remarks).toHaveLength(1);
  });
});

describe("ciclo de devolução", () => {
  const verdict = (status: "APPROVED" | "REJECTED", where = "US-1.2"): AuditVerdict => ({
    status,
    findings: status === "REJECTED" ? [{ where, problem: "critério vago", fix: "use um limite numérico" }] : [],
    remarks: [],
    reason: "r",
  });

  const attempt = (n: number, status: "APPROVED" | "REJECTED", where?: string): AuditAttempt => ({
    attempt: n,
    verdict: verdict(status, where),
    contentSha: `sha-${n}`,
  });

  it("aprovado publica", () => {
    const action = nextAuditAction({ document: "user-stories.md", history: [attempt(1, "APPROVED")], maxReturns: 3, maxMechanical: 3 });
    expect(action.action).toBe("publish");
  });

  it("devolve ao escritor enquanto houver teto", () => {
    const action = nextAuditAction({ document: "user-stories.md", history: [attempt(1, "REJECTED")], maxReturns: 3, maxMechanical: 3 });
    expect(action.action).toBe("return-to-writer");
    if (action.action === "return-to-writer") expect(action.findings[0]?.fix).toContain("limite numérico");
  });

  it("esgotado o teto, pergunta ao desenvolvedor em vez de aceitar ou desistir", () => {
    const history = [attempt(1, "REJECTED"), attempt(2, "REJECTED"), attempt(3, "REJECTED")];
    const action = nextAuditAction({ document: "user-stories.md", history, maxReturns: DEFAULT_MAX_RETURNS, maxMechanical: 3 });
    expect(action.action).toBe("ask-developer");
    if (action.action !== "ask-developer") return;
    expect(action.standoff.returns).toBe(3);
    expect(action.standoff.writerDid).toHaveLength(3);
  });

  it("o impasse mostra lado a lado a insistência do auditor e o que o escritor fez", () => {
    const history = [attempt(1, "REJECTED", "US-1.2"), attempt(2, "REJECTED", "US-2.1"), attempt(3, "REJECTED", "US-1.2")];
    const action = nextAuditAction({ document: "user-stories.md", history, maxReturns: 3, maxMechanical: 3 });
    if (action.action !== "ask-developer") throw new Error("esperava impasse");
    const texto = renderStandoff(action.standoff);
    expect(texto).toContain("O auditor insiste em:");
    expect(texto).toContain("O escritor fez:");
    expect(texto).toContain("gap de entrevista");
  });

  it("findings equivalentes não são contados duas vezes no impasse", () => {
    const history = [attempt(1, "REJECTED", "US-1.2"), attempt(2, "REJECTED", "US-1.2")];
    expect(persistentFindings(history)).toHaveLength(1);
  });

  /*
   * O resumo era `tentativa N: escreveu <documento>`, repetido uma vez por
   * tentativa. Chamado a desempatar, o desenvolvedor via quatro linhas
   * idênticas: nem se o texto tinha mudado, nem o que o escritor fechou.
   *
   * Ninguém pode perguntar ao escritor o que ele fez — ele escreve em sessão
   * nova a cada volta. Mas o auditor leu as duas versões, e a diferença entre
   * os vereditos é exatamente isso.
   */
  describe("o que o escritor fez, medido pelo que o auditor deixou de apontar", () => {
    const comFindings = (n: number, sha: string, onde: string[]): AuditAttempt => ({
      attempt: n,
      contentSha: sha,
      verdict: {
        status: "REJECTED",
        findings: onde.map((where) => ({ where, problem: "critério vago", fix: "use um limite" })),
        remarks: [],
        reason: "r",
      },
    });

    it("a primeira tentativa diz quantos pontos o auditor apontou", () => {
      expect(writerDid([comFindings(1, "a", ["US-1.2", "US-2.1"])])[0]).toBe(
        "tentativa 1: escreveu o documento; o auditor apontou 2 ponto(s)",
      );
    });

    it("conta o que fechou, o que seguiu aberto e o que apareceu novo", () => {
      const historia = [comFindings(1, "a", ["US-1.2", "US-2.1"]), comFindings(2, "b", ["US-2.1", "US-3.9"])];
      expect(writerDid(historia)[1]).toBe("tentativa 2: reescreveu — fechou 1 de 2, 1 seguiu(ram) aberto(s), 1 apareceu(ram) novo(s)");
    });

    it("quando tudo fecha, não sobra ruído na linha", () => {
      const historia = [comFindings(1, "a", ["US-1.2"]), comFindings(2, "b", [])];
      expect(writerDid(historia)[1]).toBe("tentativa 2: reescreveu — fechou 1 de 1");
    });

    /*
     * O fato que decide se a pergunta ao desenvolvedor é sobre o produto ou
     * sobre o prompt: reenviar o mesmo texto byte a byte não é desacordo de
     * conteúdo, é o escritor sem saber o que fazer com o pedido.
     */
    it("texto idêntico é dito como tal, e não como 'reescreveu'", () => {
      const historia = [comFindings(1, "a", ["US-1.2"]), comFindings(2, "a", ["US-1.2"])];
      expect(writerDid(historia)[1]).toBe("tentativa 2: devolveu o MESMO texto, sem uma alteração sequer");
    });

    it("o impasse renderizado carrega esse fato para o desenvolvedor", () => {
      const historia = [comFindings(1, "a", ["US-1.2"]), comFindings(2, "a", ["US-1.2"]), comFindings(3, "a", ["US-1.2"])];
      const action = nextAuditAction({ document: "x.md", history: historia, maxReturns: 3, maxMechanical: 3 });
      if (action.action !== "ask-developer") throw new Error("esperava impasse");
      expect(renderStandoff(action.standoff)).toContain("devolveu o MESMO texto");
    });
  });

  it("uma aprovação depois de devoluções publica e encerra", () => {
    const history = [attempt(1, "REJECTED"), attempt(2, "APPROVED")];
    expect(nextAuditAction({ document: "x.md", history, maxReturns: 3, maxMechanical: 3 }).action).toBe("publish");
  });
});

describe("prompt do auditor", () => {
  const context = {
    language: "português do Brasil",
    document: "user-stories.md",
    executable: false,
    request: "um sistema de reservas",
    decisions: ["Stack: Node"],
    dispositions: ["Q-01 ACCEPTED"],
    upstream: [],
    upstreamRemarks: [],
    content: "# X — User Stories",
  };

  it("o eixo de executabilidade só aparece no plano executável", () => {
    expect(auditorPrompt(context)).not.toContain("EXECUTABILITY");
    expect(auditorPrompt({ ...context, document: "project-phases.md", executable: true })).toContain("EXECUTABILITY");
  });

  it("o eixo de executabilidade reprova fase que não cabe numa sessão", () => {
    const prompt = auditorPrompt({ ...context, document: "project-phases.md", executable: true });
    expect(prompt).toContain("exceed one session");
    expect(prompt).toContain("15 tasks");
  });

  it("declara a regra da dúvida: aprova e ressalva", () => {
    expect(auditorPrompt(context)).toContain("When in doubt, approve and remark");
  });

  it("proíbe rejeitar por preferência de escrita", () => {
    expect(auditorPrompt(context)).toContain("would have written differently");
  });

  it("proíbe o auditor de editar o documento", () => {
    expect(auditorPrompt(context)).toContain("cannot edit it");
  });

  it("manda não reauditar o que o parser já provou", () => {
    expect(auditorPrompt(context)).toContain("Do not re-audit the shape the parser owns");
  });

  it("proíbe revisar SQL no documento de dados", () => {
    const prompt = auditorPrompt({ ...context, document: "database-schema.md" });
    expect(prompt).toContain("NO DDL, NO SQL and NO triggers");
    expect(prompt).toContain("Never review SQL here");
    expect(prompt).toContain("a finding the writer cannot close");
  });

  it("declara a fronteira entre declarar e implementar", () => {
    const prompt = auditorPrompt(context);
    expect(prompt).toContain("DECLARES what must be true");
    expect(prompt).toContain("belongs to the execution plan");
    expect(prompt).toContain("Never reject a document for not implementing what it correctly declares");
  });

  it("nomeia o que é trabalho e não pertence ao documento", () => {
    const prompt = auditorPrompt(context);
    for (const trabalho of ["Seed migrations", "triggers", "runtime validation", "immutability enforcement"]) {
      expect(prompt).toContain(trabalho);
    }
  });

  it("avisa que um finding impossível de fechar para o run", () => {
    expect(auditorPrompt(context)).toContain("a finding the writer cannot close");
  });

  it("as ressalvas de montante chegam à auditoria seguinte", () => {
    const prompt = auditorPrompt({
      ...context,
      document: "project-phases.md",
      executable: true,
      upstreamRemarks: [
        { document: "user-stories.md", where: "US-3.1", observation: "a ausência de dependências não é explicitada" },
      ],
    });
    expect(prompt).toContain("Remarks from earlier audits");
    expect(prompt).toContain("a ausência de dependências não é explicitada");
    expect(prompt).toContain("becomes a defect the loop pays for");
  });

  it("o eixo de executabilidade recusa critério insatisfazível", () => {
    const prompt = auditorPrompt({ ...context, document: "project-phases.md", executable: true });
    expect(prompt).toContain("UNSATISFIABLE");
    expect(prompt).toContain("reject");
    expect(prompt).toContain("must name the absence instead");
  });

  it("carrega o bloco de idioma resolvido", () => {
    expect(auditorPrompt(context)).toContain("português do Brasil");
  });
});

describe("o impasse fala da versão atual", () => {
  const rejeita = (where: string, problem: string) => ({
    status: "REJECTED" as const,
    findings: [{ where, problem, fix: "corrija" }],
    remarks: [],
    reason: "há defeito",
  });

  it("finding já corrigido não é apresentado como insistência", () => {
    const history = [
      { attempt: 1, verdict: rejeita("Phase 1", "faltava o índice"), contentSha: "sha-1" },
      { attempt: 2, verdict: rejeita("Phase 2", "falta a regra de unicidade"), contentSha: "sha-2" },
      { attempt: 3, verdict: rejeita("Phase 2", "falta a regra de unicidade"), contentSha: "sha-3" },
    ];
    const action = nextAuditAction({ document: "project-phases.md", history, maxReturns: 3, maxMechanical: 3 });
    expect(action.action).toBe("ask-developer");
    if (action.action !== "ask-developer") return;
    expect(action.standoff.auditorInsists).toHaveLength(1);
    expect(action.standoff.auditorInsists[0]?.problem).toContain("unicidade");
  });

  it("o que sobreviveu a mais de uma tentativa é marcado como repetido", () => {
    const history = [
      { attempt: 1, verdict: rejeita("Phase 2", "falta a regra de unicidade"), contentSha: "sha-1" },
      { attempt: 2, verdict: rejeita("Phase 2", "falta a regra de unicidade"), contentSha: "sha-2" },
      { attempt: 3, verdict: rejeita("Phase 2", "falta a regra de unicidade"), contentSha: "sha-3" },
    ];
    const action = nextAuditAction({ document: "project-phases.md", history, maxReturns: 3, maxMechanical: 3 });
    if (action.action !== "ask-developer") throw new Error("esperava impasse");
    expect(renderStandoff(action.standoff)).toContain("repetido em mais de uma tentativa");
  });
});

describe("defeito mecânico tem orçamento próprio", () => {
  const mecanico = (problema: string) => ({
    status: "REJECTED" as const,
    findings: [{ where: "Phase 1", problem: problema, fix: "consolide" }],
    remarks: [],
    reason: "há fase acima do que cabe numa sessão",
    mechanical: true,
  });
  const doAuditor = (problema: string) => ({
    status: "REJECTED" as const,
    findings: [{ where: "Phase 2", problem: problema, fix: "corrija" }],
    remarks: [],
    reason: "há defeito",
  });

  it("contagem não gasta o teto do auditor", () => {
    // O piloto 3 parou em impasse com duas devoluções mecânicas e uma real: a
    // fase ia de 74 para 61 critérios e mais uma volta teria fechado.
    const history = [
      { attempt: 1, verdict: mecanico("74 critérios"), contentSha: "sha-1" },
      { attempt: 2, verdict: doAuditor("ambiguidade de espaços"), contentSha: "sha-2" },
      { attempt: 3, verdict: mecanico("61 critérios"), contentSha: "sha-3" },
    ];
    const action = nextAuditAction({ document: "project-phases.md", history, maxReturns: 3, maxMechanical: 3 });
    expect(action.action).toBe("return-to-writer");
  });

  it("mas ele também acaba: mecânico que não fecha vira impasse próprio", () => {
    const history = [1, 2, 3].map((attempt) => ({
      attempt,
      verdict: mecanico(`${80 - attempt} critérios`),
      contentSha: `sha-${attempt}`,
    }));
    const action = nextAuditAction({ document: "project-phases.md", history, maxReturns: 3, maxMechanical: 3 });
    expect(action.action).toBe("ask-developer");
    if (action.action !== "ask-developer") return;
    expect(action.standoff.question).toContain("não é desacordo");
  });

  it("o teto do auditor continua valendo para desacordo de verdade", () => {
    const history = [1, 2, 3].map((attempt) => ({
      attempt,
      verdict: doAuditor("a regra não nomeia o alvo"),
      contentSha: `sha-${attempt}`,
    }));
    const action = nextAuditAction({ document: "project-phases.md", history, maxReturns: 3, maxMechanical: 3 });
    expect(action.action).toBe("ask-developer");
  });
});

/**
 * A embalagem é tolerada; o conteúdo, não.
 *
 * O plano do MCP_teste2 morreu por uma quebra de linha. O auditor escreveu a
 * frase de abertura e a chave grudadas — "…confrontar as regras.CAPIVARA_AUDIT_
 * STATUS: APPROVED" —, o parser não achou a chave na coluna 1, o modelo repetiu
 * o mesmo hábito na segunda tentativa, e o run parou com oito fases prontas e
 * duas emendas pendentes. O veredito era bom.
 */
describe("o que o parser do auditor tolera", () => {
  const bom = (extra = "") =>
    [
      "CAPIVARA_AUDIT_STATUS: APPROVED",
      extra,
      "CAPIVARA_REASON: as oito tarefas cobrem as stories da fase",
    ]
      .filter((linha) => linha !== "")
      .join("\n");

  it("a chave colada no fim de uma frase — o caso real", () => {
    const real = "Vou conferir o calendário das datas usadas na fase.CAPIVARA_AUDIT_STATUS: APPROVED\nCAPIVARA_REASON: está coerente";
    const lido = parseAudit(real);
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    expect(lido.verdict.status).toBe("APPROVED");
  });

  it("indentação acidental e marcador de lista na frente", () => {
    const lido = parseAudit("   CAPIVARA_AUDIT_STATUS: REJECTED\n- CAPIVARA_FINDING: Phase 2 | critério vago | use um limite numérico\n  CAPIVARA_REASON: falta precisão");
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    expect(lido.verdict.status).toBe("REJECTED");
    expect(lido.verdict.findings).toHaveLength(1);
  });

  it("o negrito do Markdown em volta da chave", () => {
    const lido = parseAudit("**CAPIVARA_AUDIT_STATUS:** APPROVED\n**CAPIVARA_REASON:** tudo certo");
    if (!lido.ok) throw new Error(lido.defects.join("; "));
    expect(lido.verdict.status).toBe("APPROVED");
  });

  /*
   * Tolerar a embalagem não é tolerar o conteúdo: as regras que fazem a
   * devolução ser útil continuam valendo, e é por isso que elas existem.
   */
  it("mas o conteúdo continua cobrado: finding sem orientação segue inválido", () => {
    const lido = parseAudit("CAPIVARA_AUDIT_STATUS: REJECTED\nCAPIVARA_FINDING: Phase 2 | está ruim\nCAPIVARA_REASON: ruim");
    expect(lido.ok).toBe(false);
  });

  it("e dois status continuam sendo erro", () => {
    const lido = parseAudit(`${bom()}\nCAPIVARA_AUDIT_STATUS: REJECTED`);
    expect(lido.ok).toBe(false);
  });
});
