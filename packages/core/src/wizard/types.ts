import type { AgentConfig } from '../runtime/types.js';

export interface Choice { label: string; hint?: string; }
export interface WizardHistory { question: string; answer: string; }
export interface WizardIO {
  ask(prompt: string, fallback?: string): Promise<string>;
  select(title: string, choices: readonly Choice[], defaultIndex?: number): Promise<number>;
  multiline(title: string, initial?: string): Promise<string>;
  secret(prompt: string): Promise<string>;
  write(message: string): void;
  setHistory?(history: readonly WizardHistory[]): void;
  close?(): void;
}
export class WizardBack extends Error { constructor(public readonly target?: string) { super('Voltar'); } }
export class WizardCancelled extends Error { constructor() { super('Wizard cancelado'); } }
export interface WizardDataCenter {
  listProjects(url: string): Promise<readonly { slug: string; title?: string; hasRequest?: boolean; documents?: number }[]>;
  loadProject(url: string, slug: string): Promise<string | { request: string }>;
  listPrompts(url: string): Promise<readonly { name: string; title?: string; description?: string }[]>;
  readPrompt(url: string, name: string): Promise<string>;
}
export interface WizardDefaults {
  agent?: AgentConfig;
  reviewer?: AgentConfig;
  workspace?: string;
  dataCenterUrl?: string;
}
export interface WizardDeps {
  io?: WizardIO;
  cwd?: string;
  defaults?: WizardDefaults;
  providers?: readonly { id: string; label?: string; hint?: string }[];
  listModels?: (provider: string) => Promise<readonly (string | { id: string; name?: string })[]>;
  listEfforts?: (provider: string, model: string) => Promise<readonly string[] | null>;
  configureApi?: (provider: string, io: WizardIO) => Promise<AgentConfig | boolean | void>;
  dataCenter?: WizardDataCenter;
  readRequestFile?: (path: string) => Promise<string>;
  requestRecorded?: (workspace: string) => Promise<boolean>;
  defaultStage?: (workspace: string) => Promise<'init' | 'plan' | 'build'>;
}
export interface WizardResult {
  stage: 'init' | 'plan' | 'build' | 'run';
  workspace: string;
  request?: string;
  requestFile?: string;
  config: AgentConfig;
  reviewer?: AgentConfig;
  dataCenter?: { url: string; project?: string; prompt?: string };
  execute: boolean;
  argv: string[];
  command: string;
}
