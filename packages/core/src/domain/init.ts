import { allowedCapabilities, explicitConstraints, explicitModes, explicitTargets, identity, inferredCapabilities, normalize, requestedCapabilities } from "./authority.js";
import { cancelled, object, records, requestObject, string, strings } from "./json.js";
import { documentaryAuthority, materialReferences, materialRevision, selectedMaterial } from "./material.js";
import type { ApplicationMode, Gap, InitOptions, ProductBrief, ProductConstraint, Question, Requirement, Source, TargetPlatform } from "./types.js";
import { emitEvent, emitProgress } from "../telemetry/progress.js";

const MODES = new Set<ApplicationMode>(["web", "desktop", "tui", "cli", "api", "service", "library", "other"]);
const TARGETS = new Set<TargetPlatform>(["linux", "windows", "macos", "browser", "portable"]);
const CATEGORIES = new Set<Question["category"]>(["behavior", "platform", "data", "integration", "security", "distribution", "appearance"]);

export function splitText(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let boundary = remaining.lastIndexOf("\n", limit);
    if (boundary < limit / 2) boundary = remaining.lastIndexOf(" ", limit);
    if (boundary < limit / 2) boundary = limit;
    pieces.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

type SourceOrigin = Pick<Source, "kind" | "reference" | "localPath">;

function excerpt(raw: string, record: Record<string, unknown>, origin: SourceOrigin): Source | null {
  const nested = object(record.source) ? record.source : {};
  const quote = string(record.quote, string(nested.text));
  if (quote && raw.includes(quote)) return { ...origin, text: quote };
  const statement = string(record.statement);
  if (statement && raw.includes(statement)) return { ...origin, text: statement };
  return null;
}

function requirementsFrom(raw: string, values: unknown, modes: ApplicationMode[], sourceLimit = 1_400, origin: SourceOrigin = { kind: "request", reference: "request" }): Requirement[] {
  const result: Requirement[] = [];
  const coveredRanges: [number, number][] = [];
  const add = (statement: string, source: Source, mode: Requirement["mode"]): void => {
    for (const fragment of splitText(source.text, sourceLimit)) {
      result.push({ id: identity("req", origin.kind === "request" ? fragment : `${origin.reference}:${fragment}`), statement: source.text.length > sourceLimit || statement.length > sourceLimit ? fragment : statement, source: { ...source, text: fragment }, mode });
    }
  };
  for (const item of records(values)) {
    const statement = string(item.statement);
    const source = excerpt(raw, item, origin);
    if (!statement || !source) continue;
    const modeValue = string(item.mode);
    const mode = MODES.has(modeValue as ApplicationMode) && modes.includes(modeValue as ApplicationMode) ? modeValue as ApplicationMode : "shared";
    add(statement, source, mode);
    const start = raw.indexOf(source.text);
    if (start >= 0) coveredRanges.push([start, start + source.text.length]);
  }
  // Only the user's request needs lossless coverage. Documentary code and examples
  // remain references unless extraction identifies an actual product requirement.
  if (origin.kind !== "request") return result;
  const ranges = coveredRanges.sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  for (const [start, end] of [...ranges, [raw.length, raw.length] as [number, number]]) {
    if (start > cursor) {
      const residual = raw.slice(cursor, start).trim();
      if (/[\p{L}\p{N}]/u.test(residual)) add(residual, { ...origin, text: residual }, modes.length === 1 ? modes[0]! : "shared");
    }
    cursor = Math.max(cursor, end);
  }
  return result;
}

function constraintsFrom(raw: string, values: unknown, origin: SourceOrigin = { kind: "request", reference: "request" }): ProductConstraint[] {
  const constraints = explicitConstraints(raw, origin.kind, origin.reference).map(constraint => ({ ...constraint, source: { ...constraint.source, ...origin } }));
  for (const item of records(values)) {
    const statement = string(item.statement);
    const source = excerpt(raw, item, origin);
    if (!statement || !source) continue;
    const explicit = explicitConstraints(source.text).flatMap((constraint) => constraint.forbiddenCapabilities);
    const forbiddenCapabilities = strings(item.forbiddenCapabilities).filter((capability) => explicit.includes(capability));
    const sourceModes = explicitModes(source.text);
    const allowedRequired = new Set([
      ...(sourceModes.includes("web") ? ["browser"] : []),
      ...(sourceModes.some((mode) => mode === "tui" || mode === "cli") ? ["terminal"] : []),
      ...(sourceModes.includes("desktop") ? ["native-window"] : []),
      ...(sourceModes.some((mode) => mode === "web" || mode === "api" || mode === "service") ? ["http-server"] : []),
    ]);
    const requiredCapabilities = strings(item.requiredCapabilities).filter((capability) => allowedRequired.has(capability));
    if (forbiddenCapabilities.length === 0 && requiredCapabilities.length === 0) continue;
    constraints.push({ id: identity("constraint", `${origin.reference}:${source.text}`), statement: source.text, source, forbiddenCapabilities, requiredCapabilities });
  }
  return [...new Map(constraints.map((constraint) => [constraint.id, constraint])).values()];
}

/** Repository rules carry literal provenance separately from a technical file inventory. */
export function applyRepositoryConstraints(brief: ProductBrief, sources?: { text: string; reference: string }[]): void {
  const before = JSON.stringify(brief.constraints.filter((constraint) => constraint.source.kind === "repository"));
  const required = new Set(requestedCapabilities([brief.request, ...brief.decisions.map((decision) => decision.answer)].join("\n")));
  const direct = new Set(brief.constraints.filter(constraint => constraint.source.kind !== "repository").flatMap(constraint => constraint.forbiddenCapabilities));
  const documentReferences = new Set([...(brief.references ?? []).map(reference => reference.reference), ...brief.requirements.filter((requirement) => requirement.source.kind === "repository").map((requirement) => requirement.source.reference)]);
  const documentaryConstraints = brief.constraints.filter((constraint) => constraint.source.kind === "repository" && documentReferences.has(constraint.source.reference));
  const repositoryConstraints = sources === undefined
    ? brief.constraints.filter((constraint) => constraint.source.kind === "repository" && !documentReferences.has(constraint.source.reference))
    : sources.flatMap((source) => explicitConstraints(source.text, "repository", source.reference));
  const constraints = [...documentaryConstraints, ...repositoryConstraints].map((constraint) => ({ ...constraint, forbiddenCapabilities: constraint.forbiddenCapabilities.filter((capability) => !required.has(capability) && !direct.has(capability)) })).filter((constraint) => constraint.forbiddenCapabilities.length > 0 || constraint.requiredCapabilities.length > 0);
  brief.constraints = [...brief.constraints.filter((constraint) => constraint.source.kind !== "repository"), ...constraints];
  if (JSON.stringify(constraints) !== before) brief.revision += 1;
}

/** A question must have a missing product fact and a concrete impact; interviews are optional. */
export function applicableQuestion(value: unknown, brief: ProductBrief): Question | null {
  if (!object(value)) return null;
  const fact = string(value.fact);
  const question = string(value.question, string(value.decision));
  const reason = string(value.reason, string(value.why));
  const impact = string(value.impact);
  const category = string(value.category) as Question["category"];
  if (!fact || !question || !reason || !impact || !CATEGORIES.has(category)) return null;
  if (brief.decisions.some((decision) => normalize(decision.fact) === normalize(fact))) return null;
  const factName = normalize(fact);
  const authority = normalize([brief.request, ...brief.decisions.map((decision) => decision.answer), documentaryAuthority(brief)].join("\n"));
  if (/^(?:interface|modalidade|application.?mode|tipo de (?:interface|aplicacao))\b/.test(factName) && explicitModes(authority).length > 0) return null;
  if (/persistencia|armazenamento|storage|tipo de banco|database choice/.test(factName) && /\bjson\b|\bsqlite\b|postgres|\bmysql\b|\bmongodb\b|sem persistencia|in.memory|em memoria/.test(authority)) return null;
  const modes = strings(value.modes).filter((mode): mode is ApplicationMode => MODES.has(mode as ApplicationMode));
  if (modes.length > 0 && brief.modes.length > 0 && !modes.some((mode) => brief.modes.includes(mode))) return null;
  const text = `${fact} ${question} ${reason}`;
  if (!allowedCapabilities(brief, inferredCapabilities(text))) return null;
  // A library/installer/framework preference is engineering work, not a product gap.
  if (/\b(?:bootstrap|tailwind|framework|orm|npm ci|npm install)\b/i.test(question)) return null;
  if (/qual.{0,25}(?:biblioteca|linguagem|stack|banco de dados)|which.{0,25}(?:library|framework|language|database)/i.test(question)) return null;
  if (category === "appearance" && !brief.modes.some((mode) => ["web", "desktop", "tui"].includes(mode))) return null;
  if (category === "platform" && /sistemas? operaciona|plataform|operating system|target/i.test(question) && brief.targets.length > 0) return null;
  return { id: identity("gap", `${brief.id}:${normalize(fact)}`), fact, question, reason, impact, category, modes, options: strings(value.options), blocks: strings(value.blocks) };
}

export async function resolveQuestions(brief: ProductBrief, candidates: unknown[], hooks: Pick<InitOptions, "ask" | "save" | "onEvent" | "signal">): Promise<void> {
  for (const candidate of candidates) {
    const question = applicableQuestion(candidate, brief);
    if (!question) continue;
    if (!brief.gaps.some((gap) => gap.id === question.id)) brief.gaps.push({ ...question, status: "pending" });
  }
  await hooks.save?.({ brief });
  for (const gap of brief.gaps.filter((item) => item.status === "pending")) {
    cancelled(hooks.signal);
    if (!hooks.ask) continue;
    const rawAnswer = await hooks.ask(gap);
    const raw = rawAnswer?.trim() ?? "";
    if (!raw || /^(?:nao sei|não sei|idk|i don.t know|voltar)$/i.test(raw)) {
      emitEvent(hooks.onEvent, { type: "waiting", message: `Decisão pendente: ${gap.question}`, subject: gap.id });
      continue;
    }
    const selected = /^\d+$/.test(raw) ? gap.options[Number(raw) - 1] : undefined;
    const answer = selected ?? raw;
    const decision = { id: identity("decision", gap.id), questionId: gap.id, fact: gap.fact, answer, source: { kind: "answer" as const, text: raw, reference: gap.id } };
    brief.decisions = [...brief.decisions.filter((item) => item.questionId !== gap.id), decision];
    gap.status = "resolved";
    const requestedModes = explicitModes(brief.request);
    const documentaryText = documentaryAuthority(brief);
    const documentedModes = explicitModes(documentaryText);
    const modeDecisions = brief.decisions.filter((item) => brief.gaps.some((question) => question.id === item.questionId && question.category === "platform")).map((item) => explicitModes(item.answer)).filter((modes) => modes.length > 0);
    brief.modes = modeDecisions.at(-1) ?? (requestedModes.length ? requestedModes : documentedModes.length ? documentedModes : brief.modes);
    const targetDecisions = brief.decisions.map((item) => explicitTargets(item.answer)).filter((targets) => targets.length > 0);
    const requestedTargets = explicitTargets(brief.request);
    brief.targets = targetDecisions.at(-1) ?? (requestedTargets.length ? requestedTargets : explicitTargets(documentaryText));
    brief.requirements = brief.requirements.filter((requirement) => !(requirement.source.kind === "answer" && requirement.source.reference === gap.id));
    brief.constraints = brief.constraints.filter((constraint) => !(constraint.source.kind === "answer" && constraint.source.reference === gap.id));
    brief.constraints.push(...explicitConstraints(answer, "answer", gap.id));
    if (gap.category !== "platform") {
      for (const fragment of splitText(answer, 1_400)) brief.requirements.push({ id: identity("req", `${gap.id}:${fragment}`), statement: fragment, source: { kind: "answer", text: fragment, reference: gap.id }, mode: gap.modes.length === 1 ? gap.modes[0]! : "shared" });
    }
    brief.revision += 1;
    // Persistence occurs before proceeding to the next question or model call.
    await hooks.save?.({ brief });
    emitEvent(hooks.onEvent, { type: "decision", message: `Decisão registrada: ${gap.fact}`, subject: gap.id });
  }
  if (brief.status !== "discovering") {
    brief.status = brief.gaps.some((gap) => gap.status === "pending") ? "waiting" : "ready";
    await hooks.save?.({ brief });
  }
}

export async function runInit(options: InitOptions): Promise<ProductBrief> {
  const request = options.request.trim();
  if (!request) throw new Error("Falta o pedido do produto.");
  const id = identity("product", request);
  const documents = selectedMaterial(options.documents);
  const revision = materialRevision(documents);
  const previous = options.existing?.id === id ? options.existing : undefined;
  const unchanged = previous?.materialRevision === revision || previous?.materialRevision === undefined && documents.length === 0;
  if (previous && unchanged && previous.status !== "discovering") {
    const existing = structuredClone(previous);
    existing.materialRevision = revision;
    existing.references = materialReferences(documents);
    applyRepositoryConstraints(existing, options.repositoryConstraints);
    await resolveQuestions(existing, [], options);
    applyRepositoryConstraints(existing, options.repositoryConstraints);
    await options.save?.({ brief: existing });
    return existing;
  }
  const requestedModes = explicitModes(request);
  const factDocuments = documents.filter(document => document.kind !== "reference");
  const modes = requestedModes.length ? requestedModes : [...new Set(factDocuments.flatMap((document) => explicitModes(document.text)))];
  const requestedTargets = explicitTargets(request);
  const priorAnswers = previous ? structuredClone(previous) : undefined;
  const brief: ProductBrief = {
    schema: "capivara/product/1", status: "discovering", id, revision: previous ? previous.revision + 1 : 1, materialRevision: revision, references: materialReferences(documents),
    name: "Aplicação", summary: "", request, modes,
    targets: requestedTargets.length ? requestedTargets : [...new Set(factDocuments.flatMap((document) => explicitTargets(document.text)))],
    requirements: priorAnswers?.requirements.filter((requirement) => requirement.source.kind === "answer") ?? [],
    constraints: [...explicitConstraints(request), ...(priorAnswers?.constraints.filter((constraint) => constraint.source.kind === "answer") ?? [])],
    decisions: priorAnswers?.decisions ?? [], gaps: priorAnswers?.gaps.filter((gap) => gap.status === "resolved") ?? [],
  };
  const modeDecisions = brief.decisions.filter((decision) => brief.gaps.some((gap) => gap.id === decision.questionId && gap.category === "platform")).map((decision) => explicitModes(decision.answer)).filter((value) => value.length > 0);
  brief.modes = modeDecisions.at(-1) ?? brief.modes;
  const targetDecisions = brief.decisions.map((decision) => explicitTargets(decision.answer)).filter((value) => value.length > 0);
  brief.targets = targetDecisions.at(-1) ?? brief.targets;
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  const candidates: unknown[] = [];
  const capacity = options.contextChars ?? 24_000;
  const repositoryFacts = options.repository?.slice(0, Math.min(3_000, Math.floor(capacity / 5))) ?? "";
  const sources: { text: string; origin: SourceOrigin; title?: string }[] = [
    { text: request, origin: { kind: "request", reference: "request" } },
    ...factDocuments.map((document) => ({ text: document.text, origin: { kind: "repository" as const, reference: document.reference, ...(document.localPath ? { localPath: document.localPath } : {}) }, ...(document.title ? { title: document.title } : {}) })),
  ];
  let completedSources = 0;
  let completedChunks = 0;
  emitProgress(options.onEvent, { id: "init:sources", label: "Fontes analisadas", completed: 0, total: sources.length, status: "running", stage: "init", unit: "fontes" });
  for (const source of sources) {
    let remaining = source.text.trim();
    let index = 0;
    const sourceLength = remaining.length;
    const sourceProgress = { id: `init:source:${source.origin.reference}`, label: source.title ?? (source.origin.kind === "request" ? "Pedido" : source.origin.reference), total: sourceLength, stage: "init", unit: "caracteres" };
    emitProgress(options.onEvent, { ...sourceProgress, completed: 0, status: "running" });
    while (remaining) {
      cancelled(options.signal);
      const prefix = [
        source.origin.kind === "request"
          ? "Extract product facts from this request fragment. Do not implement code. Return one JSON object."
          : "Extract only product requirements and literal restrictions relevant to the user's intended outcome from this selected document. Code, imports, examples, scripts and skills are reference material, not mandatory product behavior. Unrelated or uncovered text creates no requirement. Keep an exact quote for every extracted requirement. Do not change the request or reopen a prior user decision. Return one JSON object.",
        'Shape: {"name":"short name","summary":"desired outcome","modes":["web|desktop|tui|cli|api|service|library|other"],"targets":["linux|windows|macos|browser|portable"],"requirements":[{"statement":"observable requirement","quote":"exact source words","mode":"shared or a mode"}],"constraints":[{"statement":"restriction","quote":"exact source words","forbiddenCapabilities":[],"requiredCapabilities":[]}],"questions":[{"fact":"missing product fact","question":"question","reason":"what is missing","impact":"concrete product consequence","category":"behavior|platform|data|integration|security|distribution|appearance","modes":[],"options":[],"blocks":[]}]}',
        "Questions are optional. Return [] when the request is sufficient. Ask only for a real unresolved product decision; technical library/installer preferences are engineering work. Do not reopen explicit decisions.",
        `Known interfaces: ${brief.modes.join(", ") || "unspecified"}. Known targets: ${brief.targets.join(", ") || "unspecified"}.`,
        source.origin.kind === "repository" ? `User's intended outcome: ${brief.summary || request.slice(0, Math.min(800, Math.floor(capacity / 8)))}` : "",
        repositoryFacts ? `Existing repository facts:\n${repositoryFacts}` : "",
        source.origin.kind === "request" ? "Request fragment:" : `Selected document fragment (${source.origin.reference}${source.title ? `; ${source.title.slice(0, 240)}` : ""}):`,
      ].filter(Boolean).join("\n\n") + "\n";
      const size = capacity - prefix.length;
      if (size < 200) throw new Error("A capacidade de contexto não comporta a descoberta de um fragmento documental.");
      const chunk = splitText(remaining, size)[0]!;
      remaining = remaining.slice(chunk.length).trimStart();
      index += 1;
      emitEvent(options.onEvent, { type: "working", message: source.origin.kind === "request" ? "Entendendo o resultado pedido e suas restrições." : "Lendo os documentos selecionados e suas restrições.", subject: `${source.origin.reference}#${index}` });
      // The prefix can change as facts are discovered, so future fragment counts are unknown.
      emitProgress(options.onEvent, { id: "init:chunks", label: "Fragmentos analisados", completed: completedChunks, status: "running", stage: "init", unit: "fragmentos" });
      const result = await requestObject({ ...options, operation: "discover", prompt: `${prefix}${chunk}` });
      if (brief.name === "Aplicação") brief.name = string(result.name, brief.name).slice(0, 120);
      if (!brief.summary) brief.summary = string(result.summary, chunk.slice(0, 800)).slice(0, 1_600);
      if (modes.length === 0 && modeDecisions.length === 0) brief.modes = [...new Set([...brief.modes, ...strings(result.modes).filter((mode): mode is ApplicationMode => MODES.has(mode as ApplicationMode))])];
      if (brief.targets.length === 0) brief.targets = strings(result.targets).filter((target): target is TargetPlatform => TARGETS.has(target as TargetPlatform));
      brief.requirements.push(...requirementsFrom(chunk, result.requirements, brief.modes, Math.max(200, Math.min(1_400, Math.floor(capacity / 8))), source.origin).filter(requirement => source.origin.kind !== "repository" || allowedCapabilities(brief, inferredCapabilities(`${requirement.statement}\n${requirement.source.text}`))));
      brief.constraints.push(...constraintsFrom(chunk, result.constraints, source.origin));
      candidates.push(...records(result.questions));
      brief.requirements = [...new Map(brief.requirements.map((requirement) => [requirement.id, requirement])).values()];
      brief.constraints = [...new Map(brief.constraints.map((constraint) => [constraint.id, constraint])).values()];
      await options.save?.({ brief });
      completedChunks += 1;
      emitProgress(options.onEvent, { id: "init:chunks", label: "Fragmentos analisados", completed: completedChunks, status: "running", stage: "init", unit: "fragmentos" });
      emitProgress(options.onEvent, { ...sourceProgress, completed: sourceLength - remaining.length, status: remaining ? "running" : "complete" });
    }
    // A restriction crossing a packet boundary keeps its complete literal source.
    brief.constraints.push(...constraintsFrom(source.text, [], source.origin));
    brief.constraints = [...new Map(brief.constraints.map((constraint) => [constraint.id, constraint])).values()];
    completedSources += 1;
    emitProgress(options.onEvent, { ...sourceProgress, completed: sourceLength, status: "complete" });
    emitProgress(options.onEvent, { id: "init:sources", label: "Fontes analisadas", completed: completedSources, total: sources.length, status: completedSources === sources.length ? "complete" : "running", stage: "init", unit: "fontes" });
  }
  emitProgress(options.onEvent, { id: "init:chunks", label: "Fragmentos analisados", completed: completedChunks, total: completedChunks, status: "complete", stage: "init", unit: "fragmentos" });
  if (brief.modes.length === 0) {
    candidates.push({ fact: "interface de uso", question: "Como as pessoas usarão a aplicação: terminal, navegador, janela nativa ou outra interface?", reason: "O pedido não identifica a interface de uso.", impact: "Define como entregar e executar o comportamento solicitado.", category: "platform", modes: [], options: ["TUI interativa no terminal", "CLI por comandos", "Aplicação web no navegador", "Aplicação desktop nativa"], blocks: [] });
  }
  await resolveQuestions(brief, candidates, options);
  applyRepositoryConstraints(brief, options.repositoryConstraints);
  brief.status = brief.gaps.some((gap) => gap.status === "pending") ? "waiting" : "ready";
  await options.save?.({ brief });
  emitEvent(options.onEvent, { type: "complete", message: brief.gaps.some((gap: Gap) => gap.status === "pending") ? "Pedido registrado; decisões reais pendentes permanecem disponíveis, sem inventar respostas." : "Pedido esclarecido e pronto para estruturar o desenvolvimento.", subject: brief.id });
  return brief;
}
