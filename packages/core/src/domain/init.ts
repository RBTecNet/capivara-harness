import { allowedCapabilities, explicitConstraints, explicitModes, explicitTargets, identity, inferredCapabilities, normalize, requestedCapabilities } from "./authority.js";
import { cancelled, object, records, requestObject, string, strings } from "./json.js";
import { documentaryAuthority, materialReferences, materialRevision, selectedMaterial } from "./material.js";
import type { ApplicationMode, CapabilityIdentity, Gap, InitOptions, ProductBrief, ProductConstraint, Question, Requirement, Source, TargetPlatform } from "./types.js";
import { emitEvent, emitProgress } from "../telemetry/progress.js";
import { PlanningFailure, PlanningProgress } from "./control.js";
import { recoverLiteralParagraphs, resolveLiteralExcerpt } from "./literal-source.js";
import { recordedRequirementMetadata } from "./requirement-metadata.js";
import { choiceAlreadySpecified, engineeringChoiceQuestion } from "./question-policy.js";
import { annotateBindingAuthority, literalProviderMention as providerMention } from "./bindings.js";
import { isLiteralProductInvariant, materializeProductInvariants } from './product-invariants.js';

const MODES = new Set<ApplicationMode>(["web", "desktop", "tui", "cli", "api", "service", "library", "other"]);
const TARGETS = new Set<TargetPlatform>(["linux", "windows", "macos", "browser", "portable"]);
const CATEGORIES = new Set<Question["category"]>(["behavior", "platform", "data", "integration", "security", "distribution", "appearance"]);

export function splitText(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let boundary = remaining.lastIndexOf("\n", limit);
    const sentence = [...remaining.slice(0, limit).matchAll(/[.;!?](?=\s)/g)].at(-1)?.index;
    if (sentence !== undefined && sentence + 1 > boundary) boundary = sentence + 1;
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
  const resolved = quote ? resolveLiteralExcerpt(raw, quote) : undefined;
  if (resolved) return { ...origin, text: resolved };
  const recovered = quote ? recoverLiteralParagraphs(raw, quote) : undefined;
  if (recovered) return { ...origin, text: recovered.text, citationRecovery: { strategy:"ordered-literal-paragraphs", quote:recovered.quote, spans:recovered.spans, includedGaps:recovered.includedGaps } };
  const statement = string(record.statement);
  if (statement && raw.includes(statement)) return { ...origin, text: statement };
  return null;
}

