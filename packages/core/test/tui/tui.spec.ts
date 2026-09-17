import { describe, expect, it } from "vitest";
import {
  BLOCK_FONT_ROWS,
  CAPYBARA_ASCII,
  CAPYBARA_COLS,
  CAPYBARA_ROWS,
  DEFAULT_LANGUAGE,
  PHASE_GATES,
  blockText,
  renderCapybara,
  detectLanguage,
  padVisible,
  paint,
  renderCommand,
  renderDashboard,
  renderQuestion,
  renderSplash,
  supportsColor,
  truncateVisible,
  visibleWidth,
  wizardSteps,
  wrap,
} from "../../src/tui/index.js";
import type { Question } from "../../src/interview/index.js";

const ESC = String.fromCharCode(27);
const plain = { enabled: false };
const colored = { enabled: true };

describe("ansi", () => {
  it("não pinta quando a cor está desligada", () => {
    expect(paint("texto", "red", plain)).toBe("texto");
    expect(paint("texto", "red", colored)).toContain(`${ESC}[31m`);
  });

  it("mede a largura visível ignorando escapes", () => {
    expect(visibleWidth(paint("abc", "red", colored))).toBe(3);
  });

  it("padVisible e truncateVisible respeitam a largura visível", () => {
    expect(visibleWidth(padVisible(paint("ab", "red", colored), 5))).toBe(5);
    expect(truncateVisible("abcdefgh", 4)).toBe("abc…");
  });

  it("NO_COLOR desliga a cor mesmo em TTY", () => {
    expect(supportsColor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
    expect(supportsColor({ isTTY: true }, {})).toBe(true);
    expect(supportsColor({ isTTY: false }, {})).toBe(false);
  });
});

describe("splash", () => {
  it("traz o mascote, a versão e os papéis configurados", () => {
    const splash = renderSplash({
      version: "0.1.0",
      roles: [{ role: "writer", provider: "codex", model: "gpt-5" }],
      style: plain,
    });
    expect(splash).toContain("capivara");
    expect(splash).toContain("0.1.0");
    expect(splash).toContain("codex/gpt-5");
  });

  it("com cor verdadeira, o splash traz a capivara em meio-blocos", () => {
    const splash = renderSplash({
      version: "0.1.0",
      roles: [],
      style: colored,
      environment: { COLORTERM: "truecolor" },
    });
    expect(splash).toContain("▀");
    expect(splash).toContain(`${ESC}[38;2;`);
  });

  it("sem cor verdadeira, o splash cai no mascote simples", () => {
    const splash = renderSplash({ version: "0.1.0", roles: [], style: plain, environment: {} });
    expect(splash).toContain(CAPYBARA_ASCII[0]);
    expect(splash).not.toContain("▀");
  });

  it("papel sem provider aparece como não configurado", () => {
    const splash = renderSplash({ version: "0.1.0", roles: [{ role: "builder", provider: "", model: "" }], style: plain });
    expect(splash).toContain("não configurado");
  });
});

describe("tela da entrevista", () => {
  const question: Question = {
    id: "Q-01",
    topic: "stack",
    evidence: "O diretório do projeto está vazio: não há stack nem convenção a descobrir.",
    decision: "Qual stack o projeto usa?",
    why: "Define os comandos de build e teste e a forma de todas as fases.",
    options: [
      { label: "Node + Vitest", consequence: "suíte rápida e ecossistema que você já usa" },
      { label: "Python + pytest", consequence: "melhor para processamento de dados" },
    ],
    recommended: "Node + Vitest",
    recommendationBasis: "é a stack do restante dos seus projetos",
  };

  it("mostra a evidência ANTES da pergunta", () => {
    const screen = renderQuestion({ question, index: 1, total: 3, document: "project-description.md", style: plain });
    expect(screen.indexOf("Já descobri:")).toBeLessThan(screen.indexOf("Qual stack o projeto usa?"));
  });

  it("numera as opções e marca a recomendada", () => {
    const screen = renderQuestion({ question, index: 1, total: 3, document: "d.md", style: plain });
    expect(screen).toContain("1. Node + Vitest");
    expect(screen).toContain("recomendada");
    expect(screen).toContain("recomendo porque:");
  });

  it("mostra o progresso", () => {
    expect(renderQuestion({ question, index: 2, total: 5, document: "d.md", style: plain })).toContain("pergunta 2/5");
  });

  it("oferece voltar, não sei e as recomendações", () => {
    const screen = renderQuestion({ question, index: 1, total: 1, document: "d.md", style: plain });
    expect(screen).toContain("voltar");
    expect(screen).toContain("não sei");
    expect(screen).toContain("use as recomendações");
  });

  it("pergunta aberta não oferece número", () => {
    const aberta = { ...question, options: [], recommended: "", recommendationBasis: "" };
    const screen = renderQuestion({ question: aberta, index: 1, total: 1, document: "d.md", style: plain });
    expect(screen).not.toContain("com o número");
  });

  it("wrap quebra sem cortar palavra", () => {
    expect(wrap("uma frase razoavelmente longa para quebrar", 12).every((line) => line.length <= 12)).toBe(true);
  });
});

describe("dashboard", () => {
  const model = {
    version: "0.1.0",
    command: "build",
    subtitle: "build · implementação · harness control plane",
    project: "/home/bruno/pilotos/piloto-1",
    stage: "implement",
    status: { label: "em andamento", state: "em andamento" as const },
    durationSeconds: 754,
    pipeline: [
      { label: "preflight", state: "concluído" as const },
      { label: "P01", state: "concluído" as const },
      { label: "P02", state: "em andamento" as const },
      { label: "P03", state: "aguardando" as const },
    ],
    provider: { perfil: "codex:gpt-5.6-luna", transporte: "codex-cli", contabilidade: "opaca" },
    telemetry: [
      { label: "INVOCAÇÕES", value: "12" },
      { label: "CORREÇÕES", value: "1" },
      { label: "TOKENS", value: "não medido" },
    ],
    events: [
      { time: "10:21:05", text: "fase P01 concluída" },
      { time: "10:22:41", text: "gate 2 vermelho" },
    ],
    style: plain,
    environment: {} as NodeJS.ProcessEnv,
  };

  it("mostra projeto, etapa, status e duração", () => {
    const view = renderDashboard(model);
    expect(view).toContain("piloto-1");
    expect(view).toContain("implement");
    expect(view).toContain("em andamento");
    expect(view).toContain("12m 34s");
  });

  it("rótulo longo de fase não empurra o estado para fora da coluna", () => {
    const view = renderDashboard({
      ...model,
      pipeline: [{ label: "P01 Fundação de dados com nome bem comprido", state: "concluído" as const }],
    });
    const linha = view.split("\n").find((line) => line.includes("concluído") && line.includes("P01"));
    expect(linha).toBeDefined();
    expect(visibleWidth(linha ?? "")).toBeLessThanOrEqual(110);
  });

  it("mostra o pipeline com o estado de cada passo", () => {
    const view = renderDashboard(model);
    expect(view).toContain("preflight");
    expect(view).toContain("P02");
    expect(view).toContain("aguardando");
  });

  it("mostra o provedor e a telemetria", () => {
    const view = renderDashboard(model);
    expect(view).toContain("codex:gpt-5.6-luna");
    expect(view).toContain("INVOCAÇÕES");
    expect(view).toContain("não medido");
  });

  it("mostra os eventos recentes com horário", () => {
    expect(renderDashboard(model)).toContain("[10:22:41]");
  });

  it("declara que observa sem alterar, e que segredo não entra", () => {
    const view = renderDashboard(model);
    expect(view).toContain("não altera a execução");
    expect(view).toContain("segredos nunca entram");
  });

  it("nenhuma linha passa da largura pedida", () => {
    const view = renderDashboard({ ...model, width: 90 });
    for (const line of view.split("\n")) {
      expect(visibleWidth(line), line).toBeLessThanOrEqual(90);
    }
  });

  it("os quatro gates da fase são nomeados", () => {
    expect(PHASE_GATES).toHaveLength(4);
  });

  it("aguenta um modelo sem pipeline, telemetria nem eventos", () => {
    expect(() => renderDashboard({ ...model, pipeline: [], telemetry: [], events: [] })).not.toThrow();
  });
});

describe("capivara", () => {
  it("sem cor verdadeira, cai no mascote ASCII", () => {
    const linhas = renderCapybara({ style: plain, environment: {} });
    expect(linhas).toEqual([...CAPYBARA_ASCII]);
  });

  it("com cor verdadeira, desenha em meio-blocos", () => {
    const linhas = renderCapybara({ style: colored, environment: { COLORTERM: "truecolor" } });
    expect(linhas).toHaveLength(CAPYBARA_ROWS);
    expect(linhas.join("")).toContain("▀");
    expect(linhas.join("")).toContain(`${ESC}[38;2;`);
  });

  it("cada linha cobre a largura do desenho", () => {
    const linhas = renderCapybara({ style: colored, environment: { COLORTERM: "truecolor" } });
    expect(visibleWidth(linhas[5] ?? "")).toBeLessThanOrEqual(CAPYBARA_COLS);
  });

  it("CAPIVARA_ASCII_MASCOT força o desenho simples", () => {
    const linhas = renderCapybara({ style: colored, environment: { COLORTERM: "truecolor", CAPIVARA_ASCII_MASCOT: "1" } });
    expect(linhas).toEqual([...CAPYBARA_ASCII]);
  });

  it("o recuo desloca todas as linhas", () => {
    const linhas = renderCapybara({ style: plain, environment: {}, indent: 4 });
    expect(linhas.every((line) => line.startsWith("    "))).toBe(true);
  });
});

describe("fonte de blocos", () => {
  it("rende o título em cinco linhas", () => {
    const linhas = blockText("CAPIVARA");
    expect(linhas).toHaveLength(BLOCK_FONT_ROWS);
    expect(linhas.every((line) => line.length > 30)).toBe(true);
  });

  it("ignora o que não conhece em vez de quebrar", () => {
    expect(() => blockText("CAPIVARA 2026!")).not.toThrow();
  });
});

describe("idioma da interface", () => {
  it("detecta português do prompt", () => {
    expect(detectLanguage("preciso de um sistema de reservas para uma pousada com controle de quartos")).toBe("português do Brasil");
  });

  it("detecta inglês", () => {
    expect(detectLanguage("I need a booking system for a small inn that must track rooms and guests")).toBe("English");
  });

  it("a flag sempre vence a detecção", () => {
    expect(detectLanguage("I need a booking system", "português do Brasil")).toBe("português do Brasil");
  });

  it("texto sem marcador cai no padrão", () => {
    expect(detectLanguage("zzz")).toBe(DEFAULT_LANGUAGE);
  });
});

describe("wizard", () => {
  it("imprime o comando equivalente ao que foi montado", () => {
    const command = renderCommand({
      command: "init",
      request: "um sistema de reservas",
      global: { provider: "codex", model: "gpt-5" },
      roles: { auditor: { provider: "anthropic", model: "claude-haiku-4-5-20251001" } },
      noSplash: true,
    });
    expect(command).toBe(
      'capivara init "um sistema de reservas" --provider codex --model gpt-5 --auditor-provider anthropic --auditor-model claude-haiku-4-5-20251001 --no-splash',
    );
  });

  it("cita o que precisa de aspas e não cita o que não precisa", () => {
    const command = renderCommand({ command: "build", global: {}, roles: {}, testCommand: "npm run test:ci" });
    expect(command).toContain('--test-cmd "npm run test:ci"');
  });

  it("os passos avisam que o executor exige CLI", () => {
    const steps = wizardSteps("init");
    const builder = steps.find((step) => step.id === "builder-override");
    expect(builder?.hint).toContain("exige uma CLI");
  });

  it("o build pergunta comando de teste e ciclos; o init pergunta o pedido", () => {
    expect(wizardSteps("build").map((step) => step.id)).toContain("test-cmd");
    expect(wizardSteps("init").map((step) => step.id)).toContain("request");
    expect(wizardSteps("build").map((step) => step.id)).not.toContain("request");
  });
});
