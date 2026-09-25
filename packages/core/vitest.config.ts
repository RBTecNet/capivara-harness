/**
 * O tempo que um teste tem, e por que o padrão não servia.
 *
 * O padrão do vitest é 5 segundos, e os cenários de integração — a cadeia
 * `init` → `plan` → `build` inteira contra o provider falso — passam perto disso
 * numa máquina ociosa. Com a máquina ocupada (um `npm run build` em paralelo, um
 * run de verdade do harness ao lado), eles estouram.
 *
 * Isso não é flakiness inofensiva: hoje ela me fez ler "6 testes falharam" três
 * vezes e, na terceira, empurrar um commit com FAIL na tela porque eu já tinha
 * aprendido a desconfiar do número. Um suíte em que se aprende a ignorar o
 * vermelho não protege nada.
 *
 * Trinta segundos é folga de sobra para o cenário mais pesado — que roda em menos
 * de dois — e continua curto o bastante para um teste travado falhar em vez de
 * pendurar a suíte.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
