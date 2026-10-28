import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInit, runPlan, repairWorkPlan } from '../domain/index.js';
import { validatePlan } from '../domain/reconcile.js';
import type { ProductBrief, DomainAgentRequest, DevelopmentPlan, SelectedDocument, Question } from '../domain/types.js';
import { runAgent } from '../runtime/index.js';
import type { AgentConfig, AgentRequest, AgentResult } from '../runtime/types.js';
import { runBuild } from '../execution/index.js';
import type { BuildState } from '../execution/types.js';
import { ProjectStore } from './store.js';
import { readSettings } from './settings.js';
import { questionChannel } from './questions.js';
import { Cancelled, RecoverySuspended, recoverOperation, waitForRecovery } from './recovery.js';
import { digest } from '../execution/files.js';
import { emitEvent, type ProgressMeasurement, type BuildGateMeasurement } from '../telemetry/progress.js';
import type { SavedProject } from './store.js';

export interface WorkflowEvent {
  type: string;
  message?: string;
  subject?: string;
  detail?: unknown;
  progress?: ProgressMeasurement;
  gate?: BuildGateMeasurement;
  at?: string;
}

export interface WorkflowOptions {
  workspace: string;
  stage: 'init' | 'plan' | 'build' | 'run';
  request?: string;
  documents?: SelectedDocument[];
  config?: AgentConfig;
  reviewer?: AgentConfig;
  allowSystemInstall?: boolean;
  maxConcurrent?: number;
  retrySuspended?: boolean;
  signal: AbortSignal;
  announce?: (message: string) => void;
  onEvent?: (event: WorkflowEvent) => void;
  onState?: (state: SavedProject) => void;
  ask?: (question: Question) => Promise<string | null>;
  agent?: typeof runAgent;
  /** The CLI can retain one ownership lease while preparing remote inputs and constructing. */
  store?: ProjectStore;
}

/** Discovery sees a short inventory, not all of an existing project's source. */
async function inventory(workspace: string, includeSelectedInputs: boolean): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string, depth: number): Promise<void> => {
    for (const item of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (item.name.startsWith('.') || ['node_modules', 'vendor', 'dist', 'build', 'target', '__pycache__'].includes(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory() && depth < 2 && files.length < 160) await walk(path, depth + 1);
      else if (item.isFile() && files.length < 160) files.push(path.slice(workspace.length + 1));
    }
  };
  await walk(workspace, 0);
  const manifests: string[] = [];
  for (const file of ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'requirements.txt']) {
    const text = await readFile(join(workspace, file), 'utf8').catch(() => '');
    if (text) manifests.push(`${file}:\n${text.slice(0, 4000)}`);
  }
  const inputs = includeSelectedInputs ? await readFile(join(workspace, '.project-inputs/index.json'), 'utf8').catch(() => '') : '';
  return `${files.join('\n')}\n${manifests.join('\n')}\n${inputs ? `Selected data-center input paths (read original contents when relevant):\n${inputs.slice(0, 2000)}` : ''}`.slice(0, 10_000);
}

/** Product rules stay separate from a technical inventory; literal origins remain available. */
async function repositoryRules(workspace: string, request: string): Promise<{ text: string; reference: string }[]> {
  const named = [...request.matchAll(/(?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]+\.(?:md|txt|rst)\b/gu)].map(match => match[0]);
  const paths = [...new Set(['AGENTS.md', 'README.md', 'REQUIREMENTS.md', 'requisitos.md', 'SPEC.md', ...named])];
  const documents: { text: string; reference: string }[] = [];
  for (const reference of paths) {
    const path = resolve(workspace, reference), rel = relative(workspace, path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) continue;
    const text = await readFile(path, 'utf8').catch(() => '');
    if (text && !text.startsWith('> Registro histórico')) documents.push({ text, reference });
  }
  return documents;
}

