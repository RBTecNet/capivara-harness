/**
 * O inventário dos testes que a fase nomeia.
 *
 * O texto abaixo é o da fase 4 do MCP_teste, copiado do documento publicado. É
 * dele que saem os dois nomes que custaram um ciclo cada: `consulta_sem_sessao`,
 * aprovado por engano no ciclo 1, e `consulta_vazia_e_falha`, reprovado nele.
 */

import { describe, expect, it } from "vitest";
import { featureTestNames } from "../../src/contract/index.js";

const FASE = [
  "## Phase 4: Locação, cálculo e disponibilidade",
  "",
  "- [ ] **Task:** Disponibilizar a função compartilhada `calcular_dias_cobraveis`.",
  "  - **Acceptance criteria:**",
  "    - Conta dias úteis.",
  "  - **Feature tests:** `datas_iguais` -> mesmo dia cobra uma diária; `sexta_ate_segunda` -> fim de semana não conta",
  "  - **Traces:** US-4.1",
  "",
  "- [ ] **Task:** Implementar a consulta autenticada das locações.",
  "  - **Acceptance criteria:**",
  "    - A consulta executa `exigir_funcionario_autenticado`.",
  "  - **Feature tests:** `consulta_sem_sessao` -> acesso protegido; `consulta_preserva_contratacao` -> leitura não recalcula valores",
  "  - **Traces:** US-4.2",
].join("\n");

describe("os testes nomeados pela fase", () => {
  it("lê os nomes e a qual task cada um pertence", () => {
    expect(featureTestNames(FASE)).toEqual([
      { task: 1, name: "datas_iguais" },
      { task: 1, name: "sexta_ate_segunda" },
      { task: 2, name: "consulta_sem_sessao" },
      { task: 2, name: "consulta_preserva_contratacao" },
    ]);
  });

  it("aceita as três setas que o modelo escreve", () => {
    const fase = [
      "- [ ] **Task:** X",
      "  - **Feature tests:** `com_seta_ascii` -> regra; `com_seta_unicode` → regra; `com_travessao` — regra",
    ].join("\n");

    expect(featureTestNames(fase).map((teste) => teste.name)).toEqual([
      "com_seta_ascii",
      "com_seta_unicode",
      "com_travessao",
    ]);
  });

  /*
   * Procurar uma frase na árvore não prova nada, e um "não encontrado" falso
   * ensina quem lê a ignorar a lista inteira.
   */
  it("descrição em prosa não vira nome de teste", () => {
    const fase = [
      "- [ ] **Task:** X",
      "  - **Feature tests:** cobertura dos três estados -> rótulos corretos; `estados_distintos` -> ok",
    ].join("\n");

    expect(featureTestNames(fase).map((teste) => teste.name)).toEqual(["estados_distintos"]);
  });

  it("fase sem testes nomeados devolve lista vazia, e ninguém precisa tratar nulo", () => {
    expect(featureTestNames("## Phase 1: X\n\n- [ ] **Task:** só isso\n")).toEqual([]);
  });

  it("o mesmo nome citado duas vezes entra uma vez só", () => {
    const fase = [
      "- [ ] **Task:** A",
      "  - **Feature tests:** `repetido` -> regra",
      "- [ ] **Task:** B",
      "  - **Feature tests:** `repetido` -> a mesma regra, citada de novo",
    ].join("\n");

    expect(featureTestNames(fase)).toEqual([{ task: 1, name: "repetido" }]);
  });
});
