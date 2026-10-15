/**
 * As peças da entrada por tecla, sem terminal: decodificador, lista, campo e a
 * tela que junta os três.
 */

import { describe, expect, it } from "vitest";
import { KeyDecoder, type Key } from "../../src/tui/keys.js";
import { initialSelect, reduceSelect, renderSelect, type SelectSpec, type SelectState } from "../../src/tui/select.js";
import { reduceTextField, renderTextField, type TextFieldSpec, type TextFieldStep } from "../../src/tui/text-field.js";
import { cleanPrompt, renderWizardScreen } from "../../src/tui/wizard-screen.js";
import { visibleWidth } from "../../src/tui/index.js";

const plain = { enabled: false };
const ESC = "\u001B";

function keys(...chunks: string[]): Key[] {
  const decoder = new KeyDecoder();
  return chunks.flatMap((chunk) => decoder.feed(chunk));
}

describe("decodificador de teclas", () => {
  it("setas, Enter, Backspace e controles", () => {
    expect(keys(`${ESC}[A${ESC}[B\r\u007F\u0003\u0004\u0015\t`).map((key) => key.type)).toEqual([
      "up", "down", "enter", "backspace", "ctrl-c", "ctrl-d", "ctrl-u", "tab",
    ]);
  });

  it("as setas do modo de aplicação também", () => {
    expect(keys(`${ESC}OA${ESC}OB`).map((key) => key.type)).toEqual(["up", "down"]);
  });

  it("colagem vira UMA tecla com o texto inteiro, mesmo partida entre pedaços", () => {
    const decoded = keys(`${ESC}[200~um quadro\r\nkanban`, " pessoal", `${ESC}[20`, "1~x");
    expect(decoded).toEqual([
      { type: "paste", text: "um quadro\nkanban pessoal" },
      { type: "char", text: "x" },
    ]);
  });

  it("a marca de início partida espera o resto", () => {
    expect(keys(`${ESC}[20`, `0~abc${ESC}[201~`)).toEqual([{ type: "paste", text: "abc" }]);
  });

  it("Esc sozinho é a tecla Esc", () => {
    expect(keys(ESC)).toEqual([{ type: "escape" }]);
  });

  it("acentos e emoji chegam como um caractere", () => {
    expect(keys("ção😀").map((key) => (key.type === "char" ? key.text : key.type))).toEqual(["ç", "ã", "o", "😀"]);
  });
});

const PROVIDERS: SelectSpec = {
  title: "Qual provider?",
  choices: [{ label: "codex" }, { label: "claude", hint: "usa a CLI" }, { label: "gemini" }],
  defaultIndex: 1,
};

function drive(spec: SelectSpec, sequence: Key[]): { state: SelectState; chosen?: number } {
  let state = initialSelect(spec);
  for (const key of sequence) {
    const step = reduceSelect(spec, state, key);
    state = step.state;
    if (step.chosen !== undefined) return { state, chosen: step.chosen };
  }
  return { state };
}

describe("lista de escolha", () => {
  it("o cursor começa no padrão e o Enter o aceita", () => {
    expect(drive(PROVIDERS, [{ type: "enter" }]).chosen).toBe(1);
  });

  it("as setas movem e dão a volta", () => {
    expect(drive(PROVIDERS, [{ type: "down" }, { type: "down" }, { type: "enter" }]).chosen).toBe(0);
    expect(drive(PROVIDERS, [{ type: "up" }, { type: "enter" }]).chosen).toBe(0);
  });

  it("o número MOVE o cursor; só o Enter confirma", () => {
    const parcial = drive(PROVIDERS, [{ type: "char", text: "3" }]);
    expect(parcial.chosen).toBeUndefined();
    expect(parcial.state.cursor).toBe(2);
    expect(drive(PROVIDERS, [{ type: "char", text: "3" }, { type: "enter" }]).chosen).toBe(2);
  });

  it("dois dígitos chegam à opção 12", () => {
    const doze: SelectSpec = { title: "x", choices: Array.from({ length: 12 }, (_, i) => ({ label: `m${i + 1}` })), defaultIndex: 0 };
    expect(drive(doze, [{ type: "char", text: "1" }, { type: "char", text: "2" }, { type: "enter" }]).chosen).toBe(11);
  });

  it("número fora da faixa avisa e não move", () => {
    const { state, chosen } = drive(PROVIDERS, [{ type: "char", text: "9" }]);
    expect(chosen).toBeUndefined();
    expect(state.cursor).toBe(1);
    expect(state.message).toContain("de 1 a 3");
  });

  it("colagem é recusada com aviso e não escolhe nada", () => {
    const { state, chosen } = drive(PROVIDERS, [{ type: "paste", text: "um sistema de reservas\npara uma pousada" }]);
    expect(chosen).toBeUndefined();
    expect(state.message).toContain("Colagem ignorada");
    expect(renderSelect(PROVIDERS, state, 80, 10, plain).join("\n")).toContain("Colagem ignorada");
  });

  it("a linha de manter fica no topo, sem número, e devolve o padrão negativo", () => {
    const manter: SelectSpec = { ...PROVIDERS, defaultIndex: -1, keepLabel: "Enter mantém codex" };
    expect(drive(manter, [{ type: "enter" }]).chosen).toBe(-1);
    expect(drive(manter, [{ type: "char", text: "1" }, { type: "enter" }]).chosen).toBe(0);
    const tela = renderSelect(manter, initialSelect(manter), 80, 10, plain);
    expect(tela[0]).toContain("Enter mantém codex");
    expect(tela[1]).toContain("1) codex");
  });

  it("marca o cursor, o padrão e a dica", () => {
    const tela = renderSelect(PROVIDERS, initialSelect(PROVIDERS), 80, 10, plain).join("\n");
    expect(tela).toContain("❯ 2) claude (padrão) — usa a CLI");
  });

  it("lista maior que a janela rola com o cursor e diz quanto ficou de fora", () => {
    const longa: SelectSpec = { title: "x", choices: Array.from({ length: 30 }, (_, i) => ({ label: `modelo-${i + 1}` })), defaultIndex: 14 };
    const tela = renderSelect(longa, initialSelect(longa), 80, 8, plain);
    expect(tela).toHaveLength(8);
    expect(tela.join("\n")).toContain("modelo-15");
    expect(tela[0]).toContain("↑ mais");
    expect(tela[7]).toContain("↓ mais");
  });
});

