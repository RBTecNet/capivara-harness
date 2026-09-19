import { describe, expect, it } from "vitest";
import { ROLE_NAMES, ROLES, buildInvocation } from "../../src/provider/index.js";
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
    expect(buildInvocation("builder", config({ provider: "opencode" }), context).env.OPENCODE_PERMISSION).toBeUndefined();
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
