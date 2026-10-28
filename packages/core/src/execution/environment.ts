import { readFile, stat, readdir } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import type { CommandRecipe, EnvironmentNode, ProductBrief } from '../domain/types.js';
import { allowedCapabilities } from '../domain/authority.js';
import type { CommandRequest, CommandResult, ExecutionConstraints, TerminalRequest } from '../runtime/types.js';
import { runTerminal as realTerminal } from '../runtime/terminal.js';
import type { BuildIncident } from './types.js';
import { digest } from './files.js';
import { emitProgress, type ProgressEvent } from '../telemetry/progress.js';

export type CommandExecutor = (request: CommandRequest) => Promise<CommandResult>;
export interface PreparationResult { ready: boolean; results: CommandResult[]; incidents: BuildIncident[]; }
export interface PreparationOptions { allowSystemInstall?: boolean; signal?: AbortSignal; terminal?: (request: TerminalRequest) => Promise<CommandResult>; onEvent?: (event: ProgressEvent) => void; }
export const forbiddenCapabilities = (brief: ProductBrief): string[] => [...new Set(brief.constraints.flatMap(value=>value.forbiddenCapabilities))];
export function executionConstraints(brief: ProductBrief, allowSystemInstall = false): ExecutionConstraints {
  const implicit=['http-server','browser'].filter(capability=>!allowedCapabilities(brief,[capability]));
  return {forbiddenCapabilities:[...new Set([...forbiddenCapabilities(brief),...implicit])],allowSystemInstall};
}
export function recipeCwd(workspace: string, cwd?: string): string {
  if (!cwd || cwd === '.') return resolve(workspace);
  const root = resolve(workspace), resolved = resolve(root,cwd), path = relative(root,resolved);
  if (path === '..' || path.startsWith(`..${sep}`)) throw new Error(`Recipe escapes the project: ${cwd}`);
  return resolved;
}
export function recipeCommand(recipe: CommandRecipe): string | readonly string[] {
  return recipe.args ? [recipe.command,...recipe.args] : recipe.command;
}
function issue(subject: string, message: string, evidence: string, external = false): BuildIncident {
  return {id:digest(`${subject}:${message}`).slice(0,16),kind:'environment',subject,message,evidence,action:'Prepare a compatible local environment, verify readiness and continue the consumer.',external};
}
function okay(result: CommandResult): boolean { return result.exitCode === 0 && !result.timedOut && !result.cancelled && !result.issue; }
export async function runRecipe(workspace: string, recipe: CommandRecipe, brief: ProductBrief, execute: CommandExecutor, options: PreparationOptions = {}): Promise<CommandResult> {
  const request: CommandRequest = {cwd:recipeCwd(workspace,recipe.cwd),command:recipeCommand(recipe),constraints:executionConstraints(brief,options.allowSystemInstall),capabilities:recipe.capabilities??[],...(recipe.timeoutMs?{timeoutMs:recipe.timeoutMs}:{}),...(options.signal?{signal:options.signal}:{})};
  const needsTerminal = recipe.capabilities?.some(capability => /^(?:pty|terminal|interactive-terminal|pseudoterminal)$/i.test(capability));
  const progress = { id: `environment:command:${digest(JSON.stringify({ cwd: request.cwd, command: request.command })).slice(0, 16)}`, label: `Preparação: ${recipe.command}`, stage: 'build' };
  emitProgress(options.onEvent, { ...progress, status: 'running' });
  // Readiness of a terminal is an actual PTY operation, never a pipes-based process probe.
  const result = await (needsTerminal ? (options.terminal ?? realTerminal)(request) : execute(request));
  emitProgress(options.onEvent, { ...progress, status: okay(result) ? 'complete' : 'waiting' });
  return result;
}
/** Reconcile a lock mismatch in the same project rather than treating installer preference as a failure. */
export function installationAlternative(command: string, output: string): string | null {
  const lockMismatch = /(?:EUSAGE|ENOLOCK|out.of.sync|lockfile.*(?:missing|outdated|not|frozen)|package.lock|npm ci can only|frozen.lockfile|immutable|yarn.lock.*(?:missing|modified))/i.test(output);
  if (!lockMismatch) return null;
  if (/\bnpm\s+ci\b/.test(command)) return command.replace(/\bnpm\s+ci\b/,'npm install');
  if (/\bpnpm\s+install\b/.test(command) && /--frozen-lockfile/.test(command)) return command.replace(/\s+--frozen-lockfile\b/g,' --no-frozen-lockfile');
  if (/\byarn\s+install\b/.test(command)) return command.replace(/\s+--(?:immutable|frozen-lockfile)\b/g,'');
  return null;
}
export async function prepareEnvironmentNode(workspace: string, node: EnvironmentNode, brief: ProductBrief, execute: CommandExecutor, options: PreparationOptions = {}): Promise<PreparationResult> {
  const results: CommandResult[] = [];
  const progress = { id: `environment:node:${node.id}`, label: node.name, stage: 'build' };
  const finish = (result: PreparationResult): PreparationResult => {
    emitProgress(options.onEvent, { ...progress, status: result.ready ? 'complete' : 'waiting' });
    return result;
  };
  emitProgress(options.onEvent, { ...progress, status: 'running' });
  const check = await runRecipe(workspace,node.check,brief,execute,options); results.push(check);
  if (okay(check)) return finish({ready:true,results,incidents:[]});
  for (const recipe of node.prepare) {
    if (options.signal?.aborted) break;
    if (recipe.system && !options.allowSystemInstall) return finish({ready:false,results,incidents:[issue(node.id,'This recipe needs system access; find a local or isolated installation.',recipe.command,true)]});
    const result = await runRecipe(workspace,recipe,brief,execute,options); results.push(result);
    if (!okay(result)) {
      const alternative = installationAlternative(result.command,`${result.stdout}\n${result.stderr}`);
      if (alternative) {
        const replacement = await execute({cwd:result.cwd,command:alternative,constraints:executionConstraints(brief,options.allowSystemInstall),...(options.signal?{signal:options.signal}:{})});
        results.push(replacement);
        if (okay(replacement)) continue;
      }
      // Readiness can have been achieved despite a failed optional post-install command.
      const readiness = await runRecipe(workspace,node.check,brief,execute,options); results.push(readiness);
      if (okay(readiness)) return finish({ready:true,results,incidents:[]});
      return finish({ready:false,results,incidents:[issue(node.id,`Environment ${node.name} is not ready.`,`${result.command}\n${result.stderr}\n${result.stdout}`,result.issue?.recoverable===true)]});
    }
  }
  const readiness = await runRecipe(workspace,node.check,brief,execute,options); results.push(readiness);
  return finish(okay(readiness) ? {ready:true,results,incidents:[]} : {ready:false,results,incidents:[issue(node.id,`Environment ${node.name} still needs preparation.`,`${readiness.command}\n${readiness.stderr}\n${readiness.stdout}`)]});
}
async function exists(path: string): Promise<boolean> { return stat(path).then(()=>true).catch(()=>false); }
export async function manifestRecipes(workspace: string): Promise<CommandRecipe[]> {
  const pkg = JSON.parse(await readFile(join(workspace,'package.json'),'utf8').catch(()=>'null')) as {packageManager?:string;dependencies?:Record<string,string>;devDependencies?:Record<string,string>} | null;
  const recipes: CommandRecipe[]=[];
  if (pkg && (Object.keys(pkg.dependencies??{}).length || Object.keys(pkg.devDependencies??{}).length)) {
    const manager = pkg.packageManager?.split('@')[0];
    if (manager === 'pnpm' || await exists(join(workspace,'pnpm-lock.yaml'))) recipes.push({command:await exists(join(workspace,'pnpm-lock.yaml'))?'pnpm install --frozen-lockfile':'pnpm install'});
    else if (manager === 'yarn' || await exists(join(workspace,'yarn.lock'))) recipes.push({command:'yarn install'});
    else if (manager === 'bun' || await exists(join(workspace,'bun.lock')) || await exists(join(workspace,'bun.lockb'))) recipes.push({command:'bun install'});
    else recipes.push({command:await exists(join(workspace,'package-lock.json'))?'npm ci --no-audit --no-fund':'npm install --no-audit --no-fund'});
  }
  if (await exists(join(workspace,'Cargo.toml'))) recipes.push({command:'cargo fetch'});
  if (await exists(join(workspace,'go.mod'))) recipes.push({command:'go mod download'});
  if (await exists(join(workspace,'requirements.txt')) || await exists(join(workspace,'pyproject.toml'))) {
    const python = process.platform==='win32'?'.venv\\Scripts\\python.exe':'.venv/bin/python';
    if (!await exists(join(workspace,python))) recipes.push({command:process.platform==='win32'?'py -m venv .venv':'python3 -m venv .venv'});
    recipes.push({command:await exists(join(workspace,'requirements.txt'))?`${python} -m pip install -r requirements.txt`:`${python} -m pip install -e .`});
  }
  const entries = await readdir(workspace).catch(()=>[]);
  if (entries.some(name=>/\.(?:sln|slnx|csproj|fsproj)$/.test(name))) recipes.push({command:'dotnet restore'});
  return recipes;
}
export async function prepareProjectDependencies(workspace: string, brief: ProductBrief, execute: CommandExecutor, options: PreparationOptions = {}): Promise<PreparationResult> {
  let recipes: CommandRecipe[];
  const progress = { id: 'environment:dependencies', label: 'Dependências do projeto', stage: 'build', unit: 'receitas' };
  emitProgress(options.onEvent, { ...progress, status: 'running' });
  try { recipes=await manifestRecipes(workspace); }
  catch(error) {
    emitProgress(options.onEvent, { ...progress, status: 'waiting' });
    return {ready:false,results:[],incidents:[issue('manifest',`The manifest is not readable: ${String(error)}`,'Repair only the manifest syntax without changing the requested dependencies.')]};
  }
  const results: CommandResult[]=[];
  let completed = 0;
  const report = (status: ProgressEvent['progress']['status']): void => emitProgress(options.onEvent, { ...progress, completed, total: recipes.length, status });
  report(recipes.length ? 'running' : 'complete');
  for (const recipe of recipes) {
    const result=await runRecipe(workspace,recipe,brief,execute,options);results.push(result);
    if (okay(result)) { completed += 1; report(completed === recipes.length ? 'complete' : 'running'); continue; }
    const alternative=installationAlternative(result.command,`${result.stdout}\n${result.stderr}`);
    if(alternative) {
      const repaired=await execute({cwd:workspace,command:alternative,constraints:executionConstraints(brief,options.allowSystemInstall),...(options.signal?{signal:options.signal}:{})});results.push(repaired);
      if(okay(repaired)){completed += 1; report(completed === recipes.length ? 'complete' : 'running'); continue;}
    }
    report('waiting');
    return {ready:false,results,incidents:[issue('dependencies','Project dependencies need recovery.',`${result.command}\n${result.stderr}\n${result.stdout}`,!!result.issue?.recoverable)]};
  }
  return {ready:true,results,incidents:[]};
}
