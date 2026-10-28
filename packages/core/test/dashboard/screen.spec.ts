import { expect, it } from 'vitest';
import { createDashboardNavigation, navigateDashboard } from '../../src/dashboard/navigation.js';
import { dashboardWidthOf, getPanelPageSize, getPanelScrollLimit, hitTestPanel, renderDashboard, renderProgressBar } from '../../src/dashboard/screen.js';
import type { DashboardPanelId, DashboardProgress, DashboardView } from '../../src/dashboard/types.js';

const ids: DashboardPanelId[] = ['summary', 'progress', 'phases', 'environment', 'activity', 'log', 'incidents'];
const names = ['Resumo', 'Progresso', 'Fases e unidades', 'Ambiente', 'Agentes e atividade', 'Log completo', 'Incidentes e evidências'];
function sample(): DashboardView {
  const progress = [{ id: 'tasks', label: 'Unidades de trabalho', completed: 3, total: 20, status: 'running' as const, stage: 'build' }];
  return {
    status: 'working', stage: 'build', progress, usage: { calls: 2 }, pendingDecisions: 0,
    panels: ids.map((id, index) => ({ id, title: names[index]!, lines: Array.from({ length: 60 }, (_, i) => `${id} linha ${i + 1}`), progress: id === 'progress' ? progress : [] })),
  };
}
const plain = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '');

it.each([[40, 12], [80, 24], [120, 40]])('mantém dashboard e todos os overlays dentro de %sx%s', (width, height) => {
  const model = sample();
  const initial = createDashboardNavigation();
  for (const expandedPanel of [undefined, ...ids]) {
    const view = expandedPanel ? { ...initial, focusPanel: expandedPanel, expandedPanel } : initial;
    for (const color of [false, true]) {
      const output = renderDashboard(model, view, width!, height!, color);
      const lines = output.split('\n');
      expect(lines.length).toBeLessThanOrEqual(height!);
      expect(lines.every(line => dashboardWidthOf(line) <= width!)).toBe(true);
      expect(plain(output)).toContain('3/20');
      expect(plain(output)).toContain('linhas ');
      expect(output).not.toMatch(/CAPIVARA|mascote/i);
    }
  }
});

it('mantém todas as fases e o texto inteiro acessíveis no overlay, com quebra de linhas longas', () => {
  const model = sample();
  const phrase = 'Objetivo final: preservar cada caractere de uma linha longa, incluindo 界 e acentuação, sem descartar a conclusão.';
  model.panels.find(panel => panel.id === 'phases')!.lines = [phrase, ...Array.from({ length: 35 }, (_, i) => `Fase ${i + 1}: conteúdo integral`), 'ÚLTIMA FASE INTEGRAL'];
  let view = navigateDashboard(createDashboardNavigation(), 'enter', model.panels);
  const seen: string[] = [];
  const limit = getPanelScrollLimit(model, view, 'phases', 40, 12);
  for (let offset = 0; offset <= limit; offset++) {
    view = { ...view, scrollByPanel: { phases: offset } };
    const output = plain(renderDashboard(model, view, 40, 12));
    const body = output.split('\n').filter(line => line.startsWith('│')).map(line => line.slice(2, -2).trimEnd());
    if (offset === 0) seen.push(...body);
    else seen.push(body.at(-1)!);
  }
  expect(seen.slice(0, 4).join('').replace(/\s/g, '')).toContain(phrase.replace(/\s/g, ''));
  expect(seen.join('\n')).toContain('Fase 35: conteúdo integral');
  expect(seen.join('\n')).toContain('ÚLTIMA FASE INTEGRAL');
  expect(plain(renderDashboard(model, view, 40, 12))).toContain(`/${limit + getPanelPageSize(model, view, 'phases', 40, 12)}`);
});

