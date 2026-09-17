import { describe, expect, it } from "vitest";
import { VERSION, createProgram } from "../src/index.js";
import { BUILD_ROLES, INIT_ROLES, renderUnresolved, rolesFromFlags, unresolvedRoles } from "../src/commands/options.js";

describe("cli", () => {
  it("expõe o nome do binário", () => {
    expect(createProgram().name()).toBe("capivara");
  });

  it("carrega uma versão", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("provider por papel", () => {
  it("sem flag nenhuma, nenhum papel do comando está resolvido", () => {
    const roles = rolesFromFlags({});
    expect(unresolvedRoles(roles, INIT_ROLES)).toEqual(["writer", "auditor", "verifier"]);
    expect(unresolvedRoles(roles, BUILD_ROLES)).toEqual(["builder", "verifier"]);
  });

  it("--provider resolve todos os papéis de uma vez", () => {
    const roles = rolesFromFlags({ provider: "codex" });
    expect(unresolvedRoles(roles, INIT_ROLES)).toEqual([]);
    expect(unresolvedRoles(roles, BUILD_ROLES)).toEqual([]);
  });

  it("o init não exige executor, e o build não exige escritor", () => {
    expect(unresolvedRoles(rolesFromFlags({ builderProvider: "codex" }), BUILD_ROLES)).toEqual(["verifier"]);
    expect(unresolvedRoles(rolesFromFlags({ provider: "codex" }), INIT_ROLES)).toEqual([]);
    expect((INIT_ROLES as readonly string[]).includes("builder")).toBe(false);
    expect((BUILD_ROLES as readonly string[]).includes("writer")).toBe(false);
  });

  it("a mensagem nomeia os papéis e as duas formas de resolver", () => {
    const message = renderUnresolved("init", ["writer", "auditor"]);
    expect(message).toContain("writer, auditor");
    expect(message).toContain("--provider codex");
    expect(message).toContain("--writer-provider codex --auditor-provider codex");
    expect(message).toContain("doctor");
  });
});
