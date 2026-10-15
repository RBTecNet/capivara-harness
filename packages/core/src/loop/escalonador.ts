/**
 * O escalonador do build paralelo (§97).
 *
 * Quem decide qual fase roda, quando e em qual agente é ESTE módulo, e ele é
 * uma função pura sobre o estado do run: mesmas fases, mesmos estados, mesma
 * resposta. Nenhum modelo escolhe a ordem, e a pessoa não reparte trabalho entre
 * agentes — ela diz quantos podem rodar ao mesmo tempo, e o resto sai daqui.
 *
 * Três regras, todas conservadoras, porque o custo de errar para o lado
 * paralelo é uma fase construída sobre chão que ainda não existe:
 *
 * - **uma fase só sai quando todas as de que depende já foram INTEGRADAS** —
 *   não "verdes no worktree delas": verde num worktree é verde sobre a base que
 *   ele tinha, e quem vem depois constrói sobre a árvore integrada;
 * - **a primeira fase é fundação de todas.** O `Depends on` é escrito por modelo,
 *   e "none" numa fase 5 de um greenfield quer dizer, quase sempre, "nada além
 *   do básico". Rodá-la ao lado da fase 1, numa árvore vazia, é o erro caro;
 *   esperar a fundação é o barato;
 * - **dependência que não se lê vira "todas as anteriores".** Número que não
 *   existe no plano, ou que aponta para a frente, não é informação: é defeito,
 *   e o defeito volta à ordem serial em vez de liberar a fase.
 *
 * A concorrência configurada é TETO, não meta: com o grafo em fila, o build
 * paralelo roda uma fase por vez, como o serial.
 */

export interface FaseAgendavel {
  id: string;
  number: number;
  /** Ausente: sessão sem `Depends on` lido, tratada como dependente de todas as anteriores. */
  dependsOn?: readonly number[];
}

/**
 * - `pendente`: ainda não saiu;
 * - `rodando`: tem um agente nela, ou está na fila de integração;
 * - `integrada`: o trabalho dela está na árvore principal (ou não havia o que integrar);
 * - `falhou`: parou num gate, ou a integração não fechou;
 * - `bloqueada`: depende de uma que falhou, e nunca vai sair neste run.
 */
export type EstadoNaAgenda = "pendente" | "rodando" | "integrada" | "falhou" | "bloqueada";

export interface Agenda {
  /** Na ordem do plano: é a ordem de desempate, e o que torna a resposta determinística. */
  fases: readonly FaseAgendavel[];
  estados: ReadonlyMap<string, EstadoNaAgenda>;
  /**
   * Fases que precisam rodar SOZINHAS.
   *
   * É a saída para o conflito de integração: a fase refeita parte da árvore
   * integrada, e com nenhuma outra rodando nada pode mudar a base dela até ela
   * voltar. A segunda tentativa, por construção, não conflita.
   */
  exclusivas: ReadonlySet<string>;
  /** Quantos agentes podem estar ocupados agora. */
  limite: number;
}

export interface Dependencias {
  /** Os números das fases que precisam estar integradas antes. */
  numeros: number[];
  /** Por que o `Depends on` declarado não foi usado como veio; vazio quando foi. */
  ajuste: string;
}

/** As dependências que o escalonador de fato respeita, com a razão de cada ajuste. */
export function dependenciasEfetivas(fase: FaseAgendavel, fases: readonly FaseAgendavel[]): Dependencias {
  const anteriores = fases.filter((outra) => outra.number < fase.number).map((outra) => outra.number);
  if (anteriores.length === 0) return { numeros: [], ajuste: "" };

  if (fase.dependsOn === undefined) {
    return { numeros: anteriores, ajuste: "sem Depends on legível: espera todas as anteriores" };
  }

  const existentes = new Set(anteriores);
  const ilegiveis = fase.dependsOn.filter((numero) => !existentes.has(numero));
  if (ilegiveis.length > 0) {
    return {
      numeros: anteriores,
      ajuste: `Depends on cita ${ilegiveis.map((numero) => `Phase ${numero}`).join(", ")}, que não vem antes dela: espera todas as anteriores`,
    };
  }

  const fundacao = Math.min(...anteriores);
  const numeros = [...new Set([fundacao, ...fase.dependsOn])].sort((a, b) => a - b);
  // Só é ajuste quando a fundação não chegava por nenhum caminho: P4 → P2 → P1 já a tinha.
  return {
    numeros,
    ajuste: alcanca(fase, fundacao, fases) ? "" : `a Phase ${fundacao} é a fundação: entra como dependência`,
  };
}

