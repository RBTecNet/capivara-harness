import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BridgeRequest, BridgeResponse } from "../../src/commands/agent.js";
import {
  lerLinhaDeAptidao,
  modoDoPapel,
  papeisParaProvar,
  promptDaAptidao,
  provarAptidao,
  saidaEsperadaDoGerador,
  type ModoDaAptidao,
  type Sementes,
} from "../../src/aptidao/index.js";
import { resolveRoles } from "../../src/provider/roles.js";

const executar = promisify(execFile);
const SEMENTES: Sementes = { codigo: "CPV-1A2B3C4D", segredo: "0123456789abcdef0123456789abcdef" };
const ok = (stdout: string): BridgeResponse => ({ exitCode: 0, stdout, stderr: "", timedOut: null, resultRead: true });

/** Um "modelo" é o que ele faz na bancada e o que responde. */
type Modelo = (raiz: string, request: BridgeRequest) => Promise<BridgeResponse>;

const capaz: Modelo = async (raiz) => {
  const codigo = (await readFile(join(raiz, "entrada.txt"), "utf8")).split(":")[1]?.trim() ?? "";
  const config = JSON.parse(await readFile(join(raiz, "config.json"), "utf8")) as Record<string, unknown>;
  await writeFile(join(raiz, "config.json"), JSON.stringify({ ...config, versao: 2 }, null, 2));
  const { stdout } = await executar("node", ["gerar.mjs"], { cwd: raiz });
  await writeFile(join(raiz, "resultado.txt"), stdout);
  return ok(`Feito. Li o arquivo, editei a config e rodei o script.\nCAPIVARA_APTIDAO: ${codigo}`);
};

let base: string;
let chamadas: number;

