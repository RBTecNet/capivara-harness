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
    "Do not reject a plan for not specifying tests. Preserve requirements explicitly requested by the",
    "developer, including when the product itself is a testing tool.",
  ].join("\n");
}