const BINDING_KINDS = new Set(["cli", "library", "driver", "service", "runtime", "sdk"]);
const bindingChoice = (binding: Pick<CapabilityIdentity, "kind" | "provider">): string => `${binding.kind}:${binding.provider.normalize("NFC").toLowerCase()}`;
function technicalChoices(text: string): string[] {
  return text.split(/\r?\n|;|,\s*|\s+(?:and|e)\s+|\s+\+\s+/iu).map(part => part.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")).filter(Boolean);
}
/** A citation is provenance, not a schema declaring every prose clause to be
 * another provider. Lock explicit source lists and the original semantic
 * selections, while retaining the complete original statement/source. */
function technicalCoverageChoices(statement:string,source:string,bindings:readonly CapabilityIdentity[]):string[]{
  const semantic=technicalChoices(statement).filter(part=>bindings.some(binding=>providerMention(part,binding.provider))||resolveLiteralExcerpt(source,part)!==undefined);
  const listed=source.split(/\r?\n/).filter(line=>/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(line)).flatMap(technicalChoices);
  const literal=source.trim();
  const bareList=bindings.some(binding=>providerMention(literal,binding.provider)?.index===0)?technicalChoices(literal):[];
  return [...new Set([...semantic,...listed,...bareList])];
}
/** A quote may omit a sentence terminator, not a word, version or technology.
 * Literal resolution keeps compound provider names and polarity intact. */
function coversLiteralChoice(choice:string,quote:string):boolean {
  const literal=resolveLiteralExcerpt(choice,quote);
  if(!literal)return false;
  const start=choice.indexOf(literal);
  return /^[\s.;!?]*$/u.test(choice.slice(0,start)+choice.slice(start+literal.length));
}
type TechnicalOutcome = { quote: string; statement: string };
function bindingsFrom(value: unknown, source: Source): { bindings: CapabilityIdentity[]; issues: string[] } {
  const entries = records(value), bindings: CapabilityIdentity[] = [], issues: string[] = [];
  if (Array.isArray(value) && value.some(entry => !object(entry))) issues.push("Cada provedor deve conter uma identidade técnica estruturada.");
  for (const item of entries) {
    const capability = string(item.capability), kind = string(item.kind), provider = string(item.provider);
    const mention = provider ? providerMention(source.text, provider) : null;
    if (!capability || !BINDING_KINDS.has(kind) || !mention) {
      issues.push(`Binding sem capacidade/tipo/provedor literal válido: ${JSON.stringify(item)}`); continue;
    }
    const binding = { capability, kind: kind as CapabilityIdentity["kind"], provider: mention[0] };
    if (!bindings.some(existing => bindingChoice(existing) === bindingChoice(binding))) bindings.push(binding);
  }
  return { bindings, issues };
}

function outcomesFrom(value: unknown, source: Source): { outcomes: TechnicalOutcome[]; issues: string[] } {
  const outcomes: TechnicalOutcome[] = [], issues: string[] = [];
  if (value !== undefined && !Array.isArray(value)) issues.push("A classificação de resultados deve ser uma lista de citações e obrigações observáveis.");
  for (const entry of Array.isArray(value) ? value : []) {
    const statement = object(entry) ? string(entry.statement) : "";
    const quote = object(entry) ? resolveLiteralExcerpt(source.text, string(entry.quote)) : undefined;
    if (!statement || !quote) { issues.push(`Resultado sem obrigação e origem literal inequívoca: ${JSON.stringify(entry)}`); continue; }
    if (!outcomes.some(existing => existing.quote === quote && normalize(existing.statement) === normalize(statement))) outcomes.push({ quote, statement });
  }
  return { outcomes, issues };
}

function generatedBindingChildren(brief: ProductBrief, parent: Requirement): Requirement[] {
  return brief.requirements.filter(child => child !== parent && !!child.binding && child.kind === "stack"
    && child.id === identity("req", `${parent.source.reference}:${normalize(parent.statement)}:${JSON.stringify(child.binding)}`)
    && child.statement === `${child.binding.provider}: ${child.binding.capability} (${child.binding.kind}).`
    && child.source.kind === parent.source.kind && child.source.reference === parent.source.reference && child.source.localPath === parent.source.localPath
    && !!child.source.text.trim() && parent.source.text.includes(child.source.text) && !!providerMention(parent.source.text, child.binding.provider));
}

async function requirementsFrom(raw: string, values: unknown, modes: ApplicationMode[], sourceLimit: number, origin: SourceOrigin, hooks: Pick<InitOptions, "agent" | "contextChars" | "signal" | "onEvent" | "completedResponses">): Promise<Requirement[]> {
  const result: Requirement[] = [];
  const candidates = records(values), metadata = new Map<number, Record<string, unknown>>();
  const restored = recordedRequirementMetadata(raw, candidates, hooks.completedResponses?.() ?? [],
    (source, quote) => resolveLiteralExcerpt(source, quote) ?? recoverLiteralParagraphs(source, quote)?.text);
  for (const [index, patch] of restored.patches) metadata.set(index, patch);
  const recovery = new PlanningProgress("init-requirement-metadata");
  const rejectedMetadata=new Map<number,string[]>();
  const inspect = (item: Record<string, unknown>, index: number, proposed?:Record<string,unknown>) => {
    const revised = proposed ?? metadata.get(index);
    const evaluate=(candidate:Record<string,unknown>)=>{
    const originalSource = excerpt(raw, item, origin);
    const source = originalSource ?? excerpt(raw, candidate, origin);
    const stack = item.kind === "stack" || object(item.binding);
    const resolved = source && stack ? bindingsFrom(Array.isArray(candidate.bindings) ? candidate.bindings : object(candidate.binding) ? [candidate.binding] : [], source) : { bindings: [], issues: [] };
    // Metadata may repair a citation, never narrow the original semantic
    // selections or an explicitly enumerated literal source list.
    const choices = originalSource ? technicalCoverageChoices(string(item.statement),originalSource.text,resolved.bindings) : [...new Set([...technicalChoices(string(item.statement)), ...technicalChoices(source?.text ?? "")])];
    const classified = source && stack ? outcomesFrom(candidate.outcomes, source) : { outcomes: [], issues: [] };
    const issues = [...(!source ? ["A citação não corresponde a uma origem literal inequívoca."] : []), ...resolved.issues, ...classified.issues];
    if (stack && source) {
      if (candidate.bindings !== undefined && !Array.isArray(candidate.bindings)) issues.push("A classificação de provedores deve ser uma lista de identidades técnicas.");
      if (!resolved.bindings.length && !classified.outcomes.length) issues.push("Nenhuma escolha de provedor nem obrigação observável foi classificada.");
      const uncovered = choices.filter(choice => !resolved.bindings.some(binding => providerMention(choice, binding.provider))
        && !classified.outcomes.some(outcome => technicalChoices(outcome.quote).some(part => coversLiteralChoice(choice,part))));
      if (uncovered.length) issues.push(`Itens literais ainda sem classificação de provedor ou resultado: ${JSON.stringify(uncovered)}`);
      if (resolved.bindings.some(binding => normalize(binding.capability) === normalize(binding.provider)) && !Array.isArray(candidate.outcomes)) issues.push("Nome do provedor e rótulo de capacidade coincidem: classifique explicitamente a escolha de ferramenta ou o resultado exigido, sem presumir que cada item da lista é software.");
      const original = bindingsFrom([...records(item.bindings), ...(object(item.binding) ? [item.binding] : [])], source).bindings;
      for (const binding of original) if (normalize(binding.capability) !== normalize(binding.provider)
        && !resolved.bindings.some(entry => normalize(entry.provider) === normalize(binding.provider))) issues.push(`A escolha original de provedor ${binding.provider} não pode desaparecer no reparo de metadados; um papel operacional inferido pode mudar sem remover a tecnologia.`);
    }
    return { source, stack, bindings: resolved.bindings, outcomes: classified.outcomes, issues, candidate };
    };
    const selected=evaluate(revised?{...item,...revised}:item);
    if(revised&&proposed===undefined&&selected.issues.length){
      const original=evaluate(item);
      if(!original.issues.length){rejectedMetadata.set(index,selected.issues);return original;}
    }
    return selected;
  };
  for(const conflict of restored.conflicts){
    const item=candidates[conflict.index];if(!item)continue;
    // A malformed proposal does not conflict with a fully validated one. Reuse
    // only the unique valid classification; distinct valid meanings still need
    // explicit resolution. Every original paid response remains in the ledger.
    const valid=conflict.variants.filter(variant=>!inspect(item,conflict.index,variant).issues.length);
    if(valid.length===1){
      metadata.set(conflict.index,valid[0]!);
      emitEvent(hooks.onEvent,{type:'metadata-restored',subject:origin.reference,message:'Classificação literal única validada recuperada entre respostas registradas; variantes inválidas permanecem no histórico, sem nova inferência.',detail:{index:conflict.index,variants:conflict.variants.length,valid:1}});
    }else if(item.kind==='stack'||object(item.binding))emitEvent(hooks.onEvent,{type:'metadata-conflict',subject:origin.reference,message:'Respostas registradas sem uma única classificação válida desta origem; nenhuma variante foi adotada arbitrariamente.',detail:{index:conflict.index,variants:conflict.variants.length,valid:valid.length}});
  }
  for (;;) {
    const pending = candidates.flatMap((item, index) => {
      if (!string(item.statement)) return [];
      const inspected = inspect(item, index);
      if (!inspected.issues.length || inspected.candidate.unsupported === true && !inspected.source && string(inspected.candidate.reason)) return [];
      return [{ index, statement: string(item.statement), quote: string(inspected.candidate.quote, object(inspected.candidate.source) ? string(inspected.candidate.source.text) : ""), kind: string(item.kind), bindings: inspected.bindings, outcomes: inspected.outcomes, issues: inspected.issues, ...(inspected.source ? { literalSource: inspected.source.text } : {}) }];
    });
    if (!pending.length) break;
    recovery.requireChange(pending, "A origem ou a identidade das escolhas técnicas ainda não foi recuperada; nenhum requisito será descartado nem aprovado incompleto.");
    cancelled(hooks.signal);
    emitEvent(hooks.onEvent, { type: "recovering", message: "Recuperando somente origens e capacidades técnicas da resposta já recebida, sem refazer a descoberta ou entrevistar o usuário.", subject: origin.reference });
    emitProgress(hooks.onEvent, { id: "init:metadata", label: "Origens e escolhas técnicas", completed: candidates.length - pending.length, total: candidates.length, status: "running", stage: "init" });
    const repaired = await requestObject({ ...hooks, operation: "repair", prompt: [
      "Operation: init-requirement-metadata. Repair only metadata of the already extracted requirements below. Do not rediscover or change their statements, product scope or interfaces. Do not implement code or ask the user an already answered fact.",
      'Return {"requirements":[{"index":0,"quote":"exact words from the source","bindings":[{"capability":"concrete technical capability","kind":"cli|library|driver|service|runtime|sdk","provider":"complete literal technology name"}],"outcomes":[{"quote":"exact source words","statement":"required observable result"}]}]}. Preserve the original index. Classify EVERY item in the original literal source: bindings are explicitly selected named technologies; outcomes are required capabilities or observable behavior without a selected tool. Outcomes are optional; return [] when all items are technology choices. A list under a stack heading can contain both kinds: do not turn capabilities, testing, observability, accessibility or an interface to deliver into names of software providers. Do not erase any named technology or observable obligation. A runtime does not cover a library, compiler, build tool or database. Do not invent tool choices or user decisions. For a genuinely unsupported extraction only, return {index,unsupported:true,reason:"why the source does not establish it"}.',
      `Unresolved requirements: ${JSON.stringify(pending)}`,
      `Literal source (${origin.reference}):\n${pending.every(item => item.literalSource) ? [...new Set(pending.map(item => item.literalSource))].join("\n\n") : raw}`,
    ].join("\n\n") });
    cancelled(hooks.signal);
    for (const update of records(repaired.requirements)) {
      const index = typeof update.index === "number" && Number.isInteger(update.index) ? update.index : pending.length === 1 ? pending[0]!.index : -1;
      if (!pending.some(item => item.index === index)) continue;
      const patch: Record<string, unknown> = {};
      if (typeof update.quote === "string") patch.quote = update.quote;
      if (Array.isArray(update.bindings)) patch.bindings = update.bindings;
      else if (object(update.binding)) patch.bindings = [update.binding];
      if (update.outcomes !== undefined) patch.outcomes = update.outcomes;
      if (update.unsupported === true && string(update.reason)) { patch.unsupported = true; patch.reason = string(update.reason); }
      metadata.set(index, { ...metadata.get(index), ...patch });
    }
  }
  for (const [index, item] of candidates.entries()) {
    cancelled(hooks.signal);
    const statement = string(item.statement);
    if (!statement) continue;
    const inspected = inspect(item, index), source = inspected.source;
    if(rejectedMetadata.has(index))emitEvent(hooks.onEvent,{type:'metadata-rejected',subject:origin.reference,message:'Uma proposta posterior inválida não substitui a declaração original já sustentada pela fonte literal. A resposta original e a proposta permanecem no histórico.',detail:{index,issues:rejectedMetadata.get(index)}});
    else if(restored.patches.has(index)&&metadata.get(index)===restored.patches.get(index))emitEvent(hooks.onEvent,{type:'metadata-restored',subject:origin.reference,message:'Metadados válidos da mesma origem literal recuperados da resposta já registrada; nenhuma nova inferência foi feita.',detail:{index}});
    if (!source) {
      emitEvent(hooks.onEvent, { type: "requirement-rejected", message: `Extração sem sustentação literal rejeitada explicitamente: ${statement}. ${string(inspected.candidate.reason)}`, subject: origin.reference });
      continue;
    }
    if(source.citationRecovery)emitEvent(hooks.onEvent,{type:"source-recovered",subject:origin.reference,
      message:"Citação descontínua recuperada por trechos literais únicos; o intervalo real conserva também as cláusulas omitidas.",
      detail:{index,recovery:source.citationRecovery}});
    const modeValue = string(item.mode);
    const mode = MODES.has(modeValue as ApplicationMode) && modes.includes(modeValue as ApplicationMode) ? modeValue as ApplicationMode : "shared";
    if (statement.length > sourceLimit) throw new PlanningFailure("context-capacity", ["A extração devolveu uma descrição maior que uma unidade semântica. Divida os resultados observáveis, preservando a fonte original."], "init");
    const requirement: Requirement = { id: identity("req", `${origin.reference}:${normalize(statement)}`), statement, source: { ...source, text: source.text.slice(0, sourceLimit) }, mode };
    if (["behavior", "stack", "interface", "constraint"].includes(string(item.kind))) requirement.kind = string(item.kind) as NonNullable<Requirement["kind"]>;
    if (inspected.stack) {
      const bindings = [...inspected.bindings].sort((left, right) => (providerMention(source.text, left.provider)?.index ?? 0) - (providerMention(source.text, right.provider)?.index ?? 0));
      if (bindings[0]) { requirement.binding = bindings[0]; requirement.kind = "stack"; }
      else requirement.kind = "behavior";
      if (Array.isArray(inspected.candidate.outcomes)) requirement.technicalClassification = {
        schema: "capivara/technical-choices/1", source: structuredClone(source),
        providers: bindings.map(binding => ({ binding: structuredClone(binding), quote: technicalChoices(source.text).find(part => providerMention(part, binding.provider)) ?? binding.provider })),
        outcomes: inspected.outcomes.map(outcome => ({ ...outcome })),
      };
      const proposed = records(Array.isArray(inspected.candidate.bindings) ? inspected.candidate.bindings : [inspected.candidate.binding]);
      for (const binding of bindings) {
        const labels = [...new Set(proposed.filter(item => string(item.kind) === binding.kind && bindingChoice({ kind: binding.kind, provider: string(item.provider) }) === bindingChoice(binding)).map(item => string(item.capability)).filter(Boolean))];
        if (labels.length > 1) emitEvent(hooks.onEvent, { type: "binding-reconciled", message: `Uma única escolha literal ${binding.provider} (${binding.kind}) conserva os papéis técnicos ${JSON.stringify(labels)}; rótulos de papel não criam escolhas adicionais.`, subject: requirement.id });
      }
      for (const binding of bindings.slice(1)) {
        const choice = technicalChoices(source.text).find(part => providerMention(part, binding.provider))!;
        const literal = resolveLiteralExcerpt(source.text, choice) ?? source.text;
        const child: Requirement = { id: identity("req", `${origin.reference}:${normalize(statement)}:${JSON.stringify(binding)}`), statement: `${binding.provider}: ${binding.capability} (${binding.kind}).`, source: { ...source, text: literal }, mode, kind: "stack", binding };
        annotateBindingAuthority(child, raw, "init");
        result.push(child);
      }
      for (const outcome of inspected.outcomes) {
        if (normalize(outcome.statement) === normalize(statement) && outcome.quote === source.text && !bindings.length) continue;
        if (outcome.statement.length > sourceLimit) throw new PlanningFailure("context-capacity", ["A classificação de resultado excedeu uma unidade semântica; preserve a obrigação sem expandir o contexto."], "init");
        const child: Requirement = { id: identity("req", `${origin.reference}:${normalize(statement)}:outcome:${normalize(outcome.quote)}:${normalize(outcome.statement)}`), statement: outcome.statement, source: { ...source, text: outcome.quote }, mode, kind: "behavior" };
        result.push(child);
        const classification = requirement.technicalClassification?.outcomes.find(entry => entry.quote === outcome.quote && entry.statement === outcome.statement);
        if (classification) classification.requirementId = child.id;
      }
    }
    annotateBindingAuthority(requirement, raw, "init");
    result.push(requirement);
  }
  if (metadata.size) emitProgress(hooks.onEvent, { id: "init:metadata", label: "Origens e escolhas técnicas", completed: candidates.length, total: candidates.length, status: "complete", stage: "init" });
  // The complete source remains on the brief/material. Unquoted prose and context
  // are not requirements, and splitting transport packets never creates work.
  return result;
}

/** Retire only children proven to have been generated from this exact parent.
 * Independent product requirements sharing a provider remain independent. */
function reconcileGeneratedBindings(brief: ProductBrief, hooks: Pick<InitOptions, "onEvent">): void {
  const retired = new Set<string>();
  for (const parent of brief.requirements) {
    if (!parent.binding || parent.kind !== "stack" || parent.id !== identity("req", `${parent.source.reference}:${normalize(parent.statement)}`)) continue;
    const children = generatedBindingChildren(brief, parent);
    const choices = new Map<string, Requirement>([[bindingChoice(parent.binding), parent]]);
    for (const child of children) {
      const key = bindingChoice(child.binding!), pivot = choices.get(key);
      if (!pivot) { choices.set(key, child); continue; }
      retired.add(child.id);
      brief.requirementAliases ??= {};
      brief.requirementAliases[child.id] = pivot.id;
      emitEvent(hooks.onEvent, { type: "requirement-reconciled", message: `Escolha técnica gerada duplicada ${child.id} → ${pivot.id}: ${child.binding!.provider} (${child.binding!.kind}); papel ${JSON.stringify(child.binding!.capability)} preservado na resposta original e na origem composta.`, subject: parent.id });
    }
  }
  if (retired.size) { brief.requirements = brief.requirements.filter(requirement => !retired.has(requirement.id)); brief.revision++; }
}

/** Old extraction treated every list item as software. Reclassify only a proven
 * generated group, never an independent requirement, and retain the prior interpretation. */
async function classifyGeneratedChoices(brief: ProductBrief, hooks: InitOptions): Promise<void> {
  for (const parent of [...brief.requirements]) {
    if (!parent.binding || parent.kind !== "stack" || parent.technicalClassification
      || parent.id !== identity("req", `${parent.source.reference}:${normalize(parent.statement)}`)) continue;
    const group = [parent, ...generatedBindingChildren(brief, parent)];
    if (!group.some(requirement => normalize(requirement.binding!.capability) === normalize(requirement.binding!.provider))) continue;
    const source = parent.source;
    emitEvent(hooks.onEvent, { type: "recovering", message: "Reavaliando somente a distinção entre ferramentas escolhidas e resultados exigidos na fonte técnica já registrada.", subject: parent.id });
    const resolved = await requirementsFrom(source.text, [{ statement: parent.statement, quote: source.text, kind: "stack", mode: parent.mode, bindings: group.map(requirement => requirement.binding) }], brief.modes,
      Math.max(1_400, parent.statement.length), { kind: source.kind, reference: source.reference, ...(source.localPath ? { localPath: source.localPath } : {}) }, hooks);
    cancelled(hooks.signal);
    const replacement = resolved.find(requirement => requirement.id === parent.id)!;
    // Reuse identities only with the same concrete provider or the exact literal
    // outcome span. Changed interpretation is not proof of product behavior.
    const used = new Set<string>([parent.id]);
    for (const requirement of resolved) {
      if (requirement === replacement) continue;
      const candidates = group.filter(old => !used.has(old.id) && (requirement.binding
        ? normalize(old.binding!.provider) === normalize(requirement.binding.provider)
          && (old.binding!.kind === requirement.binding.kind || old.bindingAuthority?.kind.authority === "inferred")
        : resolved.filter(current => current !== replacement && !current.binding && normalize(current.source.text) === normalize(requirement.source.text)).length === 1
          && normalize(old.source.text) === normalize(requirement.source.text)
          && !resolved.some(current => current.binding && bindingChoice(current.binding) === bindingChoice(old.binding!))));
      if (candidates.length !== 1) continue;
      const originalId = requirement.id;
      requirement.id = candidates[0]!.id; used.add(requirement.id);
      const outcome = replacement.technicalClassification?.outcomes.find(entry => entry.requirementId === originalId);
      if (outcome) outcome.requirementId = requirement.id;
    }
    replacement.id = parent.id;
    replacement.statement = parent.statement;
    replacement.source = structuredClone(parent.source);
    if (replacement.technicalClassification) replacement.technicalClassification.previous = group.map(requirement => ({ requirementId: requirement.id, statement: requirement.statement, source: structuredClone(requirement.source), binding: structuredClone(requirement.binding!) }));
    const groupIds = new Set(group.map(requirement => requirement.id));
    const retainedIds = new Set(resolved.map(requirement => requirement.id));
    for (const old of group) if (!retainedIds.has(old.id)) {
      brief.requirementAliases ??= {};
      brief.requirementAliases[old.id] = parent.id;
    }
    brief.requirements = brief.requirements.flatMap(requirement => requirement.id === parent.id ? resolved : groupIds.has(requirement.id) ? [] : [requirement]);
    brief.revision++;
    emitEvent(hooks.onEvent, { type: "requirement-reconciled", message: "Classificação técnica recuperada da fonte literal: escolhas de ferramentas e obrigações de resultado permanecem separadas, com a interpretação anterior preservada.", subject: parent.id });
    await hooks.save?.({ brief });
  }
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
    // Native capability names are an execution vocabulary, not the authority
    // of a literal user restriction. Preserve its source even when no current
    // adapter recognizes the model's capability labels.
    constraints.push({ id: identity("constraint", `${origin.reference}:${source.text}`), statement: source.text, source, forbiddenCapabilities, requiredCapabilities });
  }
  return [...new Map(constraints.map((constraint) => [constraint.id, constraint])).values()];
}

