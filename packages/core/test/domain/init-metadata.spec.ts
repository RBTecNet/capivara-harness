import { expect, it } from 'vitest';
import { runInit } from '../../src/domain/init.js';
import { identity, normalize } from '../../src/domain/authority.js';
import type { CapabilityIdentity, DomainAgentRequest } from '../../src/domain/types.js';

it('recovers only technical metadata for different interfaces while preserving the composite source and every choice', async () => {
  for (const fixture of [
    { request: 'Crie uma aplicação TUI. Stack: Python e Textual.', quote: 'Python e Textual', mode: 'tui', bindings: [{ capability: 'runtime', kind: 'runtime', provider: 'Python' }, { capability: 'terminal-ui', kind: 'library', provider: 'Textual' }] },
    { request: 'Crie uma aplicação desktop. Stack: Rust e Slint.', quote: 'Rust e Slint', mode: 'desktop', bindings: [{ capability: 'compiler', kind: 'sdk', provider: 'Rust' }, { capability: 'native-ui', kind: 'library', provider: 'Slint' }] },
  ]) {
    const calls: DomainAgentRequest[] = [], statement = `Usar ${fixture.quote}.`;
    const options = { request: fixture.request, agent: async (call: DomainAgentRequest) => {
      calls.push(call);
      return JSON.stringify(call.operation === 'discover' ? { requirements: [{ statement, quote: fixture.quote, kind: 'stack', mode: 'shared' }], questions: [] } : { requirements: [{ index: 0, quote: fixture.quote, bindings: fixture.bindings }] });
    }, ask: async () => { throw new Error('No product fact is missing.'); } };
    const result = await runInit(options);
    expect(result.status).toBe('ready'); expect(result.modes).toContain(fixture.mode);
    expect(result.requirements.some(requirement => requirement.statement === statement)).toBe(true);
    expect(result.requirements.flatMap(requirement => requirement.binding ? [requirement.binding.provider] : []).sort()).toEqual(fixture.bindings.map(binding => binding.provider).sort());
    expect(result.requirements.every(requirement => fixture.request.includes(requirement.source.text))).toBe(true);
    expect(calls.map(call => call.operation)).toEqual(['discover', 'repair']);
    await runInit({ ...options, existing: result });
    expect(calls).toHaveLength(2);
  }
});

it('rejects a shortened repair citation and runtime-only binding for the original complete stack', async () => {
  const quote = 'Node.js\n- TypeScript\n- React\n- Vite\n- SQLite em arquivo';
  const request = `Crie uma aplicação web.\nStack:\n- ${quote}`;
  const bindings: CapabilityIdentity[] = [
    { capability: 'runtime', kind: 'runtime', provider: 'Node.js' },
    { capability: 'compiler', kind: 'sdk', provider: 'TypeScript' },
    { capability: 'ui-library', kind: 'library', provider: 'React' },
    { capability: 'build-tool', kind: 'sdk', provider: 'Vite' },
    { capability: 'embedded-database', kind: 'library', provider: 'SQLite' },
  ];
  let repairs = 0;
  const result = await runInit({ request, agent: async call => {
    if (call.operation === 'discover') return JSON.stringify({ requirements: [{ statement: 'Usar Node.js, TypeScript, React, Vite e SQLite em arquivo.', quote, kind: 'stack' }], questions: [] });
    repairs++;
    return JSON.stringify({ requirements: [{ index: 0, quote: repairs === 1 ? 'Node.js' : quote, bindings: repairs === 1 ? bindings.slice(0, 1) : bindings }] });
  } });
  expect(repairs).toBe(2); expect(result.requirements).toHaveLength(5);
  expect(result.requirements.flatMap(requirement => requirement.binding ? [requirement.binding.provider] : []).sort()).toEqual(bindings.map(binding => binding.provider).sort());
  expect(result.requirements.find(requirement => requirement.statement.startsWith('Usar Node.js,'))?.source.text).toBe(quote);
});

it('does not accept a provider substring as authority or silently discard an unsupported extraction', async () => {
  const request = 'Crie uma API REST usando Django. Registre clientes.';
  let repairs = 0;
  const rejected: string[] = [];
  const result = await runInit({ request, onEvent: event => { if (event.type === 'requirement-rejected') rejected.push(event.message); }, agent: async call => {
    if (call.operation === 'discover') return JSON.stringify({ requirements: [
      { statement: 'Usar Django.', quote: 'Django', kind: 'stack', binding: { capability: 'runtime', kind: 'runtime', provider: 'Go' } },
      { statement: 'Registrar clientes.', quote: 'Registre clientes.', kind: 'behavior' },
      { statement: 'Exportar folha de pagamento.', quote: 'Esta regra não existe.', kind: 'behavior' },
    ], questions: [] });
    repairs++;
    return JSON.stringify({ requirements: [
      { index: 0, quote: 'Django', bindings: [{ capability: 'web-framework', kind: 'library', provider: 'Django' }] },
      { index: 2, unsupported: true, reason: 'A fonte não solicita folha de pagamento.' },
    ] });
  } });
  expect(repairs).toBe(1); expect(result.requirements.map(requirement => requirement.statement)).toEqual(['Usar Django.', 'Registrar clientes.']);
  expect(result.requirements[0]!.binding?.provider).toBe('Django');
  expect(rejected).toHaveLength(1); expect(rejected[0]).toContain('folha de pagamento');
});

