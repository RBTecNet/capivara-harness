/** Planeja o produto; a escolha da prova cabe à validação da entrega. */
export function planningScopeBlock(): string {
  return [
    "## Planning responsibility",
    "Testing belongs to the build validator. Plan product capabilities, contracts, dependencies and observable acceptance criteria.",
    "Do not prescribe test files, names, counts or test-only phases. Do not design a test suite during planning.",
    "Acceptance criteria describe how the delivered product must behave, not which tests must exist.",
    "Do not reject a plan because it does not specify tests. The validator chooses sufficient evidence after inspecting the delivered code.",
    "Preserve requirements explicitly requested by the developer, including when the product itself is a testing tool.",
    "Legacy test prescriptions in existing plans are advisory; they do not create extra product requirements.",
  ].join("\n");
}