describe("campo de texto", () => {
  const linha: TextFieldSpec = { label: "Pasta do projeto [/projeto]: ", placeholder: "/projeto" };
  const varias: TextFieldSpec = { label: "O que construir?", multiline: true };

  function type(spec: TextFieldSpec, sequence: Key[]): TextFieldStep {
    let state = { value: "" };
    for (const key of sequence) {
      const step = reduceTextField(spec, state, key);
      state = step.state;
      if (step.submitted !== undefined || step.ended) return step;
    }
    return { state };
  }

  it("digita, apaga e entrega no Enter", () => {
    const step = type(linha, [{ type: "char", text: "a" }, { type: "char", text: "b" }, { type: "backspace" }, { type: "char", text: "c" }, { type: "enter" }]);
    expect(step.submitted).toBe("ac");
  });

  it("numa linha, a colagem fica no campo com as quebras viradas espaço — não responde nada", () => {
    const step = type(linha, [{ type: "paste", text: "um\nquadro\nkanban" }]);
    expect(step.submitted).toBeUndefined();
    expect(step.state.value).toBe("um quadro kanban");
  });

  it("várias linhas: Enter quebra, o ponto sozinho termina", () => {
    const step = type(varias, [
      { type: "paste", text: "um quadro kanban\npessoal" },
      { type: "enter" },
      { type: "char", text: "." },
      { type: "enter" },
    ]);
    expect(step.submitted).toBe("um quadro kanban\npessoal");
  });

  it("Ctrl-D num campo de linha vazio é o fim da entrada", () => {
    expect(type(linha, [{ type: "ctrl-d" }]).ended).toBe(true);
  });

  it("o campo vazio mostra o padrão apagado", () => {
    expect(renderTextField(linha, { value: "" }, 80, 1, plain)[0]).toContain("/projeto");
  });
});

describe("tela do wizard", () => {
  const base = {
    version: "0.3.5",
    subtitle: "wizard · monta o comando com você",
    history: [{ question: "\nPasta do projeto [/projeto]: ", answer: "/projeto" }],
    notes: ["capivara · monta o comando com você e imprime o equivalente no fim\n"],
    prompt: { kind: "select" as const, spec: PROVIDERS, state: initialSelect(PROVIDERS) },
    width: 100,
    height: 40,
    style: plain,
    environment: {},
  };

  it("mostra o que já foi escolhido, o que o wizard disse e a pergunta da vez", () => {
    const tela = renderWizardScreen(base);
    expect(tela).toContain("SUAS ESCOLHAS");
    expect(tela).toContain("Pasta do projeto");
    expect(tela).toContain("/projeto");
    expect(tela).toContain("imprime o equivalente");
    expect(tela).toContain("Qual provider?");
    expect(tela).toContain("❯ 2) claude");
    expect(tela).toContain("Enter confirma");
  });

  it("cabe na altura e na largura do terminal", () => {
    for (const [width, height] of [[60, 16], [80, 24], [160, 50]] as const) {
      const linhas = renderWizardScreen({ ...base, width, height }).split("\n");
      expect(linhas.length).toBeLessThanOrEqual(height - 1);
      for (const linha of linhas) expect(visibleWidth(linha)).toBeLessThanOrEqual(width);
    }
  });

  it("em terminal baixo a pergunta fica e o histórico sai primeiro", () => {
    const muitas = Array.from({ length: 12 }, (_, i) => ({ question: `Pergunta ${i}`, answer: `r${i}` }));
    const tela = renderWizardScreen({ ...base, history: muitas, height: 16 });
    expect(tela).toContain("❯ 2) claude");
    expect(tela).toContain("1) codex");
    expect(tela).toContain("3) gemini");
  });

  it("a pontuação do modo de linha sai do título", () => {
    expect(cleanPrompt("\nPasta do projeto [/home/x]: ")).toBe("Pasta do projeto");
    expect(cleanPrompt("Ciclos de correção por fase [3]: ")).toBe("Ciclos de correção por fase");
    expect(cleanPrompt("Executar agora?")).toBe("Executar agora?");
  });
});
