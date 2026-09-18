import { describe, expect, it } from "vitest";
import { buildStamp, checkStamp, parsePhases, sha12 } from "../../src/contract/index.js";
import type { PhasesDocument } from "../../src/contract/index.js";
import { VALID_PHASES } from "./fixture.js";

function documentWith(stamp: string): PhasesDocument {
  const source = VALID_PHASES.replace(/^<!-- inputs:.*-->$/m, stamp);
  const result = parsePhases(source);
  if (!result.ok) throw new Error(`documento inválido: ${result.errors.map((e) => e.code).join(", ")}`);
  return result.document;
}

const INPUTS = [
  { name: "project-description.md", content: "descrição" },
  { name: "user-stories.md", content: "stories" },
  { name: "database-schema.md", content: "schema" },
];

describe("sha12", () => {
  it("devolve 12 caracteres hexadecimais minúsculos", () => {
    expect(sha12("qualquer coisa")).toMatch(/^[0-9a-f]{12}$/);
  });

  it("é estável para o mesmo conteúdo e muda com um byte diferente", () => {
    expect(sha12("a")).toBe(sha12("a"));
    expect(sha12("a")).not.toBe(sha12("b"));
  });
});

describe("checkStamp — I-02", () => {
  it("aceita um stamp fresco", () => {
    expect(checkStamp(documentWith(buildStamp(INPUTS)), INPUTS)).toEqual([]);
  });

  it("detecta upstream alterado depois da geração e nomeia o arquivo", () => {
    const document = documentWith(buildStamp(INPUTS));
    const alterados = INPUTS.map((input) =>
      input.name === "user-stories.md" ? { ...input, content: "stories editadas" } : input,
    );
    const errors = checkStamp(document, alterados);
    expect(errors.map((error) => error.code)).toEqual(["I-02"]);
    expect(errors[0]?.message).toContain("user-stories.md");
    expect(errors[0]?.hint).toContain("atualize o stamp");
  });

  it("detecta input ausente no stamp", () => {
    const parcial = buildStamp(INPUTS.slice(0, 2));
    const errors = checkStamp(documentWith(parcial), INPUTS);
    expect(errors[0]?.message).toContain("não cita database-schema.md");
  });

  it("detecta input a mais no stamp", () => {
    const extra = buildStamp([...INPUTS, { name: "glossario.md", content: "x" }]);
    const errors = checkStamp(documentWith(extra), INPUTS);
    expect(errors.some((error) => error.message.includes("glossario.md"))).toBe(true);
  });

  it("não reclama quando o documento não tem stamp — I-02 estrutural já reprovou", () => {
    const result = parsePhases(VALID_PHASES.replace(/^<!-- inputs:.*-->$/m, ""));
    expect(result.ok).toBe(false);
  });
});

describe("um validador do contrato nunca lança", () => {
  it("input sem conteúdo vira erro reportado, não exceção", () => {
    const documento = parsePhases(
      ["# X — Project Phases", "", "<!-- inputs: a.md@sha256:000000000000 -->", "", "## Phase 1: F", "", "**Goal:** g · **Depends on:** none · **Covers:** US-1.1", "", "- [ ] **Task:** T", "  - **Acceptance criteria:**", "    - c", "  - **Feature tests:** t → t", "  - **Traces:** US-1.1", ""].join("\n"),
    );
    if (!documento.ok) throw new Error("fixture inválida");

    const malformado = [{ name: "a.md" }] as unknown as Parameters<typeof checkStamp>[1];
    expect(() => checkStamp(documento.document, malformado)).not.toThrow();
    expect(checkStamp(documento.document, malformado)[0]?.message).toContain("sem conteúdo");
  });
});
