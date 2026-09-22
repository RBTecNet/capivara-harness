import { describe, expect, it } from "vitest";
import { ROLE_NAMES, ROLES, buildInvocation, limitsFor } from "../../src/provider/index.js";
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
