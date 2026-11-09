// Helpers for the integration tests (docs/engine-v2.md, 9.2): real signed-in
// users on the local Supabase stack, the real /api/game handler, and two
// test-only game plugins served through handleGameRequest's logicFor. Each
// test file makes its own World and cleans up what it made.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import { Game, GameError, type AnswerPayload, type GameContext, type PlayerId, type PromptSpec } from '../../src/games/core/Game'
import { ProbeGame, type ProbeState } from '../../src/games/core/probe'
import { gameLogic } from '../../src/games/logic'
import handler from '../functions/game.mts'
import { errorResponse, handleGameRequest, parseGameRequest } from './engine'

Object.assign(process.env, loadEnv('development', process.cwd(), ''))
export const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? ''

// The secret key never leaves this machine: these tests run against the local stack only.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(SUPABASE_URL)) {
  throw new Error('The integration tests run only against the local Supabase stack (supabase start).')
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
export const admin = createClient(SUPABASE_URL, SECRET_KEY, options)
/** A client with no session: what anon gets. */
export const anonClient = () => createClient(SUPABASE_URL, PUBLISHABLE_KEY, options)

export type Person = { client: SupabaseClient; token: string; userId: string }
export type Guest = Person & { playerId: string; name: string }
export type Party = { id: string; join_code: string }
export type Answer = { status: number; body: Record<string, unknown> & { error?: string; code?: string; view?: unknown } }

