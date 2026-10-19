import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOpenRouterKey } from "../../src/provider/openrouter-key.js";

afterEach(() => vi.restoreAllMocks());
const key = "sk-openrouter-apenas-de-teste";

describe("credencial OpenRouter para geração", () => {
  it("verifica o endpoint privado com header e não devolve dados da conta", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { is_management_key: false, is_provisioning_key: false, label: key, creator_user_id: "privado" } })));
    expect(await checkOpenRouterKey(key)).toEqual({ status: "valid", reason: "" });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://openrouter.ai/api/v1/key", expect.objectContaining({ headers: { Authorization: `Bearer ${key}` }, redirect: "error", cache: "no-store" }));
  });

  it.each(["is_management_key", "is_provisioning_key"])("%s=true não pode gerar mesmo com HTTP 200", async (flag) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { [flag]: true } })));
    const result = await checkOpenRouterKey(key);
    expect(result.status).toBe("invalid");
    expect(result.reason).toContain("gerenciamento/provisionamento");
    expect(result.reason).toContain("https://openrouter.ai/settings/keys");
    expect(result.reason).not.toContain(key);
  });

  it("chave expirada não passa como apta para geração", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"data":{"is_management_key":false,"expires_at":"2000-01-01T00:00:00Z"}}'));
    expect(await checkOpenRouterKey(key)).toMatchObject({ status: "invalid", reason: expect.stringContaining("expirou") });
  });

  it.each([401, 403])("HTTP %s é recusa da credencial sem expor corpo", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(key, { status }));
    const result = await checkOpenRouterKey(key);
    expect(result.status).toBe("invalid");
    expect(result.reason).toContain(`HTTP ${status}`);
    expect(result.reason).not.toContain(key);
  });

  it.each([429, 500])("HTTP %s não condena nem substitui a chave", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(key, { status }));
    expect(await checkOpenRouterKey(key)).toMatchObject({ status: "unavailable", reason: expect.stringContaining("preservada") });
  });

  it.each(["HTML", '{"data":{}}', '{"data":[]}'])("metadados inválidos não atestam a chave: %s", async (body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    expect((await checkOpenRouterKey(key)).status).toBe("unavailable");
  });

  it("falha de rede não vaza mensagem da exceção nem exige outra chave", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(key));
    const result = await checkOpenRouterKey(key);
    expect(result.status).toBe("unavailable");
    expect(result.reason).not.toContain(key);
  });
});
