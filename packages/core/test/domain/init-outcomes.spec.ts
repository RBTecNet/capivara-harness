import { expect, it } from 'vitest';
import { runInit } from '../../src/domain/init.js';
import { identity, normalize } from '../../src/domain/authority.js';
import type { CapabilityIdentity, DomainAgentRequest, Requirement } from '../../src/domain/types.js';

const quote = 'FooDB\n- Automated testing\n- Logging\n- Accessibility';
const statement = 'Use FooDB and provide automated testing, logging and accessibility.';
const request = `Create a CLI application. Required stack and capabilities:\n- ${quote}`;
const binding: CapabilityIdentity = { capability: 'storage', kind: 'library', provider: 'FooDB' };
const outcomes = [
  { quote: 'Automated testing', statement: 'Execute automated tests against real behavior.' },
  { quote: 'Logging', statement: 'Expose observable execution logs.' },
  { quote: 'Accessibility', statement: 'Provide accessible interaction.' },
];
const discovery = { requirements: [{ statement, quote, kind: 'stack' }], questions: [] };

it('preserves a named provider and each mixed-list outcome without inventing tools', async () => {
  const calls: DomainAgentRequest[] = [];
  const agent = async (call: DomainAgentRequest): Promise<string> => {
    calls.push(call);
    return JSON.stringify(call.operation === 'discover' ? discovery : { requirements: [{ index: 0, quote, bindings: [binding], outcomes }] });
  };
  const brief = await runInit({ request, agent });
  expect(brief.status).toBe('ready');
  expect(brief.requirements.flatMap(requirement => requirement.binding ? [requirement.binding.provider] : [])).toEqual(['FooDB']);
  expect(brief.requirements.find(requirement => requirement.statement === statement)).toMatchObject({ source: { text: quote }, binding, technicalClassification: { schema: 'capivara/technical-choices/1' } });
  for (const outcome of outcomes) expect(brief.requirements.find(requirement => requirement.statement === outcome.statement)).toMatchObject({ kind: 'behavior', source: { text: outcome.quote } });
  expect(brief.requirements.filter(requirement => outcomes.some(outcome => outcome.statement === requirement.statement)).every(requirement => !requirement.binding)).toBe(true);
  expect(brief.requirements.every(requirement => request.includes(requirement.source.text))).toBe(true);
  const repeated = await runInit({ request, agent, existing: brief });
  expect(repeated).toEqual(brief); expect(calls.map(call => call.operation)).toEqual(['discover', 'repair']);
});

it('preserves distinct outcomes sharing one literal source and deduplicates only the identical result', async () => {
  const source = 'Automated tests cover API and persistence.';
  const text = `Create a CLI application. ${source}`;
  const goal = 'Tests must cover the API and persisted data.';
  const results = [{ quote: source, statement: 'Verify the real API behavior.' }, { quote: source, statement: 'Verify actual data persistence.' }];
  const calls: DomainAgentRequest[] = [];
  const agent = async (call: DomainAgentRequest): Promise<string> => {
    calls.push(call);
    return JSON.stringify(call.operation === 'discover'
      ? { requirements: [{ statement: goal, quote: source, kind: 'stack' }], questions: [] }
      : { requirements: [{ index: 0, quote: source, bindings: [], outcomes: [results[0], results[1], results[0]] }] });
  };
  const brief = await runInit({ request: text, agent });
  const outcomes = brief.requirements.filter(requirement => results.some(result => result.statement === requirement.statement));
  expect(outcomes.map(requirement => requirement.statement).sort()).toEqual(results.map(result => result.statement).sort());
  expect(new Set(outcomes.map(requirement => requirement.id)).size).toBe(2);
  expect(brief.requirements.find(requirement => requirement.statement === goal)?.technicalClassification?.outcomes.map(outcome => outcome.requirementId).sort()).toEqual(outcomes.map(requirement => requirement.id).sort());
  expect(await runInit({ request: text, agent, existing: brief })).toEqual(brief);
  expect(calls.map(call => call.operation)).toEqual(['discover', 'repair']);
});

it('recovers malformed outcome metadata and rejects citation shortening that omits original obligations', async () => {
  let repairs = 0;
  const brief = await runInit({ request, agent: async call => {
    if (call.operation === 'discover') return JSON.stringify(discovery);
    repairs++;
    return JSON.stringify({ requirements: [{ index: 0, quote: repairs < 3 ? 'FooDB' : quote, bindings: [binding], outcomes: repairs === 1 ? { quote: 'Automated testing', statement: outcomes[0]!.statement } : repairs === 2 ? outcomes.slice(0, 1) : outcomes }] });
  } });
  expect(repairs).toBe(3);
  expect(brief.requirements.find(requirement => requirement.statement === statement)?.source.text).toBe(quote);
  expect(brief.requirements).toHaveLength(4);
});

