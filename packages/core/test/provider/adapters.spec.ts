import { describe, expect, it } from "vitest";
import { CLI_ADAPTERS, DIRECT_CATALOG, ROLE_NAMES, ROLES, buildInvocation, contratoDoWorkspace, limitsFor } from "../../src/provider/index.js";
import { VARIAVEIS_DE_CREDENCIAL } from "../../src/provider/cli/claude.js";
import type { RoleConfig } from "../../src/provider/index.js";

const context = {
  projectRoot: "/tmp/projeto",
  runId: "init-abc123abc123",
  stage: "authoring",
  language: "pt-BR",
  environment: {} as NodeJS.ProcessEnv,
};

const config = (overrides: Partial<RoleConfig> = {}): RoleConfig => ({
  provider: "codex",
  model: "gpt-5",
  effort: "",
  credential: "",
  command: "",
  ...overrides,
});

describe("sandbox por papel — a fronteira mais delicada", () => {
  it("codex: papéis read-only recebem --sandbox read-only", () => {
    for (const role of ROLE_NAMES.filter((name) => ROLES[name].permission === "read-only")) {
      const invocation = buildInvocation(role, config(), context);
      expect(invocation.args.join(" ")).toContain("--sandbox read-only");
    }
  });

  it("codex: só o executor recebe workspace-write", () => {
    expect(buildInvocation("builder", config(), context).args.join(" ")).toContain("--sandbox workspace-write");
  });

  /*
   * `plan` NÃO é o modo somente-leitura, apesar do nome. É o modo em que a CLI
   * grava um plano em `~/.claude/plans/` e depois tenta relê-lo — fora do
   * diretório de trabalho, onde o sandbox barra. No piloto 6 uma fase inteira do
   * plano publicado era a explicação da CLI de que não conseguiu abrir o próprio
   * arquivo, e o run terminou NOT READY por isso.
   */
  it("claude: papel somente-leitura usa default, nunca plan", () => {
    for (const papel of ["writer", "auditor", "verifier"] as const) {
      const args = buildInvocation(papel, config({ provider: "claude" }), context).args.join(" ");
      expect(args, papel).toContain("--permission-mode default");
      expect(args, papel).not.toContain("--permission-mode plan");
    }
  });

  it("claude: o executor continua podendo editar", () => {
    expect(buildInvocation("builder", config({ provider: "claude" }), context).args.join(" ")).toContain("--permission-mode acceptEdits");
  });

  it("opencode: read-only nega edit, bash, task e diretório externo", () => {
    const invocation = buildInvocation("verifier", config({ provider: "opencode" }), context);
    expect(invocation.env.OPENCODE_PERMISSION).toContain('"edit":"deny"');
    expect(invocation.env.OPENCODE_PERMISSION).toContain('"external_directory":"deny"');
  });

  /*
   * Herdar o default da CLI não servia: ele nega diretório externo, e npm, Vite e
   * tsc usam `/tmp` e `~/.npm` o tempo todo. O piloto 6-mimo morreu na primeira
   * linha da sessão, com "auto-rejecting" e nenhum arquivo escrito.
   */
  it("opencode: o executor recebe as permissões declaradas, não herdadas", () => {
    const permissao = buildInvocation("builder", config({ provider: "opencode" }), context).env.OPENCODE_PERMISSION;
    expect(permissao).toBeDefined();
    expect(permissao).toContain('"edit":"allow"');
    expect(permissao).toContain('"bash":"allow"');
    expect(permissao).toContain('"external_directory":"allow"');
  });
});

