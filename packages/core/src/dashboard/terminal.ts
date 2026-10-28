import { stdin, stdout } from 'node:process';
import { StringDecoder } from 'node:string_decoder';
import type { ReadStream, WriteStream } from 'node:tty';
import type { Question } from '../domain/types.js';
import type { SavedProject } from '../app/store.js';
import { KeyDecoder, type Key, reduceText, BRACKETED_PASTE_ON, BRACKETED_PASTE_OFF } from '../wizard/keys.js';
import { scrub } from '../runtime/files.js';
import { DashboardModel } from './model.js';
import type { DashboardEvent, DashboardView } from './types.js';
import { createDashboardNavigation, navigateDashboard, type DashboardNavigationState } from './navigation.js';
import { renderDashboard, getPanelPageSize, getPanelScrollLimit, hitTestPanel, dashboardWidthOf } from './screen.js';

export interface DashboardTerminalOptions {
  input?: ReadStream;
  output?: WriteStream;
  environment?: NodeJS.ProcessEnv;
  workspace?: string;
  initial?: SavedProject;
  viewer?: boolean;
  cancel?: () => void;
  onAnswer?: (id: string, answer: string) => void | Promise<void>;
  onClose?: () => void;
  onError?: (error: unknown) => void;
}
interface Composer { question: Question; value: string; resolve?: (answer: string | null) => void; }
function responseLine(value: string, width: number): string {
  const clean = value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|$))|[\u0000-\u001f\u007f]/g, ' ');
  const prefix = width > 15 ? 'Resposta: ' : '> ';
  let tail = '';
  for (const char of [...clean].reverse()) {
    if (dashboardWidthOf(prefix + char + tail + '█') > width) break;
    tail = char + tail;
  }
  return `${prefix}${tail}█`;
}

/** The terminal owns presentation only. Closing an area never suspends the engine. */
export class DashboardTerminal {
  readonly model: DashboardModel;
  private readonly input: ReadStream;
  private readonly output: WriteStream;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly decoder = new KeyDecoder();
  private readonly utf8 = new StringDecoder('utf8');
  private navigation = createDashboardNavigation();
  private compactNavigation: DashboardNavigationState | undefined;
  private composer: Composer | undefined;
  private cached: DashboardView | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private escapeTimer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private started = false;
  private closed = false;
  private dirty = true;
  private readonly startedAt = Date.now();
  private originalRaw = false;
  private originalFlowing: boolean | null = null;

  constructor(private readonly options: DashboardTerminalOptions = {}) {
    this.input = options.input ?? stdin; this.output = options.output ?? stdout;
    this.environment = options.environment ?? process.env;
    this.model = new DashboardModel(options.initial, options.workspace ? { workspace: options.workspace } : {});
  }
  get active(): boolean { return this.started && !this.closed; }
  get viewState(): DashboardNavigationState { return this.navigation; }

