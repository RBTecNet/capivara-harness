import { describe, expect, it } from "vitest";
import { assessRehearsal, enumerateCriteria, gapPrompt, interviewPrompt, languageBlock, parseRehearsal, phaseFromSlicePrompt, rehearsalPrompt, skeletonPrompt } from "../../src/prompts/index.js";
import type { WriterContext } from "../../src/prompts/index.js";
import { parsePhases, tasksBlock } from "../../src/contract/index.js";
import { STRUCTURAL_LABELS } from "../../src/contract/index.js";

const context: WriterContext = {
  language: "português do Brasil",
  request: "um sistema de reservas para uma pousada",
  decisions: ["Stack: Node 22 com Vitest"],
  assumptions: [],
  upstream: [],
};

const esqueleto = skeletonPrompt({
  language: context.language,
  request: context.request,
  decisions: context.decisions,
  assumptions: [],
  inventory: "Projeto vazio.",
  maxTasksPerPhase: 15,
  maxCriteriaPerTask: 4,
});

const fatia = (phaseNumber = 1): string =>
  phaseFromSlicePrompt({
    language: context.language,
    slice: "## Stack\n- Linguagem: Node 22",
    phaseNumber,
    totalPhases: 3,
    grammar: tasksBlock(phaseNumber),
    maxCriteriaPerTask: 4,
  });

const todos = [interviewPrompt("skeleton", context, "Projeto vazio.", []), gapPrompt("phase 1", context, ["x"]), esqueleto, fatia()];

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
    expect(interviewPrompt("skeleton", context, "Projeto vazio.", [])).toContain("Never mention a provider");
  });
});

describe("papel read-only", () => {
  it("o escritor é proibido de escrever código, rodar comandos e commitar", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", []);
    expect(prompt).toContain("never run build or test commands");
    expect(prompt).toContain("never commit");
  });
});

describe("autoridade e proibições", () => {
  it("declara a ordem de autoridade e que só ACCEPTED é decisão", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", []);
    expect(prompt).toContain("Authority order");
    expect(prompt).toContain("DEFERRED, PARTIAL, AMBIGUOUS or CONTRADICTED");
  });

  it("proíbe inventar precisão que a fonte não deu", () => {
    expect(interviewPrompt("skeleton", context, "Projeto vazio.", [])).toContain("Never add precision the source did not supply");
  });

  it("manda marcar decisão aberta com [NEEDS DECISION]", () => {
    expect(interviewPrompt("skeleton", context, "Projeto vazio.", [])).toContain("[NEEDS DECISION]");
  });

  it("carrega o pedido original verbatim e as decisões aceitas", () => {
    expect(esqueleto).toContain("um sistema de reservas para uma pousada");
    expect(esqueleto).toContain("Stack: Node 22 com Vitest");
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

describe("ausência de artefato de design", () => {
  it("a fase aprende que Design ref quase sempre não existe, e que inventar caminho a reprova", () => {
    expect(fatia()).toContain("USUALLY ABSENT");
    expect(fatia()).toContain("dead reference");
  });

  it("o levantamento de gaps não pergunta caminho de design", () => {
    expect(gapPrompt("phase 3", context, ["caminho do design"])).toContain("Never ask for the path of a design artifact");
  });

  it("a rodada de gaps recebe o que já foi perguntado, com as palavras do desenvolvedor", () => {
    const prompt = gapPrompt("skeleton", context, ["ciclo de vida das colunas"], [
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
    expect(gapPrompt("phase 1", context, ["x"])).not.toContain("Already asked in this document");
  });
});

describe("o esqueleto pensa o produto uma vez, a fase vê só a fatia", () => {
  it("o esqueleto é a única vez que alguém olha o produto inteiro", () => {
    expect(esqueleto).toContain("ONLY time anyone looks at the whole product at once");
    expect(esqueleto).toContain("capivara-skeleton/v1");
  });

  it("o esqueleto declara o dimensionamento como restrição da sessão de agente", () => {
    expect(esqueleto).toContain("One phase is ONE agent session");
    expect(esqueleto).toContain("up to 15 tasks");
  });

  it("a regra transversal precisa nomear alvo e momento: é o acordo entre fases que não se veem", () => {
    expect(esqueleto).toContain("NAMES ITS TARGET AND ITS");
    expect(esqueleto).toContain("A name you leave loose becomes two different names");
  });

  it("a fase escreve as tasks, e o envelope não é sequer pedido a ela", () => {
    const prompt = fatia(3);
    expect(prompt).toContain("writing phase 3 of 3");
    expect(prompt).toContain("You emit the TASKS of this phase, and nothing else");
    expect(prompt).toContain("no phase heading, no Goal line");
  });

  it("a fase recebe a gramática vinda do módulo do contrato", () => {
    expect(fatia(2)).toContain("**Acceptance criteria:**");
    expect(fatia(2)).toContain("**Traces:**");
  });

  it("a fase é proibida de redefinir a regra transversal que ela não decidiu", () => {
    expect(fatia()).toContain("do not contradict them");
    expect(fatia()).toContain("breaks a phase you cannot see");
  });
});

describe("a pergunta de aparência", () => {
  it("é obrigatória no levantamento que descreve o produto", () => {
    const prompt = interviewPrompt("skeleton", context, "projeto vazio", []);
    expect(prompt).toContain("always ask when the product has a user interface");
    expect(prompt).toContain("not a minimal scope");
  });

  it("não tem opção para 'sem estilo nenhum'", () => {
    const prompt = interviewPrompt("skeleton", context, "projeto vazio", []);
    expect(prompt).toContain("There is no option for");
    expect(prompt).toContain("no styling");
  });

  it("não polui o levantamento de uma fase, que não decide a identidade do produto", () => {
    expect(interviewPrompt("phase 2", context, "projeto vazio", [])).not.toContain("visual identity");
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

  it("lê a resposta real do verificador, que ecoa o título da task", () => {
    /*
     * Bytes reais de uma chamada do piloto 4. O prompt lista cada critério como
     * `P2.T1.C1 [fase · task] texto` e o modelo espelha o formato; a regex antiga
     * exigia o dois-pontos colado ao endereço e reconhecia zero de doze linhas
     * perfeitas.
     */
    const real = [
      "CRITERION P2.T1.C1 [Casca visual responsiva · Definir a fonte única de cores, espaçamentos, tipografia, bordas e sombras compartilhadas.]: OBSERVABLE — Inspecionar a definição centralizada de tokens.",
      "CRITERION P2.T2.C1 [Casca visual responsiva · Construir a casca visual do quadro.]: OBSERVABLE — Abrir a interface e verificar que o quadro contém as colunas.",
    ].join("\n");

    const verdicts = parseRehearsal(real);
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]?.address).toBe("P2.T1.C1");
    expect(verdicts[0]?.ruling).toBe("OBSERVABLE");
    expect(verdicts[0]?.reason).toContain("tokens");
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

describe("onde o executor constrói", () => {
  it("o prompt diz para construir na raiz, e proíbe o subdiretório", async () => {
    const { implementPrompt } = await import("../../src/prompts/index.js");
    const prompt = implementPrompt({
      language: "português do Brasil",
      phaseMarkdown: "## Phase 1: Base\n\n- [ ] **Task:** X",
      phaseNumber: 1,
      taskCount: 1,
      testCommand: null,
      systemInstall: false,
    });

    expect(prompt).toContain("Build IN THE CURRENT DIRECTORY");
    expect(prompt).toContain("Never create a subdirectory to hold the project");
    // O caso real do piloto 6-mimo: `tmp/biblioteca-app/`.
    expect(prompt).toContain("not `tmp/`");
  });
});
