import { describe, expect, it } from 'vitest';
import { DashboardModel } from '../../src/dashboard/model.js';
import type { SavedProject } from '../../src/app/store.js';
import type { DevelopmentPlan, ProductBrief } from '../../src/domain/types.js';
import type { BuildState } from '../../src/execution/types.js';
import { createDashboardNavigation, navigateDashboard } from '../../src/dashboard/navigation.js';
import { getPanelScrollLimit, renderDashboard } from '../../src/dashboard/screen.js';

const brief: ProductBrief = {
  schema: 'capivara/product/1', status: 'ready', id: 'brief', revision: 1,
  name: 'Produto privado', summary: 'Descrição integral\nSegunda linha', request: 'Pedido integral', modes: ['cli'], targets: ['linux'], requirements: [], constraints: [], decisions: [], gaps: [],
};
const plan: DevelopmentPlan = {
  schema: 'capivara/plan/1', status: 'ready', revision: 1, briefId: 'brief', briefRevision: 1, contracts: [],
  environment: ['runtime', 'tool'].map(id => ({ id, name: id, kind: 'tool', dependsOn: [], targets: ['linux'], reason: `Motivo ${id}`, check: { command: `${id} --version` }, prepare: [] })),
  tasks: ['one', 'two'].map(id => ({ id, title: id, goal: `Objetivo ${id}`, instructions: `Instruções ${id}\nTexto que precisa permanecer integral`, requirementIds: [], dependsOn: [], environmentIds: [], contractIds: [], files: [], criteria: ['Comportamento verificável'], checks: [{ id: 'check', kind: 'command', requirementIds: [], requiredCapabilities: [] }], risk: 'normal', blockedBy: [] })),
};
function saved(): SavedProject {
  const state: BuildState = {
    schema: 'capivara/build/1', planRevision: 1, updatedAt: '2026-10-28T10:00:00Z',
    tasks: { one: { status: 'complete', revision: '1', attempts: 1, changedFiles: ['src/main.ts'], findings: [], strategy: 'Concluída' }, two: { status: 'reviewing', revision: '1', attempts: 2, changedFiles: [], findings: [], strategy: 'Revisar' } },
    environment: { runtime: { inputHash: 'runtime', ready: true } }, incidents: [],
    evidence: [{ id: 'ev1', taskId: 'one', checkId: 'check', inputHash: '1', passed: true, command: 'check one', output: 'Saída completa', terminal: false, checkedAt: '2026-10-28T10:00:00Z' }],
  };
  return { brief, plan, execution: state, status: 'working', stage: 'build' };
}

