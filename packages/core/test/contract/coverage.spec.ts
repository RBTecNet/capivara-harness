import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  checkEntities,
  checkStories,
  checkWorkflows,
  extractEntities,
  extractStoryIds,
  extractWorkflows,
  parsePhases,
} from "../../src/contract/index.js";
import type { PhasesDocument } from "../../src/contract/index.js";
import { ENTITIES, STORY_IDS, VALID_PHASES, WORKFLOWS } from "./fixture.js";

function document(source = VALID_PHASES): PhasesDocument {
  const result = parsePhases(source);
  if (!result.ok) throw new Error(`documento inválido: ${result.errors.map((e) => e.code).join(", ")}`);
  return result.document;
}

describe("extratores", () => {
  it("lê os IDs do apêndice de user-stories", () => {
    const source = [
      "## Appendix: User Story Status",
      "",
      "| ID | Story | Priority | Status |",
      "|----|-------|----------|--------|",
      "| US-1.1 | Cadastro | High | Pending |",
      "| US-1.10 | Exportação | Low | Pending |",
    ].join("\n");
    expect(extractStoryIds(source)).toEqual(["US-1.1", "US-1.10"]);
  });

  it("lê as tabelas DBML do modelo de dados", () => {
    const source = "Table users {\n  id bigint\n}\n\nTable statuses {\n  id bigint\n}";
    expect(extractEntities(source)).toEqual(["users", "statuses"]);
  });

  it("devolve zero entidades quando o projeto não tem persistência", () => {
    expect(extractEntities("## Schema\n\nO estado vive em memória durante a execução.")).toEqual([]);
  });

  it("lê os workflows numerados do project-description", () => {
    const source = "## Core Workflows\n\n### 1. Cadastro\n\ntexto\n\n### 2. Exportação\n";
    expect(extractWorkflows(source)).toEqual([
      { number: "1", name: "Cadastro" },
      { number: "2", name: "Exportação" },
    ]);
  });
});

describe("checkCoverage", () => {
  const sources = { storyIds: STORY_IDS, entities: ENTITIES, workflows: WORKFLOWS, excludedWorkflows: [] };

  it("aceita o documento de referência", () => {
    expect(checkCoverage(document(), sources)).toEqual([]);
  });
});

describe("I-10 — cobertura de stories", () => {
  it("reprova story que nenhuma task cita", () => {
    const errors = checkStories(document(), [...STORY_IDS, "US-9.9"]);
    expect(errors.map((error) => error.code)).toEqual(["I-10"]);
    expect(errors[0]?.message).toContain("US-9.9");
  });

  it("US-1.10 não é satisfeita por US-1.1 — o guarda de dígito", () => {
    const errors = checkStories(document(), ["US-1.10"]);
    expect(errors).toHaveLength(1);
  });

  it("orienta a adicionar a task, nunca a apagar a story", () => {
    const errors = checkStories(document(), ["US-9.9"]);
    expect(errors[0]?.hint).toContain("nunca remova a story");
  });
});

describe("I-11 — cobertura de entidades", () => {
  it("reprova entidade que não aparece em nenhuma task", () => {
    const errors = checkEntities(document(), [...ENTITIES, "invoices"]);
    expect(errors.map((error) => error.code)).toEqual(["I-11"]);
    expect(errors[0]?.message).toContain("invoices");
  });

  it("passa vazia quando o modelo de dados não declara entidades", () => {
    expect(checkEntities(document(), [])).toEqual([]);
  });

  it("não aceita casamento parcial de nome", () => {
    expect(checkEntities(document(), ["user"])).toHaveLength(1);
  });
});

describe("I-12 — cobertura de workflows", () => {
  it("reprova workflow que não é coberto nem excluído", () => {
    const errors = checkWorkflows(document(), [...WORKFLOWS, { number: "3", name: "Relatórios" }], []);
    expect(errors.map((error) => error.code)).toEqual(["I-12"]);
    expect(errors[0]?.message).toContain("Relatórios");
  });

  it("aceita workflow explicitamente excluído", () => {
    const workflows = [...WORKFLOWS, { number: "3", name: "Relatórios" }];
    expect(checkWorkflows(document(), workflows, ["3"])).toEqual([]);
  });

  it("workflow 1 não é satisfeito por workflow 10", () => {
    const source = VALID_PHASES.replace("US-1.1, users, workflow 1", "US-1.1, users, workflow 10");
    expect(checkWorkflows(document(source), [{ number: "1", name: "Cadastro" }], [])).toHaveLength(1);
  });
});
