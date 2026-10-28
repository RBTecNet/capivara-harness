import { readFile, readdir } from 'node:fs/promises';
import { executeCommand } from './command.js';
import { projectPath, scrub, writeProductFile } from './files.js';
import { closeProcesses, readProcess, startProcess, stopProcess } from './processes.js';
import { runTerminal } from './terminal.js';
import type { AgentRequest, CommandResult, TerminalStep } from './types.js';

interface ToolDefinition { name: string; description: string; parameters: object; writes: boolean }
const string = { type: 'string' };
const number = { type: 'number' };
const schema = (properties: Record<string, unknown>, required: string[] = []): object => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { name: 'list_files', description: 'List files in a directory inside the product workspace. Control state and dependencies are excluded.', parameters: schema({ path: string }, []), writes: false },
  { name: 'read_file', description: 'Read a relevant text file, optionally by line range, inside the product workspace.', parameters: schema({ path: string, startLine: number, endLine: number }, ['path']), writes: false },
  { name: 'write_file', description: 'Create or replace a product text file. Parent directories are created. Never writes harness control state.', parameters: schema({ path: string, content: string }, ['path', 'content']), writes: true },
  { name: 'edit_file', description: 'Replace one exact occurrence of oldText in an existing file. Read the relevant file first; ambiguous edits return a recoverable tool error.', parameters: schema({ path: string, oldText: string, newText: string }, ['path', 'oldText', 'newText']), writes: true },
  { name: 'run_command', description: 'Run a focused command in the product workspace. Returns separate stdout/stderr, status, elapsed time and input fingerprint. Failure is evidence to diagnose and recover.', parameters: schema({ command: string, timeoutMs: number, input: string }, ['command']), writes: true },
  { name: 'run_terminal', description: 'Interact with a real pseudoterminal, for a TUI. Steps can send literal keys and wait for expected output. This does not use a browser.', parameters: schema({ command: string, columns: number, rows: number, steps: { type: 'array', items: schema({ input: string, waitFor: string, timeoutMs: number }) }, timeoutMs: number, closeInput: string }, ['command', 'steps']), writes: true },
  { name: 'start_process', description: 'Start a process needed by this task, for example an explicitly requested web service. Process is owned by this agent session and cleaned up afterward.', parameters: schema({ command: string, capability: string }, ['command', 'capability']), writes: true },
  { name: 'read_process', description: 'Read output/status of a process started by this session, optionally send input.', parameters: schema({ id: string, input: string }, ['id']), writes: true },
  { name: 'stop_process', description: 'Stop an owned process once its task is complete.', parameters: schema({ id: string }, ['id']), writes: true },
];

const field = (value: Record<string, unknown>, key: string): string => {
  if (typeof value[key] !== 'string') throw new Error(`Campo ${key} deve ser texto.`);
  return value[key];
};
const optionalNumber = (value: Record<string, unknown>, key: string): number | undefined => typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : undefined;
const optionalString = (value: Record<string, unknown>, key: string): string | undefined => typeof value[key] === 'string' ? value[key] as string : undefined;

export class AgentTools {
  readonly commands: CommandResult[] = [];
  private readonly owned = new Set<string>();
  constructor(private readonly request: AgentRequest) {}

  definitions(): readonly ToolDefinition[] { return TOOL_DEFINITIONS.filter(tool => !this.request.readOnly || !tool.writes); }

