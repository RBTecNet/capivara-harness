/**
 * O plano não devolve por teste (§129).
 *
 * No Parallel Lab com a 0.7.2 a rodada 2 teve nove achados e seis eram de
 * teste: três tasks de teste a tirar — com a correção "registre o requisito
 * como critério de uma task de produto" —, e a fase 3 reprovada duas vezes por
 * NÃO trazer "o módulo tem testes automatizados próprios". A triagem manteve os
 * seis. O desenvolvedor decidiu: o que o pedido diz sobre testes é executado
 * pelo build, e nenhuma leitura do plan pede teste, pergunta sobre teste ou
 * reprova pela falta dele.
 *
 * O texto que a auditoria leu já passou pela I-16, que conta o teste dentro do
 * plano antes de qualquer modelo. Do que o auditor devolve:
 * - o achado SOBRE teste que manda tirar o teste que está no texto — a prosa
 *   que a I-16 não conta — cumpre a regra e fica, com as palavras do auditor
 *   menos o que elas pedem de teste no lugar;
 * - o que pede teste, ou reprova pela falta dele, sai inteiro;
 * - o achado de outro assunto cuja correção sugere um teste fica, sem o teste;
 * - a ressalva sobre teste sai: a ressalva de hoje é o "achados anteriores" do
 *   prompt de amanhã;
 * - a decisão que pede teste sai; a que aponta prescrição de teste no texto
 *   (uma ferramenta, um arquivo) segue o caminho que já existia, e vira o
 *   achado mecânico de remoção (`perguntarDecisoesDoAuditor`).
 * Quando não sobra achado, a devolução não tem motivo: aprovada.
 */

import { testPrescriptions, testRequirements, testToolPrescriptions } from "../contract/index.js";
import type { TestAuthority } from "../contract/index.js";
import type { AuditVerdict, Finding } from "./protocol.js";

/** A correção que tira: "Remova a sub-fase", "Na task 2, remova o critério 3", "Reescreva o critério sem a cláusula". */
const TIRAR = /(?<![\p{L}\p{N}_])(?:remova|remover|retire|retirar|tire|tirar|apague|apagar|elimine|eliminar|exclua|excluir|corte|cortar|delete|remove|drop|strip|take\s+out)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:reescreva|substitua|rewrite|replace)(?![\p{L}\p{N}_])[^.;]*?(?<![\p{L}\p{N}_])(?:sem|without)(?![\p{L}\p{N}_])/iu;
/** A oração que leva o requisito de teste para outro lugar do plano: "registre o requisito como critério da task 8". */
const MOVER_O_REQUISITO = /(?<![\p{L}\p{N}_])(?:registre|mantenha|mova|leve|carregue|acrescente|adicione|inclua|escreva|coloque|ponha|vai|fica|record|keep|move|add|include|put|write)(?![\p{L}\p{N}_])[^.;]*?(?<![\p{L}\p{N}_])(?:requisito|requirement)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:requisito|requirement)(?![\p{L}\p{N}_])[^.;]*?(?<![\p{L}\p{N}_])(?:vai|fica|entra|segue|passa|goes|stays|becomes)(?![\p{L}\p{N}_])[^.;]*?(?<![\p{L}\p{N}_])(?:crit[eé]rio|criterion)(?![\p{L}\p{N}_])/iu;
/** A oração que começa outro pedido dentro da mesma frase: "Remova a task e registre o requisito como critério". */
const OUTRA_ORACAO = /,?\s+(?:e|and)\s+(?=(?:registre|mantenha|acrescente|adicione|inclua|escreva|crie|mova|leve|carregue|deixe|record|keep|add|include|write|move)(?![\p{L}\p{N}_]))/iu;

/** O que se diz ao escritor depois da correção que tirava o teste e pedia outro no lugar. */
export const NADA_DE_TESTE_NO_LUGAR =
  "Não escreva nada sobre testes no lugar, nem em outro ponto do plano: o que o pedido diz sobre testes é executado pelo build.";
/** A correção do achado de produto que só sugeria um teste para resolvê-lo. */
export const CORRECAO_SEM_TESTE =
  "corrija o que o achado aponta no comportamento do produto, no texto da fase, sem acrescentar nada sobre testes:" +
  " o que o pedido diz sobre testes é executado pelo build, e o plano não o carrega";

