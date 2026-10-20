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
  return [...achados.values()];
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
