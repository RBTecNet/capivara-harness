/**
 * I-16 — o planejamento não prescreve testes.
 *
 * A divisão de responsabilidades é esta: o `init` levanta o produto, o `plan`
 * decide arquitetura, infraestrutura e fases, e o BUILD decide como o produto
 * é provado — estratégia, ferramenta, arquivos, cenários. Um plano que nomeia
 * `vitest.config.ts`, `src/quality/x/api.test.ts` ou "automação com Playwright"
 * tomou uma decisão que não é dele, e a decisão viaja: o `teste_openrouter3`
 * mostrou o caminho inteiro. O pedido dizia só "testes automatizados"; o
 * esqueleto inventou "Vitest e Playwright" na stack; a arquitetura criou um
 * componente `automacao` com arquivos de configuração de teste; as fases
 * herdaram tasks de automação com nome de arquivo; e o auditor, vendo o
 * conflito com a regra do planejamento, perguntou ao desenvolvedor se a regra
 * valia. Nenhuma dessas etapas tinha autoridade para a escolha.
 *
 * A checagem é determinística e a mesma nos três documentos: uma FERRAMENTA de
 * teste nomeada, um ARQUIVO ou DIRETÓRIO de teste, ou uma CONFIGURAÇÃO de
 * ferramenta de teste. O que ela NÃO toca é a exigência do produto: "a suíte
 * roda contra um banco descartável" é comportamento, e fica.
 *
 * A autoridade é o escape, e é estrutural: um termo que aparece no PEDIDO ou
 * numa DECISÃO ACEITA do desenvolvedor não é prescrição do plano — é dele. É
 * assim que um produto que É uma ferramenta de teste, ou um desenvolvedor que
 * escreveu "use Jest", continua podendo dizê-lo.
 */

import type { ContractError, PhasesDocument } from "./phases.js";

/** Os nomes de ferramentas de teste que o plano não escolhe. */
const TEST_TOOLS =
  /\b(?:vitest|jest|mocha|jasmine|playwright|cypress|puppeteer|supertest|testing[- ]library|pytest|unittest|phpunit|pest|junit|testng|rspec|minitest|selenium|webdriver(?:io)?|cucumber|karma|nightwatch|testcafe|codeception|xunit|nunit|mstest)\b/giu;

/**
 * Arquivos e diretórios de teste: `x.test.ts`, `x.spec.js`, `x.e2e.ts`,
 * `vitest.config.ts`, `__tests__/…`, `tests/…`, `e2e/…`.
 */
