/**
 * O gate 4 — o que o §28 dizia que faltava.
 *
 * O que se testa aqui não é o navegador: é a disciplina em volta dele. Um gate
 * que deixa um modelo escrever a própria prova precisa conferir a prova antes de
 * rodá-la, e precisa rodar o que sobrou pelo processo, não pela palavra de quem
 * escreveu.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FLOWS_DIR,
  FLOW_CONFIG,
  FLOW_PORT,
  checkFlowScript,
  ehFalhaDoRoteiro,
  faltaORunner,
  flowScriptName,
  gate4,
  portaLivre,
  renderFlowConfig,
} from "../../src/loop/index.js";
import { FLOW_MARK } from "../../src/loop/flows.js";
import { FLOW_HELPER, bancosDeclarados, ferramentasDaMaquina } from "../../src/loop/passagem.js";
import { flowPrompt } from "../../src/prompts/index.js";
import type { FlowRun } from "../../src/loop/index.js";
import type { SkeletonWorkflow } from "../../src/contract/index.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "capivara-fluxos-"));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

const WORKFLOW: SkeletonWorkflow = {
  number: "2",
  name: "Interpretar uma linha cron",
  steps: ["o usuário cola a linha no campo", "clica em Interpretar", "lê a explicação de cada campo"],
};

function roteiroBom(workflow: SkeletonWorkflow = WORKFLOW): string {
  const passos = workflow.steps
    .map(
      (step, index) =>
        `  await test.step('passo ${index + 1}: ${step}', async () => {\n` +
        `    await page.goto('/');\n    expect(await page.title()).toBeTruthy();\n  });`,
    )
    .join("\n");
  return `import { expect, test } from '@playwright/test';\n\ntest('workflow ${workflow.number}', async ({ page }) => {\n${passos}\n});`;
}

const verde: FlowRun = { exitCode: 0, output: "3 passed" };

describe("a conferência do roteiro, antes de abrir navegador nenhum", () => {
  it("aceita o roteiro que cita todo passo e afirma algo em cada um", () => {
    expect(checkFlowScript(roteiroBom(), WORKFLOW)).toEqual([]);
  });

  it("recusa o passo que ficou de fora, nomeando qual", () => {
    const semOUltimo = roteiroBom({ ...WORKFLOW, steps: WORKFLOW.steps.slice(0, 2) });
    const defeitos = checkFlowScript(semOUltimo, WORKFLOW);
    expect(defeitos.map((d) => d.problem).join(" ")).toContain("passo 3");
  });

  /*
   * O run de `teste` no WSL: o roteirista escreveu oitenta linhas antes do
   * primeiro passo, subindo um segundo servidor e consultando com fetch até
   * responder. Esse servidor morria, e o gate relatava "O servidor de teste
   * encerrou antes de abrir a página" — mensagem do próprio roteiro, sobre um
   * processo que o harness nem sabia que existia.
   */
  it("recusa o roteiro que sobe a própria aplicação", () => {
    const comServidor = `import { spawn } from 'node:child_process';\n${roteiroBom()}`;
    const defeitos = checkFlowScript(comServidor, WORKFLOW);
    expect(defeitos.map((defeito) => defeito.problem).join(" ")).toContain("sobe a própria aplicação");
    expect(defeitos.map((defeito) => defeito.hint).join(" ")).toContain("JÁ ESTÁ DE PÉ");
  });

  it("recusa o roteiro que escolhe onde a aplicação está", () => {
    const comUrl = roteiroBom().replace("page.goto('/')", "page.goto('http://127.0.0.1:3000/clientes')");
    expect(checkFlowScript(comUrl, WORKFLOW).map((defeito) => defeito.problem).join(" ")).toContain("escolhe onde");

    const comFetch = `${roteiroBom()}\nawait fetch('http://localhost:4000/pronto');`;
    expect(checkFlowScript(comFetch, WORKFLOW).map((defeito) => defeito.problem).join(" ")).toContain("escolhe onde");
  });

  it("não confunde uma URL de terceiro com a da aplicação", () => {
    const externo = roteiroBom().replace("page.goto('/')", "page.goto('/')\n    // ver https://exemplo.com/docs");
    expect(checkFlowScript(externo, WORKFLOW)).toEqual([]);
  });

  it("recusa o roteiro que só clica", () => {
    const semExpect = roteiroBom().replace(/\s*expect\(await page\.title\(\)\)\.toBeTruthy\(\);/g, "");
    const defeitos = checkFlowScript(semExpect, WORKFLOW);
    expect(defeitos.map((d) => d.problem).join(" ")).toContain("expect");
  });

  it("recusa o teste desligado", () => {
    const pulado = roteiroBom().replace("test('workflow", "test.skip('workflow");
    expect(checkFlowScript(pulado, WORKFLOW).map((d) => d.problem).join(" ")).toContain("test.skip");
  });

  /*
   * Interceptar a própria API é a forma mais fácil de fazer o gate passar sem
   * exercitar nada: a tela responde a respostas inventadas pelo próprio roteiro.
   */
  it("recusa o roteiro que responde pelo backend do produto", () => {
    const mockado = roteiroBom().replace(
      "await page.goto('/');",
      "await page.route('**/api/interpretar', (r) => r.fulfill({ body: '{}' }));\n    await page.goto('/');",
    );
    expect(checkFlowScript(mockado, WORKFLOW).map((d) => d.problem).join(" ")).toContain("intercepta o backend");
  });

  it("tolera acento, caixa e pontuação no texto do passo", () => {
    const comVariacao = roteiroBom().replace("passo 2: clica em Interpretar", "Passo 2 — Clica em interpretar.");
    expect(checkFlowScript(comVariacao, WORKFLOW)).toEqual([]);
  });

  it("o nome do arquivo sobrevive a um número com ponto", () => {
    expect(flowScriptName("2")).toBe("workflow-2.spec.ts");
    expect(flowScriptName("2.1")).toBe("workflow-2.1.spec.ts");
  });
});

