import { describe, expect, it } from "vitest";
import { fetchProjectMaterial, listLibraryProjects, type McpClient, type McpResource } from "../../src/mcp/index.js";

function base(resources: McpResource[], read: string[]): McpClient {
  return {
    server: null,
    initialize: async () => {},
    listPrompts: async () => [],
    prompt: async () => "",
    listResources: async () => resources,
    readResource: async (uri) => {
      read.push(uri);
      if (uri.includes("/historico")) throw new Error("histórico não pode virar decisão selecionada");
      return uri.endsWith("/pedido") ? "Pedido atual" : "Decisão aprovada";
    },
    readBinary: async () => ({ content: Buffer.from(""), binary: false }),
    callTool: async () => "",
  };
}

describe("histórico portátil na base autenticada", () => {
  it("lê o pedido e as decisões aprovadas sem importar conversas anteriores como autoridade", async () => {
    const read: string[] = [];
    const resources = [
      { uri: "capivara://app/pedido", name: "Pedido" },
      { uri: "capivara://app/docs/memoria/decisao", name: "Decisão" },
      { uri: "capivara://app/historico", name: "Histórico", mimeType: "application/json" },
      { uri: "capivara://app/historico/1", name: "Prompt anterior", mimeType: "application/json" },
    ];
    const result = await fetchProjectMaterial(base(resources, read), "app");
    expect(result.request).toBe("Pedido atual");
    expect(result.documents.map(item => item.uri)).toEqual(["capivara://app/docs/memoria/decisao"]);
    expect(read).toEqual(["capivara://app/pedido", "capivara://app/docs/memoria/decisao"]);
  });

  it("conta documentos selecionados e reconhece projetos que possuem apenas histórico", async () => {
    const projects = await listLibraryProjects(base([
      { uri: "capivara://app/pedido", name: "Pedido" },
      { uri: "capivara://app/docs/memoria/decisao", name: "Decisão" },
      { uri: "capivara://app/historico", name: "Histórico" },
      { uri: "capivara://novo/historico", name: "Histórico" },
    ], []));
    expect(projects).toEqual([
      { slug: "app", hasRequest: true, documents: 1 },
      { slug: "novo", hasRequest: false, documents: 0 },
    ]);
  });
});
