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

import type { CliAdapter, ContratoDoWorkspace } from "./types.js";

/*
 * O executor claude roda com `--dangerously-skip-permissions` (§108).
 *
 * O §106 o pôs em `acceptEdits` dentro do sandbox nativo do Claude Code, e no
 * `teste_haiku_v2` isso ainda mandava para aprovação comandos normais de
 * desenvolvimento — `| tail`, `| head`, `timeout`, variável na frente do
 * comando, laço —, e aprovação pendente, em `-p`, é negação. O operador decidiu
 * liberar o executor: Bash, npm, pipes, laços, compilação e testes sem aprovação
 * nenhuma.
 *
 * O preço é dito sem rodeio: o executor tem acesso amplo ao sistema, à rede e
 * aos arquivos do usuário — o mesmo do acesso de sistema. O que continua com o
 * harness é o que ele já fazia fora da sessão: os gates G0–G4, a verificação
 * independente, e o Git do Core, que confere as referências depois de cada
 * chamada (§101). Os papéis somente-leitura não mudam.
 */
function contrato(_platform: NodeJS.Platform): ContratoDoWorkspace {
  return {
    estado: "nao-verificado",
    motivo:
      "o executor claude roda com --dangerously-skip-permissions: tem acesso amplo ao sistema, à rede e aos " +
      "arquivos do usuário, sem sandbox (§108)",
  };
}

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  binaryEnv: "CAPIVARA_CLAUDE_BIN",
  defaultBinary: "claude",
  transcript: "claude-json",
  // `-p --output-format json`: um objeto só, no fim. Nada antes disso.
  streams: false,
  build: ({ model, effort, access, env, resumeSessionId }) => {
    const args = [
      "-p",
      "--output-format", "json",
      ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
      ...(access === "workspace"
        ? ["--dangerously-skip-permissions"]
        : ["--permission-mode", access === "read-only" ? "default" : "bypassPermissions"]),
    ];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    // O marcador de sessão faz a CLI se comportar como se estivesse aninhada em
    // outra; a chamada aqui é independente e precisa nascer limpa.
    const { CLAUDECODE: _ignorado, ...semMarcador } = env;
    return { args, env: semMarcador, ...(access === "workspace" ? { tmpPrivado: true } : {}) };
  },
  workspace: contrato,
  // `-r, --resume <session-id>` no --help da 2.1.303; as flags de permissão são desta invocação.
  retomada: {
    estado: "nao-verificado",
    elevacao: "por-invocacao",
    motivo: "`claude -p --resume <id>` existe na 2.1.303; não validado com chamada real que a sessão somente leitura volta com escrita",
  },
} as const satisfies CliAdapter;
