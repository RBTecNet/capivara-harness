/**
 * Claude Code.
 *
 * Sobre o `--permission-mode` de um papel somente-leitura: NÃO é `plan`. O nome
 * engana — `plan` é o modo em que a CLI planeja antes de agir e grava o plano num
 * arquivo sob `~/.claude/plans/`, fora do diretório de trabalho. O papel então
 * tenta reler o próprio plano, esbarra no sandbox, e devolve como resposta uma
 * explicação de que não conseguiu abrir o arquivo.
 *
 * Foi o que aconteceu no piloto 6: a fase 5 do plano publicado não continha task
 * nenhuma, e sim o texto "Não consigo acessar o arquivo do plano … ele está fora
 * do diretório de trabalho permitido". Um run inteiro terminou NOT READY por
 * causa disso, e a culpa parecia ser do modelo mais barato.
 *
 * `default` é o modo certo: em `-p`, sem ninguém para aprovar, toda ferramenta
 * que exigiria permissão é negada. Somente-leitura de fato, sem o comportamento
 * de planejamento que ninguém pediu.
 */

import { join, resolve } from "node:path";
import type { CliAdapter, CliInvocationInput, ContratoDoWorkspace } from "./types.js";

/*
 * O nível `workspace` do executor: o sandbox nativo do Claude Code (§106).
 *
 * `acceptEdits` sozinho aprova edição de arquivo e nada mais: em `-p`, todo
 * Bash que não é de leitura fica pendente de aprovação, e aprovação pendente
 * vira negação. No `teste_haiku_v2` o Haiku não pôde rodar nem `npm --version`,
 * e três ciclos foram cobrados como código incompleto.
 *
 * Com o sandbox, o Bash roda sem aprovação DENTRO de um sandbox do sistema
 * operacional (bubblewrap no Linux): escreve no worktree e no temporário da
 * chamada, alcança a internet pelo proxy do Claude Code, e não escreve fora.
 * Cada chave abaixo foi conferida com a CLI real (2.1.301), numa pasta
 * descartável — o diagnóstico em `docs/` traz a matriz de sondas:
 *
 * - `failIfUnavailable`: sem bubblewrap, a CLI não sobe em vez de rodar sem
 *   sandbox — o que seria acesso irrestrito com outro nome;
 * - `allowUnsandboxedCommands: false`: o comando que falha no sandbox não é
 *   repetido fora dele;
 * - `allowedDomains: ["*"]`: os domínios permitidos começam vazios, e em `-p`
 *   o host fora da lista é recusado — `npm install` não chegaria ao registry;
 * - `allowWrite` dos caches do npm e do Playwright: fora deles, `npm install`
 *   falha com EROFS em `~/.npm`;
 * - `denyWrite` do Git e do plano de controle: num worktree o sandbox libera de
 *   propósito o `.git` da árvore principal, para `git commit` funcionar — e só
 *   o Core registra (§101). `.capivara/init` é especificação, só de leitura.
 *
 * E os Unix sockets. O Claude Code os bloqueia com um filtro seccomp, que
 * neste kernel não sobe (o `apply-seccomp` precisa de um user namespace
 * aninhado, e o kernel o restringe): com o filtro ligado, TODO comando falha.
 * Sem filtro, um comando alcança o gerenciador do systemd do usuário e executa
 * fora do sandbox — comprovado com `systemd-run --user`. Por isso o filtro sai
 * e os diretórios onde os sockets vivem ficam ilegíveis: `/run` (systemd,
 * D-Bus, agentes), `/tmp` (X11, acesso remoto, outras sessões), e os de
 * agente de chave e de outras CLIs no home. É uma lista: um socket criado fora
 * dela continua alcançável, e o diagnóstico registra isso como limitação.
 */
const CACHES_GRAVAVEIS = ["~/.npm", "~/.cache/ms-playwright"];
const SOCKETS_DO_LINUX = ["/run", "/var/run", "/tmp", "~/.ssh", "~/.gnupg", "~/.codex"];
/*
 * Com a internet liberada, o que o comando LÊ pode sair da máquina. O sandbox
 * lê quase tudo por padrão, inclusive credenciais: nesta máquina, o token do
 * `gh` (com push no remoto) e a credencial do próprio Claude Code estavam ao
 * alcance de qualquer `cat`. Ficam ilegíveis os lugares conhecidos de
 * credencial — a pasta vira ilegível, o arquivo vira `/dev/null` —; os arquivos de configuração que os gerenciadores de pacote leem
 * (`.npmrc`, `.pypirc`) ficam de fora, porque a instalação depende deles.
 */