describe("prompt e segredo nunca viram argumento", () => {
  it("todo provider recebe o prompt por stdin", () => {
    for (const provider of ["codex", "claude", "opencode"]) {
      expect(buildInvocation("writer", config({ provider }), context).stdinIsPrompt).toBe(true);
    }
  });

  it("o segredo de API direta viaja pelo ambiente, nunca em argv", () => {
    const invocation = buildInvocation("writer", config({ provider: "deepseek", model: "deepseek-chat" }), {
      ...context,
      secret: "sk-segredo-muito-secreto",
    });
    expect(invocation.args.join(" ")).not.toContain("sk-segredo");
    expect(invocation.env.DEEPSEEK_API_KEY).toBe("sk-segredo-muito-secreto");
  });
});

describe("regras de provider", () => {
  it("o executor via API direta é recusado com explicação", () => {
    expect(() => buildInvocation("builder", config({ provider: "openai", model: "gpt-5" }), context)).toThrow(
      /precisa escrever arquivos e rodar comandos/,
    );
  });

  it("API direta exige modelo explícito", () => {
    expect(() => buildInvocation("writer", config({ provider: "openai", model: "" }), context)).toThrow(/exige/);
  });

  it("o adapter custom exige o caminho do executável", () => {
    expect(() => buildInvocation("writer", config({ provider: "custom" }), context)).toThrow(/executável/);
    expect(buildInvocation("writer", config({ provider: "custom", command: "/bin/meu-adapter" }), context).command).toBe("/bin/meu-adapter");
  });

  it("provider desconhecido falha cedo", () => {
    expect(() => buildInvocation("writer", config({ provider: "inventado" }), context)).toThrow(/desconhecido/);
  });

  it("modelo ou effort com caracteres estranhos é recusado", () => {
    expect(() => buildInvocation("writer", config({ model: "gpt-5; rm -rf /" }), context)).toThrow(/inválido/);
  });
});

describe("ambiente da invocação", () => {
  it("declara papel, permissão e idioma", () => {
    const invocation = buildInvocation("verifier", config(), context);
    expect(invocation.env.CAPIVARA_ROLE).toBe("verifier");
    expect(invocation.env.CAPIVARA_PERMISSION).toBe("read-only");
    expect(invocation.env.CAPIVARA_LANGUAGE).toBe("pt-BR");
  });

  /*
   * O diretório da chamada é o do projeto, para TODA CLI (§105). Só o codex
   * recebia a raiz, por `--cd`; o claude herdava o cwd de quem rodou a
   * capivara, e no paralelo o executor Haiku escreveu a P01 inteira na árvore
   * principal enquanto o verificador conferia o worktree vazio.
   */
  it("toda CLI roda no diretório do projeto, não no de quem chamou", () => {
    for (const adapter of CLI_ADAPTERS) {
      const invocation = buildInvocation("builder", config({ provider: adapter.id, command: "/bin/adapter" }), context);
      expect(invocation.cwd, adapter.id).toBe(context.projectRoot);
    }
  });
});

