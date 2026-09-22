/**
 * O levantamento, de ponta a ponta.
 *
 * `init` parte de um pedido e chega a uma aplicação. Aqui a direção é a inversa:
 * a aplicação existe, ninguém escreveu o que ela faz, e o que se quer é esse
 * texto — para que uma reescrita, depois e à parte, possa partir dele.
 *
 * A forma é a mesma do `init`, pela mesma razão: nenhum modelo lê uma aplicação
 * inteira numa sessão. Uma chamada olha a árvore e decide quais são os domínios;
 * uma sessão por domínio lê o que é dele. O que sai é um documento com evidência
 * em cada afirmação e uma conferência mecânica do que ficou de fora.
 *
 * O que este comando NÃO faz, e não é esquecimento:
 *
 * - não escreve nada na aplicação levantada, não roda nada dela, não instala
 *   nada. Código legado costuma ser de outra pessoa e às vezes está em produção;
 *   o levantamento não pode ser a primeira coisa a derrubá-lo;
 * - não reescreve, não planeja e não decide o que fica de fora. Isso é o `init`
 *   que vem depois, com o levantamento como autoridade e o seu pedido por cima.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectProject, summarizeInventory } from "../init/inventory.js";
import {
  parseSurvey,
  renderSurvey,
  surveyCoverage,
  type Survey,
  type SurveyCoverage,
  type SurveyDomain,
} from "../contract/index.js";
import { surveyDomainPrompt, surveyMapPrompt } from "../prompts/index.js";

export const MAX_DOMINIOS = 8;

/** Extensões que contam como código para a conferência de cobertura. */
const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|php|py|rb|go|rs|java|kt|cs|ex|exs|scala|swift|m|c|cc|cpp|h|hpp|vue|svelte|sql)$/i;

export interface SurveyCall {
  (request: { role: "writer"; stage: string; subject: string; attempt: number; prompt: string }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: string | null;
  }>;
}

export interface SurveyOptions {
  /** A aplicação a levantar. Nunca é escrita. */
  projectRoot: string;
  /** Onde os arquivos do levantamento são gravados. Fora da aplicação, por padrão. */
  outputRoot: string;
  language: string;
  call: SurveyCall;
  announce?: (line: string) => void;
  maxDomains?: number;
}

export interface SurveyOutcome {
  survey: Survey;
  coverage: SurveyCoverage;
  markdown: string;
  /** Os arquivos escritos, em caminho absoluto. */
  written: string[];
}

export class SurveyBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SurveyBlockedError";
  }
}

/**
 * Junta o que cada domínio trouxe.
 *
 * A mesma tabela costuma aparecer em dois domínios — quem cadastra o cliente e
 * quem fatura leem `clientes`. Repetir a entidade faria a reescrita criar duas;
 * então a entidade é unificada pelo nome e os campos e as evidências se somam.
 * Regras e fluxos NÃO são unificados: cada um é de um domínio, e dois domínios
 * que decidem sobre a mesma coisa é exatamente o que se quer enxergar.
 */
function juntar(base: Survey, parte: Survey): Survey {
  const entities = [...base.entities];
  for (const nova of parte.entities) {
    const existente = entities.find((entity) => entity.name.toLowerCase() === nova.name.toLowerCase());
    if (!existente) {
      entities.push(nova);
      continue;
    }
    for (const field of nova.fields) {
      if (!existente.fields.some((outro) => outro.name === field.name)) existente.fields.push(field);
    }
    for (const relation of nova.relations) {
      if (!existente.relations.includes(relation)) existente.relations.push(relation);
    }
    existente.evidence.push(...nova.evidence);
    if (existente.storage === "") existente.storage = nova.storage;
  }

  const integrations = [...base.integrations];
  for (const nova of parte.integrations) {
    if (!integrations.some((outra) => outra.name.toLowerCase() === nova.name.toLowerCase())) integrations.push(nova);
  }

  return {
    ...base,
    entities,
    integrations,
    rules: [...base.rules, ...parte.rules],
    flows: [...base.flows, ...parte.flows],
    questions: [...base.questions, ...parte.questions],
  };
}

