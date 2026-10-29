import { normalize } from './authority.js';
import type { BindingAuthority, BindingTransformation, CapabilityIdentity, Requirement } from './types.js';

type Kind = CapabilityIdentity['kind'];
const canonical = (value: string): string => normalize(value).trim();
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const roles: [Kind, string][] = [['cli', 'cli|linha de comando|command.line'], ['driver', 'driver'], ['runtime', 'runtime'], ['sdk', 'sdk'], ['library', 'library|biblioteca'], ['service', 'service|servi[cç]o']];
const providerPattern = (provider: string): string => `(?<![\\p{L}\\p{N}_+#./-])${escape(provider)}(?![\\p{L}\\p{N}_+#/-]|\\.(?=[\\p{L}\\p{N}_]))`;

export function literalProviderMention(text: string, provider: string): RegExpMatchArray | null {
  return text.match(new RegExp(providerPattern(provider), 'iu'));
}

function mentions(text: string, provider: string): boolean {
  return literalProviderMention(text, provider) !== null;
}
function literalRoles(text: string, provider: string, hintedKind: Kind): { kind: Kind; quote: string }[] {
  const found: { kind: Kind; quote: string }[] = [];
  for (const mention of text.matchAll(new RegExp(providerPattern(provider), 'giu'))) {
    const index = mention.index, end = index + mention[0].length;
    for (const [kind, expression] of roles) {
      const before = new RegExp(`(?<![\\p{L}\\p{N}])(?:${expression})\\s+(?:(?:de|do|da|para|for|named|chamad[oa])\\s+)?$`, 'iu').exec(text.slice(0, index));
      const after = new RegExp(`^\\s+(?:(?:as|como|via|a|an?|um[ae]?)\\s+)?(?:${expression})(?![\\p{L}\\p{N}])`, 'iu').exec(text.slice(end));
      if (!before && !after) continue;
      const start = before?.index ?? index;
      const prefix = canonical(text.slice(0, start).split(/[.;!?\n]/).at(-1) ?? '');
      if (/\b(?:nao|not|never|without|sem|proibid\w*|forbidden|prohibited|don't)\b/u.test(prefix)) continue;
      const quoteEnd = after ? end + after[0].length : end;
      const tail = canonical(text.slice(quoteEnd));
      if (/^(?:(?:is|are|e|esta|fica|sao|should|must|deve|sera)\s+){0,3}(?:nao|not|proibid\w*|forbidden|prohibited)\b/u.test(tail)) continue;
      const quote = text.slice(start, quoteEnd);
      // A CLI/library/SDK produced in a language is not that language's provider role.
      if (!/\b(?:use|uses|using|usar|usem|usando|utilize|utilizar|via|invoke|invocar|install|instale|instalar|tool|ferramenta)\b/u.test(prefix)
        && !(hintedKind === kind && canonical(text).replace(/[.!]$/, '') === canonical(quote))) continue;
      if (!found.some(item => item.kind === kind)) found.push({ kind, quote });
    }
  }
  return found;
}
function technologyOnlyQuote(text: string, provider: string): boolean {
  const value = canonical(text);
  if (value === canonical(provider)) return true;
  if (new RegExp(`\\b(?:${roles.map(([, role]) => role).join('|')})\\b`, 'u').test(value)) return false;
  const pieces = value.split(/\n\s*[-*]?\s*|\s*[,;]\s*/).filter(Boolean);
  return pieces.length > 1 && pieces.every(piece => piece.length <= 120 && /^[\p{L}\p{N} .+#/()_-]+$/u.test(piece));
}

/** Classifications supplied by extraction are distinct from roles literally requested by the user. */
export function deriveBindingAuthority(requirement: Requirement, rawSource?: string, classificationOrigin: 'init' | 'legacy' = 'legacy'): BindingAuthority | undefined {
  const binding = requirement.binding;
  if (!binding || !mentions(requirement.source.text, binding.provider)) return undefined;
  const explicit = literalRoles(requirement.source.text, binding.provider, binding.kind);
  if (!explicit.length && rawSource) explicit.push(...literalRoles(rawSource, binding.provider, binding.kind));
  const matching = explicit.find(role => role.kind === binding.kind) ?? (explicit.length === 1 ? explicit[0] : undefined);
  const kind: BindingAuthority['kind'] = explicit.length
    ? { authority: 'literal', ...(matching ? { value: matching.kind, quote: matching.quote } : {}) }
    : classificationOrigin === 'init' || technologyOnlyQuote(requirement.source.text, binding.provider)
      ? { authority: 'inferred' }
      : { authority: 'legacy-conservative', value: binding.kind };
  const declaration = new RegExp(`\\b(?:cap|capability|capacidade)\\s*[:=]\\s*(["']?)${escape(binding.capability)}\\1(?![\\p{L}\\p{N}])`, 'iu').exec(requirement.source.text);
  return { schema: 'capivara/binding-authority/1', original: structuredClone(binding), provider: { authority: 'literal', quote: requirement.source.text }, kind, capability: declaration ? { authority: 'literal', quote: declaration[0] } : { authority: 'inferred' } };
}

export function annotateBindingAuthority(requirement: Requirement, rawSource?: string, classificationOrigin: 'init' | 'legacy' = 'legacy'): void {
  if (!requirement.binding || requirement.bindingAuthority) return;
  const authority = deriveBindingAuthority(requirement, rawSource, classificationOrigin);
  if (authority) requirement.bindingAuthority = authority;
}

export function obligationMatchesProvider(requirement: Requirement, identity: CapabilityIdentity | undefined): boolean {
  const binding = requirement.binding;
  if (!binding || !identity || canonical(binding.provider) !== canonical(identity.provider) || !mentions(requirement.source.text, binding.provider)) return false;
  const authority = requirement.bindingAuthority ?? deriveBindingAuthority(requirement)!;
  if (authority.kind.authority !== 'inferred' && (!authority.kind.value || authority.kind.value !== identity.kind)) return false;
  return authority.capability.authority !== 'literal' || canonical(binding.capability) === canonical(identity.capability);
}
export const matchesMandatoryProvider = obligationMatchesProvider;

/** A proof claims the role of its real provider; an inferred INIT label cannot turn a CLI into a driver. */
export function matchesOperationalClaim(requirement: Requirement, claim: CapabilityIdentity, identity: CapabilityIdentity | undefined): boolean {
  if (!identity || !obligationMatchesProvider(requirement, identity) || canonical(claim.provider) !== canonical(identity.provider) || claim.kind !== identity.kind) return false;
  const authority = requirement.bindingAuthority ?? deriveBindingAuthority(requirement)!;
  return authority.capability.authority !== 'literal' || canonical(claim.capability) === canonical(identity.capability);
}

/** Records an engineering interpretation only. This record is never execution evidence. */
export function recordBindingTransformation(requirement: Requirement, identity: CapabilityIdentity): BindingTransformation | undefined {
  if (!obligationMatchesProvider(requirement, identity)) return undefined;
  const authority = requirement.bindingAuthority ?? deriveBindingAuthority(requirement)!;
  const original = authority.original;
  if (original.kind === identity.kind && canonical(original.capability) === canonical(identity.capability)) return undefined;
  const transformation: BindingTransformation = { from: structuredClone(original), to: structuredClone(identity), reason: 'inferred-operational-role', source: { reference: requirement.source.reference, text: requirement.source.text } };
  const existing = requirement.bindingTransformations ??= [];
  if (!existing.some(value => JSON.stringify(value) === JSON.stringify(transformation))) existing.push(transformation);
  return transformation;
}
