/**
 * §134 — a conclusão do fluxo pela evidência compatível com a plataforma.
 *
 * A §133 parou de exigir navegador de quem não tem um, mas deixou o fluxo sem
 * saída: no Luna (`build-521a72e8dbb5`, desktop Avalonia) ele ficava pendente
 * para sempre e o build terminava com código 2, com o produto funcionando. E a
 * suíte que o PLAN contratou (xUnit) nunca rodou: o G2 não reconhecia .NET e
 * ficou NOT_APPLICABLE em todas as passagens — numa cópia do projeto,
 * `dotnet test tests/Agenda.Tests/Agenda.Tests.csproj` passa 13 testes.
 *
 * O que muda, sem gate novo e sem chamada nova de modelo:
 * - o G2 roda a suíte .NET declarada;
 * - o G4 percorre por comandos o produto de terminal, sem servidor nem navegador;
 * - o fluxo que não se percorre (janela nativa) se conclui pela suíte do projeto,
 *   passo a passo, com o teste citado pelo roteirista independente e conferido
 *   pelo Core; o passo sem teste aceito continua pendente e nomeado;
 * - a fase que fechou com pendência volta a ser verificada na execução seguinte.
 */

import { certifyCurrentPlan } from "../support/current-plan.js";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FLOWS_DIR, gate4, renderFlowConfig, resolveTestCommand, runBuild, type EngineCall, type EngineResult } from "../../src/loop/index.js";
import { FLOW_CONFIG, FLOW_MARK, checkFlowScript, conferirCitacao, conferirProvas, linhaDeNavegador, roteiroUsaOServidor, stackDeTerminal } from "../../src/loop/flows.js";
import { testeDotnetAprovado } from "../../src/loop/teste-declarado.js";
import { lerResultadosDotnet, RESULTADOS_DOTNET } from "../../src/loop/testcmd.js";
import { MARCA_PROVA_PELA_SUITE } from "../../src/loop/runner.js";
import { testesQueFalharam } from "../../src/loop/defeitos.js";
import type { BuildOptions } from "../../src/loop/index.js";
import { LivroDeEvidencias } from "../../src/loop/evidencias.js";
import { lerFasesFechadas } from "../../src/loop/ledger.js";
import { FORA_DO_NAVEGADOR, PROVA, SEM_PROVA, stepLabel } from "../../src/prompts/index.js";
import { runPaths } from "../../src/state/index.js";
import type { Skeleton, SkeletonWorkflow } from "../../src/contract/index.js";

const run = promisify(execFile);
let projectRoot = "";
let cache = "";

async function git(args: string[]): Promise<string> {
  return (await run("git", args, { cwd: projectRoot })).stdout.trim();
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-134-"));
  cache = await mkdtemp(join(tmpdir(), "capivara-134-cache-"));
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "teste"]);
  await git(["config", "user.email", "teste@localhost"]);
  await mkdir(join(projectRoot, ".capivara", "init"), { recursive: true });
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

const DESKTOP = "Interface visual: Avalonia UI para aplicativo desktop compatível com Windows e Linux";
const WEB = "Interface: React servida pelo próprio servidor e usada no navegador";
const CLI = "Interface: programa de linha de comando usado no terminal";
/** O painel web de um produto desktop: o híbrido em que um fluxo se percorre no navegador e o outro fica fora dele. */
const PAINEL_WEB = "Painel: página de administração usada no navegador";

const FLUXO: SkeletonWorkflow = { number: "1", name: "Cadastrar compromisso", steps: ["O usuário informa o título.", "A aplicação salva o compromisso."] };
const EXPORTAR: SkeletonWorkflow = { number: "2", name: "Exportar a agenda", steps: ["O usuário pede a exportação."] };

const ARQUIVO_DE_TESTE = "tests/Agenda.Tests/AgendaTests.cs";
/** O `dotnet test` que o G2 resolve para um projeto de teste: com o relatório TRX de cada teste (§134). */
const comandoDotnet = (projeto: string, citado = projeto): string =>
  `dotnet test ${citado} --logger "trx;LogFileName=${projeto.replace(/[^\w.-]+/gu, "-")}.trx" --results-directory ${RESULTADOS_DOTNET}`;
/** A suíte que o G2 resolve para o projeto de teste do Luna. */
const SUITE_DOTNET = comandoDotnet("tests/Agenda.Tests/Agenda.Tests.csproj");

/** Um relatório TRX no formato que o `dotnet test` grava (testes e resultados), com `Classe.Metodo` e o resultado. */
function trx(testes: [classe: string, metodo: string, resultado: string][]): string {
  const ids = testes.map((_teste, indice) => `0000000${indice}-0000-0000-0000-000000000000`);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TestRun id="1" name="x" xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">',
    "  <Results>",
    ...testes.map(([classe, metodo, resultado], indice) => `    <UnitTestResult executionId="e${indice}" testId="${ids[indice]}" testName="${classe}.${metodo}(n: &quot;x&quot;)" outcome="${resultado}" testListId="l" />`),
    "  </Results>",
    "  <TestDefinitions>",
    ...testes.map(([classe, metodo], indice) => `    <UnitTest name="${classe}.${metodo}" storage="/x/agenda.tests.dll" id="${ids[indice]}">\n      <Execution id="e${indice}" />\n      <TestMethod codeBase="/x/Agenda.Tests.dll" adapterTypeName="executor://xunit/VsTestRunner3/netcore/" className="${classe}" name="${metodo}" />\n    </UnitTest>`),
    "  </TestDefinitions>",
    "</TestRun>",
    "",
  ].join("\n");
}

/** O que o relatório do G2 diz dos testes do Luna: os dois do arquivo citado rodaram e passaram. */
const TESTES_OK = new Map([
  ["Agenda.Tests.AgendaTests.InformaTituloNoFormulario", true],
  ["Agenda.Tests.AgendaTests.SalvaCompromissoNaAgendaLocal", true],
]);
const TESTES_CS = [
  "namespace Agenda.Tests;",
  "",
  "public class AgendaTests",
  "{",
  "    [Fact]",
  "    public async Task InformaTituloNoFormulario() { }",
  "    [Fact]",
  "    public async Task SalvaCompromissoNaAgendaLocal() { }",
  "}",
  "",
].join("\n");

/** O roteirista que lê o contrato e a suíte: marca e prova de cada passo. */
const PROVADO = [
  `O produto é uma janela nativa.`,
  `${FORA_DO_NAVEGADOR}: ${DESKTOP}`,
  `${PROVA}: passo 1 — ${ARQUIVO_DE_TESTE} :: InformaTituloNoFormulario`,
  `${PROVA}: passo 2 — ${ARQUIVO_DE_TESTE} :: SalvaCompromissoNaAgendaLocal`,
].join("\n");
const SO_A_MARCA = `${FORA_DO_NAVEGADOR}: ${DESKTOP}`;

function roteiroWeb(workflow: SkeletonWorkflow): string {
  const passos = workflow.steps.map((passo, indice) => `  await test.step('${stepLabel(indice, passo)}', async () => { await page.goto('/'); await expect(page.getByRole('main')).toBeVisible(); });`);
  return ["```ts", "import { expect, test } from '@playwright/test';", `test('workflow ${workflow.number}', async ({ page }) => {`, ...passos, "});", "```"].join("\n");
}

function roteiroDeTerminal(workflow: SkeletonWorkflow): string {
  const passos = workflow.steps.map(
    (passo, indice) =>
      `  await test.step('${stepLabel(indice, passo)}', async () => {\n` +
      "    const resultado = await comandoDoProjeto('python3', ['-m', 'agenda', 'exportar']);\n" +
      "    expect(resultado.codigo, resultado.saida).toBe(0);\n" +
      "    expect(resultado.saida).toContain('exportado');\n" +
      "  });",
  );
  return [
    "```ts",
    "import { expect, test } from '@playwright/test';",
    "import { comandoDoProjeto } from './capivara-comando';",
    `test('workflow ${workflow.number}', async () => {`,
    ...passos,
    "});",
    "```",
  ].join("\n");
}

// ------------------------------------------------------------------ G2 .NET

