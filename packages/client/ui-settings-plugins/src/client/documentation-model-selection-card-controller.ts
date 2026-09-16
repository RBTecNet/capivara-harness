/** Staged editor for the documentation executor and validator model routes. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelProviderGroup } from '@capivara-harness/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@capivara-harness/dsh-client-store'
import type { SettingsScope } from '@capivara-harness/dsh-client-ui-settings/client'
import type { CardShell } from './card-form.ts'

/** Namespace of the Host-owned documentation model routes. */
export const DOCUMENTATION_MODEL_SELECTION_NS = 'documentation-model-selection'

/** One exact provider/model route stored for a documentation role. */
export interface DocumentationModelRoute {
  /** Registered provider id. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Settings fields stored for the documentation workflow. */
export interface DocumentationModelSelectionSettings {
  /** Route used to analyze requirements and write documentation. */
  executor: DocumentationModelRoute
  /** Route used to inspect and validate the result. */
  validator: DocumentationModelRoute
}

/** A catalog row joined with a saved route that may no longer be advertised. */
export interface DocumentationModelCandidate extends DocumentationModelRoute {
  /** Stable opaque identity used only for lookup. */
  key: string
  /** Provider display name from the live adapter catalog. */
  providerName: string
  /** Model display name from the live adapter catalog. */
  modelName: string
  /** Whether the current adapter catalog advertises this route. */
  available: boolean
}

/** State rendered by the two-role model route card. */
export interface DocumentationModelSelectionCardState extends CardShell {
  /** Draft route selected for the executor. */
  executor: DocumentationModelRoute
  /** Draft route selected for the validator. */
  validator: DocumentationModelRoute
  /** Live catalog joined with saved and staged routes. */
  candidates: readonly DocumentationModelCandidate[]
  /** Adapter-directory request state. */
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  /** Whether any provider-local catalog request failed. */
  catalogPartial: boolean
  /** Whether a newer Host revision invalidated the current draft. */
  conflicted: boolean
  /** Whether both roles currently use the same exact route. */
  sameRoute: boolean
}

/** Registration-side face for the documentation model route card. */
export interface DocumentationModelSelectionCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useDocumentationModelSelectionCard. */
    documentationModelSelectionCard: SnapshotStore<DocumentationModelSelectionCardState>
  }
  /** Stage one role's route by catalog key. */
  selectRole: (role: 'executor' | 'validator', key: string) => void
  /** Retry the adapter directory. */
  retryCatalog: () => void
  /** Persist both routes as one revision-fenced mutation. */
  save: () => void
  /** Drop staged route choices. */
  discard: () => void
}

/**
 * Stable identity for one exact route; callers resolve it by lookup and never parse it.
 * @param route - provider/model route to identify.
 * @returns opaque route key used only inside the card.
 */
export function documentationModelKey(route: DocumentationModelRoute): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Join live adapter metadata with routes that remain selectable after disappearance.
 * @param groups - current model catalog grouped by provider.
 * @param stored - routes from the effective settings value.
 * @returns catalog candidates in provider/model display order.
 */
export function documentationModelCandidates(
  groups: readonly ModelProviderGroup[],
  stored: readonly DocumentationModelRoute[],
): DocumentationModelCandidate[] {
  const storedByKey = new Map(stored.map(route => [documentationModelKey(route), { ...route }]))
  const candidates = groups.flatMap(group => group.models.map((model): DocumentationModelCandidate => {
    const route = { provider: group.id, model: model.id }
    storedByKey.delete(documentationModelKey(route))
    return {
      ...route,
      key: documentationModelKey(route),
      providerName: group.name,
      modelName: model.name,
      available: true,
    }
  }))
  for (const route of storedByKey.values()) {
    candidates.push({
      ...route,
      key: documentationModelKey(route),
      providerName: route.provider,
      modelName: route.model,
      available: false,
    })
  }
  return candidates
}

function sameRoute(left: DocumentationModelRoute, right: DocumentationModelRoute): boolean {
  return documentationModelKey(left) === documentationModelKey(right)
}

function sameSettings(left: DocumentationModelSelectionSettings, right: DocumentationModelSelectionSettings): boolean {
  return sameRoute(left.executor, right.executor) && sameRoute(left.validator, right.validator)
}

const EMPTY_ROUTE: DocumentationModelRoute = { provider: '', model: '' }

/** Bridges one settings scope and the live adapter directory onto the card. */
export class DocumentationModelSelectionCardController {
  private catalogGroups: readonly ModelProviderGroup[] = []
  private catalogPartial = false
  private catalogStatus: DocumentationModelSelectionCardState['catalogStatus'] = 'idle'
  private draft: DocumentationModelSelectionSettings | undefined
  private draftRevision: number | undefined
  private saving = false
  private failed = false
  private conflicted = false
  private disposed = false
  private saveGeneration = 0
  private catalogGeneration = 0
  private readonly store: SnapshotStore<DocumentationModelSelectionCardState>
  private readonly unsubscribe: () => void

  /**
   * @param scope - bound documentation model settings scope.
   * @param ctx - context whose remote session namespace serves the model catalog.
   */
  constructor(
    private readonly scope: SettingsScope<DocumentationModelSelectionSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = scope.subscribe(() => {
      if (!this.saving && this.draft !== undefined
        && this.scope.getSnapshot().revision !== this.draftRevision) {
        if (sameSettings(this.currentSettings(), this.draft)) this.clearDraft()
        else this.conflicted = true
      }
      if (this.scope.getSnapshot().status === 'ready' && this.catalogStatus === 'idle') void this.loadCatalog()
      this.publish()
    })
    if (this.scope.getSnapshot().status === 'ready') void this.loadCatalog()
  }

