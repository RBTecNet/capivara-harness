/**
 * Antigravity CLI — o caminho para os modelos do Google.
 *
 * Duas decisões aqui vieram de defeito pago em run real, e nenhuma é óbvia pelo
 * nome da flag.
 *
 * **`--mode plan` NÃO é somente-leitura.** É o modo em que a CLI planeja antes de
 * agir e grava o plano num arquivo, e o papel depois tenta relê-lo. O adaptador
 * do Claude usava `plan` para os papéis de leitura, e uma fase inteira do piloto
 * 6 veio com a explicação da CLI de que não conseguiu abrir o próprio arquivo de
 * plano no lugar das tasks. Aqui `plan` não aparece: quem só lê roda sem
 * `--dangerously-skip-permissions`, e em print mode, sem ninguém para aprovar,
 * toda ferramenta que exigiria permissão é negada. Somente-leitura de fato.
 *
 * **Quem executa precisa da permissão dita por extenso.** O adaptador do opencode
 * não declarava nada para o executor e herdava o default da CLI, que nega
 * diretório externo — e npm, Vite e tsc usam `/tmp` e `~/.npm` o tempo todo. A
 * sessão morria na primeira linha, com "auto-rejecting", e o gate relatava "a
 * sessão não escreveu nada": verdade que escondia a causa inteira.
 *
 * O prompt vai por stdin. O `-p` desta CLI espera o texto como valor do próprio
 * flag (`-p='...'`), e passá-lo vazio faz ela tomar o argumento seguinte como
 * prompt — foi o primeiro erro ao integrá-la.
 */

import type { CliAdapter } from "./types.js";

export const agyAdapter = {
  id: "agy",
  label: "Antigravity CLI",
  binaryEnv: "CAPIVARA_AGY_BIN",
  defaultBinary: "agy",
  transcript: "agy-json",
  build: ({ model, effort, access }) => {
    const args = ["--output-format", "json"];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    if (access === "read-only") {
      // Sem auto-aprovação e com o terminal restrito: ler e nada mais.
      args.push("--sandbox");
      return { args };
    }

    // Executor: edita sem perguntar, porque não há quem responda.
    args.push("--mode", "accept-edits", "--dangerously-skip-permissions");
    // `system` é o executor com permissão de instalar, e aí nem o sandbox entra.
    if (access === "workspace") args.push("--sandbox");
    return { args };
  },
} as const satisfies CliAdapter;
