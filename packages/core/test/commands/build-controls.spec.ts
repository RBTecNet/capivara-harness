/**
 * Pausar e ver uma fase no meio do build, sem terminal.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { PauseGate, modalDaFase, teclasDoBuild, textoDaFase } from "../../src/commands/build-controls.js";
import { createKeySession } from "../../src/commands/key-io.js";
import { createLiveRegion } from "../../src/tui/live.js";
import { initialSelect, reduceSelect } from "../../src/tui/select.js";
import { renderDashboard } from "../../src/tui/index.js";
import { emptyGates } from "../../src/tui/build-phases.js";

const plain = { enabled: false };
const ESC = "\u001B";

describe("pausa", () => {
  it("pedir não para nada sozinho: a próxima chamada é que espera", async () => {
    const pausa = new PauseGate();
    expect(await pausa.wait(() => undefined)).toBe(false);
    expect(pausa.toggle()).toBe("pedida");
    expect(pausa.state).toBe("pausa pedida");

    let pausou = false;
    let passou = false;
    const espera = pausa.wait(() => (pausou = true)).then(() => (passou = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(pausou).toBe(true);
    expect(passou).toBe(false);
    expect(pausa.state).toBe("pausado");

    expect(pausa.toggle()).toBe("retomada");
    await espera;
    expect(passou).toBe(true);
    expect(pausa.state).toBe("rodando");
    // Retomada não deixa pedido pendurado: a chamada seguinte passa direto.
    expect(await pausa.wait(() => undefined)).toBe(false);
  });

  it("a mesma tecla desiste do pedido antes de ele acontecer", async () => {
    const pausa = new PauseGate();
    pausa.toggle();
    expect(pausa.toggle()).toBe("cancelada");
    expect(await pausa.wait(() => undefined)).toBe(false);
  });

  it("o rodapé diz o que a tecla faz em cada estado", () => {
    expect(teclasDoBuild("rodando")).toBe("p pausa · f vê uma fase");
    expect(teclasDoBuild("pausa pedida")).toContain("p desiste da pausa");
    expect(teclasDoBuild("pausado")).toContain("p retoma");
  });
});

describe("ver uma fase", () => {
  const fase = {
    id: "P03",
    title: "Cadastro de clientes",
    state: "em andamento" as const,
    gates: { ...emptyGates(), G0: "verde" as const, G1: "verde" as const, G2: "vermelho" as const },
    detail: "ciclo 2/3",
    tasks: 4,
  };

  it("estado, gates e tasks ficam fixos em cima; o texto da fase e os eventos dela rolam", () => {
    const modal = modalDaFase(
      fase,
      "## Phase 3: Cadastro de clientes\n- [ ] **Task:** criar o formulário",
      [
        { time: "10:00:01", text: "[P02] concluída" },
        { time: "10:05:12", text: "[P03] gate 2 reprovou" },
      ],
      plain,
    );
    const cabecalho = (modal.cabecalho as string[]).join("\n");
    expect(modal.titulo).toBe("P03 · Cadastro de clientes");
    expect(cabecalho).toContain("em andamento · ciclo 2/3");
    expect(cabecalho).toContain("G2 suíte");
    expect(cabecalho).toContain("tasks    4");
    expect(modal.corpo.join("\n")).toContain("criar o formulário");
    expect(modal.corpo.join("\n")).toContain("[P03] gate 2 reprovou");
    expect(modal.corpo.join("\n")).not.toContain("[P02]");
  });

  it("sem plano legível, a telinha diz isso em vez de abrir vazia", async () => {
    expect(await textoDaFase("/caminho/que/nao/existe", "P01")).toBeNull();
    expect(modalDaFase(fase, null, [], plain).corpo[0]).toContain("não pôde ser lido");
  });

  it("Esc numa lista que se pode cancelar desiste dela", () => {
    const spec = { title: "Qual fase?", choices: [{ label: "P01" }], defaultIndex: 0, cancelable: true };
    expect(reduceSelect(spec, initialSelect(spec), { type: "escape" }).cancelled).toBe(true);
    expect(reduceSelect({ ...spec, cancelable: false }, initialSelect(spec), { type: "escape" }).cancelled).toBeUndefined();
  });
});

describe("região viva segurada", () => {
  it("não desenha enquanto segura, e o desenho seguinte cai em cima do painel, não embaixo", async () => {
    const escrito: string[] = [];
    const region = createLiveRegion((text) => void escrito.push(text), true);
    region.draw("a\nb\nc");
    await region.hold(async () => {
      region.draw("ignorado");
    });
    expect(escrito.join("")).not.toContain("ignorado");
    region.draw("d\ne\nf");
    expect(escrito.at(-1)).toContain(`${ESC}[3A`);
  });
});

describe("atalhos da sessão de teclas", () => {
  function sessao() {
    const input = new EventEmitter() as EventEmitter & { setRawMode: (mode: boolean) => void };
    input.setRawMode = () => undefined;
    let interrompido = 0;
    const session = createKeySession({ input: input as never, write: () => undefined, interrupt: () => void (interrompido += 1) });
    return { session, input, interrompido: () => interrompido };
  }

  it("sem pergunta aberta, a tecla vai para o atalho; a que ele não atende conta como batida antes da hora", () => {
    const { session, input } = sessao();
    const atendidas: string[] = [];
    session.onIdle((tecla) => {
      if (tecla.type === "char" && tecla.text === "p") {
        atendidas.push("p");
        return true;
      }
      return false;
    });
    input.emit("data", "pxp");
    expect(atendidas).toEqual(["p", "p"]);
    expect(session.takeEarly()).toBe(1);
    session.close();
  });

  it("capturada, a entrada vai crua para outro leitor — menos o Ctrl-C, que continua da sessão", () => {
    const { session, input, interrompido } = sessao();
    const recebido: string[] = [];
    const soltar = session.capture((texto) => recebido.push(texto));
    input.emit("data", `${ESC}[Bq`);
    expect(recebido).toEqual([`${ESC}[Bq`]);
    soltar();
    input.emit("data", "x");
    expect(recebido).toHaveLength(1);
    session.capture(() => undefined);
    input.emit("data", "\u0003");
    expect(interrompido()).toBe(1);
  });
});

describe("painel com pausa", () => {
  it("a atividade pausada diz há quanto tempo e como retomar, e o rodapé mostra as teclas", () => {
    const view = renderDashboard({
      version: "0.3.5",
      command: "build",
      subtitle: "build",
      project: "x",
      stage: "P03",
      status: { label: "em andamento", state: "em andamento" },
      durationSeconds: 10,
      pipeline: [],
      provider: { perfil: "p", transporte: "t", contabilidade: "c" },
      telemetry: [],
      events: [],
      activity: { kind: "pausado", detail: "antes de builder · P03 · p retoma", sinceSeconds: 65 },
      keys: teclasDoBuild("pausado"),
      width: 120,
      style: plain,
      environment: {},
    });
    expect(view).toContain("⏸ pausado — há 1m 05s · antes de builder · P03 · p retoma");
    expect(view).toContain("p retoma · f vê uma fase · Ctrl-C interrompe com estado retomável");
  });
});
