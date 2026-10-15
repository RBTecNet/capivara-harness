/**
 * A entrada por tecla ligada a um terminal falso.
 *
 * O terminal falso registra o modo raw e entrega bytes como o de verdade; o
 * teste só emite teclas DEPOIS de a pergunta estar na tela, porque o que chega
 * antes é descartado de propósito — e há um teste para isso também.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { chooseInBox, createKeyPrompter, createKeySession } from "../../src/commands/key-io.js";
import { escolhaSemRepositorio, lerEscolhaDeRepositorio } from "../../src/loop/git.js";
import { runWizard, runWizardDePapeis } from "../../src/commands/wizard.js";
import { InputEndedError } from "../../src/commands/line-io.js";

const ESC = "\u001B";

function fakeTerminal() {
  const input = new EventEmitter() as EventEmitter & { raw: boolean[]; setRawMode: (mode: boolean) => void };
  input.raw = [];
  input.setRawMode = (mode: boolean) => void input.raw.push(mode);
  const escrito: string[] = [];
  let interrompido = 0;
  const prompter = createKeyPrompter({
    input: input as never,
    write: (text) => void escrito.push(text),
    dimensions: () => ({ columns: 100, rows: 40 }),
    style: { enabled: false },
    version: "0.3.5",
    subtitle: "wizard",
    environment: {},
    interrupt: () => void (interrompido += 1),
  });
  return {
    input,
    prompter,
    escrito,
    tela: () => escrito.join(""),
    /** A última moldura desenhada. */
    ultima: () => escrito.filter((text) => text.includes("ESCOLHA") || text.includes("RESPOSTA")).at(-1) ?? "",
    interrompido: () => interrompido,
    teclar: async (bytes: string) => {
      // Deixa o wizard chegar à pergunta seguinte antes de teclar.
      for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
      input.emit("data", bytes);
    },
  };
}

describe("entrada por tecla", () => {
  it("liga o modo raw e a marcação de colagem, e devolve os dois ao fechar", () => {
    const { input, prompter, tela } = fakeTerminal();
    expect(input.raw).toEqual([true]);
    expect(tela()).toContain(`${ESC}[?2004h`);
    prompter.close();
    expect(input.raw).toEqual([true, false]);
    expect(tela()).toContain(`${ESC}[?2004l`);
  });

  it("escolhe pela lista e registra a resposta em SUAS ESCOLHAS", async () => {
    const t = fakeTerminal();
    const escolha = t.prompter.select("Qual provider?", [{ label: "codex" }, { label: "claude" }], 0);
    await t.teclar(`${ESC}[B\r`);
    expect(await escolha).toBe(1);

    const segunda = t.prompter.ask("Ciclos de correção por fase [3]: ");
    await t.teclar("");
    expect(t.ultima()).toContain("SUAS ESCOLHAS");
    expect(t.ultima()).toContain("claude");
    await t.teclar("5\r");
    expect(await segunda).toBe("5");
    t.prompter.close();
  });

  it("tecla batida antes de a pergunta aparecer é descartada, e o descarte é dito", async () => {
    const t = fakeTerminal();
    t.input.emit("data", "2\r");
    const escolha = t.prompter.select("Executar agora?", [{ label: "sim" }, { label: "não" }], 0);
    let resolvida = false;
    void escolha.then(() => (resolvida = true));
    await t.teclar("");
    expect(resolvida).toBe(false);
    expect(t.ultima()).toContain("ignorei 2 tecla(s)");
    await t.teclar("\r");
    expect(await escolha).toBe(0);
    t.prompter.close();
  });

  it("colagem numa escolha não escolhe nada", async () => {
    const t = fakeTerminal();
    const escolha = t.prompter.select("O que você quer fazer?", [{ label: "init" }, { label: "plan" }], 0);
    let resolvida = false;
    void escolha.then(() => (resolvida = true));
    await t.teclar(`${ESC}[200~2\num sistema de reservas${ESC}[201~`);
    await t.teclar("");
    expect(resolvida).toBe(false);
    expect(t.ultima()).toContain("Colagem ignorada");
    await t.teclar("\r");
    expect(await escolha).toBe(0);
    t.prompter.close();
  });

  it("Ctrl-C restaura o terminal ANTES de interromper", async () => {
    const t = fakeTerminal();
    const escolha = t.prompter.select("x", [{ label: "a" }], 0).catch((error: unknown) => error);
    await t.teclar("\u0003");
    expect(t.interrompido()).toBe(1);
    expect(t.input.raw).toEqual([true, false]);
    expect(await escolha).toBeInstanceOf(InputEndedError);
  });

  it("Ctrl-D numa escolha é o fim da entrada", async () => {
    const t = fakeTerminal();
    const escolha = t.prompter.select("x", [{ label: "a" }], 0).catch((error: unknown) => error);
    await t.teclar("\u0004");
    expect(await escolha).toBeInstanceOf(InputEndedError);
    t.prompter.close();
  });

  it("ao fechar, deixa no terminal o que foi decidido e o que foi dito por último", async () => {
    const t = fakeTerminal();
    const escolha = t.prompter.select("Executar agora?", [{ label: "sim" }, { label: "não" }], 0);
    t.prompter.write("\nComando equivalente:\n\n  capivara init x\n\n");
    await t.teclar("\r");
    await escolha;
    t.prompter.close();
    const fim = t.escrito.at(-1) ?? "";
    expect(fim).toContain("Executar agora?: sim");
    expect(fim).toContain("capivara init x");
  });
});

