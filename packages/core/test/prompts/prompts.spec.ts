import { describe, expect, it } from "vitest";
import { gapPrompt, interviewPrompt, languageBlock, ledgerPrompt, phasePartPrompt, writerPrompt } from "../../src/prompts/index.js";
import type { WriterContext } from "../../src/prompts/index.js";
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
