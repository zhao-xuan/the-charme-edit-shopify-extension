export function crossSellTitle(title, fallback = 'Would you like to customise your second product?') {
  return String(title || fallback)
    .replace(/\s*\(\s*extra\s*5%\s*off\s*\)/i, '')
    .trim()
}