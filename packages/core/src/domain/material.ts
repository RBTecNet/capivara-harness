import { createHash } from "node:crypto";
import { allowedCapabilities, inferredCapabilities, normalize } from "./authority.js";
import type { DocumentReference, ProductBrief, SelectedDocument, WorkUnit } from "./types.js";

/** Historical conversations and unpublished drafts are not selected product decisions. */
export function selectedMaterial(documents: readonly SelectedDocument[] = []): SelectedDocument[] {
  const selected = new Map<string, SelectedDocument>();
  for (const document of documents) {
    const reference = document.reference.trim();
    if (!reference || !document.text.trim() && !(document.kind === "reference" && document.localPath)) continue;
    if (/^capivara:\/\/geral(?:\/|$)/i.test(reference) || /^capivara:\/\/[^/]+\/(?:historico|history|rascunhos?|drafts?)(?:\/|$)/i.test(reference)) continue;
    selected.set(reference, { ...document, reference });
  }
  return [...selected.values()].sort((left, right) => left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0);
}

/** Titles and server listing order can change without reopening product discovery. */
export function materialRevision(documents: readonly SelectedDocument[]): string {
  const content = selectedMaterial(documents).map(({ reference, text, kind, contentHash }) => ({ reference, text: text.replace(/\r\n/g, "\n").trim(), kind: kind ?? "document", contentHash }));
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** Literal documentary excerpts inform applicability without entering every model packet. */
export function documentaryAuthority(brief: ProductBrief): string {
  return [...brief.requirements.filter((requirement) => requirement.source.kind === "repository").map((requirement) => requirement.source.text), ...brief.constraints.filter((constraint) => constraint.source.kind === "repository").map((constraint) => constraint.source.text)].join("\n");
}

const COMMON = new Set("this that these with from into then para pelo pela como uma umas dos das que com por sobre apenas cada document documento documentos reference arquivo arquivos selected selecionado selecionados project projeto product produto const import export return function async await type interface true false null undefined string number todos todas tarefa tarefas application aplicacao crie create usar use".split(" "));
export const referenceTerms = (text: string): string[] => normalize(text.replace(/([a-z])([A-Z])/g, "$1 $2")).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !COMMON.has(word));

/** Small searchable metadata, never a copy of a script, skill or other reference body. */
export function materialReferences(documents: readonly SelectedDocument[]): DocumentReference[] {
  return documents.map(document => {
    const frequencies = new Map<string, number>();
    for (const word of referenceTerms(document.text)) frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    const frequent = [...frequencies].sort((a, b) => b[1] - a[1]).map(([word]) => word);
    return { reference: document.reference, ...(document.title ? { title: document.title } : {}), ...(document.localPath ? { localPath: document.localPath } : {}), topics: [...new Set([...(document.topics ?? []), ...referenceTerms(`${document.title ?? ""} ${document.reference}`), ...frequent])].slice(0, 32), ...(document.scope ? { scope: document.scope } : {}), ...(document.contentHash ? { contentHash: document.contentHash } : {}) };
  });
}

export function relevantReferences(brief: ProductBrief, text: string, sources: readonly string[] = []): DocumentReference[] {
  const words = new Set(referenceTerms(text));
  const score = (item: DocumentReference): number => sources.includes(item.reference) || item.localPath && text.includes(item.localPath) ? 1_000 : item.scope === "global" ? 500 : referenceTerms(`${item.title ?? ""} ${item.reference} ${(item.topics ?? []).join(" ")}`).filter(word => words.has(word)).length;
  return (brief.references ?? []).filter(item => item.localPath && allowedCapabilities(brief, inferredCapabilities(item.title ?? ""))).map(item => ({ item, score: score(item) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(({ item }) => item);
}

/** Fingerprints follow the same local relevance as task packets, including binary inputs. */
export function taskReferences(brief: ProductBrief, task: WorkUnit): DocumentReference[] {
  const requirements = brief.requirements.filter(requirement => task.requirementIds.includes(requirement.id));
  return relevantReferences(brief, [task.title, task.goal, task.instructions, ...task.files, ...task.criteria, ...requirements.map(requirement => requirement.statement)].join(" "), requirements.map(requirement => requirement.source.reference));
}

export function boundedReferences(references: readonly DocumentReference[], budget: number): DocumentReference[] {
  const selected: DocumentReference[] = [];
  for (const reference of references) {
    const metadata = { ...reference, ...(reference.title ? { title: reference.title.slice(0, 120) } : {}), topics: (reference.topics ?? []).slice(0, 8).map(topic => topic.slice(0, 40)) };
    const compact = { reference: reference.reference, ...(reference.localPath ? { localPath: reference.localPath } : {}), ...(reference.title ? { title: reference.title.slice(0, 60) } : {}), ...(reference.scope ? { scope: reference.scope } : {}), ...(reference.contentHash ? { contentHash: reference.contentHash } : {}) };
    if (JSON.stringify([...selected, metadata]).length <= budget) selected.push(metadata);
    else if (JSON.stringify([...selected, compact]).length <= budget) selected.push(compact);
  }
  return selected;
}