describe("wizard por tecla", () => {
  it("monta o MESMO comando que o roteiro de linhas, escolhendo pela lista", async () => {
    const t = fakeTerminal();
    const resultado = runWizard({
      io: t.prompter,
      cwd: "/projeto",
      fileExists: async () => false,
      directoryExists: async () => true,
    });

    await t.teclar("\r"); // pasta do projeto: aceita o padrão
    await t.teclar("\r"); // init, o sugerido
    await t.teclar("\r"); // escrever agora
    await t.teclar(`${ESC}[200~um quadro kanban pessoal${ESC}[201~\r.\r`); // o pedido, colado, e o ponto
    await t.teclar("\r"); // provider: o primeiro, codex
    await t.teclar("\r"); // modelo padrão
    await t.teclar("\r"); // sem effort
    await t.teclar("2\r"); // sem ajuste por papel
    await t.teclar("\r"); // executar

    const final = await resultado;
    t.prompter.close();
    expect(final?.argv).toEqual(["init", "um quadro kanban pessoal", "--provider", "codex"]);
    expect(final?.execute).toBe(true);
    expect(t.escrito.at(-1)).toContain("Comando equivalente");
  });
});

describe("modelo pela lista", () => {
  function papeis(t: ReturnType<typeof fakeTerminal>) {
    return runWizardDePapeis({
      io: t.prompter,
      cwd: "/projeto",
      comando: "init",
      faltando: ["writer"],
      fileExists: async () => false,
      directoryExists: async () => true,
      listModels: async () => ["gpt-a", "gpt-b"],
      listEfforts: async () => ["low", "high"],
    });
  }

  it("o modelo e o effort se escolhem na lista, com o que a CLI informa", async () => {
    const t = fakeTerminal();
    const escolha = papeis(t);
    await t.teclar("\r"); // codex
    await t.teclar("");
    expect(t.ultima()).toContain("digitar outro nome");
    expect(t.ultima()).toContain("voltar ao provider");
    await t.teclar(`${ESC}[B\r`); // gpt-b
    await t.teclar("3\r"); // desligado, low, high
    await t.teclar("\r"); // sem ajuste por papel
    expect((await escolha)?.global).toEqual({ provider: "codex", model: "gpt-b", effort: "high" });
    t.prompter.close();
  });

  it("voltar ao provider e digitar um nome fora da lista também são linhas da lista", async () => {
    const t = fakeTerminal();
    const escolha = papeis(t);
    await t.teclar("\r"); // codex
    await t.teclar("4\r"); // voltar ao provider
    await t.teclar("\r"); // codex de novo
    await t.teclar("3\r"); // digitar outro nome
    await t.teclar("modelo-novo\r");
    await t.teclar("\r"); // sem effort
    await t.teclar("\r"); // sem ajuste
    expect((await escolha)?.global).toEqual({ provider: "codex", model: "modelo-novo" });
    t.prompter.close();
  });
});

