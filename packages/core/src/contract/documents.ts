/**
 * Extração da forma dos três documentos upstream.
 *
 * Só o necessário para as coberturas I-10 a I-12: IDs de story, entidades do
 * modelo de dados e workflows numerados. A validação completa da forma de cada
 * documento pertence ao motor de auditoria, não ao contrato.
 */

const STORY_ROW = /^\|\s*(US-\d+\.\d+)\s*\|/;
const STORY_HEADING = /^### (US-\d+\.\d+):/;
const DBML_TABLE = /^Table\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
const WORKFLOW_HEADING = /^### (\d+)\.\s+(\S.*)$/;

/** IDs do apêndice `## Appendix: User Story Status`; o corpo serve de reserva. */
export function extractStoryIds(userStories: string): string[] {
  const rows = collect(userStories, STORY_ROW);
  const ids = rows.length > 0 ? rows : collect(userStories, STORY_HEADING);
  return unique(ids);
}

/**
 * Entidades declaradas no modelo de dados.
 *
 * Reconhece DBML (`Table <nome> {`). Um projeto sem persistência declara zero
 * entidades e a cobertura I-11 passa vazia — é o caso previsto para CLI,
 * biblioteca e filtro de dados, onde o documento existe e descreve outra coisa.
 */
export function extractEntities(databaseSchema: string): string[] {
  return unique(collect(databaseSchema, DBML_TABLE));
}

export interface Workflow {
  number: string;
  name: string;
}

/** Workflows numerados de `## Core Workflows` (`### 1. <nome>`). */
export function extractWorkflows(projectDescription: string): Workflow[] {
  const workflows: Workflow[] = [];
  for (const line of projectDescription.split(/\r?\n/)) {
    const match = WORKFLOW_HEADING.exec(line.trim());
    if (!match) continue;
    workflows.push({ number: match[1] ?? "", name: (match[2] ?? "").trim() });
  }
  return workflows;
}

function collect(source: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = pattern.exec(line.trim());
    if (match?.[1]) found.push(match[1]);
  }
  return found;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