/** O texto fala do teste do próprio produto? A mesma conta da I-16, nada além dela. */
export function falaDeTeste(texto: string, autoridade: TestAuthority = []): boolean {
  return testPrescriptions(texto, autoridade).length > 0;
}

/**
 * A correção do auditor sem o que ela pede de teste.
 *
 * Fica cada oração que tira, e cada uma que não fala de teste; sai a que pede
 * teste. Quando o achado é SOBRE teste (`doTeste`), sai também a oração que
 * leva "o requisito" para um critério de outra task, fale ela de teste ou não,
 * e a regra vai sempre no fim. O escritor recebe as palavras do auditor, não
 * uma fórmula: o roteamento ao envelope e a emenda dependem delas. Nada
 * sobrando, `null`.
 */
export function semPedidoNaCorrecao(fix: string, autoridade: TestAuthority = [], doTeste = false): string | null {
  const oracoes = fix.split(/(?<=[.!?;])\s+/u).flatMap((frase) => frase.split(OUTRA_ORACAO)).map((oracao) => oracao.trim()).filter((oracao) => oracao !== "");
  const ficam = oracoes.filter((oracao) => {
    if (doTeste && MOVER_O_REQUISITO.test(oracao) && !TIRAR.test(oracao)) return false;
    return TIRAR.test(oracao) || !falaDeTeste(oracao, autoridade);
  });
  if (ficam.length === 0) return null;
  if (!doTeste && ficam.length === oracoes.length && !falaDeTeste(fix, autoridade)) return fix;
  return `${ficam.map((oracao) => oracao.replace(/[\s.;,]+$/u, "")).join(". ")}. ${NADA_DE_TESTE_NO_LUGAR}`;
}

export interface SemPedidoDeTeste {
  verdict: AuditVerdict;
  /** Onde estavam os apontamentos que saíram: achados e decisões. */
  descartados: string[];
  /** Quantos achados ficaram com a correção sem o teste. */
  corrigidos: number;
}

export function tirarPedidoDeTeste(verdict: AuditVerdict, autoridade: TestAuthority = []): SemPedidoDeTeste {
  const descartados: string[] = [];
  let corrigidos = 0;
  const findings: Finding[] = [];
  for (const finding of verdict.findings) {
    if (finding.mechanical === true) {
      findings.push(finding);
      continue;
    }
    if (falaDeTeste(`${finding.where}\n${finding.problem}`, autoridade)) {
      const tira = TIRAR.test(finding.fix) ? semPedidoNaCorrecao(finding.fix, autoridade, true) : null;
      if (tira === null) {
        descartados.push(finding.where);
        continue;
      }
      corrigidos += 1;
      findings.push({ ...finding, fix: tira });
      continue;
    }
    if (falaDeTeste(finding.fix, autoridade)) {
      corrigidos += 1;
      findings.push({ ...finding, fix: semPedidoNaCorrecao(finding.fix, autoridade) ?? CORRECAO_SEM_TESTE });
      continue;
    }
    findings.push(finding);
  }
  const remarks = verdict.remarks.filter((remark) => !falaDeTeste(`${remark.where}\n${remark.observation}`, autoridade));
  // Sai a decisão que pede teste (só o requisito); a que aponta ferramenta ou arquivo de teste fica para virar remoção.
  const decisions = verdict.decisions?.filter((decisao) => {
    const texto = [decisao.where, decisao.decision, ...decisao.options].join("\n");
    const pede = testRequirements(texto).length > 0 && testToolPrescriptions(texto, autoridade).length === 0;
    if (pede) descartados.push(decisao.where);
    return !pede;
  });
  if (descartados.length === 0 && corrigidos === 0 && remarks.length === verdict.remarks.length) return { verdict, descartados, corrigidos };
  const status = verdict.status === "REJECTED" && findings.length === 0 ? "APPROVED" : verdict.status;
  return {
    verdict: {
      ...verdict,
      status,
      findings,
      remarks,
      ...(decisions !== undefined ? { decisions } : {}),
      ...(status !== verdict.status ? { reason: `${verdict.reason} — o que restava eram apontamentos sobre teste, que são do build (§129)` } : {}),
    },
    descartados,
    corrigidos,
  };
}