describe("§134 · o G2 roda a suíte .NET que o PLAN contratou (Luna)", () => {
  const csproj = (sdk: string): string =>
    `<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="${sdk}" Version="17.14.1" />\n  </ItemGroup>\n</Project>\n`;

  it("o projeto de teste vira `dotnet test <projeto>`, como no Luna", async () => {
    await mkdir(join(projectRoot, "src/Agenda"), { recursive: true });
    await mkdir(join(projectRoot, "tests/Agenda.Tests"), { recursive: true });
    await writeFile(join(projectRoot, "src/Agenda/Agenda.csproj"), csproj("Avalonia"), "utf8");
    await writeFile(join(projectRoot, "tests/Agenda.Tests/Agenda.Tests.csproj"), csproj("Microsoft.NET.Test.Sdk"), "utf8");
    expect(await resolveTestCommand(projectRoot, { environment: {} })).toEqual({
      command: SUITE_DOTNET,
      source: "projeto de teste .NET",
      containerized: false,
    });
  });

  it("cada projeto de teste roda; `bin`, `obj`, dependências e o que não é teste ficam de fora", async () => {
    for (const pasta of ["tests/A.Tests", "tests/B.Tests", "tests/A.Tests/bin/Debug", "src/App", "vendor/pacote/Tests", ".venv/lib/Tests"]) await mkdir(join(projectRoot, pasta), { recursive: true });
    // Dependência de outro ecossistema não é suíte do projeto, e a busca não desce nela.
    await writeFile(join(projectRoot, "vendor/pacote/Tests/Vendido.Tests.csproj"), csproj("Microsoft.NET.Test.Sdk"), "utf8");
    await writeFile(join(projectRoot, ".venv/lib/Tests/Oculto.Tests.csproj"), csproj("Microsoft.NET.Test.Sdk"), "utf8");
    await writeFile(join(projectRoot, "tests/B.Tests/B.Tests.fsproj"), "<Project Sdk=\"MSTest.Sdk/3.6.4\"></Project>\n", "utf8");
    await writeFile(join(projectRoot, "tests/A.Tests/A.Tests.csproj"), "<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup></Project>\n", "utf8");
    await writeFile(join(projectRoot, "tests/A.Tests/bin/Debug/Copia.csproj"), csproj("Microsoft.NET.Test.Sdk"), "utf8");
    await writeFile(join(projectRoot, "src/App/App.csproj"), csproj("Avalonia"), "utf8");
    expect((await resolveTestCommand(projectRoot, { environment: {} }))?.command).toBe(
      `${comandoDotnet("tests/A.Tests/A.Tests.csproj")} && ${comandoDotnet("tests/B.Tests/B.Tests.fsproj")}`,
    );
  });

  it("projeto .NET sem projeto de teste continua sem suíte; o manifesto com `test` continua na frente", async () => {
    await mkdir(join(projectRoot, "src/App"), { recursive: true });
    await writeFile(join(projectRoot, "src/App/App.csproj"), csproj("Avalonia"), "utf8");
    expect(await resolveTestCommand(projectRoot, { environment: {} })).toBeNull();
    await mkdir(join(projectRoot, "tests/X"), { recursive: true });
    await writeFile(join(projectRoot, "tests/X/X.csproj"), csproj("Microsoft.NET.Test.Sdk"), "utf8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }), "utf8");
    expect((await resolveTestCommand(projectRoot, { environment: {} }))?.command).toBe("npm test");
  });

  it("caminho com espaço vai entre aspas", async () => {
    await mkdir(join(projectRoot, "meus testes"), { recursive: true });
    await writeFile(join(projectRoot, "meus testes/T.csproj"), csproj("Microsoft.NET.Test.Sdk"), "utf8");
    expect((await resolveTestCommand(projectRoot, { environment: {} }))?.command).toBe(comandoDotnet("meus testes/T.csproj", "'meus testes/T.csproj'"));
  });

  it("o teste que falhou no .NET tem nome, em qualquer idioma do VSTest", () => {
    const saida = [
      "[xUnit.net 00:00:00.46]     Agenda.Tests.PersistenciaTests.NovaInstanciaGeraGuid [FAIL]",
      "  Com falha Agenda.Tests.PersistenciaTests.NovaInstanciaGeraGuid [24 ms]",
      "  Failed Agenda.Tests.AgendaTests.Salva [3 ms]",
      "Com falha! – Com falha:     1, Aprovado:    12, Ignorado:     0, Total:    13",
    ].join("\n");
    expect(testesQueFalharam(saida)).toEqual(["Agenda.Tests.AgendaTests.Salva", "Agenda.Tests.PersistenciaTests.NovaInstanciaGeraGuid"]);
  });
});

// ------------------------------------------------------------------ G4 terminal

describe("§134 · o G4 percorre o produto de terminal por comandos", () => {
  it("o roteiro que não abre página não precisa do servidor; o que abre, precisa", () => {
    expect(roteiroUsaOServidor(roteiroDeTerminal(EXPORTAR))).toBe(false);
    expect(roteiroUsaOServidor(roteiroWeb(FLUXO))).toBe(true);
    expect(roteiroUsaOServidor("test('w', async ({ request }) => { await request.get('/api'); });")).toBe(true);
    expect(roteiroUsaOServidor("test('w', async () => { const app = await aplicacaoPropria(); });")).toBe(true);
    expect(roteiroUsaOServidor("test('w', async () => { await comandoDoProjeto('curl', ['http://127.0.0.1:3000']); });")).toBe(true);
    // Sem conseguir ler a assinatura, vale o de sempre: com servidor.
    expect(roteiroUsaOServidor("test('w', minhaFuncao);")).toBe(true);
    // O gancho que abre a página também pede o servidor, mesmo com o teste sem fixture.
    expect(roteiroUsaOServidor("test.beforeEach(async ({ page }) => { await page.goto('/'); });\ntest('w', async () => { await comandoDoProjeto('x'); });")).toBe(true);
    expect(roteiroUsaOServidor("test.beforeAll(async function ({ browser }) { });\ntest('w', async () => {});")).toBe(true);
    expect(roteiroUsaOServidor("test('w', async (fixtures) => { await fixtures.page.goto('/'); });")).toBe(true);
  });

  it("sem servidor, a configuração não tem `webServer` e continua do harness", () => {
    const config = renderFlowConfig({ startCommand: null, port: 4001, scripts: ["workflow-1.spec.ts"] });
    expect(config).not.toContain("webServer");
    expect(config).toContain("workers: 1,");
    expect(config).toContain("forbidOnly: true");
    // Com servidor, nada muda.
    expect(renderFlowConfig({ startCommand: "npm start", port: 4001 })).toContain("webServer: {");
  });

  it("CLI sem `start`: o roteiro de comandos roda, sem cobrar entrypoint nem perguntar de novo", async () => {
    let perguntas = 0;
    let config = "";
    const resultado = await gate4({
      projectRoot, workflows: [EXPORTAR], startCommand: null, contratoCertificado: `## Stack\n- ${CLI}`, confirmarSemStart: true,
      author: async () => {
        perguntas += 1;
        return roteiroDeTerminal(EXPORTAR);
      },
      runner: async (raiz, scripts) => {
        config = await readFile(join(raiz, FLOWS_DIR, FLOW_CONFIG), "utf8");
        return { exitCode: 0, output: `${scripts.length} passed` };
      },
    });
    if (!resultado.green) throw new Error(resultado.cause);
    expect(resultado.scripts).toEqual(["workflow-2.spec.ts"]);
    expect(resultado.perguntouSemStart).toBeUndefined();
    expect(perguntas).toBe(1);
    expect(config).not.toContain("webServer");
  });

  it("CLI com `start` que não serve HTTP: o gate não espera porta nenhuma", async () => {
    let config = "";
    const resultado = await gate4({
      projectRoot, workflows: [EXPORTAR], startCommand: "npm start", contratoCertificado: `## Stack\n- ${CLI}`,
      author: async () => roteiroDeTerminal(EXPORTAR),
      runner: async (raiz) => {
        config = await readFile(join(raiz, FLOWS_DIR, FLOW_CONFIG), "utf8");
        return { exitCode: 0, output: "1 passed" };
      },
    });
    expect(resultado.green).toBe(true);
    expect(config).not.toContain("webServer");
  });

  it("CLI com defeito real continua reprovando: o comando falhou, e a causa é do produto", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [EXPORTAR], startCommand: null, contratoCertificado: `## Stack\n- ${CLI}`,
      author: async () => roteiroDeTerminal(EXPORTAR),
      runner: async () => ({
        exitCode: 1,
        output: "  ✘  1 [workflow-2] › workflow-2.spec.ts:4:1 › workflow 2\n  1) [workflow-2] › workflow-2.spec.ts:4:1 › passo 1: O usuário pede a exportação.\n    Expected: 0\n    Received: 2\n  1 failed",
      }),
    });
    if (resultado.green) throw new Error("o comando que falha não pode passar");
    expect(resultado.cause).toContain("a aplicação não cumpriu um fluxo declarado");
    expect(resultado.falharam).toEqual(["2"]);
  });

  it("controle web: roteiro com página e `start` sobe o servidor como antes; sem `start`, o entrypoint continua cobrado", async () => {
    let config = "";
    const comStart = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: `## Stack\n- ${WEB}`,
      author: async () => roteiroWeb(FLUXO),
      runner: async (raiz) => {
        config = await readFile(join(raiz, FLOWS_DIR, FLOW_CONFIG), "utf8");
        return { exitCode: 0, output: "1 passed" };
      },
    });
    expect(comStart.green).toBe(true);
    expect(config).toContain("webServer: {");
    expect(config).toContain('command: "npm start"');
    const semStart = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: `## Stack\n- ${WEB}`,
      author: async () => roteiroWeb(FLUXO), runner: async () => ({ exitCode: 0, output: "1 passed" }),
    });
    if (semStart.green) throw new Error("web sem start deve reprovar");
    expect(semStart.cause).toContain("não sabe como subir a aplicação");
  });

  it("controle web: o defeito real do produto continua reprovando", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: `## Stack\n- ${WEB}`,
      author: async () => roteiroWeb(FLUXO),
      runner: async () => ({ exitCode: 1, output: "  ✘  1 [workflow-1] › workflow-1.spec.ts:3:1 › workflow 1\n  1 failed" }),
    });
    if (resultado.green) throw new Error("o fluxo web que falha não pode passar");
    expect(resultado.cause).toContain("a aplicação não cumpriu um fluxo declarado");
  });
});

// ------------------------------------------------------------------ prova pela suíte

