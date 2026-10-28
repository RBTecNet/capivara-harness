import type { SavedProject } from '../app/store.js';
import type { BuildState, TaskProgress } from '../execution/types.js';
import type { AgentConfig } from '../runtime/types.js';
import type { DashboardEvent, DashboardGate, DashboardPanel, DashboardPanelId, DashboardPhase, DashboardProgress, DashboardThread, DashboardUsage, DashboardView } from './types.js';
import type { BuildGateMeasurement } from '../telemetry/progress.js';

const statusLabels: Record<string, string> = {
  working: 'Em andamento', recovering: 'Em recuperação', waiting: 'Aguardando', complete: 'Concluído', cancelled: 'Interrompido', critical: 'Incidente crítico',
  discovering: 'Em descoberta', ready: 'Pronto', planning: 'Em planejamento', pending: 'Pendente', resolved: 'Resolvido', editing: 'Em implementação', checking: 'Em verificação', reviewing: 'Em revisão', running: 'Em andamento',
  preparing: 'Preparando ambiente', integrating: 'Integrando alterações',
};

function label(value: string | undefined, fallback = 'Não informado'): string { return value ? statusLabels[value] ?? value : fallback; }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function lines(text: string): string[] { return text.split(/\r?\n/); }
function oneLine(text: string): string { return text.replace(/\r?\n/g, ' '); }
function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
}
function add(target: string[], heading: string, value: string | undefined): void {
  if (value === undefined || value === '') return;
  target.push(...lines(`${heading}${value}`));
}
function command(recipe: { command: string; args?: string[]; cwd?: string }): string {
  return `${recipe.cwd ? `${recipe.cwd}: ` : ''}${recipe.command}${recipe.args?.length ? ` ${recipe.args.map(arg => JSON.stringify(arg)).join(' ')}` : ''}`;
}
function execution(saved: SavedProject): BuildState | undefined {
  const value = record(saved.execution);
  return value?.schema === 'capivara/build/1' && record(value.tasks) && record(value.environment) && Array.isArray(value.evidence) && Array.isArray(value.incidents) ? value as unknown as BuildState : undefined;
}
function stateProgress(id: string, text: string, state: DashboardProgress['status'], stage: string): DashboardProgress {
  return { id, label: text, status: state, stage };
}
function countProgress(id: string, text: string, completed: number, total: number, waiting: boolean, stage: string, unit: string): DashboardProgress {
  return { id, label: text, completed, total, status: completed === total ? 'complete' : waiting ? 'waiting' : 'running', stage, unit };
}
function configLines(title: string, config: AgentConfig | undefined): string[] {
  if (!config) return [`${title}: não configurado`];
  const result = [`${title}: ${config.provider}`];
  add(result, '  Modelo: ', config.model);
  add(result, '  Esforço: ', config.effort);
  if (config.contextTokens !== undefined) result.push(`  Contexto: ${config.contextTokens} tokens`);
  if (config.maxOutputTokens !== undefined) result.push(`  Saída máxima: ${config.maxOutputTokens} tokens`);
  add(result, '  Comando: ', config.command);
  // Credentials and provider environment values do not belong in a dashboard.
  return result;
}

/** A projection of committed project facts and observed events. It never drives execution. */
export class DashboardModel {
  private saved: SavedProject;
  private readonly workspace: string | undefined;
  private readonly measurements = new Map<string, DashboardProgress>();
  private readonly gateMeasurements = new Map<string, Map<string, BuildGateMeasurement>>();
  private readonly logLines: string[] = [];
  private readonly activityLines: string[] = [];
  private readonly eventResults = new Set<string>();
  private readonly usage: DashboardUsage = { calls: 0 };
  private latestRecovery: string | undefined;
  private latestActivity: string | undefined;
  private executionRevision: unknown;

  constructor(saved: SavedProject = {}, options: { workspace?: string } = {}) {
    this.saved = saved;
    this.workspace = options.workspace;
    this.executionRevision = record(saved.execution)?.updatedAt;
  }