describe("antigravity", () => {
  const agy = (papel: "writer" | "auditor" | "verifier" | "builder", systemInstall = false) =>
    buildInvocation(papel, config({ provider: "agy" }), { ...context, systemInstall }).args.join(" ");

  it("o prompt não vira argumento: esta CLI lê de stdin", () => {
    // `-p` aqui espera o texto como valor do próprio flag; passá-lo vazio faz a
    // CLI tomar o argumento seguinte como prompt. Foi o primeiro erro ao integrar.
    // Comparado como argumento inteiro: `--dangerously-skip-permissions` contém
    // "-p" como substring e passaria por um `toContain` ingênuo.
    const args = buildInvocation("writer", config({ provider: "agy" }), context).args;
    expect(args).not.toContain("-p");
    expect(args).not.toContain("--print");
    expect(agy("writer")).toContain("--output-format json");
  });

  /*
   * A lição que o adaptador do Claude custou: `plan` não é somente-leitura, é o
   * modo que grava um plano em arquivo e depois tenta relê-lo.
   */
  it("papel somente-leitura nunca entra em modo plan, e é o sandbox que o segura", () => {
    for (const papel of ["writer", "auditor", "verifier"] as const) {
      expect(agy(papel), papel).not.toContain("--mode plan");
      // Verificado contra a CLI real: com --sandbox, um pedido explícito de criar
      // arquivo devolve a resposta e não cria nada.
      expect(agy(papel), papel).toContain("--sandbox");
      expect(agy(papel), papel).not.toContain("--mode accept-edits");
    }
  });

  /*
   * O nome assusta e o efeito aqui é o oposto: sem ele, a primeira ferramenta que
   * a CLI quisesse usar seria negada — headless não tem a quem perguntar — e a
   * volta inteira voltaria vazia. Foi o que esvaziou duas fases do piloto 7, com
   * a CLI reportando SUCCESS e `response: ""`.
   */
  it("somente-leitura também pula o prompt de permissão, senão a volta vem vazia", () => {
    expect(agy("writer")).toContain("--dangerously-skip-permissions");
  });

  /*
   * E a lição que o adaptador do opencode custou: quem executa precisa da
   * permissão dita por extenso, senão a sessão morre na primeira ferramenta.
   */
  it("o executor edita sem depender de aprovação, porque não há quem aprove", () => {
    expect(agy("builder")).toContain("--mode accept-edits");
    expect(agy("builder")).toContain("--dangerously-skip-permissions");
  });

  it("com instalação de sistema, nem o sandbox entra", () => {
    expect(agy("builder", true)).not.toContain("--sandbox");
    expect(agy("builder", false)).toContain("--sandbox");
  });

  it("modelo e effort chegam à linha de comando", () => {
    const args = buildInvocation("writer", config({ provider: "agy", model: "gemini-3.1-pro-high", effort: "high" }), context).args.join(" ");
    expect(args).toContain("--model gemini-3.1-pro-high");
    expect(args).toContain("--effort high");
  });
});