describe("§134 · a prova pela suíte é conferida pelo Core, pelo relatório do runner", () => {
  const SUITE = SUITE_DOTNET;

  beforeEach(async () => {
    await mkdir(join(projectRoot, "tests/Agenda.Tests"), { recursive: true });
    await writeFile(join(projectRoot, ARQUIVO_DE_TESTE), TESTES_CS, "utf8");
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src/ServicoAgenda.cs"), "public class ServicoAgenda { public void SalvaCompromissoNaAgendaLocal() { } }\n", "utf8");
  });

  it("a marca com as provas chega ao runner com o que o roteirista citou", async () => {
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: null, contratoCertificado: `## Stack\n- ${DESKTOP}`,
      author: async () => PROVADO,
      runner: async () => {
        throw new Error("nenhum navegador deveria abrir");
      },
    });
    if (!resultado.green) throw new Error(resultado.cause);
    expect(resultado.naoPercorridos).toEqual([
      {
        number: "1",
        trecho: DESKTOP,
        provas: [
          { passo: 1, arquivo: ARQUIVO_DE_TESTE, teste: "InformaTituloNoFormulario" },
          { passo: 2, arquivo: ARQUIVO_DE_TESTE, teste: "SalvaCompromissoNaAgendaLocal" },
        ],
      },
    ]);
  });

  it("o relatório TRX do `dotnet test` vira, teste a teste, o que passou: pulado e caso de Theory que falhou não passaram", async () => {
    await mkdir(join(projectRoot, RESULTADOS_DOTNET), { recursive: true });
    await writeFile(
      join(projectRoot, RESULTADOS_DOTNET, "a.trx"),
      trx([
        ["Agenda.Tests.AgendaTests", "InformaTituloNoFormulario", "Passed"],
        ["Agenda.Tests.AgendaTests", "Pulado", "NotExecuted"],
        ["Agenda.Tests.AgendaTests", "Theory", "Passed"],
        ["Agenda.Tests.AgendaTests", "Theory", "Failed"],
      ]),
      "utf8",
    );
    expect(await lerResultadosDotnet(projectRoot)).toEqual(new Map([
      ["Agenda.Tests.AgendaTests.InformaTituloNoFormulario", true],
      ["Agenda.Tests.AgendaTests.Pulado", false],
      ["Agenda.Tests.AgendaTests.Theory", false],
    ]));
    await rm(join(projectRoot, RESULTADOS_DOTNET), { recursive: true });
    expect(await lerResultadosDotnet(projectRoot)).toBeNull();
  });

  it("todo passo com teste aprovado no relatório e a suíte verde: concluído", async () => {
    const conferido = await conferirProvas(projectRoot, FLUXO, {
      provas: [
        { passo: 1, arquivo: ARQUIVO_DE_TESTE, teste: "InformaTituloNoFormulario" },
        { passo: 2, arquivo: `\`${ARQUIVO_DE_TESTE}\``, teste: "Agenda.Tests.AgendaTests.SalvaCompromissoNaAgendaLocal" },
      ],
    }, SUITE, TESTES_OK);
    expect(conferido.semProva).toEqual([]);
    expect(conferido.provas.map((prova) => prova.passo)).toEqual([1, 2]);
  });

  it("nenhum falso PASS: arquivo inexistente, nome ausente, arquivo de produto, fora do projeto e do harness", async () => {
    const casos: [string, string, string][] = [
      ["tests/Agenda.Tests/Inexistente.cs", "InformaTituloNoFormulario", "não existe"],
      [ARQUIVO_DE_TESTE, "NaoExisteEsteTeste", "não está no código"],
      [ARQUIVO_DE_TESTE, "InformaTitulo", "não está no código"],
      ["src/ServicoAgenda.cs", "SalvaCompromissoNaAgendaLocal", "fora dos projetos de teste"],
      ["src/contest.py", "SalvaCompromissoNaAgendaLocal", "não relata"],
      ["../fora/tests/X.cs", "InformaTituloNoFormulario", "fora do projeto"],
      [`/${ARQUIVO_DE_TESTE}`, "InformaTituloNoFormulario", "fora do projeto"],
      [".capivara/flows/tests/x.cs", "InformaTituloNoFormulario", "do harness"],
    ];
    for (const [arquivo, teste, motivo] of casos) {
      const conferido = await conferirProvas(projectRoot, { ...FLUXO, steps: ["Um passo."] }, { provas: [{ passo: 1, arquivo, teste }] }, SUITE, TESTES_OK);
      expect(conferido.provas, `${arquivo} :: ${teste}`).toEqual([]);
      expect(conferido.semProva[0]?.motivo, `${arquivo} :: ${teste}`).toContain(motivo);
    }
  });

  it("nenhum falso PASS: o relatório decide — pulado, falho, ausente, de outra classe, comentário, string ou atributo não provam", async () => {
    await writeFile(
      join(projectRoot, "tests/Agenda.Tests/Enganos.cs"),
      [
        "namespace Agenda.Tests;",
        "[Ignore(\"quebrado\")]",
        "public class Enganos",
        "    : BaseDeTeste",
        "{",
        "    // InformaTituloNoComentario deveria existir",
        "    private const string Texto = \"SalvaNaString\";",
        "#if INTEGRACAO",
        "    [Fact]",
        "    public void SoNaIntegracao() { }",
        "#endif",
        "    [Fact(Skip = \"quebrado\")]",
        "    public void PuladoComSkip() { }",
        "    [Fact]",
        "    public void Compila() { }",
        "    public void AjudanteSemAtributo() { }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    const relatorio = new Map([
      ["Agenda.Tests.Enganos.Compila", true],
      ["Agenda.Tests.Enganos.PuladoComSkip", false],
      ["Agenda.Tests.Enganos.SoNaIntegracao", false],
      ["Agenda.Tests.OutraClasse.AjudanteSemAtributo", true],
    ]);
    for (const nome of ["Enganos", "Fact", "InformaTituloNoComentario", "SalvaNaString", "PuladoComSkip", "SoNaIntegracao", "AjudanteSemAtributo", "public void", "Agenda.Tests.OutraClasse.Compila"]) {
      const conferido = await conferirProvas(projectRoot, { ...FLUXO, steps: ["Um passo."] }, { provas: [{ passo: 1, arquivo: "tests/Agenda.Tests/Enganos.cs", teste: nome }] }, SUITE, relatorio);
      expect(conferido.provas, nome).toEqual([]);
    }
    // O que o relatório diz que rodou e passou vale, com a classe declarada no arquivo citado.
    const aprovado = await conferirProvas(projectRoot, { ...FLUXO, steps: ["Um passo."] }, { provas: [{ passo: 1, arquivo: "tests/Agenda.Tests/Enganos.cs", teste: "Compila" }] }, SUITE, relatorio);
    expect(aprovado.semProva).toEqual([]);
    // Sem relatório (a suíte não disse o que rodou), nada vale.
    const semRelatorio = await conferirProvas(projectRoot, { ...FLUXO, steps: ["Um passo."] }, { provas: [{ passo: 1, arquivo: "tests/Agenda.Tests/Enganos.cs", teste: "Compila" }] }, SUITE, null);
    expect(semRelatorio.semProva[0]?.motivo).toContain("não relatou");
  });

  it("nenhum falso PASS: documento, dado, dependência, ambiente virtual e link para fora não são a suíte", async () => {
    const fora = await mkdtemp(join(tmpdir(), "capivara-134-fora-"));
    await writeFile(join(fora, "OutroTests.cs"), "public class OutroTests { [Fact] public void Salva() { } }\n", "utf8");
    await mkdir(join(projectRoot, "tests/ext"), { recursive: true });
    await symlink(join(fora, "OutroTests.cs"), join(projectRoot, "tests/ext/OutroTests.cs"));
    const relatorio = new Map([["Agenda.Tests.OutroTests.Salva", true]]);
    for (const arquivo of ["tests/ext/OutroTests.cs", "tests/fixtures/agenda.json", "tests/README.md", "web/node_modules/lib/test/OutroTests.cs", "sub/.capivara/flows/OutroTests.cs", ".venv/lib/site-packages/x/tests/OutroTests.cs", "api/vendor/x/tests/OutroTests.cs"]) {
      const conferido = await conferirProvas(projectRoot, { ...FLUXO, steps: ["Um passo."] }, { provas: [{ passo: 1, arquivo, teste: "Salva" }] }, SUITE, relatorio);
      expect(conferido.provas, arquivo).toEqual([]);
    }
    await rm(fora, { recursive: true, force: true });
  });

  it.each([
    ["pytest", "tests/test_agenda.py", "test_salva"],
    ["Go", "pkg/agenda_test.go", "TestSalva"],
    ["Vitest com `test.skip()` no corpo", "tests/agenda.test.ts", "salva o compromisso"],
    ["JUnit", "src/test/java/AgendaTest.java", "salva"],
    ["Rust", "tests/agenda.rs", "salva"],
    ["PHPUnit", "tests/AgendaTest.php", "testSalva"],
    ["RSpec", "spec/agenda_spec.rb", "salva o compromisso"],
  ])("outras suítes (%s): sem relatório por teste do runner, a citação é recusada com o motivo, nunca aprovada", async (_suite, arquivo, teste) => {
    await mkdir(join(projectRoot, arquivo, ".."), { recursive: true });
    await writeFile(join(projectRoot, arquivo), `${teste}\n`, "utf8");
    const conferido = await conferirProvas(projectRoot, { ...FLUXO, steps: ["Um passo."] }, { provas: [{ passo: 1, arquivo, teste }] }, "npm test", TESTES_OK);
    expect(conferido.provas).toEqual([]);
    expect(conferido.semProva[0]?.motivo).toContain("não relata, teste a teste");
  });

  it("sem a suíte verde neste código, nenhuma citação vale", async () => {
    const conferido = await conferirProvas(projectRoot, FLUXO, {
      provas: [
        { passo: 1, arquivo: ARQUIVO_DE_TESTE, teste: "InformaTituloNoFormulario" },
        { passo: 2, arquivo: ARQUIVO_DE_TESTE, teste: "SalvaCompromissoNaAgendaLocal" },
      ],
    }, null, TESTES_OK);
    expect(conferido.provas).toEqual([]);
    expect(conferido.semProva.map((passo) => passo.passo)).toEqual([1, 2]);
    expect(conferido.semProva[0]?.motivo).toContain("suíte");
  });

  it("o passo sem teste fica nomeado, com o motivo do roteirista; o provado fica provado", async () => {
    const conferido = await conferirProvas(projectRoot, FLUXO, {
      provas: [{ passo: 1, arquivo: ARQUIVO_DE_TESTE, teste: "InformaTituloNoFormulario" }],
      semProva: [{ passo: 2, motivo: "nenhum teste grava e relê o compromisso" }],
    }, SUITE, TESTES_OK);
    expect(conferido.provas.map((prova) => prova.passo)).toEqual([1]);
    expect(conferido.semProva).toEqual([{ passo: 2, motivo: "nenhum teste grava e relê o compromisso" }]);
    // Sem citação nem motivo, o passo também fica nomeado.
    const nada = await conferirProvas(projectRoot, FLUXO, {}, SUITE, TESTES_OK);
    expect(nada.semProva.map((passo) => passo.passo)).toEqual([1, 2]);
    expect(nada.semProva[0]?.motivo).toContain("nenhum teste");
  });
});

// ------------------------------------------------------------------ o build inteiro

async function escreverStack(linhas: string[]): Promise<void> {
  await writeFile(join(projectRoot, ".capivara", "init", "skeleton.md"), `# Agenda — Skeleton\n\n## Stack\n${linhas.map((linha) => `- ${linha}`).join("\n")}\n`, "utf8");
}

/**
 * A P01 de fundação e a P02 com os fluxos, como no Luna. `p03` acrescenta a fase
 * que cobre esses fluxos (de novo, ou pela primeira vez); os da P02 são os outros.
 */
async function publicar(stack: string | string[], fluxos: SkeletonWorkflow[] = [FLUXO], p03?: SkeletonWorkflow[], p03DependeDe = 2): Promise<Skeleton> {
  const linhas = typeof stack === "string" ? [stack] : stack;
  const refaz = p03 !== undefined;
  const daP03 = (p03 ?? []).map((workflow) => `workflow ${workflow.number}`);
  const cobertos = fluxos.filter((workflow) => !(p03 ?? []).includes(workflow) || p03?.length === fluxos.length).map((workflow) => `workflow ${workflow.number}`);
  const fase = (numero: number, titulo: string, goal: string, cobre: string[], task: string, criterio: string): string[] => [
    `## Phase ${numero}: ${titulo}`,
    "",
    `**Goal:** ${goal} · **Depends on:** ${numero === 1 ? "none" : `Phase ${numero === 3 ? p03DependeDe : numero - 1}`} · **Covers:** ${cobre.join(", ")}`,
    "",
    `- [ ] **Task:** ${task}`,
    "  - **Acceptance criteria:**",
    `    - ${criterio}`,
    `  - **Traces:** ${cobre.join(" / ")}`,
    "",
  ];
  const plano = [
    "# Agenda — Project Phases",
    "",
    "<!-- inputs: skeleton.md@sha256:aaaaaaaaaaaa -->",
    "",
    "## Overview",
    "",
    "Persistência e calendário.",
    "",
    ...fase(1, "Persistência", "Guardar compromissos localmente.", ["US-1.1"], "Em `src/dados.txt`, guardar compromissos.", "Compromissos persistem entre reinícios."),
    ...fase(2, "Calendário e cadastro", "Apresentar o calendário e cadastrar compromissos.", ["US-1.2", ...cobertos], "Na inicialização, apresentar o calendário e conectar o cadastro.", "Após cadastrar, o calendário indica o dia do compromisso."),
    ...(refaz ? fase(3, "Edição", "Editar compromissos.", ["US-1.3", ...daP03], "Na tela do dia, abrir e editar o compromisso.", "Depois de editar, o compromisso aparece com o título novo.") : []),
    "## Open Questions",
    "",
    "Nenhuma.",
    "",
  ].join("\n");
  await escreverStack(linhas);
  await writeFile(join(projectRoot, ".capivara", "init", "project-phases.md"), plano, "utf8");
  await certifyCurrentPlan(projectRoot);
  await git(["add", "-A"]);
  await git(["commit", "-q", "-m", "docs: plano"]);
  return {
    contract: "capivara-skeleton/v2",
    projectName: "Agenda",
    stack: linhas.map((linha) => ({ component: "interface", decision: linha })),
    environment: [],
    entities: [],
    stories: [],
    workflows: fluxos,
    rules: [],
    phases: [
      { number: 1, title: "Persistência", goal: "Guardar compromissos localmente.", dependsOn: "none", covers: ["US-1.1"], areas: ["backend"], taskCount: 1 },
      { number: 2, title: "Calendário e cadastro", goal: "Apresentar o calendário e cadastrar compromissos.", dependsOn: "Phase 1", covers: ["US-1.2", ...cobertos], areas: ["frontend"], taskCount: 1 },
      ...(refaz ? [{ number: 3, title: "Edição", goal: "Editar compromissos.", dependsOn: `Phase ${p03DependeDe}`, covers: ["US-1.3", ...daP03], areas: ["frontend"], taskCount: 1 }] : []),
    ],
    mvpCutPhase: refaz ? 3 : 2,
  };
}

