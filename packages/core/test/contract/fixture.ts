/** Um documento mínimo e válido. Os testes negativos mutam este texto. */
export const VALID_PHASES = `# Exemplo — Project Phases

<!-- inputs: project-description.md@sha256:aaaaaaaaaaaa user-stories.md@sha256:bbbbbbbbbbbb database-schema.md@sha256:cccccccccccc -->

## Overview

Fundação primeiro, depois os fluxos.

**Conventions:**
- \`[ ]\` pendente · \`[x]\` concluído

---

## Phase 1: Fundação de dados

**Goal:** As migrations e os seeds existem · **Depends on:** none · **Covers:** users, statuses, workflow 1

### Phase 1.1: Migrations

- [ ] **Task:** Criar a migration de users
  - **Acceptance criteria:**
    - A tabela users existe com email único e timestamps
  - **Feature tests:** users_migration → a tabela nasce com índice único em email
  - **Traces:** US-1.1, users, workflow 1

- [ ] **Task:** Semear a tabela statuses
  - **Acceptance criteria:**
    - A tabela statuses contém exatamente as três linhas declaradas
  - **Traces:** US-1.2, statuses

## Phase 2: Fluxo de cadastro

**Goal:** Um visitante se cadastra e recebe confirmação · **Depends on:** Phase 1 · **Covers:** workflow 2

- [x] **Task:** Endpoint de cadastro
  - **Acceptance criteria:**
    - POST /signup devolve 201 e persiste exatamente um registro
  - **Traces:** US-2.1, users, workflow 2

## Open Questions

Nenhuma.
`;

export const STORY_IDS = ["US-1.1", "US-1.2", "US-2.1"];
export const ENTITIES = ["users", "statuses"];
export const WORKFLOWS = [
  { number: "1", name: "Cadastro de dados" },
  { number: "2", name: "Cadastro de visitante" },
];
