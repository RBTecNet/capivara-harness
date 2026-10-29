import { identity, normalize } from './authority.js';
import { literalProviderMention } from './bindings.js';
import { resolveLiteralExcerpt } from './literal-source.js';
import type { ProductBrief, Requirement, Source } from './types.js';

const sameOrigin = (left: Source, right: Source): boolean => left.kind === right.kind && left.reference === right.reference && left.localPath === right.localPath;

function partitionedChildren(brief: ProductBrief, parent: Requirement): string[] {
  const classification = parent.technicalClassification;
  if (!classification || classification.schema !== 'capivara/technical-choices/1'
    || parent.id !== identity('req', `${parent.source.reference}:${normalize(parent.statement)}`)
    || !sameOrigin(parent.source, classification.source) || parent.source.text !== classification.source.text) return [];
  const children: string[] = [];
  for (const outcome of classification.outcomes) {
    if (!outcome.requirementId || !outcome.statement.trim() || !outcome.quote.trim()
      || resolveLiteralExcerpt(parent.source.text, outcome.quote) !== outcome.quote) continue;
    const child = brief.requirements.find(requirement => requirement.id === outcome.requirementId);
    if (!child || child.id === parent.id || child.binding || child.kind !== 'behavior' || child.mode !== parent.mode
      || child.statement !== outcome.statement || child.source.text !== outcome.quote || !sameOrigin(parent.source, child.source)) continue;
    const expected = identity('req', `${parent.source.reference}:${normalize(parent.statement)}:outcome:${normalize(outcome.quote)}:${normalize(outcome.statement)}`);
    const retainedGeneratedIdentity = classification.previous?.some(previous => previous.requirementId === child.id
      && previous.requirementId === identity('req', `${parent.source.reference}:${normalize(parent.statement)}:${JSON.stringify(previous.binding)}`)
      && previous.statement === `${previous.binding.provider}: ${previous.binding.capability} (${previous.binding.kind}).`
      && previous.source.text === outcome.quote && sameOrigin(previous.source, child.source)
      && !!literalProviderMention(previous.source.text, previous.binding.provider));
    if (child.id === expected || retainedGeneratedIdentity) children.push(child.id);
  }
  return children;
}

/** Inherit planning coverage of an INIT partition, never verification claims.
 * Unknown references remain explicit; only active, exactly sourced descendants
 * are added. This function neither mutates the brief nor invents evidence. */
export function expandPartitionedRequirementIds(brief: ProductBrief, requirementIds: readonly string[]): string[] {
  const result = [...new Set(requirementIds)], seen = new Set(result);
  for (let index = 0; index < result.length; index++) {
    const parent = brief.requirements.find(requirement => requirement.id === result[index]);
    if (!parent) continue;
    for (const id of partitionedChildren(brief, parent)) if (!seen.has(id)) { seen.add(id); result.push(id); }
  }
  return result;
}