type Roteirista = (prompt: string, vez: number, fase: string) => string;
const ROTEIRISTA = "You write ONE Playwright script";

/** O provider falso. O executor da P02 escreve, além do código, os testes da suíte que o plano manda escrever. */
function motor(
  roteirista: Roteirista,
  opcoes: { testes?: boolean; startWeb?: boolean; apagaTestesNa?: string; projetoDeTeste?: boolean; apagaProjetoNa?: string; triagem?: string; demoraNa?: string; reparoDaAceitacao?: (raiz: string) => Promise<void> } = {},
) {
  const chamadas: EngineCall[] = [];
  let vezes = 0;
  const call = async (chamada: EngineCall): Promise<EngineResult> => {
    chamadas.push(chamada);
    const ok = (stdout: string): EngineResult => ({ exitCode: 0, stdout, stderr: "", timedOut: null });
    if (chamada.role === "verifier") {
      if (chamada.prompt.includes(ROTEIRISTA)) return ok(roteirista(chamada.prompt, ++vezes, chamada.phase.id));
      if (chamada.prompt.includes("CAPIVARA_TRIAGE") && opcoes.triagem !== undefined) return ok(opcoes.triagem);
      return ok("TASK 1: DONE");
    }
    const raiz = chamada.root ?? projectRoot;
    if (chamada.prompt.includes("but the product failed operational")) {
      await opcoes.reparoDaAceitacao?.(raiz);
      return ok("corrigido");
    }
    if (opcoes.demoraNa === chamada.phase.id) await new Promise((resolve) => setTimeout(resolve, 1500));
    if (opcoes.startWeb === true && !(await readFile(join(raiz, "package.json"), "utf8").then(() => true, () => false))) {
      await writeFile(join(raiz, "package.json"), JSON.stringify({ name: "agenda", scripts: { start: "node server.js" } }), "utf8");
    }
    if (opcoes.testes !== false && chamada.phase.id === "P02") {
      await mkdir(join(raiz, "tests/Agenda.Tests"), { recursive: true });
      await writeFile(join(raiz, ARQUIVO_DE_TESTE), TESTES_CS, "utf8");
    }
    if (opcoes.apagaTestesNa === chamada.phase.id) await rm(join(raiz, ARQUIVO_DE_TESTE), { force: true });
    if (opcoes.projetoDeTeste === true && chamada.phase.id === "P02") {
      await writeFile(join(raiz, "tests/Agenda.Tests/Agenda.Tests.csproj"), '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>\n', "utf8");
    }
    if (opcoes.apagaProjetoNa === chamada.phase.id) await rm(join(raiz, "tests/Agenda.Tests/Agenda.Tests.csproj"), { force: true });
    await writeFile(join(raiz, `${chamada.phase.id.toLowerCase()}-${chamada.attempt}-${chamadas.length}.txt`), `${chamada.phase.id}\n`, "utf8");
    return ok("feito");
  };
  return { call, chamadas };
}

function corredor(resposta: (scripts: string[], vez: number) => { exitCode: number; output: string } = (scripts) => ({ exitCode: 0, output: `${scripts.length} passed` })) {
  const passagens: string[][] = [];
  const configs: string[] = [];
  const runner: NonNullable<BuildOptions["flowRunner"]> = async (raiz, scripts) => {
    passagens.push([...scripts]);
    configs.push(await readFile(join(raiz, FLOWS_DIR, FLOW_CONFIG), "utf8").catch(() => ""));
    return resposta(scripts, passagens.length);
  };
  return { runner, passagens, configs };
}

