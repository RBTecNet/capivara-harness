import type { DashboardPanel, DashboardPanelId } from './types.js';

export interface DashboardNavigationState {
  focusPanel: DashboardPanelId;
  expandedPanel?: DashboardPanelId;
  scrollByPanel: Partial<Record<DashboardPanelId, number>>;
  followPanels?: Partial<Record<DashboardPanelId, boolean>>;
}

export type DashboardNavigationKey = 'tab' | 'backtab' | 'shift-tab' | 'left' | 'right' | 'up' | 'down' | 'pageup' | 'pagedown' | 'home' | 'end' | 'enter' | 'escape' | string;

export function createDashboardNavigation(): DashboardNavigationState {
  return { focusPanel: 'phases', scrollByPanel: {}, followPanels: { log: true, activity: true } };
}

/** Keyboard navigation changes only the view; the running engine owns its lifetime. */
export function navigateDashboard(
  state: DashboardNavigationState,
  key: DashboardNavigationKey,
  panels: readonly (DashboardPanel | DashboardPanelId)[],
  pageSize = 5,
  maxScroll = Number.MAX_SAFE_INTEGER,
): DashboardNavigationState {
  const ids = panels.map(panel => typeof panel === 'string' ? panel : panel.id);
  if (!ids.length) return state;
  const current = state.expandedPanel ?? state.focusPanel;
  const index = Math.max(0, ids.indexOf(current));
  const normalized = key.toLowerCase();
  let next: DashboardPanelId | undefined;
  if (normalized === 'tab' || normalized === 'right') next = ids[(index + 1) % ids.length];
  else if (normalized === 'backtab' || normalized === 'shift-tab' || normalized === 'left') next = ids[(index - 1 + ids.length) % ids.length];
  else if (/^[1-9]$/.test(normalized)) next = ids[Number(normalized) - 1];
  if (next) return { ...state, focusPanel: next, ...(state.expandedPanel ? { expandedPanel: next } : {}) };
  if (normalized === 'enter') return { ...state, focusPanel: current, expandedPanel: current };
  if (normalized === 'escape') {
    if (!state.expandedPanel) return state;
    const { expandedPanel: _expandedPanel, ...rest } = state;
    return { ...rest, focusPanel: current };
  }

  const limit = Math.max(0, Math.floor(maxScroll));
  const position = state.followPanels?.[current] ? limit : Math.min(limit, Math.max(0, state.scrollByPanel[current] ?? 0));
  const page = Math.max(1, Math.floor(pageSize));
  let offset: number;
  if (normalized === 'up') offset = position - 1;
  else if (normalized === 'down') offset = position + 1;
  else if (normalized === 'pageup') offset = position - page;
  else if (normalized === 'pagedown') offset = position + page;
  else if (normalized === 'home') offset = 0;
  else if (normalized === 'end') offset = limit;
  else return state;
  return {
    ...state,
    scrollByPanel: { ...state.scrollByPanel, [current]: Math.min(limit, Math.max(0, offset)) },
    followPanels: { ...state.followPanels, [current]: normalized === 'end' },
  };
}