describe("a configuração é do harness, nunca do modelo", () => {
  it("fixa a porta, o comando de subida e proíbe only", () => {
    const config = renderFlowConfig({ startCommand: "npm run build && npm start", port: 4001 });
    expect(config).toContain('"npm run build && npm start"');
    expect(config).toContain("http://127.0.0.1:4001");
    expect(config).toContain("forbidOnly: true");
    expect(config).toContain("reuseExistingServer: false");
  });

  /*
   * O gate percorre o produto como ele é. Forçar NODE_ENV=test era uma suposição
   * sobre o produto alheio: no MCP_teste a aplicação trocava de banco ao ver essa
   * variável, exigia outra que ninguém definiu, não subia — e o executor levou a
   * culpa por uma configuração nossa.
   */
  it("não impõe modo de teste à aplicação", () => {
    const config = renderFlowConfig({ startCommand: "npm start", port: 4001 });
    expect(config).not.toContain("NODE_ENV");
    // PORT e HOST ficam: são convenção de quem sobe processo, não opinião sobre o produto.
    expect(config).toContain("PORT: '4001'");
    expect(config).toContain("HOST: '127.0.0.1'");
  });
});

describe("o gate", () => {
  const base = { projectRoot: "", workflows: [WORKFLOW], startCommand: "npm start" };

  it("manda escrever o roteiro que falta, grava e roda", async () => {
    let pedidos = 0;
    const rodados: string[][] = [];
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => {
        pedidos += 1;
        return `segue o roteiro:\n\n\`\`\`ts\n${roteiroBom()}\n\`\`\``;
      },
      runner: async (_root, scripts) => {
        rodados.push(scripts);
        return verde;
      },
    });

    expect(resultado.green).toBe(true);
    expect(pedidos).toBe(1);
    expect(rodados[0]).toEqual(["workflow-2.spec.ts"]);
    const gravado = await readFile(join(projectRoot, FLOWS_DIR, "workflow-2.spec.ts"), "utf8");
    expect(gravado).toContain("passo 3: lê a explicação de cada campo");
    // A configuração é reescrita a cada passagem: o comando de subida pode mudar.
    expect(await readFile(join(projectRoot, FLOWS_DIR, FLOW_CONFIG), "utf8")).toContain("npm start");
  });

  it("devolve os defeitos ao autor e aceita o roteiro corrigido", async () => {
    const recebidos: string[][] = [];
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async (workflow, rejected) => {
        recebidos.push(rejected);
        // A primeira volta esquece o último passo; a segunda entrega tudo.
        const roteiro = rejected.length === 0 ? roteiroBom({ ...workflow, steps: workflow.steps.slice(0, 1) }) : roteiroBom(workflow);
        return `\`\`\`ts\n${roteiro}\n\`\`\``;
      },
      runner: async () => verde,
    });

    expect(resultado.green).toBe(true);
    expect(recebidos).toHaveLength(2);
    expect(recebidos[1]?.join(" ")).toContain("passo 2");
  });

  it("desiste depois das tentativas e diz o que faltou, sem abrir a aplicação", async () => {
    let rodou = false;
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => "não vou escrever roteiro nenhum",
      runner: async () => {
        rodou = true;
        return verde;
      },
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.cause).toContain("não passou na conferência estrutural");
    expect(rodou, "roteiro reprovado não chega a rodar").toBe(false);
  });

  it("não reescreve o roteiro que já existe e está íntegro", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-2.spec.ts"), `${FLOW_MARK}\n${roteiroBom()}\n`, "utf8");

    let pedidos = 0;
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => {
        pedidos += 1;
        return "";
      },
      runner: async () => verde,
    });

    expect(resultado.green).toBe(true);
    expect(pedidos, "o roteiro íntegro não custa uma sessão").toBe(0);
  });

  /*
   * A regressão é o que faz o gate valer nas fases seguintes: o fluxo da fase 2
   * continua sendo percorrido na fase 5, e um defeito introduzido lá aparece lá.
   */
  it("percorre também os fluxos das fases anteriores", async () => {
    const anterior = { ...WORKFLOW, number: "1" };
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), roteiroBom(anterior), "utf8");

    const rodados: string[][] = [];
    const resultado = await gate4({
      ...base,
      projectRoot,
      regressao: [anterior],
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async (_root, scripts) => {
        rodados.push(scripts);
        return verde;
      },
    });

    expect(resultado.green).toBe(true);
    expect(rodados[0]).toEqual(["workflow-1.spec.ts", "workflow-2.spec.ts"]);
  });

  /*
   * O defeito que travou a fase 1 do MCP_teste. Roteiros de um build anterior
   * ficaram na pasta e passaram a ser cobrados de uma fase de banco e infra, que
   * nunca prometeu tela nenhuma — e, pior, eram de um esqueleto que já não
   * existia. A fase nunca teria como passar.
   */
  it("roteiro órfão na pasta não é cobrado de quem não o prometeu", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-9.spec.ts"), roteiroBom({ ...WORKFLOW, number: "9" }), "utf8");

    let rodou = false;
    const resultado = await gate4({
      projectRoot,
      workflows: [],
      regressao: [],
      startCommand: "npm start",
      author: async () => "",
      runner: async () => {
        rodou = true;
        return verde;
      },
    });

    expect(resultado.green).toBe(true);
    if (resultado.green) expect(resultado.skipped).toContain("não declara fluxos");
    expect(rodou, "fase sem fluxo não abre a aplicação").toBe(false);
  });

  it("com fluxo próprio, o órfão continua de fora", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-9.spec.ts"), roteiroBom({ ...WORKFLOW, number: "9" }), "utf8");

    const rodados: string[][] = [];
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async (_root, scripts) => {
        rodados.push(scripts);
        return verde;
      },
    });

    expect(resultado.green).toBe(true);
    expect(rodados[0]).toEqual(["workflow-2.spec.ts"]);
  });

  it("reprova quando a aplicação não cumpre o fluxo, com a saída do roteiro", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: "1) passo 2: clica em Interpretar\n   botão não encontrado" }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.cause).toContain("não cumpriu um fluxo declarado");
    expect(resultado.cause).toContain("botão não encontrado");
  });

  /*
   * O run de `teste` no WSL: a aplicação subiu, respondeu a cada requisição com
   * erro, e todo passo do roteiro morreu esperando um campo que a página nunca
   * renderizou. O relatório acusou o seletor, e o executor foi consertar um
   * formulário que estava certo.
   */
  it("reescreve o roteiro guardado que não passa mais na conferência", async () => {
    // O roteiro do run anterior, com o servidor que o roteirista subiu sozinho.
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    const arquivo = join(projectRoot, FLOWS_DIR, flowScriptName(WORKFLOW.number));
    await writeFile(arquivo, `import { spawn } from 'node:child_process';\n${roteiroBom()}\n`, "utf8");

    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => verde,
    });

    expect(resultado.green).toBe(true);
    expect(await readFile(arquivo, "utf8")).not.toContain("child_process");
  });

  it("põe o erro da APLICAÇÃO antes do seletor, quando o servidor registrou algum", async () => {
    const saida = [
      "  ✘  1 workflow-2.spec.ts:3:1 › workflow 2 — Cadastro de filmes (1.0m)",
      "    Error: locator.fill: Test timeout of 60000ms exceeded.",
      "      - waiting for getByLabel(/^Título/)",
      "[WebServer] ⨯ Error: DB_NAME deve indicar um nome de arquivo dentro da pasta do projeto.",
      "[WebServer]     at <unknown> (.next/server/chunks/ssr/x.js:5:5423)",
    ].join("\n");

    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: saida }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.cause).toContain("A APLICAÇÃO registrou erro");
    expect(resultado.cause).toContain("DB_NAME deve indicar");
    // A ordem É o conserto: quem lê o começo da causa age sobre a causa certa.
    expect(resultado.cause.indexOf("DB_NAME")).toBeLessThan(resultado.cause.indexOf("não cumpriu um fluxo declarado"));
  });

  it("esquema ausente manda corrigir a migração, não o roteiro", async () => {
    const saida = [
      "    Error: locator.fill: Test timeout of 60000ms exceeded.",
      "[WebServer] ⨯ Error: no such table: clientes",
    ].join("\n");

    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: saida }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.cause).toContain("ESQUEMA AUSENTE");
    expect(resultado.cause).toContain("migrate");
    expect(resultado.cause).toContain("não no roteiro nem na tela");
  });

  /*
   * O primeiro run real do gate, no cron5: a fase 1 recebeu "um passo falhou
   * onde o usuário passaria" quando nenhum passo tinha rodado — o produto não
   * subiu. A causa mandava o executor consertar o fluxo em vez do entrypoint.
   */
  it("aplicação que não sobe é dita como tal, e não como fluxo reprovado", async () => {
    const saidaReal = "Error: Timed out waiting 180000ms from config.webServer.";
    const resultado = await gate4({
      ...base,
      projectRoot,
      startCommand: "npm run build && npm start",
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: saidaReal }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.startupFailed).toBe(true);
    expect(resultado.cause).toContain("NÃO SUBIU");
    expect(resultado.cause).toContain("nenhum fluxo chegou a ser percorrido");
    // O executor precisa saber o que rodar e onde escutar para consertar.
    expect(resultado.cause).toContain("npm run build && npm start");
    expect(resultado.cause).toContain("PORT=");
    expect(resultado.cause).not.toContain("um passo falhou");
  });

  it("as três formas do runner dizer que não subiu contam como falha de subida", async () => {
    const formas = [
      "Error: Timed out waiting 180000ms from config.webServer.",
      "[WebServer] Process from config.webServer exited early.",
      "Error: Process from config.webServer was not able to start. Exit code: 1",
    ];
    for (const saida of formas) {
      const resultado = await gate4({
        ...base,
        projectRoot,
        author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
        runner: async () => ({ exitCode: 1, output: saida }),
      });
      if (resultado.green) throw new Error("deveria reprovar");
      expect(resultado.startupFailed, saida).toBe(true);
    }
  });

  it("fluxo que reprova de verdade continua sendo dito como fluxo", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: "1) passo 2: clica em Interpretar\n   botão não encontrado" }),
    });
    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.startupFailed).toBeUndefined();
    expect(resultado.cause).toContain("não cumpriu um fluxo declarado");
  });

  /*
   * A saída literal do MCP_teste. O padrão antigo dizia "Cannot find module" e o
   * Node moderno diz "Cannot find package": o gate classificou dependência
   * ausente como fluxo reprovado, e o executor foi consertar o produto.
   */
  it("reconhece as duas formas de o Node dizer que falta o pacote", () => {
    const formas = [
      "Error: Cannot find package '@playwright/test' imported from /projeto/.capivara/flows/workflow-1.spec.ts",
      "Error: Cannot find module '@playwright/test'",
      "npx playwright install chromium",
    ];
    for (const saida of formas) {
      expect(faltaORunner(saida, 1), saida).toBe(true);
    }
    // E o que É fluxo reprovado continua sendo fluxo reprovado.
    expect(faltaORunner("1) passo 2: clica em Interpretar\n   botão não encontrado", 1)).toBe(false);
  });

  /**
   * O que reprovou a P03 do MCP_teste três vezes.
   *
   * O padrão aceitava `not found` e `Cannot find module` soltos — e o Next
   * escreve `Module not found: Can't resolve` quando um import do PRODUTO não
   * existe. O gate leu isso como "o Playwright não está instalado" e mandou o
   * executor instalar o que já estava instalado, enquanto o defeito de verdade,
   * que era dele, ficava intocado.
   */
  it("defeito de import do produto não vira runner ausente", () => {
    const doProduto = [
      "Module not found: Can't resolve '@/componentes/Campo'",
      "Error: Cannot find module '../../src/dados/locacoes'",
      "npm ERR! Missing script: \"conta:provisionar\"",
      "Error: Cannot find module 'react-server-dom-webpack/client'",
      "  1) workflow 3 › cadastro\n     Error: page not found",
    ];
    for (const saida of doProduto) {
      expect(faltaORunner(saida, 1), saida).toBe(false);
    }

    // O runner de verdade ausente continua reconhecido, pelo nome dele.
    expect(faltaORunner("sh: 1: playwright: not found", 1)).toBe(true);
    expect(faltaORunner("npm ERR! could not determine executable to run", 1)).toBe(true);
    expect(faltaORunner("Executable doesn't exist at /home/x/.cache/ms-playwright/chromium-1200/chrome", 1)).toBe(true);
    // E o 127 do shell, que não precisa de texto nenhum.
    expect(faltaORunner("", 127)).toBe(true);
  });

  /**
   * O defeito que travou a P02 do MCP_teste.
   *
   * O roteiro usou `getByRole('alert')` e casou com dois elementos: o alerta da
   * página e o `__next-route-announcer__` que o Next injeta em toda rota. O
   * produto estava certo, e o executor foi chamado para consertá-lo — queimando
   * um ciclo numa aplicação que funcionava.
   */
  it("reconhece a falha que é do roteiro, não do produto", () => {
    expect(ehFalhaDoRoteiro("Error: strict mode violation: getByRole('alert') resolved to 2 elements")).toBe(true);
    expect(ehFalhaDoRoteiro("SyntaxError: Unexpected token )")).toBe(true);
    // O que é do produto continua sendo do produto.
    expect(ehFalhaDoRoteiro("1) passo 2: clica em Interpretar\n   botão não encontrado")).toBe(false);
    expect(ehFalhaDoRoteiro("Timed out waiting 180000ms from config.webServer")).toBe(false);
    // O roteirista errou o nome de uma variável: o roteiro morre antes do primeiro passo.
    expect(ehFalhaDoRoteiro("    ReferenceError: sufo is not defined\n    > 10 |   const email = `operador-${sufo}@x`;")).toBe(true);
    // O mesmo tipo de erro, vindo da APLICAÇÃO, é defeito do produto.
    expect(ehFalhaDoRoteiro("[WebServer] ⨯ ReferenceError: tenant is not defined\n  1) passo 2: salva\n   timeout")).toBe(false);
    expect(ehFalhaDoRoteiro("[WebServer] TypeError: db.query is not a function\n  1) passo 1\n   timeout")).toBe(false);
  });

  it("roteiro com defeito próprio é reescrito e rodado de novo, sem custar ciclo do executor", async () => {
    let escritas = 0;
    let execucoes = 0;

    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => {
        escritas += 1;
        return `\`\`\`ts\n${roteiroBom()}\n\`\`\``;
      },
      runner: async () => {
        execucoes += 1;
        // A primeira execução falha por seletor ambíguo; a segunda, com o
        // roteiro reescrito, passa.
        return execucoes === 1
          ? { exitCode: 1, output: "Error: strict mode violation: getByRole('alert') resolved to 2 elements" }
          : verde;
      },
    });

    expect(resultado.green, "o gate não reprova a fase por defeito do próprio roteiro").toBe(true);
    expect(escritas, "o roteiro foi escrito e depois reescrito").toBe(2);
    expect(execucoes).toBe(2);
  });

  it("roteiro que falha por si mesmo duas vezes reprova dizendo de quem é o defeito", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: "Error: strict mode violation: resolved to 3 elements" }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.scriptFailed).toBe(true);
    expect(resultado.cause).toContain("não defeito do produto");
    expect(resultado.cause).toContain("do harness");
  });

  it("runner ausente é defeito de ambiente, e diz o que instalar", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 127, output: "playwright: not found", toolMissing: true }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.toolMissing).toBe(true);
    expect(resultado.cause).toContain("@playwright/test");
  });

  it("sem como subir a aplicação, o gate diz isso em vez de fingir que passou", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      startCommand: null,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => verde,
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.cause).toContain("não sabe como subir a aplicação");
  });

  it("fase sem fluxo declarado e sem roteiro anterior passa sem custo", async () => {
    let pedidos = 0;
    const resultado = await gate4({
      projectRoot,
      workflows: [],
      startCommand: "npm start",
      author: async () => {
        pedidos += 1;
        return "";
      },
      runner: async () => verde,
    });

    expect(resultado.green).toBe(true);
    expect(pedidos).toBe(0);
  });
});

