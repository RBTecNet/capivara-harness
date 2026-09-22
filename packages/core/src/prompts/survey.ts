/**
 * Prompts do levantamento de uma aplicação existente.
 *
 * Duas chamadas de naturezas diferentes, pela mesma razão que separam o esqueleto
 * das fases: nenhum modelo lê uma aplicação inteira numa sessão. A primeira olha
 * a árvore e decide QUAIS são os domínios; as seguintes leem um domínio de cada
 * vez e devolvem o que encontraram, com a evidência na mão.
 *
 * O papel é somente-leitura em todos os sentidos: ele não escreve no código
 * levantado, não roda nada, não instala nada. Uma aplicação legada costuma ser de
 * outra pessoa, às vezes em produção, e o levantamento não pode ser a primeira
 * coisa a quebrá-la.
 */

import { languageBlock } from "./language.js";
import { CAMADAS, SURVEY_CONTRACT } from "../contract/survey.js";

export const SURVEY_HEADER = "CAPIVARA_SURVEY";

const LEITURA = [
  "You are surveying an application that ALREADY EXISTS, so that someone can rewrite it later.",
  "You are not rewriting anything now.",
  "",
  "You are strictly read-only. You never write, edit, create, delete, move or commit any file in",
  "the application. You never install anything, never run its build, its tests or the application",
  "itself. This code may be in production and it is not yours: reading it is all you do.",
  "",
  "## What makes a survey worth anything",
  "",
  "Every statement you make cites where you read it: the file, and the symbol, route, table or",
  "line inside it. A statement you cannot cite is not a finding — it is a guess about code you",
  "skimmed, and it is worse than a gap, because a gap is visible and a guess is not. What you",
  "could not establish by reading goes in `questions`, never into a rule.",
].join("\n");

const CAMADAS_BLOCO = [
  "## The three layers, and why the rewrite depends on them",
  "",
  "The rewrite may use a completely different stack. A survey that mixes what the application",
  "DOES with what THIS stack does is useless for that: whoever rewrites it inherits the old",
  "vocabulary and reproduces the solution instead of the problem. So every rule declares a layer:",
  "",
  '- `dominio` — survives any rewrite. The business rule, written WITHOUT framework vocabulary.',
  '  Write "the total skips days the shop is closed", never "the `getTotalAttribute` accessor',
  '  calls `diffInWeekdays`". If you cannot state the rule without naming a library, you have not',
  "  understood it yet — read further or make it a question.",
  '- `implementacao` — dies with the stack. The ORM, the router, the template engine, the queue.',
  "  Record it as information for whoever reads the old code, never as a requirement.",
  '- `contrato` — must survive EVEN IF the stack changes, because something outside depends on it:',
  "  the database that will be migrated, a URL already in use, the payload a partner consumes, the",
  "  layout of an exported file, a scheduled job other systems wait for, an authentication token",
  "  format. This is the layer that kills rewrites, because nobody writes it down and it only",
  "  surfaces when the partner calls to complain. When in doubt between `dominio` and `contrato`,",
  "  ask yourself: would someone OUTSIDE this codebase notice if we changed it? If yes, `contrato`.",
  "",
  "## What it does, and what it meant to do",
  "",
  "Each rule records the BEHAVIOUR: what the code does today, as it is written. When the apparent",
  "intent differs — a comment, a variable name, a screen label or a validation that promises",
  "something the code does not do — you record the intent too, and declare the divergence.",
  "",
  "You never resolve a divergence. It may be a defect to fix, or it may be the real business rule",
  "that the comment describes badly, and only someone who knows the business can tell. Declaring it",
  "is the whole value: it is the list of decisions the rewrite has to make on purpose.",
].join("\n");

export interface SurveyMapContext {
  language: string;
  /** O inventário mecânico: árvore, manifestos, tamanhos. */
  inventory: string;
  /** Quantos domínios cabem. O teto existe para não fatiar a aplicação em pó. */
  maxDomains: number;
  /** O que a tentativa anterior trouxe de errado. */
  defects?: string[];
}

/**
 * A primeira chamada: quais são os domínios.
 *
 * Ela não lê regra nenhuma. Lê a árvore, os manifestos e o suficiente dos pontos
 * de entrada para saber onde as coisas moram — e devolve um mapa que as chamadas
 * seguintes usam para se dividir. Misturar as duas coisas faria a sessão gastar o
 * contexto inteiro no primeiro domínio que abrisse.
 */
