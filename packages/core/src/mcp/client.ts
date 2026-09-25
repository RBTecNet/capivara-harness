/**
 * O harness como CLIENTE de MCP.
 *
 * A tentação era só repassar o servidor às CLIs e deixar o modelo buscar o que
 * precisasse. Isso transformaria o insumo do run numa aposta: o pedido do
 * projeto chegaria se — e quando — o modelo resolvesse chamar a ferramenta
 * certa. O §24 já custou caro para ensinar que o que decide o run não fica na
 * mão de quem é barato; aqui é a mesma regra, aplicada ao insumo em vez do
 * veredito. O harness busca o que ele mesmo consome, e o resultado é um texto
 * com sha, rastreável como qualquer arquivo lido do disco.
 *
 * O protocolo é JSON-RPC 2.0 sobre HTTP, e o subconjunto que nos serve —
 * `initialize`, `prompts/get`, `resources/list`, `resources/read`,
 * `tools/call` — cabe aqui inteiro, sem dependência nova. O harness tem uma só
 * até hoje, e é parte do que o torna auditável.
 */

import { VERSION } from "../version.js";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpEndpoint {
  /** A URL do endpoint MCP, como `http://localhost:7777/mcp`. */
  url: string;
  /** Cabeçalhos extras — um token, quando a aplicação passar a exigir um. */
  headers?: Record<string, string>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Um documento lido: o texto e de onde veio, para o stamp poder citá-lo. */
export interface McpDocument {
  uri: string;
  name: string;
  text: string;
  /**
   * O tipo declarado pela base — `skill`, `memoria`, `hook`, `documentacao`.
   * Vazio quando a base não diz; o harness então trata como documento comum.
   */
  kind?: string;
  /** A área, quando declarada. É ela que decide em que fase a skill entra. */
  area?: string;
  /** Os arquivos que acompanham a base, quando o documento é um pacote. */
  files?: McpFile[];
}

/** Um arquivo de dentro de um pacote, pronto para ser materializado. */
export interface McpFile {
  /** Caminho relativo à raiz do pacote: `references/typography.md`. */
  path: string;
  /** Texto, ou os bytes quando o arquivo é binário. */
  content: Buffer;
  binary: boolean;
}

export class McpError extends Error {
  readonly code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

interface RpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpClientOptions {
  /** Teto por chamada. Um servidor mudo não pode segurar um run inteiro. */
  timeoutSeconds?: number;
  /** Injetável nos testes; por padrão, o `fetch` do runtime. */
  fetchImpl?: typeof fetch;
}

/**
 * O corpo de uma resposta, seja ela JSON direto ou um fluxo de eventos.
 *
 * O transporte deixa o servidor escolher: `application/json` devolve o objeto, e
 * `text/event-stream` devolve o mesmo objeto dentro de um evento SSE. Aceitar só
 * o primeiro funcionaria contra metade dos servidores — e falharia com uma
 * mensagem sobre JSON inválido, que manda quem lê procurar no lugar errado.
 */
function lerEnvelope(corpo: string, tipo: string): RpcResponse {
  if (!tipo.includes("text/event-stream")) {
    try {
      return JSON.parse(corpo) as RpcResponse;
    } catch {
      throw new McpError(`o servidor MCP respondeu algo que não é JSON: ${corpo.slice(0, 200)}`);
    }
  }

  // SSE: interessa a última linha `data:` que contenha uma resposta JSON-RPC.
  let ultima: RpcResponse | null = null;
  for (const linha of corpo.split("\n")) {
    const texto = linha.trim();
    if (!texto.startsWith("data:")) continue;
    const dado = texto.slice(5).trim();
    if (dado === "" || dado === "[DONE]") continue;
    try {
      const objeto = JSON.parse(dado) as RpcResponse;
      if (objeto.jsonrpc === "2.0") ultima = objeto;
    } catch {
      /* evento que não é JSON-RPC não interrompe a leitura */
    }
  }
  if (!ultima) throw new McpError("o fluxo de eventos do servidor MCP não trouxe nenhuma resposta");
  return ultima;
}

/** Só o texto: uma imagem ou um blob não viram pedido nem memória. */
function textoDoConteudo(item: Record<string, unknown>): string {
  if (typeof item.text === "string") return item.text;
  return "";
}

/** Um prompt oferecido pelo servidor. O `title` é o nome que a gente lê. */
export interface McpPrompt {
  name: string;
  title: string;
  description: string;
}

export interface McpClient {
  readonly server: { name: string; version: string; protocolVersion: string } | null;
  initialize: () => Promise<void>;
  listPrompts: () => Promise<McpPrompt[]>;
  prompt: (name: string, args?: Record<string, string>) => Promise<string>;
  listResources: () => Promise<McpResource[]>;
  readResource: (uri: string) => Promise<string>;
  readBinary: (uri: string) => Promise<{ content: Buffer; binary: boolean }>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<string>;
}

export function createMcpClient(endpoint: McpEndpoint, options: McpClientOptions = {}): McpClient {
  const janela = (options.timeoutSeconds ?? 30) * 1000;
  const chamar = options.fetchImpl ?? fetch;
  let sessao: string | null = null;
  let servidor: McpClient["server"] = null;
  let proximo = 0;

  async function enviar(method: string, params?: Record<string, unknown>, notificacao = false): Promise<unknown> {
    const id = notificacao ? undefined : (proximo += 1);
    const corpo = JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, ...(params ? { params } : {}) });

    const cabecalhos: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessao ? { "mcp-session-id": sessao } : {}),
      // Depois do aperto de mão, a versão vai em toda chamada: é assim que o
      // servidor sabe conversar com um cliente mais velho que ele.
      ...(servidor ? { "mcp-protocol-version": servidor.protocolVersion } : {}),
      ...(endpoint.headers ?? {}),
    };

    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), janela);
    let resposta: Response;
    try {
      resposta = await chamar(endpoint.url, { method: "POST", headers: cabecalhos, body: corpo, signal: controle.signal });
    } catch (erro) {
      const causa = erro instanceof Error && erro.name === "AbortError" ? `sem resposta em ${janela / 1000}s` : String(erro);
      throw new McpError(`não consegui falar com o servidor MCP em ${endpoint.url}: ${causa}`);
    } finally {
      clearTimeout(relogio);
    }

    const novaSessao = resposta.headers.get("mcp-session-id");
    if (novaSessao) sessao = novaSessao;

    // Notificação não tem resposta: 202 sem corpo é o caso normal.
    if (notificacao) return null;

    const texto = await resposta.text();
    if (!resposta.ok) {
      throw new McpError(`o servidor MCP respondeu ${resposta.status} em ${method}: ${texto.slice(0, 200)}`, resposta.status);
    }

    const envelope = lerEnvelope(texto, resposta.headers.get("content-type") ?? "");
    if (envelope.error) {
      throw new McpError(`o servidor MCP recusou ${method}: ${envelope.error.message}`, envelope.error.code);
    }
    return envelope.result ?? null;
  }

  return {
    get server() {
      return servidor;
    },

    initialize: async () => {
      const resultado = (await enviar("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        // A versão vem de onde ela é decidida. Escrita à mão aqui, ela ficou em
        // 0.2.0 enquanto o resto do harness andou — e quem lê o log do servidor
        // não tem como saber que a fonte era outra.
        clientInfo: { name: "capivara", version: VERSION },
      })) as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | null;

      servidor = {
        name: resultado?.serverInfo?.name ?? "desconhecido",
        version: resultado?.serverInfo?.version ?? "?",
        protocolVersion: resultado?.protocolVersion ?? MCP_PROTOCOL_VERSION,
      };
      await enviar("notifications/initialized", undefined, true);
    },

    /**
     * Um prompt do servidor, achatado em texto.
     *
     * O protocolo devolve mensagens com papel; para nós é um pedido de projeto,
     * que vira texto e ganha um sha. Papel de sistema e de usuário entram na
     * ordem em que vieram — quem escreveu o prompt decidiu essa ordem.
     */
    /*
     * Os prompts guardados no servidor.
     *
     * `name` é o endereço e `title` é o nome — e é o nome que vai à tela. Um
     * servidor que não implementa prompts devolve erro, e aqui isso vira lista
     * vazia: não ter prompt guardado não é falha de ninguém.
     */
    listPrompts: async () => {
      const resultado = (await enviar("prompts/list").catch(() => null)) as {
        prompts?: { name?: string; title?: string; description?: string }[];
      } | null;

      return (resultado?.prompts ?? [])
        .map((item) => ({
          name: String(item.name ?? "").trim(),
          title: String(item.title ?? item.name ?? "").trim(),
          description: String(item.description ?? "").trim(),
        }))
        .filter((item) => item.name !== "");
    },

    prompt: async (name, args) => {
      const resultado = (await enviar("prompts/get", { name, ...(args ? { arguments: args } : {}) })) as {
        messages?: { role?: string; content?: Record<string, unknown> | Record<string, unknown>[] }[];
      } | null;

      const partes: string[] = [];
      for (const mensagem of resultado?.messages ?? []) {
        const conteudo = mensagem.content;
        for (const item of Array.isArray(conteudo) ? conteudo : [conteudo ?? {}]) {
          const texto = textoDoConteudo(item);
          if (texto.trim() !== "") partes.push(texto);
        }
      }
      return partes.join("\n\n").trim();
    },

    listResources: async () => {
      const resultado = (await enviar("resources/list")) as { resources?: McpResource[] } | null;
      return (resultado?.resources ?? []).filter((recurso) => typeof recurso?.uri === "string");
    },

    readResource: async (uri) => {
      const resultado = (await enviar("resources/read", { uri })) as { contents?: Record<string, unknown>[] } | null;
      return (resultado?.contents ?? [])
        .map((item) => textoDoConteudo(item))
        .filter((texto) => texto.trim() !== "")
        .join("\n\n")
        .trim();
    },

    /**
     * O mesmo recurso, preservando o que for binário.
     *
     * `readResource` devolve texto e serve para pedido e memória. Um print de
     * interface não passa por ali: o protocolo o entrega em `blob`, base64, e
     * convertê-lo para texto destruiria justamente o arquivo que alguém guardou
     * para servir de referência de layout.
     */
    readBinary: async (uri) => {
      const resultado = (await enviar("resources/read", { uri })) as { contents?: Record<string, unknown>[] } | null;
      for (const item of resultado?.contents ?? []) {
        if (typeof item.blob === "string") return { content: Buffer.from(item.blob, "base64"), binary: true };
        if (typeof item.text === "string") return { content: Buffer.from(item.text, "utf8"), binary: false };
      }
      return { content: Buffer.alloc(0), binary: false };
    },

    callTool: async (name, args) => {
      const resultado = (await enviar("tools/call", { name, arguments: args ?? {} })) as {
        content?: Record<string, unknown>[];
        isError?: boolean;
      } | null;

      const texto = (resultado?.content ?? [])
        .map((item) => textoDoConteudo(item))
        .filter((parte) => parte.trim() !== "")
        .join("\n\n")
        .trim();

      // A ferramenta que falha responde 200 com `isError`: sem esta leitura, o
      // erro viraria conteúdo e seguiria run adentro como se fosse resposta.
      if (resultado?.isError === true) throw new McpError(`a ferramenta ${name} falhou: ${texto || "sem detalhe"}`);
      return texto;
    },
  };
}
