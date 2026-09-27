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
import { slugDoProjeto } from "../mcp/index.js";

export const MAX_DOMINIOS = 8;

/** Extensões que contam como código para a conferência de cobertura. */
const CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|php|py|rb|go|rs|java|kt|cs|ex|exs|scala|swift|m|c|cc|cpp|h|hpp|vue|svelte|sql)$/i;

export interface SurveyCall {
  (request: { role: "writer"; stage: string; subject: string; attempt: number; prompt: string }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: string | null;
    /** A CLI emitiu um resultado legível? Ausente quando ela não tem envelope. */
    resultRead?: boolean;
    /** A CLI reportou a volta como erro. */
    engineError?: boolean;
  }>;
}

/** O que fazer quando a base já tem um projeto com aquele nome. */
export type DecisaoDeColisao = "atualizar" | "novo" | "local";

/**
 * A base, vista pelo levantamento.
 *
 * O levantamento não sabe o que é MCP: recebe três perguntas fechadas e um
 * envio. Isso mantém o protocolo na CLI e deixa a política — quando checar, o
 * que fazer na colisão, o que acontece quando ninguém responde — aqui, onde dá
 * para testá-la sem servidor nenhum.
 */
export interface SurveyBase {
  /** `true`, `false`, ou `null` quando a base não respondeu. */
  existe: (slug: string) => Promise<boolean | null>;
  enviar: (slug: string, markdown: string) => Promise<{ ok: boolean; mensagem: string }>;
  /** O slug que o operador apontou. Sem ele, o nome sai da aplicação levantada. */
  projeto?: string;
  /**
   * O que fazer quando já existe. Ausente significa não tocar na base: sem
   * ninguém para responder, sobrescrever o levantamento de outro projeto seria
   * decidir no lugar de quem não foi perguntado.
   */
  decidir?: (slug: string) => Promise<DecisaoDeColisao>;
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
  base?: SurveyBase;
}

export interface SurveyOutcome {
  survey: Survey;
  coverage: SurveyCoverage;
  markdown: string;
  /** Os arquivos escritos, em caminho absoluto. Sempre existem. */
  written: string[];
  /** O que aconteceu com a base, quando havia uma apontada. */
  destino?: { slug: string; enviado: boolean; mensagem: string };
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

    /*
     * O motor que falhou não respondeu mal: não respondeu. Pedir a ele que
     * "corrija o JSON" de uma mensagem de erro é gastar três chamadas e contar a
     * história errada — no cronus3, o codex nem chegou a rodar e o survey disse
     * três vezes que a resposta não era JSON. É o gate 0 do build, que aqui
     * faltava.
     */
    if (resposta.engineError === true || resposta.resultRead === false || resposta.exitCode !== 0) {
      const fim = (resposta.stdout.trim() || resposta.stderr.trim()).split("\n").slice(-12).join("\n");
      throw new SurveyBlockedError(
        `a chamada do levantamento de ${subject} falhou antes de o modelo responder` +
          (resposta.exitCode !== 0 ? ` (código ${resposta.exitCode})` : "") +
          `. É do ambiente ou da CLI, não do texto:\n${fim}`,
      );
    }

    const lido = parseSurvey(resposta.stdout, conhecidos ? { domains: conhecidos } : {});
    if (lido.ok) return lido.survey;

    defeitos = lido.defects.map((defeito) => `${defeito.problem} → ${defeito.hint}`);
    announce(`  ${subject}: ${defeitos.length} defeito(s) de forma; pedindo de novo com eles nomeados`);
  }

  throw new SurveyBlockedError(`o levantamento de ${subject} veio inválido ${tentativas} vezes: ${defeitos.join("; ")}`);
}

/**
 * Qual slug usar, e se a base pode receber.
 *
 * Chamado no primeiro instante em que o nome é conhecido — antes de gastar uma
 * sessão por domínio. Descobrir a colisão no fim, com o levantamento inteiro
 * pago, é descobrir tarde.
 */
async function resolverDestino(
  base: SurveyBase,
  nome: string,
  announce: (linha: string) => void,
): Promise<{ slug: string; podeEnviar: boolean }> {
  const slug = base.projeto?.trim() || slugDoProjeto(nome);
  if (slug === "") return { slug: "", podeEnviar: false };

  const existe = await base.existe(slug);

  if (existe === null) {
    // Silêncio não é ausência: criar por cima no primeiro soluço de rede seria
    // escrever em projeto alheio. O levantamento segue e fica em disco (§34).
    announce(`a base não respondeu; o levantamento fica só nos arquivos locais`);
    return { slug, podeEnviar: false };
  }

  if (!existe) return { slug, podeEnviar: true };

  announce(`a base já tem um projeto chamado "${slug}"`);
  if (!base.decidir) {
    announce("  sem ninguém para decidir, não vou mexer nele; o levantamento fica nos arquivos locais");
    return { slug, podeEnviar: false };
  }

  const decisao = await base.decidir(slug);
  if (decisao === "local") {
    announce("  o levantamento fica só nos arquivos locais");
    return { slug, podeEnviar: false };
  }
  if (decisao === "atualizar") {
    announce(`  o levantamento de "${slug}" será substituído; o pedido escrito lá é preservado`);
    return { slug, podeEnviar: true };
  }

  /*
   * Um nome livre ao lado do que existe. O sufixo é numérico e não uma data:
   * quem abre a base vê `locadora-2` e entende sem precisar de legenda.
   */
  for (let sufixo = 2; sufixo <= 50; sufixo += 1) {
    const candidato = `${slug}-${sufixo}`;
    if ((await base.existe(candidato)) === false) {
      announce(`  vai como "${candidato}", ao lado do que já existe`);
      return { slug: candidato, podeEnviar: true };
    }
  }

  announce("  não achei nome livre; o levantamento fica nos arquivos locais");
  return { slug, podeEnviar: false };
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
   * O destino é resolvido AQUI, e não no fim.
   *
   * É o primeiro instante em que o nome da aplicação existe — e é uma chamada de
   * modelo antes das N sessões de domínio. Perguntar "já existe um projeto com
   * esse nome, o que faço?" depois de pagar o levantamento inteiro seria
   * perguntar quando a resposta já não muda o custo.
   */
  const destino = options.base ? await resolverDestino(options.base, mapa.application, announce) : null;

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

  const written = [caminhoMarkdown, caminhoJson, caminhoCobertura];

  /*
   * A base recebe depois dos arquivos, sempre.
   *
   * O levantamento custou uma sessão por domínio e já está escrito; um servidor
   * que cai no último segundo não pode fazê-lo sumir. A base é conveniência, não
   * dependência (§34).
   */
  if (options.base && destino && destino.slug !== "") {
    if (!destino.podeEnviar) {
      return { survey, coverage, markdown, written, destino: { slug: destino.slug, enviado: false, mensagem: "não enviado" } };
    }

    const envio = await options.base.enviar(destino.slug, markdown);
    announce(envio.ok ? `base: ${envio.mensagem}` : `aviso: não consegui enviar à base (${envio.mensagem}); os arquivos locais estão escritos`);
    return { survey, coverage, markdown, written, destino: { slug: destino.slug, enviado: envio.ok, mensagem: envio.mensagem } };
  }

  return { survey, coverage, markdown, written };
}
