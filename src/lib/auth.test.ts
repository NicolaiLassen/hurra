import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUSY_MESSAGE, ensureSignedIn, signInHost } from './auth'

type AuthError = { status?: number; code?: string; message: string }

const fake = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  sessionError: null as null | { message: string },
  /** What each anonymous sign-in answers, in order: an error, or null to succeed. */
  answers: [] as (AuthError | null)[],
  /** Answered once the queue is empty. */
  fallback: null as AuthError | null,
  signIns: [] as number[],
  passwordError: null as AuthError | null,
  host: true,
  signOuts: 0,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: fake.sessionError ? null : fake.session }, error: fake.sessionError }),
      signInAnonymously: async () => {
        fake.signIns.push(Date.now())
        const error = fake.answers.length > 0 ? fake.answers.shift()! : fake.fallback
        if (error) return { data: { user: null, session: null }, error }
        const user = { id: `anon-${fake.signIns.length}` }
        fake.session = { user }
        return { data: { user, session: { user } }, error: null }
      },
      signInWithPassword: async () => {
        if (fake.passwordError) return { data: { user: null, session: null }, error: fake.passwordError }
        fake.session = { user: { id: 'host' } }
        return { data: { user: fake.session.user, session: fake.session }, error: null }
      },
      signOut: async () => {
        fake.signOuts++
        fake.session = null
        return { error: null }
      },
    },
    rpc: async () => ({ data: fake.host, error: null }),
  },
}))

const RATE_LIMITED: AuthError = { status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }

beforeEach(() => {
  vi.useFakeTimers({ now: 1_795_900_000_000 })
  Object.assign(fake, { session: null, sessionError: null, answers: [], fallback: null, signIns: [], passwordError: null, host: true, signOuts: 0 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ensureSignedIn', () => {
  it('returns the signed-in user without signing in again', async () => {
    fake.session = { user: { id: 'me' } }
    await expect(ensureSignedIn()).resolves.toEqual({ id: 'me' })
    expect(fake.signIns).toHaveLength(0)
  })

  it('shares one anonymous sign-in between concurrent callers', async () => {
    const [a, b] = await Promise.all([ensureSignedIn(), ensureSignedIn()])
    expect(a).toEqual({ id: 'anon-1' })
    expect(b).toBe(a)
    expect(fake.signIns).toHaveLength(1)
  })

  it('never makes a new user when the session could not be refreshed', async () => {
    fake.sessionError = { message: 'Failed to fetch' }
    await expect(ensureSignedIn()).rejects.toThrow('Failed to fetch')
    expect(fake.signIns).toHaveLength(0)
  })

  it('on HTTP 429 says so once and retries with a growing jitter of 1 to 3 s', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    fake.answers = [RATE_LIMITED, RATE_LIMITED, RATE_LIMITED, null]
    const onBusy = vi.fn()
    const signedIn = ensureSignedIn({ onBusy })
    await vi.runAllTimersAsync()
    await expect(signedIn).resolves.toEqual({ id: 'anon-4' })
    expect(onBusy).toHaveBeenCalledTimes(1)
    const gaps = fake.signIns.slice(1).map((at, i) => at - fake.signIns[i])
    expect(gaps).toEqual([1250, 1500, 1750])
  })

  it('tells a caller who joins a sign-in that is already waiting out a 429 at once', async () => {
    fake.answers = [RATE_LIMITED, null]
    const first = ensureSignedIn()
    await vi.advanceTimersByTimeAsync(0)
    const onBusy = vi.fn()
    const second = ensureSignedIn({ onBusy })
    expect(onBusy).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(await second).toBe(await first)
  })

  it('gives up after about 30 s with a calm message', async () => {
    fake.fallback = RATE_LIMITED
    const started = Date.now()
    const signedIn = ensureSignedIn().catch((error: Error) => error)
    await vi.runAllTimersAsync()
    const error = (await signedIn) as Error
    expect(error.message).toBe(BUSY_MESSAGE)
    expect(Date.now() - started).toBeLessThanOrEqual(30_000)
    expect(Date.now() - started).toBeGreaterThan(25_000)
  })

  it('throws any other sign-in error at once', async () => {
    fake.answers = [{ status: 422, message: 'Anonymous sign-ins are disabled' }]
    const onBusy = vi.fn()
    await expect(ensureSignedIn({ onBusy })).rejects.toThrow('Anonymous sign-ins are disabled')
    expect(onBusy).not.toHaveBeenCalled()
    expect(fake.signIns).toHaveLength(1)
  })
})

describe('signInHost', () => {
  it('signs a host in', async () => {
    await expect(signInHost('host@example.com', 'secret')).resolves.toBeUndefined()
    expect(fake.signOuts).toBe(0)
  })

  it("signs another account out again: this account isn't a host", async () => {
    fake.host = false
    await expect(signInHost('guest@example.com', 'secret')).rejects.toThrow("This account isn't a host")
    expect(fake.signOuts).toBe(1)
  })

  it('passes a wrong password on as Auth says it', async () => {
    fake.passwordError = { status: 400, message: 'Invalid login credentials' }
    await expect(signInHost('host@example.com', 'wrong')).rejects.toThrow('Invalid login credentials')
    expect(fake.signOuts).toBe(0)
  })
})
