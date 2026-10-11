/** O endpoint atual e sua credencial, vindos das flags, ambiente ou configuração global. */
import { findMcpConnection, getDefaultMcpConnection, globalConfigPath, readGlobalConfig } from "../config/global.js";
import type { McpEndpoint } from "./client.js";

function preenchido(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Uma variável global não ativa a base quando o comando pede texto local. */
export function configuredMcpUrl(explicit?: string, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  return preenchido(explicit) ?? preenchido(environment.CAPIVARA_MCP_URL) ?? preenchido(environment.DOC_CENTER_URL)
    ?? getDefaultMcpConnection(readGlobalConfig(globalConfigPath(environment)))?.url;
}

function validarUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("o endpoint MCP deve ser uma URL HTTP ou HTTPS válida"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.includes("?") || url.href.includes("#")) {
    throw new Error("o endpoint MCP deve usar HTTP ou HTTPS, sem credenciais, query ou fragmento na URL");
  }
  return url;
}

/**
 * Tokens do ambiente mantêm sua associação; um token salvo só acompanha a URL
 * exata da conexão. Indicar outra base não encaminha a credencial do padrão.
 */
export function resolveMcpEndpoint(explicit?: string, environment: NodeJS.ProcessEnv = process.env): McpEndpoint | null {
  const configured = configuredMcpUrl(explicit, environment);
  if (!configured) return null;
  const url = validarUrl(configured);
  const capivaraToken = preenchido(environment.CAPIVARA_MCP_TOKEN);
  const docCenterToken = preenchido(environment.DOC_CENTER_TOKEN);
  const environmentToken = capivaraToken ?? docCenterToken;
  const token = environmentToken ?? findMcpConnection(readGlobalConfig(globalConfigPath(environment)), url.href)?.token;
  if (!token) return { url: url.href };

  const associated = preenchido(capivaraToken ? environment.CAPIVARA_MCP_URL : docCenterToken ? environment.DOC_CENTER_URL : undefined);
  if (associated && validarUrl(associated).href !== url.href) {
    throw new Error("o token MCP configurado pertence a outro endpoint; ajuste a URL e o token do mesmo ambiente");
  }
  if (!/^[!-~]+$/.test(token)) throw new Error("o token MCP contém caracteres inválidos");
  return { url: url.href, headers: { authorization: `Bearer ${token}` } };
}

export interface McpProjectFlags {
  mcp?: string;
  mcpProject?: string;
}

/**
 * O build herda o slug, mas a URL atual do ambiente ou configuração global substitui a antiga.
 * Flags explícitas continuam vencendo; um init literal não ganha MCP sozinho.
 */
export function resolveMcpProject(
  flags: McpProjectFlags,
  inherited: { url: string; projeto: string } | null = null,
  environment: NodeJS.ProcessEnv = process.env,
): McpProjectFlags {
  const explicitUrl = preenchido(flags.mcp);
  const explicitProject = preenchido(flags.mcpProject);
  if (!explicitUrl && !explicitProject && !inherited) return {};
  const mcp = configuredMcpUrl(explicitUrl, environment) ?? preenchido(inherited?.url);
  const mcpProject = explicitProject ?? preenchido(inherited?.projeto);
  return { ...(mcp ? { mcp } : {}), ...(mcpProject ? { mcpProject } : {}) };
}
