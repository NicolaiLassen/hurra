export const joinUrl = (joinCode: string) => `${window.location.origin}/join/${joinCode}`

export const playerUrl = (playerCode: string) => `${window.location.origin}/p/${playerCode}`

/** Ids and codes are checked before they're queried: a malformed one simply isn't there. */
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export const isJoinCode = (value: string) => /^[A-Z0-9]{4,12}$/.test(value)
export const isPlayerCode = (value: string) => /^[A-Z0-9]{5}$/.test(value)

/** Accepts a scanned player QR code (a /p/<code> URL) or a typed-in code. */
export function parsePlayerCode(text: string): string | null {
  const value = text.trim()
  const fromUrl = value.match(/\/p\/([A-Za-z0-9]+)\/?$/)
  const code = (fromUrl ? fromUrl[1] : value).toUpperCase()
  return isPlayerCode(code) ? code : null
}
