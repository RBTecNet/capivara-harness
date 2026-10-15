import { describe, expect, it } from "vitest";
import { sanitizarTerminal } from "../../src/tui/sanitize.js";
import { LogDoAgente, LogsDosAgentes, descreverEventoDoAgente, descreverProgressoDaFase } from "../../src/tui/worker-logs.js";
import { abrirPainel, reduzirPainel, renderPainelDoAgente, type ConteudoDoPainel, type EstadoDoPainel, type Medidas } from "../../src/tui/worker-log-panel.js";
import { WorkerTracker, renderWorkerRows, teclaNaCaixaDeAgentes, type WorkerRow } from "../../src/tui/build-workers.js";
import type { Key } from "../../src/tui/keys.js";

const ESC = "\u001B";
const style = { enabled: false } as const;
const tecla = (type: Exclude<Key["type"], "char" | "paste">): Key => ({ type }) as Key;
const letra = (text: string): Key => ({ type: "char", text });

describe("sanitização da saída de um agente", () => {
  it("nenhuma sequência que o terminal obedece passa", () => {
    const hostil = [
      `${ESC}[2J${ESC}[H`, // limpa a tela e volta ao topo
      `${ESC}]0;título trocado${ESC}\\`, // título da janela
      `${ESC}]52;c;ZXZpbA==\u0007`, // OSC 52: área de transferência
      `${ESC}[?2004l`, // desliga a marcação de colagem
      `${ESC}P1$qm${ESC}\\`, // DCS
      `${ESC}7${ESC}8`, // salva e restaura o cursor
      "\u009b31m", // CSI de 8 bits
      "\u0007\u0008\u000c", // sino, backspace, form feed
    ].join("texto ");
    const limpo = sanitizarTerminal(hostil);
    expect(limpo).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(limpo).toContain("texto");
    expect(limpo).not.toContain("título trocado");
  });

  it("cor do runner vira texto puro; tabulação vira espaço; quebra de linha fica", () => {
    expect(sanitizarTerminal(`${ESC}[31mFAIL${ESC}[0m\ta\nb`)).toBe("FAIL    a\nb");
  });

  it("barra de progresso com \\r fica na última versão da linha", () => {
    expect(sanitizarTerminal("10%\r50%\r100%")).toBe("100%");
    expect(sanitizarTerminal("linha\r\n")).toBe("linha\n");
  });

  it("controles bidirecionais saem: a linha não pode parecer dizer outra coisa", () => {
    expect(sanitizarTerminal("ok ‮desrever‬ fim")).toBe("ok desrever fim");
  });

  it("escape partido entre dois pedaços não escapa: a linha só é limpa inteira", () => {
    const log = new LogDoAgente();
    log.anexar("out", `antes ${ESC}[3`);
    log.anexar("out", "1mvermelho\n");
    expect(log.ver()).toEqual([{ fonte: "out", texto: "antes vermelho" }]);
  });
});

