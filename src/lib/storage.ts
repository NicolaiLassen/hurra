// The player identity itself lives in the Supabase auth session; this only
// remembers which session to send a returning guest back to.
const LAST_JOIN_CODE = 'party:last-join-code'

export function rememberJoinCode(joinCode: string) {
  try {
    localStorage.setItem(LAST_JOIN_CODE, joinCode)
  } catch {
    // Storage can be unavailable (private mode); the app still works without it.
  }
}

export function lastJoinCode(): string | null {
  try {
    return localStorage.getItem(LAST_JOIN_CODE)
  } catch {
    return null
  }
}

/** Forgets the remembered session if it's this one, e.g. because it no longer exists. */
export function forgetJoinCode(joinCode: string) {
  try {
    if (localStorage.getItem(LAST_JOIN_CODE) === joinCode) localStorage.removeItem(LAST_JOIN_CODE)
  } catch {
    // Storage can be unavailable (private mode); nothing to forget then.
  }
}
