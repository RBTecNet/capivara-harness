import { describe, expect, it } from "vitest";
import { openRouterOutputEnvironment } from "../../src/provider/cli/opencode-limits.js";

const model = "openrouter/moonshotai/kimi-k3";
const limits = { context: 1048576, input: 900000, output: 943718 };
const output = (env: NodeJS.ProcessEnv) => JSON.parse(env.OPENCODE_CONFIG_CONTENT!).provider.openrouter.models["moonshotai/kimi-k3"];

describe("teto de saída OpenRouter no OpenCode 2", () => {
  it("limita saída por resposta preservando janela e opções do usuário", () => {
    const config = { permission: { edit: "deny" }, provider: { openrouter: { options: { baseURL: "http://localhost" }, models: { "moonshotai/kimi-k3": { options: { custom: true }, limit: limits }, outro: { name: "outro" } } }, deepseek: { name: "intacto" } } };
    const env = { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
    const result = openRouterOutputEnvironment(model, env, limits);
    expect(output(result)).toMatchObject({ options: { custom: true }, limit: { ...limits, output: 16384 } });
    const saved = JSON.parse(result.OPENCODE_CONFIG_CONTENT!);
    expect(saved.provider.openrouter.options).toEqual(config.provider.openrouter.options);
    expect(saved.provider.openrouter.models.outro).toEqual({ name: "outro" });
    expect(saved.provider.deepseek).toEqual(config.provider.deepseek);
    expect(saved.permission).toEqual(config.permission);
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toEqual(config);
  });

  it("usa teto explícito sem aumentar limite nativo menor", () => {
    expect(output(openRouterOutputEnvironment(model, { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "8192" }, limits)).limit.output).toBe(8192);
    expect(output(openRouterOutputEnvironment(model, { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: "65536" }, { ...limits, output: 4096 })).limit.output).toBe(4096);
  });

  it.each(["0", "-1", "1.5", "abc", "9007199254740992"])("recusa teto inválido %s antes de inferência", cap => {
    expect(() => openRouterOutputEnvironment(model, { OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: cap }, limits)).toThrow("inteiro positivo seguro");
  });

  it("não modifica outro provider nem exige limite dele", () => {
    const env = { OPENCODE_CONFIG_CONTENT: "não é JSON" };
    expect(openRouterOutputEnvironment("deepseek/deepseek-flash", env, null)).toBe(env);
  });

  it("não envia inferência se não puder preservar contexto ou configuração", () => {
    expect(() => openRouterOutputEnvironment(model, {}, null)).toThrow("limites");
    expect(() => openRouterOutputEnvironment(model, { OPENCODE_CONFIG_CONTENT: "inválido" }, limits)).toThrow("OPENCODE_CONFIG_CONTENT");
  });
});