it('usa a visão resumida no dashboard e o conteúdo integral no overlay', () => {
  const model = sample();
  const phases = model.panels.find(panel => panel.id === 'phases')!;
  phases.previewLines = ['Fase 1 · concluída', 'Fase 2 · em andamento'];
  phases.progress = model.progress;
  phases.lines = ['Objetivo integral da primeira fase', ...Array.from({ length: 20 }, (_, i) => `Detalhe completo ${i + 1}`)];
  const view = createDashboardNavigation();
  const compact = plain(renderDashboard(model, view, 40, 12));
  expect(compact).toContain('Fase 1 · concluída');
  expect(compact).toContain('Fase 2 · em andamento');
  expect(compact).not.toContain('Objetivo integral');
  expect(getPanelScrollLimit(model, view, 'phases', 40, 12)).toBe(0);
  const expanded = { ...view, expandedPanel: 'phases' as const };
  expect(plain(renderDashboard(model, expanded, 40, 12))).toContain('Objetivo integral da primeira fase');
  expect(getPanelScrollLimit(model, expanded, 'phases', 40, 12)).toBeGreaterThan(0);
  phases.previewLines = Array.from({ length: 60 }, (_, i) => `Fase ${i + 1} · pendente`);
  const limit = getPanelScrollLimit(model, view, 'phases', 40, 12);
  const last = navigateDashboard(view, 'end', model.panels, getPanelPageSize(model, view, 'phases', 40, 12), limit);
  expect(plain(renderDashboard(model, last, 40, 12))).toContain('Fase 60 · pendente');
});

it('navega entre painéis, rola apenas o foco e conserva posição ao fechar o overlay', () => {
  const model = sample();
  let view = createDashboardNavigation();
  view = navigateDashboard(view, 'tab', ids);
  expect(view.focusPanel).toBe('environment');
  view = navigateDashboard(view, 'backtab', ids);
  expect(view.focusPanel).toBe('phases');
  view = navigateDashboard(view, 'pagedown', model.panels, 4, 50);
  expect(view.scrollByPanel.phases).toBe(4);
  view = navigateDashboard(view, 'enter', ids);
  expect(view.expandedPanel).toBe('phases');
  view = navigateDashboard(view, 'down', ids, 4, 50);
  expect(view.scrollByPanel.phases).toBe(5);
  view = navigateDashboard(view, 'escape', ids);
  expect(view.expandedPanel).toBeUndefined();
  expect(view.scrollByPanel.phases).toBe(5);
  expect(view.scrollByPanel.log).toBeUndefined();
  expect(navigateDashboard(view, 'escape', ids)).toBe(view);
});

it('segue logs até rolagem manual, retoma no End e mantém Tab disponível no overlay', () => {
  const model = sample();
  let view = navigateDashboard(createDashboardNavigation(), '6', ids);
  const limit = getPanelScrollLimit(model, view, 'log', 80, 24);
  expect(plain(renderDashboard(model, view, 80, 24))).toContain('log linha 60');
  view = navigateDashboard(view, 'pageup', ids, 4, limit);
  expect(view.scrollByPanel.log).toBe(limit - 4);
  expect(view.followPanels?.log).toBe(false);
  view = navigateDashboard(view, 'end', ids, 4, limit);
  expect(view.followPanels?.log).toBe(true);
  view = navigateDashboard(view, 'enter', ids);
  view = navigateDashboard(view, 'tab', ids);
  expect(view.expandedPanel).toBe('incidents');
  view = navigateDashboard(view, 'home', ids, 4, 50);
  expect(view.scrollByPanel.incidents).toBe(0);
});

