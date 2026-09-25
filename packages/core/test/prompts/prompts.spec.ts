import { describe, expect, it } from "vitest";
import { assessRehearsal, enumerateCriteria, gapPrompt, interviewPrompt, languageBlock, parseRehearsal, amendPhasePrompt, phaseAuditPrompt, phaseFromSlicePrompt, rehearsalPrompt, skeletonPrompt, surveyDomainPrompt, surveyMapPrompt } from "../../src/prompts/index.js";
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
  maxTasksPerPhase: 15,
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

/*
 * Uma pergunta composta é impossível de responder de primeira: as opções cobrem
 * uma das decisões, e a resposta volta marcada incompleta sem culpa de quem
 * respondeu. Num run real, "o que o valor cobre, existe prazo e o que acontece
 * se passar?" voltou três vezes.
 */
describe("uma decisão por pergunta", () => {
  it("o prompt do levantamento proíbe juntar decisões", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", []);
    expect(prompt).toContain("ONE DECISION PER QUESTION");
    expect(prompt).toContain("write three questions");
  });

  it("e exige que as opções cubram a decisão inteira", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", []);
    expect(prompt).toContain("span the WHOLE decision");
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
      testCommand: null,
      containerized: false,
    });

    expect(prompt).toContain("Build IN THE CURRENT DIRECTORY");
    expect(prompt).toContain("Never create a subdirectory to hold the project");
    // O caso real do piloto 6-mimo: `tmp/biblioteca-app/`.
    expect(prompt).toContain("not `tmp/`");
  });
});

/**
 * As omissões: o que o pedido não menciona.
 *
 * O MCP_teste entregou cinco fases verdes sem uma tela de edição de cliente,
 * porque o pedido falava em cadastrar e nunca em alterar. A entrevista perguntou
 * seis coisas, todas boas, todas sobre o que ESTAVA escrito.
 */
describe("o levantamento das áreas faltantes", () => {
  it("o levantamento do produto pede omissões na primeira rodada", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", [], 1);
    expect(prompt).toContain("What the request does not mention");
    expect(prompt).toContain("create, read, change, remove");
    expect(prompt).toContain('"omissions"');
    expect(prompt).toContain('"include"');
  });

  /*
   * Ampliar escopo na terceira rodada refaz o que as duas primeiras decidiram.
   * Quem leu o pedido inteiro na rodada 1 já viu o que falta nele.
   */
  it("da segunda rodada em diante, não se abre escopo novo", () => {
    expect(interviewPrompt("skeleton", context, "Projeto vazio.", [], 2)).not.toContain("What the request does not mention");
  });

  it("a entrevista de uma fase não levanta omissão: ali o produto já está decidido", () => {
    expect(interviewPrompt("phase 3", context, "Projeto vazio.", [], 1)).not.toContain("What the request does not mention");
  });

  it("diz que zero omissões é resposta válida — nada de preencher cota", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", [], 1);
    expect(prompt).toContain("zero omissions is a valid answer");
  });

  it("manda recomendar o que serve ao produto, e recomendar de fora o que não serve", () => {
    const prompt = interviewPrompt("skeleton", context, "Projeto vazio.", [], 1);
    expect(prompt).toContain("not selling them work");
  });
});

/**
 * Os prompts do levantamento.
 *
 * O que eles protegem: o papel não toca na aplicação, a evidência é obrigatória,
 * e as três camadas existem porque a reescrita pode trocar de stack.
 */