describe('projeção do dashboard', () => {
  it('mostra trabalho interno real no log e distingue checkpoint de processo ativo', () => {
    const initial = saved(), model = new DashboardModel(initial);
    model.updateRuntime({ pid: 123, alive: false, lastEventAt: '2026-10-28T10:00:00Z' });
    expect(model.snapshot().status).toBe('inactive');
    expect(model.panel('summary').lines[0]).toContain('Sem execução ativa');
    expect(initial.status).toBe('working');
    model.updateRuntime({ pid: 456, alive: true });
    const operation = { id: 'operation:run:1', label: 'Conferindo fontes e hashes', status: 'running' as const, startedAt: '2026-10-28T10:01:00Z', stage: 'build' };
    model.observe({ type: 'progress', progress: operation });
    expect(model.snapshot().status).toBe('working');
    expect(model.panel('log').progress).toContainEqual(operation);
    model.observe({ type: 'progress', progress: { ...operation, status: 'complete' } });
    expect(model.panel('log').progress).toHaveLength(0);
    model.observe({ type: 'progress', progress: operation });
    model.observe({ type: 'execution.start' });
    expect(model.panel('log').progress).toHaveLength(0);
  });

  it('mantém devoluções até a nova execução do mesmo passo e só inclui G4 quando há fluxo', () => {
    const initial = structuredClone(saved());
    initial.plan!.tasks[1]!.checks.push({ id: 'screen', kind: 'tui', requirementIds: [], requiredCapabilities: [] });
    const model = new DashboardModel(initial);
    const rows = () => model.panel('progress').phases!.flatMap(phase => phase.threads);
    const gate = () => rows()[1]!.gates.find(item => item.id === 'G3')!;
    expect(rows()[0]!.gates.map(item => item.id)).toEqual(['G0', 'G1', 'G2', 'G3']);
    expect(rows()[0]!.gates.find(item => item.id === 'G2')?.status).toBe('complete');
    expect(rows()[1]!.gates.find(item => item.id === 'G4')?.status).toBe('pending');
    const measure = { taskId: 'two', gate: 'G3' as const, attempt: 2, planRevision: 1 };
    model.observe({ type: 'gate', body: JSON.stringify({ gate: { ...measure, status: 'returned', detail: 'Corrigir a saída observada.' } }) });
    model.observe({ type: 'gate', gate: { ...measure, status: 'pending' } });
    expect(gate()).toMatchObject({ status: 'returned', detail: 'Corrigir a saída observada.' });
    model.observe({ type: 'gate', gate: { ...measure, status: 'running' } });
    expect(gate().status).toBe('running');
    model.observe({ type: 'gate', gate: { ...measure, status: 'complete' } });
    model.observe({ type: 'gate', gate: { ...measure, attempt: 1, status: 'returned' } });
    expect(gate().status).toBe('complete');
    (initial.execution as BuildState).tasks.two!.attempts = 3;
    model.updateProject(initial);
    expect(gate().status).toBe('pending');
    model.updateProject({ ...initial, plan: { ...initial.plan!, revision: 2 } });
    model.observe({ type: 'gate', gate: { ...measure, status: 'returned' } });
    expect(gate().status).toBe('running');
  });

  it('projeta contagens confirmadas e mantém o conteúdo integral dos painéis', () => {
    const model = new DashboardModel(saved());
    const view = model.snapshot();
    expect(view.progress.find(item => item.id === 'tasks')).toMatchObject({ completed: 1, total: 2, status: 'running' });
    expect(view.progress.find(item => item.id === 'environment')).toMatchObject({ completed: 1, total: 2 });
    expect(view.progress.find(item => item.id === 'verification')).toMatchObject({ completed: 1, total: 2 });
    expect(model.panel('phases').lines.join('\n')).toContain('Instruções two\nTexto que precisa permanecer integral');
    expect(model.panel('summary').lines.join('\n')).toContain('Descrição integral\nSegunda linha');
    expect(view.usage.costUsd).toBeUndefined();
    expect(new DashboardModel().snapshot().progress[0]).toEqual({ id: 'brief', label: 'Descoberta do produto', status: 'waiting', stage: 'init' });
  });

  it('preserva logs e progresso sem limite de linhas ou percentual inventado', () => {
    const model = new DashboardModel();
    const output = Array.from({ length: 1300 }, (_, index) => `Linha ${index}: ${'conteúdo '.repeat(20)}`).join('\n');
    model.observe({ type: 'output', message: output });
    model.observe({ type: 'progress', progress: { id: 'source', label: 'Lendo fonte', completed: 800, status: 'running', unit: 'caracteres' } });
    expect(model.panel('log').lines.join('\n')).toContain(output);
    expect(model.snapshot().progress.find(item => item.id === 'source')).toEqual({ id: 'source', label: 'Lendo fonte', completed: 800, status: 'running', unit: 'caracteres' });
    expect(model.panel('log').lines.join('\n')).toContain('"completed": 800');
    const next = saved();
    model.observe({ type: 'progress', progress: { id: 'tasks', label: 'Unidades', completed: 2, total: 2, status: 'complete' } });
    model.updateProject(next);
    expect(model.snapshot().progress.find(item => item.id === 'tasks')).toMatchObject({ completed: 1, total: 2 });
  });

  it('hidrata uso reportado sem inventar custo e expõe questão pendente completa', () => {
    const model = new DashboardModel();
    model.observe({ type: 'agent.result', body: JSON.stringify({ id: 'call1', role: 'builder', usage: { inputTokens: 100, outputTokens: 20 } }) });
    model.observe({ type: 'agent.result', detail: { id: 'call1', usage: { inputTokens: 100, outputTokens: 20 } } });
    expect(model.snapshot().usage).toEqual({ calls: 1, currentTokens: 120, inputTokens: 100, outputTokens: 20 });
    model.observe({ type: 'agent.result', detail: { id: 'call2', usage: { inputTokens: 200, outputTokens: 10, costUsd: 0.003 } } });
    expect(model.snapshot().usage).toMatchObject({ calls: 2, currentTokens: 210, inputTokens: 300, outputTokens: 30, costUsd: 0.003 });
    const question = { id: 'question', fact: 'Formato', question: 'Qual formato?', reason: 'Interoperabilidade', impact: 'Exportação', category: 'data' as const, modes: ['cli' as const], options: ['JSON', 'CSV'], blocks: ['two'] };
    model.updateProject({ status: 'waiting', pendingQuestion: question });
    expect(model.snapshot()).toMatchObject({ pendingDecisions: 1, pendingQuestion: question });
    expect(model.panel('summary').lines).toContain('Qual formato?');
  });

  it('mostra uma linha por unidade no resumo, permite chegar à última e conserva o texto integral', () => {
    const tasks = Array.from({ length: 30 }, (_, index) => ({ ...plan.tasks[index % 2]!, id: `work-${index + 1}`, title: `Unidade ${index + 1}` }));
    const model = new DashboardModel({ ...saved(), plan: { ...plan, tasks } });
    const snapshot = model.snapshot();
    const phases = model.panel('phases');
    expect(phases.previewLines).toHaveLength(30);
    expect(phases.previewLines?.[1]).toContain('work-2 · Unidade 2 · Pendente · 1 critério(s)');
    expect(phases.lines.join('\n')).toContain('Instruções two\nTexto que precisa permanecer integral');
    expect(model.panel('environment').previewLines).toHaveLength(2);
    let view = createDashboardNavigation();
    const firstFrame = renderDashboard(snapshot, view, 120, 40);
    expect(firstFrame).toContain('work-2 · Unidade 2');
    expect(firstFrame).not.toContain('Instruções two');
    const expanded = navigateDashboard(view, 'enter', snapshot.panels);
    expect(renderDashboard(snapshot, expanded, 120, 40)).toContain('Instruções one');
    const limit = getPanelScrollLimit(snapshot, view, 'phases', 120, 40);
    let sawLast = false;
    for (let offset = 0; offset <= limit; offset++) {
      view = { ...view, scrollByPanel: { phases: offset } };
      if (renderDashboard(snapshot, view, 120, 40).includes('work-30 · Unidade 30')) { sawLast = true; break; }
    }
    expect(sawLast).toBe(true);
  });
});
