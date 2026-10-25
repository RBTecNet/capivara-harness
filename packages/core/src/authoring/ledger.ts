/**
 * Os tetos que uma fase precisa respeitar para caber numa sessão de agente.
 *
 * Eram do ledger de coordenação, que morreu com a cadeia em prosa. Os números
 * sobreviveram porque não vieram do ledger: vieram de medir os pilotos.
 */
export const MAX_TASKS_PER_PHASE = 15;

/**
 * Teto de critérios por fase.
 *
 * Contar tasks mede a coisa errada. Os três pilotos que fecharam ficaram entre
 * 2,1 e 2,5 critérios por task, com no máximo 46 critérios numa fase. O piloto 3
 * saiu com 84 numa fase só — o mesmo número de tasks, o dobro do trabalho, e uma
 * sessão de agente que ninguém nunca testou desse tamanho.
 *
 * Desde a etapa 3 da redução, 30: é a consequência de 15 tasks com 2 critérios.
 * Cada critério é uma obrigação que a revisão da fase confere; o teto menor é
 * menos verificação por fase, e não menos produto — a task que precisaria de
 * mais critérios está fazendo mais de uma coisa.
 */
export const MAX_CRITERIA_PER_PHASE = 30;

/**
 * Teto de critérios por task.
 *
 * É a âncora mais estável que os pilotos produziram: os três que fecharam
 * ficaram entre 2,1 e 2,5 critérios por task — pousada, CLI Python e o primeiro
 * kanban —, e o piloto 3 saiu com 4,3. O escopo dele era o dobro do da pousada;
 * o plano saiu três vezes e meia maior.
 *
 * O teto não é sobre tamanho de documento. Uma task que precisa de nove critérios
 * está fazendo nove coisas, e a lista de critérios está compensando um enunciado
 * vago. Forçar o corte produz tasks menores e mais claras, que é o que a sessão
 * de agente do build precisa.
 *
 * O teto era 4 (etapa 3 da redução: 2). Os pilotos que fecharam ficavam entre
 * 2,1 e 2,5, e cada critério a mais multiplica o que a verificação confere sem
 * acrescentar o que o produto faz. Com 15 tasks e 2 critérios, uma fase fecha
 * em 30 — o teto por fase é consequência da regra por task.
 */
export const MAX_CRITERIA_PER_TASK = 2;

