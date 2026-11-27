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

// The host's live game cards (src/components/host/LiveGameCard.tsx): each
// remembers in this browser whether the host opened or closed it, so a reload
// leaves it as the host left it. A card the host never touched follows the
// card's own default.
const OPEN_CARD_PREFIX = 'hurra:host:open-card:'

type CardStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The page's localStorage, or null without a window. Reaching it may throw: callers guard it. */
const pageStorage = (): CardStorage | null => (typeof window === 'undefined' ? null : window.localStorage)

/** Whether the host left this game's card open (true) or closed (false); null when they never chose, or storage fails. */
export function cardChoice(gameId: string, storage: () => CardStorage | null = pageStorage): boolean | null {
  try {
    const value = storage()?.getItem(OPEN_CARD_PREFIX + gameId)
    return value === '1' ? true : value === '0' ? false : null
  } catch {
    return null
  }
}

/** Remembers that the host opened or closed this game's card. */
export function rememberCardOpen(gameId: string, open: boolean, storage: () => CardStorage | null = pageStorage): void {
  try {
    storage()?.setItem(OPEN_CARD_PREFIX + gameId, open ? '1' : '0')
  } catch {
    // Full, blocked or missing: the card still opens and closes, and a reload brings back its default.
  }
}