  /** Stop observing settings and suppress late directory/write settlements. */
  dispose(): void {
    this.disposed = true
    this.saveGeneration += 1
    this.catalogGeneration += 1
    this.unsubscribe()
  }

  /**
   * Build the renderer face for this card.
   * @returns the snapshot and staged card actions.
   */
  inject(): DocumentationModelSelectionCardFace {
    return {
      hooks: { documentationModelSelectionCard: this.store },
      selectRole: (role, key) => { this.selectRole(role, key) },
      retryCatalog: () => { void this.loadCatalog() },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  private currentSettings(): DocumentationModelSelectionSettings {
    const value = this.scope.getSnapshot().value
    return value === undefined
      ? { executor: { ...EMPTY_ROUTE }, validator: { ...EMPTY_ROUTE } }
      : {
        executor: { ...value.executor },
        validator: { ...value.validator },
      }
  }

  private desiredSettings(): DocumentationModelSelectionSettings {
    const current = this.draft ?? this.currentSettings()
    return {
      executor: { ...current.executor },
      validator: { ...current.validator },
    }
  }

  private beginDraft(): DocumentationModelSelectionSettings {
    if (this.draft === undefined) {
      this.draft = this.currentSettings()
      this.draftRevision = this.scope.getSnapshot().revision
    }
    return this.draft
  }

  private selectRole(role: 'executor' | 'validator', key: string): void {
    const snapshot = this.scope.getSnapshot()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving) return
    const candidate = this.candidates().find(item => item.key === key)
    if (candidate === undefined) return
    const draft = this.beginDraft()
    draft[role] = { provider: candidate.provider, model: candidate.model }
    this.failed = false
    this.conflicted = false
    this.publish()
  }

  private clearDraft(): void {
    this.draft = undefined
    this.draftRevision = undefined
    this.failed = false
    this.conflicted = false
  }

  private discard(): void {
    if (this.saving) return
    this.clearDraft()
    this.publish()
  }

  private candidates(): DocumentationModelCandidate[] {
    const current = this.currentSettings()
    const stored = [current.executor, current.validator]
    const draft = this.draft
    if (draft !== undefined) stored.push(draft.executor, draft.validator)
    const unique = new Map(stored.map(route => [documentationModelKey(route), route]))
    return documentationModelCandidates(this.catalogGroups, [...unique.values()])
  }

  private async save(): Promise<void> {
    const snapshot = this.scope.getSnapshot()
    const desired = this.desiredSettings()
    const current = this.currentSettings()
    if (this.disposed || snapshot.status !== 'ready' || !snapshot.writable || this.saving
      || sameSettings(current, desired)
      || desired.executor.provider.length === 0 || desired.executor.model.length === 0
      || desired.validator.provider.length === 0 || desired.validator.model.length === 0) return
    if (this.draft !== undefined && snapshot.revision !== this.draftRevision) {
      this.conflicted = true
      this.publish()
      return
    }
    const generation = this.saveGeneration
    this.saving = true
    this.failed = false
    this.conflicted = false
    this.publish()
    await this.scope.mutate([
      { op: 'set', path: ['executor'], value: { ...desired.executor } },
      { op: 'set', path: ['validator'], value: { ...desired.validator } },
    ], this.draftRevision)
    if (generation !== this.saveGeneration) return
    const landed = sameSettings(this.currentSettings(), desired)
    this.saving = false
    this.failed = !landed
    if (landed) this.clearDraft()
    this.publish()
  }

  /** Invalidate and reload model candidates after a Host model input changes. */
  refreshCatalog(): void {
    if (this.disposed) return
    this.catalogGeneration += 1
    this.catalogStatus = 'idle'
    this.catalogPartial = false
    void this.loadCatalog()
  }

  /** Drop Host-specific state and drafts after reconnecting. */
  resetConnection(): void {
    if (this.disposed) return
    this.saveGeneration += 1
    this.saving = false
    this.clearDraft()
    this.catalogGroups = []
    this.refreshCatalog()
  }

  private async loadCatalog(): Promise<void> {
    if (this.disposed || this.catalogStatus === 'loading') return
    const generation = this.catalogGeneration
    this.catalogStatus = 'loading'
    this.catalogPartial = false
    this.publish()
    const response = await this.ctx.remote.session.modelCatalog()
    if (generation !== this.catalogGeneration) return
    if (response.ok) {
      this.catalogGroups = response.value.groups
      this.catalogPartial = response.value.failures.length > 0
      this.catalogStatus = 'ready'
    } else {
      this.catalogStatus = 'error'
    }
    this.publish()
  }

  private projection(): DocumentationModelSelectionCardState {
    const snapshot = this.scope.getSnapshot()
    const current = this.currentSettings()
    const desired = this.desiredSettings()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: !sameSettings(current, desired),
      invalid: desired.executor.provider.length === 0 || desired.executor.model.length === 0
        || desired.validator.provider.length === 0 || desired.validator.model.length === 0,
      saving: this.saving,
      failed: this.failed,
      executor: desired.executor,
      validator: desired.validator,
      candidates: this.candidates(),
      catalogStatus: this.catalogStatus,
      catalogPartial: this.catalogPartial,
      conflicted: this.conflicted,
      sameRoute: sameRoute(desired.executor, desired.validator),
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}