describe("cursor", () => {
  const cursor = (papel: "writer" | "auditor" | "verifier" | "builder") =>
    buildInvocation(papel, config({ provider: "cursor" }), context).args.join(" ");

  /*
   * Sem `--trust` a CLI para e pede para ser rodada interativamente — em modo
   * headless, uma sessão perdida sem diagnóstico. A capivara só roda dentro do
   * projeto que o operador apontou, então a confiança é a premissa da chamada.
   */
  it("todo papel confia no diretório, senão a CLI não sai do lugar", () => {
    for (const papel of ["writer", "auditor", "verifier", "builder"] as const) {
      expect(cursor(papel), papel).toContain("--trust");
    }
  });

  /*
   * A CLI oferece `plan` e `ask`. `plan` analisa e PROPÕE planos; `ask` é Q&A e
   * recusa editar — verificado contra a CLI real. Escolher pelo nome mais óbvio
   * foi o que custou uma fase inteira do piloto 6 no adaptador do Claude.
   */
  it("somente-leitura é ask, nunca plan", () => {
    for (const papel of ["writer", "auditor", "verifier"] as const) {
      expect(cursor(papel), papel).toContain("--mode ask");
      expect(cursor(papel), papel).not.toContain("--mode plan");
    }
  });

  it("o executor não entra em modo de leitura: `-p` já lhe dá write e shell", () => {
    // Comparado como argumento: `--mode` é substring de `--model` e passaria por
    // um `toContain` ingênuo. É a mesma armadilha de `-p` dentro de
    // `--dangerously-skip-permissions`, no adaptador do antigravity.
    const args = buildInvocation("builder", config({ provider: "cursor" }), context).args;
    expect(args).not.toContain("--mode");
    expect(args).toContain("-p");
  });

  /**
   * O que travou a fase 1 do MCP_teste2.
   *
   * `--trust` confia no diretório e `-p` promete "access to all tools, including
   * write and shell" — e ainda assim cada comando parava numa aprovação que,
   * numa chamada `-p`, não tem quem responda. O executor precisava de um `npm
   * install`, relatou "o shell foi bloqueado", e no terceiro ciclo reescreveu o
   * comando de teste do projeto para não precisar da dependência.
   */
  /**
   * O `agy` não trabalha no diretório em que foi lançado.
   *
   * Medido com um `pwd`: sem `--add-dir`, o terminal dela responde
   * `~/.gemini/antigravity-cli/scratch`. Com ele, responde a raiz do projeto. É
   * defeito que não aparece como erro — o `npm install` funciona, instala, e
   * instala no lugar errado.
   */
  it("agy: todo papel é dito onde o projeto está", () => {
    for (const papel of ROLE_NAMES) {
      const args = buildInvocation(papel, config({ provider: "agy", model: "" }), context).args;
      expect(args, papel).toContain("--add-dir");
      expect(args[args.indexOf("--add-dir") + 1], papel).toBe(context.projectRoot);
    }
  });

  it("o executor recebe --force: sem ele, escrever pode e executar não", () => {
    const args = buildInvocation("builder", config({ provider: "cursor", model: "" }), context).args;
    expect(args).toContain("--force");
  });

  it("acesso de sistema desliga o sandbox, como nas outras CLIs", () => {
    const comSistema = { ...context, systemInstall: true };
    const args = buildInvocation("builder", config({ provider: "cursor", model: "" }), comSistema).args;
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("disabled");

    // Sem o acesso de sistema, o sandbox fica como o operador configurou.
    expect(buildInvocation("builder", config({ provider: "cursor", model: "" }), context).args).not.toContain("--sandbox");
  });

  it("papel de leitura não ganha --force: ele não executa nada", () => {
    for (const papel of ROLE_NAMES.filter((nome) => ROLES[nome].permission === "read-only")) {
      const args = buildInvocation(papel, config({ provider: "cursor", model: "" }), context).args;
      expect(args, papel).not.toContain("--force");
      expect(args, papel).toContain("--mode");
    }
  });

  it("a intensidade vive no nome do modelo, e nenhum --effort é inventado", () => {
    const args = buildInvocation("builder", config({ provider: "cursor", model: "composer-2.5", effort: "high" }), context).args.join(" ");
    expect(args).toContain("--model composer-2.5");
    expect(args).not.toContain("--effort");
  });
});

/**
 * O defeito que matou a fase 3 do MCP_teste.
 *
 * O limite de primeira saída existe para pegar o provider que nunca começou.
 * Com `claude -p --output-format json` não sai byte nenhum antes do fim, então
 * ele virava um relógio sobre a resposta inteira: aos 20 minutos a chamada
 * morreu sem uma linha de saída, e o ciclo de correção foi cobrado do código —
 * que estava sendo escrito.
 */
describe("o relógio de primeira saída só vale para quem transmite", () => {
  const limites = { firstOutputSeconds: 1200, idleSeconds: 600, wallSeconds: 3600, maxOutputBytes: 1_000 };

  it("CLI de objeto único fica sob o limite de parede, não o de primeira saída", () => {
    for (const provider of ["claude", "cursor", "agy"]) {
      const invocation = buildInvocation("builder", config({ provider, model: "" }), context);
      expect(invocation.streams, provider).toBe(false);
      expect(limitsFor(invocation, limites).firstOutputSeconds, provider).toBe(0);
      // E o que mede a chamada inteira continua de pé.
      expect(limitsFor(invocation, limites).wallSeconds, provider).toBe(3600);
    }
  });

  it("CLI que transmite mantém o limite: ficar calada nela é sinal de que não começou", () => {
    for (const provider of ["codex", "opencode"]) {
      const invocation = buildInvocation("builder", config({ provider, model: "" }), context);
      expect(invocation.streams, provider).toBe(true);
      expect(limitsFor(invocation, limites).firstOutputSeconds, provider).toBe(1200);
    }
  });
});