async function workflowAttempt(options: WorkflowOptions): Promise<{ status: string; brief?: ProductBrief; plan?: DevelopmentPlan }> {
  const workspace = resolve(options.workspace);
  await mkdir(workspace, { recursive: true });
  const store = options.store ?? new ProjectStore(workspace);
  const publish = (detail: WorkflowEvent): void => {
    const event = { ...detail, at: detail.at ?? new Date().toISOString() };
    store.event(detail.type, event);
    emitEvent(options.onEvent, event);
  };
  const announce = (message: string): void => {
    publish({ type: 'message', message });
    try { options.announce?.(message); } catch { /* Observer cannot end execution. */ }
  };
  const persist = async (patch: Parameters<ProjectStore['update']>[0]): Promise<void> => {
    // Cancellation stops agent work, not the final durable commit of its effects and checkpoint.
    const state = store.update(patch); emitEvent(options.onState, state);
  };
  try {
    while (!store.claim()) {
      announce('Outra execução já trabalha neste projeto; aguardando sua liberação sem disputar arquivos.');
      await waitForRecovery(2000, options.signal);
    }
    const settings = await readSettings();
    const saved = store.read();
    const workflowMetrics = saved.workflowMetrics ?? { timeByStageMs: {}, callsByRole: {}, activeAgents: 0, maxConcurrency: 0 };
    workflowMetrics.activeAgents = 0;
    const timed = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      try { return await operation(); }
      finally { workflowMetrics.timeByStageMs[stage] = (workflowMetrics.timeByStageMs[stage] ?? 0) + Date.now() - start; await persist({ workflowMetrics }); }
    };
    let config = options.config ?? saved.config ?? settings.agent;
    if (!config?.provider) throw new Error('Escolha o agente com --provider ou capivara config --provider. Nenhuma chamada de modelo foi feita.');
    let reviewer = options.reviewer ?? saved.reviewer ?? settings.reviewer ?? config;
    const contextBudget = (): number => {
      const available = [config!, reviewer].map(value => {
        if (!value.contextTokens) return 24_000;
        const output = value.maxOutputTokens ?? Math.min(4096, Math.floor(value.contextTokens / 4));
        value.maxOutputTokens ??= output;
        return Math.max(2000, Math.floor((value.contextTokens - output - 1000) * 2));
      });
      return Math.min(24_000, ...available);
    };
    let allowSystemInstall = options.allowSystemInstall ?? saved.allowSystemInstall ?? settings.allowSystemInstall ?? false;
    let settingsRevision = JSON.stringify(settings);
    const refreshSettings = async (): Promise<void> => {
      const changed = await readSettings();
      const revision = JSON.stringify(changed);
      if (revision === settingsRevision) return;
      settingsRevision = revision;
      if (changed.agent) config = changed.agent;
      if (changed.reviewer) reviewer = changed.reviewer;
      if (changed.allowSystemInstall !== undefined) allowSystemInstall = changed.allowSystemInstall;
      await persist({ config: config!, reviewer, allowSystemInstall });
    };
    const maxConcurrent = options.maxConcurrent ?? saved.maxConcurrent ?? settings.maxConcurrent ?? 2;
    await persist({ config, reviewer, allowSystemInstall, maxConcurrent, lastFailure: null, status: 'working', stage: options.stage });
    const ask = questionChannel(store, options.signal, announce, options.ask);
    const agent = options.agent ?? runAgent;
    const event = (detail: WorkflowEvent): void => {
      publish(detail);
      if (detail.message && !['output', 'progress'].includes(detail.type)) {
        try { options.announce?.(detail.message); } catch { /* Observation cannot end execution. */ }
      }
    };
    const invoke = async (request: Omit<AgentRequest, 'config'>): Promise<AgentResult> => {
      await refreshSettings();
      const selected = request.readOnly && request.role === 'reviewer' ? reviewer : config!;
      const id = randomUUID();
      const callDirectory = join(store.directory, 'calls');
      try {
        await mkdir(callDirectory, { recursive: true, mode: 0o700 });
        await writeFile(join(callDirectory, `${id}.input.txt`), `${request.instruction}\n${request.context ?? ''}`, { mode: 0o600 });
      } catch { /* Auxiliary transcripts cannot prevent execution. */ }
      const progress = { id: `agent:${id}`, label: `${request.role} · ${selected.provider}${selected.model ? ` / ${selected.model}` : ''}`, stage: store.read().stage ?? options.stage };
      event({ type: 'agent.start', message: `Agente ${request.role} em execução.`, detail: { id, role: request.role, provider: selected.provider, model: selected.model } });
      event({ type: 'progress', progress: { ...progress, status: 'running' } });
      const started = Date.now();
      workflowMetrics.activeAgents++; workflowMetrics.maxConcurrency = Math.max(workflowMetrics.maxConcurrency, workflowMetrics.activeAgents);
      workflowMetrics.callsByRole[request.role] = (workflowMetrics.callsByRole[request.role] ?? 0) + 1;
      await persist({ workflowMetrics });
      try {
        const operationKey = request.operationKey ?? digest(JSON.stringify({ role: request.role, instruction: request.instruction, context: request.context, config: selected }));
        const result = await agent({ ...request, operationKey, config: selected, signal: options.signal, onEvent: event });
        event({ type: 'agent.result', detail: { id, role: request.role, status: result.status, usage: result.usage, issue: result.issue } });
        event({ type: 'progress', progress: { ...progress, status: result.status === 'complete' ? 'complete' : 'waiting' } });
        await writeFile(join(callDirectory, `${id}.result.json`), JSON.stringify(result, null, 2), { mode: 0o600 }).catch(() => undefined);
        return result;
      } catch (error) {
        event({ type: 'progress', progress: { ...progress, status: 'waiting' } });
        throw error;
      } finally {
        workflowMetrics.activeAgents--;
        workflowMetrics.timeByStageMs[`agent:${request.role}`] = (workflowMetrics.timeByStageMs[`agent:${request.role}`] ?? 0) + Date.now() - started;
        await persist({ workflowMetrics });
      }
    };
    const domainCalls = { ...saved.domainCalls };
    const retriedDomain = new Set<string>();
    const domainAgent = async (request: DomainAgentRequest): Promise<string> => recoverOperation(async () => {
      const key = digest(JSON.stringify({ operation: request.operation, prompt: request.prompt, config }));
      const previous = domainCalls[key];
      if (previous?.status === 'complete' && previous.result !== undefined) {
        event({ type: 'reuse', message: `Resultado de ${request.operation} reaproveitado: entrada, configuração e resposta persistidas.`, detail: { key } });
        return previous.result;
      }
      if (previous && !(options.retrySuspended && previous.status === 'failed' && !retriedDomain.has(key))) throw new RecoverySuspended(`A operação ${request.operation} já foi suspensa com a mesma entrada. Corrija o recurso ou a configuração; --retry-suspended permite uma nova sondagem explícita de transporte.`, 1, previous.failure ?? 'The preceding call has no durable result.');
      if (previous) retriedDomain.add(key);
      domainCalls[key] = { operation: request.operation, status: 'running', at: new Date().toISOString() };
      await persist({ domainCalls });
      const result = await invoke({ workspace, role: request.operation === 'discover' ? 'analyst' : 'planner', instruction: request.prompt, readOnly: true, constraints: { allowSystemInstall: false } });
      if (result.status === 'cancelled') throw new Cancelled();
      if ((result.status === 'complete' || result.status === 'partial') && !result.issue && result.text.trim()) {
        domainCalls[key] = { operation: request.operation, status: 'complete', result: result.text, at: new Date().toISOString() };
        await persist({ domainCalls }); return result.text;
      }
      const failure = result.issue?.message || 'O agente não entregou conteúdo utilizável.';
      domainCalls[key] = { operation: request.operation, status: 'failed', failure, at: new Date().toISOString() };
      await persist({ domainCalls }); throw new Error(failure);
    }, {
      signal: options.signal,
      announce,
      recover: async () => {
        const before = settingsRevision;
        await persist({ status: 'recovering' });
        // An explicit configuration update in another terminal can recover authentication/routing.
        await refreshSettings();
        return before !== settingsRevision;
      },
      progressKey: () => settingsRevision,
    });
    const hooks = {
      get contextChars(): number { return contextBudget(); },
      agent: domainAgent,
      ask,
      save: async (patch: { brief?: ProductBrief; plan?: DevelopmentPlan }): Promise<void> => { await persist(patch); },
      onEvent: event,
      signal: options.signal,
    };
    const documents = options.documents ?? saved.dataCenter?.documents ?? [];
    const request = options.request ?? saved.request ?? saved.brief?.request;
    if (!request?.trim()) throw new Error('Falta o pedido do produto. Informe texto ou --file; nenhuma chamada foi feita.');
    await persist({ request });
    const repository = await inventory(workspace, documents.length > 0);
    const repositoryConstraints = await repositoryRules(workspace, request);
    let brief = saved.brief;
    const answeredGaps = (): boolean => !!brief?.gaps.some(gap => {
      const answer = store.getAnswer(gap.id);
      return answer !== undefined && (gap.status === 'pending' || answer !== brief?.decisions.find(decision => decision.questionId === gap.id)?.answer);
    });
    const reopenChangedAnswers = (): void => {
      for (const gap of brief?.gaps ?? []) {
        const answer = store.getAnswer(gap.id);
        if (answer !== undefined && answer !== brief?.decisions.find(decision => decision.questionId === gap.id)?.answer) gap.status = 'pending';
      }
    };
    reopenChangedAnswers();
    // Reconcile answers and local rules without a model call when discovery is already ready.
    brief = await timed('init', () => runInit({ ...hooks, request, documents, repository, repositoryConstraints, ...(brief ? { existing: brief } : {}) }));
    await persist({ brief });
    if (options.stage === 'init') { await persist({ status: brief.gaps.some(g => g.status === 'pending') ? 'waiting' : 'complete' }); return { status: store.read().status!, brief }; }
    const productChanged = saved.brief !== undefined && saved.brief.id !== brief.id || saved.plan !== undefined && saved.plan.briefId !== brief.id;
    let plan = productChanged ? undefined : saved.plan;
    if (productChanged) await persist({ execution: null, pendingQuestion: null });
    if (!plan || plan.status !== 'ready' || plan.briefId !== brief.id || plan.briefRevision !== brief.revision || validatePlan(brief, plan).length) {
      plan = await timed('plan', () => runPlan({ ...hooks, brief: brief!, repository, repositoryConstraints, ...(plan ? { existing: plan } : {}) }));
      await persist({ plan });
    }
    if (options.stage === 'plan') { await persist({ status: 'complete' }); return { status: 'complete', brief, plan }; }
    for (;;) {
      if (options.signal.aborted) throw new Cancelled();
      const state = store.read().execution as BuildState | undefined;
      const outcome = await timed('build', () => recoverOperation(() => runBuild({
        workspace, brief: brief!, plan: plan!, agent: invoke, allowSystemInstall, maxConcurrent, retrySuspended: options.retrySuspended === true, configurationRevision: digest(JSON.stringify({ config, reviewer, allowSystemInstall })), signal: options.signal, contextChars: contextBudget(),
        ...(state ? { state } : {}),
        onEvent: event,
        onState: async next => { await persist({ execution: next }); },
        repairPlan: async (incident, task) => {
          plan = await repairWorkPlan({ ...hooks, contextChars: incident.contextChars ?? contextBudget(), brief: brief!, plan: plan!, taskId: task.id, problem: `${incident.message}\n${incident.evidence}\n${incident.action}` });
          await persist({ plan });
          return plan;
        },
      }), { signal: options.signal, announce }));
      plan = outcome.plan;
      await persist({ plan, execution: outcome.state, status: outcome.status === 'cancelled' ? 'cancelled' : outcome.status === 'complete' ? 'working' : 'waiting' });
      if (answeredGaps()) {
        reopenChangedAnswers();
        brief = await timed('init', () => runInit({ ...hooks, request, documents, repository, repositoryConstraints, existing: brief! }));
        plan = await timed('plan', () => runPlan({ ...hooks, brief: brief!, repository, repositoryConstraints, existing: plan! }));
        await persist({ brief, plan, status: 'working' });
        continue;
      }
      if (outcome.status === 'complete' && !brief.gaps.some(gap => gap.status === 'pending')) { await persist({ status: 'complete' }); announce('Aplicação concluída com as verificações pertinentes registradas.'); return { status: 'complete', brief, plan }; }
      if (outcome.status === 'complete') await persist({ status: 'waiting' });
      if (outcome.status === 'cancelled') throw new Cancelled();
      announce('Não há outra ação executável com os insumos e recursos atuais. Pendências e tentativas estão registradas; trabalho independente concluído foi preservado.');
      return { status: 'waiting', brief, plan };
    }
  } catch (error) {
    if (options.signal.aborted || error instanceof Cancelled) {
      try { store.update({ status: 'cancelled' }); } catch { /* Last committed work remains. */ }
      announce('Interrupção solicitada; trabalho preservado.');
      return { status: 'cancelled' };
    }
    throw error;
  } finally { if (!options.store) store.close(); }
}

