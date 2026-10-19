/**
 * As paradas dos estágios documentais, no mesmo formato das do build.
 *
 * `init`, `plan`, `survey` e `change` param por exceção, e a mensagem que a
 * exceção carrega sempre foi boa — o que faltava era o mesmo cabeçalho de quatro
 * respostas que o build passou a dar. Uma parada que se lê diferente conforme o
 * estágio obriga quem está olhando a aprender cinco formatos, e foi assim que
 * "o auditor devolveu saída inválida duas vezes" virou uma pergunta para mim em
 * vez de uma instrução para quem estava no terminal.
 */

import type { Choice, NaturezaDaParada, Parada } from "../tui/index.js";
import type { Readiness } from "../init/index.js";

export type Estagio = "init" | "plan" | "survey" | "change";

const COMANDO: Record<Estagio, string> = {
  init: "capivara init",
  plan: "capivara plan",
  survey: "capivara survey",
  change: "capivara change",
};

/**
 * O que o estágio preserva quando pára.
 *
 * É a resposta ao medo real de quem vê o harness parar às duas da manhã: o
 * trabalho já feito continua lá, e repetir o comando não recomeça do zero.
 */
const PRESERVADO: Record<Estagio, string> = {
  init: "nada do que já foi publicado se perdeu; as respostas da entrevista são retomadas",
  plan: "o esqueleto e as fases guardadas em cache continuam disponíveis para a retomada",
  survey: "o que já foi levantado continua nos arquivos de saída",
  change: "o plano anterior não foi tocado; nenhuma fase fechada foi refeita",
};

/**
 * De quem é o defeito, lido da própria mensagem.
 *
 * As marcas são textos que o harness escreve — ler a mensagem do orquestrador é
 * frágil de propósito, e o teste quebra se alguém reescrever uma delas sem
 * reescrever isto.
 */
function natureza(mensagem: string): NaturezaDaParada {
  if (/atingiu o limite de tokens/i.test(mensagem)) return "modelo";
  if (/Decisão do desenvolvedor: abortar/i.test(mensagem)) return "decisão";
  if (/não há esqueleto publicado|não há o que levantar|rode `capivara/i.test(mensagem)) return "decisão";
  if (/não passa no parser|inalcançável/i.test(mensagem)) return "harness";
  if (/estourou o tempo|não respondeu|limite do harness|falhou antes de o modelo responder|O papel \w+ falhou com código \d+ em /i.test(mensagem)) return "ambiente";
  return "modelo";
}

const DE_QUEM_EXTRA: Partial<Record<NaturezaDaParada, string>> = {
  ambiente: "do provider ou da rede, ou da CLI que os chama: a chamada não produziu uma resposta do modelo",
  modelo: "da sessão do modelo: o texto que ele devolveu não serve",
};

/** Contagem não oferece uma decisão de produto como se pudesse mudar o teto. */
export function opcoesDoImpasse(mechanical: boolean): { choice: Choice; resposta: string | null }[] {
  return [
    ...(!mechanical ? [{ choice: { label: "escrever minha decisão", hint: "vira autoridade acima do auditor nos pontos do impasse" }, resposta: null }] : []),
    { choice: { label: mechanical ? "tentar corrigir novamente" : "reiniciar", hint: mechanical ? "o escritor tenta adequar a estrutura aos limites" : "o escritor tenta corrigir de novo e o auditor reconfere" }, resposta: "reiniciar" },
    { choice: { label: mechanical ? "publicar rascunho" : "publicar como está", ...(mechanical ? { hint: "os limites continuam obrigatórios no RALPH READY" } : {}) }, resposta: "publicar" },
    { choice: { label: "abortar" }, resposta: "abortar" },
  ];
}

export function paradaDoEstagio(erro: Error, estagio: Estagio, runId?: string): Parada {
  const linhas = erro.message.split("\n");
  const oQue = (linhas[0] ?? erro.message).trim();
  const detalhe = linhas.slice(1).join("\n").trim();
  const tipo = natureza(erro.message);
  const limiteDeGeracao = /atingiu o limite de tokens/i.test(erro.message);

  const seguir =
    limiteDeGeracao
      ? [
          "confira na evidência o teto solicitado e os tokens de saída e raciocínio informados pela API",
          "ajuste CAPIVARA_API_MAX_OUTPUT_TOKENS ou a intensidade de raciocínio desse papel conforme o modelo aceitar",
          `rode \`${COMANDO[estagio]}\` novamente — o cache é preservado`,
        ]
      : tipo === "decisão"
      ? [oQue]
      : tipo === "harness"
        ? [
            "isto é defeito nosso, não do seu projeto nem do modelo",
            `rode \`${COMANDO[estagio]}\` de novo; se repetir, é para abrir como defeito do harness`,
          ]
        : tipo === "ambiente"
          ? ["verifique o provider e a credencial do papel acima", `rode \`${COMANDO[estagio]}\` de novo — ele retoma`]
          : ["a mensagem abaixo mostra o que o modelo devolveu", `rode \`${COMANDO[estagio]}\` de novo; se repetir, troque o modelo desse papel`];

  return {
    natureza: tipo,
    oQue,
    ...(limiteDeGeracao
      ? { deQuem: "da chamada de geração: o orçamento de saída terminou antes da conclusão" }
      : DE_QUEM_EXTRA[tipo] ? { deQuem: DE_QUEM_EXTRA[tipo]! } : {}),
    custou: PRESERVADO[estagio],
    ...(runId ? { evidencia: [`.capivara/runs/${runId}`] } : {}),
    paraSeguir: seguir,
    ...(detalhe !== "" ? { detalhe } : {}),
  };
}

/**
 * O estágio que terminou sem estar pronto.
 *
 * Não houve exceção: os documentos estão publicados e um gate de prontidão
 * reprovou. É a parada mais silenciosa que existe hoje — o relatório de
 * prontidão sai, o processo devolve 2, e nada diz que o que falta é acionável.
 */
export function paradaDeProntidao(readiness: Readiness, estagio: Estagio, runId?: string): Parada {
  const faltando = readiness.checks.filter((check) => !check.passed);
  const primeiro = faltando[0];
  const dimensionamento = primeiro?.id === "dimensionamento";

  return {
    natureza: dimensionamento ? "modelo" : "decisão",
    oQue: primeiro ? `${primeiro.title}: ${primeiro.detail.split("\n")[0] ?? ""}`.trim() : "a prontidão não foi atingida",
    deQuem: dimensionamento ? DE_QUEM_EXTRA.modelo! : "de ninguém: os documentos estão publicados, e falta fechar o que está acima",
    custou: PRESERVADO[estagio],
    ...(runId ? { evidencia: [`.capivara/runs/${runId}`] } : {}),
    paraSeguir: [
      faltando.length > 1 ? `${faltando.length} verificação(ões) de prontidão ainda não passam` : "resolva o que está acima",
      `rode \`${COMANDO[estagio]}\` de novo — ele retoma do que já está publicado`,
    ],
    ...(faltando.length > 1
      ? { detalhe: faltando.map((check) => `${check.title}: ${check.detail.split("\n")[0] ?? ""}`).join("\n") }
      : {}),
  };
}
