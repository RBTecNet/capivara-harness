export interface DataCenterEndpoint {
  url: string;
  /** Secrets stay in global settings/in memory; never persist this object in a project. */
  headers?: Record<string, string>;
}

export interface DataCenterAvailability {
  status: 'ready' | 'unconfigured' | 'unavailable' | 'unauthorized' | 'invalid-config' | 'protocol-error';
  retryable: boolean;
  attempts: number;
  message?: string;
  code?: number;
}

export type DataCenterResult<T> =
  | { ok: true; value: T; availability: DataCenterAvailability }
  | { ok: false; availability: DataCenterAvailability };

export interface DataCenterProject {
  slug: string;
  name: string;
  hasRequest: boolean;
  documents: number;
}

export interface DataCenterPrompt { name: string; title?: string; description?: string; }

export interface DataCenterFile {
  uri: string;
  path: string;
  /** Text files retain their literal content; binary attachments retain base64. */
  text?: string;
  base64?: string;
  mimeType?: string;
}

export interface DataCenterDocument {
  uri: string;
  name: string;
  kind: string;
  text: string;
  area?: string;
  files?: DataCenterFile[];
}

export interface DataCenterHistoryEntry {
  /** A former system/user message keeps its original role, never current authority. */
  authority: 'history';
  role: string;
  text: string;
  uri?: string;
  id?: string;
  origin?: string;
}

export interface DataCenterContext {
  project: string;
  request: string;
  requestUri: string;
  documents: DataCenterDocument[];
  memories: DataCenterDocument[];
  history: DataCenterHistoryEntry[];
}

export interface DataCenterMaterial {
  project: string;
  request: string;
  requestUri: string;
  /** Only resources selected for this project, including approved memories. */
  documents: DataCenterDocument[];
  history: DataCenterHistoryEntry[];
  warnings: DataCenterAvailability[];
}

export interface DataCenterClient {
  readonly endpointUrl: string;
  listPrompts(): Promise<DataCenterResult<DataCenterPrompt[]>>;
  readPrompt(name: string): Promise<DataCenterResult<string>>;
  discoverProjects(): Promise<DataCenterResult<DataCenterProject[]>>;
  listMaterial(project: string): Promise<DataCenterResult<DataCenterMaterial>>;
  getContext(project: string): Promise<DataCenterResult<DataCenterContext>>;
  readDocument(uri: string): Promise<DataCenterResult<DataCenterDocument>>;
  /** Retrieves literal request and selected resources; optional context failure becomes a warning. */
  loadProject(project: string): Promise<DataCenterResult<DataCenterMaterial>>;
}

export interface DataCenterClientOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Safe reads alone are retried. The default is one retry. */
  retries?: number;
  retryDelayMs?: number;
  maxResponseBytes?: number;
  wait?: (milliseconds: number) => Promise<void>;
}
