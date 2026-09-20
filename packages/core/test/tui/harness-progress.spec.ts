/**
 * O painel do harness, exercitado sem terminal e sem provider.
 *
 * Tudo aqui é projeção pura: entra evento, sai modelo. É o que permite afirmar
 * que o painel observa sem alterar — ele nem tem como.
 */

import { describe, expect, it } from "vitest";
import { PIPELINE_STEPS, HarnessProgress, createLiveRegion, renderDashboard } from "../../src/tui/index.js";
import type { ProgressEvent } from "../../src/tui/index.js";

const plain = { enabled: false };

function progresso(now = () => new Date("2026-09-18T03:00:00Z")): HarnessProgress {
  return new HarnessProgress({
    version: "0.1.0",
    project: "/home/bruno/pilotos/piloto-3",
    provider: { perfil: "codex", transporte: "codex-cli", contabilidade: "por chamada" },
    style: plain,
    environment: {},
    now,
  });
}

function evento(partial: Partial<ProgressEvent>): ProgressEvent {
  return { stage: "interview", subject: "skeleton", status: "started", detail: "", attempt: 1, ...partial };
}

describe("painel do harness", () => {
  it("começa com todos os passos do ciclo aguardando", () => {
    const model = progresso().model();
    expect(model.pipeline).toHaveLength(PIPELINE_STEPS.length);
    expect(model.pipeline.every((step) => step.state === "aguardando")).toBe(true);
  });

  it("passo em trabalho fica em andamento e publicado fica concluído", () => {
    const p = progresso();
    p.apply(evento({ stage: "authoring" }));
    expect(p.model().pipeline[0]?.state).toBe("em andamento");

    p.apply(evento({ stage: "publish", status: "complete" }));
    expect(p.model().pipeline[0]?.state).toBe("concluído");
  });

  it("publicado não volta a em andamento por um evento atrasado", () => {
    const p = progresso();
    p.apply(evento({ stage: "publish", status: "complete" }));
    p.apply(evento({ stage: "audit" }));
    expect(p.model().pipeline[0]?.state).toBe("concluído");
  });

  it("a etapa nomeia o que está acontecendo e sobre o quê", () => {
    const p = progresso();
    p.apply(evento({ stage: "audit", subject: "project-phases.md" }));
    expect(p.model().stage).toBe("auditoria · project-phases");
  });

  it("assunto com sufixo de gaps ainda aponta para o passo", () => {
    const p = progresso();
    p.apply(evento({ stage: "interview", subject: "project-phases.md:gaps", status: "retry" }));
    expect(p.model().pipeline[1]?.state).toBe("em andamento");
  });

  it("devolução conta como correção", () => {
    const p = progresso();
    p.apply(evento({ stage: "audit", status: "retry" }));
    p.apply(evento({ stage: "audit", status: "retry" }));
    expect(p.model().telemetry.find((metric) => metric.label === "DEVOLUÇÕES")?.value).toBe("2");
  });

  it("bloqueio aparece como falha, no passo e na situação", () => {
    const p = progresso();
    p.apply(evento({ stage: "authoring", status: "blocked", subject: "project-phases.md" }));
    expect(p.model().status.state).toBe("falhou");
    expect(p.model().pipeline[1]?.state).toBe("falhou");
  });

  it("RALPH READY fecha a situação", () => {
    const p = progresso();
    p.apply(evento({ stage: "ready", subject: "-", status: "complete" }));
    expect(p.model().status.label).toBe("RALPH READY");
  });

  it("tokens e custo somam por chamada; sem relato, dizem que não mediram", () => {
    const p = progresso();
    p.charge({ inputTokens: 1000, outputTokens: 50, costUsd: 0.01 });
    p.charge({ inputTokens: 500, outputTokens: 25, costUsd: 0.005 });
    p.charge();

    const telemetria = new Map(p.model().telemetry.map((metric) => [metric.label, metric.value]));
    expect(telemetria.get("CHAMADAS")).toBe("3");
    expect(telemetria.get("ENTRADA")).toBe("1.500");
    expect(telemetria.get("CUSTO")).toBe("US$ 0.0150");
    expect(progresso().model().telemetry.find((m) => m.label === "ENTRADA")?.value).toBe("não medido");
  });

  it("o log mantém só as últimas linhas: painel não é histórico", () => {
    const p = progresso();
    for (let i = 0; i < 30; i += 1) p.note(`linha ${i}`);
    expect(p.model().events.length).toBeLessThanOrEqual(12);
    expect(p.model().events.at(-1)?.text).toBe("linha 29");
  });

  it("o modelo rende sem quebrar e cabe na largura pedida", () => {
    const p = progresso();
    p.apply(evento({ stage: "authoring", subject: "project-phases.md" }));
    p.note("escrevendo 7 fase(s), até 3 por vez");
    const view = renderDashboard({ ...p.model(), width: 90 });
    expect(view).toContain("plano executável");
    for (const line of view.split("\n")) expect(line.length).toBeLessThanOrEqual(90);
  });
});

