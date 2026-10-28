import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isApiProvider, runApiAgent } from './api.js';
import { executeCommand } from './command.js';
import { changedPaths, scrub, snapshotWorkspace } from './files.js';
import type { AgentRequest, AgentResult, RuntimeIssue, Usage } from './types.js';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

function emit(request: AgentRequest, message: string, detail?: unknown): void {
  try { request.onEvent?.({ type: 'agent', message, ...(detail !== undefined ? { detail } : {}) }); } catch { /* An observer cannot break development. */ }
}

function decodeOutput(stdout: string, provider: string): { text: string; usage?: Usage; sessionId?: string; failure?: string } {
  const messages: string[] = [];
  let usage: Usage | undefined, sessionId: string | undefined, failure: string | undefined;
  for (const line of stdout.split('\n')) {
    let event: Json;
    try { event = object(JSON.parse(line)); } catch { continue; }
    if (provider === 'codex') {
      if (event.type === 'thread.started') sessionId = text(event.thread_id) || undefined;
      const item = object(event.item);
      if (event.type === 'item.completed' && item.type === 'agent_message') messages.push(text(item.text));
      if (event.type === 'turn.completed') {
        const value = object(event.usage);
        usage = { inputTokens: number(value.input_tokens), outputTokens: number(value.output_tokens), cachedInputTokens: number(value.cached_input_tokens) };
      }
      if (event.type === 'turn.failed' || event.type === 'error') failure = text(object(event.error).message) || text(event.message) || 'A CLI informou uma falha de inferência.';
    } else if (provider === 'claude') {
      if (typeof event.result === 'string') messages.push(event.result);
      if (typeof event.session_id === 'string') sessionId = event.session_id;
      if (event.usage) { const value = object(event.usage); usage = { inputTokens: number(value.input_tokens), outputTokens: number(value.output_tokens), cachedInputTokens: number(value.cache_read_input_tokens), ...(typeof event.total_cost_usd === 'number' ? { costUsd: event.total_cost_usd } : {}) }; }
      if (event.is_error === true) failure = text(event.result) || 'A CLI Claude informou uma falha.';
    } else if (provider === 'opencode') {
      const part = object(event.part);
      if (event.type === 'text') messages.push(text(part.text));
      if (event.type === 'error') failure = text(object(event.error).message) || text(event.error);
      if (typeof event.sessionID === 'string') sessionId = event.sessionID;
      if (event.type === 'step_finish' && part.tokens) {
        const tokens = object(part.tokens), cache = object(tokens.cache);
        usage ??= { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 };
        usage.inputTokens += number(tokens.input); usage.outputTokens += number(tokens.output);
        usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + number(cache.read); usage.costUsd = (usage.costUsd ?? 0) + number(part.cost);
      }
    }
  }
  return { text: messages.filter(Boolean).join('\n'), ...(usage ? { usage } : {}), ...(sessionId ? { sessionId } : {}), ...(failure ? { failure } : {}) };
}

function cliIssue(message: string): RuntimeIssue {
  const kind = /prazo de operação|operação excedeu|timeout|timed out/i.test(message) ? 'transport' : /401|403|unauthori[sz]ed|not logged|authentication|api.?key|login required/i.test(message) ? 'authentication'
    : /429|rate.?limit|quota/i.test(message) ? 'rate-limit' : /context|too many tokens/i.test(message) ? 'context' : 'tool';
  return { kind, recoverable: kind !== 'authentication', message };
}