const TEST_FILES =
  /(?:^|[\s`"'(\[{,;:/])((?:[\w@.-]+\/)*(?:[\w@.-]+\.(?:test|spec|e2e)\.[a-z]+|(?:vitest|jest|playwright|cypress|karma|mocha|jasmine)\.config(?:\.[a-z]+)+|__tests__(?:\/[\w@./-]*)?|(?:tests?|e2e|__mocks__)\/[\w@./-]+))/giu;

/*
 * A prescrição SEM ferramenta e sem arquivo (§122).
 *
 * No `minimax` (DeepSeek, 0.6.2) o plano passou pelas duas listas acima e
 * ainda assim decidiu a estratégia de teste: "Entregar a suíte automatizada do
 * módulo Tarefas" era uma task; "a suíte cobre os cenários de criação, edição
 * e exclusão", um critério; "configurar a execução de testes por módulo" e
 * "definir como os testes de integração serão executados", instruções; e o
 * auditor pediu "acrescentar em Phase 3 uma task de testes". Nenhuma cita
 * Vitest nem `*.test.ts`, e todas tomam a decisão do build: QUE trabalho de
 * teste existe, EM QUE fase, COBRINDO o quê, ORGANIZADO como.
 *
 * O que se separa contando, sem validador semântico:
 * - TRABALHO de teste como tarefa: um verbo de implementação no começo da
 *   frase cujo objeto é a suíte, os testes ou a cobertura. "Entregar a suíte
 *   automatizada" é trabalho alocado pelo plano; "o módulo possui testes
 *   automatizados executados contra banco descartável" é requisito, e fica.
 * - COBERTURA prescrita: "cobrir os cenários de…", "a suíte cobre os casos
 *   de teste…".
 * - TIPO e ORGANIZAÇÃO de teste: unitário, de integração, e2e, de aceitação,
 *   de regressão…; "execução de testes por módulo".
 *
 * A autoridade continua sendo o pedido e a entrevista, com uma diferença: o
 * pedido que diz "testes automatizados" autoriza o REQUISITO, não a tarefa
 * de escrevê-los numa fase — por isso o composto genérico de teste de
 * software ("testes automatizados", "suíte", "testes unitários") não escapa
 * da forma imperativa. Um composto do domínio do produto que o pedido contém
 * ("testes de laboratório", "testes A/B") escapa: é o produto, não a prova.
 */
const VERBOS_DE_IMPLEMENTACAO =
  "implementar|entregar|criar|escrever|acrescentar|adicionar|incluir|configurar|definir|montar|produzir|desenvolver|elaborar|organizar|estruturar|implement|deliver|create|write|add|include|configure|define|set\\s+up|build|develop";
const OBJETO_DE_TESTE = "su[ií]te\\s+(?:de\\s+)?(?:testes?|automatizada|automatizado|automated|test|de\\s+regress[aã]o|e2e)|test\\s+suite|testes?|tests?|cobertura(?:\\s+de\\s+testes?)?|test\\s+coverage";
const INICIO_DE_FRASE = "(?:^|[.;:!?]\\s+|\\n)\\s*(?:-\\s*)?";
/** Trabalho de teste como tarefa: verbo de implementação com teste como objeto, a até três palavras. */
const TEST_WORK = new RegExp(
  `${INICIO_DE_FRASE}(?:${VERBOS_DE_IMPLEMENTACAO})\\b(?:[,:]?\\s+[^\\s.;:]+){0,3}?[,:]?\\s+(?:(?:a|o|as|os|uma|um|the|all|todos|todas)\\s+)?(${OBJETO_DE_TESTE})\\b((?:\\s+(?:de|do|da|dos|das|of)\\s+[^\\s.;:,]+|\\s+[^\\s.;:,]+)?)`,
  "giu",
);
/** Uma task ou fase DE testes, em qualquer posição: é o que o auditor pede quando quer "uma task de testes em Phase 3". */
const TEST_TASK = /\b(?:tasks?|tarefas?|fases?|phases?)\s+(?:de\s+|of\s+)?(?:testes?|tests?)\b|\b(?:tasks?|tarefas?)\b[^;\n]{0,60}?\bsu[ií]te\s+(?:de\s+testes?|automatizada|automated|test)\b/giu;
/** Cobertura prescrita como tarefa: "cobrir os cenários…". */
const TEST_COVER = new RegExp(`${INICIO_DE_FRASE}(?:cobrir|cover)\\b[^.;\\n]{0,60}?\\b(cen[aá]rios?|scenarios?)\\b`, "giu");
/** Tipo, cobertura e organização de teste, em qualquer posição. */
const TEST_STRATEGY =
  /\b(testes?\s+(?:unit[aá]rios?|de\s+unidade|de\s+integra[cç][aã]o|end-to-end|e2e|de\s+ponta\s+a\s+ponta|de\s+aceita[cç][aã]o|de\s+regress[aã]o|de\s+carga|de\s+fuma[cç]a|de\s+contrato|de\s+interface|de\s+componente|de\s+snapshot|funcionais)|(?:unit|integration|end-to-end|e2e|acceptance|regression|load|smoke|contract|snapshot|functional)\s+tests?|(?:cobr(?:e|em|ir|indo|ia|iam|irá|irão)|cover(?:s|ing|ed)?)\s+(?:os\s+|as\s+|the\s+|todos\s+os\s+|all\s+)?(?:cen[aá]rios?|scenarios?|casos\s+de\s+teste|test\s+cases)|(?:execu[cç][aã]o|organiza[cç][aã]o|estrutura|configura[cç][aã]o)\s+(?:de\s+|dos\s+)?testes\b[^.;\n]{0,40}?\b(?:por|em\s+cada|para\s+cada|per)\s+(?:m[oó]dulo|pacote|fase|camada|module|package))\b/giu;
/*
 * O PROCEDIMENTO da execução de teste (§126).
 *
 * No Parallel Lab com Luna (0.7.0) nada acima reconheceu "a execução
 * automatizada dos testes e dos fluxos cria e destrói o banco descartável …
 * e fornece seu caminho por DATABASE_PATH": sem ferramenta, sem arquivo, sem
 * tipo de teste. A frase entrou na responsabilidade e no contrato dos
 * módulos, numa decisão de dados, nos requisitos de ambiente e no goal de
 * quatro fases; a auditoria da arquitetura a aprovou (fora ela que mandou
 * escrevê-la) e as de fase mandaram tirá-la. É a mesma decisão do build que
 * as formas acima separam — COMO a execução se organiza —, dita pelo que a
 * execução FAZ com os recursos dela: quem cria, aponta, configura e destrói.
 *
 * Duas formas, as do run: a execução de teste (ou "os testes", "a suíte",
 * "cada teste") como sujeito de um verbo de ciclo de vida, no indicativo, no
 * subjuntivo ou com modal ("devem criar"); e a atribuição nominal à execução
 * ("atribuir à execução dos testes a criação e a destruição"). E um recurso
 * no resto da oração — banco, base, arquivo, caminho, variável, SQLite, um
 * nome de variável de ambiente —, porque é ISSO que a regra separa: "os
 * testes definem a nota mínima" é o produto de um sistema de provas, "a
 * execução do fluxo 2 cria a tarefa" é um workflow (fluxo sozinho é o
 * vocabulário do próprio esqueleto, não um teste). O fluxo só conta como
 * teste ao lado dele ("dos testes e dos fluxos") ou automatizado ("a execução
 * automatizada dos fluxos integrados"). "Testes" depois de outro substantivo
 * ("o cadastro de testes cria um registro") não é sujeito, e a negação ou o
 * "como" antes do sujeito ("não cabe à execução dos testes criar o banco",
 * "como a execução dos testes cria o banco é decisão do build") anulam a
 * frase.
 *
 * A propriedade do banco continua sendo comportamento e não é tocada — "um
 * banco descartável, criado e destruído pela própria execução" é como a §118 e
 * a §122 calibraram o requisito —, nem o lado da aplicação ("a aplicação aceita
 * DATABASE_PATH apontando para outro arquivo"), nem a negação depois do
 * sujeito ("a execução dos testes não cria nem destrói o banco do `.env`").
 *
 * A autoridade é de procedimento, não de termo: se o pedido ou uma decisão do
 * desenvolvedor prescreve o que a execução de teste faz com um recurso ("os
 * testes devem criar um arquivo temporário…"), o procedimento é dele, e
 * nenhuma redação do plano que o repita conta. "Os testes criam seus próprios
 * dados de exemplo" não autoriza nada: não fala de recurso.
 */
const QUALIFICADOR_DE_TESTE = "(?:\\s+automatizad[oa]s|\\s+integrad[oa]s)?";
const EXECUCAO_DE_TESTE =
  "execu[cç](?:[aã]o|[oõ]es)" +
  "(?:\\s+automatizadas?(?:\\s+d[eoa]s?\\s+(?:testes?|fluxos?|su[ií]tes?))?|\\s+d[eoa]s?\\s+(?:testes?|su[ií]tes?))" +
  `${QUALIFICADOR_DE_TESTE}(?:\\s+(?:e|ou)\\s+d[eoa]s?\\s+(?:testes?|fluxos?)${QUALIFICADOR_DE_TESTE})?`;
/** "Testes" é sujeito quando não é complemento de outro substantivo ("o cadastro de testes"). */
const NAO_COMPLEMENTO = "(?<!(?:de|do|da|dos|das|para|sem|com|no|na|nos|nas|of|for)\\s)";
const TESTES_COMO_SUJEITO =
  `(?:(?:(?:os|as|the)\\s+)?${NAO_COMPLEMENTO}(?:testes|su[ií]te)(?:\\s+automatizad[oa]s?)?(?:\\s+d[eoa]s?\\s+(?:cada\\s+)?[\\p{L}-]+)?` +
  "(?:\\s+(?:e|ou)\\s+(?:os\\s+)?fluxos(?:\\s+integrados)?)?|cada\\s+teste(?:\\s+automatizado)?)" +
  "(?:\\s+(?:devem|deve|precisam|precisa|v[aã]o|vai|ir[aã]o|ir[aá]))?";
const VERBO_DE_CICLO =
  "(?:cri(?:a|am|e|em|ar)|destr(?:[oó]i|oem|ua|uam|uir)|remov(?:e|em|a|am|er)|apag(?:a|am|ue|uem|ar)|descart(?:a|am|e|em|ar)|" +
  "forne(?:ce|cem|[cç]a|[cç]am|cer)|defin(?:e|em|a|am|ir)|configur(?:a|am|e|em|ar)|prepar(?:a|am|e|em|ar)|apont(?:a|am|e|em|ar)|export(?:a|am|e|em|ar))";
/** Até quatro palavras entre o sujeito e o verbo, sem pontuação e sem negação. */
const LACUNA = "(?:\\s+(?!(?:n[aã]o|nunca|nem|jamais)(?![\\p{L}\\p{N}_]))[^\\s.;:,]+){0,4}?";
/** Fronteira de palavra que conhece acento: o `\b` do JavaScript vê "cria" dentro de "criação". */
const INICIO = "(?<![\\p{L}\\p{N}_])";
const FIM = "(?![\\p{L}\\p{N}_])";
const TEST_RUN = new RegExp(
  [
    `${INICIO}(${EXECUCAO_DE_TESTE}${LACUNA}\\s+(?:${VERBO_DE_CICLO}|(?:a|à)\\s+(?:cria[cç][aã]o|destrui[cç][aã]o|remo[cç][aã]o)))${FIM}`,
    `${INICIO}(${TESTES_COMO_SUJEITO}\\s+${VERBO_DE_CICLO})${FIM}`,
    `${INICIO}((?:the\\s+)?(?:test\\s+(?:runs?|execution|suite)|(?:automated\\s+)?tests|each\\s+test)(?:\\s+and\\s+(?:the\\s+)?flows)?` +
      `\\s+(?:(?:must|should|will)\\s+)?(?:creates?|destroys?|removes?|deletes?|discards?|provides?|sets?|configures?|prepares?|points?|exports?))${FIM}`,
  ].join("|"),
  "giu",
);
/** O recurso de que a oração trata: sem ele, o verbo é do produto. */
const RECURSO = /(?<![\p{L}\p{N}_])(?:bancos?|base\s+de\s+dados|databases?|db|arquivos?|files?|caminhos?|paths?|vari[aá]vel|vari[aá]veis|variables?|sqlite)(?![\p{L}\p{N}_])/iu;
const VARIAVEL_DE_AMBIENTE = /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9]*_[A-Z0-9_]+(?![\p{L}\p{N}_])/u;
/** O que, antes do sujeito na mesma oração, faz dela uma negação ou uma descrição de quem decide. */
const ANTES_DO_SUJEITO = /(?<![\p{L}\p{N}_])(?:n[aã]o|nunca|jamais|como|never|not|how)(?![\p{L}\p{N}_])/iu;

/** O composto que não escapa pela autoridade: teste de software, genérico. */
const COMPOSTO_DE_SOFTWARE =
  /automatizad|automated|unit|integra|e2e|end-to-end|ponta\s+a\s+ponta|aceita|acceptance|regress|carga|load|fuma|smoke|contrato|contract|snapshot|funciona|su[ií]te|suite|cobertura|coverage|manua|cen[aá]rio|scenario|execu|organiza|configura|estrutura/iu;

/** O que autoriza nomear uma ferramenta: o pedido e as decisões aceitas. */
export type TestAuthority = readonly string[];

/**
 * Os termos de teste que este texto prescreve e nenhuma fonte autoriza.
 * Vazio significa que o texto está dentro da responsabilidade do plano.
 */
export function testPrescriptions(text: string, authority: TestAuthority = []): string[] {
  const fontes = authority.join("\n").toLowerCase();
  const achados = new Map<string, string>();
  for (const match of text.matchAll(TEST_TOOLS)) {
    const termo = match[0];
    if (!fontes.includes(termo.toLowerCase())) achados.set(termo.toLowerCase(), termo);
  }
  for (const match of text.matchAll(TEST_FILES)) {
    const termo = (match[1] ?? "").replace(/[.,;:)\]}]+$/u, "");
    if (termo !== "" && !fontes.includes(termo.toLowerCase())) achados.set(termo.toLowerCase(), termo);
  }
  const normalizar = (trecho: string): string => trecho.replace(/\s+/g, " ").replace(/^[\s.;:!?-]+/u, "").trim();
  for (const match of text.matchAll(TEST_WORK)) {
    const objeto = normalizar(`${match[1] ?? ""}${match[2] ?? ""}`);
    // O composto do domínio do produto que o pedido contém é o produto, não a prova.
    if (!COMPOSTO_DE_SOFTWARE.test(objeto) && fontes.includes(objeto.toLowerCase())) continue;
    const termo = normalizar(match[0]);
    achados.set(termo.toLowerCase(), termo);
  }
  for (const match of [...text.matchAll(TEST_COVER), ...text.matchAll(TEST_TASK)]) {
    const termo = normalizar(match[0]);
    achados.set(termo.toLowerCase(), termo);
  }
  for (const match of text.matchAll(TEST_STRATEGY)) {
    const termo = normalizar(match[1] ?? match[0]);
    if (!fontes.includes(termo.toLowerCase())) achados.set(termo.toLowerCase(), termo);
  }
  for (const termo of testRunPrescriptions(text, authority)) achados.set(termo.toLowerCase(), termo);
  return [...achados.values()];
}

/**
 * Só o procedimento da execução de teste (§126) — a parte de I-16 que é prosa
 * e nunca nomeia uma ferramenta.
 *
 * Existe à parte porque quem APAGA por I-16 apaga ferramenta: o item de
 * infraestrutura e a entrada de stack que são de teste saem contando. Um item
 * que só descreve o que a execução faz ("better-sqlite3 — … os testes criam o
 * banco temporário") não é ferramenta de teste; apagá-lo perderia a
 * dependência da aplicação. Ele fica, e a frase volta a quem escreveu.
 *
 * O procedimento que o desenvolvedor prescreveu é dele, em qualquer redação.
 */
export function testRunPrescriptions(text: string, authority: TestAuthority = []): string[] {
  if (authority.some((fonte) => procedimentos(fonte).length > 0)) return [];
  return procedimentos(text);
}

function procedimentos(text: string): string[] {
  const termos = new Map<string, string>();
  for (const match of text.matchAll(TEST_RUN)) {
    const inicio = match.index ?? 0;
    const fim = inicio + match[0].length;
    const antes = text.slice(0, inicio).split(/[.;:\n]/u).at(-1) ?? "";
    const depois = (text.slice(fim).split(/[.;:\n]/u)[0] ?? "").slice(0, 120);
    if (ANTES_DO_SUJEITO.test(antes)) continue;
    if (!RECURSO.test(depois) && !VARIAVEL_DE_AMBIENTE.test(depois)) continue;
    const termo = (match[1] ?? match[2] ?? match[3] ?? match[0]).replace(/\s+/g, " ").trim();
    termos.set(termo.toLowerCase(), termo);
  }
  return [...termos.values()];
}

/** Os termos de I-16 que nomeiam ferramenta, arquivo ou estratégia — tudo menos o procedimento da execução. */
export function testToolPrescriptions(text: string, authority: TestAuthority = []): string[] {
  const procedimento = new Set(testRunPrescriptions(text, authority).map((termo) => termo.toLowerCase()));
  return testPrescriptions(text, authority).filter((termo) => !procedimento.has(termo.toLowerCase()));
}

/** A correção, a mesma em todo documento: comportamento fica, ferramenta sai. */
export function testPrescriptionHint(terms: readonly string[]): string {
  return (
    `remova ${terms.map((termo) => `"${termo}"`).join(", ")} e descreva só o comportamento observável do produto;` +
    " como o produto é provado — estratégia, ferramenta, arquivos, cenários, tipo e organização de teste, e em que fase o trabalho de teste acontece — é decisão do build, não do plano." +
    " O que o pedido exige sobre testes continua valendo como REQUISITO do produto, escrito como critério de aceite de uma task do produto" +
    " (por exemplo: \"o módulo possui testes automatizados, executados contra um banco descartável apontado pela variável de ambiente\")," +
    " sem task de escrever testes, sem escolher ferramenta, sem nomear arquivo e sem dizer o que a suíte cobre. Não apague o requisito: mova-o"
  );
}

/**
 * I-16 no plano: toda task cujo título ou critérios prescrevem teste.
 *
 * O erro leva a linha da task, para a emenda ir à fase certa — e só a ela.
 */
export function checkTestPrescription(document: PhasesDocument, authority: TestAuthority = []): ContractError[] {
  const errors: ContractError[] = [];
  for (const phase of document.phases) {
    for (const task of phase.tasks) {
      const terms = testPrescriptions([task.title, ...task.acceptanceCriteria].join("\n"), authority);
      if (terms.length === 0) continue;
      errors.push({
        code: "I-16",
        line: task.line,
        message: `a task "${task.title}" da fase ${phase.number} prescreve teste: ${terms.join(", ")}`,
        hint: testPrescriptionHint(terms),
      });
    }
  }
  return errors;
}
