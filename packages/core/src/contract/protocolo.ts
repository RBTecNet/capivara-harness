/**
 * As chaves que o harness lê nas respostas dos modelos.
 *
 * Todo papel responde por um protocolo de linhas — `CAPIVARA_AUDIT_STATUS:`,
 * `CRITERION P1.T1.C1: OBSERVABLE`, `TASK 3: DONE` — e todo parser desses
 * protocolos nasceu ancorado no início da linha. Isso está certo enquanto o
 * modelo emitir uma linha por registro; deixa de estar no primeiro que escreve
 * a frase de abertura e a chave grudadas, sem `\n` no meio.
 *
 * Aconteceu três vezes, com três parsers diferentes, e uma delas matou um run:
 *
 * | onde | o que o modelo escreveu | o que o harness entendeu |
 * |---|---|---|
 * | auditoria | `…afirma.CAPIVARA_AUDIT_STATUS: APPROVED` | saída inválida; run parado |
 * | ensaio | `…observado.CRITERION P8.T7.C3 …: OBSERVABLE` | critério não ensaiado |
 * | verificação | `Vou conferir.TASK 1: DONE` | task sem veredito |
 *
 * A regra que sai daí: **forma é responsabilidade de quem escreveu o parser, e
 * conteúdo é de quem respondeu** (§40). Desgrudar a chave da frase anterior é
 * trabalho de leitura, e nenhum modelo devia perder um run por causa dele.
 */

/**
 * Põe cada ocorrência da chave no começo da própria linha.
 *
 * `chave` é a fonte de um regex sem grupos de captura — quem chama já sabe qual
 * é a sua chave, e passar o padrão evita esta função conhecer os protocolos.
 */
export function desgrudarChaves(output: string, chave: string): string {
  return output.replace(new RegExp(`([^\\n])(?=${chave})`, "g"), "$1\n");
}
