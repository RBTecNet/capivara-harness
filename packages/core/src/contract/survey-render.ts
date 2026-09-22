/**
 * O levantamento em markdown, e a conferência mecânica de cobertura.
 *
 * O documento é escrito para DOIS leitores, e a ordem das seções é essa escolha:
 * primeiro quem vai decidir o que reescrever — domínios, fluxos, regras —, e
 * depois quem vai implementar — entidades, contratos externos, armadilhas. A
 * camada de implementação vem por último porque, numa reescrita que troca de
 * stack, ela é a única parte que não é requisito.
 *
 * A cobertura é a parte que não depende de modelo nenhum. Ela não diz que o
 * levantamento está certo — ninguém consegue dizer isso por fora do código —,
 * diz o que ele não olhou. E "não olhou" é a diferença entre um documento que dá
 * para reescrever a partir dele e um que parece completo.
 */

import type { Survey, SurveyRule } from "./survey.js";

const TITULO: Record<string, string> = {
  dominio: "Regras de negócio",
  contrato: "Contratos externos — precisam sobreviver à troca de stack",
  implementacao: "Como esta stack faz hoje — informação, não requisito",
};

function regrasDaCamada(survey: Survey, layer: SurveyRule["layer"]): SurveyRule[] {
  return survey.rules.filter((rule) => rule.layer === layer);
}

function citacao(rule: { evidence: { file: string; locator: string }[] }): string {
  return rule.evidence.map((item) => `\`${item.file}${item.locator ? `:${item.locator}` : ""}\``).join(", ");
}

export function renderSurvey(survey: Survey): string {
  const linhas: string[] = [
    `# ${survey.application} — Levantamento`,
    "",
    "Escrito por leitura do código que existe hoje. Cada afirmação cita onde foi lida.",
    "O que o código não responde está em **Perguntas em aberto**, e não foi respondido por suposição.",
    "",
    "## Stack de hoje",
    ...(survey.stack.length > 0
      ? survey.stack.map((item) => `- ${item.component}: ${item.decision}`)
      : ["- (não identificada)"]),
    "",
    "Numa reescrita, esta seção é informação sobre a origem — nunca autoridade sobre o destino.",
    "",
    "## Domínios",
  ];

  for (const domain of survey.domains) {
    linhas.push(`### ${domain.id} — ${domain.name}`, "", domain.purpose, "");
    if (domain.files.length > 0) {
      linhas.push(`Arquivos: ${domain.files.map((file) => `\`${file}\``).join(", ")}`, "");
    }
  }

  linhas.push("## Fluxos");
  for (const flow of survey.flows) {
    linhas.push("", `### ${flow.id} — ${flow.name}`, "", `Ator: ${flow.actor || "não identificado"} · domínio: ${flow.domain}`, "");
    for (const [indice, passo] of flow.steps.entries()) linhas.push(`${indice + 1}. ${passo}`);
    if (flow.evidence.length > 0) linhas.push("", `Lido em: ${citacao(flow)}`);
  }
  linhas.push("");

  for (const layer of ["dominio", "contrato", "implementacao"] as const) {
    const regras = regrasDaCamada(survey, layer);
    if (regras.length === 0) continue;

    linhas.push(`## ${TITULO[layer]}`, "");
    for (const rule of regras) {
      linhas.push(`### ${rule.id}${rule.domain ? ` · ${rule.domain}` : ""}`, "", `**Faz hoje:** ${rule.behaviour}`);
      if (rule.intent !== "") linhas.push("", `**Intenção aparente:** ${rule.intent}`);
      /*
       * A divergência é declarada, nunca resolvida. Pode ser defeito a corrigir
       * ou a regra real do negócio que o comentário descreve errado — e só quem
       * conhece o negócio sabe qual das duas.
       */
      if (rule.divergence !== "") linhas.push("", `**Divergência:** ${rule.divergence}`);
      linhas.push("", `Lido em: ${citacao(rule)}`, "");
    }
  }

  linhas.push("## Entidades e onde os dados vivem", "");
  for (const entity of survey.entities) {
    linhas.push(`### ${entity.name}`, "", `Armazenamento: ${entity.storage || "não identificado"}`, "");
    for (const field of entity.fields) {
      linhas.push(`- ${field.name}: ${field.type}${field.notes ? ` — ${field.notes}` : ""}`);
    }
    for (const relation of entity.relations) linhas.push(`- relação: ${relation}`);
    if (entity.evidence.length > 0) linhas.push("", `Lido em: ${citacao(entity)}`);
    linhas.push("");
  }

  if (survey.integrations.length > 0) {
    linhas.push("## Integrações", "");
    for (const integration of survey.integrations) {
      linhas.push(`- **${integration.name}** (${integration.direction}): ${integration.contract} — ${citacao(integration)}`);
    }
    linhas.push("");
  }

  if (survey.deadCode.length > 0) {
    linhas.push(
      "## Candidatos a código morto",
      "",
      "Nenhum domínio reivindicou estes arquivos. Candidato não é veredito: confira antes de apagar.",
      "",
      ...survey.deadCode.map((item) => `- \`${item.path}\` — ${item.reason}`),
      "",
    );
  }

  if (survey.questions.length > 0) {
    linhas.push(
      "## Perguntas em aberto",
      "",
      "O código não responde. Responder por suposição seria inventar requisito.",
      "",
      ...survey.questions.map((item) => `- **${item.topic}:** ${item.question} _(${item.whyCodeCannotAnswer})_`),
      "",
    );
  }

  return `${linhas.join("\n")}\n`;
}

export interface SurveyCoverage {
  /** Arquivos de código que nenhum domínio reivindicou. */
  unclaimed: string[];
  /** Domínios sem uma única regra lida. */
  domainsWithoutRules: string[];
  /** Domínios sem fluxo: ninguém sabe o que o usuário faz ali. */
  domainsWithoutFlows: string[];
  /** Entidades citadas por regras que não foram levantadas. */
  claimed: number;
  total: number;
}

/**
 * O que o levantamento não olhou.
 *
 * Deliberadamente não é um gate que reprova: uma aplicação legada TEM código que
 * nenhum domínio reivindica, e chamar isso de defeito faria o levantamento
 * inventar domínio para calar a conferência. Ele informa, e quem lê decide — do
 * mesmo jeito que o inventário mecânico de testes nomeados informa o verificador.
 */
export function surveyCoverage(survey: Survey, codeFiles: readonly string[]): SurveyCoverage {
  const reivindicados = new Set(survey.domains.flatMap((domain) => domain.files));
  const mortos = new Set(survey.deadCode.map((item) => item.path));

  const unclaimed = codeFiles.filter((file) => !reivindicados.has(file) && !mortos.has(file));
  const comRegra = new Set(survey.rules.map((rule) => rule.domain));
  const comFluxo = new Set(survey.flows.map((flow) => flow.domain));

  return {
    unclaimed,
    domainsWithoutRules: survey.domains.filter((domain) => !comRegra.has(domain.id)).map((domain) => domain.id),
    domainsWithoutFlows: survey.domains.filter((domain) => !comFluxo.has(domain.id)).map((domain) => domain.id),
    claimed: codeFiles.length - unclaimed.length,
    total: codeFiles.length,
  };
}
