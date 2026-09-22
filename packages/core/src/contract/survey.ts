/**
 * O levantamento de uma aplicação que já existe.
 *
 * O `init` parte de um pedido: alguém descreve o que quer e o harness documenta,
 * planeja e constrói. Aqui a direção é a inversa — a aplicação existe, ninguém
 * escreveu o que ela faz, e o que se quer é justamente esse texto, para que uma
 * reescrita possa partir dele.
 *
 * ## As três camadas, e por que elas existem
 *
 * A reescrita pode trocar de stack. Um levantamento que misture o que a
 * aplicação FAZ com o que ESTA stack faz produz um documento inútil para isso:
 * quem reescrever em outra linguagem herda o vocabulário da anterior e reproduz
 * a solução em vez do problema. Então todo achado nasce com uma camada:
 *
 * - **domínio** — sobrevive a qualquer reescrita. A regra do negócio, a entidade,
 *   o fluxo, o ator. Escrito sem vocabulário de framework: "o total desconta os
 *   dias em que a loja não abre", nunca "o accessor `getTotalAttribute` chama
 *   `diffInWeekdays`".
 * - **implementação** — morre junto com a stack. O ORM, o roteador, o template,
 *   a fila. Fica registrado como evidência e como aviso, nunca como requisito.
 * - **contrato externo** — precisa sobreviver MESMO trocando de stack, porque
 *   alguém de fora depende dele: o banco que vai ser migrado, a URL que já está
 *   em uso, o payload que um parceiro consome, o formato do arquivo exportado, o
 *   job que roda de madrugada. Esta é a camada que derruba reescrita, porque
 *   ninguém anota e ela só aparece quando o parceiro liga reclamando.
 *
 * ## Comportamento e intenção
 *
 * Cada regra registra o que o código FAZ hoje, com evidência. Quando a intenção
 * aparente diverge do comportamento — arredondamento que não bate com o texto da
 * tela, validação que o formulário promete e o servidor não faz —, a divergência
 * é declarada em vez de resolvida. Resolver é decisão de quem reescreve: pode
 * ser um defeito a corrigir ou a regra real do negócio que o comentário descreve
 * errado, e só quem conhece o negócio sabe qual.
 *
 * ## Evidência
 *
 * Afirmação sem evidência não é requisito: é palpite de modelo sobre código que
 * ele leu por cima. Toda regra, entidade, fluxo e integração cita arquivo e
 * símbolo, e o que o levantamento não conseguiu sustentar vira pergunta.
 */

export const SURVEY_CONTRACT = "capivara-survey/v1" as const;

/** A que camada um achado pertence. Fechada dos dois lados. */
export const CAMADAS = ["dominio", "implementacao", "contrato"] as const;
export type Camada = (typeof CAMADAS)[number];

export interface Evidencia {
  /** Caminho relativo à raiz da aplicação levantada. */
  file: string;
  /** Símbolo, rota, tabela ou trecho que sustenta a afirmação. */
  locator: string;
}

export interface SurveyDomain {
  /** `D-01`, `D-02`… */
  id: string;
  name: string;
  /** O que este domínio resolve, em uma frase, sem vocabulário de framework. */
  purpose: string;
  /** Os arquivos que pertencem a ele. É o que a cobertura confere. */
  files: string[];
}

export interface SurveyField {
  name: string;
  type: string;
  /** Restrição, default ou armadilha observada. */
  notes: string;
}

export interface SurveyEntity {
  name: string;
  /** Onde os dados vivem hoje: tabela, coleção, arquivo. Camada de contrato. */
  storage: string;
  fields: SurveyField[];
  relations: string[];
  evidence: Evidencia[];
}

export interface SurveyRule {
  /** `R-01`, `R-02`… */
  id: string;
  /** O id do domínio a que pertence. */
  domain: string;
  layer: Camada;
  /** O que o código FAZ hoje. */
  behaviour: string;
  /** A intenção aparente, quando o código sugere uma. */
  intent: string;
  /** Preenchido só quando comportamento e intenção divergem. */
  divergence: string;
  evidence: Evidencia[];
}

