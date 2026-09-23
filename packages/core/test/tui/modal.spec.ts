import { describe, expect, it } from "vitest";

import { abrirModal, alturaDoCorpo, dobrar, encolher, larguraDoModal, posicao, renderModal, rolar, teclaDe } from "../../src/tui/modal.js";
import { visibleWidth } from "../../src/tui/ansi.js";

const TELA = { columns: 80, rows: 24 };

const modal = (corpo: string[]) => ({ titulo: "PAROU — P03", cabecalho: ["o quê   a suíte reprovou"], corpo });

describe("dobra de linhas", () => {
  it("não corta: o que não cabe desce para a linha seguinte", () => {
    const dobrada = dobrar(["a".repeat(50)], 20);
    expect(dobrada.join("")).toBe("a".repeat(50));
    expect(dobrada.every((linha) => visibleWidth(linha) <= 20)).toBe(true);
  });

  it("não inventa reticências — isso seria perder texto do log", () => {
    expect(dobrar(["x".repeat(30)], 10).join("")).not.toContain("…");
  });

  it("quebra no espaço quando há um perto do fim", () => {
    expect(dobrar(["palavra outra palavra"], 12)[0]).toBe("palavra");
  });

  it("repete a indentação na continuação", () => {
    const dobrada = dobrar(["    " + "b".repeat(30)], 16);
    expect(dobrada[1]!.startsWith("    ")).toBe(true);
  });

  it("deixa a cor atravessar sem contá-la na largura", () => {
    const dobrada = dobrar([`\u001B[31m${"c".repeat(20)}\u001B[0m`], 30);
    expect(dobrada).toHaveLength(1);
  });

  it("devolve uma linha vazia em vez de nada", () => {
    expect(dobrar([], 20)).toEqual([""]);
  });
});

describe("rolagem", () => {
  const total = 100;
  const visiveis = 10;

  it("anda uma linha com as setas", () => {
    expect(rolar(0, "baixo", total, visiveis)).toBe(1);
    expect(rolar(5, "cima", total, visiveis)).toBe(4);
  });

  it("não passa do topo nem do fim", () => {
    expect(rolar(0, "cima", total, visiveis)).toBe(0);
    expect(rolar(90, "baixo", total, visiveis)).toBe(90);
  });

  it("anda uma página com PgUp e PgDn, com uma linha de sobreposição", () => {
    expect(rolar(0, "pagina-abaixo", total, visiveis)).toBe(9);
    expect(rolar(20, "pagina-acima", total, visiveis)).toBe(11);
  });

  it("vai ao topo e ao fim", () => {
    expect(rolar(42, "topo", total, visiveis)).toBe(0);
    expect(rolar(0, "fim", total, visiveis)).toBe(90);
  });

  it("não rola quando tudo já cabe", () => {
    expect(rolar(0, "fim", 5, 10)).toBe(0);
  });

  it("reconhece setas, PgUp/PgDn e as saídas", () => {
    expect(teclaDe("\u001B[A")).toBe("cima");
    expect(teclaDe("\u001B[B")).toBe("baixo");
    expect(teclaDe("\u001B[5~")).toBe("pagina-acima");
    expect(teclaDe("\u001B[6~")).toBe("pagina-abaixo");
    expect(teclaDe("q")).toBe("sair");
    expect(teclaDe("\u001B")).toBe("sair");
    expect(teclaDe("\u0003")).toBe("sair");
    expect(teclaDe("z")).toBe("nenhuma");
  });
});