it('mostra barras de contagens reais ou atividade sem inventar percentuais', () => {
  expect(renderProgressBar({ id: 'a', label: 'A', completed: 3, total: 10, status: 'running' }, 30)).toMatch(/\[█+░+\] 3\/10/);
  const unknown = renderProgressBar({ id: 'a', label: 'A', status: 'running' }, 30);
  expect(unknown).toContain('em curso');
  expect(unknown).not.toMatch(/%|\d+\//);
  const moving = { id: 'a', label: 'A', status: 'running' as const };
  expect(renderProgressBar(moving, 30, 0)).not.toBe(renderProgressBar(moving, 30, 1));
  const measured = { ...moving, completed: 3, total: 10 };
  expect(renderProgressBar(measured, 30, 0)).toBe(renderProgressBar(measured, 30, 1));
  expect(renderProgressBar({ ...moving, completed: 0, total: 0, status: 'complete' }, 30)).toMatch(/\[░+\] 0\/0/);
  const countWithoutTotal = renderProgressBar({ ...moving, completed: 800, unit: 'caracteres' }, 40);
  expect(countWithoutTotal).toContain('800 caracteres');
  expect(countWithoutTotal).toContain('em curso');
  expect(countWithoutTotal).not.toMatch(/%|800\//);
  expect(renderProgressBar({ ...moving, total: 20 }, 40)).toContain('?/20');
});

it('conserva fatos de progresso entre frames e expõe unidades extensas sem corte no overlay', () => {
  const model = sample();
  const unit = 'caracteres de documentos recuperados e lidos durante a investigação';
  const source = { id: 'source', label: 'Lendo fonte', completed: 800, status: 'running' as const, unit };
  const progress = model.panels.find(panel => panel.id === 'activity')!;
  progress.progress = [source]; progress.lines = [];
  model.progress = [source];
  const before = structuredClone(model);
  const view = { ...createDashboardNavigation(), focusPanel: 'activity' as const, expandedPanel: 'activity' as const };
  const output = renderDashboard(model, view, 80, 24, false, 0);
  const nextFrame = renderDashboard(model, view, 80, 24, false, 1);
  expect(output).toContain('800');
  expect(output.replace(/│|\n|\s/g, '')).toContain(unit.replace(/\s/g, ''));
  expect(nextFrame).not.toContain('801');
  expect(model).toEqual(before);
  expect(output).not.toContain('%');
});

it('mantém a operação corrente no cabeçalho enquanto o agregado continua em andamento', () => {
  const model = sample();
  const current: DashboardProgress = { id: 'task:work-8:stages', label: 'work-8: edição e revisão', completed: 1, total: 3, status: 'running' };
  model.progress.push(current);
  const view = createDashboardNavigation();
  const output = renderDashboard(model, view, 80, 24);
  expect(output.split('\n')[1]).toContain('work-8: edição e revisão');
  expect(output.split('\n')[1]).toContain('1/3');
  expect(output.split('\n').slice(2).join('\n')).not.toContain('3/20');
  current.status = 'complete';
  expect(renderDashboard(model, view, 80, 24).split('\n')[1]).toContain('3/20');
});

it('localiza cliques nas mesmas regiões que desenha, com coordenadas SGR e cabeçalho fixo', () => {
  const model = sample();
  const view = createDashboardNavigation();
  expect(hitTestPanel(model, view, 80, 24, 1, 1)).toBeUndefined();
  expect(hitTestPanel(model, view, 80, 24, 1, 3)).toBe('progress');
  expect(hitTestPanel(model, view, 80, 24, 42, 3)).toBe('summary');
  expect(hitTestPanel(model, view, 80, 24, 1, 23)).toBeUndefined();
  expect(hitTestPanel(model, { ...view, expandedPanel: 'phases' }, 40, 12, 40, 3)).toBe('phases');
  expect(hitTestPanel(model, { ...view, expandedPanel: 'phases' }, 40, 12, 40, 12)).toBeUndefined();
});

it('remove sequências de controle dos dados sem perder o texto do painel', () => {
  const model = sample();
  model.panels[0]!.lines = ['antes\u001b[2Jdepois\u001b]0;título externo\u0007'];
  const output = renderDashboard(model, { ...createDashboardNavigation(), focusPanel: 'summary', expandedPanel: 'summary' }, 40, 12);
  expect(output).toContain('antesdepois');
  expect(output).not.toContain('\u001b');
});

it('mantém quebras recebidas em metadados dentro dos limites e conserva os detalhes no overlay', () => {
  const model = sample();
  const label = 'Operação longa\ncom duas linhas';
  model.progress[0]!.label = label;
  model.panels.find(panel => panel.id === 'activity')!.progress = [{ ...model.progress[0]!, label }];
  const view = { ...createDashboardNavigation(), focusPanel: 'activity' as const, expandedPanel: 'activity' as const };
  const output = renderDashboard(model, view, 40, 12);
  expect(output.split('\n')).toHaveLength(12);
  expect(output).toContain('Operação longa');
  expect(output).toContain('com duas linhas');
  expect(output.split('\n').every(line => dashboardWidthOf(line) <= 40)).toBe(true);
});

it('alinha gates à direita de fases e threads, preservando cores e a ordem da hierarquia', () => {
  const model = sample();
  const panel = model.panels.find(item => item.id === 'progress')!;
  const gates = [
    { id: 'G0', status: 'complete' }, { id: 'G1', status: 'neutral' },
    { id: 'G2', status: 'running' }, { id: 'G3', status: 'returned', detail: 'Corrigir exportação truncada.' },
  ] as const;
  panel.phases = [{ id: 'P01', gates: [...gates], threads: [{ id: 'T01', taskId: 'work', title: 'Fluxo principal', gates: [...gates] }] }];
  const view = { ...createDashboardNavigation(), focusPanel: 'progress' as const, expandedPanel: 'progress' as const };
  const colored = renderDashboard(model, view, 120, 40, true);
  expect(colored).toContain('\u001b[1;32m●\u001b[0m');
  expect(colored).toContain('\u001b[1;33m◐\u001b[0m');
  expect(colored).toContain('\u001b[1;31m⊗\u001b[0m');
  expect(colored).toContain('\u001b[1;90m○\u001b[0m');
  expect(plain(colored)).toContain('G0 G1 G2 G3');
  const rows = plain(colored).split('\n').filter(line => /P01|T01/.test(line));
  expect(rows).toHaveLength(2);
  for (const symbol of ['●', '○', '◐', '⊗']) expect(rows[0]!.indexOf(symbol)).toBe(rows[1]!.indexOf(symbol));
  expect(plain(colored)).not.toContain('G4');
  expect(plain(colored)).not.toContain('progress linha');
  expect(plain(colored).split('\n').slice(2).join('\n')).not.toContain('Unidades de trabalho');
  const monochrome = renderDashboard(model, view, 120, 40, false);
  expect(monochrome).not.toContain('\u001b');
  expect(monochrome).toBe(plain(colored));
  panel.phases[0]!.gates.push({ id: 'G4', status: 'waiting' });
  panel.phases[0]!.threads[0]!.gates.push({ id: 'G4', status: 'waiting' });
  const waiting = renderDashboard(model, view, 120, 40, true);
  expect(plain(waiting)).toContain('G4');
  expect(waiting).toContain('\u001b[1;90m○\u001b[0m');
  const done = { id: 'P00', gates: panel.phases[0]!.gates.map(gate => ({ ...gate, status: 'complete' as const })), threads: [] };
  panel.phases.unshift(done);
  const order = panel.phases.map(phase => phase.id);
  const compact = plain(renderDashboard(model, { ...createDashboardNavigation(), focusPanel: 'progress' }, 80, 24, true));
  expect(compact.indexOf('P00')).toBeLessThan(compact.indexOf('P01'));
  expect(panel.phases.map(phase => phase.id)).toEqual(order);
  const compactView = { ...createDashboardNavigation(), focusPanel: 'progress' as const };
  expect(hitTestPanel(model, compactView, 120, 40, 42, 36)).toBe('progress');
  expect(hitTestPanel(model, compactView, 120, 40, 83, 17)).toBe('phases');
});

it('conserva hierarquia, gates e rolagem em janelas estreitas sem executar controles dos dados', () => {
  const model = sample();
  const panel = model.panels.find(item => item.id === 'progress')!;
  const gates = [
    { id: 'G0', status: 'complete' }, { id: 'G1', status: 'complete' },
    { id: 'G2', status: 'complete' }, { id: 'G3', status: 'running' }, { id: 'G4', status: 'pending' },
  ] as const;
  panel.phases = Array.from({ length: 20 }, (_, i) => ({ id: `P${String(i + 1).padStart(2, '0')}`, gates: [...gates], threads: [{ id: 'T01', taskId: `work-${i}`, title: '\u001b[2JTítulo seguro', gates: [...gates] }] }));
  for (const width of [20, 40, 80, 120]) {
    for (const expanded of [false, true]) {
      const view = { ...createDashboardNavigation(), focusPanel: 'progress' as const, ...(expanded ? { expandedPanel: 'progress' as const } : {}) };
      const output = renderDashboard(model, view, width, 24, true);
      expect(output.split('\n').every(line => dashboardWidthOf(line) <= width)).toBe(true);
      expect(output).not.toContain('\u001b[2J');
      expect(plain(output)).toContain('G0');
      expect(plain(output)).toContain('P01');
    }
  }
  const view = { ...createDashboardNavigation(), focusPanel: 'progress' as const, expandedPanel: 'progress' as const };
  const limit = getPanelScrollLimit(model, view, 'progress', 40, 12);
  const seen: string[] = [];
  for (let offset = 0; offset <= limit; offset++) {
    const output = plain(renderDashboard(model, { ...view, scrollByPanel: { progress: offset } }, 40, 12, true));
    seen.push(...output.split('\n').filter(line => line.startsWith('│')).map(line => line.slice(2, -2).trimEnd()));
  }
  expect(seen.join('\n')).toContain('P20');
  expect(seen.join('\n')).toContain('T01');
});