/**
 * A porta do gate 4.
 *
 * Ela era fixa, e isso derrubou a fase 2 do MCP_teste2 no último ciclo: o
 * executor subiu a aplicação para conferir o próprio trabalho, disse ter
 * encerrado o processo e não encerrou. O Playwright achou a porta ocupada e
 * recusou; o gate relatou que a aplicação não subiu, e o executor foi procurar
 * defeito num produto que subia.
 */
describe("a porta em que a aplicação sobe", () => {
  const base = { projectRoot: "", workflows: [WORKFLOW], startCommand: "npm start" };

  it("livre, é a que foi pedida; ocupada, é outra", async () => {
    const { createServer } = await import("node:net");

    // Uma porta que este teste ocupa de fato — nada de supor que a preferida
    // esteja livre nesta máquina, que é justamente o que o defeito provou.
    const ocupante = createServer();
    const ocupada = await new Promise<number>((resolve) => {
      ocupante.listen(0, "127.0.0.1", () => {
        const endereco = ocupante.address();
        resolve(typeof endereco === "object" && endereco ? endereco.port : 0);
      });
    });

    try {
      expect(await portaLivre(ocupada)).not.toBe(ocupada);
    } finally {
      await new Promise((resolve) => ocupante.close(resolve));
    }

    // Livre de novo, ela volta a ser a escolhida.
    expect(await portaLivre(ocupada)).toBe(ocupada);
  });

  it("o roteirista recebe a porta que o gate escolheu, não uma constante", async () => {
    const urls: string[] = [];
    await gate4({
      ...base,
      projectRoot,
      port: 51234,
      author: async (_workflow, _rejeitado, baseUrl) => {
        urls.push(baseUrl);
        return `\`\`\`ts\n${roteiroBom()}\n\`\`\``;
      },
      runner: async () => verde,
    });

    expect(urls).toEqual(["http://127.0.0.1:51234"]);
  });

  /*
   * A janela entre escolher a porta e o Playwright abri-la é pequena e real.
   * Quando alguém a ocupa nesse intervalo, a causa é do ambiente — e dizer "a
   * aplicação não subiu" manda consertar o que não está quebrado.
   */
  it("porta tomada no intervalo é dita como ambiente, não como produto", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({
        exitCode: 1,
        output: "Error: http://127.0.0.1:47533 is already used, make sure that nothing is running on the port/url",
      }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.startupFailed).toBe(true);
    expect(resultado.cause).toContain("Isto é do ambiente, não do seu código");
    expect(resultado.cause).not.toContain("NÃO SUBIU");
  });
});

