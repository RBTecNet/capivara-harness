/**
 * O levantamento de ponta a ponta, com um modelo falso.
 *
 * O que estes testes protegem não é o texto que o modelo devolve — é a forma do
 * processo: uma chamada para o mapa, uma por domínio, o merge que não duplica
 * entidade, e a garantia de que nada é escrito na aplicação levantada.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SURVEY_CONTRACT } from "../../src/contract/index.js";
import { SurveyBlockedError, runSurvey } from "../../src/survey/index.js";
import type { SurveyBase } from "../../src/survey/index.js";

let legado = "";
let saida = "";

beforeEach(async () => {
  legado = await mkdtemp(join(tmpdir(), "capivara-legado-"));
  saida = await mkdtemp(join(tmpdir(), "capivara-levantamento-"));
  await mkdir(join(legado, "app"), { recursive: true });
  await writeFile(join(legado, "package.json"), JSON.stringify({ name: "locadora" }), "utf8");
  await writeFile(join(legado, "app", "Locacao.php"), "<?php class Locacao {}", "utf8");
  await writeFile(join(legado, "app", "Cliente.php"), "<?php class Cliente {}", "utf8");
});

afterEach(async () => {
  await rm(legado, { recursive: true, force: true });
  await rm(saida, { recursive: true, force: true });
});

const MAPA = JSON.stringify({
  contract: SURVEY_CONTRACT,
  application: "Locadora",
  stack: [{ component: "linguagem", decision: "PHP 7.4" }],
  domains: [
    { id: "D-01", name: "Locação", purpose: "Aluga filmes.", files: ["app/Locacao.php"] },
    { id: "D-02", name: "Clientes", purpose: "Cadastra quem aluga.", files: ["app/Cliente.php"] },
  ],
  deadCode: [],
  entities: [],
  rules: [],
  flows: [],
  integrations: [],
  questions: [],
});

const dominio = (id: string, entidade: string) =>
  JSON.stringify({
    contract: SURVEY_CONTRACT,
    application: "Locadora",
    domains: [],
    stack: [],
    deadCode: [],
    entities: [
      {
        name: entidade,
        storage: `tabela \`${entidade}\``,
        fields: [{ name: "id", type: "int", notes: "" }],
        relations: [],
        evidence: [{ file: "db.sql", locator: "create table" }],
      },
    ],
    rules: [
      {
        id: `${id}-R01`,
        domain: id,
        layer: "dominio",
        behaviour: `regra de ${id}`,
        intent: "",
        divergence: "",
        evidence: [{ file: `app/${id}.php`, locator: "metodo()" }],
      },
    ],
    flows: [{ id: `${id}-F01`, domain: id, name: `fluxo de ${id}`, actor: "atendente", steps: ["passo"], evidence: [{ file: "x.php", locator: "y" }] }],
    integrations: [],
    questions: [],
  });

interface Chamada {
  subject: string;
  prompt: string;
}

function modelo(respostas: Map<string, string>) {
  const chamadas: Chamada[] = [];
  const call = async (request: { subject: string; prompt: string }) => {
    chamadas.push({ subject: request.subject, prompt: request.prompt });
    return { exitCode: 0, stdout: respostas.get(request.subject) ?? "{}", stderr: "", timedOut: null };
  };
  return { call, chamadas };
}

const respostasBoas = () =>
  new Map([
    ["mapa", MAPA],
    ["D-01", dominio("D-01", "aluguel")],
    ["D-02", dominio("D-02", "cliente")],
  ]);

describe("o levantamento", () => {
  it("faz uma chamada para o mapa e uma por domínio", async () => {
    const { call, chamadas } = modelo(respostasBoas());
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call });

    expect(chamadas.map((chamada) => chamada.subject)).toEqual(["mapa", "D-01", "D-02"]);
    expect(resultado.survey.rules).toHaveLength(2);
    expect(resultado.survey.flows).toHaveLength(2);
  });

  /*
   * Sem saber onde parar, cada sessão lê a aplicação inteira de novo e as regras
   * voltam repetidas, cada uma com uma redação diferente — e ninguém consegue
   * dizer se são a mesma regra.
   */
  it("cada sessão recebe os arquivos do seu domínio e o nome dos outros", async () => {
    const { call, chamadas } = modelo(respostasBoas());
    await runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call });

    const primeira = chamadas.find((chamada) => chamada.subject === "D-01")!.prompt;
    expect(primeira).toContain("app/Locacao.php");
    expect(primeira).not.toContain("- app/Cliente.php");
    expect(primeira).toContain("D-02 Clientes");
  });

  it("a mesma entidade lida por dois domínios não vira duas", async () => {
    const respostas = respostasBoas();
    respostas.set("D-02", dominio("D-02", "aluguel"));

    const { call } = modelo(respostas);
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call });

    expect(resultado.survey.entities.map((entity) => entity.name)).toEqual(["aluguel"]);
    // A evidência das duas leituras se soma: são dois lugares que sustentam a mesma entidade.
    expect(resultado.survey.entities[0]?.evidence.length).toBe(2);
  });

  it("escreve o documento, o JSON e a cobertura — e nada na aplicação levantada", async () => {
    const antes = await readdir(legado);
    const { call } = modelo(respostasBoas());
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call });

    expect(await readdir(legado)).toEqual(antes);
    expect(resultado.written.map((caminho) => caminho.split("/").pop())).toEqual([
      "levantamento.md",
      "levantamento.json",
      "cobertura.json",
    ]);
    expect(await readFile(join(saida, "levantamento.md"), "utf8")).toContain("# Locadora — Levantamento");
  });

  it("conta o que nenhum domínio reivindicou", async () => {
    await writeFile(join(legado, "app", "Fiscal.php"), "<?php class Fiscal {}", "utf8");
    const { call } = modelo(respostasBoas());
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call });

    expect(resultado.coverage.unclaimed).toEqual(["app/Fiscal.php"]);
  });

  it("resposta malformada volta com os defeitos nomeados, e depois desiste", async () => {
    const respostas = new Map([["mapa", "isto não é JSON"]]);
    const { call, chamadas } = modelo(respostas);

    await expect(
      runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call }),
    ).rejects.toThrow(SurveyBlockedError);
    expect(chamadas).toHaveLength(3);
    expect(chamadas[1]?.prompt).toContain("previous answer was rejected");
  });

  /*
   * Defeito de ambiente não vira defeito de conteúdo: o modelo não corrige um
   * timeout reescrevendo o JSON (§34.8).
   */
  it("timeout não é pedido de novo como se fosse erro de forma", async () => {
    const call = async () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: "wall" });
    await expect(
      runSurvey({ projectRoot: legado, outputRoot: saida, language: "português do Brasil", call }),
    ).rejects.toThrow(/limite do harness/);
  });

  it("diretório vazio não é levantamento nenhum", async () => {
    const vazio = await mkdtemp(join(tmpdir(), "capivara-vazio-"));
    const { call } = modelo(respostasBoas());
    await expect(
      runSurvey({ projectRoot: vazio, outputRoot: saida, language: "português do Brasil", call }),
    ).rejects.toThrow(/vazio/);
    await rm(vazio, { recursive: true, force: true });
  });
});