/** Module failures become explicit durable suspensions, never a replay of the entire workflow. */
export async function runWorkflow(options: WorkflowOptions): Promise<{ status: string; brief?: ProductBrief; plan?: DevelopmentPlan }> {
  try {
    return await workflowAttempt(options);
  } catch (error) {
    if (options.signal.aborted || error instanceof Cancelled) return { status: 'cancelled' };
    const metadata = error !== null && typeof error === 'object' ? error as { kind?: string; fingerprint?: string } : {};
    const kind = error instanceof RecoverySuspended ? 'no-progress' : metadata.kind ?? 'controller';
    const message = error instanceof Error ? error.message : String(error);
    const fingerprint = metadata.fingerprint ?? digest(`${kind}:${message}`);
    const store = options.store ?? new ProjectStore(resolve(options.workspace));
    try {
      const state = store.update({ status: 'waiting', lastFailure: { kind, message, fingerprint, at: new Date().toISOString() } });
      store.event('suspended', { kind, message, fingerprint }); emitEvent(options.onState, state);
      emitEvent(options.onEvent, { type: 'waiting', message, detail: { kind, fingerprint } });
      try { options.announce?.(message); } catch { /* Observer only. */ }
      return { status: 'waiting', ...(state.brief ? { brief: state.brief } : {}), ...(state.plan ? { plan: state.plan } : {}) };
    } finally { if (!options.store) store.close(); }
  }
}