describe("o painel diz o que está acontecendo agora", () => {
  it("chamando o provider, mostra o que está sendo feito e há quanto tempo", () => {
    let agora = new Date("2026-09-18T03:00:00Z");
    const p = new HarnessProgress({
      version: "0.1.0",
      project: "/p",
      provider: { perfil: "codex", transporte: "codex-cli", contabilidade: "por chamada" },
      style: plain,
      environment: {},
      now: () => agora,
    });

    p.beginCall("writer · project-phases");
    agora = new Date("2026-09-18T03:00:47Z");

    const view = renderDashboard(p.model());
    expect(view).toContain("writer · project-phases");
    expect(view).toContain("0m 47s nesta chamada");
  });

  it("esperando o desenvolvedor, diz isso com todas as letras", () => {
    const p = progresso();
    p.waitingForDeveloper();
    expect(renderDashboard(p.model())).toContain("aguardando sua resposta");
  });

  it("parado, diz o motivo em vez de parecer vivo", () => {
    const p = progresso();
    p.halted("impasse em project-phases.md");
    const view = renderDashboard(p.model());
    expect(view).toContain("parado");
    expect(view).toContain("impasse em project-phases.md");
  });

  it("o quadro do pulso muda a cada tick: é a prova de vida", () => {
    const p = progresso();
    p.beginCall("escrevendo");
    const antes = renderDashboard(p.model());
    p.tick();
    expect(renderDashboard(p.model())).not.toBe(antes);
  });

  it("passo reaproveitado aparece concluído, não aguardando", () => {
    const p = progresso();
    p.apply(evento({ stage: "publish", status: "complete", detail: "reaproveitado deste run" }));
    expect(p.model().pipeline[0]?.state).toBe("concluído");
  });
});

describe("a pergunta mora dentro do painel", () => {
  it("ocupa o corpo no lugar da janela de log", () => {
    const p = progresso();
    p.note("isto não deve aparecer enquanto a pergunta estiver na tela");
    p.asking({ title: "PERGUNTA 1/3 · entrevista", body: ["Qual stack?", "  1. Node"] });

    const view = renderDashboard(p.model());
    expect(view).toContain("PERGUNTA 1/3");
    expect(view).toContain("Qual stack?");
    expect(view).not.toContain("O QUE ESTÁ ACONTECENDO");
  });

  it("respondida, a janela de log volta", () => {
    const p = progresso();
    p.note("escrevendo");
    p.asking({ title: "PERGUNTA 1/3", body: ["Qual stack?"] });
    p.asking(null);
    expect(renderDashboard(p.model())).toContain("O QUE ESTÁ ACONTECENDO");
  });

  it("o nome do produto substitui o da pasta assim que ele existe", () => {
    const p = progresso();
    expect(renderDashboard(p.model())).toContain("piloto-3");
    p.setProject("Quadro Kanban Pessoal");
    expect(renderDashboard(p.model())).toContain("Quadro Kanban Pessoal");
  });

  it("nome vazio não apaga o que já havia", () => {
    const p = progresso();
    p.setProject("   ");
    expect(renderDashboard(p.model())).toContain("piloto-3");
  });
});

describe("largura", () => {
  it("acompanha o terminal em vez de parar num teto fixo", () => {
    const p = progresso();
    const largo = renderDashboard({ ...p.model(), width: 160 });
    expect(Math.max(...largo.split("\n").map((line) => line.length))).toBeGreaterThan(120);
  });

  it("em terminal estreito, as colunas empilham em vez de virar reticências", () => {
    const p = progresso();
    const estreito = renderDashboard({ ...p.model(), width: 64 });
    for (const line of estreito.split("\n")) expect(line.length).toBeLessThanOrEqual(64);
    expect(estreito).toContain("DURAÇÃO");
    expect(estreito).toContain("STATUS");
  });
});

describe("região viva", () => {
  it("sem terminal, não escreve nada — o log continua sendo a saída", () => {
    const escrito: string[] = [];
    const region = createLiveRegion((text) => void escrito.push(text), false);
    region.draw("qualquer coisa");
    expect(escrito).toEqual([]);
    expect(region.enabled).toBe(false);
  });

  it("o segundo desenho sobe e apaga o primeiro", () => {
    const escrito: string[] = [];
    const region = createLiveRegion((text) => void escrito.push(text), true);
    region.draw("uma\nduas\ntrês");
    region.draw("nova");
    expect(escrito[0]).not.toContain("[3A");
    expect(escrito[1]).toContain("[3A");
  });

  it("depois de soltar, o desenho seguinte não apaga o que virou histórico", () => {
    const escrito: string[] = [];
    const region = createLiveRegion((text) => void escrito.push(text), true);
    region.draw("uma\nduas");
    region.release();
    region.draw("nova");
    expect(escrito[1]).not.toContain("A");
  });
});

/*
 * Os dois estágios compartilham o painel, e por um tempo o `plan` desenhou o
 * cabeçalho do `init`: "INIT · do prompt ao RALPH READY" numa execução que
 * começa com o esqueleto pronto e termina exatamente no RALPH READY.
 */
describe("o cabeçalho diz qual estágio está na tela", () => {
  const painel = (command?: "init" | "plan") =>
    new HarnessProgress({
      version: "0.0.0",
      project: "x",
      roles: [],
      provider: { perfil: "p", transporte: "t", contabilidade: "c" },
      style: { enabled: false },
      ...(command ? { command } : {}),
    }).model();

  it("o init vai do pedido ao PLAN READY", () => {
    expect(painel("init").subtitle).toContain("PLAN READY");
    expect(painel("init").command).toBe("init");
  });

  it("o plan parte do esqueleto e vai ao RALPH READY", () => {
    expect(painel("plan").subtitle).toContain("esqueleto");
    expect(painel("plan").subtitle).toContain("RALPH READY");
    expect(painel("plan").command).toBe("plan");
  });

  it("omitido, continua sendo o init", () => {
    expect(painel().command).toBe("init");
  });
});