describe("o levantamento de uma aplicação existente", () => {
  const mapa = surveyMapPrompt({ language: "português do Brasil", inventory: "app/Locacao.php  2 KB", maxDomains: 8 });
  const dominio = surveyDomainPrompt({
    language: "português do Brasil",
    application: "Locadora",
    domain: { id: "D-01", name: "Locação", purpose: "Aluga filmes.", files: ["app/Locacao.php"] },
    others: [{ id: "D-02", name: "Clientes" }],
  });

  it("o papel não escreve, não roda e não instala nada na aplicação levantada", () => {
    for (const prompt of [mapa, dominio]) {
      expect(prompt).toContain("strictly read-only");
      expect(prompt).toContain("never run its build, its tests or the application");
      expect(prompt).toContain("may be in production");
    }
  });

  it("afirmação sem evidência não é achado", () => {
    expect(dominio).toContain("Every statement you make cites where you read it");
    expect(dominio).toContain("goes in `questions`, never into a rule");
  });

  /*
   * A camada é o que permite reescrever em outra stack: sem ela, quem reescreve
   * herda o vocabulário da stack antiga e reproduz a solução em vez do problema.
   */
  it("as três camadas estão no prompt do domínio, com a regra de desempate", () => {
    expect(dominio).toContain("`dominio` — survives any rewrite");
    expect(dominio).toContain("`implementacao` — dies with the stack");
    expect(dominio).toContain("`contrato` — must survive EVEN IF the stack changes");
    expect(dominio).toContain("would someone OUTSIDE this codebase notice");
  });

  it("manda declarar a divergência entre o que o código faz e o que parecia querer", () => {
    expect(dominio).toContain("You never resolve a divergence");
  });

  it("o mapa não lê regra nenhuma: isso é da sessão de cada domínio", () => {
    expect(mapa).toContain("the map, not the contents");
    expect(mapa).toContain("stay EMPTY here");
  });

  it("domínio é parte do negócio, não pasta nem camada da stack", () => {
    expect(mapa).toContain("`controllers`, `models`, `utils` are not");
  });

  it("a sessão de um domínio sabe onde parar", () => {
    expect(dominio).toContain("D-02 Clientes");
    expect(dominio).toContain("not yours to report");
  });
});

/**
 * A chave colada no fim da frase anterior.
 *
 * O ensaio do MCP_teste2 veio numa linha só — a prosa de abertura e a chave sem
 * `\n` entre elas — e dez critérios voltaram como "não ensaiados" com o
 * verificador tendo julgado todos. O comentário acima do regex do ensaio já
 * contava essa história do piloto 4; a correção de lá tolerou indentação e
 * parou aí.
 */
describe("o ensaio lê o que o verificador respondeu", () => {
  /** A saída real que derrubou dez critérios, encurtada. */
  const REAL =
    "Vou ler as decisões confirmadas e o plano para julgar se esse critério pode ser observado." +
    "O critério mistura bloqueio de quantidade, cadastro ativo e sessão." +
    "CRITERION P8.T7.C3 sem o cookie `sessao`, o envio deixa a linha com todas as colunas anteriores.: OBSERVABLE — a linha permanece igual";

  it("a chave colada na prosa continua sendo um veredito", () => {
    expect(parseRehearsal(REAL)).toEqual([
      { address: "P8.T7.C3", ruling: "OBSERVABLE", reason: "a linha permanece igual" },
    ]);
  });

  it("vários vereditos numa linha só viram vários vereditos", () => {
    const grudado = "CRITERION P1.T1.C1: OBSERVABLE — dá para ver CRITERION P1.T2.C1: UNOBSERVABLE — não dá";
    expect(parseRehearsal(grudado).map((veredito) => `${veredito.address} ${veredito.ruling}`)).toEqual([
      "P1.T1.C1 OBSERVABLE",
      "P1.T2.C1 UNOBSERVABLE",
    ]);
  });

  it("o que já vinha em linhas próprias continua igual", () => {
    const certo = "CRITERION P1.T1.C1: OBSERVABLE — dá para ver\nCRITERION P1.T2.C1: UNSATISFIABLE — nada satisfaz";
    expect(parseRehearsal(certo)).toHaveLength(2);
  });
});

/*
 * O run de `assitencia` parou em RALPH READY com dois achados que se repetiram
 * nas três devoluções: "os critérios restringem status a valores enumerados, mas
 * não exigem sua modelagem em tabelas de domínio, conforme o eixo CONFORMANCE".
 *
 * O escritor não tinha como fechá-los. Criar as tabelas seria inventar estrutura
 * que o esqueleto não declara, e o eixo 1 o proíbe de inventar. Ele ficou entre
 * dois eixos, gastou as três rodadas e o run parou — com 18 fases escritas e
 * auditadas, 16 delas aprovadas.
 */
