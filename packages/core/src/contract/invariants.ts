/**
 * O registro dos invariantes do contrato `capivara-phases/v1`.
 *
 * Esta lista é a autoridade: o validador reporta por código, e o documento
 * `docs/capivara-phases-v1.md` é renderizado a partir daqui. Um invariante que
 * não estiver nesta tabela não existe, e um campo novo no contrato só entra
 * depois de responder: "qual decisão do loop quebra sem ele?".
 */

export const PHASES_CONTRACT = "capivara-phases/v1" as const;

export type InvariantCode =
  | "I-01" | "I-02" | "I-03" | "I-04" | "I-05" | "I-06" | "I-07"
  | "I-08" | "I-09" | "I-10" | "I-11" | "I-12" | "I-13" | "I-14";

/** Quem verifica o invariante. O parser é puro; os demais recebem o mundo por parâmetro. */
export type InvariantChecker = "parser" | "stamps" | "coverage" | "design-refs";

/**
 * Como o invariante se manifesta.
 *
 * `rejects` produz um `ContractError` com o código do invariante. `behaviour`
 * não rejeita nada: descreve como o parser lê o documento, e é provado por
 * teste de comportamento em vez de por código de erro.
 */
export type InvariantEnforcement = "rejects" | "behaviour";

export interface Invariant {
  code: InvariantCode;
  title: string;
  /** Por que o invariante existe: qual decisão do loop quebra sem ele. */
  rationale: string;
  checkedBy: InvariantChecker;
  enforcement: InvariantEnforcement;
}

export const INVARIANTS: readonly Invariant[] = [
  {
    code: "I-01",
    title: "A linha 1 é `# <nome> — Project Phases`",
    rationale: "Identidade do documento. Sem ela o loop não sabe se recebeu um plano de execução ou outro markdown qualquer.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-02",
    title: "A linha 3 é o stamp `<!-- inputs: ... -->` com os três sha256 de 12 caracteres, frescos",
    rationale: "Detecta documento gerado antes de um upstream mudar. A forma é verificada pelo parser; o frescor exige os bytes atuais dos arquivos citados.",
    checkedBy: "stamps",
    enforcement: "rejects",
  },
  {
    code: "I-03",
    title: "Toda fase é `## Phase N: <título>`, com N contíguo a partir de 1, seguida da linha de metadados `**Goal:** · **Depends on:** · **Covers:**`",
    rationale: "O divisor cria uma sessão de agente por fase. Numeração com buraco ou repetição torna a referência por número ambígua, e sem Goal o agente frio não sabe o resultado observável que a fase possui.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-04",
    title: "Nenhum heading `## Phase` fora desse formato",
    rationale: "Uma fase malformada desapareceria silenciosamente do run: o divisor não a reconhece e ninguém percebe a ausência.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-05",
    title: "Sub-fases existem apenas como `### Phase N.M: <título>`, com N igual ao da fase corrente",
    rationale: "Sub-fase promovida a nível 2 vira sessão própria e quebra a regra de dimensionamento: pai e sub-fases compartilham uma sessão.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-06",
    title: "Qualquer outro heading de nível 2 encerra a captura da fase anterior",
    rationale: "Conteúdo fora de fase nunca chega ao agente. Tornar isso explícito evita que texto de `## Overview` ou `## Open Questions` seja confundido com trabalho a implementar.",
    checkedBy: "parser",
    enforcement: "behaviour",
  },
  {
    code: "I-07",
    title: "Toda fase declara pelo menos uma task",
    rationale: "Fase sem task é uma sessão de agente paga sem nada a fazer.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-08",
    title: "Toda task declara pelo menos um critério de aceitação",
    rationale: "O verificador independente decide DONE ou INCOMPLETE task a task contra os critérios. Sem critério não há veredito possível.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-09",
    title: "Toda task declara `**Traces:**` não vazio",
    rationale: "Rastreabilidade em ambas as direções: nada inventado e nada órfão. É também o que alimenta as coberturas I-10 a I-12.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-10",
    title: "Toda story `US-N.M` declarada no esqueleto aparece em pelo menos um `**Traces:**`",
    rationale: "Cobertura: uma story sem task é trabalho que o plano esqueceu, e o loop entregaria uma aplicação incompleta sem nunca reprovar.",
    checkedBy: "coverage",
    enforcement: "rejects",
  },
  {
    code: "I-11",
    title: "Toda entidade declarada no modelo de dados aparece em pelo menos uma task",
    rationale: "Cobertura: uma tabela citada em lugar nenhum do plano é um dado que nunca será implementado.",
    checkedBy: "coverage",
    enforcement: "rejects",
  },
  {
    code: "I-12",
    title: "Todo workflow numerado do esqueleto é coberto por uma task ou explicitamente excluído",
    rationale: "Cobertura: um fluxo principal pode sumir entre a descrição e o plano sem que nenhuma verificação perceba.",
    checkedBy: "coverage",
    enforcement: "rejects",
  },
  {
    code: "I-13",
    title: "Nenhum marcador `[NEEDS DECISION]` no documento",
    rationale: "Gap aberto bloqueia o RALPH READY. Mandar o loop implementar uma decisão que ninguém tomou produz código que será descartado.",
    checkedBy: "parser",
    enforcement: "rejects",
  },
  {
    code: "I-14",
    title: "Todo `**Design ref:**` aponta para um caminho existente sob o diretório de design",
    rationale: "Referência morta engana o executor: ele implementa por conta própria acreditando ter seguido um design que não existe.",
    checkedBy: "design-refs",
    enforcement: "rejects",
  },
] as const;

export function invariant(code: InvariantCode): Invariant {
  const found = INVARIANTS.find((entry) => entry.code === code);
  if (!found) throw new Error(`invariante desconhecido: ${code}`);
  return found;
}
