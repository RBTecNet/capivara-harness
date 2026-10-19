/** OpenCode. */

import type { CliAdapter } from "./types.js";

/** Default fechado cobre shell/write e MCP, inclusive ferramentas desconhecidas. */
const SOMENTE_LEITURA = {
  "*": "deny", read: "allow", glob: "allow", grep: "allow", list: "allow",
  edit: "deny", bash: "deny", task: "deny", external_directory: "deny",
} as const;

/*
 * O executor precisa das permissões declaradas, não herdadas.
 *
 * Sem `OPENCODE_PERMISSION`, a CLI usa o default dela — que nega diretório
 * externo. E ferramenta de build normal usa diretório externo o tempo todo: npm
 * escreve cache em `~/.npm`, Vite e tsc usam `/tmp`. O piloto 6-mimo morreu
 * exatamente assim, na primeira linha da sessão:
 *
 *     Iniciando a configuração do projeto Vite + React 19 + TypeScript.
 *     ! permission requested: external_directory (/tmp/*); auto-rejecting
 *
 * A sessão encerrou sem escrever nada, e o gate 1 relatou "a sessão não escreveu
 * nada" — verdade que escondia a causa. Quem executa recebe o que executar exige,
 * dito por extenso.
 */
// O equivalente ao bypass das outras CLIs precisa cobrir TODAS as ferramentas,
// inclusive read, webfetch, MCP e doom_loop, sem herdar ask/deny do ambiente.
const EXECUTOR = { "*": "allow" } as const;

export const opencodeAdapter = {
  id: "opencode",
  label: "OpenCode",
  binaryEnv: "CAPIVARA_OPENCODE_BIN",
  defaultBinary: "opencode",
  transcript: "opencode-jsonl",
  // JSONL evento a evento, como o codex.
  streams: true,
  build: ({ model, effort, access, env }) => {
    // OpenCode 2 usa o cwd do processo: --dir e --variant foram removidos.
    // O servidor privado recebe o ambiente e as permissões desta chamada.
    const args = ["run", "--standalone", "--format", "json"];
    if (effort && !model) throw new Error("o OpenCode exige um modelo explícito para configurar a intensidade de raciocínio");
    if (model) args.push("--model", effort ? `${model}#${effort}` : model);
    // --auto evita prompts restantes; o wildcard acima também libera os denies
    // de permissão global. Só --auto continuaria respeitando esses denies.
    if (access !== "read-only") args.push("--auto");
    let content: unknown;
    try { content = env.OPENCODE_CONFIG_CONTENT?.trim() ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : {}; }
    catch { throw new Error("OPENCODE_CONFIG_CONTENT incompatível; nenhuma inferência foi enviada"); }
    if (content === null || typeof content !== "object" || Array.isArray(content)) {
      throw new Error("OPENCODE_CONFIG_CONTENT incompatível; nenhuma inferência foi enviada");
    }
    const permission = access === "read-only" ? SOMENTE_LEITURA : EXECUTOR;
    // OpenCode 2 ignora OPENCODE_PERMISSION. A configuração inline é efetiva;
    // a variável antiga fica apenas para compatibilidade com CLIs anteriores.
    const { permissions: _previousRules, ...config } = content as Record<string, unknown>;
    return { args, env: {
      ...env, OPENCODE_PERMISSION: JSON.stringify(permission),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...config, permission }),
    } };
  },
  // Não há sandbox: o executor recebe bash e diretório externo liberados, e o build segue (§112).
  workspace: () => ({
    estado: "nao-verificado",
    motivo: 'o opencode não tem sandbox: o executor roda com --auto e OPENCODE_PERMISSION={"*":"allow"}, com acesso amplo ao sistema, à rede e aos arquivos do usuário (§112)',
  }),
} as const satisfies CliAdapter;
