import { describe, expect, it } from "vitest";
import {
  CLI_CATALOG,
  DIRECT_CATALOG,
  decideReasoning,
  directProvider,
  isCliProvider,
  isDirectProvider,
} from "../../src/provider/index.js";
import { listProviders } from "../../src/commands/providers.js";

describe("catálogo", () => {
  /*
   * Contado da lista, não fixado num número: acrescentar uma CLI é escrever um
   * adaptador e citá-lo, e esse trabalho não deve incluir caçar o teste que
   * guardava o total antigo.
   */
  it("a listagem cobre todo provider de CLI e de API direta, sem faltar nem repetir", async () => {
    const listagem = await listProviders("/caminho/que/nao/existe.json");
    expect(listagem).toHaveLength(CLI_CATALOG.length + DIRECT_CATALOG.length);

    const ids = listagem.map((provider) => provider.id).sort();
    expect(new Set(ids).size, "id repetido entre providers").toBe(ids.length);
    for (const esperado of [...CLI_CATALOG, ...DIRECT_CATALOG]) {
      expect(ids, `${esperado.id} sumiu da listagem`).toContain(esperado.id);
    }
  });

  it("o antigravity está no catálogo de CLI", () => {
    expect(CLI_CATALOG.map((cli) => cli.id)).toContain("agy");
  });

  it("a listagem informa o estado de configuração de cada um", async () => {
    const listagem = await listProviders("/caminho/que/nao/existe.json");
    expect(listagem.find((p) => p.id === "codex")?.configuration).toBe("login-externo");
    expect(listagem.find((p) => p.id === "custom")?.configuration).toBe("por-comando");
    expect(listagem.find((p) => p.id === "deepseek")?.configuration).toBe("sem-credencial");
  });

  it("API direta não é oferecida para o papel de executor", async () => {
    const listagem = await listProviders("/caminho/que/nao/existe.json");
    for (const provider of listagem.filter((entry) => entry.kind === "direct-api")) {
      expect(provider.roles).not.toContain("builder");
    }
  });

  it("classifica os ids", () => {
    expect(isCliProvider("codex")).toBe(true);
    expect(isDirectProvider("deepseek")).toBe(true);
    expect(isCliProvider("deepseek")).toBe(false);
  });
});

describe("decideReasoning", () => {
  it("sem --effort, raciocínio DESLIGADO — nunca herda o default do provider", () => {
    for (const provider of DIRECT_CATALOG) {
      const decision = decideReasoning(provider, "");
      expect(decision.enabled, `${provider.id} ligou raciocínio sem effort`).toBe(false);
      expect(decision.effort).toBeNull();
    }
  });

  it("um effort explícito liga o raciocínio na intensidade pedida", () => {
    expect(decideReasoning(directProvider("openai"), "high")).toMatchObject({ enabled: true, effort: "high" });
  });

  it("none, off e disabled desligam explicitamente", () => {
    for (const token of ["none", "off", "disabled"]) {
      expect(decideReasoning(directProvider("openai"), token).enabled).toBe(false);
    }
  });

  it("a decisão traz uma frase honesta para o log", () => {
    expect(decideReasoning(directProvider("anthropic"), "").description).toContain("desligado");
  });
});
