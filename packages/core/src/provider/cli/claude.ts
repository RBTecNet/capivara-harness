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

import type { CliAdapter } from "./types.js";

export const claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  binaryEnv: "CAPIVARA_CLAUDE_BIN",
  defaultBinary: "claude",
  transcript: "claude-json",
  // `-p --output-format json`: um objeto só, no fim. Nada antes disso.
  streams: false,
  build: ({ model, effort, access, env }) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--permission-mode", access === "read-only" ? "default" : access === "system" ? "bypassPermissions" : "acceptEdits",
    ];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    // O marcador de sessão faz a CLI se comportar como se estivesse aninhada em
    // outra; a chamada aqui é independente e precisa nascer limpa.
    const { CLAUDECODE: _ignorado, ...semMarcador } = env;
    return { args, env: semMarcador };
  },
} as const satisfies CliAdapter;
