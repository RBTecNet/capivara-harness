import { createHash } from "node:crypto";
import type { ApplicationMode, ProductAction, ProductBrief, ProductConstraint, Source, TargetPlatform } from "./types.js";

export const normalize = (text: string): string => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
export const identity = (prefix: string, text: string): string => `${prefix}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;

const MODES: [ApplicationMode, RegExp][] = [
  ["tui", /\btui\b|(?:interface|interactive|interativa).{0,30}(?:terminal|console)/],
  ["cli", /\bcli\b|linha de comando|command.line|(?:script|comando).{0,25}(?:terminal|console)/],
  ["desktop", /\bdesktop\b|aplicativo nativo|native app/],
  ["web", /\bweb\b|website|site\b|pagina|browser|navegador/],
  ["api", /^(?:(?:uma?|an?|the)\s+)?api\b|\b(?:crie|criar|desenvolva|desenvolver|create|develop|build|implemente?|implement)\s+(?:(?:um|uma|a|an|the|novo|nova|new)\s+)?api\b|\b(?:api|backend|servidor|server)\s+(?:rest|graphql)\b/],
  ["service", /\bdaemon\b|servico de fundo|background service/],
  ["library", /^(?:(?:uma?|an?|the)\s+)?(?:biblioteca|library|sdk)\b|\b(?:crie|criar|desenvolva|desenvolver|create|develop|build|implemente?|implement)\s+(?:(?:um|uma|a|an|the|novo|nova|new|reusable|reutilizavel)\s+){0,3}(?:biblioteca|library|sdk)\b/],
];

function isPositive(text: string, expression: RegExp): boolean {
  const lowered = normalize(text);
  for (const clause of lowered.split(/[\n.;]/)) {
    for (const match of clause.matchAll(new RegExp(expression.source, "g"))) {
      const before = clause.slice(0, match.index);
      const scoped = FORBIDDEN.some(([, pattern]) => [...clause.matchAll(new RegExp(pattern.source, "g"))].some(negative => negative.index <= match.index && negative.index + negative[0].length > match.index));
      const direct = new RegExp(`\\b(?:sem|nao|not(?!\\s+only\\b)|don't|without|proibid\\w*|never)\\s+${ACTION}${ARTICLE}(?:suporte\\s+(?:a|para)\\s+)?$`).test(before);
      const englishNo = /\bno\s+$/.test(before) && /^(?:browser|web|website|desktop|cli|tui|api|library|sdk|linux|windows|macos)\b/.test(match[0]);
      if (!scoped && !direct && !englishNo) return true;
    }
  }
  return false;
}

export function explicitModes(request: string): ApplicationMode[] {
  return MODES.filter(([, expression]) => isPositive(request, expression)).map(([mode]) => mode);
}

export function explicitTargets(request: string): TargetPlatform[] {
  const patterns: [TargetPlatform, RegExp][] = [["linux", /\blinux\b/], ["windows", /\bwindows\b|\bwin32\b/], ["macos", /\bmacos\b|\bmac os\b|\bmac\b/], ["browser", /\bnavegador\b|\bbrowser\b/]];
  return patterns.filter(([, expression]) => isPositive(request, expression)).map(([target]) => target);
}

/** A current direct product request outranks an older repository convention. */
export function requestedCapabilities(request: string): string[] {
  const modes = explicitModes(request);
  return [...new Set([
    ...(modes.includes("web") ? ["browser"] : []),
    ...(modes.some((mode) => mode === "api" || mode === "service") || isPositive(request, /(?:servidor|server|servico).{0,20}\bhttp\b|\bhttp\b.{0,20}(?:servidor|server)/) ? ["http-server"] : []),
    ...(modes.some((mode) => mode === "tui" || mode === "cli") ? ["terminal"] : []),
    ...(modes.includes("desktop") ? ["native-window"] : []),
    ...(isPositive(request, /(?:usar|use|utiliz\w*).{0,25}(?:dependencias externas|external dependenc)/) ? ["external-package"] : []),
    ...(isPositive(request, /(?:acessar|conectar|consultar|access|connect).{0,25}(?:internet|rede|api externa|external api)/) ? ["network"] : []),
  ])];
}

