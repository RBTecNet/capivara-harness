import { ApiProgressGuard } from './api-progress.js';
import { AgentTools } from './tools.js';
import { scrub } from './files.js';
import type { AgentConfig, AgentRequest, AgentResult, RuntimeIssue, Usage } from './types.js';

const ROUTES: Record<string, { base: string; env: string; protocol?: 'anthropic' }> = {
  openai: { base: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  openrouter: { base: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  deepseek: { base: 'https://api.deepseek.com', env: 'DEEPSEEK_API_KEY' },
  anthropic: { base: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY', protocol: 'anthropic' },
  minimax: { base: 'https://api.minimax.io/v1', env: 'MINIMAX_API_KEY' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', env: 'GEMINI_API_KEY' },
};
export const API_ROUTES = ROUTES;

/** Credentials follow a concrete destination, including its API path. */
export function normalizedAPIDestination(provider: string, baseUrl?: string): string | undefined {
  const base = baseUrl ?? ROUTES[provider]?.base;
  if (!base) return undefined;
  try {
    const url = new URL(base);
    url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages)\/?$/, '').replace(/\/+$/, '') || '/';
    return url.href.replace(/\/$/, '');
  } catch { return base.trim().replace(/\/+$/, ''); }
}

/** A provider's environment secret is never the implicit key for an alternate endpoint. */
export function defaultAPIKeyEnv(config: Pick<AgentConfig, 'provider' | 'baseUrl' | 'apiKeyEnv'>): string {
  if (config.apiKeyEnv) return config.apiKeyEnv;
  const route = ROUTES[config.provider];
  return route && normalizedAPIDestination(config.provider, config.baseUrl) === normalizedAPIDestination(config.provider)
    ? route.env : 'CAPIVARA_API_KEY';
}

/** Catalog discovery and inference resolve exactly the same credential. */
export function apiCredential(config: AgentConfig, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const variable = defaultAPIKeyEnv(config);
  const key = config.apiKey || config.environment?.[variable] || environment[variable];
  const geminiAlias = config.provider === 'gemini' && variable === 'GEMINI_API_KEY'
    && normalizedAPIDestination(config.provider, config.baseUrl) === normalizedAPIDestination(config.provider)
    ? config.environment?.GOOGLE_API_KEY || environment.GOOGLE_API_KEY : undefined;
  return (key || geminiAlias)?.trim() || undefined;
}

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const amount = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const apiUrl = (base: string, endpoint: string): string => base.endsWith(`/${endpoint}`) ? base : `${base.replace(/\/$/, '')}/${endpoint}`;

export function isApiProvider(config: AgentRequest['config']): boolean { return config.baseUrl !== undefined || Object.hasOwn(ROUTES, config.provider); }

function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function failure(status: number, body: unknown, retry?: number): RuntimeIssue {
  const detail = text(object(object(body).error).message) || text(object(body).message);
  const kind = status === 401 || status === 403 ? 'authentication' : status === 429 ? 'rate-limit' : status === 404 ? 'configuration' : status === 400 || status === 422 ? 'configuration' : 'transport';
  const context = /context|maximum.*tokens|too (?:large|long)/i.test(detail);
  return { kind: context ? 'context' : kind, recoverable: kind !== 'authentication', message: `A API respondeu HTTP ${status}${detail ? `: ${detail.slice(0, 1000)}` : ''}.`, ...(retry !== undefined ? { retryAfterMs: retry } : {}) };
}

function addUsage(current: Usage, usage: RecordValue, anthropic: boolean): void {
  current.inputTokens += anthropic ? amount(usage.input_tokens) + amount(usage.cache_creation_input_tokens) + amount(usage.cache_read_input_tokens) : amount(usage.prompt_tokens);
  current.outputTokens += amount(anthropic ? usage.output_tokens : usage.completion_tokens);
  const cached = amount(anthropic ? usage.cache_read_input_tokens : object(usage.prompt_tokens_details).cached_tokens);
  if (cached) current.cachedInputTokens = (current.cachedInputTokens ?? 0) + cached;
  const cost = usage.cost;
  if (typeof cost === 'number') current.costUsd = (current.costUsd ?? 0) + cost;
}

function requestSystem(request: AgentRequest): string {
  return [
    `You are executing one small ${request.role} task in a software development process.`,
    'Use the supplied task and relevant files. Do not invent product requirements. A failed tool is information: diagnose it and choose an appropriate next action.',
    request.readOnly ? 'This task is read-only. Return the requested information; no product edits or shell side effects are allowed.' : 'Use the supplied workspace tools to implement the requested fragment. Your final answer should report what was actually changed and checked.',
    request.constraints?.forbiddenCapabilities?.length ? `The product explicitly excludes these capabilities: ${request.constraints.forbiddenCapabilities.join(', ')}. A verification tool cannot override this.` : '',
    request.constraints?.allowSystemInstall === true ? 'System installation is authorized when necessary for this product.' : 'Install dependencies locally in the project or isolated environment; do not install system packages.',
  ].filter(Boolean).join('\n');
}

/** Keeps original task authority and recent tool exchanges. The current files replace repeated tool transcripts. */
function compact(history: RecordValue[], budgetChars: number, original: number): RecordValue[] {
  if (JSON.stringify(history).length <= budgetChars || history.length <= original + 2) return history;
  let start = history.length - 1;
  while (start > original && history[start]?.role !== 'assistant') start--;
  const summary = history.slice(original, start).flatMap(message => {
    if (message.role === 'tool') return [`Tool ${text(message.name)} completed; its current product files can be read by path.`];
    const blocks = array(message.content).map(object);
    return blocks.filter(block => block.type === 'tool_result').map(() => 'A prior workspace tool completed; product files retain its effects.');
  }).slice(-8).join('\n');
  return [...history.slice(0, original), ...(summary ? [{ role: 'user', content: `Earlier tool output was compacted to avoid repeating the entire context.\n${summary}\nThe task requirements above remain authoritative; inspect current relevant files when needed.` }] : []), ...history.slice(start)];
}

/** Limits only observation text; original task authority and the tool's actual effects remain intact. */
function toolOutput(result: object, budgetChars: number, key: string): string {
  const original = scrub(JSON.stringify(result), [key]);
  if (JSON.stringify(original).length <= budgetChars) return original;
  const clipped = { truncated: true, originalChars: original.length, next: 'Request a narrower file line range or focused command output. Source files and completed effects are preserved.', preview: '' };
  let low = 0, high = original.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    clipped.preview = original.slice(0, middle);
    if (JSON.stringify(JSON.stringify(clipped)).length <= budgetChars) low = middle;
    else high = middle - 1;
  }
  clipped.preview = original.slice(0, low);
  return JSON.stringify(clipped);
}

/** Executes the tool loop itself, instead of requiring a third-party CLI to give API models filesystem/shell access. */
export async function runApiAgent(request: AgentRequest): Promise<AgentResult> {
  const tools = new AgentTools(request);
  const commands = tools.commands;
  const baseResult: AgentResult = { status: 'unavailable', text: '', commands, changedFiles: [] };
  if (request.signal?.aborted) return { ...baseResult, status: 'cancelled' };
  const route = ROUTES[request.config.provider];
  const keyName = defaultAPIKeyEnv(request.config);
  const key = apiCredential(request.config);
  if (!key) return { ...baseResult, issue: { kind: 'authentication', recoverable: false, message: `Configure ${keyName} para a API ${request.config.provider}. Nenhuma inferência foi iniciada.` } };
  if (!request.config.model) return { ...baseResult, issue: { kind: 'configuration', recoverable: true, message: 'Escolha explicitamente o modelo da API; a credencial não determina qual modelo consumir.' } };
  const anthropic = route?.protocol === 'anthropic';
  const url = apiUrl(request.config.baseUrl ?? route?.base ?? '', anthropic ? 'messages' : 'chat/completions');
  const controller = new AbortController();
  const abort = (): void => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', abort, { once: true });
  if (request.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error('A chamada de API excedeu o prazo de operação; o trabalho já realizado permanece disponível.')), request.timeoutMs ?? 600_000);
  timeout.unref();
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let observedUsage = false;
  let lastText = '';
  let history: RecordValue[] = anthropic
    ? [{ role: 'user', content: [request.instruction, request.context].filter(Boolean).join('\n\n') }]
    : [{ role: 'system', content: requestSystem(request) }, { role: 'user', content: [request.instruction, request.context].filter(Boolean).join('\n\n') }];
  const initialMessages = history.length;
  const budgetChars = Math.max(4096, (request.config.contextTokens ?? 24_000) * 3 - (request.config.maxOutputTokens ?? 4096) * 3);
  const seenTools = new Map<string, { signature: string; state: string; result: object }>();
  const progress=new ApiProgressGuard(request);
  baseResult.diagnostics=progress.diagnostics;
  const requestedRounds=request.config.maxToolRounds;
  const maxToolRounds=requestedRounds!==undefined&&Number.isFinite(requestedRounds)&&requestedRounds>0?Math.floor(requestedRounds):64;
  const stopped=():AgentResult=>({...baseResult,status:'partial',text:lastText,...(observedUsage?{usage}:{}),issue:{kind:'instrument',recoverable:false,message:progress.diagnostics.stoppedBecause==='round-limit'?'A unidade atingiu o limite de rodadas de ferramentas com efeitos preservados. Divida o trabalho ou forneça uma estratégia executável distinta; isso não é aprovação nem defeito fictício do produto.':'As mesmas ações retornaram os mesmos fatos sem alterar o trabalho. A repetição foi suspensa, com os arquivos e resultados preservados. É necessária uma mudança concreta de estado ou estratégia antes de repetir.'}});
  try {
    if(!await progress.start())return stopped();
    for (;;) {
      if(!await progress.beginRound(maxToolRounds))return stopped();
      if (controller.signal.aborted) return { ...baseResult, status: request.signal?.aborted ? 'cancelled' : 'partial', text: lastText, ...(observedUsage ? { usage } : {}), issue: { kind: 'transport', recoverable: true, message: 'A operação foi interrompida; reconcilie seus efeitos e continue a pendência.' } };
      history = compact(history, budgetChars, initialMessages);
      if (JSON.stringify(history).length > budgetChars) return { ...baseResult, status: 'partial', text: lastText, ...(observedUsage ? { usage } : {}), issue: { kind: 'context', recoverable: true, message: 'O contexto desta unidade excede o espaço reservado. Divida a tarefa ou reduza os trechos relevantes; os arquivos e resultados já produzidos foram preservados.' } };
      const definitions = tools.definitions();
      const limit = request.config.maxOutputTokens ?? 4096;
      const payload: RecordValue = anthropic ? {
        model: request.config.model, system: requestSystem(request), messages: history, max_tokens: limit,
        ...(request.config.effort ? { output_config: { effort: request.config.effort } } : {}),
        ...(definitions.length ? { tools: definitions.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
      } : {
        model: request.config.model, messages: history,
        ...(request.config.provider === 'openai' ? { max_completion_tokens: limit } : { max_tokens: limit }),
        ...(request.config.effort && request.config.provider === 'openai' ? { reasoning_effort: request.config.effort } : {}),
        ...(request.config.effort && request.config.provider === 'openrouter' ? { reasoning: { effort: request.config.effort } } : {}),
        ...(definitions.length ? { tools: definitions.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
      };
      const response = await fetch(url, {
        method: 'POST', headers: anthropic ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(payload), signal: controller.signal, redirect: 'error',
      });
      let data: RecordValue;
      try { data = object(await response.json()); } catch { return { ...baseResult, status: lastText || commands.length ? 'partial' : 'unavailable', text: lastText, ...(observedUsage ? { usage } : {}), issue: { kind: 'transport', recoverable: true, message: `A API devolveu corpo ilegível (HTTP ${response.status}). Os efeitos locais permanecem disponíveis.` } }; }
      if (!response.ok || data.error) return { ...baseResult, status: lastText || commands.length ? 'partial' : 'unavailable', text: lastText, ...(observedUsage ? { usage } : {}), issue: { ...failure(response.status, data, retryAfter(response.headers.get('retry-after'))), message: scrub(failure(response.status, data).message, [key]) } };
      if (data.usage && typeof data.usage === 'object') { observedUsage = true; addUsage(usage, object(data.usage), anthropic); }
      const message = anthropic ? { role: 'assistant', content: data.content } : object(object(array(data.choices)[0]).message);
      const content = message.content;
      lastText = scrub(typeof content === 'string' ? content : array(content).map(part => text(object(part).text)).filter(Boolean).join('\n'), [key]);
      const calls = anthropic
        ? array(content).map(object).filter(block => block.type === 'tool_use').map(block => ({ id: text(block.id), name: text(block.name), input: block.input }))
        : array(message.tool_calls).map(object).map(call => ({ id: text(call.id), name: text(object(call.function).name), input: object(call.function).arguments }));
      const stop = anthropic ? text(data.stop_reason) : text(object(array(data.choices)[0]).finish_reason);
      if (!calls.length) {
        if (stop === 'length' || stop === 'max_tokens') return { ...baseResult, status: 'partial', text: lastText, ...(observedUsage ? { usage } : {}), issue: { kind: 'output-limit', recoverable: true, message: 'A resposta terminou no limite de saída. Continue somente a parte ausente ou divida a unidade.' } };
        if (!lastText.trim()) return { ...baseResult, status: 'partial', ...(observedUsage ? { usage } : {}), issue: { kind: 'tool', recoverable: true, message: 'O modelo não devolveu texto nem ação. Solicite uma continuação localizada; isso não prova defeito no código.' } };
        return { ...baseResult, status: 'complete', text: lastText, ...(observedUsage ? { usage } : {}) };
      }
      history.push(message);
      // Reclaim older transcripts before allocating this turn's result envelopes, without trimming requirements.
      history = compact(history, budgetChars - Math.min(4096, Math.floor(budgetChars / 3)), initialMessages);
      const envelopes: RecordValue[] = anthropic
        ? [{ role: 'user', content: calls.map(call => ({ type: 'tool_result', tool_use_id: call.id, content: '' })) }]
        : calls.map(call => ({ role: 'tool', tool_call_id: call.id, name: call.name, content: '' }));
      const resultBudget = Math.floor(Math.max(0, budgetChars - JSON.stringify([...history, ...envelopes]).length) / calls.length);
      const results: RecordValue[] = [];
      for (const call of calls) {
        let input: unknown = call.input;
        let result: object;
        let valid=definitions.some(definition=>definition.name===call.name);
        try {if(typeof input==='string')input=JSON.parse(input);}catch{valid=false;}
        const signature=JSON.stringify([call.name,input]);
        const before=await progress.before(call.name,input);
        try { const previous=seenTools.get(call.id); const replay=previous?.signature===signature&&(definitions.find(definition=>definition.name===call.name)?.writes===true||previous.state===before); result=replay?previous.result:valid?await tools.execute(call.name,input):{error:'Argumentos ou ferramenta inválidos; informe uma ação válida.',recoverable:true}; }
        catch { result={error:'A ferramenta falhou antes de produzir um resultado utilizável.',recoverable:true};valid=false; }
        if(call.id)seenTools.set(call.id,{signature,state:before,result});
        const observed=await progress.observe(before,call.name,input,result,valid);
        baseResult.changedFiles=observed.changedFiles;
        if(observed.stop)return stopped();
        const output = toolOutput(result, resultBudget, key);
        if (anthropic) results.push({ type: 'tool_result', tool_use_id: call.id, content: output });
        else history.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: output });
      }
      if (anthropic) history.push({ role: 'user', content: results });
    }
  } catch (error) {
    return { ...baseResult, status: request.signal?.aborted ? 'cancelled' : lastText || commands.length ? 'partial' : 'unavailable', text: lastText, ...(observedUsage ? { usage } : {}), issue: { kind: 'transport', recoverable: true, message: scrub(error instanceof Error ? error.message : String(error), [key]) } };
  } finally { await progress.finish(); clearTimeout(timeout); request.signal?.removeEventListener('abort', abort); tools.close(); }
}
