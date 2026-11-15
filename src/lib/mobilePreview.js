// Start closer on mobile while keeping the desktop preview unchanged.
export function defaultPreviewZoom(isMobile, kind) {
  if (!isMobile) return 1
  return kind === 'tote' ? 1.3 : 1
}

// Keep a little more of the patch catalogue visible for totes.
export function defaultMobileTrayPercent(kind) {
  return kind === 'tote' ? 42 : 32
}