async function pedir(
  options: SurveyOptions,
  subject: string,
  monta: (defeitos: string[]) => string,
  /** Os domínios já mapeados, quando esta chamada é a leitura de um deles. */
  conhecidos?: readonly string[],
  tentativas = 3,
): Promise<Survey> {
  let defeitos: string[] = [];
  const announce = options.announce ?? ((): void => {});

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    const resposta = await options.call({ role: "writer", stage: "survey", subject, attempt: tentativa, prompt: monta(defeitos) });

    // Defeito de ambiente não vira defeito de conteúdo: o modelo não tem como
    // corrigir um timeout reescrevendo o JSON (§34.8).
    if (resposta.timedOut) throw new SurveyBlockedError(`a leitura de ${subject} foi encerrada por limite do harness (${resposta.timedOut})`);

    const lido = parseSurvey(resposta.stdout, conhecidos ? { domains: conhecidos } : {});
    if (lido.ok) return lido.survey;

    defeitos = lido.defects.map((defeito) => `${defeito.problem} → ${defeito.hint}`);
    announce(`  ${subject}: ${defeitos.length} defeito(s) de forma; pedindo de novo com eles nomeados`);
  }

  throw new SurveyBlockedError(`o levantamento de ${subject} veio inválido ${tentativas} vezes: ${defeitos.join("; ")}`);
}

export async function runSurvey(options: SurveyOptions): Promise<SurveyOutcome> {
  const announce = options.announce ?? ((): void => {});
  const maxDomains = options.maxDomains ?? MAX_DOMINIOS;

  const inventory = await inspectProject(options.projectRoot);
  if (inventory.empty) throw new SurveyBlockedError("não há o que levantar: o diretório está vazio");

  const arquivosDeCodigo = inventory.files.map((file) => file.path).filter((path) => CODIGO.test(path));
  announce(`inventário: ${inventory.files.length} arquivo(s), ${arquivosDeCodigo.length} de código${inventory.truncated ? " (truncado)" : ""}`);

  const mapa = await pedir(options, "mapa", (defeitos) =>
    surveyMapPrompt({
      language: options.language,
      inventory: summarizeInventory(inventory),
      maxDomains,
      ...(defeitos.length > 0 ? { defects: defeitos } : {}),
    }),
  );

  announce(`${mapa.domains.length} domínio(s): ${mapa.domains.map((domain) => domain.name).join(", ")}`);

  /*
   * O mapa manda nas três coisas que são dele — nome, stack e domínios — e em
   * mais nada: o que as sessões de domínio trouxerem sobre regra, fluxo ou
   * entidade é que vale, porque foi lido com o arquivo aberto.
   */
  let survey: Survey = { ...mapa, entities: [], rules: [], flows: [], integrations: [], questions: [] };

  const ids = mapa.domains.map((domain) => domain.id);

  for (const domain of mapa.domains) {
    announce(`  ${domain.id} — ${domain.name}: ${domain.files.length} arquivo(s)`);
    const parte = await pedir(options, domain.id, (defeitos) =>
      surveyDomainPrompt({
        language: options.language,
        application: mapa.application,
        domain: domain as SurveyDomain,
        others: mapa.domains.filter((outro) => outro.id !== domain.id).map((outro) => ({ id: outro.id, name: outro.name })),
        ...(defeitos.length > 0 ? { defects: defeitos } : {}),
      }),
      ids,
    );
    survey = juntar(survey, parte);
    announce(
      `    ${parte.rules.length} regra(s), ${parte.flows.length} fluxo(s), ${parte.entities.length} entidade(s)` +
        `${parte.questions.length > 0 ? `, ${parte.questions.length} pergunta(s) em aberto` : ""}`,
    );
  }

  const coverage = surveyCoverage(survey, arquivosDeCodigo);
  if (coverage.unclaimed.length > 0) {
    announce(`${coverage.unclaimed.length} arquivo(s) de código que nenhum domínio reivindicou; estão listados no documento`);
  }
  for (const id of coverage.domainsWithoutRules) announce(`  aviso: o domínio ${id} não trouxe regra nenhuma`);

  const markdown = renderSurvey(survey);
  await mkdir(options.outputRoot, { recursive: true });

  const caminhoMarkdown = join(options.outputRoot, "levantamento.md");
  const caminhoJson = join(options.outputRoot, "levantamento.json");
  const caminhoCobertura = join(options.outputRoot, "cobertura.json");

  await writeFile(caminhoMarkdown, markdown, "utf8");
  await writeFile(caminhoJson, `${JSON.stringify(survey, null, 2)}\n`, "utf8");
  await writeFile(caminhoCobertura, `${JSON.stringify(coverage, null, 2)}\n`, "utf8");

  return { survey, coverage, markdown, written: [caminhoMarkdown, caminhoJson, caminhoCobertura] };
}
