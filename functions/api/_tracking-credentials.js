export class TrackingCredentialError extends Error {}

function decodeKey(env) {
  const encoded = String(env.TRACKING_CREDENTIALS_KEY || '').trim()
  if (!encoded) throw new TrackingCredentialError('Tracking credential encryption is not configured.')
  let bytes
  try {
    bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  } catch {
    throw new TrackingCredentialError('Tracking credential encryption key is invalid.')
  }
  if (bytes.length !== 32) throw new TrackingCredentialError('Tracking credential encryption key must decode to 32 bytes.')
  return bytes
}

async function cryptoKey(env, usage) {
  return crypto.subtle.importKey(
    'raw',
    decodeKey(env),
    { name: 'AES-GCM' },
    false,
    [usage],
  )
}

function encodeBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function additionalData(shop, provider) {
  return new TextEncoder().encode(`tracking-credentials:v1:${shop}:${provider}`)
}

export async function encryptTrackingCredential(value, shop, provider, env) {
  if (!['ga4', 'meta'].includes(provider)) throw new TrackingCredentialError('Unknown credential provider.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: additionalData(shop, provider),
  }, await cryptoKey(env, 'encrypt'), new TextEncoder().encode(value)))
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`
}

export async function decryptTrackingCredential(value, shop, provider, env) {
  if (!['ga4', 'meta'].includes(provider)) throw new TrackingCredentialError('Unknown credential provider.')
  const [version, ivValue, ciphertextValue, extra] = String(value || '').split('.')
  if (version !== 'v1' || !ivValue || !ciphertextValue || extra) {
    throw new TrackingCredentialError('Stored provider credential is invalid.')
  }
  try {
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: decodeBase64Url(ivValue),
      additionalData: additionalData(shop, provider),
    }, await cryptoKey(env, 'decrypt'), decodeBase64Url(ciphertextValue))
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new TrackingCredentialError('Stored provider credential could not be decrypted.')
  }
}