/*
 * §106: no nível workspace, `acceptEdits` sozinho negava todo Bash que não é de
 * leitura — o Haiku do `teste_haiku_v2` não rodou nem `npm --version`. O
 * executor agora recebe o sandbox nativo do Claude Code. Estes testes fixam a
 * configuração que as sondas com a CLI real comprovaram (o diagnóstico em
 * docs/ traz a matriz); eles não substituem a sonda, que é evidência de outra
 * natureza.
 */
describe("claude no nível workspace: o sandbox nativo", () => {
  const raiz = "/home/x/.cache/capivara/worktrees/abc/build-1/P01";
  const workspace = (platform: NodeJS.Platform = "linux") =>
    buildInvocation("builder", config({ provider: "claude", model: "haiku" }), {
      ...context,
      projectRoot: raiz,
      platform,
      gitDir: "/home/x/projeto/.git",
      environment: { XDG_RUNTIME_DIR: "/run/user/1000" },
    });
  const settings = (platform?: NodeJS.Platform): Record<string, any> => {
    const args = workspace(platform).args;
    const indice = args.indexOf("--settings");
    expect(indice).toBeGreaterThan(-1);
    return JSON.parse(args[indice + 1]!);
  };

  it("o Bash roda sem aprovação, mas só dentro do sandbox, e o sandbox não tem como ficar de fora", () => {
    const sandbox = settings().sandbox;
    expect(sandbox.enabled).toBe(true);
    expect(sandbox.autoAllowBashIfSandboxed).toBe(true);
    // O comando que falha no sandbox não é repetido fora dele…
    expect(sandbox.allowUnsandboxedCommands).toBe(false);
    // …e sem bubblewrap a CLI não sobe, em vez de rodar sem sandbox.
    expect(sandbox.failIfUnavailable).toBe(true);
    expect(sandbox.excludedCommands).toBeUndefined();
  });

  it("a internet é alcançável pelo proxy do sandbox: os domínios não começam vazios", () => {
    expect(settings().sandbox.network.allowedDomains).toEqual(["*"]);
  });

  it("a escrita fora do projeto continua negada: Git, especificação e plano de controle", () => {
    const fs = settings().sandbox.filesystem;
    expect(fs.denyWrite).toContain("/home/x/projeto/.git");
    expect(fs.denyWrite).toContain(`${raiz}/.capivara/init`);
    expect(fs.denyWrite).toContain(`${raiz}/.capivara/runs`);
    // Fora do projeto, só os caches dos gerenciadores de pacote.
    expect(fs.allowWrite).toEqual(["~/.npm", "~/.cache/ms-playwright"]);
    // As ferramentas de arquivo rodam fora do sandbox: a regra de permissão as cobre.
    expect(settings().permissions.deny).toEqual([`Edit(/${raiz}/.capivara/init/**)`, `Edit(/${raiz}/.capivara/runs/**)`]);
  });

  it("no Linux, sem o filtro de sockets, os diretórios onde eles vivem ficam ilegíveis", () => {
    const sandbox = settings("linux").sandbox;
    expect(sandbox.network.allowAllUnixSockets).toBe(true);
    for (const pasta of ["/run", "/var/run", "/tmp", "~/.ssh", "~/.gnupg", "~/.codex"]) expect(sandbox.filesystem.denyRead).toContain(pasta);
  });

  it("fora do Linux, nenhum socket é liberado, e nada do Linux é mascarado", () => {
    const sandbox = settings("darwin").sandbox;
    expect(sandbox.network.allowAllUnixSockets).toBeUndefined();
    expect(sandbox.filesystem.denyRead).not.toContain("/run");
  });

  it("com a internet liberada, as credenciais conhecidas ficam ilegíveis, em toda plataforma", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const ilegiveis = settings(platform).sandbox.filesystem.denyRead;
      for (const caminho of ["~/.config/gh", "~/.claude/.credentials.json", "~/.aws", "~/.ssh", "~/.git-credentials"]) {
        expect(ilegiveis, `${platform} ${caminho}`).toContain(caminho);
      }
      // A instalação lê a configuração do gerenciador de pacotes.
      expect(ilegiveis).not.toContain("~/.npmrc");
    }
  });

  it("as chaves dos providers e o token do GitHub saem do ambiente dos comandos", () => {
    const negadas = settings().sandbox.credentials.envVars;
    for (const nome of ["GITHUB_TOKEN", "GH_TOKEN", "ANTHROPIC_API_KEY"]) expect(negadas).toContainEqual({ name: nome, mode: "deny" });
    // Nenhuma chave do catálogo de APIs diretas fica de fora da lista.
    for (const provider of DIRECT_CATALOG) expect(VARIAVEIS_DE_CREDENCIAL, provider.id).toContain(provider.envKey);
    // O token do npm fica: o pacote privado depende dele.
    expect(negadas.map((entrada: { name: string }) => entrada.name)).not.toContain("NPM_TOKEN");
  });

  it("nunca acesso irrestrito: nem bypassPermissions, nem Bash liberado por regra", () => {
    const args = workspace().args.join(" ");
    expect(args).toContain("--permission-mode acceptEdits");
    expect(args).not.toContain("bypassPermissions");
    expect(args).not.toMatch(/--allowed-?tools/i);
    expect(args).not.toContain("--dangerously");
    expect(settings().permissions.allow).toBeUndefined();
  });

  it("pede um TMPDIR só dele: o padrão /tmp/claude-<uid> é o mesmo para toda sessão do usuário", () => {
    expect(workspace().tmpPrivado).toBe(true);
  });

  it("os outros níveis não mudam: sem settings e sem temporário próprio", () => {
    for (const [papel, nivel] of [["verifier", "default"], ["builder", "bypassPermissions"]] as const) {
      const invocation = buildInvocation(papel, config({ provider: "claude" }), { ...context, systemInstall: true });
      expect(invocation.args.join(" ")).toContain(`--permission-mode ${nivel}`);
      expect(invocation.args).not.toContain("--settings");
      expect(invocation.tmpPrivado).toBeUndefined();
    }
  });
});