describe("sessão de teclas", () => {
  function sessao() {
    const input = new EventEmitter() as EventEmitter & { setRawMode: (mode: boolean) => void };
    input.setRawMode = () => undefined;
    const escrito: string[] = [];
    const session = createKeySession({ input: input as never, write: (text) => void escrito.push(text), columns: () => 80, interrupt: () => undefined });
    const teclar = async (bytes: string): Promise<void> => {
      await new Promise((resolve) => setImmediate(resolve));
      input.emit("data", bytes);
    };
    return { session, escrito, teclar };
  }

  it("Esc num campo que se pode cancelar devolve null — a entrevista volta às opções", async () => {
    const { session, teclar } = sessao();
    const texto = session.text({ label: "Sua resposta", cancelable: true }, () => undefined);
    await teclar(`os dois${ESC}`);
    expect(await texto).toBeNull();
    session.close();
  });

  it("a pergunta em linha escreve o prompt, ecoa o que se digita e fecha a linha", async () => {
    const { session, escrito, teclar } = sessao();
    const resposta = session.line.ask("  ▸ sua decisão: ");
    await teclar("publicar\r");
    expect(await resposta).toBe("publicar");
    expect(escrito.join("")).toContain("  ▸ sua decisão: publicar");
    expect(escrito.at(-1)).toBe("\n");
    session.close();
  });

  it("a pergunta em linha também diz o que descartou", async () => {
    const { session, escrito, teclar } = sessao();
    await teclar("xyz");
    const resposta = session.line.ask("> ");
    expect(escrito.join("")).toContain("ignorei 3 tecla(s)");
    await teclar("ok\r");
    expect(await resposta).toBe("ok");
    session.close();
  });
});

describe("escolha embaixo do painel", () => {
  function caixa() {
    const input = new EventEmitter() as EventEmitter & { setRawMode: (mode: boolean) => void };
    input.setRawMode = () => undefined;
    const escrito: string[] = [];
    const session = createKeySession({ input: input as never, write: (text) => void escrito.push(text), interrupt: () => undefined });
    const teclar = async (bytes: string): Promise<void> => {
      for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
      input.emit("data", bytes);
    };
    const escolher = () => {
      const escolha = escolhaSemRepositorio();
      return chooseInBox(session, {
        title: "SEM REPOSITÓRIO GIT",
        text: escolha.texto,
        choices: escolha.opcoes.map((label) => ({ label })),
        write: (text) => void escrito.push(text),
        dimensions: () => ({ columns: 100, rows: 30 }),
        style: { enabled: false },
      });
    };
    return { session, escrito, teclar, escolher };
  }

  it("o texto sai uma vez só, por mais teclas que se aperte; só a lista se redesenha", async () => {
    const { session, escrito, teclar, escolher } = caixa();
    const indice = escolher();
    await teclar(`${ESC}[B`);
    await teclar(`${ESC}[B`);
    await teclar(`${ESC}[A\r`);
    expect(await indice).toBe(1);
    const tudo = escrito.join("");
    expect(tudo.split("Duas razões, e nenhuma delas é gosto").length - 1).toBe(1);
    expect(tudo.split("já criei em outro terminal").length - 1).toBeGreaterThan(2);
    session.close();
  });

  it("a escolha fica marcada na tela, e o número dela é o que o leitor da pergunta já entende", async () => {
    const { session, escrito, teclar, escolher } = caixa();
    const indice = escolher();
    await teclar("3\r");
    const escolhido = await indice;
    expect(escrito.join("")).toContain("✓ abortar");
    expect(lerEscolhaDeRepositorio(String(escolhido + 1))).toBe("abortar");
    session.close();
  });

  it("tecla batida antes da pergunta é dita no texto, e não escolhe nada", async () => {
    const { session, escrito, teclar, escolher } = caixa();
    await teclar("3\r");
    const indice = escolher();
    expect(escrito.join("")).toContain("ignorei 2 tecla(s)");
    await teclar("\r");
    expect(await indice).toBe(0);
    session.close();
  });
});