export interface SurveyFlow {
  /** `F-01`, `F-02`… */
  id: string;
  domain: string;
  name: string;
  /** Quem percorre: o operador, o cliente, um job. */
  actor: string;
  steps: string[];
  evidence: Evidencia[];
}

export interface SurveyIntegration {
  name: string;
  /** O sistema chama, é chamado, ou os dois. */
  direction: "entrada" | "saida" | "ambas";
  /** O que trafega, no nível em que outro sistema depende disso. */
  contract: string;
  evidence: Evidencia[];
}

/** O que o código não responde. Vai para a entrevista, não para o documento. */
export interface SurveyQuestion {
  topic: string;
  question: string;
  /** Por que a leitura não resolve isto. */
  whyCodeCannotAnswer: string;
}

/** Arquivo que nenhum domínio reivindicou e nada parece alcançar. */
export interface SurveyDeadCode {
  path: string;
  reason: string;
}

export interface Survey {
  contract: typeof SURVEY_CONTRACT;
  application: string;
  /** A stack de HOJE. Na reescrita ela é informação, não autoridade. */
  stack: { component: string; decision: string }[];
  domains: SurveyDomain[];
  entities: SurveyEntity[];
  rules: SurveyRule[];
  flows: SurveyFlow[];
  integrations: SurveyIntegration[];
  questions: SurveyQuestion[];
  deadCode: SurveyDeadCode[];
}

export interface SurveyDefect {
  problem: string;
  hint: string;
}

export type SurveyResult = { ok: true; survey: Survey } | { ok: false; defects: SurveyDefect[] };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter((item) => item !== "") : [];
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map((item) => (item ?? {}) as Record<string, unknown>) : [];
}

function stripFence(source: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(source);
  return (fenced?.[1] ?? source).trim();
}

/** O sistema chama, é chamado, ou os dois. Fora da lista, "saida" é o caso comum. */
function direcao(value: unknown): SurveyIntegration["direction"] {
  const lido = text(value).toLowerCase();
  return lido === "entrada" ? "entrada" : lido === "ambas" ? "ambas" : "saida";
}

function camada(value: unknown): Camada {
  const lido = text(value).toLowerCase();
  return (CAMADAS as readonly string[]).includes(lido) ? (lido as Camada) : "dominio";
}

function evidencias(value: unknown): Evidencia[] {
  return list(value)
    .map((item) => ({ file: text(item.file), locator: text(item.locator) }))
    .filter((item) => item.file !== "");
}

/**
 * Lê o levantamento, nunca lança, e recusa o que não serviria para reescrever.
 *
 * As recusas são poucas e todas do mesmo tipo: afirmação sem evidência e achado
 * órfão. Um levantamento com menos regras do que a aplicação tem é incompleto e
 * a cobertura dirá isso; um levantamento com regras inventadas é pior, porque
 * parece completo.
 */
export interface SurveyParseOptions {
  /**
   * Os domínios já conhecidos, quando esta resposta é a leitura de UM deles.
   *
   * A sessão de domínio devolve regras e fluxos e nenhum domínio — o mapa é de
   * quem mapeou. Exigir a lista dela seria pedir que repetisse o que já lhe foi
   * dado, e aceitar qualquer id seria perder a única checagem que liga achado a
   * domínio.
   */
  domains?: readonly string[];
}

