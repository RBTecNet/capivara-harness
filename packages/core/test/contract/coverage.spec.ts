import { describe, expect, it } from "vitest";
import {
  checkCoverage,
  checkEntities,
  checkStories,
  checkWorkflows,
  coverageFromSkeleton,
  parsePhases,
  parseSkeleton,
} from "../../src/contract/index.js";
import type { PhasesDocument } from "../../src/contract/index.js";
import { ENTITIES, STORY_IDS, VALID_PHASES, WORKFLOWS } from "./fixture.js";
import { SKELETON } from "../support/fake-agent.js";

function document(source = VALID_PHASES): PhasesDocument {
  const result = parsePhases(source);
  if (!result.ok) throw new Error(`documento inválido: ${result.errors.map((e) => e.code).join(", ")}`);
  return result.document;
}

describe("as fontes de cobertura saem do esqueleto", () => {
  it("story, entidade e fluxo declarados viram o que a cobertura exige rastrear", () => {
    const lido = parseSkeleton(SKELETON, { maxTasksPerPhase: 15 });
    if (!lido.ok) throw new Error("fixture inválida");
    expect(coverageFromSkeleton(lido.skeleton)).toEqual({
      storyIds: ["US-1.1"],
      entities: ["statuses", "reservations"],
      workflows: [{ number: "1", name: "Criar reserva" }],
    });
  });
});

describe("checkCoverage", () => {
  const sources = { storyIds: STORY_IDS, entities: ENTITIES, workflows: WORKFLOWS };

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
  it("reprova workflow que nenhuma task rastreia", () => {
    const errors = checkWorkflows(document(), [...WORKFLOWS, { number: "3", name: "Relatórios" }]);
    expect(errors.map((error) => error.code)).toEqual(["I-12"]);
    expect(errors[0]?.message).toContain("Relatórios");
  });

  it("não existe exclusão: o que não deve ser construído não entra na descrição", () => {
    // Um mecanismo de exclusão tornaria legítimo o plano contradizer por escrito
    // a descrição que o gerou.
    const errors = checkWorkflows(document(), [...WORKFLOWS, { number: "3", name: "Relatórios" }]);
    expect(errors[0]?.hint).toContain("não deveria estar na descrição do projeto");
  });

  it("workflow 1 não é satisfeito por workflow 10", () => {
    const source = VALID_PHASES.replace("US-1.1, users, workflow 1", "US-1.1, users, workflow 10");
    expect(checkWorkflows(document(source), [{ number: "1", name: "Cadastro" }])).toHaveLength(1);
  });
});