async function construir(
  esqueleto: Skeleton,
  engine: ReturnType<typeof motor>,
  flowRunner: NonNullable<BuildOptions["flowRunner"]>,
  extra: Partial<BuildOptions> = {},
  /** O comando da suíte; `null` é o projeto sem suíte que o harness rode. */
  suite: string | null = SUITE_DOTNET,
  /** O que o relatório da suíte diz; ausente, os dois testes do arquivo citado passaram. */
  relatorio?: [string, string, string][],
) {
  const anuncios: string[] = [];
  const suites: string[] = [];
  const outcome = await runBuild({
    projectRoot,
    language: "português do Brasil",
    engine: "codex",
    call: engine.call,
    sleep: async () => undefined,
    environment: { XDG_CACHE_HOME: cache },
    skipAcceptance: true,
    ...(suite !== null ? { explicitTestCommand: suite } : {}),
    testRunner: async (comando, cwd) => {
      suites.push(comando);
      // O `dotnet test` do harness grava o relatório: os testes que o arquivo citado declara rodaram e passaram.
      if (comando.includes(RESULTADOS_DOTNET) && (await readFile(join(cwd, ARQUIVO_DE_TESTE), "utf8").then(() => true, () => false))) {
        await mkdir(join(cwd, RESULTADOS_DOTNET), { recursive: true });
        const declarado = /LogFileName=([^";]+)/u.exec(comando)?.[1] ?? "agenda.trx";
        // Sem relatório dado, o que o arquivo declara: cada `[Fact]` roda e passa; `Skip` não roda.
        const doArquivo = [...(await readFile(join(cwd, ARQUIVO_DE_TESTE), "utf8")).matchAll(/\[Fact([^\]]*)\]\s*public (?:async Task|void) (\w+)/gu)]
          .map((casou): [string, string, string] => ["Agenda.Tests.AgendaTests", casou[2]!, /Skip/u.test(casou[1] ?? "") ? "NotExecuted" : "Passed"]);
        await writeFile(join(cwd, RESULTADOS_DOTNET, declarado), trx(relatorio ?? doArquivo), "utf8");
      }
      return { exitCode: 0, output: "1 passed" };
    },
    skeleton: esqueleto,
    flowRunner,
    announce: (mensagem) => anuncios.push(mensagem),
    ...extra,
  });
  return { outcome, anuncios, suites };
}

const roteiristas = (engine: ReturnType<typeof motor>): EngineCall[] => engine.chamadas.filter((chamada) => chamada.prompt.includes(ROTEIRISTA));

async function historico(runId: string) {
  return [...(await LivroDeEvidencias.abrir(runPaths(projectRoot, runId).root, runId)).historico()];
}

describe("§134 · desktop: a suíte do projeto conclui o fluxo que nenhum navegador percorre", () => {
  it("4, 8 — com todos os passos provados por testes que a suíte rodou, o build conclui sem abrir navegador", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(() => PROVADO);
    // O Playwright não está aqui, e não precisa estar: nenhum navegador abre.
    const { outcome, anuncios } = await construir(esqueleto, engine, async () => {
      throw new Error("nenhum navegador deveria abrir");
    });
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(roteiristas(engine)).toHaveLength(1);
    // O roteirista soube qual é a suíte e que ela roda.
    expect(roteiristas(engine)[0]?.prompt).toContain(`\`${SUITE_DOTNET}\``);
    // Nenhum servidor, nenhum ciclo de correção.
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder").every((chamada) => chamada.attempt === 1)).toBe(true);
    await expect(readFile(join(projectRoot, "package.json"), "utf8")).rejects.toThrow();

    const provas = await historico(outcome.runId);
    const suite = provas.filter((evidencia) => evidencia.phaseId === "P02" && evidencia.checkId === "suite").at(-1)!;
    const fluxo = provas.filter((evidencia) => evidencia.checkId === "fluxo-1").at(-1)!;
    expect(fluxo.outcome).toBe("PASS");
    expect(fluxo.inputs.extra?.["marca"]).toBe(MARCA_PROVA_PELA_SUITE);
    expect(fluxo.supports).toEqual([suite.evidenceId]);
    expect(fluxo.claim).toContain(`passo 1 — ${ARQUIVO_DE_TESTE} :: InformaTituloNoFormulario`);
    expect(fluxo.inputs.documents.some((doc) => doc.name === `teste:${ARQUIVO_DE_TESTE}`)).toBe(true);
    // O G4 do navegador não se aplicou: o registro "fora do navegador" continua, e não diz pendente.
    const fora = provas.filter((evidencia) => evidencia.checkId === "fora-do-navegador-1").at(-1)!;
    expect(fora.outcome).toBe("NOT_APPLICABLE");
    expect(fora.claim).not.toContain("obrigação pendente");
    expect((await lerFasesFechadas(projectRoot)).find((fase) => fase.id === "P02")?.foraDoNavegador).toEqual([
      {
        workflow: "1",
        trecho: DESKTOP,
        provas: [
          { passo: 1, arquivo: ARQUIVO_DE_TESTE, teste: "InformaTituloNoFormulario" },
          { passo: 2, arquivo: ARQUIVO_DE_TESTE, teste: "SalvaCompromissoNaAgendaLocal" },
        ],
      },
    ]);
  }, 60_000);

  it("5, 7 — compilar, abrir e a suíte verde não provam o fluxo: sem teste citado, os passos ficam pendentes e nomeados", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(() => SO_A_MARCA);
    const { outcome, anuncios } = await construir(esqueleto, engine, corredor().runner);
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"]]);
    expect(outcome.exitCode).toBe(2);
    const erro = outcome.errors.join("\n");
    expect(erro).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
    expect(erro).toContain("sem prova executada: passo 1");
    expect(erro).toContain("passo 2");
    const provas = await historico(outcome.runId);
    expect(provas.some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.outcome === "PASS")).toBe(false);
    expect(provas.filter((evidencia) => evidencia.checkId === "fora-do-navegador-1").at(-1)?.claim).toContain("obrigação pendente");
  }, 60_000);

  it("9, 15 — sem suíte que o harness rode, a citação não vale: pendente, sem ciclo novo nem pedido ao executor", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(() => PROVADO);
    const { outcome, anuncios, suites } = await construir(esqueleto, engine, corredor().runner, {}, null);
    expect(suites).toEqual([]);
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"]]);
    expect(engine.chamadas.filter((chamada) => chamada.role === "builder").every((chamada) => chamada.attempt === 1)).toBe(true);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("suíte");
    expect((await historico(outcome.runId)).some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.outcome === "PASS")).toBe(false);
    // O roteirista soube que não há suíte: nenhum passo se prova por teste aqui.
    expect(roteiristas(engine)[0]?.prompt).toContain("no suite the harness can run");
  }, 60_000);

  it("9 — a citação de teste que não existe não conclui nada", async () => {
    const esqueleto = await publicar(DESKTOP);
    const engine = motor(() => PROVADO, { testes: false });
    const { outcome } = await construir(esqueleto, engine, corredor().runner);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("não existe");
  }, 60_000);

  it("14 — retomar o build concluído não pergunta de novo nem perde a prova", async () => {
    const esqueleto = await publicar(DESKTOP);
    const primeira = await construir(esqueleto, motor(() => PROVADO), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(0);
    const segunda = motor(() => PROVADO);
    const { outcome } = await construir(esqueleto, segunda, corredor().runner);
    expect(outcome.exitCode).toBe(0);
    expect(roteiristas(segunda)).toHaveLength(0);
  }, 90_000);

  it("retomável: a fase com passo pendente volta a ser verificada na execução seguinte e conclui quando o teste existe", async () => {
    const esqueleto = await publicar(DESKTOP);
    // Primeira execução: o executor não escreveu testes; o roteirista diz que nenhum exercita os passos.
    const semTeste = `${SO_A_MARCA}\n${SEM_PROVA}: passo 1 — a suíte não tem teste do formulário\n${SEM_PROVA}: passo 2 — nenhum teste grava o compromisso`;
    const primeira = await construir(esqueleto, motor(() => semTeste, { testes: false }), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(2);
    expect(primeira.outcome.errors.join("\n")).toContain("nenhum teste grava o compromisso");

    // Sem nada novo, retomar não gasta sessão: a mesma resposta vale para o mesmo código.
    const igual = motor(() => semTeste, { testes: false });
    const repetida = await construir(esqueleto, igual, corredor().runner);
    expect(repetida.outcome.exitCode).toBe(2);
    expect(roteiristas(igual)).toHaveLength(0);

    // O teste passa a existir no projeto: a fase volta a ser verificada, sem implementação, e o fluxo conclui.
    await mkdir(join(projectRoot, "tests/Agenda.Tests"), { recursive: true });
    await writeFile(join(projectRoot, ARQUIVO_DE_TESTE), TESTES_CS, "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "test: o cadastro"]);
    const terceira = motor(() => PROVADO, { testes: false });
    const { outcome, anuncios } = await construir(esqueleto, terceira, corredor().runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(roteiristas(terceira)).toHaveLength(1);
    expect(terceira.chamadas.filter((chamada) => chamada.role === "builder")).toEqual([]);
    expect(anuncios.join("\n")).toContain("volta a ser verificada");
  }, 150_000);

  it("13 — o registro da 0.7.8 (sem provas) é lido como pendente e reavaliado uma vez com o protocolo novo", async () => {
    const esqueleto = await publicar(DESKTOP);
    const primeira = await construir(esqueleto, motor(() => SO_A_MARCA), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(2);
    // Como a 0.7.8 gravava: a decisão no livro sem as provas.
    const arquivo = join(runPaths(projectRoot, primeira.outcome.runId).root, "evidence.jsonl");
    const linhas = (await readFile(arquivo, "utf8")).split("\n").filter((linha) => linha.trim() !== "").map((linha) => {
      const registro = JSON.parse(linha) as { kind: string; checkId?: string; inputs?: { extra?: Record<string, string> } };
      if (registro.kind === "evidence" && registro.checkId === "fora-do-navegador-1" && registro.inputs?.extra) {
        delete registro.inputs.extra["provas"];
        delete registro.inputs.extra["semProva"];
      }
      return JSON.stringify(registro);
    });
    await writeFile(arquivo, `${linhas.join("\n")}\n`, "utf8");
    const segunda = motor(() => PROVADO);
    const { outcome, anuncios } = await construir(esqueleto, segunda, corredor().runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(roteiristas(segunda)).toHaveLength(1);
  }, 120_000);

  it("9 — o teste citado que some depois da prova não deixa o fluxo cumprido", async () => {
    const esqueleto = await publicar(DESKTOP);
    const primeira = await construir(esqueleto, motor(() => PROVADO), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(0);
    await rm(join(projectRoot, ARQUIVO_DE_TESTE));
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: testes removidos"]);
    const { outcome } = await construir(esqueleto, motor(() => PROVADO, { testes: false }), corredor().runner);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain(ARQUIVO_DE_TESTE);
  }, 120_000);

  it("a fase que cobre de novo um fluxo provado pela suíte pode tirá-lo do navegador outra vez", async () => {
    const esqueleto = await publicar(DESKTOP, [FLUXO], [FLUXO]);
    const engine = motor(() => PROVADO);
    const { outcome, anuncios } = await construir(esqueleto, engine, corredor().runner);
    expect(outcome.phases.map((fase) => [fase.id, fase.outcome.status]), anuncios.join("\n")).toEqual([["P01", "complete"], ["P02", "complete"], ["P03", "complete"]]);
    expect(outcome.exitCode).toBe(0);
  }, 90_000);

  it("12 — no paralelo, a mesma prova conclui o fluxo", async () => {
    const esqueleto = await publicar(DESKTOP);
    await writeFile(join(projectRoot, ".gitignore"), ".capivara/runs/\n.capivara/flows/resultados/\n", "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: ignorar runs"]);
    const engine = motor(() => PROVADO);
    const { outcome, anuncios } = await construir(esqueleto, engine, corredor().runner, {
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: [],
      },
    });
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect((await historico(outcome.runId)).filter((evidencia) => evidencia.checkId === "fluxo-1").at(-1)?.inputs.extra?.["marca"]).toBe(MARCA_PROVA_PELA_SUITE);
  }, 120_000);
});

describe("§134 · CLI: o fluxo de terminal é percorrido por comandos e resultados", () => {
  it("6, 3 — sem `start`, sem servidor e sem navegador: o roteiro de comandos roda e o build conclui", async () => {
    const esqueleto = await publicar(CLI, [EXPORTAR]);
    const engine = motor(() => roteiroDeTerminal(EXPORTAR), { testes: false });
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens).toEqual([["workflow-2.spec.ts"]]);
    expect(fluxos.configs[0]).not.toContain("webServer");
    expect(anuncios.join("\n")).not.toContain("não sabe como subir");
    await expect(readFile(join(projectRoot, "package.json"), "utf8")).rejects.toThrow();
    const fluxo = (await historico(outcome.runId)).filter((evidencia) => evidencia.checkId === "fluxo-2").at(-1);
    expect(fluxo?.outcome).toBe("PASS");
    expect(fluxo?.inputs.extra?.["marca"]).toBe(FLOW_MARK);
  }, 60_000);
});

describe("§134 · revalidação proporcional e o controle web", () => {
  it("10 — depois de um reparo, a prova pela suíte é reconferida pelo Core, sem nova sessão do roteirista", async () => {
    const esqueleto = await publicar([DESKTOP, PAINEL_WEB], [FLUXO, EXPORTAR]);
    const engine = motor((prompt) => (prompt.includes(`workflow 2: ${EXPORTAR.name}`) ? roteiroWeb(EXPORTAR) : PROVADO), { startWeb: true });
    // A exportação falha uma vez (defeito do produto); o executor corrige; a segunda passagem passa.
    const fluxos = corredor((scripts, vez) =>
      vez === 1
        ? { exitCode: 1, output: "  ✘  1 [workflow-2] › workflow-2.spec.ts:4:1 › workflow 2\n  1) [workflow-2] › workflow-2.spec.ts:4:1 › passo 1: O usuário pede a exportação.\n  1 failed" }
        : { exitCode: 0, output: `${scripts.length} passed` },
    );
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens.length).toBe(2);
    const doFluxo1 = roteiristas(engine).filter((chamada) => chamada.prompt.includes(`workflow 1: ${FLUXO.name}`));
    expect(doFluxo1).toHaveLength(1);
    const provas = (await historico(outcome.runId)).filter((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.outcome === "PASS");
    expect(provas.length).toBe(2);
    expect(provas[0]?.inputs.code?.tree).not.toBe(provas[1]?.inputs.code?.tree);
  }, 90_000);

  it("1 — controle: o produto web continua sendo percorrido no navegador e concluindo", async () => {
    const esqueleto = await publicar(WEB);
    const engine = motor((prompt) => roteiroWeb(prompt.includes(`workflow 1: ${FLUXO.name}`) ? FLUXO : EXPORTAR), { startWeb: true, testes: false });
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(fluxos.passagens).toEqual([["workflow-1.spec.ts"]]);
    expect(fluxos.configs[0]).toContain("webServer: {");
    const fluxo = (await historico(outcome.runId)).filter((evidencia) => evidencia.checkId === "fluxo-1").at(-1);
    expect(fluxo?.inputs.extra?.["marca"]).toBe(FLOW_MARK);
  }, 60_000);

  it("2 — controle: o produto web com defeito real não conclui", async () => {
    const esqueleto = await publicar(WEB);
    const engine = motor((prompt) => roteiroWeb(prompt.includes(`workflow 1: ${FLUXO.name}`) ? FLUXO : EXPORTAR), { startWeb: true, testes: false });
    const fluxos = corredor(() => ({ exitCode: 1, output: "  ✘  1 [workflow-1] › workflow-1.spec.ts:3:1 › workflow 1\n  1) [workflow-1] › workflow-1.spec.ts:3:1 › passo 1: O usuário informa o título.\n  1 failed" }));
    const { outcome } = await construir(esqueleto, engine, fluxos.runner, { maxCycles: 1 });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.phases.find((fase) => fase.id === "P02")?.outcome.status).toBe("failed");
    expect((await historico(outcome.runId)).some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.outcome === "PASS")).toBe(false);
  }, 90_000);
});

describe("§134 · revisão adversarial: o que a primeira rodada deixava aberto", () => {
  it("híbrido: o fluxo provado pela suíte não vira regressão percorrida, e o teste apagado numa fase seguinte derruba a prova", async () => {
    const esqueleto = await publicar([DESKTOP, PAINEL_WEB], [FLUXO, EXPORTAR], [EXPORTAR]);
    const engine = motor((prompt) => (prompt.includes(`workflow 2: ${EXPORTAR.name}`) ? roteiroWeb(EXPORTAR) : PROVADO), { apagaTestesNa: "P03", startWeb: true });
    const fluxos = corredor();
    const { outcome, anuncios } = await construir(esqueleto, engine, fluxos.runner);
    expect(fluxos.passagens, anuncios.join("\n")).toEqual([["workflow-2.spec.ts"]]);
    const provas = await historico(outcome.runId);
    // Nenhum PASS de percurso para o fluxo que nenhum roteiro percorreu.
    expect(provas.some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.inputs.extra?.["marca"] === FLOW_MARK)).toBe(false);
    // O roteirista do fluxo 2 não é mandado ler um roteiro que não existe.
    const doFluxo2 = roteiristas(engine).find((chamada) => chamada.prompt.includes(`workflow 2: ${EXPORTAR.name}`));
    expect(doFluxo2?.prompt).not.toContain("workflow-1.spec.ts");
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain(ARQUIVO_DE_TESTE);
  }, 120_000);

  it("sem `start`, a reescrita que passa a abrir página cobra o entrypoint, em vez de culpar o produto", async () => {
    let vez = 0;
    const resultado = await gate4({
      projectRoot, workflows: [EXPORTAR], startCommand: null, contratoCertificado: `## Stack\n- ${WEB}`,
      author: async () => (++vez === 1 ? roteiroDeTerminal(EXPORTAR) : roteiroWeb(EXPORTAR)),
      runner: async () => ({ exitCode: 1, output: "  1) [workflow-2] › workflow-2.spec.ts:4:1 › passo 1\n    ReferenceError: sufo is not defined\n  1 failed" }),
    });
    if (resultado.green) throw new Error("não pode passar");
    expect(resultado.cause).toContain("não sabe como subir a aplicação");
  });

  it("os sinais de página sem fixture desestruturada pedem o servidor", () => {
    expect(roteiroUsaOServidor("test('w', async () => { const base = test.info().project.use.baseURL; await fetch(`${base}/api`); });")).toBe(true);
    expect(roteiroUsaOServidor("import { request as api } from '@playwright/test';\ntest('w', async () => { const c = await api.newContext(); });")).toBe(true);
    expect(roteiroUsaOServidor("let tela;\ntest.beforeAll(async (f) => { tela = await f.browser.newPage(); });\ntest('w', async () => { await tela.goto('/'); });")).toBe(true);
  });

  it("o roteiro de terminal com URL de entrada, apóstrofo no título, opções ou `function` não pede servidor", () => {
    const passo = "{ await test.step('passo 1: x', async () => { const r = await comandoDoProjeto('feeds', ['add', 'https://example.com/rss']); expect(r.codigo).toBe(0); }); }";
    expect(roteiroUsaOServidor(`test('workflow 2 — agenda', async () => ${passo});`)).toBe(false);
    expect(roteiroUsaOServidor(`test('workflow 2 — Export user\\'s agenda', async () => ${passo});`)).toBe(false);
    expect(roteiroUsaOServidor(`test('workflow 2', { timeout: 300_000 }, async () => ${passo});`)).toBe(false);
    expect(roteiroUsaOServidor(`test('workflow 2', async function () ${passo});`)).toBe(false);
  });

  it("o G2 não desce no subprojeto de outro ecossistema", async () => {
    await mkdir(join(projectRoot, "outro/tests/X.Tests"), { recursive: true });
    await writeFile(join(projectRoot, "outro/package.json"), "{}", "utf8");
    await writeFile(join(projectRoot, "outro/tests/X.Tests/X.Tests.csproj"), '<Project><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>', "utf8");
    expect(await resolveTestCommand(projectRoot, { environment: {} })).toBeNull();
  });

  it("o nome do teste que falhou não atravessa linhas", () => {
    expect(testesQueFalharam("\n\nFailed asserting [1, 2] contains 3.")).toEqual([]);
  });
});

