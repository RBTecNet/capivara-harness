/**
 * A política de teste, uma só para quem escreve o código e para quem o julga.
 *
 * O executor era obrigado a escrever o par positivo/negativo de cada critério e
 * a provar o modo de falha, e o verificador a desconfiar da suíte verde. Cada
 * incidente acrescentava uma frase moderando a anterior, e as obrigações
 * continuavam valendo. A regra inteira fica aqui, lida pelos dois prompts;
 * nenhum deles fala de que teste escrever fora dela.
 */
export function testPolicyBlock(): string {
  return [
    "## Test policy — the same for the builder and the verifier",
    "- The builder writes tests for the main behaviour of the phase and chooses which. No acceptance criterion requires",
    "  a test of its own, a positive/negative pair or a proof of its failure mode.",
    "- A green suite is valid evidence of what it tests — no more, no less. What the suite does not cover is judged by",
    "  the phase review, reading the code; missing test coverage alone is never a defect.",
    "- A test from an earlier phase that this phase made obsolete is updated in the same cycle.",
    "- The tests the developer asked for are the shared contract's rules about tests (subject starting with \"testes\")",
    "  and its stack entry about tests: the build honours them for what each phase delivers, under the conditions they state.",
  ].join("\n");
}