/**
 * Onde o levantamento fica guardado.
 *
 * Os arquivos locais são o piso, sempre: a base é conveniência, não dependência
 * (§34). O que a base acrescenta é o caminho até o `init` — e o nome do projeto
 * sai do nome da aplicação, sem ninguém digitar. Quando esse nome já existe lá,
 * ninguém decide por quem não foi perguntado.
 */
describe("o destino do levantamento", () => {
  const base = (overrides: Partial<SurveyBase> = {}): SurveyBase & { enviados: { slug: string }[] } => {
    const enviados: { slug: string }[] = [];
    return {
      enviados,
      existe: async () => false,
      enviar: async (slug: string) => {
        enviados.push({ slug });
        return { ok: true, mensagem: `gravado em ${slug}` };
      },
      ...overrides,
    } as SurveyBase & { enviados: { slug: string }[] };
  };

  it("o projeto é criado com o nome da aplicação levantada, sem ninguém digitar", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base();
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(destino.enviados.map((envio) => envio.slug)).toEqual(["locadora"]);
    expect(resultado.destino).toEqual({ slug: "locadora", enviado: true, mensagem: "gravado em locadora" });
  });

  it("o slug pedido na linha de comando ganha do nome da aplicação", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base({ projeto: "locadora-antiga" });
    await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(destino.enviados.map((envio) => envio.slug)).toEqual(["locadora-antiga"]);
  });

  /*
   * Sem ninguém para responder, mexer no projeto de outra pessoa é decidir no
   * lugar de quem não foi perguntado.
   */
  it("projeto que já existe, e ninguém para decidir: a base não é tocada", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base({ existe: async () => true });
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(destino.enviados).toEqual([]);
    expect(resultado.destino?.enviado).toBe(false);
    // E o levantamento continua escrito.
    expect(resultado.written).toHaveLength(3);
  });

  it("quem decide atualizar substitui o levantamento do projeto que existe", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base({ existe: async () => true, decidir: async () => "atualizar" });
    await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(destino.enviados.map((envio) => envio.slug)).toEqual(["locadora"]);
  });

  it("quem decide criar outro ganha o primeiro nome livre ao lado", async () => {
    const ocupados = new Set(["locadora", "locadora-2"]);
    const { call } = modelo(respostasBoas());
    const destino = base({ existe: async (slug: string) => ocupados.has(slug), decidir: async () => "novo" });
    await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(destino.enviados.map((envio) => envio.slug)).toEqual(["locadora-3"]);
  });

  it("quem decide ficar local não manda nada", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base({ existe: async () => true, decidir: async () => "local" });
    await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(destino.enviados).toEqual([]);
  });

  /*
   * Silêncio da base não é "não existe". Tratar como ausência criaria projeto
   * por cima de outro no primeiro soluço de rede.
   */
  it("base que não responde não vira projeto novo — e o levantamento fica em disco", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base({ existe: async () => null });
    const linhas: string[] = [];
    const resultado = await runSurvey({
      projectRoot: legado,
      outputRoot: saida,
      language: "pt",
      call,
      base: destino,
      announce: (linha) => void linhas.push(linha),
    });

    expect(destino.enviados).toEqual([]);
    expect(linhas.join(" ")).toContain("a base não respondeu");
    expect(await readFile(join(saida, "levantamento.md"), "utf8")).toContain("Levantamento");
    expect(resultado.destino?.enviado).toBe(false);
  });

  /*
   * A colisão é descoberta depois do mapa e antes das sessões de domínio: é o
   * primeiro instante em que o nome existe, e o último em que a resposta ainda
   * muda o custo.
   */
  it("a pergunta acontece antes de gastar uma sessão por domínio", async () => {
    const { call, chamadas } = modelo(respostasBoas());
    let quandoPerguntou = -1;
    const destino = base({
      existe: async () => true,
      decidir: async () => {
        quandoPerguntou = chamadas.length;
        return "local";
      },
    });

    await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    // Uma chamada feita — o mapa. As duas de domínio ainda não aconteceram.
    expect(quandoPerguntou).toBe(1);
    expect(chamadas).toHaveLength(3);
  });

  it("falha no envio não derruba o levantamento: os arquivos já estão escritos", async () => {
    const { call } = modelo(respostasBoas());
    const destino = base({ enviar: async () => ({ ok: false, mensagem: "connection refused" }) });
    const resultado = await runSurvey({ projectRoot: legado, outputRoot: saida, language: "pt", call, base: destino });

    expect(resultado.destino).toEqual({ slug: "locadora", enviado: false, mensagem: "connection refused" });
    expect(await readFile(join(saida, "levantamento.md"), "utf8")).toContain("Levantamento");
  });
});

