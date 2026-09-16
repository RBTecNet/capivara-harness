/** User control for the documentation executor and validator model routes. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@capivara-harness/dsh-client-ui-slots'
import type {
  DocumentationModelCandidate,
  DocumentationModelSelectionCardFace,
} from './documentation-model-selection-card-controller.ts'
import type {} from './slot-contract.ts'
import { PluginCard } from './PluginCard.tsx'
import css from './DocumentationModelSelectionCard.module.css'

/** Props the renderer binds for the documentation model route card. */
export type DocumentationModelSelectionCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<DocumentationModelSelectionCardFace>

function candidateLabel(candidate: DocumentationModelCandidate, unavailable: string): string {
  return `${candidate.providerName} · ${candidate.modelName}${candidate.available ? '' : ` (${unavailable})`}`
}

/**
 * Render the two independently selected documentation model routes.
 * @param props - locale copy, the card snapshot, and the staged route action.
 * @returns the preference card, or nothing when the namespace is unavailable.
 */
export function DocumentationModelSelectionCard(props: DocumentationModelSelectionCardProps) {
  const { t } = props
  const state = props.useDocumentationModelSelectionCard(snapshot => snapshot)
  const routeKey = (route: { provider: string; model: string }) => `${route.provider}\0${route.model}`
  const renderRole = (role: 'executor' | 'validator', labelKey: 'documentationModelSelectionExecutor' | 'documentationModelSelectionValidator', hintKey: 'documentationModelSelectionExecutorHint' | 'documentationModelSelectionValidatorHint') => {
    const selected = role === 'executor' ? state.executor : state.validator
    const selectedKey = routeKey(selected)
    return (
      <label className={css.role} htmlFor={`documentation-${role}-model`}>
        <span className={css.label}>{t(labelKey)}</span>
        <select
          id={`documentation-${role}-model`}
          aria-label={t(labelKey)}
          value={selectedKey}
          disabled={!state.writable || state.saving || state.catalogStatus === 'loading'}
          onChange={(event) => { props.selectRole(role, event.currentTarget.value) }}
        >
          {selectedKey === '\0' ? <option value="\0">{t('documentationModelSelectionChoose')}</option> : null}
          {state.candidates.map(candidate => (
            <option key={candidate.key} value={candidate.key}>
              {candidateLabel(candidate, t('documentationModelSelectionUnavailable'))}
            </option>
          ))}
        </select>
        <span className={css.hint}>{t(hintKey)}</span>
      </label>
    )
  }
  return (
    <PluginCard
      t={t}
      titleKey="documentationModelSelectionTitle"
      descriptionKey="documentationModelSelectionDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.selection}>
        {state.catalogStatus === 'loading'
          ? <p className={css.notice} role="status">{t('documentationModelSelectionLoading')}</p>
          : null}
        {state.catalogStatus === 'error'
          ? (
            <div className={css.catalogError} role="alert">
              <span>{t('documentationModelSelectionLoadFailed')}</span>
              <button type="button" disabled={state.saving} onClick={props.retryCatalog}>
                {t('documentationModelSelectionRetry')}
              </button>
            </div>
          )
          : null}
        {state.catalogPartial
          ? <p className={css.notice}>{t('documentationModelSelectionPartial')}</p>
          : null}
        {renderRole('executor', 'documentationModelSelectionExecutor', 'documentationModelSelectionExecutorHint')}
        {renderRole('validator', 'documentationModelSelectionValidator', 'documentationModelSelectionValidatorHint')}
        {state.sameRoute
          ? <p className={css.notice}>{t('documentationModelSelectionSameRoute')}</p>
          : null}
        {state.invalid
          ? <p className={css.invalid}>{t('documentationModelSelectionRequired')}</p>
          : null}
        {state.conflicted
          ? <p className={css.conflict} role="status">{t('documentationModelSelectionConflict')}</p>
          : null}
      </div>
    </PluginCard>
  )
}
