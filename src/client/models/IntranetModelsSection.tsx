/**
 * AIDA intranet-models settings section: the preset roster with one-click
 * install. Each card shows the provider name, deployment description, default
 * endpoint, and model count; installing performs the same `settings.mutate`
 * the Models page's custom-provider card does, after which the provider and
 * its models appear in the model picker. Endpoint defaults are loopback and
 * are edited for the intranet host in the Models page after install.
 */

import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from '../locales.ts'
import { INTRANET_MODEL_PRESETS } from './presets.ts'
import type { IntranetModelsController } from './intranet-store.ts'
import css from './intranet-models.module.css'

/** Injected face of the section: the install controller + its store hook. */
export interface IntranetModelsInjected {
  controller: IntranetModelsController
  hooks: {
    /** Install state (status, writable, taken routes, busy). */
    intranetModels: IntranetModelsController['store']
  }
}

/** Full composed props of the settings-section registration. */
export type IntranetModelsSectionProps =
  & PropsRuntime<'settings.section'>
  & InjectFace<IntranetModelsInjected>
  & PropsLocale<typeof NS>

/** Render the AIDA intranet-models preset roster. */
export function IntranetModelsSection({ useIntranetModels, controller, t }: IntranetModelsSectionProps) {
  const state = useIntranetModels(value => value)
  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [state.status, controller])

  const install = (route: string): void => {
    const preset = INTRANET_MODEL_PRESETS.find(candidate => candidate.route === route)
    /* v8 ignore next -- preset always comes from the roster and the install buttons disable while busy. */
    if (preset === undefined || state.busy !== null) return
    void controller.install(preset).then((failure) => {
      if (failure !== undefined) {
        // A settings-conflict (another surface declared the route meanwhile)
        // or transport failure; refresh so the roster reflects reality.
        void controller.load()
      }
    })
  }

  return (
    <section className={css.section} data-testid="aida-intranet-models">
      <h2 className={css.title}>{t('intranet.title')}</h2>
      <p className={css.intro}>{t('intranet.intro')}</p>
      {state.status === 'loading' && <div className={css.notice}>{t('intranet.loading')}</div>}
      {state.status === 'error' && <div className={`${css.notice} ${css.error}`} role="alert">{state.error}</div>}
      {!state.writable && state.status === 'ready' && (
        <div className={`${css.notice} ${css.error}`} role="alert">{t('intranet.readOnly')}</div>
      )}
      <div className={css.cards}>
        {INTRANET_MODEL_PRESETS.map((preset) => {
          const installed = state.taken.includes(preset.route)
          const busy = state.busy === preset.route
          const disabled = !state.writable || state.busy !== null || installed
          return (
            <div key={preset.route} className={css.card} data-testid="aida-intranet-card">
              <div className={css.cardHead}>
                <b className={css.cardName}>{preset.displayName}</b>
                <code className={css.route}>{preset.route}</code>
                {installed && <span className={css.badge}>{t('intranet.installed')}</span>}
              </div>
              <p className={css.description}>{t(preset.descriptionKey)}</p>
              <div className={css.meta}>
                <span className={css.baseUrl} title={preset.baseURL}>{preset.baseURL}</span>
                <span className={css.modelCount}>{preset.models.length} {t('intranet.models')}</span>
              </div>
              <ul className={css.models}>
                {preset.models.slice(0, 4).map(model => <li key={model.id}><code>{model.id}</code></li>)}
                {preset.models.length > 4 && <li className={css.more}>+{preset.models.length - 4}</li>}
              </ul>
              <button
                type="button"
                className={css.install}
                data-testid="aida-intranet-install"
                disabled={disabled}
                aria-busy={busy}
                onClick={() =>{  install(preset.route) }}
              >
                {busy ? t('intranet.installing') : installed ? t('intranet.installed') : t('intranet.install')}
              </button>
              <p className={css.hint}>{t('intranet.hint')}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
