import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli-program.js";
import { describeRoles, rolesFromFlags } from "../../src/commands/options.js";

function commandNames(): string[] {
  return createProgram().commands.map((command) => command.name());
}

describe("cli", () => {
  it("expõe init, build, providers e wizard", () => {
    expect(commandNames()).toEqual(expect.arrayContaining(["init", "build", "providers", "wizard"]));
  });

  it("init aceita o pedido como argumento e por arquivo", () => {
    const init = createProgram().commands.find((command) => command.name() === "init");
    const flags = init?.options.map((option) => option.long) ?? [];
    expect(flags).toContain("--file");
    expect(flags).toContain("--max-audit-returns");
  });

  it("init oferece flags dos quatro papéis", () => {
    const init = createProgram().commands.find((command) => command.name() === "init");
    const flags = init?.options.map((option) => option.long) ?? [];
    for (const role of ["writer", "auditor", "builder", "verifier"]) {
      expect(flags, role).toContain(`--${role}-provider`);
      expect(flags, role).toContain(`--${role}-model`);
    }
  });

  it("build oferece comando de teste, ciclos e keep-going", () => {
    const build = createProgram().commands.find((command) => command.name() === "build");
    const flags = build?.options.map((option) => option.long) ?? [];
    expect(flags).toContain("--test-cmd");
    expect(flags).toContain("--max-cycles");
    expect(flags).toContain("--keep-going");
  });

  it("toda descrição está no idioma do produto", () => {
    for (const command of createProgram().commands) {
      expect(command.description().length, command.name()).toBeGreaterThan(10);
    }
  });
});

describe("flags → papéis", () => {
  it("o fallback global alcança os quatro papéis", () => {
    const roles = rolesFromFlags({ provider: "codex", model: "gpt-5" });
    expect(describeRoles(roles).every((role) => role.provider === "codex")).toBe(true);
  });

  it("a flag do papel vence o global", () => {
    const roles = rolesFromFlags({ provider: "codex", auditorProvider: "anthropic", auditorModel: "claude-haiku-4-5-20251001" });
    expect(roles.auditor.provider).toBe("anthropic");
    expect(roles.writer.provider).toBe("codex");
  });

  it("sem flags, nada é inventado", () => {
    const roles = rolesFromFlags({});
    expect(roles.builder.provider).toBe("");
  });
});
