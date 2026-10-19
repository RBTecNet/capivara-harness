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
  return [...achados.values()];
}

/** A correção, a mesma em todo documento: comportamento fica, ferramenta sai. */
export function testPrescriptionHint(terms: readonly string[]): string {
  return (
    `remova ${terms.map((termo) => `"${termo}"`).join(", ")} e descreva só o comportamento observável do produto;` +
    " como o produto é provado — estratégia, ferramenta, arquivos e cenários de teste — é decisão do build, não do plano." +
    " O que o pedido exige sobre testes (por exemplo, que o produto tenha testes automatizados com banco isolado) continua" +
    " valendo como requisito, sem escolher ferramenta nem nomear arquivo"
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