  start(): boolean {
    if (this.started || this.closed) return this.active;
    if (!this.input.isTTY || !this.output.isTTY) return false;
    this.originalRaw = Boolean(this.input.isRaw); this.originalFlowing = this.input.readableFlowing;
    this.started = true;
    try {
      this.input.setRawMode(true);
      this.input.on('data', this.onData); this.input.on('end', this.onEnd); this.input.on('error', this.onFailure);
      this.output.on('resize', this.onResize); this.output.on('error', this.onFailure);
      this.output.write(`\u001b[?1049h\u001b[?25l${BRACKETED_PASTE_ON}\u001b[?1000h\u001b[?1006h`);
      this.input.resume(); this.render();
      if (!this.active) return false;
      this.timer = setInterval(() => this.render(), 250); this.timer.unref();
      return true;
    } catch (error) { this.fail(error); return false; }
  }
  updateProject(state: SavedProject): void {
    try { this.model.updateProject(state); this.dirty = true; } catch (error) { this.fail(error); }
  }
  observe(event: DashboardEvent): void {
    try {
      const sanitized = { ...event, ...(event.message ? { message: scrub(event.message) } : {}) };
      this.model.observe(sanitized); this.dirty = true;
    } catch (error) { this.fail(error); }
  }
  snapshot(): DashboardView {
    if (!this.cached || this.dirty) { this.cached = this.model.snapshot(); this.dirty = false; }
    return this.cached;
  }
  ask(question: Question): Promise<string | null> {
    if (!this.active) return Promise.reject(new Error('Dashboard indisponível para entrevista.'));
    this.composer?.resolve?.(null);
    return new Promise(resolve => {
      this.composer = { question, value: '', resolve };
      this.compactNavigation ??= this.navigation;
      this.navigation = { ...this.navigation, focusPanel: 'incidents', expandedPanel: 'incidents', scrollByPanel: { ...this.navigation.scrollByPanel, incidents: 0 }, followPanels: { ...this.navigation.followPanels, incidents: false } };
      this.render();
    });
  }
  private currentView(): DashboardView {
    const view = this.snapshot();
    if (!this.composer) return view;
    const question = this.composer.question;
    return { ...view, panels: view.panels.map(panel => panel.id === 'incidents' ? { ...panel, lines: [question.question, '', `Motivo: ${question.reason}`, `Impacto: ${question.impact}`, '', ...question.options.map((option, i) => `${i + 1}) ${option}`), '', 'Digite uma resposta; Enter registra. Esc deixa a decisão pendente e continua o trabalho independente.'], progress: [] } : panel) };
  }
  render(): void {
    if (!this.active) return;
    try {
      const view = this.currentView();
      const width = Math.max(4, this.output.columns || 80), height = Math.max(4, (this.output.rows || 24) - 1);
      let screen = renderDashboard(view, this.navigation, width, height, this.environment.NO_COLOR === undefined && this.environment.TERM !== 'dumb', this.frame++);
      const rows = screen.split('\n');
      const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
      const clock = `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, '0')}s`;
      if (this.composer) {
        rows[rows.length - 2] = [...'Enter confirma · Esc adia · PgUp/PgDn lê a pergunta'].slice(0, width).join('');
        rows[rows.length - 1] = responseLine(this.composer.value, width);
      } else {
        const footer = [clock, ...(view.pendingQuestion ? ['a responder'] : []), `q ${this.options.viewer ? 'fechar' : 'ocultar'}`, `Ctrl-C ${this.options.viewer ? 'fechar painel' : 'cancelar'}`].join(' · ');
        rows[rows.length - 1] = [...footer].slice(0, width).join('');
      }
      screen = rows.join('\n');
      this.output.write(`\u001b[H\u001b[2J${screen}`);
    } catch (error) { this.fail(error); }
  }
  private readonly onResize = (): void => { this.render(); };
  private readonly onEnd = (): void => { this.close(); };
  private readonly onFailure = (error: unknown): void => { this.fail(error); };
  private readonly onData = (chunk: string | Buffer): void => {
    clearTimeout(this.escapeTimer);
    try {
      const keys = this.decoder.feed(typeof chunk === 'string' ? chunk : this.utf8.write(chunk));
      for (const key of keys) { if (!this.active) break; this.key(key); }
      if (this.active) this.escapeTimer = setTimeout(() => { for (const key of this.decoder.flushEscape()) this.key(key); }, 30);
    } catch (error) { this.fail(error); }
  };
  private key(key: Key): void {
    if (!this.active) return;
    if (key.type === 'ctrl-c') {
      if (!this.options.viewer) { try { this.options.cancel?.(); } catch { /* cancellation remains owned by caller */ } }
      this.close(); return;
    }
    if (this.composer) {
      if (key.type === 'escape' || key.type === 'ctrl-d') { const composer = this.composer; this.composer = undefined; composer.resolve?.(null); this.restoreCompact(); this.render(); return; }
      if (['pageup', 'pagedown', 'up', 'down', 'home', 'end'].includes(key.type)) { this.navigate(key.type); return; }
      const next = reduceText(this.composer.value, key);
      this.composer.value = next.value;
      if (next.submitted !== undefined && next.submitted.trim()) {
        const composer = this.composer; this.composer = undefined; this.restoreCompact();
        if (composer.resolve) composer.resolve(next.submitted.trim());
        else {
          const answer = /^\d+$/.test(next.submitted.trim()) ? composer.question.options[Number(next.submitted.trim()) - 1] ?? next.submitted.trim() : next.submitted.trim();
          Promise.resolve().then(() => this.options.onAnswer?.(composer.question.id, answer)).catch(error => this.observe({ type: 'recovery', message: `A resposta precisa ser registrada novamente: ${String(error)}` }));
        }
      }
      this.render(); return;
    }
    if (key.type === 'char' && key.text === 'q') { this.close(); return; }
    if (key.type === 'char' && key.text === 'a') {
      const question = this.snapshot().pendingQuestion;
      if (question && this.options.onAnswer) { this.composer = { question, value: '' }; this.compactNavigation ??= this.navigation; this.navigation = { ...this.navigation, focusPanel: 'incidents', expandedPanel: 'incidents', scrollByPanel: { ...this.navigation.scrollByPanel, incidents: 0 }, followPanels: { ...this.navigation.followPanels, incidents: false } }; this.render(); }
      return;
    }
    if (key.type === 'mouse') {
      const width = this.output.columns || 80, height = Math.max(4, (this.output.rows || 24) - 1);
      const panel = hitTestPanel(this.currentView(), this.navigation, width, height, key.x, key.y);
      if (panel) this.navigation = { ...this.navigation, focusPanel: panel, ...(this.navigation.expandedPanel ? { expandedPanel: panel } : {}) };
      if (key.button === 64 || key.button === 65) this.navigate(key.button === 64 ? 'up' : 'down');
      else this.render();
      return;
    }
    if (key.type === 'enter' && !this.navigation.expandedPanel) {
      this.compactNavigation = this.navigation;
      const panel = this.navigation.focusPanel;
      this.navigation = { ...this.navigation, scrollByPanel: { ...this.navigation.scrollByPanel, [panel]: 0 }, followPanels: { ...this.navigation.followPanels, [panel]: false } };
    }
    if (key.type === 'escape' && this.navigation.expandedPanel) { this.restoreCompact(); this.render(); return; }
    this.navigate(key.type === 'char' ? key.text : key.type);
  }
  private restoreCompact(): void {
    if (this.compactNavigation) { this.navigation = this.compactNavigation; this.compactNavigation = undefined; }
    else { const { expandedPanel: _expanded, ...rest } = this.navigation; this.navigation = rest; }
  }
  private navigate(key: string): void {
    const view = this.currentView(), panel = this.navigation.expandedPanel ?? this.navigation.focusPanel;
    const width = this.output.columns || 80, height = Math.max(4, (this.output.rows || 24) - 1);
    const page = getPanelPageSize(view, this.navigation, panel, width, height);
    const limit = getPanelScrollLimit(view, this.navigation, panel, width, height);
    this.navigation = navigateDashboard(this.navigation, key, view.panels, page, limit);
    this.render();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer); clearTimeout(this.escapeTimer);
    const composer = this.composer; this.composer = undefined; composer?.resolve?.(null);
    if (this.started) {
      this.input.off('data', this.onData); this.input.off('end', this.onEnd); this.input.off('error', this.onFailure);
      this.output.off('resize', this.onResize); this.output.off('error', this.onFailure);
      try { this.input.setRawMode(this.originalRaw); } catch { /* The terminal may have disappeared. */ }
      if (this.originalFlowing !== true) this.input.pause();
      try { this.output.write(`\u001b[?1000l\u001b[?1006l${BRACKETED_PASTE_OFF}\u001b[?25h\u001b[0m\u001b[?1049l`); } catch { /* Disconnected display cannot abort construction. */ }
    }
    try { this.options.onClose?.(); } catch { /* Observer only. */ }
  }
  private fail(error: unknown): void {
    this.close(); try { this.options.onError?.(error); } catch { /* Failure stays outside the engine. */ }
  }
}
