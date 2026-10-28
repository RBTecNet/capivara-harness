import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInit, runPlan, repairWorkPlan } from '../domain/index.js';
import type { ProductBrief, DomainAgentRequest, DevelopmentPlan } from '../domain/types.js';
import { runAgent } from '../runtime/index.js';
import type { AgentConfig, AgentRequest, AgentResult } from '../runtime/types.js';
import { runBuild } from '../execution/index.js';
import type { BuildState } from '../execution/types.js';
import { ProjectStore } from './store.js';
import { readSettings } from './settings.js';
import { questionChannel } from './questions.js';
import { Cancelled, recoverOperation, waitForRecovery } from './recovery.js';

export interface WorkflowOptions {
  workspace: string;
  stage: 'init' | 'plan' | 'build' | 'run';
  request?: string;
  config?: AgentConfig;
  reviewer?: AgentConfig;
  allowSystemInstall?: boolean;
  signal: AbortSignal;
  announce?: (message: string) => void;
  agent?: typeof runAgent;
}

/** Discovery sees a short inventory, not all of an existing project's source. */
async function inventory(workspace: string): Promise<string> {
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
  return `${files.join('\n')}\n${manifests.join('\n')}`.slice(0, 10_000);
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
  const store = new ProjectStore(workspace);
  const announce = (message: string): void => {
    store.event('message', { message });
    try { options.announce?.(message); } catch { /* Observer cannot end execution. */ }
  };
  const persist = async (patch: Parameters<ProjectStore['update']>[0]): Promise<void> => {
    await recoverOperation(async () => { store.update(patch); }, { signal: options.signal, announce });
  };
  try {
    while (!store.claim()) {
      announce('Outra execução já trabalha neste projeto; aguardando sua liberação sem disputar arquivos.');
      await waitForRecovery(2000, options.signal);
    }
    const settings = await readSettings();
    const saved = store.read();
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
    await persist({ config, reviewer, allowSystemInstall, status: 'working', stage: options.stage });
    const ask = questionChannel(store, options.signal, announce);
    const agent = options.agent ?? runAgent;
    const event = (detail: { type: string; message: string }): void => {
      store.event(detail.type, detail);
      if (detail.type !== 'output') announce(detail.message);
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
      const result = await agent({ ...request, config: selected, signal: options.signal, onEvent: event });
      store.event('agent.result', { id, role: request.role, status: result.status, usage: result.usage, issue: result.issue });
      await writeFile(join(callDirectory, `${id}.result.json`), JSON.stringify(result, null, 2), { mode: 0o600 }).catch(() => undefined);
      return result;
    };
    const domainAgent = async (request: DomainAgentRequest): Promise<string> => recoverOperation(async () => {
      const result = await invoke({ workspace, role: request.operation === 'discover' ? 'analyst' : 'planner', instruction: request.prompt, readOnly: true, constraints: { allowSystemInstall: false } });
      if (result.status === 'cancelled') throw new Cancelled();
      if (result.issue?.kind === 'constraint') throw new Error(result.issue.message);
      if ((result.status === 'complete' || result.status === 'partial') && result.text.trim()) return result.text;
      throw new Error(result.issue?.message || 'O agente não entregou conteúdo; preservando o trabalho e recuperando o transporte.');
    }, {
      signal: options.signal,
      announce,
      recover: async () => {
        await persist({ status: 'recovering' });
        // An explicit configuration update in another terminal can recover authentication/routing.
        await refreshSettings();
      },
    });
    const hooks = {
      get contextChars(): number { return contextBudget(); },
      agent: domainAgent,
      ask,
      save: async (patch: { brief?: ProductBrief; plan?: DevelopmentPlan }): Promise<void> => { await persist(patch); },
      onEvent: event,
      signal: options.signal,
    };
    const request = options.request ?? saved.request ?? saved.brief?.request;
    if (!request?.trim()) throw new Error('Falta o pedido do produto. Informe texto ou --file; nenhuma chamada foi feita.');
    await persist({ request });
    const repository = await inventory(workspace);
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
    brief = await runInit({ ...hooks, request, repository, repositoryConstraints, ...(brief ? { existing: brief } : {}) });
    await persist({ brief });
    if (options.stage === 'init') { await persist({ status: brief.gaps.some(g => g.status === 'pending') ? 'waiting' : 'complete' }); return { status: store.read().status!, brief }; }
    const productChanged = saved.brief !== undefined && saved.brief.id !== brief.id || saved.plan !== undefined && saved.plan.briefId !== brief.id;
    let plan = productChanged ? undefined : saved.plan;
    if (productChanged) await persist({ execution: null, pendingQuestion: null });
    if (!plan || plan.status !== 'ready' || plan.briefId !== brief.id || plan.briefRevision !== brief.revision) {
      plan = await runPlan({ ...hooks, brief, repository, repositoryConstraints, ...(plan ? { existing: plan } : {}) });
      await persist({ plan });
    }
    if (options.stage === 'plan') { await persist({ status: 'complete' }); return { status: 'complete', brief, plan }; }
    for (;;) {
      if (options.signal.aborted) throw new Cancelled();
      const state = store.read().execution as BuildState | undefined;
      const outcome = await recoverOperation(() => runBuild({
        workspace, brief: brief!, plan: plan!, agent: invoke, allowSystemInstall, signal: options.signal, contextChars: contextBudget(),
        ...(state ? { state } : {}),
        onEvent: event,
        onState: async next => { await persist({ execution: next }); },
        repairPlan: async (incident, task) => {
          plan = await repairWorkPlan({ ...hooks, contextChars: incident.contextChars ?? contextBudget(), brief: brief!, plan: plan!, taskId: task.id, problem: `${incident.message}\n${incident.evidence}\n${incident.action}` });
          await persist({ plan });
          return plan;
        },
      }), { signal: options.signal, announce });
      plan = outcome.plan;
      await persist({ plan, execution: outcome.state, status: outcome.status === 'complete' ? 'complete' : outcome.status === 'cancelled' ? 'cancelled' : 'waiting' });
      if (answeredGaps()) {
        reopenChangedAnswers();
        brief = await runInit({ ...hooks, request, repository, repositoryConstraints, existing: brief });
        plan = await runPlan({ ...hooks, brief, repository, repositoryConstraints, existing: plan });
        await persist({ brief, plan, status: 'working' });
        continue;
      }
      if (outcome.status === 'complete' && !brief.gaps.some(gap => gap.status === 'pending')) { announce('Aplicação concluída com as verificações pertinentes registradas.'); return { status: 'complete', brief, plan }; }
      if (outcome.status === 'complete') await persist({ status: 'waiting' });
      if (outcome.status === 'cancelled') throw new Cancelled();
      announce('Execução preservada e ativa: recuperando as pendências, enquanto aguarda recursos externos quando necessário.');
      await refreshSettings();
      await waitForRecovery(10_000, options.signal);
    }
  } catch (error) {
    if (options.signal.aborted || error instanceof Cancelled) {
      try { store.update({ status: 'cancelled' }); } catch { /* Last committed work remains. */ }
      announce('Interrupção solicitada; trabalho preservado.');
      return { status: 'cancelled' };
    }
    throw error;
  } finally { store.close(); }
}

/** Recovery belongs to the coordinator, including unexpected failures between module boundaries. */
export async function runWorkflow(options: WorkflowOptions): Promise<{ status: string; brief?: ProductBrief; plan?: DevelopmentPlan }> {
  try {
    return await recoverOperation(() => workflowAttempt(options), {
      signal: options.signal,
      announce: message => { try { options.announce?.(message); } catch { /* Observation never owns the execution. */ } },
    });
  } catch (error) {
    if (options.signal.aborted || error instanceof Cancelled) return { status: 'cancelled' };
    throw error;
  }
}
