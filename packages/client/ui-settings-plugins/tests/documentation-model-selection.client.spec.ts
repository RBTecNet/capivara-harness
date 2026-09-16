import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@capivara-harness/dsh-api-remotes/client'
import { RemoteError, stubSettingsScope, type StubSettingsScope } from '@capivara-harness/dsh-client-test-runtime'
import {
  DocumentationModelSelectionCardController,
  documentationModelCandidates,
  type DocumentationModelSelectionSettings,
} from '../src/client/documentation-model-selection-card-controller.ts'

function acceptWrites<T>(host: StubSettingsScope<T>): void {
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const current = { ...host.scope.getSnapshot().value as object } as Record<string, unknown>
    for (const op of ops) {
      if (op.op === 'set') current[op.path[0]!] = op.value
    }
    host.publish({ value: current as T })
  })
}

function context(options: {
  groups?: readonly { id: string; name: string; models: readonly { id: string; name: string }[] }[]
  error?: string
} = {}) {
  const modelCatalog = vi.fn(() => Promise.resolve(options.error === undefined
    ? {
      ok: true as const,
      value: { groups: options.groups ?? [], failures: [] },
    }
    : {
      ok: false as const,
      error: new RemoteError('gateway/internal', options.error, {}),
    }))
  return { ctx: { remote: { session: { modelCatalog } } } as never, modelCatalog }
}

const initial: DocumentationModelSelectionSettings = {
  executor: { provider: 'alpha', model: 'writer' },
  validator: { provider: 'alpha', model: 'writer' },
}

describe('DocumentationModelSelectionCardController', () => {
  it('keeps saved unavailable routes while joining the live catalog', () => {
    expect(documentationModelCandidates(
      [{ id: 'alpha', name: 'Alpha', models: [{ id: 'writer', name: 'Writer' }] }],
      [initial.executor, { provider: 'legacy', model: 'checker' }],
    )).toEqual([
      expect.objectContaining({ key: 'alpha\0writer', available: true }),
      expect.objectContaining({ key: 'legacy\0checker', available: false }),
    ])
  })

  it('loads the catalog and saves distinct executor and validator routes atomically', async () => {
    const host = stubSettingsScope<DocumentationModelSelectionSettings>()
    acceptWrites(host)
    host.publish({ status: 'ready', writable: true, revision: 4, value: initial, user: {} })
    const catalog = context({
      groups: [
        { id: 'alpha', name: 'Alpha', models: [{ id: 'writer', name: 'Writer' }, { id: 'checker', name: 'Checker' }] },
      ],
    })
    const controller = new DocumentationModelSelectionCardController(host.scope, catalog.ctx)
    const face = controller.inject()

    await vi.waitFor(() => { expect(face.hooks.documentationModelSelectionCard.getSnapshot().catalogStatus).toBe('ready') })
    face.selectRole('validator', 'alpha\0checker')
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['executor'], value: initial.executor },
        { op: 'set', path: ['validator'], value: { provider: 'alpha', model: 'checker' } },
      ], 4)
    })
    expect(face.hooks.documentationModelSelectionCard.getSnapshot()).toMatchObject({
      dirty: false,
      sameRoute: false,
      saving: false,
      failed: false,
    })
    controller.dispose()
  })

  it('reports a catalog failure and suppresses writes while read-only', async () => {
    const host = stubSettingsScope<DocumentationModelSelectionSettings>()
    host.publish({ status: 'ready', writable: false, value: initial, user: {} })
    const catalog = context({ error: 'offline' })
    const controller = new DocumentationModelSelectionCardController(host.scope, catalog.ctx)
    const face = controller.inject()

    await vi.waitFor(() => { expect(face.hooks.documentationModelSelectionCard.getSnapshot().catalogStatus).toBe('error') })
    face.selectRole('validator', 'other\0model')
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()
    controller.dispose()
  })
})