const CREDENCIAIS = [
  "~/.ssh",
  "~/.gnupg",
  "~/.codex",
  "~/.aws",
  "~/.azure",
  "~/.config/gcloud",
  "~/.config/gh",
  "~/.docker",
  "~/.kube",
  "~/.netrc",
  "~/.git-credentials",
  "~/.claude/.credentials.json",
  "~/.claude.json",
];

/*
 * E o que o comando herda no ambiente. A ponte passa o ambiente de quem rodou a
 * capivara, e nele podem estar as chaves dos providers e o token do GitHub. Os
 * tokens do npm ficam, como o `.npmrc`: o pacote privado depende deles. Cada
 * chave do catálogo de APIs diretas está aqui — um teste confere.
 */
export const VARIAVEIS_DE_CREDENCIAL = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MINIMAX_API_KEY",
  "OPENROUTER_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

export function sandboxDoWorkspace(input: Pick<CliInvocationInput, "projectRoot" | "platform" | "gitDir" | "env">): Record<string, unknown> {
  const raiz = resolve(input.projectRoot);
  const controle = [join(raiz, ".capivara", "init"), join(raiz, ".capivara", "runs")];
  const linux = input.platform === "linux";
  const runtime = input.env.XDG_RUNTIME_DIR?.trim();
  const sockets = linux ? [...SOCKETS_DO_LINUX, ...(runtime && !runtime.startsWith("/run/") ? [runtime] : [])] : [];
  const ilegiveis = [...new Set([...sockets, ...CREDENCIAIS])];
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: ["*"], ...(linux ? { allowAllUnixSockets: true } : {}) },
      filesystem: {
        allowWrite: CACHES_GRAVAVEIS,
        denyWrite: [...(input.gitDir ? [input.gitDir] : []), ...controle],
        denyRead: ilegiveis,
      },
      credentials: { envVars: VARIAVEIS_DE_CREDENCIAL.map((name) => ({ name, mode: "deny" })) },
    },
    // As ferramentas de arquivo do Claude rodam FORA do sandbox e seguem as
    // regras de permissão: o `acceptEdits` as deixaria editar a especificação.
    permissions: { deny: controle.map((pasta) => `Edit(/${pasta}/**)`) },
  };
}

function contrato(platform: NodeJS.Platform): ContratoDoWorkspace {
  if (platform === "linux") {
    return {
      estado: "garantido",
      motivo:
        "sandbox do Claude Code (bubblewrap): comandos sem aprovação, internet pelo proxy, escrita só no projeto, " +
        "no temporário da chamada e nos caches do npm e do Playwright; Git e .capivara/init só de leitura",
      dependencias: ["bwrap", "socat"],
    };
  }
  if (platform === "win32") {
    return { estado: "insuficiente", motivo: "o sandbox do Claude Code não roda no Windows nativo, e sem ele o executor só edita arquivos" };
  }
  return { estado: "nao-verificado", motivo: `o sandbox do Claude Code em ${platform} não foi verificado por este harness` };
}

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  binaryEnv: "CAPIVARA_CLAUDE_BIN",
  defaultBinary: "claude",
  transcript: "claude-json",
  // `-p --output-format json`: um objeto só, no fim. Nada antes disso.
  streams: false,
  build: ({ projectRoot, platform, gitDir, model, effort, access, env }) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--permission-mode", access === "read-only" ? "default" : access === "system" ? "bypassPermissions" : "acceptEdits",
    ];
    if (access === "workspace") args.push("--settings", JSON.stringify(sandboxDoWorkspace({ projectRoot, platform, gitDir, env })));
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    // O marcador de sessão faz a CLI se comportar como se estivesse aninhada em
    // outra; a chamada aqui é independente e precisa nascer limpa.
    const { CLAUDECODE: _ignorado, ...semMarcador } = env;
    return { args, env: semMarcador, ...(access === "workspace" ? { tmpPrivado: true } : {}) };
  },
  workspace: contrato,
} as const satisfies CliAdapter;