describe("o buffer de cada agente", () => {
  it("guarda só as últimas linhas e conta as que saíram", () => {
    const log = new LogDoAgente({ linhas: 3, caracteres: 100 });
    log.anexar("out", "1\n2\n3\n4\n5\n");
    expect(log.ver().map((linha) => linha.texto)).toEqual(["3", "4", "5"]);
    expect(log.descartadas).toBe(2);
  });

  it("linha longa é cortada na memória e diz onde está inteira", () => {
    const log = new LogDoAgente({ linhas: 10, caracteres: 5 });
    log.anexar("out", "abcdefghij\n");
    expect(log.ver()[0]!.texto).toMatch(/^abcde … \(\+5 caracteres; a linha inteira está no arquivo do log\)$/);
  });

  it("linha que nunca termina não cresce sem fim", () => {
    const log = new LogDoAgente({ linhas: 10, caracteres: 10 });
    for (let vez = 0; vez < 100; vez += 1) log.anexar("out", "xxxxxxxxxx");
    expect(log.ver().length).toBeGreaterThan(0);
    for (const linha of log.ver()) expect(linha.texto.length).toBeLessThan(100);
  });

  it("stdout e stderr nunca se emendam no meio de uma linha", () => {
    const log = new LogDoAgente();
    log.anexar("out", "meio de ");
    log.anexar("err", "erro\n");
    log.anexar("out", "linha\n");
    expect(log.ver()).toEqual([
      { fonte: "err", texto: "erro" },
      { fonte: "out", texto: "meio de linha" },
    ]);
  });

  it("os agentes não compartilham nada: o que um escreve o outro não vê", () => {
    const logs = new LogsDosAgentes(3);
    logs.comecarChamada(0, "executor · P02 · tentativa 1", 1000);
    logs.log(0)!.anexar("out", "do agente 1\n");
    logs.log(2)!.anexar("err", "do agente 3\n");
    logs.eventosDe(0)!.registrar("trabalhando em P02", new Date(0));

    expect(logs.log(0)!.ver().map((linha) => linha.texto)).toEqual(["▶ executor · P02 · tentativa 1", "do agente 1"]);
    expect(logs.log(1)!.ver()).toEqual([]);
    expect(logs.log(2)!.ver()).toEqual([{ fonte: "err", texto: "do agente 3" }]);
    expect(logs.eventosDe(1)!.ver()).toEqual([]);
    expect(logs.inicioDaChamada(0)).toBe(1000);
    expect(logs.inicioDaChamada(1)).toBeNull();
    logs.terminarChamada(0, "terminou");
    expect(logs.inicioDaChamada(0)).toBeNull();
  });

  it("a versão muda quando o agente muda, e só dele", () => {
    const logs = new LogsDosAgentes(2);
    const antes = [logs.versao(0), logs.versao(1)];
    logs.log(0)!.anexar("out", "x");
    expect(logs.versao(0)).not.toBe(antes[0]);
    expect(logs.versao(1)).toBe(antes[1]);
  });

  it("eventos vêm dos campos do evento do loop", () => {
    expect(descreverEventoDoAgente({ state: "preparando", phaseId: "P03", detail: "" })).toBe("pegou P03: preparando o worktree");
    expect(descreverEventoDoAgente({ state: "livre", phaseId: null, detail: "P03 conflito" })).toBe("livre · P03 conflito");
    expect(descreverProgressoDaFase({ kind: "gate", id: "P03", gate: "G2", state: "vermelho" })).toBe("P03 · G2 vermelho");
  });
});

describe("a caixa AGENTES no painel do build", () => {
  it("↑ ↓ e Tab dão a volta; Enter abre; o resto não é dela", () => {
    expect(teclaNaCaixaDeAgentes(0, { type: "up" }, 3)).toEqual({ selecionado: 2 });
    expect(teclaNaCaixaDeAgentes(2, { type: "down" }, 3)).toEqual({ selecionado: 0 });
    expect(teclaNaCaixaDeAgentes(1, { type: "tab" }, 3)).toEqual({ selecionado: 2 });
    expect(teclaNaCaixaDeAgentes(1, { type: "enter" }, 3)).toEqual({ selecionado: 1, abrir: true });
    expect(teclaNaCaixaDeAgentes(1, { type: "char" }, 3)).toBeNull();
  });

  it("o cursor aparece só no agente escolhido, e só quando há teclado", () => {
    const linhas = new WorkerTracker(["a", "b"]).rows();
    const comCursor = renderWorkerRows(linhas, [], 80, style, 1);
    expect(comCursor[0]!.startsWith("  ")).toBe(true);
    expect(comCursor[1]!.startsWith("❯ ")).toBe(true);
    expect(renderWorkerRows(linhas, [], 80, style)[0]!.startsWith(" 1")).toBe(true);
  });

  it("o relógio da fase começa quando o agente a pega e para quando fica livre", () => {
    let agora = 1000;
    const agentes = new WorkerTracker(["a"], () => agora);
    agentes.apply({ slot: 0, state: "preparando", phaseId: "P02", detail: "" });
    agora = 5000;
    agentes.apply({ slot: 0, state: "trabalhando", phaseId: "P02", detail: "" });
    expect(agentes.rows()[0]!.since).toBe(1000);
    agentes.apply({ slot: 0, state: "livre", phaseId: null, detail: "P02 integrada" });
    expect(agentes.rows()[0]!.since).toBeNull();
  });
});