function prova(modelo: Modelo | Modelo[], modo: ModoDaAptidao = "escrita", extra: { agora?: () => number; tentativas?: number } = {}) {
  const sequencia = Array.isArray(modelo) ? modelo : [modelo];
  return provarAptidao({
    papel: modo === "escrita" ? "builder" : "verifier",
    modo,
    pastaBase: base,
    sementes: () => SEMENTES,
    ...extra,
    criarPonte: (raiz) => async (request) => {
      const atual = sequencia[Math.min(chamadas, sequencia.length - 1)] as Modelo;
      chamadas += 1;
      request.onOutput?.("{", "out");
      return atual(raiz, request);
    },
  });
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "aptidao-"));
  chamadas = 0;
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("o modelo capaz", () => {
  it("lê, edita, roda o comando e responde: apto, sem alerta", async () => {
    const resultado = await prova(capaz);
    expect(resultado.veredito).toBe("apto");
    expect(resultado.checagens.map((c) => [c.nome, c.ok])).toEqual([
      ["sessao", true],
      ["protocolo", true],
      ["leitura", true],
      ["edicao", true],
      ["comando", true],
    ]);
    expect(resultado.alertas).toEqual([]);
    expect(resultado.tentativas).toBe(1);
  });

  it("a bancada é apagada no fim", async () => {
    await prova(capaz);
    expect(await readdir(base)).toEqual([]);
  });

  it("o valor do gerador só sai rodando o script", async () => {
    expect(saidaEsperadaDoGerador(SEMENTES.segredo)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("a embalagem é tolerada; o conteúdo, não", () => {
  it.each([
    ["**CAPIVARA_APTIDAO:** CPV-1A2B3C4D"],
    ["`CAPIVARA_APTIDAO: CPV-1A2B3C4D`"],
    ["- CAPIVARA_APTIDAO: CPV-1A2B3C4D"],
    ["capivara_aptidao: CPV-1A2B3C4D."],
    ["### CAPIVARA_APTIDAO: **CPV-1A2B3C4D**"],
  ])("%s → lido, com alerta de formato", (linha) => {
    expect(lerLinhaDeAptidao(`ok\n${linha}`)).toEqual({ codigo: "CPV-1A2B3C4D", exata: false });
  });

  it("o raciocínio no texto não conta: vale a resposta depois dele", () => {
    const saida = "<think>CAPIVARA_APTIDAO: CPV-ERRADO talvez?</think>\nCAPIVARA_APTIDAO: CPV-1A2B3C4D";
    expect(lerLinhaDeAptidao(saida)).toEqual({ codigo: "CPV-1A2B3C4D", exata: true });
  });

  it("a resposta só dentro do raciocínio não é resposta", () => {
    expect(lerLinhaDeAptidao("<think>CAPIVARA_APTIDAO: CPV-1A2B3C4D</think>\nPronto.")).toBeNull();
  });

  it("modelo que embrulha a linha é apto, e o alerta registra o hábito", async () => {
    const embrulha: Modelo = async (raiz, request) => {
      const resposta = await capaz(raiz, request);
      return ok(resposta.stdout.replace("CAPIVARA_APTIDAO:", "**CAPIVARA_APTIDAO:**"));
    };
    const resultado = await prova(embrulha);
    expect(resultado.veredito).toBe("apto");
    expect(resultado.alertas.join()).toMatch(/formato/);
  });
});

describe("o modelo abaixo do piso: inapto, sem repetir", () => {
  it("chuta o resultado em vez de rodar o comando", async () => {
    const chuta: Modelo = async (raiz, request) => {
      const resposta = await capaz(raiz, request);
      await writeFile(join(raiz, "resultado.txt"), "a1b2c3d4e5f60718\n");
      return resposta;
    };
    const resultado = await prova(chuta);
    expect(resultado.veredito).toBe("inapto");
    expect(resultado.checagens.find((c) => c.nome === "comando")).toMatchObject({ ok: false });
    expect(chamadas).toBe(1);
  });

  it("estraga o resto do arquivo ao editar", async () => {
    const estraga: Modelo = async (raiz, request) => {
      const resposta = await capaz(raiz, request);
      await writeFile(join(raiz, "config.json"), JSON.stringify({ versao: 2 }));
      return resposta;
    };
    const resultado = await prova(estraga);
    expect(resultado.veredito).toBe("inapto");
    expect(resultado.checagens.find((c) => c.nome === "edicao")?.detalhe).toMatch(/versao/);
  });

  it("responde sem a linha de protocolo", async () => {
    const resultado = await prova(async () => ok("Fiz tudo que foi pedido."));
    expect(resultado.veredito).toBe("inapto");
    expect(resultado.checagens.find((c) => c.nome === "protocolo")).toMatchObject({ ok: false });
  });

  it("inventa o código", async () => {
    const inventa: Modelo = async (raiz, request) => {
      await capaz(raiz, request);
      return ok("CAPIVARA_APTIDAO: CPV-00000000");
    };
    const resultado = await prova(inventa);
    expect(resultado.checagens.find((c) => c.nome === "leitura")).toMatchObject({ ok: false });
  });
});

describe("o provedor instável: repete, e diz", () => {
  const caiu: Modelo = async () => ({ exitCode: 124, stdout: "", stderr: "", timedOut: "first-output" });

  it("caiu na primeira e passou na segunda: apto, com alerta de instabilidade", async () => {
    const resultado = await prova([caiu, capaz]);
    expect(resultado.veredito).toBe("apto");
    expect(resultado.tentativas).toBe(2);
    expect(resultado.alertas.join()).toMatch(/instabilidade/);
  });

  it("caiu em todas: instável, não inapto", async () => {
    const resultado = await prova(caiu);
    expect(resultado.veredito).toBe("instavel");
    expect(resultado.checagens[0]?.detalhe).toMatch(/tempo esgotado/);
    expect(chamadas).toBe(2);
  });

  it.each([
    [{ exitCode: 1, stdout: "", stderr: "fetch failed", timedOut: null }, /código 1/],
    [{ exitCode: 0, stdout: "", stderr: "", timedOut: null, engineError: true }, /erro/],
    [{ exitCode: 0, stdout: "CAPI", stderr: "", timedOut: null, partialOutput: "CAPI" }, /incompleta/],
  ] as [BridgeResponse, RegExp][])("sessão anormal %#", async (resposta, motivo) => {
    const resultado = await prova(async () => resposta, "escrita", { tentativas: 1 });
    expect(resultado.veredito).toBe("instavel");
    expect(resultado.checagens[0]?.detalhe).toMatch(motivo);
  });

  it("cota ou configuração: não é instabilidade, e não se repete", async () => {
    const resultado = await prova(async () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: null, providerFailure: "quota" }));
    expect(resultado.veredito).toBe("configuracao");
    expect(chamadas).toBe(1);
  });

  it("lento mas certo: apto, com alerta de lentidão", async () => {
    let t = 0;
    const resultado = await prova(capaz, "escrita", { agora: () => (t += 70_000) });
    expect(resultado.veredito).toBe("apto");
    expect(resultado.alertas.join()).toMatch(/lentidão/);
  });
});

describe("papéis de leitura e API direta", () => {
  const leitor: Modelo = async (raiz) => {
    const codigo = (await readFile(join(raiz, "entrada.txt"), "utf8")).split(":")[1]?.trim() ?? "";
    return ok(`CAPIVARA_APTIDAO: ${codigo}`);
  };

  it("leitura: lê e responde, sem pedir edição nem comando", async () => {
    const resultado = await prova(leitor, "leitura");
    expect(resultado.veredito).toBe("apto");
    expect(resultado.checagens.map((c) => c.nome)).toEqual(["sessao", "protocolo", "leitura"]);
  });

  it("leitura que escreve na bancada: apto, mas o alerta aponta o sandbox", async () => {
    const resultado = await prova(capaz, "leitura");
    expect(resultado.veredito).toBe("apto");
    expect(resultado.alertas.join()).toMatch(/permissão/);
  });

  it("API direta: o código vai no prompt, e só se pede a linha", async () => {
    const prompt = promptDaAptidao("direta", SEMENTES);
    expect(prompt).toContain("codigo: CPV-1A2B3C4D");
    expect(prompt).not.toMatch(/Edit|Run the command/);
    const resultado = await prova(async () => ok("CAPIVARA_APTIDAO: CPV-1A2B3C4D"), "direta");
    expect(resultado.veredito).toBe("apto");
  });
});

describe("quais papéis provar", () => {
  it("o executor prova escrita; quem lê prova leitura pela CLI, ou direta pela API", () => {
    const roles = resolveRoles({ global: { provider: "opencode", model: "minimax/MiniMax-M2" }, roles: { writer: { provider: "minimax", model: "MiniMax-M2" } } });
    expect(modoDoPapel("builder", roles.builder)).toBe("escrita");
    expect(modoDoPapel("verifier", roles.verifier)).toBe("leitura");
    expect(modoDoPapel("writer", roles.writer)).toBe("direta");
  });

  it("dois papéis com o mesmo modelo e o mesmo modo fazem uma prova só", () => {
    const roles = resolveRoles({ global: { provider: "opencode", model: "minimax/MiniMax-M2" }, roles: {} });
    expect(papeisParaProvar(roles, ["writer", "auditor", "builder", "verifier"])).toEqual(["writer", "builder"]);
  });

  it("papel sem provider não é provado", () => {
    const roles = resolveRoles({ global: {}, roles: { builder: { provider: "codex", model: "gpt-5" } } });
    expect(papeisParaProvar(roles, ["writer", "builder"])).toEqual(["builder"]);
  });
});

it("a bancada não sobra nem quando a ponte lança", async () => {
  await expect(prova(async () => { throw new Error("spawn ENOENT"); })).rejects.toThrow("ENOENT");
  expect(existsSync(join(base, `builder-${SEMENTES.codigo.toLowerCase()}`))).toBe(false);
});
