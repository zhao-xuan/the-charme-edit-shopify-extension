// Tote is intentionally hidden from the Step 1 base picker in production (an
// explicit merchant request), but the `feature-tote-ui` Cloudflare Pages
// preview branch exists specifically to review the tote experience — show it
// there without touching the production-facing behaviour.
export function showToteInPicker() {
  if (typeof window === 'undefined') return false
  return window.location.hostname.includes('feature-tote-ui')
}