/** A fase chega à outra pelo `Depends on` declarado, direta ou indiretamente? */
function alcanca(fase: FaseAgendavel, alvo: number, fases: readonly FaseAgendavel[]): boolean {
  const porNumero = new Map(fases.map((outra) => [outra.number, outra]));
  const visitadas = new Set<number>();
  const pilha = [...(fase.dependsOn ?? [])];
  while (pilha.length > 0) {
    const numero = pilha.pop()!;
    if (numero === alvo) return true;
    if (visitadas.has(numero)) continue;
    visitadas.add(numero);
    pilha.push(...(porNumero.get(numero)?.dependsOn ?? []).filter((dependencia) => dependencia < numero));
  }
  return false;
}

function estadoDe(agenda: Agenda, id: string): EstadoNaAgenda {
  return agenda.estados.get(id) ?? "pendente";
}

function porNumero(agenda: Agenda): Map<number, FaseAgendavel> {
  return new Map(agenda.fases.map((fase) => [fase.number, fase]));
}

/** As dependências de uma fase que ainda não estão integradas. */
export function faltando(agenda: Agenda, fase: FaseAgendavel): FaseAgendavel[] {
  const numeros = porNumero(agenda);
  return dependenciasEfetivas(fase, agenda.fases)
    .numeros.map((numero) => numeros.get(numero))
    .filter((dependencia): dependencia is FaseAgendavel => dependencia !== undefined && estadoDe(agenda, dependencia.id) !== "integrada");
}

/**
 * As fases que podem sair AGORA, na ordem em que devem sair.
 *
 * Uma fase exclusiva elegível vira barreira: nada depois dela sai enquanto ela
 * espera os agentes ocupados terminarem. Sem a barreira, as fases seguintes
 * ocupariam cada agente que vagasse, e a exclusiva esperaria para sempre.
 */
export function proximas(agenda: Agenda): string[] {
  const rodando = agenda.fases.filter((fase) => estadoDe(agenda, fase.id) === "rodando");
  if (rodando.some((fase) => agenda.exclusivas.has(fase.id))) return [];

  let livres = Math.max(0, agenda.limite - rodando.length);
  const saem: string[] = [];
  for (const fase of agenda.fases) {
    if (livres === 0) break;
    if (estadoDe(agenda, fase.id) !== "pendente") continue;
    if (faltando(agenda, fase).length > 0) continue;
    if (agenda.exclusivas.has(fase.id)) {
      if (rodando.length === 0 && saem.length === 0) return [fase.id];
      break;
    }
    saem.push(fase.id);
    livres -= 1;
  }
  return saem;
}

/**
 * As pendentes que nunca vão sair porque dependem, direta ou indiretamente, de
 * uma que falhou ou ficou bloqueada. É o que o `--keep-going` pula.
 */
export function bloqueadas(agenda: Agenda): string[] {
  const perdidas = new Set(
    agenda.fases.filter((fase) => ["falhou", "bloqueada"].includes(estadoDe(agenda, fase.id))).map((fase) => fase.number),
  );
  const resultado: string[] = [];
  // Na ordem do plano, a dependência sempre vem antes: uma passada basta.
  for (const fase of agenda.fases) {
    if (estadoDe(agenda, fase.id) !== "pendente") continue;
    if (dependenciasEfetivas(fase, agenda.fases).numeros.some((numero) => perdidas.has(numero))) {
      perdidas.add(fase.number);
      resultado.push(fase.id);
    }
  }
  return resultado;
}

/** Nada rodando e nada que possa sair: o run acabou, bem ou mal. */
export function esgotada(agenda: Agenda): boolean {
  const rodando = agenda.fases.some((fase) => estadoDe(agenda, fase.id) === "rodando");
  return !rodando && proximas({ ...agenda, limite: Math.max(1, agenda.limite) }).length === 0;
}

/**
 * Quantas fases, no máximo, o grafo deixa rodar ao mesmo tempo.
 *
 * É a largura do plano sob as regras acima — o número que a tela de resumo
 * mostra ao lado da concorrência pedida, para quem pediu quatro agentes saber
 * que este plano só ocupa dois.
 */
export function larguraDoPlano(fases: readonly FaseAgendavel[]): number {
  const nivel = new Map<number, number>();
  for (const fase of [...fases].sort((a, b) => a.number - b.number)) {
    const deps = dependenciasEfetivas(fase, fases).numeros;
    nivel.set(fase.number, deps.length === 0 ? 0 : Math.max(...deps.map((numero) => nivel.get(numero) ?? 0)) + 1);
  }
  const porNivel = new Map<number, number>();
  for (const valor of nivel.values()) porNivel.set(valor, (porNivel.get(valor) ?? 0) + 1);
  return Math.max(0, ...porNivel.values());
}