  updateProject(saved: SavedProject): void {
    // A newer committed build supersedes transient aggregate counters from that build.
    const nextExecutionRevision = record(saved.execution)?.updatedAt;
    if (nextExecutionRevision !== this.executionRevision || saved.plan?.revision !== this.saved.plan?.revision) {
      for (const id of ['environment', 'tasks']) this.measurements.delete(id);
    }
    if (saved.plan?.revision !== this.saved.plan?.revision) {
      this.gateMeasurements.clear();
      this.measurements.delete('verification');
      const taskIds = saved.plan?.tasks.map(task => task.id) ?? [];
      for (const id of this.measurements.keys()) {
        if (id.startsWith('task:') && !taskIds.some(taskId => id.startsWith(`task:${taskId}:`)) || id.startsWith('verification:') && !taskIds.some(taskId => id.startsWith(`verification:${taskId}:`))) this.measurements.delete(id);
      }
    }
    this.executionRevision = nextExecutionRevision;
    this.saved = saved;
  }

  observe(input: DashboardEvent): void {
    let body = input.body;
    if (typeof body === 'string') { try { body = JSON.parse(body) as unknown; } catch { /* A literal body remains available in the log. */ } }
    const stored = record(body);
    const event: DashboardEvent = stored ? { ...stored, type: input.type, ...(input.at ? { at: input.at } : {}) } : input;
    const prefix = `${event.at ? `${event.at} ` : ''}[${event.type}]${event.subject ? ` ${event.subject}` : ''}`;
    this.logLines.push(...lines(`${prefix}${event.message ? ` ${event.message}` : ''}`));
    if (event.detail !== undefined) this.logLines.push(...lines(json(event.detail)));
    if (event.progress !== undefined) this.logLines.push(...lines(json(event.progress)));
    if (event.gate !== undefined) this.logLines.push(...lines(json(event.gate)));
    if (!event.progress && !event.gate && body !== undefined && !stored) this.logLines.push(...lines(typeof body === 'string' ? body : json(body)));
    if (stored) {
      const remaining = Object.fromEntries(Object.entries(stored).filter(([key]) => !['type', 'message', 'subject', 'detail', 'progress', 'gate', 'at'].includes(key)));
      if (Object.keys(remaining).length) this.logLines.push(...lines(json(remaining)));
    }
    if (event.progress) this.observeProgress(event.progress);
    if (event.gate) this.observeGate(event.gate);
    if (['agent', 'agent.start', 'agent.result', 'command', 'tool', 'gate', 'recovery', 'waiting', 'complete'].includes(event.type)) {
      const detail = record(event.detail) ?? stored;
      this.latestActivity = oneLine([event.type, typeof detail?.role === 'string' ? detail.role : undefined, typeof detail?.status === 'string' ? label(detail.status) : undefined, event.message].filter(Boolean).join(' · '));
      this.activityLines.push(...lines(`${prefix}${event.message ? ` ${event.message}` : ''}`));
      if (event.detail !== undefined) this.activityLines.push(...lines(json(event.detail)));
      if (stored && event.type === 'agent.result') this.activityLines.push(...lines(json(stored)));
    }
    if (event.type === 'recovery') this.latestRecovery = event.message;
    if (event.type === 'agent.result') this.observeUsage(record(event.detail) ?? stored);
  }

  private observeGate(gate: BuildGateMeasurement): void {
    if (!gate.taskId || !['G0', 'G1', 'G2', 'G3', 'G4'].includes(gate.gate) || !['pending', 'running', 'complete', 'returned', 'neutral', 'waiting'].includes(gate.status) || !number(gate.attempt) || !number(gate.planRevision)) return;
    if (this.saved.plan && gate.planRevision !== this.saved.plan.revision) return;
    const current = this.gateMeasurements.get(gate.taskId) ?? new Map<string, BuildGateMeasurement>();
    const previous = current.get(gate.gate);
    if (previous && gate.attempt < previous.attempt) return;
    // A return stays visible until this very step is retried or otherwise resolved.
    if (previous?.status === 'returned' && gate.status === 'pending') return;
    current.set(gate.gate, { ...gate });
    this.gateMeasurements.set(gate.taskId, current);
  }

