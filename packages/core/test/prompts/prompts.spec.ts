import { describe, expect, it } from "vitest";
import { assessRehearsal, enumerateCriteria, gapPrompt, interviewPrompt, languageBlock, ledgerPrompt, parseRehearsal, phasePartPrompt, rehearsalPrompt, writerPrompt } from "../../src/prompts/index.js";
import type { WriterContext } from "../../src/prompts/index.js";
import { parsePhases } from "../../src/contract/index.js";
import { STRUCTURAL_LABELS } from "../../src/contract/index.js";

const context: WriterContext = {
  language: "português do Brasil",
  request: "um sistema de reservas para uma pousada",
  decisions: ["Stack: Node 22 com Vitest"],
  assumptions: [],
  upstream: [],
};

const todos = [
  writerPrompt("project-description.md", context),
  writerPrompt("user-stories.md", context),
  writerPrompt("database-schema.md", context),
  ledgerPrompt(context),
  phasePartPrompt({ ...context, phaseNumber: 1, ledgerEntry: "{}" }),
];

describe("regra de idioma", () => {
  it("todo prompto do escritor carrega o bloco de idioma resolvido", () => {
    for (const prompt of todos) {
      expect(prompt).toContain("## Language");
      expect(prompt).toContain("português do Brasil");
      expect(prompt).not.toContain("{{USER_LANGUAGE}}");
    }
  });

  it("o bloco nomeia as chaves e os rótulos que não podem ser traduzidos", () => {
    const block = languageBlock("pt-BR");
    expect(block).toContain("CAPIVARA_AUDIT_STATUS");
    expect(block).toContain("TASK <n>: DONE");
    for (const label of STRUCTURAL_LABELS) expect(block).toContain(label);
  });

  it("declara que traduzir chave ou rótulo é resposta inválida", () => {
    expect(languageBlock("pt-BR")).toContain("invalid response");
  });
});

describe("neutralidade de execução", () => {
  it("nenhum prompt do escritor menciona provider, modelo, effort ou CLI", () => {
    const proibidos = ["codex", "claude", "opencode", "openai", "anthropic", "deepseek", "--effort", "--model"];
    for (const prompt of todos) {
      for (const termo of proibidos) {
        expect(prompt.toLowerCase(), `prompt vazou "${termo}"`).not.toContain(termo);
      }
    }
  });

  it("o escritor é instruído a não citar provider nem topologia de agentes", () => {
    expect(writerPrompt("project-description.md", context)).toContain("Never mention a provider");
  });
});

describe("papel read-only", () => {
  it("o escritor é proibido de escrever código, rodar comandos e commitar", () => {
    const prompt = writerPrompt("project-description.md", context);
    expect(prompt).toContain("never run build or test commands");
    expect(prompt).toContain("never commit");
  });
});

describe("autoridade e proibições", () => {
  it("declara a ordem de autoridade e que só ACCEPTED é decisão", () => {
    const prompt = writerPrompt("user-stories.md", context);
    expect(prompt).toContain("Authority order");
    expect(prompt).toContain("is not a");
    expect(prompt).toContain("DEFERRED, PARTIAL, AMBIGUOUS or CONTRADICTED");
  });

  it("proíbe inventar precisão que a fonte não deu", () => {
    expect(writerPrompt("database-schema.md", context)).toContain("Never add precision the source did not supply");
  });

  it("manda marcar decisão aberta com [NEEDS DECISION]", () => {
    expect(writerPrompt("project-description.md", context)).toContain("[NEEDS DECISION]");
  });

  it("carrega o pedido original verbatim e as decisões aceitas", () => {
    const prompt = writerPrompt("project-description.md", context);
    expect(prompt).toContain("um sistema de reservas para uma pousada");
    expect(prompt).toContain("Stack: Node 22 com Vitest");
  });
});

describe("levantamento de perguntas", () => {
  const prompt = interviewPrompt("project-description.md", context, "Projeto vazio.", []);

  it("lista os cinco campos obrigatórios", () => {
    for (const campo of ["id", "topic", "evidence", "decision", "why"]) {
      expect(prompt).toContain(`- ${campo}`);
    }
  });

  it("declara que omitir um campo é resposta inválida", () => {
    expect(prompt).toContain("invalid response: the developer never sees it");
  });

  it("declara a regra de decisão restritiva e aceita lista vazia", () => {
    expect(prompt).toContain("Ask only when ALL of these are true");
    expect(prompt).toContain("An empty question list is a valid and good answer");
  });
});