it('does not demote an original explicit provider during metadata recovery', async () => {
  let repairs = 0;
  const brief = await runInit({ request, agent: async call => {
    if (call.operation === 'discover') return JSON.stringify({ requirements: [{ statement, quote, kind: 'stack', binding }], questions: [] });
    repairs++;
    return JSON.stringify({ requirements: [{ index: 0, quote, bindings: repairs === 1 ? [] : [binding], outcomes: repairs === 1 ? [{ quote: 'FooDB', statement: 'Use FooDB.' }, ...outcomes] : outcomes }] });
  } });
  expect(repairs).toBe(2);
  expect(brief.requirements.flatMap(requirement => requirement.binding ? [requirement.binding] : [])).toEqual([binding]);
});

it('reclassifies only generated legacy choices, retains outcome identity and stops replaying on the next resume', async () => {
  const base = await runInit({ request: 'Create a CLI application. Use FooDB.', agent: async () => JSON.stringify({ requirements: [{ statement: 'Use FooDB.', quote: 'FooDB', kind: 'stack', binding }], questions: [] }) });
  const parent: Requirement = { id: identity('req', `request:${normalize(statement)}`), statement, source: { kind: 'request', reference: 'request', text: quote }, mode: 'shared', kind: 'stack', binding };
  const fake: CapabilityIdentity = { capability: 'Automated testing', kind: 'cli', provider: 'Automated testing' };
  const fakeId = identity('req', `request:${normalize(statement)}:${JSON.stringify(fake)}`);
  const child: Requirement = { id: fakeId, statement: `${fake.provider}: ${fake.capability} (${fake.kind}).`, source: { kind: 'request', reference: 'request', text: 'Automated testing' }, mode: 'shared', kind: 'stack', binding: fake };
  const logging: CapabilityIdentity = { capability: 'Logging', kind: 'cli', provider: 'Logging' };
  const accessibility: CapabilityIdentity = { capability: 'Accessibility', kind: 'library', provider: 'Accessibility' };
  const generated = [logging, accessibility].map((choice): Requirement => ({ id: identity('req', `request:${normalize(statement)}:${JSON.stringify(choice)}`), statement: `${choice.provider}: ${choice.capability} (${choice.kind}).`, source: { kind: 'request', reference: 'request', text: choice.provider }, mode: 'shared', kind: 'stack', binding: choice }));
  const independent: Requirement = { id: 'real-foo-db-feature', statement: 'The independent export also uses FooDB.', source: { kind: 'request', reference: 'request', text: 'FooDB' }, mode: 'shared', kind: 'stack', binding };
  const legacy = { ...base, id: identity('product', request), request, requirements: [child, ...generated, parent, independent] };
  let calls = 0;
  const agent = async (call: DomainAgentRequest): Promise<string> => {
    calls++; expect(call.operation).toBe('repair');
    return JSON.stringify({ requirements: [{ index: 0, quote, bindings: [binding], outcomes }] });
  };
  const brief = await runInit({ request, agent, existing: legacy });
  expect(calls).toBe(1);
  expect(brief.requirements.find(requirement => requirement.id === fakeId)).toMatchObject({ statement: outcomes[0]!.statement, kind: 'behavior' });
  expect(brief.requirements.find(requirement => requirement.id === fakeId)?.binding).toBeUndefined();
  expect(brief.requirements.find(requirement => requirement.id === parent.id)).toMatchObject({ statement, source: parent.source, technicalClassification: { previous: expect.arrayContaining([expect.objectContaining({ requirementId: fakeId, binding: fake })]) } });
  expect(brief.requirements.find(requirement => requirement.id === independent.id)).toEqual(expect.objectContaining(independent));
  const resumed = await runInit({ request, agent, existing: brief });
  expect(resumed).toEqual(brief); expect(calls).toBe(1);
});

it('refuses to demote a named legacy provider while reclassifying its generated outcome', async () => {
  const source = 'FooDB\n- Automated testing';
  const text = `Create a CLI application. Required stack:\n- ${source}`;
  const goal = 'Use FooDB and execute automated tests.';
  const brief = await runInit({ request: text, agent: async call => JSON.stringify(call.operation === 'discover'
    ? { requirements: [{ statement: goal, quote: source, kind: 'stack', binding }], questions: [] }
    : { requirements: [{ index: 0, quote: source, bindings: [binding], outcomes: [outcomes[0]] }] }) });
  const parent = brief.requirements.find(requirement => requirement.statement === goal)!;
  delete parent.technicalClassification;
  const fake: CapabilityIdentity = { capability: 'Automated testing', kind: 'cli', provider: 'Automated testing' };
  const fakeId = identity('req', `request:${normalize(goal)}:${JSON.stringify(fake)}`);
  brief.requirements = [parent, { id: fakeId, statement: `${fake.provider}: ${fake.capability} (${fake.kind}).`, source: { kind: 'request', reference: 'request', text: 'Automated testing' }, mode: 'shared', kind: 'stack', binding: fake }];
  let calls = 0;
  const agent = async (): Promise<string> => {
    calls++;
    return JSON.stringify({ requirements: [{ index: 0, quote: source, bindings: calls === 1 ? [] : [binding], outcomes: calls === 1 ? [{ quote: 'FooDB', statement: 'Use FooDB.' }, outcomes[0]] : [outcomes[0]] }] });
  };
  const result = await runInit({ request: text, existing: brief, agent });
  expect(calls).toBe(2);
  expect(result.requirements.find(requirement => requirement.id === parent.id)).toMatchObject({ binding });
  expect(result.requirements.find(requirement => requirement.id === fakeId)).toMatchObject({ kind: 'behavior', statement: outcomes[0]!.statement });
  expect(result.requirements.find(requirement => requirement.id === fakeId)?.binding).toBeUndefined();
  expect(await runInit({ request: text, existing: result, agent })).toEqual(result);
  expect(calls).toBe(2);
});

