// The editor returns the customer to the store with a full-page navigation. With
// the browser default the store receives the editor's origin as the Referer, and
// Shopify then records the designer domain as the visit's source instead of the
// campaign that brought the customer. `same-origin` leaves requests to this site
// untouched and sends no referrer anywhere else.
export const EDITOR_REFERRER_POLICY = 'same-origin'

/** Applies the policy for this document; returns a function that undoes it. */
export function applyReferrerPolicy(doc = typeof document === 'undefined' ? null : document, policy = EDITOR_REFERRER_POLICY) {
  if (!doc?.head || typeof doc.createElement !== 'function') return () => {}
  const meta = doc.createElement('meta')
  meta.name = 'referrer'
  meta.content = policy
  doc.head.appendChild(meta)
  return () => meta.remove()
}