describe("o auditor não pode pedir o que o escritor está proibido de escrever", () => {
  const prompt = phaseAuditPrompt({
    language: "português do Brasil",
    request: "um sistema de assistência técnica",
    decisions: [],
    upstream: [],
    upstreamRemarks: [],
    document: "project-phases.md",
    content: "",
    executable: true,
    dispositions: [],
    phaseMarkdown: "## Phase 1",
    phaseNumber: 1,
    totalPhases: 18,
  });

  it("proíbe exigir técnica de modelagem que o esqueleto não declara", () => {
    expect(prompt).toContain("NEVER demand a modelling or implementation technique the skeleton does not state");
    expect(prompt).toContain("lookup");
    expect(prompt).toContain("soft delete");
  });

  it("não pergunta mais se os campos enumeráveis viraram tabela de consulta", () => {
    expect(prompt).not.toContain("Are enumerable fields modelled as lookup tables?");
  });

  it("diz o caminho certo quando o esqueleto DECLARA a técnica e a fase a largou", () => {
    expect(prompt).toContain("that is a FIDELITY finding");
  });

  it("explica por que o pedido é impossível, e não só que é proibido", () => {
    expect(prompt).toContain("between two axes with no way out");
  });

  it("numera os quatro eixos sem repetir o 3", () => {
    for (const eixo of ["1. FIDELITY", "2. CONFORMANCE", "3. PRECISION", "4. EXECUTABILITY"]) {
      expect(prompt).toContain(eixo);
    }
  });
});

/*
 * O `assitencia` parou em NOT READY com um critério que o verificador declarou
 * IMPOSSÍVEL: "Definir o sistema visual compartilhado conforme a base documental
 * frontend-design fornecida".
 *
 * A cadeia inteira foi fiel: o projeto na base documental tem uma skill chamada
 * `frontend-design`, ela entrou na pergunta da entrevista, a resposta aceita
 * carregou o nome, o esqueleto virou regra transversal e cada fase copiou.
 * Ninguém errou — e o critério é improvável, porque a skill não está no
 * repositório que o verificador lê. Ele procura, não acha, e reprova uma fase
 * correta.
 */
describe("critério se prova lendo o repositório", () => {
  it("o esqueleto não escreve regra que aponta para fora do repositório", () => {
    expect(esqueleto).toContain("CHECKED BY READING THIS REPOSITORY");
    expect(esqueleto).toContain("applied,");
    expect(esqueleto).toContain("never cited");
  });

  it("a fase não escreve critério que depende de documento fora do repositório", () => {
    const fase = phaseFromSlicePrompt({
      language: "português do Brasil",
      slice: "stack: Next.js",
      phaseNumber: 5,
      totalPhases: 18,
      grammar: "gramática",
      maxCriteriaPerTask: 4,
  maxTasksPerPhase: 15,
    });

    expect(fase).toContain("proven by reading THIS REPOSITORY");
    expect(fase).toContain("skill from the documentation library");
    // E mostra a troca, porque proibir sem ensinar deixa o escritor sem saída.
    expect(fase).toContain("cannot be verified");
    expect(fase).toContain("can.");
  });

  it("a proibição alcança a regra transversal que já veio escrita assim", () => {
    const fase = phaseFromSlicePrompt({
      language: "português do Brasil",
      slice: "regra: conforme a base documental frontend-design fornecida",
      phaseNumber: 1,
      totalPhases: 18,
      grammar: "gramática",
      maxCriteriaPerTask: 4,
  maxTasksPerPhase: 15,
    });

    expect(fase).toContain("not even when a rule above phrases itself that way");
  });
});

/*
 * O `assitencia` parou num impasse sobre a fase 18: ela declarou 17 tasks, o
 * teto é 15, e a correção pedida era "divida em mais fases de topo". Quem a
 * recebe escreve UMA fase, cujo número, título e cobertura vêm do esqueleto e
 * são montados em código — criar fase não é jogada que ele tenha. Cinco
 * reescritas, tudo o que era possível fechado, e o run parou na única correção
 * que ninguém ali podia fazer.
 */
