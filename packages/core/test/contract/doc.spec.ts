import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { INVARIANTS, renderContractDocument } from "../../src/contract/index.js";

const DOC = new URL("../../../../docs/capivara-phases-v1.md", import.meta.url);

describe("documento do contrato", () => {
  it("docs/capivara-phases-v1.md está sincronizado com o módulo", async () => {
    const onDisk = await readFile(DOC, "utf8");
    expect(onDisk).toBe(renderContractDocument());
  });

  it("todo invariante registrado aparece no documento", () => {
    const rendered = renderContractDocument();
    for (const item of INVARIANTS) {
      expect(rendered).toContain(item.code);
      expect(rendered).toContain(item.rationale);
    }
  });

  it("todo invariante declara por que existe", () => {
    for (const item of INVARIANTS) {
      expect(item.rationale.length).toBeGreaterThan(40);
    }
  });
});
