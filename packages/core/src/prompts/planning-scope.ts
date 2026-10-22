/**
 * O que o planejamento é, e o que ele não é — prefixado em todo prompt do
 * `init` e do `plan`.
 *
 * Decisão do desenvolvedor (§115.39, §116): o planejamento define o produto e
 * o caminho de implementação; quem decide como provar o produto é o avaliador
 * do build, lendo o código entregue. Um teste nomeado antes de existir código
 * é uma obrigação inventada, e a geração anterior do contrato pagou por isso.
 *
 * E a fronteira é inteira (§129): até a §128 este texto mandava o plano
 * "carregar" a exigência de testes do pedido — na responsabilidade do
 * componente e num critério de task de produto —, e no Parallel Lab isso
 * custou seis de nove achados da rodada 2, com a fase 3 reprovada por NÃO ter
 * o critério. O que o pedido diz sobre testes é do build, como "compilar sem
 * erros"; o esqueleto o guarda para ele, e o plano não o carrega nem devolve
 * por causa dele.
 */
export function planningScopeBlock(): string {
  return [
    "## Planning responsibility",
    "The plan describes the product to build: capabilities, components and their contracts,",
    "dependencies, infrastructure and observable acceptance criteria.",
    "Tests are not part of it, in any form: no test task or phase, no test file, name, count,",
    "directory, configuration or strategy, and no criterion, responsibility, contract, goal or rule",
    "saying that the product or a module has tests, which tests, what they cover, against which",
    "database they run, how they are executed or that they pass.",
    "The one place tests touch the plan is the infrastructure: it lists every dependency the build will",
    "need, the test ones included — the stack's test runner, Playwright for a browser interface — so the",
    "build installs and validates them once, before the first phase. Listing a dependency is",
    "infrastructure; what is tested, and how, is the build's.",
    "What the developer's request says about tests — automated tests, tests per module, an isolated test",
    "database, every test approved — is an instruction to the BUILD, exactly like \"compile without errors\":",
    "the build executes it once the code exists. The skeleton records it once, in rules whose subject",
    "starts with \"testes\", and the harness hands those rules to the build; nothing else in the skeleton,",
    "the architecture or the phases carries or restates it, and a plan that never mentions tests has lost",
    "nothing.",
    "Describing expected functional behaviour is not a test. \"Deleting a column is refused while it",
    "still has cards\" is a criterion, and stays; \"write the test deletes_column_with_cards\" and \"the",
    "module has its own automated tests\" are not, and do not belong anywhere in the plan.",
    "Tests are never a reason to reject, return or question a plan: not because tests are missing, not",
    "because the developer's test requirement seems lost, not to ask for a test criterion or a test task.",
    "Test content that reaches the plan is counted and removed by the harness's own check; what a reading",
    "may still ask about it is only that it be removed — never moved to another place in the plan.",
    "What the product itself must offer so that the build can run it — accepting its database location",
    "from the environment, for example — is product behaviour, and stays where the skeleton states it.",
    "A conflict between the document and this responsibility is a defect of the document, never a",
    "decision for the developer: the rule is not his to suspend, and nobody asks him to.",
    "When the product itself is a testing tool, its features are product: a test that the product's user",
    "creates or runs is a feature, not a test of the product.",
  ].join("\n");
}
