/**
 * As chaves que o harness lê nas respostas dos modelos.
 *
 * Todo papel responde por um protocolo de linhas — `CAPIVARA_AUDIT_STATUS:`,
 * `TASK 3: DONE`, `CAPIVARA_TRIAGEM:` — e todo parser desses protocolos nasceu
 * ancorado no início da linha. Isso está certo enquanto o modelo emitir uma
 * linha por registro, sem nada em volta; deixa de estar no primeiro que pensa
 * em voz alta antes de responder, cola a chave na frase anterior ou a escreve
 * em negrito, como item de lista ou em outra caixa.
 *
 * | o que o modelo escreveu | o que o harness entendia |
 * |---|---|
 * | `…afirma.CAPIVARA_AUDIT_STATUS: APPROVED` | saída inválida; run parado |
 * | `**TASK 1:** DONE` | task sem veredito |
 * | `<think>… TASK 1: INCOMPLETE …</think>TASK 1: DONE` | dois vereditos para a mesma task |
 *
 * A regra: **forma é responsabilidade de quem escreveu o parser, e conteúdo é
 * de quem respondeu** (§40). A embalagem é tolerada aqui, num lugar só, antes de
 * todo parser de protocolo; o conteúdo não é tocado. Uma resposta que continua
 * ilegível depois disto nunca vira aprovação: quem chama trata como leitura que
 * não aconteceu.
 */

/**
 * Põe cada ocorrência da chave no começo da própria linha.
 *
 * `chave` é a fonte de um regex sem grupos de captura — quem chama já sabe qual
 * é a sua chave, e passar o padrão evita esta função conhecer os protocolos.
 * Sensível à caixa de propósito: "task 1:" no meio da prosa de um achado é
 * conteúdo, e cortá-lo mudaria o que o modelo disse.
 */
export function desgrudarChaves(output: string, chave: string): string {
  return output.replace(new RegExp(`([^\\n])(?=${chave})`, "g"), "$1\n");
}

/**
 * Tira o raciocínio que o modelo escreveu antes da resposta.
 *
 * Os blocos `<think>…</think>` e `<thinking>…</thinking>` saem inteiros. Um
 * fechamento sem abertura — a abertura ficou no canal de raciocínio da CLI e só
 * o fim veio no texto — leva junto tudo o que vem antes dele.
 */
export function semRaciocinio(output: string): string {
  const semBlocos = output.replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
  let ultimo = -1;
  for (const encontrado of semBlocos.matchAll(/<\/(?:think|thinking)\s*>/giu)) ultimo = (encontrado.index ?? 0) + encontrado[0].length;
  return ultimo >= 0 ? semBlocos.slice(ultimo) : semBlocos;
}

/** A embalagem que pode cercar uma chave: negrito, itálico, crase. */
const ENFEITE = "[*_\\x60]*";

/**
 * A leitura tolerante de um protocolo de linhas.
 *
 * `chave` é a fonte de um regex sem grupos de captura que casa com o NOME da
 * chave, sem o `:` — `CAPIVARA_(?:AUDIT_STATUS|FINDING)`, `TASK\s+\d+`. Depois
 * do raciocínio retirado e das chaves desgrudadas da frase anterior, a linha que
 * começa pela chave, em qualquer caixa, perde a embalagem em volta dela —
 * marcador de lista ou de citação, número de item, negrito, itálico, crase — e
 * volta como `CHAVE: resto`, com a chave na caixa canônica (maiúscula). O
 * travessão curto (`–`) entre palavras vira o travessão (`—`) dos protocolos.
 * Linha sem a chave volta como veio: o conteúdo não é de quem lê.
 */
export function lerProtocolo(output: string, chave: string): string {
  const embrulhada = new RegExp(`^[\\s>*_\\x60•+-]*(?:\\d+[.)]\\s+)?${ENFEITE}(${chave})${ENFEITE}\\s*:${ENFEITE}`, "iu");
  return desgrudarChaves(semRaciocinio(output), `(?:${chave}):`)
    .split("\n")
    .map((linha) => {
      const casada = embrulhada.exec(linha);
      if (!casada) return linha;
      // Só o fecho duplo (negrito, sublinhado) sai do fim: uma crase final é conteúdo — `codigo`.
      const resto = linha.slice(casada[0].length).replace(/(?:\*\*|__)\s*$/u, "");
      return `${(casada[1] ?? "").toUpperCase()}:${resto}`.replace(/\s–\s/gu, " — ").trimEnd();
    })
    .join("\n");
}