  private gateRows(state: BuildState | undefined): Omit<DashboardThread, 'id'>[] {
    return (this.saved.plan?.tasks ?? []).map(task => {
      const current = state?.tasks[task.id];
      const observed = this.gateMeasurements.get(task.id);
      const evidence = state?.evidence.filter(item => item.taskId === task.id) ?? [];
      const interactive = (kind: string | undefined): boolean => ['web', 'tui', 'desktop'].includes(kind ?? '');
      const gates: DashboardGate[] = [
        { id: 'G0', status: current?.status === 'editing' ? 'running' : 'pending', detail: 'Sessão do agente.' },
        { id: 'G1', status: current?.status === 'editing' ? 'running' : current?.changedFiles.length ? 'complete' : current?.status === 'complete' ? 'neutral' : 'pending', detail: 'Escrita observada; ausência de alteração não reprova a unidade.' },
        { id: 'G2', status: 'pending', detail: 'Verificações mecânicas pertinentes.' },
        { id: 'G3', status: current?.status === 'reviewing' ? 'running' : current?.status === 'complete' ? 'complete' : 'pending', detail: 'Revisão independente do comportamento e das evidências.' },
      ];
      if (task.checks.some(check => interactive(check.kind)) || evidence.some(item => interactive(item.kind)) || observed?.has('G4')) gates.push({ id: 'G4', status: 'pending', detail: 'Fluxos exercitados na aplicação.' });
      for (const gate of gates) {
        if (gate.id === 'G2' || gate.id === 'G4') {
          const flow = gate.id === 'G4';
          const checks = task.checks.filter(check => interactive(check.kind) === flow);
          const proofs = evidence.filter(item => interactive(item.kind ?? task.checks.find(check => check.id === item.checkId)?.kind) === flow);
          // The UI reads recorded evidence. It never schedules a check to fill a dot.
          if (!checks.length && !proofs.length) gate.status = 'neutral';
          else if (current?.status !== 'editing' && !(current?.status === 'pending' && current.findings.length)) {
            const latest = [...new Map(proofs.map(proof => [proof.checkId, proof])).values()];
            if (latest.some(proof => !proof.passed)) gate.status = 'returned';
            else if (latest.length && checks.every(check => latest.some(proof => proof.checkId === check.id && proof.passed))) gate.status = 'complete';
          }
        }
        const measured = observed?.get(gate.id);
        if (measured) {
          const outdated = current && measured.attempt < current.attempts;
          gate.status = outdated && measured.status !== 'returned' ? 'pending' : measured.status;
          if (measured.detail) gate.detail = measured.detail;
        }
      }
      return { taskId: task.id, title: task.title, gates };
    });
  }

  private phases(state: BuildState | undefined): DashboardPhase[] {
    const tasks = this.saved.plan?.tasks ?? [];
    const rows = new Map(this.gateRows(state).map(row => [row.taskId, row]));
    const remaining = new Set(tasks.map(task => task.id));
    const phases: DashboardPhase[] = [];
    while (remaining.size) {
      const ready = tasks.filter(task => remaining.has(task.id) && task.dependsOn.every(id => !remaining.has(id)));
      // An incomplete or invalid saved plan must remain visible. Group its
      // unresolved remainder without changing or trying to repair the engine.
      const layer = ready.length ? ready : tasks.filter(task => remaining.has(task.id));
      const threads = layer.map((task, index): DashboardThread => ({ id: `T${String(index + 1).padStart(2, '0')}`, ...rows.get(task.id)! }));
      const gates: DashboardGate[] = [];
      for (const id of ['G0', 'G1', 'G2', 'G3', 'G4'] as const) {
        const observed = threads.flatMap(thread => thread.gates.filter(gate => gate.id === id));
        if (!observed.length) continue;
        const applicable = observed.filter(gate => gate.status !== 'neutral');
        const status: DashboardGate['status'] = !applicable.length ? 'neutral'
          : applicable.some(gate => gate.status === 'returned') ? 'returned'
            : applicable.some(gate => gate.status === 'running') ? 'running'
              : applicable.every(gate => gate.status === 'complete') ? 'complete'
                : applicable.some(gate => gate.status === 'waiting') ? 'waiting' : 'pending';
        gates.push({ id, status, detail: 'Resumo das threads aplicáveis desta fase.' });
      }
      phases.push({ id: `P${String(phases.length + 1).padStart(2, '0')}`, gates, threads });
      for (const task of layer) remaining.delete(task.id);
    }
    return phases;
  }

