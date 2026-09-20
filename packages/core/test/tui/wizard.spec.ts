/**
 * O wizard, exercitado sem terminal.
 *
 * Todo IO entra por parâmetro, então o roteiro de respostas é um array e o teste
 * pergunta ao que foi escrito na tela — igual ao resto da ferramenta.
 */

import { Readable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { describe, expect, it } from "vitest";
import { createLineIO, runWizard } from "../../src/commands/wizard.js";
import { readChoice, renderChoices, renderCommand, toArgv } from "../../src/tui/index.js";

function roteiro(respostas: string[]) {
  const escrito: string[] = [];
  let posicao = 0;
  return {
    escrito,
    tela: () => escrito.join(""),
    deps: {
      io: {
        ask: async () => respostas[posicao++] ?? "",
        write: (text: string) => void escrito.push(text),
      },
      cwd: "/projeto",
      fileExists: async (path: string) => path.endsWith("pedido.md"),
      directoryExists: async () => true,
    },
  };
}

describe("escolha numérica", () => {
  it("vazio aceita o padrão", () => {
    expect(readChoice("", 3, 1)).toEqual({ ok: true, index: 1 });
  });

  it("o número escolhe a opção", () => {
    expect(readChoice("3", 3, 0)).toEqual({ ok: true, index: 2 });
  });

  it("número fora da faixa diz a faixa", () => {
    const reading = readChoice("9", 3, 0);
    expect(reading.ok).toBe(false);
    expect(reading.ok === false && reading.message).toContain("entre 1 e 3");
  });

  it("pedido colado no lugar da opção é reconhecido como colagem", () => {
    const reading = readChoice("quero um quadro kanban pessoal que rode no navegador e guarde tudo", 2, 0);
    expect(reading.ok).toBe(false);
    expect(reading.ok === false && reading.message).toContain("colou o pedido");
  });

  it("a lista numera e marca o padrão", () => {
    const rendered = renderChoices("De onde vem o pedido?", [{ label: "escrever agora" }, { label: "ler de um arquivo" }], 1);
    expect(rendered).toContain("1) escrever agora");
    expect(rendered).toContain("2) ler de um arquivo (padrão)");
  });
});

describe("wizard", () => {
  it("do pedido digitado ao comando equivalente", async () => {
    const { deps, tela } = roteiro([
      "",            // pasta do projeto: aceita o padrão
      "1",           // init
      "1",           // escrever agora
      "um quadro kanban pessoal",
      ".",           // fim do pedido
      "1",           // provider codex
      "",            // modelo padrão
      "1",           // sem effort
      "n",           // sem ajuste por papel
      "s",           // executar
    ]);

    const resultado = await runWizard(deps);
    expect(resultado?.argv).toEqual(["init", "um quadro kanban pessoal", "--provider", "codex"]);
    expect(resultado?.execute).toBe(true);
    expect(tela()).toContain("Comando equivalente");
  });

  it("o pedido pode vir de arquivo, escolhido por número", async () => {
    const { deps } = roteiro(["", "1", "2", "pedido.md", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toContain("--file");
    expect(resultado?.argv).toContain("pedido.md");
    expect(resultado?.execute).toBe(false);
  });

  it("o comando impresso e o argv executado dizem a mesma coisa", async () => {
    // O effort é a 2ª opção: `desligado`, `low`, `medium`, `high`. `minimal` saiu
    // da lista porque nenhum modelo atual do codex o aceita, e oferecê-lo fazia a
    // chamada morrer com código 1.
    const { deps } = roteiro(["", "1", "1", "uma agenda", ".", "2", "sonnet", "2", "n", "s"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toEqual(["init", "uma agenda", "--provider", "claude", "--model", "sonnet", "--effort", "low"]);
    expect(resultado?.command).toBe('capivara init "uma agenda" --provider claude --model sonnet --effort low');
  });

  it("o build pergunta teste e ciclos, e não pergunta pedido", async () => {
    const { deps, tela } = roteiro(["", "3", "1", "", "1", "n", "npm run test:ci", "5", "s"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toEqual(["build", "--provider", "codex", "--test-cmd", "npm run test:ci", "--max-cycles", "5"]);
    expect(tela()).not.toContain("De onde vem o pedido?");
  });

  it("o init não pergunta pelo executor, e o build não pergunta pelo escritor", async () => {
    const init = roteiro(["", "1", "1", "x", ".", "1", "", "1", "s", "1", "1", "1", "n"]);
    await runWizard(init.deps);
    expect(init.tela()).not.toContain("Executor");

    const build = roteiro(["", "3", "1", "", "1", "s", "1", "1", "", "", "n"]);
    await runWizard(build.deps);
    expect(build.tela()).not.toContain("Escritor");
  });

  it("número inválido é recusado sem derrubar o wizard", async () => {
    const { deps, tela } = roteiro(["", "9", "1", "1", "x", ".", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(tela()).toContain("entre 1 e 3");
    expect(resultado?.argv[0]).toBe("init");
  });

  it("pedido vazio não vira run", async () => {
    const { deps } = roteiro(["", "1", "1", ".", "1"]);
    expect(await runWizard(deps)).toBeNull();
  });

  it("toArgv e renderCommand nascem da mesma resposta", () => {
    const answers = {
      command: "build" as const,
      global: { provider: "codex" },
      roles: { verifier: { provider: "anthropic", model: "claude-haiku-4-5-20251001" } },
      testCommand: "npm test",
    };
    expect(toArgv(answers).join(" ")).toContain("--verifier-provider anthropic");
    expect(renderCommand(answers)).toContain("--verifier-provider anthropic");
  });
});

describe("entrada roteirizada", () => {
  /** Um pipe entrega tudo de uma vez: é o caso que derrubava o wizard. */
  function piped(linhas: string[]) {
    const escrito: string[] = [];
    const terminal = createInterface({ input: Readable.from([`${linhas.join("\n")}\n`]) });
    return { escrito, io: createLineIO(terminal, (text) => void escrito.push(text)) };
  }

  it("linha que chega antes da pergunta espera pela pergunta", async () => {
    const { io } = piped(["primeira", "segunda", "terceira"]);
    expect(await io.ask("a: ")).toBe("primeira");
    expect(await io.ask("b: ")).toBe("segunda");
    expect(await io.ask("c: ")).toBe("terceira");
  });

  it("o wizard inteiro roda por pipe, sem perder resposta", async () => {
    const { io } = piped(["", "1", "1", "um quadro kanban", ".", "1", "", "1", "n", "n"]);
    const resultado = await runWizard({
      io,
      cwd: "/projeto",
      fileExists: async () => false,
      directoryExists: async () => true,
    });
    expect(resultado?.argv).toEqual(["init", "um quadro kanban", "--provider", "codex"]);
  });

  it("entrada que acaba no meio encerra sem stack trace", async () => {
    const { io, escrito } = piped(["", "1"]);
    const resultado = await runWizard({
      io,
      cwd: "/projeto",
      fileExists: async () => false,
      directoryExists: async () => true,
    });
    expect(resultado).toBeNull();
    expect(escrito.join("")).toContain("Nada foi executado");
  });
});

describe("--ver é apelido de --version", () => {
  it("traduz apenas o apelido, e deixa o resto do argv intacto", async () => {
    const { withVersionAlias } = await import("../../src/cli-program.js");
    expect(withVersionAlias(["node", "capivara", "--ver"])).toEqual(["node", "capivara", "--version"]);
    expect(withVersionAlias(["node", "capivara", "init", "--provider", "codex"])).toEqual([
      "node",
      "capivara",
      "init",
      "--provider",
      "codex",
    ]);
  });

  it("não mexe em argumento que apenas contenha o texto", async () => {
    const { withVersionAlias } = await import("../../src/cli-program.js");
    // Um pedido que fale de versões não pode virar consulta de versão.
    expect(withVersionAlias(["init", "controle de --versões do documento"])).toEqual([
      "init",
      "controle de --versões do documento",
    ]);
  });
});

describe("o mesmo provider tem o mesmo número em toda tela", () => {
  it("escolher 3 dá opencode tanto no menu global quanto no de papel", async () => {
    // Antes, "manter o padrão" ocupava a posição 1 do menu de papel e deslocava
    // todos os providers: codex era 1 no global e 2 no papel, opencode 3 e 4.
    // Quem lesse a primeira lista e respondesse pela memória pegava o vizinho.
    const { deps } = roteiro(["", "1", "2", "pedido.md", "3", "mimo-v2.5-free", "1", "s", "3", "", "3", "", "3", "", "n"]);
    const resultado = await runWizard(deps);
    const argv = resultado?.argv.join(" ") ?? "";
    expect(argv).toContain("--provider opencode");
    expect(argv).toContain("--writer-provider opencode");
    expect(argv).not.toContain("claude");
  });

  it("Enter num papel mantém o provider global, sem sujar o comando", async () => {
    const { deps } = roteiro(["", "1", "2", "pedido.md", "3", "mimo-v2.5-free", "1", "s", "", "", "", "n"]);
    const resultado = await runWizard(deps);
    const argv = resultado?.argv.join(" ") ?? "";
    expect(argv).toContain("--provider opencode");
    expect(argv).not.toContain("--writer-provider");
  });
});