describe("§134 · revisão adversarial: aprovações falsas que a primeira rodada permitia", () => {
  const provadoCom = (linha: string): string => PROVADO.replace(`${FORA_DO_NAVEGADOR}: ${DESKTOP}`, `${FORA_DO_NAVEGADOR}: ${linha}`);

  it("o produto web que cita a própria linha do navegador não sai do percurso nem vira PASS pela suíte", async () => {
    const esqueleto = await publicar(WEB);
    const engine = motor(() => provadoCom(WEB), { startWeb: true });
    const fluxos = corredor();
    const { outcome } = await construir(esqueleto, engine, fluxos.runner, { maxCycles: 1 });
    const provas = await historico(outcome.runId);
    expect(provas.some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.inputs.extra?.["marca"] === MARCA_PROVA_PELA_SUITE)).toBe(false);
    expect(provas.some((evidencia) => evidencia.checkId.startsWith("fora-do-navegador-"))).toBe(false);
    expect(outcome.exitCode).toBe(2);
  }, 90_000);

  it("o fluxo que avançou passos no navegador não sai dele pela marca na reescrita", async () => {
    // Uma linha que a regra das palavras não reconhece: quem segura é o avanço no navegador.
    const LINHA = "Interface: Elm com componentes próprios";
    let vez = 0;
    const resultado = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: `## Stack\n- ${LINHA}`,
      author: async () => (++vez === 1 ? roteiroWeb(FLUXO) : `${FORA_DO_NAVEGADOR}: ${LINHA}`),
      triagem: async () => ["CAPIVARA_TRIAGEM: ROTEIRO", "CAPIVARA_EVIDENCIA: o seletor do botão salvar", "CAPIVARA_ONDE: passo 2", "CAPIVARA_CRITERIO: task 1", "CAPIVARA_CORRECAO: usar o nome acessível"].join("\n"),
      runner: async () => ({
        exitCode: 1,
        output: "  ✘  1 [workflow-1] › workflow-1.spec.ts:3:1 › workflow 1\n  1) [workflow-1] › workflow-1.spec.ts:3:1 › passo 2: A aplicação salva o compromisso.\n    waiting for getByRole('button')\n  1 failed",
      }),
    });
    if (resultado.green) throw new Error("o fluxo que reprovou no navegador não pode sair dele");
    expect(resultado.naoPercorridos ?? []).toEqual([]);
    expect(resultado.abertos).toEqual(["1"]);
    // Numa passagem seguinte da fase, a mesma regra vale pelo que o runner guardou.
    const seguinte = await gate4({
      projectRoot, workflows: [FLUXO], startCommand: "npm start", contratoCertificado: `## Stack\n- ${LINHA}`, jaAbertos: ["1"],
      roteiroContestado: "o produto não é web", roteirosQueFalharam: ["1"],
      author: async () => `${FORA_DO_NAVEGADOR}: ${LINHA}`,
      runner: async () => ({ exitCode: 1, output: "  1) [workflow-1] › workflow-1.spec.ts:3:1 › passo 2: A aplicação salva o compromisso.\n  1 failed" }),
    });
    expect(seguinte.naoPercorridos ?? []).toEqual([]);
  });

  it("reescrever o histórico não deixa o PASS de uma fase anterior esconder a pendência da mais nova", async () => {
    const esqueleto = await publicar(DESKTOP, [FLUXO], [FLUXO]);
    const roteirista: Roteirista = (_prompt, _vez, fase) => (fase === "P03" ? `${SO_A_MARCA}\n${SEM_PROVA}: passo 1 — nenhum teste\n${SEM_PROVA}: passo 2 — nenhum teste` : PROVADO);
    const primeira = await construir(esqueleto, motor(roteirista), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(2);
    const raiz = await git(["rev-list", "--max-parents=0", "HEAD"]);
    await git(["reset", "--soft", raiz]);
    await git(["commit", "-q", "-m", "feat: tudo junto"]);
    const { outcome, anuncios } = await construir(esqueleto, motor(roteirista), corredor().runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(2);
    expect(outcome.errors.join("\n")).toContain("o fluxo 1 (Cadastrar compromisso) não foi percorrido");
  }, 150_000);

  it("a suíte que deixa de existir numa fase seguinte derruba a prova do fluxo", async () => {
    const esqueleto = await publicar(DESKTOP, [FLUXO], []);
    const engine = motor(() => PROVADO, { projetoDeTeste: true, apagaProjetoNa: "P03" });
    const { outcome, anuncios, suites } = await construir(esqueleto, engine, corredor().runner, {}, null);
    expect(suites, anuncios.join("\n")).toContain(SUITE_DOTNET);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("a suíte do projeto não passou nele");
  }, 120_000);
});

