import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  PHASE_GATES,
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
    command: "build" as const,
    stage: "implement",
    subject: "P02",
    attempt: 2,
    maxAttempts: 3,
    active: { role: "builder", model: "gpt-5", elapsedSeconds: 42 },
    gates: [
      { name: "G0 engine", state: "verde" as const },
      { name: "G2 suíte", state: "vermelho" as const },
      { name: "G3 verificação", state: "pendente" as const },
    ],
    phases: [
      { id: "P01", title: "Fundação de dados", state: "verde" as const },
      { id: "P02", title: "Criar reserva", state: "rodando" as const },
    ],
    costs: [{ role: "builder", calls: 3, seconds: 120 }],
    recent: ["gate 2 vermelho", "ciclo de correção 2/3"],
    style: plain,
  };

  it("mostra estágio, assunto e tentativa", () => {
    const view = renderDashboard(model);
    expect(view).toContain("implement");
    expect(view).toContain("P02");
    expect(view).toContain("tentativa 2/3");
  });

  it("mostra a grade de fases e a de gates", () => {
    const view = renderDashboard(model);
    expect(view).toContain("Fundação de dados");
    expect(view).toContain("G2 suíte");
  });

  it("mostra o custo ao lado do progresso", () => {
    expect(renderDashboard(model)).toContain("3 chamada(s) · 120s");
  });

  it("os quatro gates da fase são nomeados", () => {
    expect(PHASE_GATES).toHaveLength(4);
  });

  it("aguenta um modelo sem chamada ativa", () => {
    expect(() => renderDashboard({ ...model, active: null, phases: [], gates: [], costs: [], recent: [] })).not.toThrow();
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
