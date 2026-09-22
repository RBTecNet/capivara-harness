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
 * **E ela precisa ser dita onde o projeto está.** Esta CLI não trabalha no
 * diretório em que foi lançada: sem `--add-dir`, o terminal dela roda em
 * `~/.gemini/antigravity-cli/scratch`. Medido com um `pwd`, e é o tipo de
 * defeito que não aparece como erro — o comando "funciona", instala o pacote,
 * roda a suíte, e tudo acontece na pasta errada. O gate 1 então relata que a
 * sessão não escreveu nada, e a causa está a um diretório de distância.
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
  // Objeto único no fim.
  streams: false,
  build: ({ projectRoot, model, effort, access }) => {
    // Onde o projeto está. Sem isto, o terminal dela roda no scratch dela.
    const args = ["--output-format", "json", "--add-dir", projectRoot];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);

    if (access === "read-only") {
      /*
       * Quem garante o somente-leitura é o `--sandbox`, verificado: com ele, um
       * pedido explícito de criar arquivo devolve a resposta e não cria nada.
       *
       * O `--dangerously-skip-permissions` entra junto por um motivo oposto ao
       * que o nome sugere: sem ele, a primeira ferramenta que a CLI quisesse usar
       * seria negada — em modo headless não há a quem perguntar — e a volta
       * inteira voltaria vazia. Foi o que esvaziou duas fases do piloto 7.
       */
      args.push("--sandbox", "--dangerously-skip-permissions");
      return { args };
    }

    // Executor: edita sem perguntar, porque não há quem responda.
    args.push("--mode", "accept-edits", "--dangerously-skip-permissions");
    // `system` é o executor com permissão de instalar, e aí nem o sandbox entra.
    if (access === "workspace") args.push("--sandbox");
    return { args };
  },
} as const satisfies CliAdapter;
