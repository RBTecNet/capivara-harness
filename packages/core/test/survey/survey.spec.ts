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
