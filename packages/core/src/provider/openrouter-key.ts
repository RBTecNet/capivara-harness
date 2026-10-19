/** Consulta de credencial sem inferência; não devolve metadados pessoais da conta. */
export interface OpenRouterKeyCheck {
  status: "valid" | "invalid" | "unavailable";
  reason: string;
}

export async function checkOpenRouterKey(secret: string): Promise<OpenRouterKeyCheck> {
  const unavailable = (detail: string): OpenRouterKeyCheck => ({ status: "unavailable", reason: `OpenRouter: ${detail}. A chave existente foi preservada.` });
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid", reason: `OpenRouter: a verificação da chave foi recusada (HTTP ${response.status}). Cadastre uma chave de API para geração em https://openrouter.ai/settings/keys.` };
    }
    if (!response.ok) return unavailable(`não foi possível verificar a chave (HTTP ${response.status})`);
    const body = await response.json() as { data?: { is_management_key?: unknown; is_provisioning_key?: unknown; expires_at?: unknown } };
    const data = body?.data;
    if (!data || (typeof data.is_management_key !== "boolean" && typeof data.is_provisioning_key !== "boolean")) return unavailable("a verificação respondeu sem metadados reconhecíveis");
    if (data.is_management_key === true || data.is_provisioning_key === true) {
      return { status: "invalid", reason: "OpenRouter: chave de gerenciamento/provisionamento não pode gerar respostas.\nCrie uma chave de API para geração:\nhttps://openrouter.ai/settings/keys\nDepois, escolha digitar outra chave." };
    }
    if (typeof data.expires_at === "string" && Date.parse(data.expires_at) <= Date.now()) return { status: "invalid", reason: "OpenRouter: esta chave expirou. Substitua-a por uma chave de API para geração." };
    return { status: "valid", reason: "" };
  } catch {
    return unavailable("não foi possível verificar a chave; confira a conexão e tente novamente");
  }
}
