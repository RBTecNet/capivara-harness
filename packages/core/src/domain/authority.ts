import { createHash } from "node:crypto";
import type { ApplicationMode, ProductAction, ProductBrief, ProductConstraint, Source, TargetPlatform } from "./types.js";

export const normalize = (text: string): string => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
export const identity = (prefix: string, text: string): string => `${prefix}-${createHash("sha256").update(text).digest("hex").slice(0, 12)}`;

const MODES: [ApplicationMode, RegExp][] = [
  ["tui", /\btui\b|(?:interface|interactive|interativa).{0,30}(?:terminal|console)/],
  ["cli", /\bcli\b|linha de comando|command.line|(?:script|comando).{0,25}(?:terminal|console)/],
  ["desktop", /\bdesktop\b|aplicativo nativo|native app|winforms|wpf|winui|appkit|swiftui|avalonia/],
  ["web", /\bweb\b|website|site\b|pagina|browser|navegador|react|vue|svelte|html/],
  ["api", /\bapi\b|\brest\b|graphql/],
  ["service", /\bdaemon\b|servico de fundo|background service/],
  ["library", /\bbiblioteca\b|\blibrary\b|\bsdk\b/],
];

function isPositive(text: string, expression: RegExp): boolean {
  const lowered = normalize(text);
  for (const clause of lowered.split(/[\n.;]/)) {
    const match = expression.exec(clause);
    if (!match) continue;
    const before = clause.slice(Math.max(0, match.index - 100), match.index);
    if (!/(?:\bsem\b|\bno\b|\bnot\b(?!\s+only\b)|\bdon't\b|\bwithout\b|\bnao\b|\bproibid\w*\b|\bnever\b)[^:]*$/.test(before)) return true;
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

const FORBIDDEN: [string, RegExp][] = [
  ["http-server", /\b(?:sem\b|nao\b.{0,25}(?:criar|usar|ter|subir|executar|iniciar)|no\b|do\s+not\b|don't\b|must\s+not\b|without\b|proibid\w*|never\b).{0,65}(?:servidor(?:es)?|servers?|servico permanente|permanent service)/],
  ["browser", /\b(?:sem\b|nao\b.{0,25}(?:usar|ter)|no\b|do\s+not\b|don't\b|must\s+not\b|without\b|proibid\w*|never\b).{0,65}(?:navegador|browser|interface web|web interface|html)/],
  ["database", /\b(?:sem\b|no\b|without\b|proibid\w*).{0,40}(?:banco de dados|banco proprio|database|sql)/],
  ["external-package", /\b(?:sem\b|no\b|without\b|proibid\w*).{0,40}(?:dependencias externas|external dependenc|third.party dependenc)/],
  ["network", /\b(?:sem\b|no\b|without\b|proibid\w*).{0,30}(?:acesso a internet|network access|internet access|acesso a rede)/],
];

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
