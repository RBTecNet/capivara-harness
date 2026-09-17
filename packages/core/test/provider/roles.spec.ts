import { describe, expect, it } from "vitest";
import { ROLES, ROLE_NAMES, resolveRoles } from "../../src/provider/index.js";

describe("papéis", () => {
  it("são exatamente quatro", () => {
    expect(ROLE_NAMES).toEqual(["writer", "auditor", "builder", "verifier"]);
  });

  it("só o executor escreve e só ele tem rede", () => {
    const escrevem = ROLE_NAMES.filter((role) => ROLES[role].permission === "workspace-write");
    const comRede = ROLE_NAMES.filter((role) => ROLES[role].network);
    expect(escrevem).toEqual(["builder"]);
    expect(comRede).toEqual(["builder"]);
  });

  it("só o executor exige CLI", () => {
    expect(ROLE_NAMES.filter((role) => ROLES[role].requiresCli)).toEqual(["builder"]);
  });
});

describe("resolveRoles", () => {
  it("aplica o fallback global a quem não tem configuração própria", () => {
    const resolved = resolveRoles({ global: { provider: "codex", model: "gpt-5", effort: "medium" }, roles: {} });
    for (const role of ROLE_NAMES) {
      expect(resolved[role].provider).toBe("codex");
      expect(resolved[role].model).toBe("gpt-5");
    }
  });

  it("a configuração do papel vence o fallback", () => {
    const resolved = resolveRoles({
      global: { provider: "codex", model: "gpt-5" },
      roles: { auditor: { provider: "anthropic", model: "claude-haiku-4-5-20251001" } },
    });
    expect(resolved.auditor.provider).toBe("anthropic");
    expect(resolved.writer.provider).toBe("codex");
  });

  it("sem nada configurado devolve campos vazios em vez de inventar default", () => {
    const resolved = resolveRoles({ global: {}, roles: {} });
    expect(resolved.builder).toEqual({ provider: "", model: "", effort: "", credential: "", command: "" });
  });
});