  private observeProgress(progress: DashboardProgress): void {
    if (!progress.id || !progress.label || !['running', 'complete', 'waiting'].includes(progress.status)) return;
    const next: DashboardProgress = { id: progress.id, label: progress.label, status: progress.status };
    if (number(progress.completed)) next.completed = progress.completed;
    if (number(progress.total)) next.total = progress.total;
    if (progress.stage) next.stage = progress.stage;
    if (progress.unit) next.unit = progress.unit;
    this.measurements.set(next.id, next);
  }

  private observeUsage(result: Record<string, unknown> | undefined): void {
    if (!result) return;
    if (typeof result.id === 'string') {
      if (this.eventResults.has(result.id)) return;
      this.eventResults.add(result.id);
    }
    this.usage.calls += 1;
    const usage = record(result.usage);
    if (!usage) return;
    if (number(usage.inputTokens) && number(usage.outputTokens)) this.usage.currentTokens = usage.inputTokens + usage.outputTokens;
    for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'costUsd'] as const) {
      const value = usage[key];
      if (number(value)) this.usage[key] = (this.usage[key] ?? 0) + value;
    }
  }

  private progress(state: BuildState | undefined): DashboardProgress[] {
    const { brief, plan } = this.saved;
    const waiting = this.saved.status === 'waiting' || this.saved.status === 'recovering';
    const working = this.saved.status === 'working';
    const buildWaiting = waiting || (!state && (!working || !['build', 'run'].includes(this.saved.stage ?? '')));
    const result = new Map<string, DashboardProgress>();
    result.set('brief', stateProgress('brief', 'Descoberta do produto', brief?.status === 'ready' ? 'complete' : brief?.status === 'waiting' || waiting || !working ? 'waiting' : 'running', 'init'));
    if (brief || plan || ['plan', 'build', 'run'].includes(this.saved.stage ?? '')) result.set('plan', stateProgress('plan', 'Planejamento', plan?.status === 'ready' ? 'complete' : waiting || brief?.status !== 'ready' || !working ? 'waiting' : 'running', 'plan'));
    if (brief?.gaps.length) result.set('gaps', countProgress('gaps', 'Decisões do produto', brief.gaps.filter(gap => gap.status === 'resolved').length, brief.gaps.length, true, 'init', 'decisões'));
    if (plan) {
      result.set('environment', countProgress('environment', 'Ambiente', plan.environment.filter(node => state?.environment[node.id]?.ready).length, plan.environment.length, buildWaiting, 'build', 'dependências'));
      result.set('tasks', countProgress('tasks', 'Unidades de trabalho', plan.tasks.filter(task => state?.tasks[task.id]?.status === 'complete').length, plan.tasks.length, buildWaiting, 'build', 'unidades'));
      const checks = plan.tasks.flatMap(task => task.checks.map(check => ({ taskId: task.id, checkId: check.id })));
      const passed = checks.filter(check => state?.evidence.findLast(item => item.taskId === check.taskId && item.checkId === check.checkId)?.passed).length;
      result.set('verification', countProgress('verification', 'Verificações', passed, checks.length, buildWaiting, 'build', 'verificações'));
    }
    for (const [id, measurement] of this.measurements) result.set(id, { ...measurement });
    return [...result.values()];
  }

  snapshot(): DashboardView {
    const { brief, plan, pendingQuestion } = this.saved;
    const state = execution(this.saved);
    const progress = this.progress(state);
    const phases = this.phases(state);
    const gateSymbols = { pending: '○', waiting: '○', neutral: '○', running: '◐', complete: '●', returned: '⊗' };
    const gateText = (gates: readonly DashboardGate[]): string => gates.map(gate => `${gate.id}${gateSymbols[gate.status]}`).join(' ');
    const progressLines = phases.flatMap(phase => [`${phase.id} ${gateText(phase.gates)}`, ...phase.threads.map(thread => `  ${thread.id} ${gateText(thread.gates)}`)]);
    const summary = [`Estado: ${label(this.saved.status, 'Aguardando execução')}`, `Etapa: ${this.saved.stage ?? 'Não iniciada'}`];
    add(summary, 'Diretório: ', this.workspace);
    add(summary, 'Última gravação: ', this.saved.updatedAt);
    add(summary, 'Pedido: ', this.saved.request ?? brief?.request);
    add(summary, 'Resumo: ', brief?.summary);
    if (brief) {
      summary.push(`Produto: ${label(brief.status)} · revisão ${brief.revision}`, `Modalidades: ${brief.modes.join(', ')}`, `Plataformas: ${brief.targets.join(', ')}`);
      for (const requirement of brief.requirements) summary.push(...lines(`Requisito ${requirement.id} [${requirement.mode}]: ${requirement.statement}`), ...lines(`  Origem (${requirement.source.reference}): ${requirement.source.text}`));
      for (const constraint of brief.constraints) summary.push(...lines(`Restrição ${constraint.id}: ${constraint.statement}`), ...lines(`  Origem (${constraint.source.reference}): ${constraint.source.text}`), `  Capacidades exigidas: ${constraint.requiredCapabilities.join(', ') || 'Nenhuma'}`, `  Capacidades proibidas: ${constraint.forbiddenCapabilities.join(', ') || 'Nenhuma'}`);
      for (const decision of brief.decisions) summary.push(...lines(`Decisão ${decision.id} (${decision.questionId}): ${decision.fact}`), ...lines(`  Resposta: ${decision.answer}`));
      for (const gap of brief.gaps) summary.push(...lines(`Decisão ${gap.id} · ${label(gap.status)}: ${gap.question}`), ...lines(`  Motivo: ${gap.reason}`), ...lines(`  Impacto: ${gap.impact}`), `  Bloqueia: ${gap.blocks.join(', ') || 'Nenhuma unidade'}`);
    }
    if (pendingQuestion) summary.push('Pergunta aguardando resposta:', ...lines(pendingQuestion.question), ...lines(`Motivo: ${pendingQuestion.reason}`), ...lines(`Impacto: ${pendingQuestion.impact}`), ...pendingQuestion.options.flatMap(option => lines(`• ${option}`)));
    const pendingDecisions = brief?.gaps.filter(gap => gap.status === 'pending').length ?? (pendingQuestion ? 1 : 0);
    const summaryPreview = [`Estado: ${label(this.saved.status, 'Aguardando execução')}`, `Etapa: ${this.saved.stage ?? 'Não iniciada'}`, ...(this.workspace ? [`Diretório: ${oneLine(this.workspace)}`] : []), `Requisitos: ${brief?.requirements.length ?? 0} · Decisões pendentes: ${pendingDecisions}`, ...(brief ? [`Modalidades: ${brief.modes.join(', ')} · Plataformas: ${brief.targets.join(', ')}`] : [])];
    const phaseLines = [`Descoberta: ${label(brief?.status, 'Não iniciada')}`, `Planejamento: ${label(plan?.status, 'Não iniciado')}`];
    const phasePreview = plan?.tasks.length ? plan.tasks.map(task => `${task.id} · ${oneLine(task.title)} · ${label(state?.tasks[task.id]?.status, 'Pendente')} · ${task.criteria.length} critério(s)`) : [...phaseLines];
    if (plan) {
      phaseLines.push(`Revisão do plano: ${plan.revision}`);
      for (const task of plan.tasks) {
        const current: TaskProgress | undefined = state?.tasks[task.id];
        phaseLines.push('', ...lines(`${task.id} · ${task.title} · ${label(current?.status, 'Pendente')}`), ...lines(`Objetivo: ${task.goal}`), ...lines(`Instruções: ${task.instructions}`), `Requisitos: ${task.requirementIds.join(', ') || 'Nenhum'}`, `Depende de: ${task.dependsOn.join(', ') || 'Nenhuma unidade'}`, `Ambiente: ${task.environmentIds.join(', ') || 'Nenhum'}`, `Contratos: ${task.contractIds.join(', ') || 'Nenhum'}`, `Bloqueado por: ${task.blockedBy.join(', ') || 'Nenhuma decisão'}`, `Risco: ${task.risk}`, `Arquivos previstos: ${task.files.join(', ') || 'Nenhum'}`);
        for (const criterion of task.criteria) phaseLines.push(...lines(`Critério: ${criterion}`));
        for (const check of task.checks) phaseLines.push(...lines(`Verificação ${check.id}: ${json(check)}`));
        if (current) {
          phaseLines.push(`Tentativas: ${current.attempts}`, ...lines(`Estratégia: ${current.strategy}`), `Arquivos alterados: ${current.changedFiles.join(', ') || 'Nenhum'}`);
          for (const finding of current.findings) phaseLines.push(...lines(`Achado: ${finding}`));
          add(phaseLines, 'Assinatura da falha: ', current.failureSignature);
        }
      }
      for (const contract of plan.contracts) phaseLines.push('', ...lines(`Contrato ${contract.id} · ${contract.name}: ${contract.description}`), `Entradas: ${contract.inputs.join(', ')}`, `Saídas: ${contract.outputs.join(', ')}`, `Requisitos: ${contract.requirementIds.join(', ')}`);
    }
    const environmentLines: string[] = [];
    const environmentPreview: string[] = [];
    for (const node of plan?.environment ?? []) {
      const ready = state?.environment[node.id]?.ready;
      environmentPreview.push(`${node.id} · ${oneLine(node.name)} · ${ready ? 'Pronto' : 'Pendente'}`);
      environmentLines.push(...lines(`${node.id} · ${node.name} · ${ready ? 'Pronto' : 'Pendente'}`), `Tipo: ${node.kind}`, `Plataformas: ${node.targets.join(', ')}`, `Depende de: ${node.dependsOn.join(', ') || 'Nenhuma dependência'}`, ...lines(`Motivo: ${node.reason}`), ...lines(`Verificar: ${command(node.check)}`));
      for (const recipe of node.prepare) environmentLines.push(...lines(`Preparar: ${command(recipe)}`));
      environmentLines.push('');
    }
    if (!environmentLines.length) environmentLines.push('Nenhuma dependência de ambiente registrada.');
    const activity = [...configLines('Agente', this.saved.config), ...configLines('Revisor', this.saved.reviewer), `Instalação de sistema: ${this.saved.allowSystemInstall === undefined ? 'Não informada' : this.saved.allowSystemInstall ? 'Permitida' : 'Desativada'}`, `Chamadas reportadas: ${this.usage.calls}`, `Tokens da última chamada: ${this.usage.currentTokens ?? 'Não reportados'}`, `Tokens de entrada: ${this.usage.inputTokens ?? 'Não reportados'}`, `Tokens de saída: ${this.usage.outputTokens ?? 'Não reportados'}`, `Tokens em cache: ${this.usage.cachedInputTokens ?? 'Não reportados'}`, `Custo reportado (USD): ${this.usage.costUsd ?? 'Não reportado'}`, ...this.activityLines];
    const agentPreview = (title: string, config: AgentConfig | undefined): string => `${title}: ${config ? [config.provider, config.model, config.effort].filter((value): value is string => Boolean(value)).map(oneLine).join(' · ') : 'Não configurado'}`;
    const activityPreview = [agentPreview('Agente', this.saved.config), agentPreview('Revisor', this.saved.reviewer), `Atual: ${this.latestActivity ?? 'Nenhuma chamada observada'}`, `Chamadas: ${this.usage.calls} · Tokens da última: ${this.usage.currentTokens ?? 'Não reportados'}`, `Entrada: ${this.usage.inputTokens ?? 'Não reportada'} · Saída: ${this.usage.outputTokens ?? 'Não reportada'}`, `Custo reportado (USD): ${this.usage.costUsd ?? 'Não reportado'}`];
    if (state?.metrics) {
      const metrics = state.metrics;
      activityPreview.push(`Concorrência: ${metrics.active} ativa(s) · máximo observado: ${metrics.maxConcurrency}`);
      activity.push(`Concorrência atual: ${metrics.active} · máximo: ${metrics.maxConcurrency}`, `Tempo observado: ${metrics.elapsedMs} ms`, `Chamadas por papel: ${json(metrics.callsByRole)}`, `Tempo por etapa: ${json(metrics.timeByStageMs)}`, `Invalidações: ${metrics.invalidations.length}`, `Repetições justificadas/suspensões: ${metrics.repetitions.length}`);
    }
    const incidents: string[] = [];
    if (this.latestRecovery) incidents.push(...lines(`Recuperação: ${this.latestRecovery}`));
    for (const incident of state?.incidents ?? []) incidents.push(...lines(`${incident.id} · ${incident.kind} · ${incident.subject}`), ...lines(incident.message), ...lines(`Evidência: ${incident.evidence}`), ...lines(`Ação: ${incident.action}`), `Recurso externo: ${incident.external ? 'Sim' : 'Não'}`, ...(incident.contextChars === undefined ? [] : [`Contexto disponível: ${incident.contextChars} caracteres`]), '');
    for (const evidence of state?.evidence ?? []) incidents.push(...lines(`${evidence.passed ? 'Verificação aprovada' : 'Verificação reprovada'}: ${evidence.taskId}/${evidence.checkId}`), ...lines(`Comando: ${evidence.command}`), ...lines(evidence.output), `Executada em: ${evidence.checkedAt}`);
    if (!incidents.length) incidents.push('Nenhum incidente registrado.');
    const panel = (id: DashboardPanelId, title: string, content: string[], bars: DashboardProgress[] = [], previewLines?: string[]): DashboardPanel => ({ id, title, lines: content, progress: bars, ...(previewLines ? { previewLines } : {}) });
    const panels = [
      panel('summary', 'Resumo', summary, [], summaryPreview),
      { ...panel('progress', 'Progresso', progressLines), phases },
      panel('phases', 'Fases e unidades', phaseLines, progress.filter(item => ['brief', 'plan', 'tasks', 'verification', 'gaps'].includes(item.id) || item.id.startsWith('task:') || item.stage === 'plan' || item.stage === 'init'), phasePreview),
      panel('environment', 'Ambiente', environmentLines, progress.filter(item => item.id === 'environment' || item.id.startsWith('environment:')), environmentPreview.length ? environmentPreview : [...environmentLines]),
      panel('activity', 'Agentes e atividade', activity, progress.filter(item => item.id.startsWith('agent:')), activityPreview),
      panel('log', 'Log completo', [...this.logLines]),
      panel('incidents', 'Incidentes e evidências', incidents),
    ];
    return { status: this.saved.status ?? 'waiting', stage: this.saved.stage ?? 'idle', panels, progress, usage: { ...this.usage }, pendingDecisions, ...(pendingQuestion ? { pendingQuestion } : {}), ...(this.saved.updatedAt ? { updatedAt: this.saved.updatedAt } : {}) };
  }

  panel(id: DashboardPanelId): DashboardPanel { return this.snapshot().panels.find(item => item.id === id)!; }
}
