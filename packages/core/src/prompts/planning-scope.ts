/**
 * O que o planejamento é, e o que ele não é — prefixado em todo prompt do
 * `init` e do `plan`.
 *
 * Decisão do desenvolvedor (§115.39, §116): o planejamento define o produto e
 * o caminho de implementação; quem decide como provar o produto é o avaliador
 * do build, lendo o código entregue. Um teste nomeado antes de existir código
 * é uma obrigação inventada, e a geração anterior do contrato pagou por isso.
 */
export function planningScopeBlock(): string {
  return [
    "## Planning responsibility",
    "The plan describes the product to build: capabilities, components and their contracts,",
    "dependencies, infrastructure and observable acceptance criteria.",
    "It never prescribes tests: no test files, test names, test counts, test-only tasks or phases,",
    "validation procedures or test strategies. How the delivered product is proven is decided later,",
    "by the build's evaluator, reading the real code.",
    "Describing expected functional behaviour is not a test. \"Deleting a column is refused while it",
    "still has cards\" is a criterion; \"write the test deletes_column_with_cards\" is not, and does not",
    "belong anywhere in the plan.",
    "Test tooling — runners, browser-automation frameworks, assertion libraries — is chosen in the build,",
    "not here: it does not enter the skeleton's stack, the infrastructure or any task, and no task names",
    "a test file, a test directory or a test configuration. When the developer requires automated tests,",
    "the plan keeps that as a requirement of the product (what must hold, under which conditions — for",
    "example an isolated database) without choosing the tool.",
    "The same holds without any tool named: no task or phase whose work is delivering, writing or",
    "configuring a test suite; no criterion saying what the suite covers, which kind of tests exist",
    "(unit, integration, end-to-end) or how test execution is organised per module. \"The module has",
    "automated tests, run against a disposable database\" is a criterion of a product task; \"Deliver the",
    "module's automated suite covering create, edit and delete\" is a test task, and does not belong here.",
    "A conflict between the document and this responsibility is a defect of the document, never a",
    "decision for the developer: the rule is not his to suspend, and nobody asks him to.",
    "Do not reject a plan for not specifying tests. Preserve requirements explicitly requested by the",
    "developer, including when the product itself is a testing tool: a tool the request itself names",
    "is the developer's choice, not the plan's.",
  ].join("\n");
}
