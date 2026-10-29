import { expect, it } from 'vitest';
import { annotateBindingAuthority, deriveBindingAuthority, obligationMatchesProvider, matchesOperationalClaim, recordBindingTransformation } from '../../src/domain/bindings.js';
import type { CapabilityIdentity, Requirement } from '../../src/domain/types.js';

const binding: CapabilityIdentity = { provider: 'Fennel', kind: 'runtime', capability: 'programming language' };
const requirement = (text: string, identity = binding): Requirement => ({ id: 'technology', statement: 'Use the selected technology.', mode: 'shared', kind: 'stack', source: { kind: 'request', reference: 'request', text }, binding: structuredClone(identity) });

it('distinguishes a literal provider from an inferred INIT role without a technology catalogue', () => {
  const original = requirement('Fennel');
  annotateBindingAuthority(original, 'Use Fennel in the application.');
  const compiler: CapabilityIdentity = { provider: 'Fennel', kind: 'sdk', capability: 'compile the requested sources' };
  expect(original.bindingAuthority?.kind.authority).toBe('inferred');
  expect(obligationMatchesProvider(original, compiler)).toBe(true);
  expect(obligationMatchesProvider(original, { ...compiler, provider: 'Different language' })).toBe(false);
  expect(matchesOperationalClaim(original, compiler, compiler)).toBe(true);
  expect(matchesOperationalClaim(original, { ...compiler, kind: 'runtime' }, compiler)).toBe(false);
});

it('preserves an explicit CLI obligation even when extracted metadata called it a driver', () => {
  const original = requirement('Use CLI AcmeDB.', { provider: 'AcmeDB', kind: 'driver', capability: 'database' });
  annotateBindingAuthority(original, original.source.text);
  expect(original.binding).toEqual({ provider: 'AcmeDB', kind: 'driver', capability: 'database' });
  expect(original.bindingAuthority?.kind).toMatchObject({ authority: 'literal', value: 'cli' });
  expect(obligationMatchesProvider(original, { provider: 'AcmeDB', kind: 'driver', capability: 'database' })).toBe(false);
  expect(obligationMatchesProvider(original, { provider: 'AcmeDB', kind: 'cli', capability: 'database CLI' })).toBe(true);
});

it('keeps explicit legacy roles strict and ambiguous legacy context conservative', () => {
  const explicit = requirement('Fennel runtime');
  const ambiguous = requirement('Use Fennel according to the previously agreed deployment arrangement.');
  expect(deriveBindingAuthority(explicit)?.kind.authority).toBe('literal');
  expect(deriveBindingAuthority(ambiguous)?.kind.authority).toBe('legacy-conservative');
  annotateBindingAuthority(ambiguous, 'Use Fennel in the requested project.');
  expect(ambiguous.bindingAuthority?.kind.authority).toBe('legacy-conservative');
  for (const item of [explicit, ambiguous]) expect(obligationMatchesProvider(item, { ...binding, kind: 'sdk' })).toBe(false);
  expect(obligationMatchesProvider(requirement('Fennel'), { ...binding, kind: 'sdk' })).toBe(true);
});

it('grounds a fresh explicit role in the original source even when the model quoted only the provider', () => {
  const item = requirement('Fennel');
  annotateBindingAuthority(item, 'Use the CLI Fennel.');
  expect(obligationMatchesProvider(item, { ...binding, kind: 'runtime' })).toBe(false);
  expect(obligationMatchesProvider(item, { ...binding, kind: 'cli' })).toBe(true);
});

it('requires literal provider support and preserves explicitly declared capability identity', () => {
  const unsupported = requirement('Some unrelated product.');
  expect(obligationMatchesProvider(unsupported, binding)).toBe(false);
  const item = requirement('CLI AcmeDB; capability: database-console', { provider: 'AcmeDB', kind: 'cli', capability: 'database-console' });
  annotateBindingAuthority(item, item.source.text);
  expect(obligationMatchesProvider(item, { ...item.binding!, capability: 'other-command' })).toBe(false);
  expect(obligationMatchesProvider(item, item.binding)).toBe(true);
  const quoted = requirement('CLI AcmeDB; cap: "database-console"', item.binding!);
  annotateBindingAuthority(quoted, quoted.source.text);
  expect(obligationMatchesProvider(quoted, { ...quoted.binding!, capability: 'other-command' })).toBe(false);
});