describe("§134 · segunda revisão adversarial", () => {
  it("a linha que diz web, site ou HTML é de navegador; WPF e Qt com páginas continuam desktop", () => {
    expect(linhaDeNavegador("Interface: aplicação web em React servida pelo próprio servidor Node")).toBe(true);
    expect(linhaDeNavegador("Interface: site em HTML e CSS servido pelo Express")).toBe(true);
    expect(linhaDeNavegador(WEB)).toBe(true);
    expect(linhaDeNavegador("Interface: aplicativo WPF com navegação entre páginas")).toBe(false);
    expect(linhaDeNavegador("Interface: Qt 6 com páginas de configuração")).toBe(false);
    expect(linhaDeNavegador(DESKTOP)).toBe(false);
    expect(linhaDeNavegador("Exportação: programa de terminal, sem interface web")).toBe(false);
    // Terceira revisão: as linhas web que a regra deixava passar.
    for (const linha of [
      "Interface: aplicação web acessada no navegador de qualquer dispositivo",
      "Interface: SPA responsiva (mobile-first)",
      "Interface: aplicação web com painel admin e CLI de manutenção",
      "Interface: aplicação web; relatórios gerados com biblioteca de PDF",
      "Interface: React (Vite) acessada em localhost:5173",
      "Interface: WebApp em Next.js",
      "Interface: dashboard acessado pelo Chrome",
      "Interface: front end em Vue",
      "Interface: React 19 com Vite e componentes próprios",
    ]) expect(linhaDeNavegador(linha), linha).toBe(true);
    for (const linha of ["Interface: React Native para Android e iOS", "Interface: aplicativo desktop Electron com React", "Interface: Tauri com Svelte"]) {
      expect(linhaDeNavegador(linha), linha).toBe(false);
    }
  });

  it("nenhum caractere de controle nos fontes (um `\\b` gravado como byte desligava a regra do navegador)", async () => {
    const raiz = join(__dirname, "../../src");
    const arquivos: string[] = [];
    const visitar = async (pasta: string): Promise<void> => {
      for (const entrada of await readdir(pasta, { withFileTypes: true })) {
        if (entrada.isDirectory()) await visitar(join(pasta, entrada.name));
        else if (entrada.name.endsWith(".ts")) arquivos.push(join(pasta, entrada.name));
      }
    };
    await visitar(raiz);
    const comControle: string[] = [];
    for (const arquivo of arquivos) if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(await readFile(arquivo, "utf8"))) comControle.push(arquivo);
    expect(comControle).toEqual([]);
  });

  it.each([
    ["Interface: aplicação web em React servida pelo próprio servidor Node"],
    ["Interface: site em HTML e CSS servido pelo Express"],
  ])("build: a linha web «%s» não tira o fluxo do navegador", async (linha) => {
    const esqueleto = await publicar(linha);
    const engine = motor(() => PROVADO.replace(`${FORA_DO_NAVEGADOR}: ${DESKTOP}`, `${FORA_DO_NAVEGADOR}: ${linha}`), { startWeb: true });
    const { outcome } = await construir(esqueleto, engine, corredor().runner, { maxCycles: 1 });
    expect((await historico(outcome.runId)).some((evidencia) => evidencia.inputs.extra?.["marca"] === MARCA_PROVA_PELA_SUITE)).toBe(false);
    expect(outcome.exitCode).toBe(2);
  }, 90_000);

  it("build: o teste citado que o runner pulou não prova o fluxo, mesmo declarado com [Fact]", async () => {
    const esqueleto = await publicar(DESKTOP);
    const { outcome } = await construir(esqueleto, motor(() => PROVADO), corredor().runner, {}, SUITE_DOTNET, [
      ["Agenda.Tests.AgendaTests", "InformaTituloNoFormulario", "Passed"],
      ["Agenda.Tests.AgendaTests", "SalvaCompromissoNaAgendaLocal", "NotExecuted"],
    ]);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.errors.join("\n")).toContain("pulado ou falho");
    expect((await historico(outcome.runId)).some((evidencia) => evidencia.inputs.extra?.["marca"] === MARCA_PROVA_PELA_SUITE)).toBe(false);
  }, 90_000);

  it("a classe só conta declarada como código no arquivo citado; o método também", () => {
    const relatorio = new Map([["Agenda.Tests.AgendaTests.Salva", true], ["Agenda.Tests.Outra.Salva", true]]);
    const arquivo = ["namespace Agenda.Tests;", "public class AgendaTests", "{", "    [AvaloniaFact]", "    public void Salva() { }", "}"].join("\n");
    expect(testeDotnetAprovado(arquivo, "cs", "Salva", relatorio)).toBeNull();
    expect(testeDotnetAprovado(arquivo, "cs", "Agenda.Tests.AgendaTests.Salva", relatorio)).toBeNull();
    expect(testeDotnetAprovado(arquivo, "cs", "Agenda.Tests.Outra.Salva", relatorio)).not.toBeNull();
    expect(testeDotnetAprovado("// public class AgendaTests { public void Salva() { } }\n", "cs", "Salva", relatorio)).not.toBeNull();
    expect(testeDotnetAprovado("var s = @\"public class AgendaTests { void Salva() }\";\n", "cs", "Salva", relatorio)).not.toBeNull();
    // A classe homônima de outro namespace é outro teste — inclusive o namespace filho: o pulado daqui não vira aprovado pelo de lá.
    const homonimas = new Map([["Agenda.Tests.AgendaTests.Salva", false], ["Agenda.Tests.Integracao.AgendaTests.Salva", true], ["Outro.AgendaTests.Salva", true]]);
    const semNamespace = arquivo.replace("namespace Agenda.Tests;\n", "");
    expect(testeDotnetAprovado(arquivo, "cs", "Salva", homonimas)).not.toBeNull();
    expect(testeDotnetAprovado(`namespace Outro\n{\n${semNamespace}\n}`, "cs", "Salva", homonimas)).toBeNull();
    // Sem namespace no arquivo é o global, que o relatório não traz aqui.
    expect(testeDotnetAprovado(semNamespace, "cs", "Salva", homonimas)).not.toBeNull();
    // Classe aninhada: o relatório a escreve com `+`.
    const aninhada = ["namespace Agenda.Tests;", "public class Externa", "{", "    public class Aninhada", "    {", "        [Fact] public void Salva() { }", "    }", "}"].join("\n");
    expect(testeDotnetAprovado(aninhada, "cs", "Salva", new Map([["Agenda.Tests.Externa+Aninhada.Salva", true]]))).toBeNull();
    // F#: o módulo com namespace é a classe do relatório.
    expect(testeDotnetAprovado("module Agenda.Fs.CadastroTests\n\n[<Fact>]\nlet ``salva o compromisso`` () = ()\n", "fs", "``salva o compromisso``", new Map([["Agenda.Fs.CadastroTests.salva o compromisso", true]]))).toBeNull();
    // VB e F# também: a classe e o método são lidos do código, e o relatório decide.
    expect(testeDotnetAprovado("Public Class AgendaTests\n    <Fact>\n    Public Sub Salva()\n    End Sub\nEnd Class\n", "vb", "Salva", relatorio)).toBeNull();
    expect(testeDotnetAprovado("type AgendaTests() =\n    [<Fact>]\n    member _.Salva() = ()\n", "fs", "Salva", relatorio)).toBeNull();
  });

  it("o fluxo que avançou passos no terminal não sai dele pela marca", async () => {
    let vez = 0;
    const resultado = await gate4({
      projectRoot, workflows: [{ ...EXPORTAR, steps: ["O usuário pede a exportação.", "O arquivo exportado aparece."] }], startCommand: null, contratoCertificado: `## Stack\n- ${CLI}`,
      author: async (workflow) => (++vez === 1 ? roteiroDeTerminal(workflow) : `${FORA_DO_NAVEGADOR}: ${CLI}\n${PROVA}: passo 1 — ${ARQUIVO_DE_TESTE} :: InformaTituloNoFormulario`),
      triagem: async () => ["CAPIVARA_TRIAGEM: ROTEIRO", "CAPIVARA_EVIDENCIA: o código de saída", "CAPIVARA_ONDE: passo 2", "CAPIVARA_CRITERIO: task 1", "CAPIVARA_CORRECAO: conferir o arquivo"].join("\n"),
      runner: async () => ({ exitCode: 1, output: "  1) [workflow-2] › workflow-2.spec.ts:4:1 › passo 2: O arquivo exportado aparece.\n    Expected: 0\n    Received: 3\n  1 failed" }),
    });
    expect(resultado.naoPercorridos ?? []).toEqual([]);
    expect(resultado.abertos).toEqual(["2"]);
  });

  it("o CLI que recebe um endereço de banco local não pede servidor; HTTP local pede", () => {
    const passo = (argumento: string): string => `test('workflow 2', async () => { await test.step('passo 1: x', async () => { const r = await comandoDoProjeto('agenda', ['exportar', '${argumento}']); expect(r.codigo).toBe(0); }); });`;
    expect(roteiroUsaOServidor(passo("postgres://localhost/agenda"))).toBe(false);
    expect(roteiroUsaOServidor(passo("http://127.0.0.1:8080/api"))).toBe(true);
  });

  it("paralelo: a prova da suíte da fase irmã não derruba o fluxo provado; vale a suíte no código entregue", async () => {
    const esqueleto = await publicar(DESKTOP, [FLUXO], [], 1);
    await writeFile(join(projectRoot, ".gitignore"), ".capivara/runs/\n.capivara/flows/resultados/\n", "utf8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "agenda", scripts: { start: "dotnet run --project src/Agenda" } }), "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: base"]);
    const engine = motor(() => PROVADO, { projetoDeTeste: true, demoraNa: "P03" });
    const { outcome, anuncios } = await construir(esqueleto, engine, corredor().runner, {
      parallel: {
        maxConcurrency: 2,
        agentes: [
          { engine: "codex", label: "codex", systemInstall: false },
          { engine: "codex", label: "codex", systemInstall: false },
        ],
        resumo: [],
      },
    }, null);
    expect(outcome.exitCode, `${anuncios.join("\n")}\n${outcome.errors.join("\n")}`).toBe(0);
  }, 150_000);
});

describe("§134 · quarta revisão: o relatório do runner e o que ainda o contornava", () => {
  it("roteiro de terminal num produto que não é de terminal: o gate sobe o servidor como sempre, e o roteiro que roda a suíte é recusado", async () => {
    expect(stackDeTerminal(`## Stack\n- ${DESKTOP}`)).toBe(false);
    expect(stackDeTerminal(`## Stack\n- ${CLI}`)).toBe(true);
    const comSuite = "test('w', async () => {\n  await test.step('passo 1: O usuário pede a exportação.', async () => {\n    const r = await comandoDoProjeto('dotnet', ['test', 'tests/Agenda.Tests/Agenda.Tests.csproj', '--filter', 'FullyQualifiedName~Cadastro']);\n    expect(r.codigo, r.saida).toBe(0);\n  });\n});";
    expect(checkFlowScript(comSuite, EXPORTAR).map((defeito) => defeito.problem)).toContain("o roteiro roda a suíte de testes do projeto em vez de percorrer o fluxo");
    for (const outro of ["comandoDoProjeto('npm', ['test'])", "comandoDoProjeto('python3', ['-m', 'pytest'])", "comandoDoProjeto('go', ['test', './...'])", "comandoDoProjeto('pytest')"]) {
      expect(checkFlowScript(`test('w', async () => { await test.step('passo 1: O usuário pede a exportação.', async () => { const r = await ${outro}; expect(r.codigo).toBe(0); }); });`, EXPORTAR).some((defeito) => defeito.problem.includes("suíte de testes")), outro).toBe(true);
    }
    // O roteiro de comandos num desktop não dispensa o servidor: sem `start`, o entrypoint continua cobrado, como antes da §134.
    let config = "";
    const resultado = await gate4({
      projectRoot, workflows: [EXPORTAR], startCommand: "npm start", contratoCertificado: `## Stack\n- ${DESKTOP}`,
      author: async () => roteiroDeTerminal(EXPORTAR),
      runner: async (raiz) => {
        config = await readFile(join(raiz, FLOWS_DIR, FLOW_CONFIG), "utf8");
        return { exitCode: 0, output: "1 passed" };
      },
    });
    expect(resultado.green).toBe(true);
    expect(config).toContain("webServer: {");
  });

  it("a linha de navegador: o navegador declarado vence; a web embutida e o nativo de verdade não são navegador", () => {
    for (const linha of [
      "Interface: Blazor Server em .NET 10",
      "Interface: aplicação ASP.NET Core acessada pelo navegador no desktop e no celular",
      "Interface: PWA instalável em Android e iOS",
      "Interface: React com janelas modais",
      "Interface: web com suporte nativo a modo escuro",
      "Interface: painel em Streamlit",
    ]) expect(linhaDeNavegador(linha), linha).toBe(true);
    for (const linha of [
      DESKTOP,
      "Interface: aplicativo desktop, sem navegador",
      "Exportação: programa de terminal, sem interface web",
      "Interface: .NET MAUI Blazor Hybrid para Windows e Android",
      "Interface: aplicativo mobile para iPhone com páginas de cadastro",
      "Interface: SwiftUI para iPhone e iPad, com páginas de perfil",
      "Interface: jogo em Godot com menu de páginas",
      "Interface: painel em dispositivo edge Raspberry Pi",
      "Interface: app para tablet da recepção do spa",
      "Interface: aplicativo desktop Electron com React",
    ]) expect(linhaDeNavegador(linha), linha).toBe(false);
  });

  it("o arquivo fora dos projetos de teste que a suíte rodou não prova, mesmo com o mesmo nome aprovado", async () => {
    await mkdir(join(projectRoot, "tests/Legacy"), { recursive: true });
    await writeFile(join(projectRoot, "tests/Legacy/AgendaTests.cs"), TESTES_CS, "utf8");
    const recusa = await conferirCitacao(projectRoot, { passo: 1, arquivo: "tests/Legacy/AgendaTests.cs", teste: "InformaTituloNoFormulario" }, TESTES_OK, SUITE_DOTNET);
    expect(recusa).toContain("fora dos projetos de teste");
  });

  it("Microsoft.Testing.Platform: o G2 roda com `--project`, sem relatório; a citação fica pendente, nunca o G2 quebrado", async () => {
    await mkdir(join(projectRoot, "tests/Agenda.Tests"), { recursive: true });
    await writeFile(join(projectRoot, "tests/Agenda.Tests/Agenda.Tests.csproj"), '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>\n', "utf8");
    await writeFile(join(projectRoot, "global.json"), JSON.stringify({ test: { runner: "Microsoft.Testing.Platform" } }), "utf8");
    expect((await resolveTestCommand(projectRoot, { environment: {} }))?.command).toBe("dotnet test --project tests/Agenda.Tests/Agenda.Tests.csproj");
  });

  it("só o relatório que o comando declara conta: o `.trx` que um teste escrevesse na pasta não é do runner", async () => {
    await mkdir(join(projectRoot, RESULTADOS_DOTNET), { recursive: true });
    await writeFile(join(projectRoot, RESULTADOS_DOTNET, "falso.trx"), trx([["Agenda.Tests.AgendaTests", "Forjado", "Passed"]]), "utf8");
    expect(await lerResultadosDotnet(projectRoot, SUITE_DOTNET)).toBeNull();
  });

  it("a prova que a guarda derruba vira pendência gravada: a execução seguinte reabre a fase e conclui com o teste novo", async () => {
    const esqueleto = await publicar(DESKTOP);
    const primeira = await construir(esqueleto, motor(() => PROVADO), corredor().runner);
    expect(primeira.outcome.exitCode).toBe(0);
    // Depois da entrega, o teste citado muda de nome.
    await writeFile(join(projectRoot, ARQUIVO_DE_TESTE), TESTES_CS.replace("SalvaCompromissoNaAgendaLocal", "GravaCompromissoNaAgendaLocal"), "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "test: renomeia"]);
    const segunda = await construir(esqueleto, motor(() => PROVADO, { testes: false }), corredor().runner);
    expect(segunda.outcome.exitCode).toBe(2);
    expect(segunda.outcome.errors.join("\n")).toContain("SalvaCompromissoNaAgendaLocal");
    // O registro da fase perdeu as provas do fluxo: ela é pendente agora.
    expect((await lerFasesFechadas(projectRoot)).find((fase) => fase.id === "P02")?.foraDoNavegador).toEqual([{ workflow: "1", trecho: DESKTOP }]);
    const terceira = motor(() => PROVADO.replace("SalvaCompromissoNaAgendaLocal", "GravaCompromissoNaAgendaLocal"), { testes: false });
    const { outcome, anuncios } = await construir(esqueleto, terceira, corredor().runner);
    expect(outcome.exitCode, anuncios.join("\n")).toBe(0);
    expect(roteiristas(terceira)).toHaveLength(1);
    expect(terceira.chamadas.filter((chamada) => chamada.role === "builder")).toEqual([]);
  }, 180_000);

  it("o reparo da aceitação que pula o teste citado não entrega o fluxo como provado", async () => {
    const esqueleto = await publicar(DESKTOP);
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ name: "agenda", scripts: { start: "node server.js" } }), "utf8");
    await git(["add", "-A"]);
    await git(["commit", "-q", "-m", "chore: start"]);
    const engine = motor(() => PROVADO, {
      reparoDaAceitacao: async (raiz) => {
        await writeFile(join(raiz, "server.js"), "// de pé\n", "utf8");
        const atual = await readFile(join(raiz, ARQUIVO_DE_TESTE), "utf8");
        await writeFile(join(raiz, ARQUIVO_DE_TESTE), atual.replace("[Fact]\n    public async Task SalvaCompromissoNaAgendaLocal", "[Fact(Skip = \"instável\")]\n    public async Task SalvaCompromissoNaAgendaLocal"), "utf8");
      },
    });
    const { outcome, anuncios } = await construir(esqueleto, engine, corredor().runner, {
      skipAcceptance: false,
      acceptanceRunner: async () => ({ exitCode: 0, output: "ok" }),
      acceptanceService: async () => ((await readFile(join(projectRoot, "server.js"), "utf8").then(() => true, () => false)) ? { exitCode: 0, output: "de pé" } : { exitCode: 1, output: "Error: Cannot find module 'server.js'" }),
    });
    expect(outcome.exitCode, anuncios.join("\n")).toBe(2);
    expect(outcome.errors.join("\n")).toContain("depois do reparo da aceitação");
    expect(outcome.errors.join("\n")).toContain("pulado ou falho");
  }, 180_000);
});