/** Right after `supabase db reset` the API takes a moment to load the schema: wait for it once. */
let apiReady: Promise<void> | null = null
function waitForApi(): Promise<void> {
  apiReady ??= (async () => {
    for (let i = 0; i < 30; i++) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/keep_alive`, {
        method: 'POST',
        headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => null)
      if (response?.ok) return
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('The local API did not answer within 30 s (is `supabase start` running?)')
  })()
  return apiReady
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const randomCode = (length = 7) =>
  Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

/** The test-only plugins, beside the registry's games. */
export const testLogic = (type: string) =>
  type === 'probe' ? probeGame : type === 'lab' ? labGame : type === 'stuck' ? stuckGame : gameLogic.get(type)

export class World {
  private users: string[] = []
  private sessions: string[] = []

  /** A host: an email user listed in hosts, signed in with a password. */
  async host(): Promise<Person> {
    await waitForApi()
    const email = `host-${crypto.randomUUID()}@example.com`
    const password = `pw-${crypto.randomUUID()}`
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error || !data.user) throw error ?? new Error('createUser failed')
    this.users.push(data.user.id)
    const { error: hostError } = await admin.from('hosts').insert({ user_id: data.user.id })
    if (hostError) throw hostError
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, options)
    const { data: login, error: loginError } = await client.auth.signInWithPassword({ email, password })
    if (loginError || !login.session) throw loginError ?? new Error('sign-in failed')
    return { client, token: login.session.access_token, userId: data.user.id }
  }

  /** An anonymous user, as every guest and every TV is. */
  async user(): Promise<Person> {
    await waitForApi()
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, options)
    const { data, error } = await client.auth.signInAnonymously()
    if (error || !data.session || !data.user) throw error ?? new Error('anonymous sign-in failed')
    this.users.push(data.user.id)
    return { client, token: data.session.access_token, userId: data.user.id }
  }

  async guest(party: Party, name: string): Promise<Guest> {
    const person = await this.user()
    const { data, error } = await person.client.rpc('join_session', { p_join_code: party.join_code, p_name: name })
    if (error) throw error
    return { ...person, playerId: (data as { id: string }).id, name }
  }

  async party(host: Person, name = 'Test party'): Promise<Party> {
    const { data, error } = await host.client
      .from('sessions')
      .insert({ name, join_code: `T${randomCode()}` })
      .select('id, join_code')
      .single()
    if (error) throw error
    this.sessions.push(data.id)
    return data
  }

  async game(host: Person, party: Party, type: string, title: string, settings?: Record<string, unknown>): Promise<string> {
    const { data, error } = await host.client
      .from('session_games')
      .insert({ session_id: party.id, game_type: type, title })
      .select('id')
      .single()
    if (error) throw error
    if (settings) {
      const { error: settingsError } = await host.client.from('game_settings').insert({ game_id: data.id, config: settings })
      if (settingsError) throw settingsError
    }
    return data.id
  }

  /** A TV the host paired with a code. */
  async screen(host: Person, party: Party): Promise<Person> {
    const tv = await this.user()
    const { data: code, error } = await host.client.rpc('host_issue_screen_code', { p_session_id: party.id })
    if (error) throw error
    const { error: claimError } = await tv.client.rpc('claim_screen', { p_code: code })
    if (claimError) throw claimError
    return tv
  }

  /** Deletes what this world made: its parties (and everything in them), then its users. */
  async cleanup() {
    for (const id of this.sessions) await admin.from('sessions').delete().eq('id', id)
    for (const id of this.users) await admin.auth.admin.deleteUser(id)
  }
}

/** POST /api/game through the real handler, as a phone, the TV or the host page sends it. */
export async function call(person: Person | null, body: unknown): Promise<Answer & { timing: string | null }> {
  const response = await handler(
    new Request('http://localhost/api/game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(person ? { Authorization: `Bearer ${person.token}` } : {}) },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: (await response.json()) as Answer['body'], timing: response.headers.get('server-timing') }
}

/**
 * The handler's own steps after the token check, through handleGameRequest
 * with logicFor serving the test-only plugins (the conformance and prompt
 * tests). The user id comes from the verified token, as in the handler.
 */
export async function engine(person: Person, body: Record<string, unknown>): Promise<Answer> {
  const { data, error } = await admin.auth.getClaims(person.token)
  if (error || !data) throw error ?? new Error('getClaims failed')
  try {
    const request = parseGameRequest({ requestId: crypto.randomUUID(), ...body })
    return { status: 200, body: { ...(await handleGameRequest(admin, data.claims.sub, request, { logicFor: testLogic })) } }
  } catch (caught) {
    const { status, body: answer } = errorResponse(caught)
    return { status, body: answer }
  }
}

/** Runs SQL as postgres on the local stack (the meta API), e.g. to hold a transaction open. Local only. */
export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`SQL failed: ${JSON.stringify(body)}`)
  return body as T[]
}

/** Rows as postgres sees them (service_role reads past row level security). */
export async function rows<T = Record<string, unknown>>(table: string, column: string, value: string): Promise<T[]> {
  const { data, error } = await admin.from(table).select('*').eq(column, value)
  if (error) throw error
  return (data ?? []) as T[]
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Test-only plugins ------------------------------------------------------------

export const probeGame = new ProbeGame()

type LabConfig = { secret: string | null }
type LabState = {
  secret: string | null
  opened: string[]
  revealed: { key: string; count: number; answers: Record<PlayerId, AnswerPayload> }[]
  moves: number
  done: boolean
}
type LabHostAction =
  | { type: 'open'; key: string; spec: PromptSpec; closesInMs?: number }
  | { type: 'close'; key: string }
  | { type: 'reveal'; key: string }
  | { type: 'announce'; message: string; to?: PlayerId[] }
  | { type: 'finish' }
  | { type: 'noop' }

/**
 * A lab for the database's prompt rules: the host opens any prompt spec,
 * closes and reveals it; each player's view shows their own revealed answers.
 * Its secret setting goes into the state only, never into a public row.
 */
class LabGame extends Game<LabState, { type: 'move' }, unknown, unknown, LabConfig, LabHostAction> {
  readonly type = 'lab'
  readonly defaultConfig: LabConfig = { secret: null }

  setup(ctx: GameContext<LabConfig>): LabState {
    return { secret: ctx.config.secret, opened: [], revealed: [], moves: 0, done: false }
  }

  parseAction(input: unknown): { type: 'move' } {
    if ((input as { type?: unknown } | null)?.type === 'move') return { type: 'move' }
    throw new GameError('Unknown action')
  }

  handleAction(state: LabState): LabState {
    return { ...state, moves: state.moves + 1 }
  }

  parseHostAction(input: unknown): LabHostAction {
    const action = input as LabHostAction | null
    if (action && typeof action === 'object' && typeof action.type === 'string') return action
    throw new GameError('Unknown host action')
  }

  handleHostAction(state: LabState, action: LabHostAction, ctx: GameContext<LabConfig>): LabState {
    switch (action.type) {
      case 'open':
        ctx.openPrompt(action.key, action.spec, action.closesInMs === undefined ? {} : { closesAt: ctx.now + action.closesInMs })
        return { ...state, opened: [...state.opened, action.key] }
      case 'close':
        ctx.closePrompt(action.key)
        return state
      case 'reveal': {
        if (state.revealed.some((r) => r.key === action.key)) return state
        const answers = ctx.answers[action.key]
        if (!answers) throw new GameError('The question is still open')
        ctx.revealPrompt(action.key)
        const byPlayer = Object.fromEntries(answers.map((a) => [a.playerId, a.answer]))
        return { ...state, revealed: [...state.revealed, { key: action.key, count: answers.length, answers: byPlayer }] }
      }
      case 'announce':
        ctx.announce(action.message, action.to ? { to: action.to } : {})
        return state
      case 'finish':
        return { ...state, done: true }
      case 'noop':
        return state
    }
  }

  isFinished(state: LabState): boolean {
    return state.done
  }

  scores(state: LabState) {
    const scores: Record<PlayerId, number> = {}
    for (const r of state.revealed) for (const id of Object.keys(r.answers)) scores[id] = (scores[id] ?? 0) + 1
    return scores
  }

  publicState(state: LabState) {
    return { opened: state.opened, revealed: state.revealed.map((r) => ({ key: r.key, count: r.count })), moves: state.moves }
  }

  playerView(state: LabState, playerId: PlayerId) {
    return { mine: state.revealed.map((r) => ({ key: r.key, answer: r.answers[playerId] ?? null })) }
  }
}
export const labGame = new LabGame()

/** A game whose onWake never moves wakeAt forward: the stuck guard's test. */
class StuckGame extends ProbeGame {
  readonly type: string = 'stuck'
  wakeAt(): number {
    return 1
  }
  onWake(state: ProbeState): ProbeState {
    return { ...state, step: state.step + 1 }
  }
}
export const stuckGame = new StuckGame()