it('records a compatible operational interpretation without changing original metadata or inventing a proof', () => {
  const item = requirement('Fennel');
  annotateBindingAuthority(item, 'Use Fennel.');
  const operational: CapabilityIdentity = { provider: 'Fennel', kind: 'sdk', capability: 'compiler' };
  recordBindingTransformation(item, operational); recordBindingTransformation(item, operational);
  expect(item.binding).toEqual(binding);
  expect(item.bindingAuthority?.original).toEqual(binding);
  expect(item.bindingTransformations).toHaveLength(1);
  expect(item.bindingTransformations?.[0]).toMatchObject({ from: binding, to: operational });
  expect(item.bindingTransformations?.[0]).not.toHaveProperty('evidence');
});

it('does not enlarge literal technology names at punctuation boundaries', () => {
  expect(obligationMatchesProvider(requirement('C++', { ...binding, provider: 'C' }), { ...binding, provider: 'C' })).toBe(false);
  expect(obligationMatchesProvider(requirement('Node.js', { ...binding, provider: 'Node' }), { ...binding, provider: 'Node' })).toBe(false);
  expect(obligationMatchesProvider(requirement('C++', { ...binding, provider: 'C++' }), { ...binding, provider: 'C++' })).toBe(true);
});

it('does not turn a separately prohibited role into a mandatory role', () => {
  const item = requirement('AcmeDB', { ...binding, provider: 'AcmeDB' });
  annotateBindingAuthority(item, 'Use AcmeDB; não use a CLI AcmeDB.');
  expect(item.bindingAuthority?.kind.authority).toBe('inferred');
  expect(obligationMatchesProvider(item, { provider: 'AcmeDB', kind: 'library', capability: 'database library' })).toBe(true);
  const positive = requirement('AcmeDB', { ...binding, provider: 'AcmeDB' });
  const raw = 'Do not use the runtime AcmeDB. Use AcmeDB como biblioteca.';
  annotateBindingAuthority(positive, raw);
  expect(positive.bindingAuthority?.kind).toMatchObject({ authority: 'literal', value: 'library' });
  expect(raw.includes(positive.bindingAuthority!.kind.quote!)).toBe(true);
  const postfix = requirement('AcmeDB', { ...binding, provider: 'AcmeDB' });
  annotateBindingAuthority(postfix, 'Use AcmeDB. A CLI AcmeDB está proibida.');
  expect(postfix.bindingAuthority?.kind.authority).toBe('inferred');
});

it('declines an ambiguous literal role instead of guessing from unrelated source metadata', () => {
  const item = requirement('Use CLI Fennel and biblioteca Fennel.');
  annotateBindingAuthority(item, item.source.text);
  expect(item.bindingAuthority?.kind).toMatchObject({ authority: 'literal' });
  expect(item.bindingAuthority?.kind.value).toBeUndefined();
  expect(obligationMatchesProvider(item, binding)).toBe(false);
});

it('separates a product CLI from a command-line provider without using language names as a catalogue', () => {
  for (const provider of ['Node.js', 'Python', 'Fennel']) {
    const runtime: CapabilityIdentity = { provider, kind: 'runtime', capability: 'language runtime' };
    for (const source of [`The documented ${provider} CLI prints the sum 7.`, `Create a ${provider} CLI that prints 7.`, `Create a ${provider} library that exports a client.`, `Create a ${provider} SDK for clients.`]) {
      const item = requirement(source, runtime);
      expect(obligationMatchesProvider(item, runtime)).toBe(true);
      annotateBindingAuthority(item, source, 'init');
      expect(item.bindingAuthority?.kind.authority).toBe('inferred');
      expect(obligationMatchesProvider(item, runtime)).toBe(true);
    }
  }
  for (const source of ['Use SQLite CLI.', 'Use CLI SQLite.']) {
    const item = requirement(source, { provider: 'SQLite', kind: 'driver', capability: 'database' });
    annotateBindingAuthority(item, source, 'init');
    expect(obligationMatchesProvider(item, { provider: 'SQLite', kind: 'driver', capability: 'database' })).toBe(false);
    expect(obligationMatchesProvider(item, { provider: 'SQLite', kind: 'cli', capability: 'database' })).toBe(true);
  }
  const isolated = requirement('SQLite CLI', { provider: 'SQLite', kind: 'cli', capability: 'database' });
  expect(obligationMatchesProvider(isolated, { provider: 'SQLite', kind: 'driver', capability: 'database' })).toBe(false);
});