// Negation applies to its object, never to an arbitrary nearby noun. In
// particular Portuguese "no navegador" (in the browser) is not English "no
// browser". Keep the English determiner tied to English object spellings.
const OBJECTS: [string, string, string][] = [
  ["http-server", "servidor(?:es)?(?: http)?|servico permanente", "(?:http )?servers?|permanent service"],
  ["browser", "navegador(?:es)?|interface web|html", "browsers?|web interface|html"],
  ["database", "banco de dados|banco proprio|sql", "databases?|sql"],
  ["external-package", "dependencias externas", "external dependenc\\w*|third.party dependenc\\w*"],
  ["network", "acesso a internet|acesso a rede", "network access|internet access"],
];
const ARTICLE = "(?:(?:um|uma|o|a|os|as|qualquer|nenhum|nenhuma|a|an|the|any)\\s+){0,2}";
const ACTION = "(?:(?:deve|devera|pode|podera|e\\s+permitid[oa]|e\\s+autorizad[oa])\\s+)?(?:(?:criar|usar|utilizar|ter|subir|executar|iniciar|abrir|acessar|instalar|create|use|have|run|start|open|access|install)(?:\\s+de)?\\s+)?";
const FORBIDDEN: [string, RegExp][] = OBJECTS.map(([capability, portuguese, english]) => [capability,
  new RegExp(`\\b(?:(?:sem|nao|without|do\\s+not|don't|must\\s+not|never|proibid\\w*(?:\\s+(?:o|a))?)\\s+${ACTION}${ARTICLE}(?:${portuguese}|${english})|no\\s+${ARTICLE}(?:${english}))\\b${['http-server','database'].includes(capability) ? '(?!\\s+(?:http\\b|extern\\w*|external|remot\\w*|remote|terceir\\w*))' : ''}`),
]);

export function explicitConstraints(request: string, sourceKind: Source["kind"] = "request", reference = "request"): ProductConstraint[] {
  const result: ProductConstraint[] = [];
  for (const statement of request.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean)) {
    const text = normalize(statement);
    const capabilities = FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([capability]) => capability);
    if (capabilities.length === 0) continue;
    result.push({ id: identity("constraint", `${reference}:${statement}`), statement, source: { kind: sourceKind, text: statement, reference }, forbiddenCapabilities: capabilities, requiredCapabilities: [] });
  }
  return result;
}

/** Capabilities are checked before execution; tool conventions have no product authority. */
export function actionConflict(brief: ProductBrief, action: ProductAction): ProductConstraint[] {
  const required = new Set(action.requiredCapabilities);
  return brief.constraints.filter((constraint) => constraint.forbiddenCapabilities.some((capability) => required.has(capability)));
}

export function inferredCapabilities(text: string): string[] {
  const value = normalize(text);
  const result: string[] = [];
  if (/playwright|puppeteer|selenium|chromium|\bbootstrap\b|tailwind|css framework|page\.goto/.test(value)) result.push("browser");
  if (/createServer\b|http\.server|http-server|webserver|web server|serve http|servidor http/i.test(text)) result.push("http-server");
  if (/\bsudo\b|apt-get|apt install|brew install|winget install/.test(value)) result.push("system-install");
  return [...new Set(result)];
}

export function allowedCapabilities(brief: ProductBrief, capabilities: string[]): boolean {
  if (capabilities.includes("browser") && !brief.modes.includes("web")) return false;
  if (capabilities.includes("http-server") && !brief.modes.some((mode) => ["web", "api", "service"].includes(mode)) && !isPositive(brief.request, /\bhttp\b|\bservidor\b|\bserver\b/)) return false;
  return actionConflict(brief, { requiredCapabilities: capabilities }).length === 0;
}
