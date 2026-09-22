/**
 * Cursor Agent.
 *
 * Três coisas foram descobertas chamando a CLI de verdade, e nenhuma delas se
 * deduz do nome da flag — que é o passo 1 de `docs/ADAPTADORES.md`, e a lição que
 * as integrações anteriores cobraram caro.
 *
 * **Confiança no diretório é obrigatória.** Sem `--trust`, a CLI para e pede para
 * ser rodada interativamente; em modo headless isso é uma sessão perdida sem
 * diagnóstico. Como a capivara só roda dentro do projeto que o operador apontou,
 * a confiança é a própria premissa da chamada.
 *
 * **Somente-leitura é `ask`, não `plan`.** A CLI oferece os dois: `plan` analisa
 * e PROPÕE planos; `ask` é Q&A e recusa editar. Verificado — em `ask`, um pedido
 * explícito de criar arquivo devolve "Estou em Ask mode, então não posso criar
 * arquivos" e não cria nada. O adaptador do Claude escolheu `plan` pelo nome e
 * uma fase inteira do piloto 6 voltou com a CLI explicando que não conseguiu
 * reabrir o próprio plano.
 *
 * **`-p` já concede tudo ao executor**: a ajuda diz, com todas as letras, "has
 * access to all tools, including write and shell". Não há permissão a declarar
 * além da confiança no diretório.
 */

import type { CliAdapter } from "./types.js";

export const cursorAdapter = {
  id: "cursor",
  label: "Cursor Agent",
  binaryEnv: "CAPIVARA_CURSOR_BIN",
  defaultBinary: "cursor-agent",
  transcript: "cursor-json",
  // Objeto único no fim.
  streams: false,
  build: ({ model, access }) => {
    const args = ["-p", "--output-format", "json", "--trust"];
    if (model) args.push("--model", model);
    // Sem `--effort`: esta CLI expõe a intensidade dentro do nome do modelo
    // (`gpt-5.3-codex-high`, `-xhigh`), e inventar a flag quebraria a chamada.
    if (access === "read-only") {
      args.push("--mode", "ask");
      return { args };
    }

    /*
     * `--force` é o que dá comando ao executor.
     *
     * `--trust` confia no diretório e `-p` promete "access to all tools,
     * including write and shell" — e as duas coisas juntas ainda param na
     * aprovação de cada comando, que o próprio `--help` descreve: "-f, --force:
     * Force allow commands unless explicitly denied (default: false)". Numa
     * chamada `-p` não há ninguém para aprovar, e aprovação pendente vira
     * negação.
     *
     * Foi o que travou a fase 1 do `MCP_teste2`: o executor precisava de um
     * `npm install` para a suíte rodar, relatou "o shell foi bloqueado", tentou
     * de novo "pedindo permissão", e no terceiro ciclo reescreveu o comando de
     * teste do PROJETO para não precisar da dependência. Escrever ele podia;
     * executar, não — e a diferença entre as duas é uma flag.
     */
    args.push("--force");

    /*
     * Acesso de sistema desliga o sandbox, como nas outras CLIs.
     *
     * `--force` libera o comando; o sandbox ainda pode recusar o que ele faz —
     * instalar pacote de sistema, alcançar a rede. Quem ligou o acesso de
     * sistema pediu justamente isso, e é o equivalente ao
     * `--sandbox danger-full-access` do codex.
     */
    if (access === "system") args.push("--sandbox", "disabled");
    return { args };
  },
} as const satisfies CliAdapter;
