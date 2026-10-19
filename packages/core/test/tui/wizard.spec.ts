/**
 * O wizard, exercitado sem terminal.
 *
 * Todo IO entra por parâmetro, então o roteiro de respostas é um array e o teste
 * pergunta ao que foi escrito na tela — igual ao resto da ferramenta.
 */

import { Readable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { describe, expect, it } from "vitest";
import { createLineIO, filtrarModelos, runWizard, runWizardDePapeis, runWizardDoPedido } from "../../src/commands/wizard.js";
import { readChoice, renderChoices, renderCommand, toArgv, wizardSteps } from "../../src/tui/index.js";

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
    // O "" depois do "n" é a estratégia: Enter fica no serial, e serial não acrescenta flag.
    const { deps, tela } = roteiro(["", "3", "1", "", "1", "n", "", "npm run test:ci", "5", "s"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toEqual(["build", "--provider", "codex", "--test-cmd", "npm run test:ci", "--max-cycles", "5"]);
    expect(tela()).not.toContain("De onde vem o pedido?");
  });

  describe("estratégia de execução do build (§97)", () => {
    // pasta, build, codex, modelo padrão, sem effort, sem ajuste por papel
    const ATE_OS_PAPEIS = ["", "3", "1", "", "1", "n"];

    it.each(["s", "n"])("todos como executor sobrescreve pool antigo mesmo com lembrar=%s", async lembrar => {
      const salva = { mode: "parallel" as const, maxConcurrency: 3, workers: [{ provider: "opencode", model: "openrouter/antigo", effort: "high" }] };
      const { deps } = roteiro([...ATE_OS_PAPEIS, "2", "3", "1", lembrar, "", "", "n"]);
      const result = await runWizard({ ...deps, readExecution: async () => salva });
      expect(result?.answers.execution).toEqual({ mode: "parallel", maxConcurrency: 3, workers: [] });
      expect(result?.argv).toContain("--workers-as-builder");
      expect(result?.command).toContain("--workers-as-builder");
      expect(result?.argv.includes("--save-execution")).toBe(lembrar === "s");
      expect(salva.workers[0]?.model).toBe("openrouter/antigo");
    });

    it("seleção por teclado também transmite todos como executor explicitamente", async () => {
      const { deps } = roteiro(["", "3", "", ""]);
      const result = await runWizard({ ...deps,
        readExecution: async () => ({ mode: "parallel", maxConcurrency: 3, workers: [{ provider: "codex", model: "antigo", effort: "" }] }),
        listModels: async () => ["novo"],
        io: { ...deps.io, select: async (title, choices, defaultIndex) => {
          if (title.includes("O que você quer")) return choices.findIndex(c => c.label === "build");
          if (title.includes("Estratégia de execução")) return choices.findIndex(c => c.label === "paralela");
          if (title.includes("Com que modelos")) return choices.findIndex(c => c.label === "todos como o executor");
          if (title.includes("Ajustar algum") || title.includes("Lembrar") || title.includes("Executar agora")) return choices.findIndex(c => c.label === "não");
          return defaultIndex;
        } },
      });
      expect(result?.answers.global.model).toBe("novo");
      expect(result?.argv).toContain("--workers-as-builder");
    });

    it("MiniMax no build mostra seus modelos e usa só variantes aceitas pelo OpenCode", async () => {
      const { deps, tela } = roteiro(["", "3", "11", "1", "2", "n", "1", "", "", "n"]);
      const configured: string[] = [];
      const result = await runWizard({ ...deps,
        configureApi: async (provider) => { configured.push(provider); return true; },
        listModels: async () => ["deepseek/deepseek-flash", "minimax/MiniMax-M3", "minimax-coding-plan/MiniMax-M3"],
        listEfforts: async () => ["none", "thinking"],
      });
      expect(result?.answers.global).toEqual({ provider: "opencode", model: "minimax/MiniMax-M3", effort: "thinking" });
      expect(configured).toEqual(["minimax"]);
      expect(tela()).toContain("Modelo (minimax via OpenCode)");
      expect(tela()).not.toContain("minimax-coding-plan/MiniMax-M3");
      expect(tela()).not.toContain("high");
    });

    it("o build lista APIs após custom e permite escolher DeepSeek via OpenCode", async () => {
      const { deps, tela } = roteiro(["", "3", "10", "1", "3", "n", "2", "3", "1", "s", "", "3", "n"]);
      const consulted: string[] = [];
      const configured: string[] = [];
      const result = await runWizard({
        ...deps,
        configureApi: async (provider) => { configured.push(provider); return true; },
        listModels: async (provider) => { consulted.push(provider); return ["opencode/big-pickle", "deepseek/deepseek-flash"]; },
        listEfforts: async () => ["none", "low", "high", "max"],
      });
      expect(result?.argv).toEqual(["build", "--provider", "opencode", "--model", "deepseek/deepseek-flash", "--effort", "high", "--parallel", "3", "--workers-as-builder", "--save-execution"]);
      expect(consulted).toEqual(["opencode"]);
      expect(configured).toEqual(["deepseek"]);
      expect(tela()).toContain("a chave salva será reaproveitada");
      const menu = tela().split("Qual provider usar em todos os papéis?")[1]?.split("Escolha")[0];
      expect(menu).toContain("10) deepseek");
      expect(menu).toContain("12) openrouter");
      expect(menu).toContain("API via OpenCode");
      expect(tela().split("Modelo (deepseek via OpenCode)")[1]?.split("Escolha")[0]).not.toContain("big-pickle");
    });

    it("ajuste por papel usa API via OpenCode no executor e API direta no verificador", async () => {
      const { deps, tela } = roteiro(["", "3", "1", "", "1", "s", "10", "1", "10", "1", "1", "", "", "n"]);
      const result = await runWizard({ ...deps, listModels: async (provider) => provider === "opencode" ? ["deepseek/deepseek-flash"] : provider === "deepseek" ? ["deepseek-flash"] : [] });
      expect(result?.answers.roles.builder).toEqual({ provider: "opencode", model: "deepseek/deepseek-flash" });
      expect(result?.answers.roles.verifier).toEqual({ provider: "deepseek", model: "deepseek-flash" });
      expect(tela()).toContain("deepseek será usado via OpenCode");
    });

    it("sem listagem, o modelo da API via OpenCode é obrigatório e recebe o prefixo", async () => {
      const { deps, tela } = roteiro(["", "3", "10", "", "deepseek-flash", "1", "n", "1", "", "", "n"]);
      const result = await runWizard({ ...deps, listModels: async () => [] });
      expect(result?.answers.global).toMatchObject({ provider: "opencode", model: "deepseek/deepseek-flash" });
      expect(tela()).toContain("Informe um modelo explícito para este provider");
    });

    it("recusar cadastro volta aos providers sem consultar modelos", async () => {
      const { deps } = roteiro(["", "3", "10", "1", "", "1", "n", "1", "", "", "n"]);
      const consulted: string[] = [];
      const result = await runWizard({ ...deps, configureApi: async () => false, listModels: async (id) => { consulted.push(id); return []; } });
      expect(result?.answers.global.provider).toBe("codex");
      expect(consulted).toEqual(["codex"]);
    });

    it("Gemini usa google no OpenCode e mantém o cadastro da chave como gemini", async () => {
      const { deps } = roteiro(["", "3", "9", "1", "1", "n", "1", "", "", "n"]);
      const configured: string[] = [];
      const result = await runWizard({ ...deps, configureApi: async (id) => { configured.push(id); return true; }, listModels: async () => ["google/gemini-teste", "deepseek/outro"] });
      expect(result?.answers.global).toMatchObject({ provider: "opencode", model: "google/gemini-teste" });
      expect(configured).toEqual(["gemini"]);
    });

    it("modelo conhecido sem variantes não oferece high; variante none é usada para desligar", async () => {
      const without = roteiro(["", "3", "3", "1", "1", "n", "1", "", "", "n"]);
      const noVariants = await runWizard({ ...without.deps, listModels: async () => ["deepseek/sem-variantes"], listEfforts: async () => [] });
      expect(noVariants?.answers.global.effort).toBeUndefined();
      expect(without.tela()).toContain("padrão do modelo");
      expect(without.tela()).not.toContain("2) low");
      const off = roteiro(["", "3", "3", "1", "1", "n", "1", "", "", "n"]);
      const none = await runWizard({ ...off.deps, listModels: async () => ["deepseek/deepseek-flash"], listEfforts: async () => ["none", "low", "high", "max"] });
      expect(none?.answers.global.effort).toBe("none");
      expect(none?.argv).toContain("none");
    });

    it("paralela com todos os agentes iguais ao executor: o comando declara a escolha", async () => {
      const { deps, tela } = roteiro([...ATE_OS_PAPEIS, "2", "3", "1", "s", "", "", "s"]);
      const resultado = await runWizard({ ...deps, planWidth: async () => 2 });
      expect(resultado?.argv).toEqual(["build", "--provider", "codex", "--parallel", "3", "--workers-as-builder", "--save-execution"]);
      expect(tela()).toContain("este plano deixa até 2");
      expect(tela()).toContain("O plano só deixa 2 fase(s) rodarem ao mesmo tempo");
    });

    it("cada agente com o seu provider e modelo; Enter mantém o executor", async () => {
      // teto 2, configurar cada um; agente 1 = executor; agente 2 = claude/opus, sem effort, restrito
      const { deps } = roteiro([...ATE_OS_PAPEIS, "2", "2", "2", "", "2", "opus", "1", "s", "n", "", "", "s"]);
      const resultado = await runWizard(deps);
      expect(resultado?.argv).toEqual([
        "build",
        "--provider",
        "codex",
        "--parallel",
        "2",
        "--worker",
        "codex",
        "--worker",
        "provider=claude,model=opus,system-install=no",
      ]);
      expect(resultado?.command).toContain('--worker "provider=claude,model=opus,system-install=no"');
    });

    it("a lista dos agentes também oferece APIs via OpenCode", async () => {
      const { deps, tela } = roteiro([...ATE_OS_PAPEIS, "2", "2", "2", "", "", "n", "", "", "n"]);
      await runWizard(deps);
      const lista = tela().slice(tela().indexOf("Agente 1 — provider"));
      expect(lista).toContain("claude");
      expect(lista.slice(0, lista.indexOf("Agente 2"))).toContain("openrouter");
      expect(lista).toContain("API via OpenCode");
    });

    it("um worker escolhido como DeepSeek persiste o executor OpenCode", async () => {
      const { deps } = roteiro([...ATE_OS_PAPEIS, "2", "2", "2", "10", "1", "1", "n", "", "s", "", "", "n"]);
      const result = await runWizard({ ...deps, listModels: async (id) => id === "opencode" ? ["deepseek/deepseek-flash"] : [] });
      expect(result?.answers.execution).toEqual({ mode: "parallel", maxConcurrency: 2, workers: [{ provider: "opencode", model: "deepseek/deepseek-flash", effort: "" }] });
      expect(result?.argv).toContain("provider=opencode,model=deepseek/deepseek-flash");
    });

    it("indisponível aqui: a opção diz por quê e não pode ser escolhida", async () => {
      const { deps, tela } = roteiro([...ATE_OS_PAPEIS, "2", "1", "", "", "s"]);
      const resultado = await runWizard({ ...deps, parallelAvailability: async () => ({ disponivel: false, motivo: "o git não está instalado" }) });
      expect(tela()).toContain("indisponível aqui: o git não está instalado");
      expect(tela()).toContain("A execução paralela não roda aqui");
      expect(resultado?.argv).toEqual(["build", "--provider", "codex"]);
    });

    it("parte do que está salvo, e voltar ao serial num projeto paralelo grava o serial", async () => {
      const salva = { mode: "parallel" as const, maxConcurrency: 3, workers: [{ provider: "claude", model: "opus", effort: "" }] };
      const manter = roteiro([...ATE_OS_PAPEIS, "", "", "", "s", "", "", "s"]);
      const mantido = await runWizard({ ...manter.deps, readExecution: async () => salva });
      expect(mantido?.argv).toEqual(["build", "--provider", "codex", "--parallel", "3", "--worker", "provider=claude,model=opus", "--save-execution"]);

      const voltar = roteiro([...ATE_OS_PAPEIS, "1", "s", "", "", "s"]);
      const serial = await runWizard({ ...voltar.deps, readExecution: async () => salva });
      expect(serial?.argv).toEqual(["build", "--provider", "codex", "--serial", "--save-execution"]);
    });
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
    // O `prompt-engineer` foi acrescentado sem mudar os números anteriores.
    const { deps, tela } = roteiro(["", "9", "1", "1", "x", ".", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(tela()).toContain("entre 1 e 6");
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

describe("wizard do prompt engineer", () => {
  it("acrescenta a opção no fim e lê o prompt multiline, com saída em inglês por padrão", async () => {
    const { deps, tela } = roteiro([
      "", "6", "1", "quero revisar um contrato", "liste cláusulas que merecem atenção", ".",
      "", "1", "", "1", "n", "n",
    ]);
    const resultado = await runWizard(deps);

    expect(tela()).toContain("5) survey");
    expect(tela()).toContain("6) prompt-engineer");
    expect(tela()).toContain("Qual prompt cru você quer organizar?");
    expect(tela()).toContain("prompt Ponytail em inglês");
    expect(tela()).toContain("outra LLM ou para a própria capivara");
    expect(resultado?.argv).toEqual([
      "prompt-engineer", "quero revisar um contrato\nliste cláusulas que merecem atenção",
      "--provider", "codex", "--saida", "prompt-engineered.md",
    ]);
    expect(resultado?.execute).toBe(false);
  });

  it("reutiliza a origem de arquivo e permite escolher o destino do prompt", async () => {
    const { deps } = roteiro(["", "6", "2", "pedido.md", "docs/prompt pronto.md", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);

    expect(resultado?.argv).toEqual([
      "prompt-engineer", "--provider", "codex", "--file", "pedido.md", "--saida", "docs/prompt pronto.md",
    ]);
    expect(resultado?.command).toBe('capivara prompt-engineer --provider codex --file pedido.md --saida "docs/prompt pronto.md"');
  });

  it("reutiliza o pedido e os documentos do projeto MCP escolhido", async () => {
    const { deps } = roteiro(["/outro-projeto", "6", "3", "", "2", "", "1", "", "1", "n", "n"]);
    const resultado = await runWizard({
      ...deps,
      listMcpProjects: async () => [
        { slug: "primeiro", hasRequest: true, documents: 2 },
        { slug: "segundo", hasRequest: true, documents: 4 },
      ],
    });

    expect(resultado?.argv).toEqual([
      "prompt-engineer", "--provider", "codex", "--mcp", "http://localhost:7777/mcp", "--mcp-project", "segundo",
      "--saida", "prompt-engineered.md", "--project", "/outro-projeto",
    ]);
  });

  it("reutiliza os prompts MCP, inclusive sem a opção de projeto da base", async () => {
    const { deps, tela } = roteiro(["", "6", "3", "", "1", "", "1", "", "1", "n", "n"]);
    const resultado = await runWizard({
      ...deps,
      listMcpPrompts: async () => [{ name: "analise", title: "Análise de contratos", description: "revise o documento" }],
      readMcpPrompt: async (_url: string, name: string) => `Analise o contrato: ${name}`,
    });

    expect(tela()).toContain("Análise de contratos");
    expect(resultado?.argv).toEqual([
      "prompt-engineer", "Analise o contrato: analise", "--provider", "codex", "--saida", "prompt-engineered.md",
    ]);
  });

  it("configura somente o writer e não pergunta testes ou ciclos de construção", async () => {
    const { deps, tela } = roteiro([
      "", "6", "1", "organize um roteiro", ".", "", "1", "", "1", "s", "2", "sonnet", "n",
    ]);
    const resultado = await runWizard(deps);

    expect(resultado?.answers.roles).toEqual({ writer: { provider: "claude", model: "sonnet" } });
    expect(tela()).toContain("escritor documental");
    expect(tela()).not.toContain("auditor documental");
    expect(tela()).not.toContain("verificador documental");
    expect(tela()).not.toContain("Comando de teste do projeto");
    expect(tela()).not.toContain("Ciclos de correção");
  });

  it("prompt cru vazio encerra sem montar uma execução", async () => {
    const { deps, tela } = roteiro(["", "6", "1", "."]);
    expect(await runWizard(deps)).toBeNull();
    expect(tela()).toContain("Sem prompt não há o que organizar");
  });

  it("o wizard curto pede somente o prompt cru que faltou", async () => {
    const { deps, tela } = roteiro(["1", "gere um relatório mensal", "."]);
    const resultado = await runWizardDoPedido({ ...deps, comando: "prompt-engineer" });

    expect(resultado?.request).toBe("gere um relatório mensal");
    expect(tela()).toContain("falta informar o prompt cru");
    expect(tela()).toContain("Qual prompt cru você quer organizar?");
    expect(tela()).not.toContain("O que você quer fazer?");
  });

  it("serializa texto, destino e idioma da mesma maneira no argv e no comando impresso", () => {
    const answers = {
      command: "prompt-engineer" as const,
      request: "revise o documento",
      global: { provider: "codex" },
      roles: {},
      saida: "docs/prompt final.md",
      language: "pt" as const,
      projectRoot: "/projeto",
    };
    expect(toArgv(answers)).toEqual([
      "prompt-engineer", "revise o documento", "--provider", "codex", "--saida", "docs/prompt final.md",
      "--language", "pt", "--project", "/projeto",
    ]);
    expect(renderCommand(answers)).toBe(
      'capivara prompt-engineer "revise o documento" --provider codex --saida "docs/prompt final.md" --language pt --project /projeto',
    );
  });

  it("os passos da TUI descrevem pedido, saída e apenas o papel writer", () => {
    const steps = wizardSteps("prompt-engineer");
    expect(steps.map((step) => step.id)).toEqual(["request", "saida", "provider", "model", "writer-override"]);
    expect(steps.find((step) => step.id === "request")?.hint).toContain("base MCP");
    expect(steps.find((step) => step.id === "saida")?.hint).toContain("Ponytail, em inglês");
  });

  it("o comando impresso preserva variáveis e comandos literais que aparecem no prompt cru", () => {
    const request = '$HOME, $(pwd), `date`, "texto" e \\arquivo';
    const answers = { command: "prompt-engineer" as const, request, global: {}, roles: {} };

    expect(toArgv(answers)).toEqual(["prompt-engineer", request]);
    expect(renderCommand(answers)).toBe('capivara prompt-engineer "\\$HOME, \\$(pwd), \\`date\\`, \\"texto\\" e \\\\arquivo"');
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
 * tem código e não tem documento. Por isso mantém sua posição na lista e nunca é
 * sugerido — sugerir por ausência de `.capivara/` confundiria com o greenfield,
 * que também não tem.
 */
describe("wizard do levantamento", () => {
  it("monta o comando com a pasta da aplicação e o destino do levantamento", async () => {
    const { deps } = roteiro([
      "/sistema-antigo", // a aplicação a levantar
      "5",               // survey
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
    const { deps } = roteiro(["/sistema-antigo", "5", "./docs/legado", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toContain("--saida");
    expect(resultado?.argv).toContain("./docs/legado");
  });

  /*
   * O survey chama um papel só. Perguntar pelo auditor e pelo verificador aqui
   * seria pedir três decisões para um comando que usa uma.
   */
  it("pergunta só pelo papel que o levantamento usa", async () => {
    const { deps, tela } = roteiro(["/sistema-antigo", "5", "", "1", "", "1", "s", "1", "", "1", "n"]);
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
    const { deps } = roteiro(["/sistema-antigo", "5", "", "1", "http://127.0.0.1:7777/mcp", "1", "", "1", "n", "n"]);
    const resultado = await runWizard({ ...deps, listMcpProjects: async () => [] });

    expect(resultado?.argv).toContain("--mcp");
    expect(resultado?.argv).toContain("http://127.0.0.1:7777/mcp");
    expect(resultado?.argv).not.toContain("--mcp-project");
  });

  it("base que não responde não impede o levantamento: segue local", async () => {
    const { deps, tela } = roteiro([
      "/sistema-antigo",
      "5",
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

/**
 * O `change` no wizard.
 *
 * Ele pede a mesma coisa que o `init` — um pedido — e nada mais: o que já foi
 * decidido sobre o produto está no projeto, e perguntar de novo seria pedir ao
 * desenvolvedor o que o harness já sabe.
 */
describe("wizard da mudança", () => {
  it("o pedido de mudança vira argumento, como no init", async () => {
    const { deps } = roteiro([
      "",                              // pasta do projeto
      "4",                             // change
      "1",                             // escrever agora
      "quero editar clientes",
      ".",                             // fim do pedido
      "1",                             // provider codex
      "",                              // modelo padrão
      "1",                             // sem effort
      "n",                             // sem ajuste por papel
      "n",                             // não executar
    ]);

    const resultado = await runWizard(deps);
    expect(resultado?.argv).toEqual(["change", "quero editar clientes", "--provider", "codex"]);
  });

  it("o pedido pode vir de arquivo", async () => {
    const { deps } = roteiro(["", "4", "2", "pedido.md", "1", "", "1", "n", "n"]);
    const resultado = await runWizard(deps);
    expect(resultado?.argv).toContain("--file");
    expect(resultado?.argv[0]).toBe("change");
  });

  it("pergunta só pelo papel que a mudança usa", async () => {
    const { deps, tela } = roteiro(["", "4", "1", "editar clientes", ".", "1", "", "1", "s", "1", "", "1", "n"]);
    await runWizard(deps);
    expect(tela()).toContain("escritor documental");
    expect(tela()).not.toContain("executor do loop");
  });
});

/**
 * A terceira origem de um pedido: um prompt guardado na base.
 *
 * Digitar e apontar um arquivo já existiam. Esta existe porque o mesmo pedido
 * volta — "acrescente o CRUD completo deste cadastro" serve a três projetos, e
 * redigitá-lo em cada um é como as três versões começam a divergir.
 */
describe("escolher um prompt guardado", () => {
  // Como em produção: a base oferece projetos E prompts, então a lista do init
  // tem quatro origens. A posição de cada uma depende do que existe — e é por
  // isso que o wizard mapeia por chave, não por número fixo.
  const comPrompts = {
    listMcpProjects: async () => [{ slug: "mcp-teste", hasRequest: true, documents: 3 }],
    listMcpPrompts: async () => [
      { name: "mcp-teste/editar-cliente", title: "Editar cliente", description: "a edição que faltou" },
      { name: "geral/crud-completo", title: "CRUD completo", description: "serve a qualquer projeto" },
    ],
    readMcpPrompt: async (_url: string, name: string) =>
      name === "geral/crud-completo" ? "para cada cadastro, garanta criar, listar, editar e remover" : "editar clientes",
  };

  it("no init, o texto do prompt vira o pedido", async () => {
    const { deps, tela } = roteiro([
      "",                              // pasta
      "1",                             // init
      "4",                             // prompt guardado na base
      "http://127.0.0.1:7777/mcp",
      "2",                             // CRUD completo
      "1",                             // provider
      "",
      "1",
      "n",
      "n",
    ]);

    const resultado = await runWizard({ ...deps, ...comPrompts });
    expect(resultado?.argv[0]).toBe("init");
    expect(resultado?.argv[1]).toContain("criar, listar, editar e remover");
    // A lista mostra o NOME, que é para isso que eles têm nome.
    expect(tela()).toContain("CRUD completo");
    expect(tela()).toContain("serve a qualquer projeto");
  });

  it("no change, também", async () => {
    const { deps } = roteiro(["", "4", "3", "http://127.0.0.1:7777/mcp", "1", "1", "", "1", "n", "n"]);
    const resultado = await runWizard({ ...deps, ...comPrompts });

    expect(resultado?.argv[0]).toBe("change");
    expect(resultado?.argv[1]).toBe("editar clientes");
  });

  it("base sem prompt nenhum diz isso e não deixa o wizard travado", async () => {
    // Sem `listMcpProjects` a lista tem três origens, e o prompt é a terceira.
    const { deps, tela } = roteiro(["", "1", "3", "http://127.0.0.1:7777/mcp"]);
    const resultado = await runWizard({ ...deps, listMcpPrompts: async () => [], readMcpPrompt: async () => "" });

    expect(tela()).toContain("não tem prompt guardado");
    expect(resultado).toBeNull();
  });

  it("sem a capacidade de listar prompts, a opção não aparece", async () => {
    const { deps, tela } = roteiro(["", "1", "1", "um quadro kanban", ".", "1", "", "1", "n", "n"]);
    await runWizard(deps);
    expect(tela()).not.toContain("prompt guardado na base");
  });
});

/*
 * `capivara init --fresh` sem provider era recusado com a lista das duas formas
 * de passar a flag — o que manda a pessoa reescrever o comando inteiro que ela
 * acabou de escrever. Agora ele pergunta só o que falta.
 */
describe("o wizard curto, quando faltou só o modelo", () => {
  it("provider de API já informado usa OpenCode só no papel com ferramentas", async () => {
    const { deps, tela } = roteiro(["1", "1"]);
    const config = { provider: "deepseek", model: "", effort: "high", credential: "", command: "" };
    const result = await runWizardDePapeis({
      ...deps, comando: "build", faltando: ["builder", "verifier"],
      current: { writer: config, auditor: config, builder: config, verifier: config },
      listModels: async (id) => id === "opencode" ? ["deepseek/deepseek-flash"] : ["deepseek-flash"],
    });
    expect(result?.roles).toEqual({ builder: { provider: "opencode", model: "deepseek/deepseek-flash" }, verifier: { provider: "deepseek", model: "deepseek-flash" } });
    expect(tela()).toContain("deepseek será usado via OpenCode");
  });

  it("vai direto ao provider: quem digitou `init` não é perguntado de novo o estágio", async () => {
    const roteiroCurto = roteiro(["2", "", "", "n"]);
    const escolha = await runWizardDePapeis({ ...roteiroCurto.deps, comando: "init", faltando: ["writer", "auditor", "verifier"] });

    expect(roteiroCurto.tela()).not.toContain("O que você quer fazer?");
    expect(roteiroCurto.tela()).not.toContain("Pasta do projeto");
    expect(roteiroCurto.tela()).toContain("Qual provider usar");
    expect(escolha?.global.provider).toBe("claude");
  });

  it("diz o que falta e que o resto do comando está mantido", async () => {
    const roteiroCurto = roteiro(["1", "", "", "n"]);
    await runWizardDePapeis({ ...roteiroCurto.deps, comando: "build", faltando: ["builder", "verifier"] });

    expect(roteiroCurto.tela()).toContain("capivara build: falta dizer com que modelo rodar os papéis builder, verifier");
    expect(roteiroCurto.tela()).toContain("O resto do comando está mantido");
  });

  it("só oferece ajuste separado dos papéis que faltaram", async () => {
    const roteiroCurto = roteiro(["1", "", "", "s", "", ""]);
    await runWizardDePapeis({ ...roteiroCurto.deps, comando: "survey", faltando: ["writer"] });

    expect(roteiroCurto.tela()).toContain("escritor documental");
    expect(roteiroCurto.tela()).not.toContain("executor do loop");
  });

  it("responde só pelos papéis que faltaram, e não pelos que o comando já tinha", async () => {
    const roteiroCurto = roteiro(["1", "", "", "s", "", ""]);
    await runWizardDePapeis({ ...roteiroCurto.deps, comando: "build", faltando: ["verifier"] });

    expect(roteiroCurto.tela()).toContain("verificador independente");
    expect(roteiroCurto.tela()).not.toContain("executor do loop");
  });
});

/*
 * `capivara init --fresh --provider codex` — comando completo menos uma coisa:
 * o que construir. A resposta era um EmptyRequestError com stack trace, depois
 * de o wizard curto já ter perguntado os papéis. Parece defeito do harness, e
 * não pergunta nada a quem está ali para responder.
 */
describe("o wizard curto do pedido", () => {
  it("pergunta de onde vem o pedido, sem repetir estágio nem pasta", async () => {
    const roteiroCurto = roteiro(["1", "uma agenda de consultas", "."]);
    const pedido = await runWizardDoPedido({ ...roteiroCurto.deps, comando: "init" });

    expect(roteiroCurto.tela()).toContain("falta dizer o que construir");
    expect(roteiroCurto.tela()).not.toContain("O que você quer fazer?");
    expect(roteiroCurto.tela()).toContain("De onde vem o pedido?");
    expect(pedido?.request).toContain("uma agenda de consultas");
  });

  it("aceita o arquivo, conferindo que ele existe", async () => {
    const roteiroCurto = roteiro(["2", "pedido.md"]);
    const pedido = await runWizardDoPedido({ ...roteiroCurto.deps, comando: "init" });
    expect(pedido?.requestFile).toBe("pedido.md");
  });

  it("pedido vazio não vira comando: devolve nulo", async () => {
    const roteiroCurto = roteiro(["1", "."]);
    expect(await runWizardDoPedido({ ...roteiroCurto.deps, comando: "init" })).toBeNull();
  });
});
