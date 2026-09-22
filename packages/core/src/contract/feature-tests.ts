/**
 * Os testes que a fase nomeia, extraídos do documento.
 *
 * O plano não pede "testes": ele nomeia cada um — `consulta_sem_sessao`,
 * `consulta_vazia_e_falha` — junto da regra de negócio que ele afirma. Esses
 * nomes são a parte MECÂNICA da verificação: procurá-los na árvore não exige
 * julgamento nenhum, e é a única parte do gate 3 que não depende da atenção de
 * um modelo variar entre um ciclo e o seguinte.
 *
 * A fase 4 do MCP_teste mostrou o custo de não fazer isso. No ciclo 1 o
 * verificador aprovou a task 6 e reprovou a task 8; no ciclo 2, com a task 8
 * corrigida e a 6 intocada, reprovou a 6. Os dois buracos existiam desde o
 * começo, e cada um custou um ciclo inteiro porque foram achados a conta-gotas.
 *
 * A gramática mora aqui porque é gramática de fase — o resto do harness importa
 * esta função em vez de reescrever o regex.
 */

/** `- **Feature tests:** nome -> regra; outro -> regra` */
const FEATURE_TESTS_LINE = /^-?\s*\*\*Feature tests:\*\*\s*(\S.*)$/;
const TASK_LINE = /^- \[[ xX]\] \*\*Task:\*\*/;

export interface NamedFeatureTest {
  /** A posição da task na fase, a partir de 1 — a mesma que o verificador usa. */
  task: number;
  name: string;
}

/**
 * O nome dentro de `nome -> regra`.
 *
 * A seta separa o nome da regra que ele afirma, e vem em três formas: `->`,
 * `→` e `—`. Sem seta, a entrada inteira é o nome. Crases são decoração.
 */
function nomeDe(entrada: string): string {
  const semRegra = entrada.split(/->|→|\s—\s/)[0] ?? "";
  return semRegra.replace(/[`*]/g, "").trim();
}

/**
 * Nome de teste, ou frase?
 *
 * O plano às vezes descreve em vez de nomear ("cobertura dos três estados").
 * Procurar uma frase na árvore não prova nada, e um "NÃO ENCONTRADO" falso é
 * pior que o silêncio: ensina quem lê a ignorar a lista.
 */
function pareceNome(valor: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.-]{2,}$/.test(valor);
}

export function featureTestNames(phaseMarkdown: string): NamedFeatureTest[] {
  const nomes: NamedFeatureTest[] = [];
  let task = 0;

  for (const linha of phaseMarkdown.split("\n")) {
    const limpa = linha.trim();
    if (TASK_LINE.test(limpa)) {
      task += 1;
      continue;
    }

    const match = FEATURE_TESTS_LINE.exec(limpa);
    if (!match || task === 0) continue;

    for (const entrada of (match[1] ?? "").split(";")) {
      const nome = nomeDe(entrada);
      if (pareceNome(nome) && !nomes.some((outro) => outro.name === nome)) nomes.push({ task, name: nome });
    }
  }

  return nomes;
}
