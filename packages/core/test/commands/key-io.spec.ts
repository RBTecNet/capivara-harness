/**
 * A entrada por tecla ligada a um terminal falso.
 *
 * O terminal falso registra o modo raw e entrega bytes como o de verdade; o
 * teste só emite teclas DEPOIS de a pergunta estar na tela, porque o que chega
 * antes é descartado de propósito — e há um teste para isso também.
 */

import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { chooseInBox, createKeyPrompter, createKeySession } from "../../src/commands/key-io.js";
import { escolhaSemRepositorio, lerEscolhaDeRepositorio } from "../../src/loop/git.js";
import { runWizard, runWizardDePapeis } from "../../src/commands/wizard.js";
import { InputEndedError } from "../../src/commands/line-io.js";
import { ensureApiCredential } from "../../src/commands/api-login.js";
import { readCredentials, saveCredential } from "../../src/provider/credentials.js";
import { rolesFromFlags } from "../../src/commands/options.js";

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
    version: "0.4.0",
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
  it("chave de API nunca aparece no campo, nas notas nem no resumo final", async () => {
    const t = fakeTerminal();
    const pending = t.prompter.secret("Chave de API (oculta): ");
    await t.teclar("sk-teste-super-secreto");
    expect(t.tela()).not.toContain("sk-teste");
    expect(t.tela()).toContain("***");
    await t.teclar("\r");
    expect(await pending).toBe("sk-teste-super-secreto");
    t.prompter.close();
    expect(t.tela()).not.toContain("sk-teste");
    expect(t.tela()).toContain("(oculto)");
    expect(t.input.raw.at(-1)).toBe(false);
  });
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
  it("OpenRouter mostra a recusa, espera uma decisão e chega ao modelo após a troca", async () => {
    const directory = await mkdtemp(join(tmpdir(), "capivara-wizard-key-"));
    const file = join(directory, "credentials.json");
    const t = fakeTerminal();
    const rejected = "sk-management-teste";
    const valid = "sk-inference-teste";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => new Response(JSON.stringify({ data: { is_management_key: (options?.headers as Record<string, string>).Authorization === `Bearer ${rejected}` } })));
    try {
      await saveCredential({ id: "openrouter", label: "principal", provider: "openrouter", secret: rejected, default: true, createdAt: "agora" }, file);
      const listModels = vi.fn(async () => {
        expect((await readCredentials(file))[0]?.secret).toBe(valid);
        return ["provider/modelo"];
      });
      const pending = runWizardDePapeis({ cwd: directory, comando: "init", faltando: ["writer"], current: rolesFromFlags({ provider: "openrouter" }),
        io: t.prompter, fileExists: async () => false, directoryExists: async () => true, listModels,
        configureApi: (provider, io) => ensureApiCredential(provider, io, { environment: {}, credentialsFile: file }),
      });
      void pending.catch(() => undefined); // O finally também fecha perguntas pendentes se uma asserção falhar.
      await vi.waitFor(() => expect(t.ultima()).toContain("Configurar esta API?"));
      await t.teclar("1\r");
      await t.teclar(`${rejected}\r`);
      await vi.waitFor(() => expect(t.ultima()).toContain("Chave recusada"));
      expect(t.ultima()).toContain("gerenciamento/provisionamento");
      expect(t.ultima()).toContain("não pode gerar respostas");
      expect(t.ultima()).toContain("https://openrouter.ai/settings/keys");
      expect(t.ultima()).toContain("voltar ao provider");
      expect(t.ultima()).toContain("digitar outra chave");
      expect(listModels).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      await t.teclar("2\r");
      await t.teclar(`${valid}\r`);
      await vi.waitFor(() => expect(t.ultima()).toContain("provider/modelo"));
      await t.teclar("1\r");
      expect((await pending)?.roles.writer).toEqual({ provider: "openrouter", model: "provider/modelo" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(t.tela()).not.toContain(rejected);
      expect(t.tela()).not.toContain(valid);
    } finally {
      t.prompter.close();
      fetchMock.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

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
  it.each([{ provider: "opencode", numero: 3 }, { provider: "cursor", numero: 5 }])(
    "$provider: mostra listas grandes imediatamente e permite filtrar e restaurar todos",
    async ({ provider, numero }) => {
      const t = fakeTerminal();
      const modelos = Array.from({ length: 30 }, (_, index) => `${provider}/modelo-${index}`);
      const escolha = runWizardDePapeis({
        io: t.prompter,
        cwd: "/projeto",
        comando: "init",
        faltando: ["writer"],
        fileExists: async () => false,
        directoryExists: async () => true,
        listModels: async (id) => id === provider ? modelos : [],
      });
      try {
        await t.teclar(`${numero}\r`);
        await t.teclar("");
        expect(t.ultima()).toContain(`${provider}/modelo-0`);
        expect(t.ultima()).toContain("filtrar modelos");
        expect(t.ultima()).not.toContain("Digite parte do nome");

        await t.teclar("31\r"); // filtrar, depois dos 30 modelos
        await t.teclar("");
        expect(t.ultima()).toContain("Digite parte do nome");
        await t.teclar("modelo-29\r");
        await t.teclar("");
        expect(t.ultima()).toContain(`${provider}/modelo-29`);
        expect(t.ultima()).not.toContain(`${provider}/modelo-0`);

        await t.teclar("2\r"); // filtrar de novo, depois do único resultado
        await t.teclar("\r"); // filtro vazio restaura todos
        await t.teclar("");
        expect(t.ultima()).toContain(`${provider}/modelo-0`);
        await t.teclar("2\r"); // segundo modelo
        await t.teclar("\r"); // sem effort
        await t.teclar("\r"); // sem ajuste por papel
        expect((await escolha)?.global).toEqual({ provider, model: `${provider}/modelo-1` });
      } finally {
        t.prompter.close();
      }
    },
  );

  it("no build, o terminal alcança a API 10 e mostra só modelos DeepSeek via OpenCode", async () => {
    const t = fakeTerminal();
    const escolha = runWizardDePapeis({
      io: t.prompter, cwd: "/projeto", comando: "build", faltando: ["builder", "verifier"],
      fileExists: async () => false, directoryExists: async () => true,
      listModels: async () => ["opencode/big-pickle", "deepseek/deepseek-flash"],
      listEfforts: async () => ["none", "low", "high", "max"],
    });
    try {
      await t.teclar("10");
      await t.teclar("");
      expect(t.ultima()).toContain("deepseek");
      expect(t.ultima()).toContain("API via OpenCode");
      await t.teclar("\r");
      await t.teclar("");
      expect(t.ultima()).toContain("deepseek/deepseek-flash");
      expect(t.ultima()).not.toContain("big-pickle");
      await t.teclar("\r");
      await t.teclar("3\r");
      await t.teclar("\r");
      expect((await escolha)?.global).toEqual({ provider: "opencode", model: "deepseek/deepseek-flash", effort: "high" });
    } finally { t.prompter.close(); }
  });

  it("MiniMax com provider preenchido mostra os modelos no terminal sem repetir o provider", async () => {
    const t = fakeTerminal();
    const config = { provider: "minimax", model: "", effort: "", credential: "", command: "" };
    const escolha = runWizardDePapeis({
      io: t.prompter, cwd: "/projeto", comando: "init", faltando: ["writer"],
      current: { writer: config, auditor: config, builder: config, verifier: config },
      fileExists: async () => false, directoryExists: async () => true,
      listModels: async () => ["MiniMax-M3", "MiniMax-M2.7"],
    });
    try {
      await t.teclar("");
      expect(t.ultima()).toContain("MiniMax-M3");
      expect(t.ultima()).toContain("MiniMax-M2.7");
      expect(t.ultima()).not.toContain("Qual provider usar");
      await t.teclar("2\r");
      expect((await escolha)?.roles.writer).toEqual({ provider: "minimax", model: "MiniMax-M2.7" });
    } finally { t.prompter.close(); }
  });

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