describe("metadado de documentação não vira pergunta", () => {
  it("prioridade e status têm padrão e nunca são marcados como pendentes", () => {
    const prompt = writerPrompt("user-stories.md", context);
    expect(prompt).toContain("documentation metadata, not decisions");
    expect(prompt).toContain("Default every story to High and Pending");
    expect(prompt).toContain("NEVER write [NEEDS DECISION] in those columns");
  });
});

describe("opção não pode ser adiamento disfarçado", () => {
  it("o levantamento proíbe opção que só adia a decisão", () => {
    const prompt = interviewPrompt("project-description.md", context, "vazio", []);
    expect(prompt).toContain("CONCRETE, FINAL answer");
    expect(prompt).toContain("deferral");
    expect(prompt).toContain("do not ask the question at all");
  });

  it("o levantamento de gaps repete a mesma proibição", () => {
    const prompt = gapPrompt("database-schema.md", context, ["qual stack web exatamente"]);
    expect(prompt).toContain("qual stack web exatamente");
    expect(prompt).toContain("concrete, final answer");
    expect(prompt).toContain("what put this marker here");
  });

  it("o levantamento de gaps manda escrever nenhum documento", () => {
    expect(gapPrompt("user-stories.md", context, ["x"])).toContain("Write no document");
  });
});

describe("ausência de design e limites do DBML", () => {
  it("a ausência de artefato de design nunca é decisão pendente", () => {
    const prompt = phasePartPrompt({ ...context, phaseNumber: 1, ledgerEntry: "{}" });
    expect(prompt).toContain("OMIT the Design ref line entirely");
    expect(prompt).toContain("NEVER an open decision");
  });

  it("o levantamento de gaps não pergunta caminho de design", () => {
    expect(gapPrompt("project-phases.md", context, ["caminho do design"])).toContain("Never ask for the path of a design artifact");
  });

  it("a rodada de gaps recebe o que já foi perguntado, com as palavras do desenvolvedor", () => {
    const prompt = gapPrompt("project-description.md", context, ["ciclo de vida das colunas"], [
      {
        decision: "Quais colunas devem existir inicialmente e qual o ciclo de vida delas?",
        disposition: "DEFERRED",
        answer: "três colunas fixas; não podem ser criadas nem apagadas",
      },
    ]);
    expect(prompt).toContain("três colunas fixas");
    expect(prompt).toContain("Never ask again what the developer already answered");
    expect(prompt).toContain("Never offer an option that contradicts what the developer said");
  });

  it("sem histórico, a rodada de gaps não inventa uma seção vazia", () => {
    expect(gapPrompt("user-stories.md", context, ["x"])).not.toContain("Already asked in this document");
  });

  it("o documento de dados declara regras com semântica exata, sem DDL", () => {
    const prompt = writerPrompt("database-schema.md", context);
    expect(prompt).toContain("### Structural rules");
    expect(prompt).toContain("NO DDL, NO SQL, NO triggers");
    expect(prompt).toContain("new_check_in < existing_check_out");
  });
});

describe("escrita de project-phases em partes", () => {
  it("o ledger planeja tudo e escreve nenhuma fase", () => {
    const prompt = ledgerPrompt(context);
    expect(prompt).toContain("write NO phase yet");
    expect(prompt).toContain("capivara-ledger/v1");
  });

  it("o ledger declara o dimensionamento como restrição dura", () => {
    expect(ledgerPrompt(context)).toContain("hard constraint");
    expect(ledgerPrompt(context)).toContain("ONE agent session");
  });

  it("a parte escreve EXATAMENTE uma fase e nada do envelope", () => {
    const prompt = phasePartPrompt({ ...context, phaseNumber: 3, ledgerEntry: '{"number":3}' });
    expect(prompt).toContain("EXACTLY ONE phase");
    expect(prompt).toContain("phase 3");
    expect(prompt).toContain("Do not write the document header");
  });

  it("a parte recebe a gramática vinda do módulo do contrato", () => {
    const prompt = phasePartPrompt({ ...context, phaseNumber: 2, ledgerEntry: "{}" });
    expect(prompt).toContain("**Acceptance criteria:**");
    expect(prompt).toContain("**Traces:**");
  });

  it("exige critério binário e recusa linguagem vaga", () => {
    const prompt = phasePartPrompt({ ...context, phaseNumber: 1, ledgerEntry: "{}" });
    expect(prompt).toContain("binary and observable");
    expect(prompt).toContain("are rejected");
  });
});

