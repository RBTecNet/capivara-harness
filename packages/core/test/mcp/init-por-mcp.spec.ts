/**
 * O pedido vindo da base documental, atravessando o `init` inteiro.
 *
 * O que precisa ser provado não é que sabemos falar JSON-RPC — isso o teste do
 * cliente já faz. É que um pedido que veio da base é indistinguível, para o
 * resto do ciclo, de um lido do disco: mesmo hash, mesmo run, mesmo registro em
 * `pedido.json`, e o `plan` retomando o esqueleto certo depois. E que as
 * memórias selecionadas chegam a quem escreve.
 */

import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpClient, fetchProjectMaterial } from "../../src/mcp/index.js";
import { requestFromLibrary, runInit, readRequestState } from "../../src/init/index.js";
import { runIdFor } from "../../src/state/index.js";
import { fakeAgent, happyPath } from "../support/fake-agent.js";

const PEDIDO = "uma base documental com area geral e projetos separados";
const MEMORIA = "todo codigo e comentario em portugues do Brasil";
const TECNICA = "SQLite com uma tabela por tipo de documento";

let server: Server;
let url = "";
let projectRoot = "";
let lidos: string[] = [];

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-base-"));
  lidos = [];

  const textos: Record<string, string> = {
    "capivara://biblioteca/pedido": PEDIDO,
    "capivara://biblioteca/docs/memoria/estilo": MEMORIA,
    "capivara://biblioteca/docs/tecnica/banco": TECNICA,
    "capivara://geral/docs/skill/nao-selecionada": "isto nao pertence a este projeto",
  };

  server = createServer((req, res) => {
    let corpo = "";
    req.on("data", (pedaco) => (corpo += pedaco));
    req.on("end", () => {
      const pedido = JSON.parse(corpo) as { id?: number; method: string; params?: Record<string, unknown> };
      if (pedido.id === undefined) {
        res.writeHead(202).end();
        return;
      }

      let result: unknown = {};
      if (pedido.method === "initialize") {
        result = { protocolVersion: "2025-06-18", serverInfo: { name: "base-documental", version: "0.1.0" } };
      } else if (pedido.method === "resources/list") {
        result = {
          resources: Object.keys(textos).map((uri) => ({ uri, name: uri.split("/").pop() })),
        };
      } else if (pedido.method === "resources/read") {
        const uri = String(pedido.params?.uri ?? "");
        lidos.push(uri);
        result = { contents: [{ uri, type: "text", text: textos[uri] ?? "" }] };
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: pedido.id, result }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endereco = server.address();
  url = typeof endereco === "object" && endereco ? `http://127.0.0.1:${endereco.port}/mcp` : "";
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(projectRoot, { recursive: true, force: true });
});

async function material() {
  const client = createMcpClient({ url }, { timeoutSeconds: 5 });
  await client.initialize();
  return fetchProjectMaterial(client, "biblioteca");
}

describe("o pedido que veio da base", () => {
  it("vira um pedido comum, com o URI como procedência", async () => {
    const { request, documents } = await material();
    const pedido = requestFromLibrary("biblioteca", request);

    expect(pedido.text).toBe(PEDIDO);
    expect(pedido.origin).toBe("mcp");
    expect(pedido.path).toBe("capivara://biblioteca/pedido");
    expect(documents).toHaveLength(2);
    // O da área geral não foi sequer lido: a seleção é da aplicação.
    expect(lidos).not.toContain("capivara://geral/docs/skill/nao-selecionada");
  });

  it("atravessa o init: mesmo run, registro em disco e memórias no contexto", async () => {
    const { request, documents } = await material();
    const pedido = requestFromLibrary("biblioteca", request);
    const agent = fakeAgent(happyPath());

    const outcome = await runInit({
      projectRoot,
      request: pedido,
      library: documents,
      language: "português do Brasil",
      call: agent.call,
      ask: async () => "use as recomendações",
    });

    expect(outcome.readiness.ready).toBe(true);
    // A identidade do run sai do texto do pedido, venha ele de onde vier.
    expect(outcome.runId).toBe(runIdFor("init", pedido.sha12));

    // O que o `plan` vai reler depois precisa dizer de onde o pedido veio.
    const registrado = await readRequestState(projectRoot);
    expect(registrado?.origin).toBe("mcp");
    expect(registrado?.sha12).toBe(pedido.sha12);

    // E as memórias selecionadas chegaram a quem escreve — como decisão, não
    // como sugestão: é o prompt do escritor que precisa carregá-las.
    const promptDoEscritor = agent.calls.map((chamada) => chamada.prompt).join("\n");
    expect(promptDoEscritor).toContain(MEMORIA);
    expect(promptDoEscritor).toContain(TECNICA);
    expect(promptDoEscritor).toContain("São decisões já tomadas");
    expect(promptDoEscritor).not.toContain("isto nao pertence a este projeto");
  });

  it("pedido editado na base é outro run, sem reaproveitar o esqueleto do anterior", async () => {
    const primeiro = requestFromLibrary("biblioteca", PEDIDO);
    const depoisDeEditar = requestFromLibrary("biblioteca", `${PEDIDO}, agora com busca`);
    expect(depoisDeEditar.sha12).not.toBe(primeiro.sha12);
    expect(runIdFor("init", depoisDeEditar.sha12)).not.toBe(runIdFor("init", primeiro.sha12));
  });
});