export function surveyMapPrompt(context: SurveyMapContext): string {
  return [
    languageBlock(context.language),
    "",
    SURVEY_HEADER,
    "",
    LEITURA,
    "",
    "## Your task now: the map, not the contents",
    "",
    "Read the tree, the manifests and whatever entry points you need — routes, controllers, CLI",
    "commands, migrations, scheduled jobs — and decide what the DOMAINS of this application are.",
    "Do not read business logic yet; another session will read each domain in depth.",
    "",
    "A domain is a part of the business, not a folder and not a layer. `clients`, `rentals`,",
    "`billing` are domains. `controllers`, `models`, `utils` are not: they are how this stack",
    "organises files, and a rewrite in another stack will not have them.",
    "",
    `At most ${context.maxDomains} domains. Prefer fewer and larger: a domain that is read in one`,
    "session gives a coherent picture, and ten tiny domains produce ten partial ones.",
    "",
    "Assign every code file you can see to exactly one domain. A file you cannot place — a helper",
    "nobody seems to call, a leftover script — goes in `deadCode` with the reason. The harness",
    "checks this mechanically and will tell you what you left out, so leaving it out silently",
    "gains you nothing.",
    "",
    "Return only JSON:",
    '{ "contract": "' + SURVEY_CONTRACT + '",',
    '  "application": "<the name of the application>",',
    '  "stack": [ { "component": "language", "decision": "PHP 7.4" } ],',
    '  "domains": [ { "id": "D-01", "name": "...", "purpose": "one sentence, no framework words",',
    '                 "files": ["path/one.php", "path/two.php"] } ],',
    '  "deadCode": [ { "path": "...", "reason": "why nothing seems to reach it" } ],',
    '  "entities": [], "rules": [], "flows": [], "integrations": [], "questions": [] }',
    "",
    "`entities`, `rules`, `flows`, `integrations` and `questions` stay EMPTY here. They belong to",
    "the per-domain sessions.",
    ...(context.defects && context.defects.length > 0
      ? ["", "## Your previous answer was rejected", "", ...context.defects.map((defect) => `- ${defect}`), "", "Return the whole map again."]
      : []),
    "",
    "## The inventory",
    context.inventory,
  ].join("\n");
}

export interface SurveyDomainContext {
  language: string;
  application: string;
  /** O domínio desta sessão. */
  domain: { id: string; name: string; purpose: string; files: string[] };
  /** Os outros domínios, só por nome: o que é deles não é desta sessão. */
  others: { id: string; name: string }[];
  defects?: string[];
}

/**
 * A segunda chamada, uma por domínio: o que aquele domínio faz.
 *
 * Ela recebe a lista de arquivos do domínio e a de nomes dos outros. Os outros
 * entram para que a sessão saiba onde PARAR — sem isso, cada uma lê a aplicação
 * inteira de novo e as regras voltam repetidas, cada vez com uma redação
 * diferente, e ninguém consegue dizer se são a mesma.
 */
export function surveyDomainPrompt(context: SurveyDomainContext): string {
  const { domain } = context;

  return [
    languageBlock(context.language),
    "",
    SURVEY_HEADER,
    "",
    LEITURA,
    "",
    CAMADAS_BLOCO,
    "",
    `## Your domain: ${domain.id} — ${domain.name}`,
    "",
    domain.purpose,
    "",
    "Files assigned to this domain:",
    ...domain.files.map((file) => `- ${file}`),
    "",
    "Read them, and read whatever they call that you need in order to state a rule correctly —",
    "a schema, a migration, a shared validator. But the findings you REPORT are this domain's.",
    ...(context.others.length > 0
      ? [
          "",
          `Other domains, already assigned to other sessions: ${context.others.map((other) => `${other.id} ${other.name}`).join(", ")}.`,
          "What belongs to them is not yours to report, even if you read it on the way.",
        ]
      : []),
    "",
    "## What to bring back",
    "",
    "- `rules` — one per business decision the code makes. Behaviour, intent when visible,",
    `  divergence when they disagree, layer (${CAMADAS.join(" | ")}), and evidence.`,
    "- `flows` — what a person or a job actually does, end to end, in steps. Name the actor.",
    "- `entities` — the data this domain owns: where it is stored, every field with its type and",
    "  constraints, and the relations. Read the schema or the migrations, never the model class",
    "  alone: the class shows what the code expects, the schema shows what the data IS.",
    "- `integrations` — anything crossing the boundary of this application, in or out, with the",
    "  contract that the other side depends on.",
    "- `questions` — what the code cannot answer. Why a rule exists, whether a branch is still",
    "  used, which of two contradictory behaviours is the intended one. Say why reading cannot",
    "  settle it.",
    "",
    "A silent rule is the expensive one: a default buried in a constructor, a coercion that hides a",
    "null, an implicit order, a timezone, a rounding, a limit that nobody documented. Those are",
    "exactly what the rewrite gets wrong, and exactly what nobody remembers to tell you.",
    "",
    "Return only JSON:",
    '{ "contract": "' + SURVEY_CONTRACT + '",',
    `  "application": "${context.application}",`,
    '  "domains": [], "stack": [], "deadCode": [],',
    '  "entities": [ { "name": "...", "storage": "table `clients`", "fields": [ { "name": "...",',
    '                  "type": "...", "notes": "constraint, default or trap" } ], "relations": ["..."],',
    '                  "evidence": [ { "file": "...", "locator": "..." } ] } ],',
    `  "rules": [ { "id": "${domain.id}-R01", "domain": "${domain.id}", "layer": "dominio",`,
    '               "behaviour": "what the code does today", "intent": "what it looks meant to do",',
    '               "divergence": "only when they disagree", "evidence": [ { "file": "...", "locator": "..." } ] } ],',
    `  "flows": [ { "id": "${domain.id}-F01", "domain": "${domain.id}", "name": "...", "actor": "...",`,
    '               "steps": ["..."], "evidence": [ { "file": "...", "locator": "..." } ] } ],',
    '  "integrations": [ { "name": "...", "direction": "entrada|saida|ambas", "contract": "...",',
    '                      "evidence": [ { "file": "...", "locator": "..." } ] } ],',
    '  "questions": [ { "topic": "...", "question": "...", "whyCodeCannotAnswer": "..." } ] }',
    ...(context.defects && context.defects.length > 0
      ? ["", "## Your previous answer was rejected", "", ...context.defects.map((defect) => `- ${defect}`), "", "Return everything again."]
      : []),
  ].join("\n");
}
