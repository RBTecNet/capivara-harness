/**
 * O gate 4 — o que o §28 dizia que faltava.
 *
 * O que se testa aqui não é o navegador: é a disciplina em volta dele. Um gate
 * que deixa um modelo escrever a própria prova precisa conferir a prova antes de
 * rodá-la, e precisa rodar o que sobrou pelo processo, não pela palavra de quem
 * escreveu.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FLOWS_DIR, FLOW_CONFIG, checkFlowScript, flowScriptName, gate4, renderFlowConfig } from "../../src/loop/index.js";
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
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-2.spec.ts"), roteiroBom(), "utf8");

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
    await mkdir(join(projectRoot, FLOWS_DIR), { recursive: true });
    await writeFile(join(projectRoot, FLOWS_DIR, "workflow-1.spec.ts"), roteiroBom({ ...WORKFLOW, number: "1" }), "utf8");

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
    expect(rodados[0]).toEqual(["workflow-1.spec.ts", "workflow-2.spec.ts"]);
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