it('allows an unfamiliar provider to be affirmed despite a matching capability label', async () => {
  const sameName: CapabilityIdentity = { capability: 'FooDB', kind: 'library', provider: 'FooDB' };
  const seen: string[] = [];
  const result = await runInit({ request: 'Create a CLI application. Use FooDB.', agent: async call => {
    seen.push(call.operation);
    return JSON.stringify(call.operation === 'discover'
      ? { requirements: [{ statement: 'Use FooDB.', quote: 'FooDB', kind: 'stack', binding: sameName }], questions: [] }
      : { requirements: [{ index: 0, quote: 'FooDB', bindings: [sameName], outcomes: [] }] });
  } });
  expect(result.requirements[0]!.binding).toEqual(sameName);
  expect(result.requirements[0]!.technicalClassification?.providers).toEqual([{ quote: 'FooDB', binding: sameName }]);
  expect(seen).toEqual(['discover', 'repair']);
});

it('preserves a generated technology identity when reclassification corrects its inferred operational role', async () => {
  const source = 'FooDB\n- WidgetsSDK\n- Automated testing';
  const text = `Create a CLI application. Required stack:\n- ${source}`;
  const goal = 'Use FooDB and WidgetsSDK, and execute automated tests.';
  const brief = await runInit({ request: text, agent: async call => JSON.stringify(call.operation === 'discover'
    ? { requirements: [{ statement: goal, quote: source, kind: 'stack' }], questions: [] }
    : { requirements: [{ index: 0, quote: source, bindings: [binding, { capability: 'compiler', kind: 'sdk', provider: 'WidgetsSDK' }], outcomes: [outcomes[0]] }] }) });
  const parent = brief.requirements.find(requirement => requirement.statement === goal)!;
  const inferred: CapabilityIdentity = { capability: 'programming language', kind: 'runtime', provider: 'WidgetsSDK' };
  const child: Requirement = { id: identity('req', `request:${normalize(goal)}:${JSON.stringify(inferred)}`), statement: `${inferred.provider}: ${inferred.capability} (${inferred.kind}).`, source: { kind: 'request', reference: 'request', text: 'WidgetsSDK' }, mode: 'shared', kind: 'stack', binding: inferred };
  const fake: CapabilityIdentity = { capability: 'Automated testing', kind: 'cli', provider: 'Automated testing' };
  const fakeChild: Requirement = { id: identity('req', `request:${normalize(goal)}:${JSON.stringify(fake)}`), statement: `${fake.provider}: ${fake.capability} (${fake.kind}).`, source: { kind: 'request', reference: 'request', text: 'Automated testing' }, mode: 'shared', kind: 'stack', binding: fake };
  delete parent.technicalClassification;
  brief.requirements = [parent, child, fakeChild];
  const result = await runInit({ request: text, existing: brief, agent: async () => JSON.stringify({ requirements: [{ index: 0, quote: source, bindings: [binding, { capability: 'compiler', kind: 'sdk', provider: 'WidgetsSDK' }], outcomes: [outcomes[0]] }] }) });
  expect(result.requirements.find(requirement => requirement.id === child.id)).toMatchObject({ binding: { provider: 'WidgetsSDK', kind: 'sdk' } });
  expect(result.requirementAliases?.[child.id]).toBeUndefined();
  expect(result.requirements.find(requirement => requirement.id === parent.id)?.technicalClassification?.previous).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: child.id, binding: inferred })]));
});

it('keeps a delivered SQL CLI as behavior while preserving the selected database library', async () => {
  const text = 'Use QuokkaDB\n- Deliver a SQL CLI';
  const result = await runInit({ request: `Create a CLI application. ${text}`, agent: async call => JSON.stringify(call.operation === 'discover'
    ? { requirements: [{ statement: 'Use QuokkaDB and deliver a SQL CLI.', quote: text, kind: 'stack' }], questions: [] }
    : { requirements: [{ index: 0, quote: text, bindings: [{ capability: 'embedded-store', kind: 'library', provider: 'QuokkaDB' }], outcomes: [{ quote: 'Deliver a SQL CLI', statement: 'The delivered CLI executes SQL.' }] }] }) });
  expect(result.requirements.find(requirement => requirement.binding)?.binding).toMatchObject({ provider: 'QuokkaDB', kind: 'library' });
  expect(result.requirements.find(requirement => requirement.statement === 'The delivered CLI executes SQL.')).toMatchObject({ kind: 'behavior' });
  expect(result.requirements.flatMap(requirement => requirement.binding ? [requirement.binding.provider] : [])).toEqual(['QuokkaDB']);
});