  async execute(name: string, input: unknown): Promise<object> {
    if (this.request.signal?.aborted) return { error: 'A execução foi cancelada.' };
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A ferramenta precisa de argumentos em objeto JSON.');
      const args = input as Record<string, unknown>;
      const definition = this.definitions().find(tool => tool.name === name);
      if (!definition) throw new Error('Ferramenta não disponível para este papel.');
      this.emit('tool', `${name}`);
      const { workspace, constraints, signal } = this.request;
      const environment = { ...this.request.config.environment, ...this.request.environment };
      if (name === 'list_files') {
        const path = optionalString(args, 'path') ?? '.';
        const absolute = await projectPath(workspace, path);
        const entries = await readdir(absolute, { withFileTypes: true });
        return { path, files: entries.filter(entry => !entry.name.startsWith('.capivara') && !['.git', 'node_modules', 'target', '.venv'].includes(entry.name)).map(entry => ({ name: entry.name, directory: entry.isDirectory() })) };
      }
      if (name === 'read_file') {
        const path = field(args, 'path');
        const lines = (await readFile(await projectPath(workspace, path), 'utf8')).split('\n');
        const start = Math.max(1, Math.floor(optionalNumber(args, 'startLine') ?? 1));
        const end = Math.max(start, Math.floor(optionalNumber(args, 'endLine') ?? Math.min(lines.length, start + 299)));
        const text = lines.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`).join('\n');
        return { path, totalLines: lines.length, startLine: start, endLine: Math.min(end, lines.length), content: scrub(text.slice(0, 48_000)), truncated: text.length > 48_000 };
      }
      if (name === 'write_file') { await writeProductFile(workspace, field(args, 'path'), field(args, 'content'), constraints); return { written: field(args, 'path') }; }
      if (name === 'edit_file') {
        const path = field(args, 'path'), oldText = field(args, 'oldText'), newText = field(args, 'newText');
        const content = await readFile(await projectPath(workspace, path), 'utf8');
        if (!oldText || content.split(oldText).length !== 2) throw new Error('O trecho deve existir exatamente uma vez. Leia a região e faça uma edição localizada.');
        await writeProductFile(workspace, path, content.replace(oldText, () => newText), constraints);
        return { edited: path };
      }
      if (name === 'run_command' || name === 'run_terminal') {
        const common = { cwd: workspace, command: field(args, 'command'), environment, ...(constraints ? { constraints } : {}), ...(signal ? { signal } : {}), ...(optionalNumber(args, 'timeoutMs') !== undefined ? { timeoutMs: Math.max(1, optionalNumber(args, 'timeoutMs')!) } : {}), ...(optionalString(args, 'input') !== undefined ? { input: optionalString(args, 'input')! } : {}), isolateWorkspace: constraints?.allowSystemInstall !== true, onOutput: (text: string) => this.emit('output', text) };
        let result: CommandResult;
        if (name === 'run_terminal') {
          const steps: TerminalStep[] = Array.isArray(args.steps) ? args.steps.map((step: unknown) => {
            if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('Cada interação de terminal precisa de objeto com input/waitFor.');
            const value = step as Record<string, unknown>;
            if (value.input !== undefined && typeof value.input !== 'string' || value.waitFor !== undefined && typeof value.waitFor !== 'string') throw new Error('As teclas e o texto esperado precisam ser texto.');
            return { ...(typeof value.input === 'string' ? { input: value.input } : {}), ...(typeof value.waitFor === 'string' ? { waitFor: value.waitFor } : {}), ...(optionalNumber(value, 'timeoutMs') !== undefined ? { timeoutMs: Math.max(1, optionalNumber(value, 'timeoutMs')!) } : {}) };
          }) : [];
          result = await runTerminal({ ...common, steps, ...(optionalNumber(args, 'columns') !== undefined ? { columns: optionalNumber(args, 'columns')! } : {}), ...(optionalNumber(args, 'rows') !== undefined ? { rows: optionalNumber(args, 'rows')! } : {}), ...(optionalString(args, 'closeInput') !== undefined ? { closeInput: optionalString(args, 'closeInput')! } : {}) });
        } else result = await executeCommand(common);
        this.commands.push(result);
        this.emit('command', `${result.command}: ${result.exitCode ?? (result.cancelled ? 'cancelado' : 'incompleto')}`);
        return { ...result, stdout: result.stdout.slice(-32_000), stderr: result.stderr.slice(-12_000) };
      }
      if (name === 'start_process') {
        const process = await startProcess({ cwd: workspace, command: field(args, 'command'), environment, capabilities: [field(args, 'capability')], isolateWorkspace: constraints?.allowSystemInstall !== true, ...(constraints ? { constraints } : {}), ...(signal ? { signal } : {}) });
        if (process.id) this.owned.add(process.id);
        return process;
      }
      const id = field(args, 'id');
      if (!this.owned.has(id)) throw new Error('Esse processo não pertence à sessão atual.');
      if (name === 'read_process') return readProcess(id, optionalString(args, 'input'));
      if (name === 'stop_process') { this.owned.delete(id); return stopProcess(id); }
      return { error: 'Ferramenta desconhecida.' };
    } catch (error) { return { error: scrub(error instanceof Error ? error.message : String(error)), recoverable: true }; }
  }

  close(): void { closeProcesses([...this.owned]); this.owned.clear(); }
  private emit(type: 'tool' | 'output' | 'command', message: string): void { try { this.request.onEvent?.({ type, message: scrub(message, this.request.config.apiKey ? [this.request.config.apiKey] : []) }); } catch { /* observation cannot terminate work */ } }
}
