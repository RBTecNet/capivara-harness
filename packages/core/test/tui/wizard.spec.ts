/**
 * O wizard, exercitado sem terminal.
 *
 * Todo IO entra por parâmetro, então o roteiro de respostas é um array e o teste
 * pergunta ao que foi escrito na tela — igual ao resto da ferramenta.
 */

import { Readable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { describe, expect, it } from "vitest";
import { createLineIO, filtrarModelos, runWizard } from "../../src/commands/wizard.js";
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

  /*
   * O `plan` reencontra o esqueleto pelo pedido que o `init` registrou. Enquanto
   * o wizard não olhava esse registro, ele montava `capivara plan ...` sem
   * `--file` em qualquer projeto — e quem tinha rodado `init --file docs/prd.txt`
   * via o comando morrer antes da primeira chamada.
   */
  it("o plan não pergunta pedido quando o projeto registra qual o init usou", async () => {
    const { deps, tela } = roteiro(["", "2", "1", "", "1", "n", "s"]);
    const resultado = await runWizard({ ...deps, requestRecorded: async () => true });
    expect(resultado?.argv).toEqual(["plan", "--provider", "codex"]);
    expect(tela()).not.toContain("De onde vem o pedido?");
  });

  it("sem esse registro, o plan pede o arquivo em vez de montar um comando que falha", async () => {
    const { deps } = roteiro(["", "2", "pedido.md", "1", "", "1", "n", "s"]);
    const resultado = await runWizard({ ...deps, requestRecorded: async () => false });
    expect(resultado?.argv).toEqual(["plan", "--provider", "codex", "--file", "pedido.md"]);
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
    // Quatro comandos desde que o `survey` entrou na lista.
    const { deps, tela } = roteiro(["", "9", "1", "1", "x", ".", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(tela()).toContain("entre 1 e 4");
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

describe("filtrar 223 modelos por um trecho do nome", () => {
  /*
   * O caso que expôs o problema: "mini" está no meio de "gemini", então a lista
   * abria com 31 modelos do Google antes de qualquer minimax.
   */
  const google = Array.from({ length: 4 }, (_, i) => `gemini-3.8-flash-${i}`);
  const modelos = [...google, "opencode-go/minimax-m3", "minimax-m2"];

  it("quem começa pelo trecho vem antes de quem só o contém no meio", () => {
    expect(filtrarModelos(modelos, "mini")).toEqual(["minimax-m2", "opencode-go/minimax-m3", ...google]);
  });

  it("um pedaço do identificador conta como começo: os nomes vêm partidos por / e -", () => {
    expect(filtrarModelos(["opencode-go/glm-5.2", "xglm"], "glm")).toEqual(["opencode-go/glm-5.2", "xglm"]);
  });

  it("nada é descartado: o que casa só no meio continua na lista", () => {
    expect(filtrarModelos(modelos, "mini")).toHaveLength(modelos.length);
  });

  it("o que não casa fica de fora", () => {
    expect(filtrarModelos(modelos, "opus")).toEqual([]);
  });

  it("filtro vazio devolve a lista como está", () => {
    expect(filtrarModelos(modelos, "  ")).toEqual(modelos);
  });

  it("não distingue maiúsculas", () => {
    expect(filtrarModelos(["GPT-6-Astra"], "gpt")).toEqual(["GPT-6-Astra"]);
  });
});

/**
 * O pedido vindo da base documental.
 *
 * O wizard conecta de verdade para listar os projetos, e é isso que ele precisa
 * provar aqui: que escolher o projeto é escolher de uma lista do que existe, e
 * que uma base fora do ar não derruba quem está no meio do wizard.
 */
describe("conectar à base documental", () => {
  const base = [
    { slug: "biblioteca", hasRequest: true, documents: 3 },
    { slug: "cron", hasRequest: true, documents: 1 },
  ];

  it("lista os projetos e monta o comando com a URL e o projeto escolhido", async () => {
    // pasta, comando=init, fonte=3 (base), url (vazio=padrão), projeto=2, provider=1, modelo, effort, papéis…
    const { deps, tela } = roteiro(["", "1", "3", "", "2", "1", "", "1", "n", "n", "n", "n", "s"]);
    const resultado = await runWizard({ ...deps, listMcpProjects: async () => base });

    expect(tela()).toContain("base documental (MCP)");
    expect(tela()).toContain("biblioteca");
    expect(tela()).toContain("1 documento(s) selecionado(s)");
    expect(resultado?.argv).toEqual([
      "init",
      "--provider",
      "codex",
      "--mcp",
      "http://localhost:7777/mcp",
      "--mcp-project",
      "cron",
    ]);
    // O comando impresso ensina exatamente o que foi montado.
    expect(resultado?.command).toContain("--mcp http://localhost:7777/mcp --mcp-project cron");
  });

  it("projeto sem pedido escrito não é oferecido, e o wizard diz por quê", async () => {
    const { deps, tela } = roteiro(["", "1", "3", "", "1", "1", "", "1", "n", "n", "n", "n", "s"]);
    const resultado = await runWizard({
      ...deps,
      listMcpProjects: async () => [
        { slug: "com-pedido", hasRequest: true, documents: 0 },
        { slug: "sem-pedido", hasRequest: false, documents: 5 },
      ],
    });

    expect(resultado?.argv).toContain("com-pedido");
    expect(resultado?.argv).not.toContain("sem-pedido");
    expect(tela()).toContain("1 projeto(s) sem pedido escrito ficaram de fora");
  });

  /*
   * Endereço errado é o caso comum, não o excepcional. Sem esta saída, quem
   * digitou a porta errada perderia o wizard inteiro.
   */
  it("base fora do ar oferece tentar de novo, e o segundo endereço vale", async () => {
    let tentativas = 0;
    const { deps, tela } = roteiro([
      "", "1", "3",
      "http://localhost:9999/mcp", // primeira, quebrada
      "1", // tentar outro endereço
      "http://localhost:7777/mcp", // segunda, boa
      "1", // projeto
      "1", "", "1", "n", "n", "n", "n", "s",
    ]);
    const resultado = await runWizard({
      ...deps,
      listMcpProjects: async (url: string) => {
        tentativas += 1;
        if (url.includes("9999")) throw new Error("não consegui falar com o servidor MCP em " + url);
        return base;
      },
    });

    expect(tentativas).toBe(2);
    expect(tela()).toContain("não consegui falar com o servidor MCP");
    expect(resultado?.argv).toEqual([
      "init", "--provider", "codex", "--mcp", "http://localhost:7777/mcp", "--mcp-project", "biblioteca",
    ]);
  });

  it("quem desiste da base escreve o pedido como sempre escreveu", async () => {
    const { deps } = roteiro([
      "", "1", "3",
      "http://localhost:9999/mcp",
      "2", // voltar e escrever aqui
      "um quadro kanban", ".",
      "1", "", "1", "n", "n", "n", "n", "s",
    ]);
    const resultado = await runWizard({
      ...deps,
      listMcpProjects: async () => {
        throw new Error("fora do ar");
      },
    });
    expect(resultado).toBeNull();
  });

  /*
   * Sem a dependência injetada, este binário não sabe falar com base nenhuma —
   * e oferecer um caminho que ele não percorre é pior que não oferecer.
   */
  it("sem suporte a base, a opção não aparece", async () => {
    const { deps, tela } = roteiro(["", "1", "1", "uma agenda", ".", "1", "", "1", "n", "n", "n", "n", "s"]);
    await runWizard(deps);
    expect(tela()).not.toContain("base documental");
  });
});

/**
 * O `survey` no wizard.
 *
 * Ele não faz parte da esteira init → plan → build: é a porta de entrada de quem
 * tem código e não tem documento. Por isso fica por último na lista e nunca é
 * sugerido — sugerir por ausência de `.capivara/` confundiria com o greenfield,
 * que também não tem.
 */
describe("wizard do levantamento", () => {
  it("monta o comando com a pasta da aplicação e o destino do levantamento", async () => {
    const { deps } = roteiro([
      "/sistema-antigo", // a aplicação a levantar
      "4",               // survey
      "",                // saída: aceita ./levantamento
      "1",               // provider codex
      "",                // modelo padrão
      "1",               // sem effort
      "n",               // sem ajuste por papel
      "n",               // não executar agora
    ]);

    const resultado = await runWizard(deps);
    expect(resultado?.argv).toEqual(["survey", "--provider", "codex", "--project", "/sistema-antigo"]);
  });

  it("a saída diferente do padrão entra no comando", async () => {
    const { deps } = roteiro(["/sistema-antigo", "4", "./docs/legado", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toContain("--saida");
    expect(resultado?.argv).toContain("./docs/legado");
  });

  /*
   * O survey chama um papel só. Perguntar pelo auditor e pelo verificador aqui
   * seria pedir três decisões para um comando que usa uma.
   */
  it("pergunta só pelo papel que o levantamento usa", async () => {
    const { deps, tela } = roteiro(["/sistema-antigo", "4", "", "1", "", "1", "s", "1", "", "1", "n"]);
    await runWizard(deps);
    expect(tela()).toContain("escritor documental");
    expect(tela()).not.toContain("auditor documental");
  });

  /*
   * No `survey` a URL vai sozinha: o projeto ainda não existe lá, e o nome dele
   * sai da aplicação levantada. É o contrário do `init`, onde as duas andam
   * juntas porque há o que ler.
   */
  it("a base entra pela URL, sem escolher projeto", async () => {
    const { deps } = roteiro(["/sistema-antigo", "4", "", "1", "http://127.0.0.1:7777/mcp", "1", "", "1", "n", "n"]);
    const resultado = await runWizard({ ...deps, listMcpProjects: async () => [] });

    expect(resultado?.argv).toContain("--mcp");
    expect(resultado?.argv).toContain("http://127.0.0.1:7777/mcp");
    expect(resultado?.argv).not.toContain("--mcp-project");
  });

  it("base que não responde não impede o levantamento: segue local", async () => {
    const { deps, tela } = roteiro([
      "/sistema-antigo",
      "4",
      "",
      "1",                            // guardar na base: sim
      "http://127.0.0.1:9999/mcp",
      "2",                            // seguir sem base
      "1",
      "",
      "1",
      "n",
      "n",
    ]);

    const resultado = await runWizard({
      ...deps,
      listMcpProjects: async () => {
        throw new Error("connection refused");
      },
    });

    expect(tela()).toContain("connection refused");
    expect(resultado?.argv).not.toContain("--mcp");
  });
});