function conteudo(parcial: Partial<ConteudoDoPainel> & { linhas: ConteudoDoPainel["linhas"] }): ConteudoDoPainel {
  const agente: WorkerRow = { slot: 1, label: "codex/m-b", state: "trabalhando", phaseId: "P03", detail: "", since: 0 };
  return {
    agente,
    fase: { id: "P03", title: "Relatório", state: "em andamento", gates: {}, detail: "ciclo 1/3" },
    descartadas: 0,
    eventos: [{ hora: "10:00:00", texto: "trabalhando em P03" }],
    agora: 125_000,
    inicioDaChamada: 65_000,
    arquivo: ".capivara/runs/build-x/logs/agente-2.out.log",
    totalDeAgentes: 3,
    buildTerminou: false,
    ...parcial,
  };
}

const MUITAS = Array.from({ length: 100 }, (_, indice) => ({ fonte: "out" as const, texto: `linha ${indice + 1}` }));

describe("o painel de log de um agente", () => {
  it("mostra quem é, o modelo, a fase, os tempos medidos e o arquivo", () => {
    const { linhas } = renderPainelDoAgente(conteudo({ linhas: MUITAS }), abrirPainel(1), { columns: 100, rows: 30 }, style);
    const tela = linhas.join("\n");
    expect(tela).toContain("AGENTE 2 de 3 · codex/m-b");
    expect(tela).toContain("trabalhando · P03 Relatório · ciclo 1/3");
    expect(tela).toContain("na fase há 2m05s · chamada corrente há 1m00s");
    expect(tela).toContain(".capivara/runs/build-x/logs/agente-2.out.log");
    expect(tela).toContain("EVENTOS DO ESCALONADOR");
    expect(tela).toContain("[10:00:00] trabalhando em P03");
    expect(linhas).toHaveLength(30);
  });

  it("seguindo o fim, a última linha está à vista", () => {
    const { linhas } = renderPainelDoAgente(conteudo({ linhas: MUITAS }), abrirPainel(1), { columns: 100, rows: 30 }, style);
    expect(linhas.join("\n")).toContain("linha 100");
    expect(linhas.join("\n")).toContain("seguindo o fim");
  });

  it("PgUp para de seguir; o que chega depois não move a leitura; F volta a seguir", () => {
    let estado: EstadoDoPainel = abrirPainel(1);
    let desenho = renderPainelDoAgente(conteudo({ linhas: MUITAS }), estado, { columns: 100, rows: 30 }, style);
    estado = reduzirPainel(estado, tecla("pageup"), desenho.medidas, 3).estado;
    expect(estado.seguir).toBe(false);
    desenho = renderPainelDoAgente(conteudo({ linhas: MUITAS }), estado, { columns: 100, rows: 30 }, style);
    const primeira = desenho.linhas.find((linha) => /linha \d+/.test(linha));

    const mais = [...MUITAS, ...Array.from({ length: 20 }, (_, indice) => ({ fonte: "out" as const, texto: `nova ${indice}` }))];
    desenho = renderPainelDoAgente(conteudo({ linhas: mais }), estado, { columns: 100, rows: 30 }, style);
    expect(desenho.linhas.find((linha) => /linha \d+/.test(linha))).toBe(primeira);
    expect(desenho.linhas.join("\n")).toMatch(/parada · \d+ linha\(s\) abaixo/);

    estado = reduzirPainel(estado, letra("F"), desenho.medidas, 3).estado;
    expect(estado.seguir).toBe(true);
    expect(renderPainelDoAgente(conteudo({ linhas: mais }), estado, { columns: 100, rows: 30 }, style).linhas.join("\n")).toContain("nova 19");
  });

  it("PgDn até o fim volta a seguir; Home vai ao começo", () => {
    let estado = abrirPainel(1);
    const medidas: Medidas = { saida: { total: 100, visiveis: 10 }, eventos: { total: 0, visiveis: 4 } };
    estado = reduzirPainel(estado, tecla("home"), medidas, 3).estado;
    expect(estado).toMatchObject({ seguir: false, topo: { saida: 0 } });
    for (let vez = 0; vez < 20; vez += 1) estado = reduzirPainel(estado, tecla("pagedown"), medidas, 3).estado;
    expect(estado.seguir).toBe(true);
  });

  it("Tab troca a área com foco, e a rolagem passa a ser dos eventos", () => {
    const medidas: Medidas = { saida: { total: 100, visiveis: 10 }, eventos: { total: 50, visiveis: 5 } };
    let estado = reduzirPainel(abrirPainel(0), tecla("tab"), medidas, 2).estado;
    expect(estado.foco).toBe("eventos");
    estado = reduzirPainel(estado, tecla("home"), medidas, 2).estado;
    expect(estado.topo.eventos).toBe(0);
    expect(estado.seguir).toBe(true);
    expect(reduzirPainel(estado, tecla("tab"), medidas, 2).estado.foco).toBe("saida");
  });

  it("sem espaço para os eventos, Tab não leva a uma área invisível", () => {
    const medidas: Medidas = { saida: { total: 100, visiveis: 10 }, eventos: { total: 50, visiveis: 0 } };
    expect(reduzirPainel(abrirPainel(0), tecla("tab"), medidas, 2).estado.foco).toBe("saida");
  });

  it("Esc fecha; ← → trocam de agente e recomeçam seguindo", () => {
    const medidas: Medidas = { saida: { total: 0, visiveis: 1 }, eventos: { total: 0, visiveis: 0 } };
    expect(reduzirPainel(abrirPainel(0), tecla("escape"), medidas, 3).fechar).toBe(true);
    expect(reduzirPainel(abrirPainel(0), tecla("left"), medidas, 3).estado.slot).toBe(2);
    expect(reduzirPainel(abrirPainel(2), tecla("right"), medidas, 3).estado).toEqual(abrirPainel(0));
  });

  it("o agente que termina com o painel aberto aparece livre, com o desfecho, e o log continua lá", () => {
    const terminou = conteudo({
      linhas: [...MUITAS, { fonte: "harness", texto: "■ executor · P03 · tentativa 1: terminou com código 0 em 60s" }],
      agente: { slot: 1, label: "codex/m-b", state: "livre", phaseId: null, detail: "P03 integrada", since: null },
      inicioDaChamada: null,
      buildTerminou: true,
    });
    const { fase: _fase, ...semFase } = terminou;
    const tela = renderPainelDoAgente(semFase, abrirPainel(1), { columns: 100, rows: 30 }, style).linhas.join("\n");
    expect(tela).toContain("livre · último: P03 integrada");
    expect(tela).toContain("sem fase · nenhuma chamada em andamento");
    expect(tela).toContain("terminou com código 0");
    expect(tela).toContain("o build terminou · Esc mostra o resultado");
  });

  it("vazio diz que está vazio, em vez de inventar", () => {
    const tela = renderPainelDoAgente(conteudo({ linhas: [], eventos: [] }), abrirPainel(1), { columns: 100, rows: 30 }, style).linhas.join("\n");
    expect(tela).toContain("este agente ainda não escreveu nada");
    expect(tela).toContain("nenhum evento ainda");
  });

  it("terminal estreito e baixo: nada passa da largura nem da altura", () => {
    const longa = [{ fonte: "out" as const, texto: "x".repeat(500) }];
    for (const tela of [
      { columns: 40, rows: 12 },
      { columns: 60, rows: 20 },
      { columns: 200, rows: 60 },
    ]) {
      const { linhas, medidas } = renderPainelDoAgente(conteudo({ linhas: longa }), abrirPainel(1), tela, style);
      expect(linhas.length, JSON.stringify(tela)).toBeLessThanOrEqual(tela.rows);
      for (const linha of linhas) expect(linha.length, JSON.stringify(tela)).toBeLessThanOrEqual(tela.columns);
      if (tela.rows < 14) expect(medidas.eventos.visiveis).toBe(0);
    }
  });
});
