import type { DashboardPanel, DashboardPanelId, DashboardProgress, DashboardView } from './types.js';
import type { DashboardNavigationState } from './navigation.js';

const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\|$))/g;
const safe = (text: string): string => text.replace(ANSI, '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(/\t/g, '    ');
const cellWidth = (char: string): number => {
  if (/\p{Mark}|\u200d|\ufe0f/u.test(char)) return 0;
  const point = char.codePointAt(0)!;
  return point >= 0x1100 && (point <= 0x115f || point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3 || point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f || point >= 0xff01 && point <= 0xff60 || point >= 0xffe0 && point <= 0xffe6 || point >= 0x1f300 && point <= 0x1faff || point >= 0x20000 && point <= 0x3ffff) ? 2 : 1;
};
export const dashboardWidthOf = (text: string): number => [...text.replace(ANSI, '')].reduce((width, char) => width + cellWidth(char), 0);
const fit = (text: string, width: number, ellipsis = false): string => {
  const value = safe(text).replace(/\n/g, ' ');
  if (dashboardWidthOf(value) <= width) return value;
  const available = Math.max(0, width - (ellipsis ? 1 : 0));
  let output = ''; let used = 0;
  for (const char of value) {
    const size = cellWidth(char);
    if (used + size > available) break;
    output += char; used += size;
  }
  return output + (ellipsis && width > 0 ? '…' : '');
};
const pad = (text: string, width: number): string => `${text}${' '.repeat(Math.max(0, width - dashboardWidthOf(text)))}`;
const wrap = (text: string, width: number): string[] => {
  const output: string[] = [];
  for (const line of safe(text).split(/\r?\n/)) {
    let current = ''; let used = 0;
    for (const char of line) {
      const size = cellWidth(char);
      if (used + size > width && current) { output.push(current); current = ''; used = 0; }
      current += char; used += size;
    }
    output.push(current);
  }
  return output;
};

const hasCount = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0;
function progressCount(progress: DashboardProgress): string {
  const state = progress.status === 'complete' ? 'concluído' : progress.status === 'waiting' ? 'aguardando' : 'em curso';
  const completed = hasCount(progress.completed), total = hasCount(progress.total);
  if (!completed && !total) return state;
  const value = completed && total ? `${progress.completed}/${progress.total}` : completed ? `${progress.completed}` : `?/${progress.total}`;
  return `${value}${progress.unit ? ` ${safe(progress.unit)}` : ''}${completed && total ? '' : ` · ${state}`}`;
}

/** A bar is determinate only when the engine supplied a real denominator. */
export function renderProgressBar(progress: DashboardProgress, width: number, frame = 0): string {
  const total = progress.total;
  const known = hasCount(total) && hasCount(progress.completed);
  const completed = known ? progress.completed! : 0;
  const count = progressCount(progress);
  const barWidth = Math.max(1, Math.min(24, width - dashboardWidthOf(count) - 3));
  const filled = known ? total! > 0 ? Math.round(Math.min(1, completed / total!) * barWidth) : 0 : progress.status === 'complete' ? barWidth : 0;
  const segment = Math.min(3, barWidth);
  const position = (Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0) % (barWidth - segment + 1);
  const bar = known || progress.status === 'complete'
    ? `${'█'.repeat(filled)}${'░'.repeat(barWidth - filled)}`
    : progress.status === 'waiting' ? '░'.repeat(barWidth) : `${'░'.repeat(position)}${'━'.repeat(segment)}${'░'.repeat(barWidth - segment - position)}`;
  return fit(`[${bar}] ${count}`, width);
}

interface PanelPlacement { panel: DashboardPanel; x: number; y: number; width: number; height: number; }
interface DashboardLayout { width: number; height: number; header: string[]; footer: string[]; placements: PanelPlacement[]; }

function progressLines(progress: DashboardProgress, width: number, expanded: boolean, frame: number): string[] {
  const label = `${progress.label}${progress.stage ? ` · ${progress.stage}` : ''}`;
  const count = progressCount(progress);
  const fullCount = expanded && dashboardWidthOf(count) > width - 4 ? wrap(count, width) : [];
  return [...(expanded ? wrap(label, width) : [fit(label, width, true)]), renderProgressBar(progress, width, frame), ...fullCount];
}

function panelLines(panel: DashboardPanel, width: number, expanded: boolean, frame = 0): string[] {
  const measurements = !expanded && panel.previewLines && panel.id !== 'progress' ? [] : panel.progress;
  const progress = measurements.flatMap(item => progressLines(item, width, expanded, frame));
  const source = expanded ? panel.lines : panel.previewLines ?? panel.lines;
  const lines = source.flatMap(line => expanded ? wrap(line, width) : safe(line).split(/\r?\n/).map(part => fit(part, width, true)));
  const content = panel.id === 'progress' ? [...progress, ...lines] : [...lines, ...progress];
  return content.length ? content : ['Sem registros.'];
}

const splitHeights = (available: number, count: number): number[] => Array.from({ length: count }, (_, index) => Math.floor(available / count) + (index < available % count ? 1 : 0));
const aggregateProgress = new Set(['brief', 'plan', 'environment', 'tasks', 'verification', 'gaps']);

function layoutDashboard(model: DashboardView, view: DashboardNavigationState, width: number, height: number, frame = 0): DashboardLayout {
  const w = Math.max(4, Number.isFinite(width) ? Math.floor(width) : 80);
  const h = Math.max(3, Number.isFinite(height) ? Math.floor(height) : 24);
  const focused = model.panels.find(panel => panel.id === (view.expandedPanel ?? view.focusPanel)) ?? model.panels[0];
  const current = model.progress.findLast(item => item.status === 'running' && !aggregateProgress.has(item.id))
    ?? model.progress.find(item => item.status === 'running') ?? model.progress.find(item => item.status !== 'complete') ?? model.progress.at(-1);
  const status = ({ working: 'Em andamento', running: 'Em andamento', waiting: 'Aguardando', recovering: 'Em recuperação', complete: 'Concluído', cancelled: 'Interrompido', critical: 'Incidente crítico' } as Record<string, string>)[model.status] ?? model.status;
  const header = [fit(`${view.expandedPanel ? 'PAINEL' : 'EXECUÇÃO'} · ${safe(status)} · ${safe(model.stage)}`, w, true)];
  if (current) {
    const barWidth = Math.min(w, Math.max(16, Math.floor(w * 0.48)));
    const labelWidth = w - barWidth - 1;
    header.push(labelWidth >= 8 ? `${pad(fit(current.label, labelWidth, true), labelWidth)} ${renderProgressBar(current, barWidth, frame)}` : renderProgressBar(current, w, frame));
  }
  const index = focused ? model.panels.indexOf(focused) + 1 : 0;
  const selector = `Área ${index}/${model.panels.length}: ${focused?.title ?? 'sem conteúdo'} · Tab/←→`;
  const footer = [fit(selector, w, true), fit(view.expandedPanel ? w < 64 ? '↑↓/Pg↑↓ rolar · Esc voltar · continua' : '↑↓ rolar · PgUp/PgDn · Home/End · Esc voltar · execução continua' : '↑↓ rolar · Enter ampliar · PgUp/PgDn · Home/End', w, true), fit('q ocultar · Ctrl-C cancelar execução', w, true)];
  if (h < 8) footer.splice(0, 2);
  const bodyHeight = Math.max(1, h - header.length - footer.length);
  const placements: PanelPlacement[] = [];
  if (!focused) return { width: w, height: h, header, footer, placements };
  if (view.expandedPanel) {
    placements.push({ panel: focused, x: 0, y: 0, width: w, height: bodyHeight });
    return { width: w, height: h, header, footer, placements };
  }

  const byId = (id: DashboardPanelId): DashboardPanel | undefined => model.panels.find(panel => panel.id === id);
  // Small terminals keep the active area reachable and reserve the other area for live logs/phases.
  if (w < 64 || bodyHeight < 14) {
    const other = byId(focused.id === 'log' ? 'phases' : 'log');
    const visible = bodyHeight >= 6 && other && other.id !== focused.id ? [focused, other] : [focused];
    const sizes = splitHeights(bodyHeight, visible.length);
    let y = 0;
    visible.forEach((panel, i) => { const panelHeight = sizes[i]!; placements.push({ panel, x: 0, y, width: w, height: panelHeight }); y += panelHeight; });
  } else {
    const groups: DashboardPanelId[][] = w >= 110 && bodyHeight >= 18
      ? [['summary', 'environment', 'incidents'], ['progress', 'phases'], ['activity', 'log']]
      : [['progress', 'phases', 'log'], ['summary', 'environment', 'activity', 'incidents']];
    const columnWidths = splitHeights(w - groups.length + 1, groups.length);
    let x = 0;
    groups.forEach((group, col) => {
      const panels = group.map(byId).filter((panel): panel is DashboardPanel => panel !== undefined);
      const sizes = splitHeights(bodyHeight, panels.length);
      let y = 0;
      panels.forEach((panel, row) => { const panelHeight = sizes[row]!; placements.push({ panel, x, y, width: columnWidths[col]!, height: panelHeight }); y += panelHeight; });
      x += columnWidths[col]! + 1;
    });
  }
  return { width: w, height: h, header, footer, placements };
}

export function getPanelPageSize(model: DashboardView, view: DashboardNavigationState, panel: DashboardPanelId, width: number, height: number): number {
  const layout = layoutDashboard(model, view, width, height);
  const placement = layout.placements.find(item => item.panel.id === panel);
  return Math.max(1, (placement?.height ?? 3) - 2);
}

export function getPanelScrollLimit(model: DashboardView, view: DashboardNavigationState, panel: DashboardPanelId, width: number, height: number): number {
  const layout = layoutDashboard(model, view, width, height);
  const placement = layout.placements.find(item => item.panel.id === panel);
  const content = placement?.panel ?? model.panels.find(item => item.id === panel);
  if (!content) return 0;
  const lines = panelLines(content, Math.max(1, (placement?.width ?? layout.width) - 4), view.expandedPanel === panel);
  return Math.max(0, lines.length - getPanelPageSize(model, view, panel, width, height));
}

/** SGR mouse coordinates are one-based and include the fixed header rows. */
export function hitTestPanel(model: DashboardView, view: DashboardNavigationState, width: number, height: number, x: number, y: number): DashboardPanelId | undefined {
  const layout = layoutDashboard(model, view, width, height);
  const column = x - 1;
  const row = y - 1 - layout.header.length;
  return layout.placements.find(item => column >= item.x && column < item.x + item.width && row >= item.y && row < item.y + item.height)?.panel.id;
}

/** Returns a complete bounded frame. Overlay scrolls its complete wrapped contents independently. */
export function renderDashboard(model: DashboardView, view: DashboardNavigationState, width: number, height: number, color = false, frame = 0): string {
  const layout = layoutDashboard(model, view, width, height, frame);
  const paint = (text: string, tone: string): string => color ? `\u001b[${tone}m${text}\u001b[0m` : text;
  const rows = Array.from({ length: Math.max(1, layout.height - layout.header.length - layout.footer.length) }, () => ' '.repeat(layout.width));
  const rendered: { placement: PanelPlacement; rows: string[] }[] = [];
  for (const placement of layout.placements) {
    const { panel, width: panelWidth, height: panelHeight } = placement;
    const active = panel.id === (view.expandedPanel ?? view.focusPanel);
    const tone = active ? '1;36' : '90';
    const inner = Math.max(0, panelWidth - 2);
    const contentWidth = Math.max(1, inner - 2);
    const lines = panelLines(panel, contentWidth, view.expandedPanel === panel.id, frame);
    const pageSize = Math.max(1, panelHeight - 2);
    const limit = Math.max(0, lines.length - pageSize);
    const offset = view.followPanels?.[panel.id] ? limit : Math.min(limit, Math.max(0, Math.floor(view.scrollByPanel[panel.id] ?? 0)));
    const label = fit(` ${active ? '▸ ' : ''}${panel.title}${view.expandedPanel === panel.id ? ' · AMPLIADO' : ''} `, inner);
    const top = paint(`┌${label}${'─'.repeat(Math.max(0, inner - dashboardWidthOf(label)))}┐`, tone);
    const range = fit(` linhas ${offset + 1}–${Math.min(lines.length, offset + pageSize)}/${lines.length}${view.followPanels?.[panel.id] ? ' · ao vivo' : ''} `, inner);
    const bottom = paint(`└${range}${'─'.repeat(Math.max(0, inner - dashboardWidthOf(range)))}┘`, tone);
    const body = Array.from({ length: Math.max(0, panelHeight - 2) }, (_, row) => `${paint('│', tone)} ${pad(fit(lines[offset + row] ?? '', contentWidth), contentWidth)} ${paint('│', tone)}`);
    rendered.push({ placement, rows: panelHeight >= 2 ? [top, ...body, bottom].slice(0, panelHeight) : [paint(fit(`▸ ${panel.title}`, panelWidth), tone)] });
  }
  // Each column is joined as already bounded strings so ANSI styles never affect cell positions.
  for (let row = 0; row < rows.length; row++) {
    const pieces = rendered.filter(item => row >= item.placement.y && row < item.placement.y + item.placement.height).sort((a, b) => a.placement.x - b.placement.x);
    let text = ''; let used = 0;
    for (const piece of pieces) {
      text += ' '.repeat(Math.max(0, piece.placement.x - used)) + piece.rows[row - piece.placement.y];
      used = piece.placement.x + piece.placement.width;
    }
    rows[row] = text + ' '.repeat(Math.max(0, layout.width - used));
  }
  return [...layout.header.map(line => paint(line, '1')), ...rows, ...layout.footer.map(line => paint(line, '90'))].slice(0, layout.height).join('\n');
}