export function parseSurvey(source: string, options: SurveyParseOptions = {}): SurveyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(source));
  } catch {
    return {
      ok: false,
      defects: [{ problem: "a resposta não é JSON válido", hint: `devolva um objeto { "contract": "${SURVEY_CONTRACT}", … } sem cerca de código` }],
    };
  }

  const root = (parsed ?? {}) as Record<string, unknown>;
  if (root.contract !== SURVEY_CONTRACT) {
    return { ok: false, defects: [{ problem: `contrato ausente ou diferente de ${SURVEY_CONTRACT}`, hint: `declare "contract": "${SURVEY_CONTRACT}" na raiz` }] };
  }

  const defects: SurveyDefect[] = [];

  const domains: SurveyDomain[] = list(root.domains)
    .map((item) => ({ id: text(item.id), name: text(item.name), purpose: text(item.purpose), files: strings(item.files) }))
    .filter((item) => item.id !== "" && item.name !== "");

  const parcial = options.domains !== undefined;
  const conhecidos = new Set(parcial ? options.domains : domains.map((domain) => domain.id));

  const entities: SurveyEntity[] = list(root.entities)
    .map((item) => ({
      name: text(item.name),
      storage: text(item.storage),
      fields: list(item.fields)
        .map((field) => ({ name: text(field.name), type: text(field.type), notes: text(field.notes) }))
        .filter((field) => field.name !== ""),
      relations: strings(item.relations),
      evidence: evidencias(item.evidence),
    }))
    .filter((item) => item.name !== "");

  const rules: SurveyRule[] = list(root.rules)
    .map((item) => ({
      id: text(item.id),
      domain: text(item.domain),
      layer: camada(item.layer),
      behaviour: text(item.behaviour),
      intent: text(item.intent),
      divergence: text(item.divergence),
      evidence: evidencias(item.evidence),
    }))
    .filter((item) => item.behaviour !== "");

  const flows: SurveyFlow[] = list(root.flows)
    .map((item) => ({
      id: text(item.id),
      domain: text(item.domain),
      name: text(item.name),
      actor: text(item.actor),
      steps: strings(item.steps),
      evidence: evidencias(item.evidence),
    }))
    .filter((item) => item.name !== "");

  const integrations: SurveyIntegration[] = list(root.integrations)
    .map((item) => ({
      name: text(item.name),
      direction: direcao(item.direction),
      contract: text(item.contract),
      evidence: evidencias(item.evidence),
    }))
    .filter((item) => item.name !== "");

  const questions: SurveyQuestion[] = list(root.questions)
    .map((item) => ({ topic: text(item.topic), question: text(item.question), whyCodeCannotAnswer: text(item.whyCodeCannotAnswer) }))
    .filter((item) => item.question !== "");

  const deadCode: SurveyDeadCode[] = list(root.deadCode)
    .map((item) => ({ path: text(item.path), reason: text(item.reason) }))
    .filter((item) => item.path !== "");

  if (!parcial && domains.length === 0) {
    defects.push({ problem: "nenhum domínio", hint: "toda aplicação tem pelo menos um; sem domínio não há onde pendurar regra nenhuma" });
  }

  /*
   * Evidência não é formalidade. Sem ela, o levantamento vira o que um modelo
   * supôs sobre um código que leu por cima — e a reescrita parte de uma regra
   * que nunca existiu, sem ninguém ter como conferir.
   */
  for (const rule of rules) {
    if (rule.evidence.length === 0) {
      defects.push({ problem: `a regra ${rule.id || rule.behaviour.slice(0, 40)} não cita evidência`, hint: "toda regra cita arquivo e símbolo; o que você não achou no código vira pergunta, não regra" });
    }
    if (rule.domain !== "" && !conhecidos.has(rule.domain)) {
      defects.push({ problem: `a regra ${rule.id} aponta para o domínio ${rule.domain}, que não existe`, hint: "use o id de um domínio declarado em `domains`" });
    }
  }

  for (const flow of flows) {
    if (flow.steps.length === 0) {
      defects.push({ problem: `o fluxo ${flow.id || flow.name} não tem passos`, hint: "um fluxo sem passos não diz o que o usuário faz" });
    }
    if (flow.domain !== "" && !conhecidos.has(flow.domain)) {
      defects.push({ problem: `o fluxo ${flow.id} aponta para o domínio ${flow.domain}, que não existe`, hint: "use o id de um domínio declarado em `domains`" });
    }
  }

  for (const entity of entities) {
    if (entity.fields.length === 0) {
      defects.push({ problem: `a entidade ${entity.name} não tem campo nenhum`, hint: "uma entidade sem campos não dá para recriar; leia o schema ou a migration" });
    }
  }

  const survey: Survey = {
    contract: SURVEY_CONTRACT,
    application: text(root.application) || "Aplicação",
    stack: list(root.stack)
      .map((item) => ({ component: text(item.component), decision: text(item.decision) }))
      .filter((item) => item.component !== ""),
    domains,
    entities,
    rules,
    flows,
    integrations,
    questions,
    deadCode,
  };

  return defects.length > 0 ? { ok: false, defects } : { ok: true, survey };
}
