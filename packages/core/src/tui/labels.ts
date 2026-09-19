/**
 * Os passos do ciclo, num lugar só.
 *
 * O painel precisa do nome curto e o orquestrador emite o `subject` do evento.
 * Manter os dois juntos evita que o painel passe a mostrar uma etapa que o
 * ciclo não tem mais — foi o que aconteceu quando a cadeia de quatro documentos
 * em prosa saiu e o painel continuou anunciando os quatro.
 */

export const PIPELINE_STEPS = [
  { id: "skeleton", label: "esqueleto do produto" },
  { id: "project-phases.md", label: "plano executável" },
] as const;