/*
 * O survey do cronus3 com o codex: a CLI recebeu `--cd` numa pasta de saída que
 * ainda não existia, respondeu "Error: No such file or directory" com código
 * zero, e o survey pediu três vezes ao modelo que corrigisse um JSON que ele
 * nunca escreveu.
 */
describe("o motor que falhou não respondeu mal", () => {
  it("resposta sem resultado legível para o survey como ambiente, na primeira chamada", async () => {
    let chamadas = 0;
    const erro = await runSurvey({
      projectRoot: legado,
      outputRoot: saida,
      language: "português do Brasil",
      call: async () => {
        chamadas += 1;
        return { exitCode: 0, stdout: "Error: No such file or directory (os error 2)", stderr: "", timedOut: null, resultRead: false };
      },
    }).catch((falha: unknown) => falha);

    expect(erro).toBeInstanceOf(SurveyBlockedError);
    expect(chamadas).toBe(1);
    expect((erro as Error).message).toContain("falhou antes de o modelo responder");
    expect((erro as Error).message).toContain("No such file or directory");

    const { paradaDoEstagio } = await import("../../src/commands/paradas.js");
    expect(paradaDoEstagio(erro as Error, "survey").deQuem).toContain("da CLI");
  });

  it("código de saída diferente de zero também", async () => {
    const erro = await runSurvey({
      projectRoot: legado,
      outputRoot: saida,
      language: "português do Brasil",
      call: async () => ({ exitCode: 2, stdout: "", stderr: "unknown model", timedOut: null }),
    }).catch((falha: unknown) => falha);
    expect((erro as Error).message).toContain("(código 2)");
    expect((erro as Error).message).toContain("unknown model");
  });
});