it('consolidates repeated provider/kind roles without creating another technology requirement', async () => {
  const quote = 'Node.js\n- TypeScript\n- React\n- Vite\n- Backend Node.js com API REST\n- SQLite em arquivo';
  const request = `Crie uma aplicação web.\nStack:\n- ${quote}`;
  const statement = 'Usar Node.js, TypeScript, React, Vite e SQLite em arquivo.';
  const bindings = [
    { capability: 'JavaScript runtime', kind: 'runtime', provider: 'Node.js' },
    { capability: 'Programming language', kind: 'runtime', provider: 'TypeScript' },
    { capability: 'UI library', kind: 'library', provider: 'React' },
    { capability: 'Frontend build tool', kind: 'cli', provider: 'Vite' },
    { capability: 'Backend runtime with REST API', kind: 'runtime', provider: 'Node.js' },
    { capability: 'File-based database', kind: 'driver', provider: 'SQLite' },
  ];
  const events: string[] = [];
  const result = await runInit({ request, onEvent: event => { if (event.type === 'binding-reconciled') events.push(event.message); }, agent: async call => JSON.stringify(call.operation === 'discover' ? { requirements: [{ statement, quote, kind: 'stack' }], questions: [] } : { requirements: [{ index: 0, quote, bindings }] }) });
  expect(result.requirements).toHaveLength(5);
  expect(result.requirements.filter(requirement => requirement.binding?.provider === 'Node.js')).toHaveLength(1);
  expect(result.requirements.find(requirement => requirement.statement === statement)).toMatchObject({ source: { text: quote }, binding: bindings[0] });
  expect(result.requirements.find(requirement => requirement.binding?.provider === 'TypeScript')!.binding?.kind).toBe('runtime');
  expect(events).toHaveLength(1); expect(events[0]).toContain('Backend runtime with REST API');
});

it('repairs an existing ready brief only for provably generated duplicate children without replaying discovery', async () => {
  const stack = 'Python e Textual', statement = 'Usar Python e Textual.';
  const genuine = 'O serviço de relatórios também usa Python.';
  const request = `Crie uma aplicação TUI. Stack: ${stack}. ${genuine}`;
  const result = await runInit({ request, agent: async call => JSON.stringify(call.operation === 'discover' ? { requirements: [{ statement, quote: stack, kind: 'stack' }], questions: [] } : { requirements: [{ index: 0, quote: stack, bindings: [{ capability: 'Application runtime', kind: 'runtime', provider: 'Python' }, { capability: 'Terminal UI', kind: 'library', provider: 'Textual' }] }] }) });
  const parent = result.requirements.find(requirement => requirement.statement === statement)!;
  const duplicate: CapabilityIdentity = { capability: 'Report service runtime', kind: 'runtime', provider: 'Python' };
  const duplicateId = identity('req', `${parent.source.reference}:${normalize(parent.statement)}:${JSON.stringify(duplicate)}`);
  result.requirements.unshift({ id: duplicateId, statement: `${duplicate.provider}: ${duplicate.capability} (${duplicate.kind}).`, source: structuredClone(parent.source), mode: 'shared', kind: 'stack', binding: duplicate });
  const genuineId = identity('req', `request:${normalize(genuine)}`);
  result.requirements.push({ id: genuineId, statement: genuine, source: { kind: 'request', reference: 'request', text: genuine }, mode: 'shared', kind: 'stack', binding: duplicate });
  const parentBefore = structuredClone(parent), revisions = result.revision;
  let calls = 0;
  const options = { request, existing: result, agent: async () => { calls++; throw new Error('A ready generated duplicate needs no inference.'); } };
  const repaired = await runInit(options);
  expect(calls).toBe(0); expect(repaired.requirements).toHaveLength(3);
  expect(repaired.requirements.find(requirement => requirement.id === parent.id)).toEqual(parentBefore);
  expect(repaired.requirements.some(requirement => requirement.id === genuineId)).toBe(true);
  expect(repaired.requirementAliases).toEqual({ [duplicateId]: parent.id });
  expect(repaired.revision).toBe(revisions + 1);
  const again = await runInit({ ...options, existing: repaired });
  expect(again).toEqual(repaired); expect(calls).toBe(0);
});
