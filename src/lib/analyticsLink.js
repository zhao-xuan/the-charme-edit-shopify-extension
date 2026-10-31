// The cart hand-off is built outside React, but only the customizer knows which
// analytics session is running. The customizer publishes it here; the hand-off
// reads it when the shopper heads to the cart. Null while nothing is recorded.
let current = null

export const setAnalyticsLink = (link) => {
  current = link && link.sessionId ? { sessionId: String(link.sessionId) } : null
}

export const getAnalyticsLink = () => current