/** Reinterpret persisted machine decisions against their literal sources, without
 * asking a model to rediscover the product or treating stale inference as law. */
export function reconcileAuthority(brief: ProductBrief): void {
  materializeProductInvariants(brief);
  const before = JSON.stringify(brief.constraints);
  const corrected: ProductConstraint[] = [];
  for (const original of brief.constraints) {
    const forbidden = new Set(explicitConstraints(original.source.text).flatMap(constraint => constraint.forbiddenCapabilities));
    const required = new Set(requestedCapabilities(original.source.text));
    const constraint = { ...original, forbiddenCapabilities: original.forbiddenCapabilities.filter(capability => forbidden.has(capability)), requiredCapabilities: original.requiredCapabilities.filter(capability => required.has(capability)) };
    if (JSON.stringify([constraint.forbiddenCapabilities, constraint.requiredCapabilities]) !== JSON.stringify([original.forbiddenCapabilities, original.requiredCapabilities])) {
      const correction = { constraintId: original.id, source: structuredClone(original.source), before: { forbiddenCapabilities: [...original.forbiddenCapabilities], requiredCapabilities: [...original.requiredCapabilities] }, after: { forbiddenCapabilities: [...constraint.forbiddenCapabilities], requiredCapabilities: [...constraint.requiredCapabilities] }, reason: "A interpretação de capacidade deve corresponder à negação e ao objeto na fonte literal; uma preposição ou uma negação de outra cláusula não cria proibição." };
      brief.authorityCorrections ??= [];
      if (!brief.authorityCorrections.some(existing => JSON.stringify(existing) === JSON.stringify(correction))) brief.authorityCorrections.push(correction);
    }
    const authority=constraint.source.kind==='request'&&constraint.source.reference==='request'?brief.request:constraint.source.kind==='answer'?brief.decisions.find(decision=>decision.questionId===constraint.source.reference)?.answer:undefined;
    const literalAuthority=constraint.statement===constraint.source.text&&Boolean(constraint.source.text.trim()&&authority?.includes(constraint.source.text));
    if (constraint.forbiddenCapabilities.length || constraint.requiredCapabilities.length || isLiteralProductInvariant(brief,constraint) || literalAuthority) corrected.push(constraint);
  }
  const direct = [...explicitConstraints(brief.request), ...brief.decisions.flatMap(decision => explicitConstraints(decision.answer, "answer", decision.questionId))];
  brief.constraints = [...new Map([...corrected, ...direct].map(constraint => [constraint.id, constraint])).values()];
  materializeProductInvariants(brief);
  if (JSON.stringify(brief.constraints) !== before) brief.revision += 1;
}