describe("o escritor de fase sabe qual é o orçamento de tasks", () => {
  it("diz o teto, diz que o harness conta, e diz que ele é o único que pode fechar", () => {
    const fase = fatia(18);
    expect(fase).toContain("NEVER go past 15");
    expect(fase).toContain("you are the only one who can fix it");
  });

  it("proíbe a saída que não existe — criar fase", () => {
    expect(fatia(18)).toContain("you cannot create a phase");
  });

  it("ensina a saída que existe: task maior, nunca capacidade a menos", () => {
    const fase = fatia(18);
    expect(fase).toContain("make the tasks BIGGER");
    expect(fase).toContain("Never drop a capability");
  });
});

/*
 * O terceiro impasse do `assitencia`, e o de assinatura mais clara: 23 achados,
 * o escritor fechou 23; 15 novos, fechou 15; 21 novos. Ele nunca deixou nada em
 * aberto — e quase todos eram da mesma família, o ADJETIVO que inventa uma
 * regra: o e-mail "normalizado", a senha "aleatória", os índices "equivalentes",
 * os dados "normalizados".
 *
 * Cada uma dessas palavras é uma regra que ninguém decidiu, e o escritor as
 * escrevia tentando ser preciso, porque o eixo da precisão pede exatamente isso.
 * A saída legal — dizer que falta decidir — existia, era testada ponta a ponta,
 * e o prompt da fase nunca a mencionou.
 */
describe("o adjetivo que inventa uma regra", () => {
  it("nomeia as palavras que mais custaram, em vez de pedir vagamente fidelidade", () => {
    const fase = fatia(1);
    expect(fase).toContain("normalized");
    expect(fase).toContain("random");
    expect(fase).toContain("Each of those words is a RULE");
  });

  it("manda escrever na precisão da fonte, e mostra o par certo e errado", () => {
    const fase = fatia(1);
    expect(fase).toContain("AT THE PRECISION THEY STATE IT");
    expect(fase).toContain("is a normalization rule nobody decided");
  });

  it("ensina a saída legal: o marcador que vai ao desenvolvedor antes da auditoria", () => {
    const fase = fatia(1);
    expect(fase).toContain("[NEEDS DECISION]");
    expect(fase).toContain("goes to the DEVELOPER before anything");
    expect(fase).toContain("the only legal way to leave something open");
  });

  it("diz por que o palpite é pior que a pergunta", () => {
    expect(fatia(1)).toContain("invented default looks like a decision, gets built");
  });
});

/*
 * O `assitencia` perguntou ao DESENVOLVEDOR se ele "autoriza acrescentar tarefas
 * exclusivamente para realizar a divisão exigida pela auditoria, apesar da
 * proibição explícita de adicionar tarefas".
 *
 * Duas instruções nossas em lados opostos: o self-check de dimensionamento manda
 * "divida-a em tasks que façam uma coisa cada", e a emenda proibia acrescentar
 * task. O escritor, ensinado a marcar em vez de inventar, marcou — e a rodada de
 * lacunas levou a contradição do harness para quem não tem nada a ver com ela.
 */
describe("a emenda pode fazer o que o achado pede", () => {
  const emenda = amendPhasePrompt({
    language: "português do Brasil",
    current: "- [ ] **Task:** x",
    findings: [{ where: "Phase 1 · Tarefa 2", problem: "a task declara 7 critérios", fix: "divida-a em tasks que façam uma coisa cada" }],
  });

  it("proíbe mexer no que o achado não nomeia, e só isso", () => {
    expect(emenda).toContain("never add, drop, merge or renumber tasks on your");
  });

  it("autoriza a divisão quando é ela que o achado pede", () => {
    expect(emenda).toContain("splitting it IS the correction");
    expect(emenda).toContain("keeping every verifiable condition");
  });

  it("diz o princípio, para não precisar listar todos os casos", () => {
    expect(emenda).toContain("it never forbids the very change a finding asks for");
  });
});

/*
 * O `assitencia` parou com o auditor pedindo: "Fase 2 concentra 19 tarefas —
 * redistribuir as tarefas existentes em FASES SEQUENCIAIS MENORES".
 *
 * Quem recebe essa correção escreve UMA fase, cujo envelope vem do esqueleto.
 * Criar fase não é jogada que ele tenha — é a mesma lição do §52, que eu tinha
 * ensinado ao self-check mecânico e não ao auditor, que a inventou por conta.
 */