describe("eixo de precisão do auditor", () => {
  const base = {
    language: "português do Brasil",
    document: "database-schema.md",
    executable: false,
    request: "um quadro kanban",
    decisions: [],
    dispositions: [],
    upstream: [],
    upstreamRemarks: [],
    content: "## Notes\n\n- A busca remove espaços das extremidades.",
  };

  it("exige que a regra nomeie o alvo da operação e o momento", async () => {
    const { auditorPrompt } = await import("../../src/prompts/index.js");
    const prompt = auditorPrompt(base);
    expect(prompt).toContain("PRECISION");
    expect(prompt).toContain("name what it operates ON");
    expect(prompt).toContain("say explicitly what is NOT");
  });

  it("diz que o lugar de pegar isso é o documento que enuncia a regra", async () => {
    const { auditorPrompt } = await import("../../src/prompts/index.js");
    expect(auditorPrompt(base)).toContain("never downstream");
  });
});

describe("ensaio do verificador", () => {
  const plano = [
    "# Pousada — Project Phases",
    "",
    "<!-- inputs: project-description.md@sha256:000000000000 -->",
    "",
    "## Phase 1: Fundação de dados",
    "",
    "**Goal:** criar o esquema · **Depends on:** none · **Covers:** US-1.1",
    "",
    "- [ ] **Task:** Criar a tabela de quartos.",
    "  - **Acceptance criteria:**",
    "    - A migração cria a tabela `quartos` com as colunas decididas.",
    "    - O pacote publicado declara as dependências fixadas.",
    "  - **Feature tests:** migracao_vazia → a migração roda numa base vazia",
    "  - **Traces:** US-1.1",
    "",
  ].join("\n");

  const parsed = parsePhases(plano);
  const criteria = parsed.ok ? enumerateCriteria(parsed.document) : [];

  it("endereça cada critério por fase, task e posição", () => {
    expect(criteria.map((criterion) => criterion.address)).toEqual(["P1.T1.C1", "P1.T1.C2"]);
    expect(criteria[1]?.taskTitle).toContain("tabela de quartos");
  });

  it("o prompt diz que a árvore está vazia de propósito", () => {
    const prompt = rehearsalPrompt({ language: "português do Brasil", request: "uma pousada", decisions: [], upstream: [], criteria });
    expect(prompt).toContain("there is no code at all");
    expect(prompt).toContain("P1.T1.C2");
  });

  it("dúvida sobre satisfazer é do build; dúvida sobre observar é do ensaio", () => {
    const prompt = rehearsalPrompt({ language: "português do Brasil", request: "x", decisions: [], upstream: [], criteria });
    expect(prompt).toContain("Answer OBSERVABLE");
    expect(prompt).toContain("is your problem");
  });

  it("as decisões confirmadas entram como autoridade sobre o que existe", () => {
    const prompt = rehearsalPrompt({
      language: "português do Brasil",
      request: "x",
      decisions: ["Sem dependências externas: só a biblioteca padrão"],
      upstream: [],
      criteria,
    });
    expect(prompt).toContain("Sem dependências externas");
  });

  it("lê os vereditos ignorando prosa em volta", () => {
    const verdicts = parseRehearsal(
      [
        "Segue minha análise:",
        "CRITERION P1.T1.C1: OBSERVABLE — abro a migração e procuro a tabela",
        "  CRITERION P1.T1.C2: UNSATISFIABLE — o projeto foi decidido sem dependências",
      ].join("\n"),
    );
    expect(verdicts).toHaveLength(2);
    expect(verdicts[1]?.ruling).toBe("UNSATISFIABLE");
    expect(verdicts[1]?.reason).toContain("sem dependências");
  });

  it("o impossível bloqueia e o observável passa", () => {
    const resultado = assessRehearsal(criteria, [
      { address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "" },
      { address: "P1.T1.C2", ruling: "UNSATISFIABLE", reason: "não há dependências" },
    ]);
    expect(resultado.blocking).toHaveLength(1);
    expect(resultado.blocking[0]?.criterion.address).toBe("P1.T1.C2");
    expect(resultado.unrehearsed).toHaveLength(0);
  });

  it("critério sem linha vira não ensaiado, nunca aprovado", () => {
    const resultado = assessRehearsal(criteria, [{ address: "P1.T1.C1", ruling: "OBSERVABLE", reason: "" }]);
    expect(resultado.unrehearsed.map((criterion) => criterion.address)).toEqual(["P1.T1.C2"]);
  });

  it("critério que não nomeia observação também bloqueia", () => {
    const resultado = assessRehearsal(criteria, [
      { address: "P1.T1.C1", ruling: "UNOBSERVABLE", reason: "\"código limpo\" não é algo que se olhe" },
      { address: "P1.T1.C2", ruling: "OBSERVABLE", reason: "" },
    ]);
    expect(resultado.blocking[0]?.ruling).toBe("UNOBSERVABLE");
  });
});