/** Repository rules carry literal provenance separately from a technical file inventory. */
export function applyRepositoryConstraints(brief: ProductBrief, sources?: { text: string; reference: string }[]): void {
  reconcileAuthority(brief);
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
  const authority = normalize([brief.request, ...brief.decisions.map((decision) => decision.answer), documentaryAuthority(brief)].join("\n"));
  if(choiceAlreadySpecified(fact,category,authority,question))return null;
  const modes = strings(value.modes).filter((mode): mode is ApplicationMode => MODES.has(mode as ApplicationMode));
  if (modes.length > 0 && brief.modes.length > 0 && !modes.some((mode) => brief.modes.includes(mode))) return null;
  const text = `${fact} ${question} ${reason}`;
  if (!allowedCapabilities(brief, inferredCapabilities(text))) return null;
  // A library/installer/framework preference is engineering work, not a product gap.
  if(engineeringChoiceQuestion(question))return null;
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
    for (const requirement of existing.requirements) annotateBindingAuthority(requirement, requirement.source.kind === "request" ? request : undefined);
    existing.materialRevision = revision;
    existing.references = materialReferences(documents);
    reconcileGeneratedBindings(existing, options);
    await classifyGeneratedChoices(existing, options);
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
        'Shape: {"name":"short name","summary":"desired outcome","modes":["web|desktop|tui|cli|api|service|library|other"],"targets":["linux|windows|macos|browser|portable"],"requirements":[{"statement":"observable requirement","quote":"exact source words","mode":"shared or a mode","kind":"behavior|stack|interface|constraint","binding":{"capability":"required capability for mandatory stack only","kind":"cli|library|driver|service|runtime|sdk","provider":"literal required technology from quote"}}],"constraints":[{"statement":"restriction","quote":"exact source words","forbiddenCapabilities":[],"requiredCapabilities":[]}],"questions":[{"fact":"missing product fact","question":"question","reason":"what is missing","impact":"concrete product consequence","category":"behavior|platform|data|integration|security|distribution|appearance","modes":[],"options":[],"blocks":[]}]}',
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
      await options.save?.({ brief });
      const extracted = await requirementsFrom(chunk, result.requirements, brief.modes, Math.max(200, Math.min(1_400, Math.floor(capacity / 8))), source.origin, options);
      brief.requirements.push(...extracted.filter(requirement => source.origin.kind !== "repository" || allowedCapabilities(brief, inferredCapabilities(`${requirement.statement}\n${requirement.source.text}`))));
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
  if (!brief.requirements.some(requirement => requirement.source.kind === "request")) {
    // A short, self-contained request can itself be the single product outcome.
    // Large requests require semantic extraction; packet-sized fragments are never tasks.
    const limit = Math.max(200, Math.min(1_400, Math.floor(capacity / 8)));
    if (request.length > limit) throw new PlanningFailure("missing-requirement", ["Nenhum resultado observável foi extraído do pedido extenso. O texto foi preservado; não será convertido em tarefas por fragmentos literais."], "init");
    brief.requirements.unshift({ id: identity("req", `request:${normalize(request)}`), statement: request, source: { kind: "request", reference: "request", text: request }, mode: brief.modes.length === 1 ? brief.modes[0]! : "shared" });
  }
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
