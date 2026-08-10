function isAppleMobile(userAgent = '') {
  return /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && 'ontouchend' in document)
}

export async function downloadPng(dataUrl, filename, env = window) {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const appleMobile = isAppleMobile(env.navigator?.userAgent || '')

  if (appleMobile) {
    env.open(objectUrl, '_blank', 'noopener')
  } else {
    const anchor = env.document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    anchor.style.display = 'none'
    env.document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
  env.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
}