describe("o contrato do nível workspace em cada provider (§106)", () => {
  it("toda CLI declara o que garante, com o motivo", () => {
    for (const adapter of CLI_ADAPTERS) {
      for (const platform of ["linux", "darwin", "win32"] as const) {
        const contrato = adapter.workspace(platform);
        expect(["garantido", "insuficiente", "nao-verificado"], adapter.id).toContain(contrato.estado);
        expect(contrato.motivo.length, adapter.id).toBeGreaterThan(20);
      }
    }
  });

  it("claude: garantido no Linux, dependendo de bubblewrap e socat; insuficiente no Windows", () => {
    expect(contratoDoWorkspace("claude", "linux")).toMatchObject({ estado: "garantido", dependencias: ["bwrap", "socat"] });
    expect(contratoDoWorkspace("claude", "win32")?.estado).toBe("insuficiente");
    expect(contratoDoWorkspace("claude", "darwin")?.estado).toBe("nao-verificado");
  });

  it("codex e opencode: insuficientes — rede e confinamento não cabem juntos, ou não há sandbox", () => {
    expect(contratoDoWorkspace("codex", "linux")?.estado).toBe("insuficiente");
    expect(contratoDoWorkspace("codex", "linux")?.motivo).toContain("systemd");
    expect(contratoDoWorkspace("opencode", "linux")?.estado).toBe("insuficiente");
  });

  it("o que não pôde ser verificado não é anunciado como garantido", () => {
    for (const id of ["cursor", "agy", "custom"]) expect(contratoDoWorkspace(id, "linux")?.estado, id).toBe("nao-verificado");
  });

  it("API direta não tem contrato de workspace: nem pode construir", () => {
    expect(contratoDoWorkspace("openai", "linux")).toBeNull();
  });
});
