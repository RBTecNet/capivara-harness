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
 * O número é empírico e revisável: 60 fica acima de tudo o que já funcionou e
 * abaixo do que nunca foi tentado. Quando houver evidência de fase maior
 * fechando, ele sobe.
 */
export const MAX_CRITERIA_PER_PHASE = 60;

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
 * Com 15 tasks e 4 critérios, uma fase fecha em 60 — o mesmo teto por fase, agora
 * consequência de uma regra por task em vez de um número solto.
 */
export const MAX_CRITERIA_PER_TASK = 4;

