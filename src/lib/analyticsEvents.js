export const ANALYTICS_EVENTS = Object.freeze({
  customizer_opened: Object.freeze({ ga4: 'customizer_opened', meta: 'DesignStarted' }),
  decoration_add: Object.freeze({ ga4: 'decoration_added', meta: 'DecorationAdded' }),
  summary_viewed: Object.freeze({ ga4: 'design_completed', meta: 'DesignCompleted' }),
  purchase_clicked: Object.freeze({ ga4: 'designer_handoff', meta: 'DesignerHandoff' }),
})

export const ANALYTICS_EVENT_NAMES = Object.freeze(Object.keys(ANALYTICS_EVENTS))

export function validGaClientId(value) {
  return typeof value === 'string' && /^\d{1,20}\.\d{1,20}$/.test(value)
}

export function validMetaCookie(value, prefix) {
  return typeof value === 'string'
    && value.length <= 250
    && new RegExp(`^fb\\.1\\.\\d{10,13}\\.[A-Za-z0-9._-]{1,200}$`).test(value)
    && (!prefix || value.startsWith(prefix))
}