describe("§134 · quinta revisão: as heurísticas de texto e o produto híbrido", () => {
  it("«no navegador» é navegador; o toolkit nativo que consome uma API web não é", () => {
    for (const linha of [
      "Interface: aplicação MVC em .NET 8 acessada no navegador",
      "Interface: aplicação acessada no navegador",
      "Interface: Angular usado no navegador do celular",
      "Interface: Vue 3 acessada no navegador do computador e do celular",
      "Interface: painel administrativo usado no browser",
      "Interface: sistema usado no navegador, sem login",
      "Interface: Spring MVC com JSP",
      "Interface: Express com Handlebars",
      "Interface: demonstração em Gradio",
      "Interface: Preact com componentes próprios",
    ]) expect(linhaDeNavegador(linha), linha).toBe(true);
    for (const linha of ["Interface: aplicativo WPF que consome a API ASP.NET Core", "Interface: app iOS nativo com login pelo Safari"]) {
      expect(linhaDeNavegador(linha), linha).toBe(false);
    }
  });

  it("build: a linha «acessada no navegador» não tira o fluxo do navegador", async () => {
    const linha = "Interface: aplicação MVC em .NET 8 acessada no navegador";
    const esqueleto = await publicar(linha);
    const engine = motor(() => PROVADO.replace(`${FORA_DO_NAVEGADOR}: ${DESKTOP}`, `${FORA_DO_NAVEGADOR}: ${linha}`), { startWeb: true });
    const { outcome } = await construir(esqueleto, engine, corredor().runner, { maxCycles: 1 });
    expect((await historico(outcome.runId)).some((evidencia) => evidencia.inputs.extra?.["marca"] === MARCA_PROVA_PELA_SUITE)).toBe(false);
    expect(outcome.exitCode).toBe(2);
  }, 90_000);

  it("só o produto puramente de terminal roda roteiro sem servidor; o híbrido roda como antes", () => {
    expect(stackDeTerminal(`## Stack\n- ${CLI}`)).toBe(true);
    expect(stackDeTerminal(`## Stack\n- ${CLI}\n- Banco de dados: SQLite em arquivo local`)).toBe(true);
    expect(stackDeTerminal(`## Stack\n- ${DESKTOP}\n- Exportação: programa de linha de comando para backup`)).toBe(false);
    expect(stackDeTerminal(`## Stack\n- ${WEB}\n- Migrações: EF Core pela linha de comando`)).toBe(false);
    expect(stackDeTerminal("## Stack\n- Interface: Angular\n- Build: Angular CLI")).toBe(false);
    expect(stackDeTerminal(`## Stack\n- ${DESKTOP}\n- Logs: estruturados no console`)).toBe(false);
  });

  it("build híbrido desktop + CLI: o fluxo da janela não é «percorrido» por comandos", async () => {
    const esqueleto = await publicar([DESKTOP, "Exportação: programa de linha de comando para backup"]);
    const porComandos = roteiroDeTerminal(FLUXO).replace(/comandoDoProjeto\('python3', \['-m', 'agenda', 'exportar'\]\)/gu, "comandoDoProjeto('agenda', ['cadastrar', 'Reunião'])");
    const fluxos = corredor();
    const { outcome } = await construir(esqueleto, motor(() => porComandos), fluxos.runner, { maxCycles: 1 });
    expect(fluxos.configs.every((config) => config.includes("webServer: {") || config === "")).toBe(true);
    expect((await historico(outcome.runId)).some((evidencia) => evidencia.checkId === "fluxo-1" && evidencia.outcome === "PASS")).toBe(false);
    expect(outcome.exitCode).toBe(2);
  }, 90_000);

  it("build web com uma linha de CLI na Stack: sem `start`, o entrypoint continua cobrado, como antes da §134", async () => {
    const esqueleto = await publicar([WEB, "Migrações: EF Core pela linha de comando"]);
    const porComandos = roteiroDeTerminal(FLUXO).replace(/comandoDoProjeto\('python3', \['-m', 'agenda', 'exportar'\]\)/gu, "comandoDoProjeto('node', ['scripts/cadastrar.js'])");
    const { outcome, anuncios } = await construir(esqueleto, motor(() => porComandos, { testes: false }), corredor().runner, { maxCycles: 1 });
    expect(outcome.exitCode).toBe(2);
    expect(anuncios.join("\n")).toContain("não sabe como subir a aplicação");
  }, 90_000);

  it("o roteiro que roda a suíte por qualquer porta é recusado; o subcomando `test` do produto não é a suíte", () => {
    const passo = (chamada: string): string => `test('w', async () => { await test.step('passo 1: O usuário pede a exportação.', async () => { const r = await ${chamada}; expect(r.codigo).toBe(0); }); });`;
    const suite = (script: string): boolean => checkFlowScript(script, EXPORTAR).some((defeito) => defeito.problem.includes("suíte de testes"));
    for (const chamada of [
      "comandoDoProjeto('bash', ['-c', 'dotnet test tests/Agenda.Tests/Agenda.Tests.csproj --filter Cadastro'])",
      "comandoDoProjeto('sh', ['-c', 'npm test'])",
      "comandoDoProjeto('make', ['test'])",
      "comandoDoProjeto('npm', ['t'])",
      "comandoDoProjeto('npm', ['run', 'test:unit'])",
      "comandoDoProjeto('cargo', ['t'])",
      "comandoDoProjeto('dotnet', ['vstest', 'Agenda.Tests.dll'])",
      "comandoDoProjeto('dotnet', ['run', '--project', 'tests/Agenda.Tests'])",
      "comandoDoProjeto('./build.sh', ['test'])",
    ]) expect(suite(passo(chamada)), chamada).toBe(true);
    for (const chamada of [
      "comandoDoProjeto('python3', ['-m', 'validador', 'test', 'config.yml'])",
      "comandoDoProjeto('dotnet', ['run', '--project', 'src/Cli', '--', 'test', 'conexao.json'])",
      "comandoDoProjeto('go', ['run', './cmd/apicheck', 'test', 'api.yaml'])",
      "comandoDoProjeto('bash', ['install.sh'])",
      "comandoDoProjeto('agenda', ['importar', 'tests/fixtures/agenda.csv'])",
    ]) expect(suite(passo(chamada)), chamada).toBe(false);
  });

  it("o `global.json` com comentário, BOM ou numa pasta acima também escolhe o Microsoft.Testing.Platform", async () => {
    const projeto = join(projectRoot, "app");
    await mkdir(join(projeto, "tests/A.Tests"), { recursive: true });
    await writeFile(join(projeto, "tests/A.Tests/A.Tests.csproj"), '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>\n', "utf8");
    const esperado = "dotnet test --project tests/A.Tests/A.Tests.csproj";
    for (const conteudo of ['{\n  // MTP\n  "test": { "runner": "Microsoft.Testing.Platform", },\n}', '﻿{ "test": { "runner": "Microsoft.Testing.Platform" } }']) {
      await writeFile(join(projeto, "global.json"), conteudo, "utf8");
      expect((await resolveTestCommand(projeto, { environment: {} }))?.command, conteudo).toBe(esperado);
    }
    await rm(join(projeto, "global.json"));
    await writeFile(join(projectRoot, "global.json"), '{ "test": { "runner": "Microsoft.Testing.Platform" } }', "utf8");
    expect((await resolveTestCommand(projeto, { environment: {} }))?.command).toBe(esperado);
  });

  it("namespaces aninhados em bloco compõem o nome do relatório; `./` no comando não muda o projeto", async () => {
    const arquivo = ["namespace Agenda", "{", "    namespace Tests", "    {", "        public class AgendaTests", "        {", "            [Fact] public void Salva() { }", "            public class Interna", "            {", "                [Fact] public void Edita() { }", "            }", "        }", "    }", "}"].join("\n");
    const relatorio = new Map([["Agenda.Tests.AgendaTests.Salva", true], ["Agenda.Tests.AgendaTests+Interna.Edita", true]]);
    expect(testeDotnetAprovado(arquivo, "cs", "Salva", relatorio)).toBeNull();
    expect(testeDotnetAprovado(arquivo, "cs", "Edita", relatorio)).toBeNull();
    await mkdir(join(projectRoot, "tests/Agenda.Tests"), { recursive: true });
    await writeFile(join(projectRoot, ARQUIVO_DE_TESTE), TESTES_CS, "utf8");
    const comPonto = comandoDotnet("tests/Agenda.Tests/Agenda.Tests.csproj", "./tests/Agenda.Tests/Agenda.Tests.csproj");
    expect(await conferirCitacao(projectRoot, { passo: 1, arquivo: ARQUIVO_DE_TESTE, teste: "InformaTituloNoFormulario" }, TESTES_OK, comPonto)).toBeNull();
  });
});
