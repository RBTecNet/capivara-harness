/** Host-owned model routes for the documentation executor and validator. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@capivara-harness/dsh-settings'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Persisted routes sampled by the documentation tool for each run. */
    documentationModelSelection: DocumentationModelSelectionConfig
  }
}

/** Settings namespace containing the two documentation workflow roles. */
export const DOCUMENTATION_MODEL_SELECTION_SETTINGS_NAMESPACE = 'documentation-model-selection'

/** One exact provider/model route used by a documentation role. */
export interface DocumentationModelRoute {
  /** Registered LLM provider id. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Schema for one exact documentation model route. */
export const DocumentationModelRouteSchema: z<DocumentationModelRoute> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
})

/** Effective routes used by the documentation workflow. */
export interface DocumentationModelSelectionSettings {
  /** Model that inspects requirements and edits documentation. */
  executor: DocumentationModelRoute
  /** Model that independently checks the requested result. */
  validator: DocumentationModelRoute
}

/** Composition defaults for the documentation model routes. */
export interface Config {
  /** Initial executor route before the user settings layer. */
  executor?: DocumentationModelRoute
  /** Initial validator route before the user settings layer. */
  validator?: DocumentationModelRoute
}

/** Settings schema exposed to host configuration clients. */
export const DOCUMENTATION_MODEL_SELECTION_SETTINGS_SCHEMA: z<DocumentationModelSelectionSettings> = z.object({
  executor: DocumentationModelRouteSchema.required(),
  validator: DocumentationModelRouteSchema.required(),
})

const FALLBACK_ROUTE: DocumentationModelRoute = {
  provider: 'deepseek-official',
  model: 'deepseek-flash',
}

/** Read and validate one route at a real settings or composition boundary. */
function assertRoute(value: DocumentationModelRoute, name: string): void {
  if (value.provider.length === 0 || value.provider !== value.provider.trim()
    || value.model.length === 0 || value.model !== value.model.trim()) {
    throw new TypeError(`${name} documentation model route requires normalized provider and model ids`)
  }
}

/** Validate both role routes without imposing that they be different. */
function assertSettings(value: DocumentationModelSelectionSettings): void {
  assertRoute(value.executor, 'executor')
  assertRoute(value.validator, 'validator')
}

/** Singleton settings owner read when the documentation tool starts a run. */
export class DocumentationModelSelectionConfig extends Service {
  static Config: z<Config> = z.object({
    executor: DocumentationModelRouteSchema.default(FALLBACK_ROUTE),
    validator: DocumentationModelRouteSchema.default(FALLBACK_ROUTE),
  })

  private source: () => DocumentationModelSelectionSettings

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'documentationModelSelection')
    const entry: DocumentationModelSelectionSettings = {
      executor: { ...(config.executor ?? FALLBACK_ROUTE) },
      validator: { ...(config.validator ?? FALLBACK_ROUTE) },
    }
    assertSettings(entry)
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        DOCUMENTATION_MODEL_SELECTION_SETTINGS_NAMESPACE,
        DOCUMENTATION_MODEL_SELECTION_SETTINGS_SCHEMA,
        entry,
        {
          setSource: (source) => { this.source = source },
          validate: assertSettings,
          // The documentation tool samples both routes at run start. A live
          // update affects the next run and never changes a run in progress.
          onChange: () => {},
        },
      )
    })
  }

  /**
   * Read detached routes for a new documentation run.
   * @returns The executor and validator routes.
   */
  current(): DocumentationModelSelectionSettings {
    const current = this.source()
    return {
      executor: { ...current.executor },
      validator: { ...current.validator },
    }
  }
}

export const name = 'documentation-model-selection-settings'
export default DocumentationModelSelectionConfig