async function runCliAgent(request: AgentRequest): Promise<AgentResult> {
  const { config } = request;
  const directory = await mkdtemp(join(tmpdir(), 'capivara-agent-'));
  const answer = join(directory, 'answer.txt');
  try {
    let binary = config.command ?? config.provider;
    let args: string[];
    const environment = { ...config.environment };
    if (config.provider === 'codex') {
      binary = config.command ?? process.env.CAPIVARA_CODEX_BIN ?? 'codex';
      args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check', '--ephemeral', '--cd', request.workspace, '--output-last-message', answer];
      if (request.readOnly) args.push('--sandbox', 'read-only');
      else if (request.constraints?.allowSystemInstall === true) args.push('--dangerously-bypass-approvals-and-sandbox');
      else args.push('--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true');
      if (config.model) args.push('--model', config.model);
      if (config.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(config.effort)}`);
      args.push(...config.args ?? [], '-');
    } else if (config.provider === 'claude') {
      args = ['--print', '--output-format', 'json', '--bare', '--disallowedTools', 'mcp__*'];
      if (config.model) args.push('--model', config.model);
      if (config.effort) args.push('--effort', config.effort);
      if (request.readOnly) args.push('--restricted', '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep');
      else if (request.constraints?.allowSystemInstall === true) args.push('--permission-mode', 'bypassPermissions');
      else args.push('--restricted', '--tools', 'Read,Glob,Grep,Bash,Edit,Write', '--permission-mode', 'acceptEdits', '--settings', JSON.stringify({ sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, network: { allowedDomains: ['*'] } } }));
      args.push(...config.args ?? []);
    } else if (config.provider === 'opencode') {
      args = ['run', '--standalone', '--format', 'json', '--agent', request.readOnly ? 'plan' : 'build'];
      if (config.model) args.push('--model', `${config.model}${config.effort ? `#${config.effort}` : ''}`);
      environment.OPENCODE_PERMISSION = JSON.stringify(request.readOnly ? { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow' } : { '*': 'allow', external_directory: request.constraints?.allowSystemInstall === true ? 'allow' : 'deny' });
      args.push(...config.args ?? []);
    } else if (config.command) {
      if (request.readOnly) return { status: 'unavailable', text: '', changedFiles: [], commands: [], issue: { kind: 'configuration', recoverable: true, message: 'Uma CLI personalizada precisa de adaptador explícito de leitura para executar entrevistas sem efeitos. Use uma API direta ou a CLI Codex, Claude ou OpenCode.' } };
      args = [...config.args ?? []];
    } else return { status: 'unavailable', text: '', changedFiles: [], commands: [], issue: { kind: 'configuration', recoverable: true, message: `Provedor ${config.provider} não configurado como API nem CLI conhecida.` } };
    const instruction = [
      `Task role: ${request.role}. Workspace: ${request.workspace}.`,
      request.readOnly ? 'Read-only task. Return the requested answer without modifying product files.' : 'Implement the supplied task in this workspace. Report actual changes and observed verification results.',
      request.constraints?.forbiddenCapabilities?.length ? `Excluded product capabilities: ${request.constraints.forbiddenCapabilities.join(', ')}. Use verification compatible with these constraints.` : '',
      request.constraints?.allowSystemInstall === true ? '' : 'Install necessary dependencies locally in this workspace or an isolated project environment; system package installation is not authorized.',
      request.instruction, request.context,
    ].filter(Boolean).join('\n\n');
    emit(request, `Executando ${config.provider}${config.model ? ` / ${config.model}` : ''} em ${request.workspace}.`);
    const result = await executeCommand({
      cwd: request.workspace, command: [binary, ...args], input: instruction, environment,
      timeoutMs: request.timeoutMs ?? 600_000, maxOutputBytes: 8 * 1024 * 1024,
      ...(request.signal ? { signal: request.signal } : {}),
      onOutput: (output, stream) => { try { request.onEvent?.({ type: 'output', message: output, detail: { stream } }); } catch { /* observer isolation */ } },
    });
    const decoded = decodeOutput(result.stdout, config.provider);
    let output = decoded.text;
    if (config.provider === 'codex') { try { output = (await readFile(answer, 'utf8')).trim() || output; } catch { /* A CLI failure may still leave useful JSON events. */ } }
    else if (config.command && !['claude', 'opencode'].includes(config.provider)) output = result.stdout.trim();
    const secret = config.apiKey ? [config.apiKey] : [];
    output = scrub(output, secret);
    const problem = (result.timedOut ? 'A operação excedeu o prazo; seus arquivos e a resposta parcial foram preservados.' : '') || decoded.failure || (result.exitCode !== 0 ? result.stderr.trim() || `A CLI terminou com código ${result.exitCode ?? result.signal ?? 'desconhecido'}.` : '') || (!output.trim() ? 'A CLI não devolveu uma resposta; saída vazia não confirma execução concluída.' : '');
    return {
      status: result.cancelled ? 'cancelled' : problem || result.issue ? (output ? 'partial' : 'unavailable') : 'complete',
      text: output, changedFiles: [], commands: [],
      ...(decoded.usage ? { usage: decoded.usage } : {}), ...(decoded.sessionId ? { sessionId: decoded.sessionId } : {}),
      ...(problem ? { issue: cliIssue(scrub(problem, secret)) } : result.issue ? { issue: result.issue } : {}),
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** One small agent operation. Recovery stays with the coordinator, with all local effects and observations retained. */
export async function runAgent(request: AgentRequest): Promise<AgentResult> {
  const empty: AgentResult = { status: 'unavailable', text: '', commands: [], changedFiles: [] };
  if (request.signal?.aborted) return { ...empty, status: 'cancelled' };
  let before: Awaited<ReturnType<typeof snapshotWorkspace>> | undefined;
  let result = empty;
  try {
    before = await snapshotWorkspace(request.workspace);
    result = await (isApiProvider(request.config) ? runApiAgent(request) : runCliAgent(request));
  } catch (error) { result = { ...result, issue: { kind: 'tool', recoverable: true, message: scrub(error instanceof Error ? error.message : String(error), request.config.apiKey ? [request.config.apiKey] : []) } }; }
  try {
    if (before) result.changedFiles = changedPaths(before, await snapshotWorkspace(request.workspace));
    if (request.readOnly && result.changedFiles.length) result = { ...result, status: 'partial', issue: { kind: 'constraint', recoverable: true, message: `A operação de leitura alterou arquivos: ${result.changedFiles.join(', ')}. Reconcilie estes efeitos antes de prosseguir.` } };
  } catch (error) { result = { ...result, status: 'partial', issue: { kind: 'tool', recoverable: true, message: `Não foi possível reconciliar os arquivos após a operação: ${String(error)}` } }; }
  return result;
}
