import { describe, expect, it } from "vitest";
import type { DashboardModel } from "../../src/tui/dashboard.js";
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
  tint,
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

  /*
   * A pergunta que volta é a mesma tela de antes, e a única novidade é o que
   * faltou. Ela vem primeiro porque quem já respondeu uma vez não relê a
   * evidência — e sem ela a repetição parece que a resposta não foi lida.
   */
  it("a repergunta abre dizendo o que faltou", () => {
    const repetida = { ...question, pending: "falta definir o prazo de devolução" };
    const screen = renderQuestion({ question: repetida, index: 1, total: 1, document: "d.md", style: plain });
    expect(screen).toContain("ficou faltando");
    expect(screen).toContain("falta definir o prazo de devolução");
    expect(screen.indexOf("ficou faltando")).toBeLessThan(screen.indexOf("Já descobri:"));
  });

  it("pergunta nova não fala em faltar nada", () => {
    const screen = renderQuestion({ question, index: 1, total: 1, document: "d.md", style: plain });
    expect(screen).not.toContain("ficou faltando");
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
    activity: { kind: "modelo" as const, detail: "escrevendo project-phases", sinceSeconds: 42 },
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

  it("centraliza o mascote inteiro e reduz o topo em terminal com cor verdadeira", () => {
    const environment = { COLORTERM: "truecolor" };
    const mascot = renderCapybara({ style: colored, environment, columns: 32 });
    for (const width of [80, 110, 160]) {
      const lines = renderDashboard({ ...model, width, style: colored, environment }).split("\n");
      const start = Math.floor((width - Math.max(...mascot.map(visibleWidth))) / 2);
      mascot.forEach((row, index) => {
        const line = lines[index]!;
        const position = line.indexOf(row);
        expect(position).toBeGreaterThanOrEqual(0);
        expect(visibleWidth(line.slice(0, position))).toBe(start);
      });
      expect(lines.findIndex((line) => line.includes("SITUAÇÃO"))).toBeLessThanOrEqual(10);
    }
  });

  it.each([40, 64, 80, 110, 160])("cabe em %i colunas e acompanha a altura sem esconder a fase corrente", (width) => {
    for (const height of [24, 32, 40, 50]) {
      const view = renderDashboard({
        ...model, width, height, style: colored, environment: { COLORTERM: "truecolor" },
        phases: {
          summary: "10/20 fases", maxRows: 12,
          rows: Array.from({ length: 20 }, (_, index) => ({
            id: `P${String(index + 1).padStart(2, "0")}`, title: `Implementação ${index + 1}`,
            state: index === 10 ? "em andamento" as const : "aguardando" as const,
            detail: "ciclo 2/3", gates: { G0: "verde" as const, G1: "verde" as const, G2: "corrente" as const, G3: "aguardando" as const, G4: "aguardando" as const },
          })),
        },
        events: Array.from({ length: 10 }, (_, index) => ({ time: "12:00:00", text: `evento ${index}` })),
      });
      const lines = view.split("\n");
      expect(lines.length).toBeLessThan(height);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(view).toContain("P11");
      expect(view).toContain("G2");
      expect(view).toContain("evento 9");
      expect(view).not.toContain("PIPELINE");
    }
  });

  it("preserva todas as opções de uma pergunta que exige rolagem", () => {
    const view = renderDashboard({ ...model, height: 24, width: 80,
      question: { title: "PERGUNTA", body: Array.from({ length: 40 }, (_, i) => `opção ${i + 1}`) },
    });
    expect(view).toContain("opção 1");
    expect(view).toContain("opção 40");
  });

  it("mantém as caixas de informação no terminal comum de 80 por 24", () => {
    const view = renderDashboard({ ...model, width: 80, height: 24, pipeline: model.pipeline.slice(0, 2),
      roles: ["writer", "auditor", "verifier"].map((role) => ({ role, provider: "codex", model: "gpt-5" })),
    });
    expect(view.split("\n").length).toBeLessThan(24);
    expect(view).toContain("SITUAÇÃO");
    expect(view).toContain("TELEMETRIA");
    expect(view).toContain("PROVEDOR ATUAL");
  });
});