describe("desenho do modal", () => {
  it("mantém o cabeçalho parado enquanto o corpo rola", () => {
    const corpo = Array.from({ length: 200 }, (_, indice) => `linha ${indice}`);
    const primeiro = renderModal(modal(corpo), { tela: TELA, offset: 0 }).join("\n");
    const rolado = renderModal(modal(corpo), { tela: TELA, offset: 50 }).join("\n");

    expect(primeiro).toContain("a suíte reprovou");
    expect(rolado).toContain("a suíte reprovou");
    expect(primeiro).toContain("linha 0");
    expect(rolado).not.toContain("linha 0\n");
    expect(rolado).toContain("linha 50");
  });

  it("desenha todas as linhas com a mesma largura, moldura fechada", () => {
    const linhas = renderModal(modal(["a", "b"]), { tela: TELA, offset: 0 });
    const larguras = new Set(linhas.map((linha) => visibleWidth(linha)));
    expect(larguras.size).toBe(1);
    expect(linhas[0]).toContain("╭");
    expect(linhas.at(-1)).toContain("╯");
  });

  it("centra na horizontal", () => {
    const linhas = renderModal(modal(["a"]), { tela: { columns: 100, rows: 24 }, offset: 0 });
    const margem = /^ */.exec(linhas[0]!)![0].length;
    expect(margem).toBe(Math.floor((100 - larguraDoModal({ columns: 100, rows: 24 })) / 2));
  });

  it("diz onde está, já que não há barra de rolagem", () => {
    const corpo = Array.from({ length: 200 }, (_, indice) => `l${indice}`);
    const texto = renderModal(modal(corpo), { tela: TELA, offset: 0 }).join("\n");
    expect(texto).toMatch(/linha 1–\d+ de 200/);
    expect(texto).toContain("q fecha");
  });

  it("não deixa o deslocamento passar do fim do conteúdo", () => {
    const linhas = renderModal(modal(["a", "b", "c"]), { tela: TELA, offset: 9999 });
    expect(linhas.join("\n")).toContain("a");
  });

  it("preenche o corpo até a altura, para a moldura não encolher", () => {
    const cheio = renderModal(modal(Array.from({ length: 100 }, () => "x")), { tela: TELA, offset: 0 });
    const vazio = renderModal(modal(["x"]), { tela: TELA, offset: 0 });
    expect(vazio.length).toBe(cheio.length);
  });

  it("cabe em telas pequenas sem quebrar a conta", () => {
    for (const tela of [{ columns: 40, rows: 10 }, { columns: 200, rows: 60 }, { columns: 30, rows: 6 }]) {
      const linhas = renderModal(modal(["x", "y"]), { tela, offset: 0 });
      expect(alturaDoCorpo(tela, 1)).toBeGreaterThanOrEqual(1);
      expect(new Set(linhas.map((linha) => visibleWidth(linha))).size).toBe(1);
    }
  });

  it("não deixa o cabeçalho comer a tela de um terminal baixo", () => {
    const relatorio = Array.from({ length: 14 }, (_, indice) => `linha ${indice} do relatório`);
    const encolhido = encolher(relatorio, { columns: 80, rows: 16 });

    expect(encolhido.length).toBeLessThan(relatorio.length);
    expect(encolhido.at(-1)).toContain("abaixo da telinha");

    const linhas = renderModal({ titulo: "x", cabecalho: relatorio, corpo: ["a", "b", "c", "d"] }, { tela: { columns: 80, rows: 16 }, offset: 0 });
    expect(linhas.join("\n")).toContain("a");
    expect(new Set(linhas.map((linha) => visibleWidth(linha))).size).toBe(1);
  });

  it("deixa o cabeçalho inteiro quando a tela comporta", () => {
    const relatorio = ["uma", "duas", "três"];
    expect(encolher(relatorio, { columns: 80, rows: 40 })).toEqual(relatorio);
  });

  it("conta a posição como linhas, não como porcentagem solta", () => {
    expect(posicao(0, 10, 5)).toBe("5 linha(s)");
    expect(posicao(0, 10, 100)).toContain("0%");
    expect(posicao(90, 10, 100)).toContain("100%");
  });
});

describe("abertura do modal", () => {
  function terminal() {
    const escrito: string[] = [];
    let ouvinte: ((chunk: string) => void) | null = null;
    let raw = false;
    return {
      escrito,
      get raw() {
        return raw;
      },
      digitar: (texto: string) => ouvinte?.(texto),
      entrada: {
        isTTY: true,
        setRawMode: (valor: boolean) => {
          raw = valor;
        },
        resume: () => undefined,
        pause: () => undefined,
        on: (_evento: "data", fn: (chunk: string) => void) => {
          ouvinte = fn;
        },
        off: () => {
          ouvinte = null;
        },
      },
      saida: { isTTY: true, columns: 80, rows: 24, write: (texto: string) => escrito.push(texto) },
    };
  }

  it("não abre nada sem terminal — o texto puro é o piso", async () => {
    const aberto = await abrirModal(modal(["x"]), {
      entrada: { isTTY: false, resume: () => undefined, pause: () => undefined, on: () => undefined, off: () => undefined },
      saida: { isTTY: false, write: () => undefined },
    });
    expect(aberto).toBe(false);
  });

  it("restaura o terminal ao fechar", async () => {
    const t = terminal();
    const promessa = abrirModal(modal(["x"]), t);
    await new Promise((resolve) => setImmediate(resolve));
    expect(t.raw).toBe(true);
    t.digitar("q");
    expect(await promessa).toBe(true);
    expect(t.raw).toBe(false);
    const tudo = t.escrito.join("");
    expect(tudo).toContain("\u001B[?1049h");
    expect(tudo).toContain("\u001B[?1049l");
    expect(tudo).toContain("\u001B[?25h");
  });

  it("repinta ao rolar e ignora tecla sem efeito", async () => {
    const t = terminal();
    const promessa = abrirModal(modal(Array.from({ length: 100 }, (_, i) => `l${i}`)), t);
    await new Promise((resolve) => setImmediate(resolve));
    const antes = t.escrito.length;
    t.digitar("z");
    expect(t.escrito.length).toBe(antes);
    t.digitar("\u001B[B");
    expect(t.escrito.length).toBeGreaterThan(antes);
    t.digitar("q");
    await promessa;
  });
});