describe("o auditor não pede cirurgia de fase", () => {
  const prompt = phaseAuditPrompt({
    language: "português do Brasil",
    request: "um sistema",
    decisions: [],
    upstream: [],
    upstreamRemarks: [],
    document: "project-phases.md",
    content: "",
    executable: true,
    dispositions: [],
    phaseMarkdown: "## Phase 2",
    phaseNumber: 2,
    totalPhases: 16,
  });

  it("diz que as fases não são dele", () => {
    expect(prompt).toContain("THE PHASES THEMSELVES ARE NOT YOURS TO CHANGE");
    expect(prompt).toContain("Never ask for a phase to");
  });

  it("nomeia as correções que existem de verdade", () => {
    expect(prompt).toContain("consolidate tasks that deliver the same capability");
    expect(prompt).toContain("demanded IN THE PHASE that already covers it");
  });

  it("dá o caminho quando o defeito é do esqueleto: ressalva, não achado", () => {
    expect(prompt).toContain("say that in a REMARK");
    expect(prompt).toContain("someone who cannot act on it");
  });
});

/*
 * O `assitencia` publicou NOT READY com um marcador vivo no plano, e o evento
 * dizia "3 gap(s) sem pergunta": o lote da rodada de lacunas foi recusado duas
 * vezes seguidas.
 *
 * A causa foi minha, horas antes: o parser passou a exigir de 2 a 4 opções por
 * pergunta (§64), a entrevista foi ensinada e a RODADA DE LACUNAS não. Ela
 * continuou emitindo pergunta sem opção, e três decisões nunca chegaram a ser
 * ouvidas.
 */
describe("as duas entrevistas seguem as mesmas regras de pergunta", () => {
  const daEntrevista = interviewPrompt("skeleton.md", context, "Projeto vazio.", [], 1);
  const daLacuna = gapPrompt("project-phases.md", context, ["definir o prazo de garantia"], []);

  it("as duas exigem de 2 a 4 opções com recomendação", () => {
    for (const prompt of [daEntrevista, daLacuna]) {
      expect(prompt).toContain("EVERY question carries two to four options");
      expect(prompt).toContain("recommends exactly");
    }
  });

  it("as duas proíbem a pergunta que só se responde em prosa", () => {
    for (const prompt of [daEntrevista, daLacuna]) {
      expect(prompt).toContain("Never ask something that can only be answered in prose");
      expect(prompt).toContain("nowhere to click");
    }
  });

  it("as duas recusam a opção que é adiamento disfarçado", () => {
    for (const prompt of [daEntrevista, daLacuna]) {
      expect(prompt).toContain("a deferral");
    }
  });
});

describe("o auditor sabe o que NÃO está sob auditoria", () => {
  const comAprovadas = phaseAuditPrompt({
    language: "português do Brasil",
    request: "um sistema",
    decisions: [],
    upstream: [],
    upstreamRemarks: [],
    document: "project-phases.md",
    content: "",
    executable: true,
    dispositions: [],
    phaseMarkdown: "## Phase 2",
    phaseNumber: 2,
    totalPhases: 16,
    tasksJaAprovadas: ["Persistir usuários", "Persistir perfis"],
  });

  it("lista as tasks já aprovadas e proíbe achado nelas", () => {
    expect(comAprovadas).toContain("Already approved — NOT under audit now");
    expect(comAprovadas).toContain("Persistir usuários");
    expect(comAprovadas).toContain("Do not raise findings on them");
  });

  it("diz por que reler não é zelo", () => {
    expect(comAprovadas).toContain("a second reading always finds something a first one did not");
    expect(comAprovadas).toContain("nineteen");
  });

  it("deixa a saída aberta para o defeito que a mudança CRIOU", () => {
    expect(comAprovadas).toContain("say it about the task that CHANGED");
  });

  it("sem aprovadas, o prompt não menciona a seção", () => {
    expect(fatia(2)).not.toContain("NOT under audit now");
  });
});