/**
 * Quando o produto está certo e o roteiro não.
 *
 * Na fase 4 do MCP_teste2 o roteiro se ancorava no `form` e procurava dentro
 * dele um heading que é irmão, não filho. O gate disse "a aplicação não cumpriu
 * um fluxo declarado", e o executor — que só tinha essa saída — moveu o título
 * para dentro do formulário: "o fluxo procura esse heading dentro do `form`, vou
 * colocá-lo lá". O produto foi remodelado para caber num seletor.
 */
describe("o roteiro contestado pelo executor", () => {
  const base = { projectRoot: "", workflows: [WORKFLOW], startCommand: "npm start" };

  it("é reescrito antes de rodar, com o motivo na mão de quem reescreve", async () => {
    const motivos: string[][] = [];
    let execucoes = 0;

    const resultado = await gate4({
      ...base,
      projectRoot,
      roteiroContestado: "o título é irmão do form, não filho; o produto está certo",
      author: async (_workflow, rejeitado) => {
        motivos.push(rejeitado);
        return `\`\`\`ts\n${roteiroBom()}\n\`\`\``;
      },
      runner: async () => {
        execucoes += 1;
        return verde;
      },
    });

    expect(resultado.green).toBe(true);
    // Escreveu o roteiro que faltava e reescreveu o contestado: duas chamadas.
    expect(motivos.at(-1)?.join(" ")).toContain("o executor diz que este roteiro está errado");
    expect(execucoes).toBe(1);
  });

  /*
   * A contestação não é licença para ignorar o fluxo: quem reescreve é outra
   * sessão, que lê o produto de novo. Errado o produto, o roteiro novo reprova
   * igual — e a fase continua devendo o que devia.
   */
  it("não vira licença: roteiro novo que reprova continua reprovando a fase", async () => {
    const resultado = await gate4({
      ...base,
      projectRoot,
      roteiroContestado: "acho que o roteiro está errado",
      author: async () => `\`\`\`ts\n${roteiroBom()}\n\`\`\``,
      runner: async () => ({ exitCode: 1, output: "1) passo 2: clica em Interpretar\n   botão não encontrado" }),
    });

    if (resultado.green) throw new Error("deveria reprovar");
    expect(resultado.cause).toContain("não cumpriu um fluxo declarado");
  });
});

