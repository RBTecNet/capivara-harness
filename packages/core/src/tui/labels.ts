/**
 * Os rótulos da cadeia documental, num lugar só.
 *
 * O painel precisa do nome curto e o orquestrador precisa do nome do arquivo.
 * Manter os dois juntos evita que um painel passe a mostrar uma etapa que a
 * cadeia não tem mais.
 */

export const DOCUMENT_CHAIN_LABELS = [
  { id: "project-description.md", label: "descrição do projeto" },
  { id: "user-stories.md", label: "histórias de usuário" },
  { id: "database-schema.md", label: "modelo de dados" },
  { id: "project-phases.md", label: "plano executável" },
] as const;