describe("fundo do painel", () => {
  const simples = {
    version: "0.1.0",
    command: "init",
    subtitle: "init",
    project: "p",
    stage: "escrita",
    status: { label: "em andamento", state: "em andamento" as const },
    durationSeconds: 10,
    pipeline: [],
    provider: { perfil: "codex", transporte: "codex-cli", contabilidade: "opaca" },
    telemetry: [],
    events: [],
    activity: { kind: "modelo" as const, detail: "escrevendo", sinceSeconds: 3 },
    style: colored,
    environment: {} as NodeJS.ProcessEnv,
  };

  it("sem cor pedida, o painel não mexe no fundo do terminal", () => {
    const view = renderDashboard(simples);
    expect(view).not.toContain("48;2;");
  });

  it("com cor, cada linha é preenchida até a largura", () => {
    const view = renderDashboard({ ...simples, background: "#300A24", width: 90 });
    for (const line of view.split("\n")) {
      expect(line).toContain("48;2;48;10;36m");
      expect(visibleWidth(line)).toBe(90);
    }
  });

  it("o fundo é reposto depois de cada reset, senão morreria na primeira palavra colorida", () => {
    const pintado = tint(`${paint("verde", "green", colored)} e resto`, "#300A24", 40);
    const depoisDoReset = pintado.slice(pintado.indexOf(`${ESC}[0m`) + 4);
    expect(depoisDoReset).toContain("48;2;48;10;36m");
  });

  it("hexadecimal inválido não quebra: devolve o texto como estava", () => {
    const texto = "linha";
    expect(tint(texto, "vermelho", 20)).toBe(texto);
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

  it("reduz largura e altura na mesma proporção, sem gerar cores inválidas", () => {
    const lines = renderCapybara({ style: colored, environment: { COLORTERM: "truecolor" }, columns: 32 });
    expect(lines).toHaveLength(CAPYBARA_ROWS * 0.8);
    expect(Math.max(...lines.map(visibleWidth))).toBe(CAPYBARA_COLS * 0.8);
    expect(lines.join("\n")).not.toContain("NaN");
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

  it("quem julga não é oferecido como lugar de economizar", () => {
    const steps = wizardSteps("init");
    for (const id of ["auditor-override", "verifier-override"]) {
      const step = steps.find((entry) => entry.id === id);
      expect(step?.hint).toContain("não coloque abaixo do executor");
      expect(step?.hint).not.toContain("barato");
    }
  });

  it("o build pergunta comando de teste e ciclos; o init pergunta o pedido", () => {
    expect(wizardSteps("build").map((step) => step.id)).toContain("test-cmd");
    expect(wizardSteps("init").map((step) => step.id)).toContain("request");
    expect(wizardSteps("build").map((step) => step.id)).not.toContain("request");
  });
});

/*
 * As duas caixas do pedido do desenvolvedor: quanto já andou e o que está
 * acontecendo agora, lado a lado, em TODO estágio. O painel dizia a etapa e
 * listava eventos; quanto falta e onde parou eram contas de cabeça.
 */
describe("PROGRESSO e TRABALHO ATUAL", () => {
  const base = {
    version: "0.3.4",
    command: "build",
    subtitle: "build · implementação",
    project: "/home/bruno/pilotos/piloto-1",
    stage: "implement",
    status: { label: "em andamento", state: "em andamento" as const },
    durationSeconds: 754,
    pipeline: [],
    provider: { perfil: "codex", transporte: "codex-cli", contabilidade: "por chamada" },
    telemetry: [{ label: "CHAMADAS", value: "12" }],
    events: [{ time: "10:21:05", text: "fase P01 concluída" }],
    activity: { kind: "modelo" as const, detail: "escrevendo", sinceSeconds: 42 },
    style: plain,
    environment: {} as NodeJS.ProcessEnv,
  };

  const comCaixas = (extra: Partial<DashboardModel> = {}): string =>
    renderDashboard({
      ...base,
      width: 100,
      height: 40,
      progress: [
        { label: "Fases", done: 2, total: 7 },
        { label: "Tasks", done: 6, total: 13 },
      ],
      progressNote: "Teste: vendor/bin/sail test",
      work: [
        { label: "Fase", value: "P03 · Assets da marca" },
        { label: "Último erro", value: "gate 2 — a suíte reprovou" },
      ],
      ...extra,
    });

  it("desenha a fração, a barra e a porcentagem de cada contagem", () => {
    const view = comCaixas();
    expect(view).toContain("PROGRESSO");
    expect(view).toContain("2/7");
    expect(view).toContain("29%");
    expect(view).toContain("6/13");
    expect(view).toContain("46%");
    expect(view).toContain("█");
  });

  it("põe as duas caixas na mesma linha quando a largura permite", () => {
    const linhas = comCaixas().split("\n");
    const cabecalho = linhas.find((linha) => linha.includes("PROGRESSO"));
    expect(cabecalho).toContain("TRABALHO ATUAL");
  });

  it("empilha num terminal estreito, em vez de espremer as duas", () => {
    const linhas = renderDashboard({
      ...base,
      width: 60,
      height: 40,
      progress: [{ label: "Fases", done: 2, total: 7 }],
      work: [{ label: "Último erro", value: "gate 2 reprovou" }],
    }).split("\n");
    const cabecalho = linhas.find((linha) => linha.includes("PROGRESSO"));
    expect(cabecalho).not.toContain("TRABALHO ATUAL");
    expect(linhas.some((linha) => linha.includes("TRABALHO ATUAL"))).toBe(true);
  });

  it("o último erro chega à tela: é a pergunta que mais se faz olhando um build", () => {
    expect(comCaixas()).toContain("gate 2 — a suíte reprovou");
  });

  /*
   * Elas não podem empurrar o painel para o desenho de emergência: num terminal
   * apertado, o que some primeiro são elas, e a lista de fases fica.
   */
  it("somem antes de o painel virar lista de texto", () => {
    const apertado = renderDashboard({
      ...base,
      width: 100,
      height: 22,
      phases: {
        summary: "1/3", maxRows: 3,
        rows: [{ id: "P01", title: "Fundação", state: "em andamento" as const, detail: "ciclo 1/3", gates: { G0: "verde" as const } }],
      },
      progress: [{ label: "Fases", done: 1, total: 3 }],
      work: [{ label: "Último erro", value: "x" }],
    });
    expect(apertado).not.toContain("PROGRESSO");
    expect(apertado).toContain("P01");
  });
});

/*
 * "A dashboard deve ocupar toda a área disponível do terminal e não deixar espaço
 * sobrando": ela só sabia encolher, e num terminal alto desenhava o tamanho de
 * sempre com metade da tela vazia embaixo.
 */
describe("o painel ocupa a altura que tem", () => {
  const base = {
    version: "0.3.4",
    command: "plan",
    subtitle: "plan · detalhamento",
    project: "/home/bruno/pilotos/piloto-1",
    stage: "authoring",
    status: { label: "em andamento", state: "em andamento" as const },
    durationSeconds: 754,
    pipeline: [],
    provider: { perfil: "codex", transporte: "codex-cli", contabilidade: "por chamada" },
    telemetry: [{ label: "CHAMADAS", value: "12" }],
    events: [] as { time: string; text: string }[],
    activity: { kind: "modelo" as const, detail: "escrevendo", sinceSeconds: 42 },
    style: plain,
    environment: {} as NodeJS.ProcessEnv,
  };

  const alto = (height: number): string[] =>
    renderDashboard({
      ...base,
      width: 100,
      height,
      phases: {
        summary: "2/20", maxRows: 4,
        rows: Array.from({ length: 20 }, (_, i) => ({
          id: `P${String(i + 1).padStart(2, "0")}`, title: `Fase ${i + 1}`,
          state: i < 2 ? ("concluído" as const) : ("aguardando" as const),
          detail: "aguardando", gates: { G0: "verde" as const },
        })),
      },
      events: Array.from({ length: 12 }, (_, i) => ({ time: "12:00:00", text: `evento ${i}` })),
    }).split("\n");

  it("preenche exatamente o orçamento, deixando uma linha para o cursor", () => {
    for (const height of [24, 30, 40, 60]) {
      expect(alto(height).length, `altura ${height}`).toBe(height - 1);
    }
  });

  it("devolve o espaço a quem tem o que mostrar: mais fases e mais eventos", () => {
    const curto = alto(26).join("\n");
    const comprido = alto(60).join("\n");
    const fases = (texto: string): number => texto.split("\n").filter((linha) => /\bP\d\d\b/.test(linha)).length;
    expect(fases(comprido)).toBeGreaterThan(fases(curto));
    expect(comprido).toContain("evento 11");
  });

  it("o rodapé continua embaixo: o preenchimento vai antes dele", () => {
    const linhas = alto(50);
    expect(linhas.at(-1)).toContain("Ctrl-C");
  });
});

/*
 * O painel é desenhado de dentro do `announce` e do `onProgress`, que rodam dentro
 * do laço do orquestrador: uma exceção aqui sobe por ali e mata um run de horas por
 * causa de uma linha de moldura. `renderDashboard` é função pura e precisa ser
 * TOTAL — devolver texto para qualquer modelo, inclusive os que não deveriam
 * existir.
 */
describe("o desenho nunca lança", () => {
  const hostil = (extra: Partial<DashboardModel>): DashboardModel => ({
    version: "0.3.4",
    command: "plan",
    subtitle: "s",
    project: "p",
    stage: "e",
    status: { label: "x", state: "em andamento" },
    durationSeconds: 0,
    pipeline: [],
    provider: { perfil: "", transporte: "", contabilidade: "" },
    telemetry: [],
    events: [],
    activity: { kind: "modelo", detail: "", sinceSeconds: 0 },
    style: plain,
    ...extra,
  });

  const casos: [string, Partial<DashboardModel>][] = [
    ["total zero", { progress: [{ label: "Fases", done: 0, total: 0 }] }],
    ["feito maior que o total", { progress: [{ label: "Fases", done: 99, total: 3 }] }],
    ["negativos", { progress: [{ label: "Fases", done: -4, total: -7 }] }],
    ["NaN", { progress: [{ label: "Fases", done: Number.NaN, total: Number.NaN }] }],
    ["largura mínima", { width: 1, height: 3, progress: [{ label: "Fases", done: 1, total: 2 }], work: [{ label: "x", value: "y" }] }],
    ["altura mínima", { width: 100, height: 1, work: [{ label: "x", value: "y" }] }],
    ["rótulo enorme", { width: 40, progress: [{ label: "x".repeat(400), done: 1, total: 2 }] }],
    ["valor enorme", { width: 40, work: [{ label: "y".repeat(200), value: "z".repeat(900) }] }],
  ];

  for (const [nome, modelo] of casos) {
    it(`sobrevive a ${nome}`, () => {
      expect(() => renderDashboard(hostil(modelo))).not.toThrow();
      expect(renderDashboard(hostil(modelo)).length).toBeGreaterThan(0);
    });
  }

  it("e respeita a largura mesmo no caso absurdo", () => {
    for (const [nome, modelo] of casos) {
      const width = modelo.width ?? 100;
      const linhas = renderDashboard(hostil({ ...modelo, width })).split("\n");
      // O piso é 4: abaixo disso não cabe moldura nenhuma, e `dashboardWidth`
      // trunca para lá em vez de desenhar linhas quebradas.
      const teto = Math.max(4, width);
      expect(linhas.every((linha) => visibleWidth(linha) <= teto), nome).toBe(true);
    }
  });
});