/*
 * A P02 do `assistencia2` reprovou duas vezes com o produto certo. O fluxo
 * "Instalação inicial" lia o arquivo de credenciais que o instalador grava em
 * `~/` — ninguém rodava o instalador —, e o fluxo 4 dependia da senha que o 1
 * trocaria, com os dois rodando ao mesmo tempo. E se o instalador tivesse
 * rodado, teria escrito no diretório pessoal do desenvolvedor.
 */
describe("a passagem isolada, em sequência", () => {
  const PRIMEIRO: SkeletonWorkflow = { number: "1", name: "Instalação inicial", steps: ["instalar", "entrar"] };
  const QUARTO: SkeletonWorkflow = { number: "4", name: "Entrada e senha", steps: ["entrar com a senha"] };
  const bloco = (workflow: SkeletonWorkflow): string => `\`\`\`ts\n${roteiroBom(workflow)}\n\`\`\``;

  it("roteiro escrito para o ambiente antigo é reescrito uma vez, e sai marcado", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    const arquivo = join(projectRoot, FLOWS_DIR, flowScriptName(WORKFLOW.number));
    await writeFile(arquivo, `${roteiroBom()}\n`, "utf8");

    let pedidos = 0;
    const resultado = await gate4({
      projectRoot,
      workflows: [WORKFLOW],
      startCommand: "npm start",
      author: async () => {
        pedidos += 1;
        return bloco(WORKFLOW);
      },
      runner: async () => verde,
    });

    expect(resultado.green).toBe(true);
    expect(pedidos).toBe(1);
    expect((await readFile(arquivo, "utf8")).startsWith(FLOW_MARK)).toBe(true);
  });

  it("a regressão escrita para o ambiente antigo também é reescrita; a ausente continua de fora", async () => {
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, flowScriptName("1")), `${roteiroBom(PRIMEIRO)}\n`, "utf8");

    const escritos: string[] = [];
    await gate4({
      projectRoot,
      workflows: [WORKFLOW],
      regressao: [PRIMEIRO, { ...QUARTO, number: "3" }],
      startCommand: "npm start",
      author: async (workflow) => {
        escritos.push(workflow.number);
        return bloco(workflow);
      },
      runner: async () => verde,
    });

    expect(escritos).toEqual(["1", "2"]);
  });

  it("os roteiros rodam um de cada vez, cada um depois do anterior", async () => {
    const config = renderFlowConfig({ startCommand: "npm start", port: 1, scripts: ["workflow-1.spec.ts", "workflow-4.spec.ts"] });
    expect(config).toContain("workers: 1,");
    expect(config).toContain(`{ name: "workflow-1", testMatch: "**/workflow-1.spec.ts" },`);
    expect(config).toContain(`{ name: "workflow-4", testMatch: "**/workflow-4.spec.ts", dependencies: ["workflow-1"] },`);
  });

  it("quem escreve o segundo fluxo sabe qual roda antes dele e onde está o roteiro", async () => {
    const recebidas: Array<{ numero: string; anteriores: string[] }> = [];
    await gate4({
      projectRoot,
      workflows: [PRIMEIRO, QUARTO],
      startCommand: "npm start",
      author: async (workflow, _rejeitado, _url, passagem) => {
        recebidas.push({ numero: workflow.number, anteriores: passagem.anteriores.map((anterior) => anterior.arquivo) });
        return bloco(workflow);
      },
      runner: async () => verde,
    });

    expect(recebidas).toEqual([
      { numero: "1", anteriores: [] },
      { numero: "4", anteriores: [join(FLOWS_DIR, "workflow-1.spec.ts")] },
    ]);
  });

  it("cada passagem tem diretório pessoal e banco próprios, migrados, e apagados ao fim", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DATABASE_SOURCE=sqlite\nSQLITE_PATH=./dados.sqlite\n", "utf8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ scripts: { migrate: "node m.js", start: "node s.js" } }), "utf8");

    const ambientes: Array<Record<string, string>> = [];
    const migracoes: Array<{ comando: string; env: Record<string, string> }> = [];
    const resultado = await gate4({
      projectRoot,
      workflows: [WORKFLOW],
      startCommand: "npm start",
      author: async () => bloco(WORKFLOW),
      executar: async (comando, _cwd, env) => {
        migracoes.push({ comando, env });
        return { exitCode: 0, output: "" };
      },
      runner: async (_root, _scripts, env) => {
        ambientes.push(env ?? {});
        return verde;
      },
    });

    expect(resultado.green).toBe(true);
    const env = ambientes[0] ?? {};
    expect(env.HOME).toBeDefined();
    expect(env.HOME?.startsWith(tmpdir())).toBe(true);
    expect(env.SQLITE_PATH?.endsWith("dados.sqlite")).toBe(true);
    expect(env.SQLITE_PATH?.startsWith(projectRoot)).toBe(false);
    expect(env.CAPIVARA_RAIZ).toBe(projectRoot);
    // A migração roda no banco da passagem — o mesmo ambiente que a aplicação recebe.
    expect(migracoes).toEqual([{ comando: "npm run migrate", env }]);
    // Nada sobrevive à passagem.
    await expect(stat(dirname(env.HOME ?? ""))).rejects.toThrow();
    // O ajudante do roteiro está ao lado dele.
    expect(await readFile(join(projectRoot, FLOWS_DIR, FLOW_HELPER), "utf8")).toContain("export async function comandoDoProjeto");
  });

  it("sem banco em arquivo, nada é migrado: o banco do .env continua sendo do desenvolvedor", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DATABASE_URL=mysql://exemplo.invalid/app\n", "utf8");
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({ scripts: { migrate: "node m.js" } }), "utf8");

    let migrou = false;
    await gate4({
      projectRoot,
      workflows: [WORKFLOW],
      startCommand: "npm start",
      author: async () => bloco(WORKFLOW),
      executar: async () => {
        migrou = true;
        return { exitCode: 0, output: "" };
      },
      runner: async () => verde,
    });

    expect(migrou).toBe(false);
    expect(await bancosDeclarados(projectRoot)).toEqual({});
  });

  it("o banco declarado em arquivo é reconhecido pelo valor, não pelo nome da chave", async () => {
    await writeFile(join(projectRoot, ".env.example"), "DB_FILE='./var/app.db'\nPORTA=3000\n# X=./y.sqlite\n", "utf8");
    expect(await bancosDeclarados(projectRoot)).toEqual({ DB_FILE: "./var/app.db" });
  });

  it("trocar o diretório pessoal não esconde o navegador que a máquina já tem", () => {
    const linux = ferramentasDaMaquina({}, "/home/dev", "linux");
    expect(linux.PLAYWRIGHT_BROWSERS_PATH).toBe("/home/dev/.cache/ms-playwright");
    expect(linux.XDG_CACHE_HOME).toBe("/home/dev/.cache");
    expect(ferramentasDaMaquina({}, "/Users/dev", "darwin").PLAYWRIGHT_BROWSERS_PATH).toBe("/Users/dev/Library/Caches/ms-playwright");
    // O que o desenvolvedor já definiu é dele.
    expect(ferramentasDaMaquina({ PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, "/home/dev", "linux").PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
  });

  it("o ajudante não serve para construir nem subir a aplicação", () => {
    const roteiro = roteiroBom().replace(
      "await page.goto('/');",
      "await comandoDoProjeto('npm', ['run', 'build']); await page.goto('/');",
    );
    expect(checkFlowScript(roteiro, WORKFLOW).map((defeito) => defeito.problem).join(" ")).toContain("construir ou subir");
    const instalar = roteiroBom().replace("await page.goto('/');", "await comandoDoProjeto('npm', ['run', 'install:initial']);");
    expect(checkFlowScript(instalar, WORKFLOW)).toEqual([]);
  });

  it("o roteirista sabe que a passagem começa do zero, quem roda antes e como chegar ao terminal", () => {
    const prompt = flowPrompt({
      language: "português do Brasil",
      workflow: QUARTO,
      baseUrl: "http://127.0.0.1:1",
      passagem: {
        anteriores: [{ number: "1", name: "Instalação inicial", arquivo: ".capivara/flows/workflow-1.spec.ts" }],
        bancoNovo: ["SQLITE_PATH"],
        migracao: null,
        ajudante: FLOW_HELPER,
      },
    });
    expect(prompt).toContain("starts from ZERO");
    expect(prompt).toContain("`SQLITE_PATH`");
    expect(prompt).toContain("No migration is applied for you");
    expect(prompt).toContain("workflow 1 — Instalação inicial (`.capivara/flows/workflow-1.spec.ts`)");
    expect(prompt).toContain("import { comandoDoProjeto } from './capivara-comando';");
  });
});
