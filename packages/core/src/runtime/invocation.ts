import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, resolve } from 'node:path';
import type { CommandRequest, InvocationTransformation } from './types.js';

export class InvocationDeclarationError extends Error {
  readonly code = 'ERR_INVALID_ARG_VALUE';
}

/** Decode literal words only. Expansions and shell control operators require
 * an explicitly selected shell, never an executable filename in argv[0]. */
export function literalInvocationArguments(command: string): string[] | undefined {
  const words: string[] = [];
  let word = '', quote = '', started = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote === "'") { if (char === quote) quote = ''; else word += char; continue; }
    if (quote === '"') {
      if (char === '"') { quote = ''; continue; }
      if (char === '$' || char === '`') return undefined;
      if (char === '\\' && ['$', '`', '"', '\\', '\n'].includes(command[index + 1] ?? '')) {
        const next = command[++index]!; if (next !== '\n') word += next; continue;
      }
      word += char; continue;
    }
    if (char === '\\') {
      const next = command[++index]; if (next === undefined) return undefined;
      if (next !== '\n') word += next; started = true; continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/[;&|<>`$\n\r]/.test(char)) return undefined;
    if (/\s/.test(char)) { if (started) { words.push(word); word = ''; started = false; } continue; }
    word += char; started = true;
  }
  if (quote) return undefined;
  if (started) words.push(word);
  return words;
}

async function executableExists(binary: string, request: Pick<CommandRequest, 'cwd' | 'environment'>): Promise<boolean> {
  const direct = isAbsolute(binary) || binary.includes('/') || binary.includes('\\');
  const roots = direct ? [resolve(request.cwd, binary)]
    : (request.environment?.PATH ?? process.env.PATH ?? '').split(delimiter).map(folder => resolve(request.cwd, folder || '.', binary));
  const extensions = process.platform === 'win32' && !/\.[^\\/]+$/.test(binary)
    ? ['', ...(request.environment?.PATHEXT ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : [''];
  for (const root of roots) for (const extension of extensions) {
    try {
      const candidate = root + extension;
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return true;
    } catch { /* Missing/invalid names are diagnosed by spawn or declaration validation. */ }
  }
  return false;
}

/** Preserve actual executable paths, including spaces. A duplicated literal
 * declaration can be decoded once; conflicting argv never gets guessed. */
export async function normalizeCommandInvocation(request: Pick<CommandRequest, 'command' | 'cwd' | 'environment'>): Promise<{ binary: string; args: string[]; transformation?: InvocationTransformation }> {
  if (typeof request.command === 'string') {
    if (!request.command.trim()) throw new InvocationDeclarationError('The command cannot be empty.');
    return process.platform === 'win32'
      ? { binary: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', request.command] }
      : { binary: '/bin/sh', args: ['-c', request.command] };
  }
  const original = [...request.command];
  if (!original.length || original.some(value => typeof value !== 'string' || value.includes('\0')) || !original[0]) {
    throw new InvocationDeclarationError('Executable and arguments must be literal strings without NUL bytes.');
  }
  const [binary, ...args] = original as [string, ...string[]];
  if (!/[\s'"\\]/.test(binary) || await executableExists(binary, request)) return { binary, args };
  const decoded = literalInvocationArguments(binary);
  if (!decoded?.length || !decoded[0]) throw new InvocationDeclarationError('argv[0] is neither an available executable nor an unambiguous literal invocation. Supply the executable and arguments separately, or explicitly select a shell.');
  if (decoded.length === 1 && decoded[0] === binary) return { binary, args };
  const embedded = decoded.slice(1);
  if (args.length && (args.length !== embedded.length || args.some((value, index) => value !== embedded[index]))) {
    throw new InvocationDeclarationError('The command contains embedded arguments that conflict with its separate argv. Neither version was executed. Recover one explicit executable/argv declaration.');
  }
  return {
    binary: decoded[0], args: embedded,
    transformation: { schema: 'capivara/invocation/1', original, resolved: decoded, reason: args.length ? 'duplicate-literal-arguments' : 'literal-executable-and-arguments' },
  };
}
