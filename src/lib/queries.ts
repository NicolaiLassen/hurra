// One-off reads and every write (docs/engine-v2.md, 5.3, 5.6 and 5.7). Live
// party data comes from the LiveSessionProvider (useLive.tsx); its adapted v1
// hooks are re-exported here under their old names, so imports keep working.
//
// Every call throws an Error with the server's own words: a GameCallError,
// whose `code` is the database's DETAIL code (for example 'name_taken') or the
// SQLSTATE of a table error, and whose `status` is the HTTP status (0 when the
// server never answered).
import { useCallback } from 'react'
import { ensureSignedIn, renewSignIn } from '@/lib/auth'
import { createGameApi, GameCallError, type EngineRequest, type EngineResponse } from '@/lib/gameApi'
import { listPartyPhotos, listPlayerPhotos, playerPhotoPath, removePlayerPhotos, uploadPlayerPhoto } from '@/lib/media'
import type { RawRecap, RecapDoc } from '@/lib/recap'
import { supabase } from '@/lib/supabase'
import type { AnswerPayload, HostSessionRow, PlayerRow, PublicSession, ScoreEvent, SubmitResult } from '@/lib/types'
import { isJoinCode, isPlayerCode, isUuid } from '@/lib/urls'
import { useLiveQuery, type LiveQuery } from '@/lib/useLiveQuery'

const PLAYER_COLUMNS = 'id, session_id, user_id, name, code, profile, created_at'
/** How long a code that moves a player works (player_transfers' default). */
const MOVE_CODE_MS = 5 * 60_000
/** How long a TV pairing code works (screen_codes' default). */
const SCREEN_CODE_MS = 15 * 60_000

type DbError = { message: string; details?: string | null; code?: string | null }

/**
 * A PostgREST error as a GameCallError: custom PT4xx refusals carry their code in
 * DETAIL and their words for the screen. Any other database error (a SQLSTATE such
 * as 23503) keeps its code for the callers, but its words go to the console only.
 */
function failure(error: DbError, status: number): GameCallError {
  if (status === 0) return new GameCallError("Couldn't reach the party. Check your connection and try again.", 0, 'unavailable')
  const custom = /^PT\d{3}$/.test(error.code ?? '')
  const code = custom ? (error.details ?? '') : (error.code ?? '')
  if (!custom && /^[0-9A-Z]{5}$/.test(code)) {
    console.warn('Database error', code, error.message)
    return new GameCallError('Something went wrong. Try again.', status, code)
  }
  return new GameCallError(error.message || `The party answered ${status}`, status, code)
}

/** The signed-in account no longer exists: writing its user id hits a foreign key to auth.users. */
const accountGone = (error: DbError | null) => error?.code === '23503' && /_user_id_fkey/.test(error.message)

/** A call that writes this account's user id; if the account is gone, signs in afresh and tries once more. */
async function asThisAccount<T>(call: () => PromiseLike<{ data: unknown; error: DbError | null; status: number }>): Promise<T> {
  await ensureSignedIn()
  const result = await call()
  if (!accountGone(result.error)) return unwrap<T>(result)
  await renewSignIn()
  return unwrap<T>(await call())
}

function unwrap<T>({ data, error, status }: { data: unknown; error: DbError | null; status: number }): T {
  if (error) throw failure(error, status)
  return data as T
}

/** For updates: no row changed means it is gone (or this account may not change it). */
function expectRow(result: { data: unknown; error: DbError | null; status: number }, gone: string): void {
  const rows = unwrap<unknown[] | null>(result)
  if (!rows || rows.length === 0) throw new GameCallError(gone, 404, 'not_found')
}

const epochMs = (iso: string | null) => (iso === null ? null : Date.parse(iso))
const normalCode = (code: string) => code.trim().toUpperCase()
const length = (text: string) => [...text].length

// The engine and answer calls, bound to the app's client -------------------------------

const appGameApi = createGameApi(supabase)

/** Sends a move, a host action, a start, an end or a timer sync to the engine (5.3). */
export function callGame(request: EngineRequest): Promise<EngineResponse> {
  return appGameApi.callGame(request)
}

/** Answers a prompt straight to the database (submit_answer), with safe retries. */
export function submitAnswer(gameId: string, key: string, answer: AnswerPayload): Promise<SubmitResult> {
  return appGameApi.submitAnswer(gameId, key, answer)
}

// Finding and joining a party ---------------------------------------------------------

/** A party by its join code, for someone who may not be in it yet; null when there is none. Needs a signed-in user. */
export async function sessionByCode(joinCode: string): Promise<PublicSession | null> {
  const code = normalCode(joinCode)
  if (!isJoinCode(code)) return null
  return unwrap<PublicSession | null>(await supabase.rpc('session_by_code', { p_join_code: code }))
}

export type Membership = {
  session: PublicSession
  player: PlayerRow | null
}

/** Signs this browser in (anonymously if needed) and finds its player in the party; null if there's no such party. */
export async function loadMembership(joinCode: string): Promise<Membership | null> {
  const user = await ensureSignedIn()
  const session = await sessionByCode(joinCode)
  if (!session) return null
  const player = unwrap<PlayerRow | null>(
    await supabase.from('players').select(PLAYER_COLUMNS).eq('session_id', session.id).eq('user_id', user.id).maybeSingle(),
  )
  return { session, player }
}

/**
 * join_session. No retry of its own: PostgREST has no rate limit; the 429 comes
 * from the sign-in (5.9). Refusals carry their code: 'closed', 'archived',
 * 'name_taken', 'bad_name', 'not_found'.
 */
export function joinSession(joinCode: string, name: string): Promise<PlayerRow> {
  return asThisAccount(() => supabase.rpc('join_session', { p_join_code: normalCode(joinCode), p_name: name.trim() }))
}

/** Moves a player to this phone with the code the host showed ('bad_code', 'already_player'). */
export function claimPlayer(code: string): Promise<PlayerRow> {
  return asThisAccount(() => supabase.rpc('claim_player', { p_code: normalCode(code) }))
}

/** claim_screen: pairs this browser as a TV of the party. Returns the party's id. */
export function claimScreen(code: string): Promise<string> {
  return asThisAccount(() => supabase.rpc('claim_screen', { p_code: normalCode(code) }))
}

/** A player by their code, with their party. Null for an unknown code, or one from a party this user isn't in. */
export async function getPlayerByCode(code: string): Promise<(PlayerRow & { session: PublicSession }) | null> {
  const normalized = normalCode(code)
  if (!isPlayerCode(normalized)) return null
  type Row = PlayerRow & { session: (Omit<PublicSession, 'archived_at'> & { archived_at: string | null }) | null }
  const row = unwrap<Row | null>(
    await supabase
      .from('players')
      .select(`${PLAYER_COLUMNS}, session:sessions(id, name, join_code, status, archived_at)`)
      .eq('code', normalized)
      .maybeSingle(),
  )
  if (!row?.session) return null
  return { ...row, session: { ...row.session, archived_at: epochMs(row.session.archived_at) } }
}

// Guest photos (docs/guest-photos.md) ----------------------------------------------------

type PhotoChange = { photo: string | null; previous: string | null }
/** How long one set_my_photo call may take before it counts as unanswered (status 0), as gameApi's calls do. */
const PHOTO_CALL_TIMEOUT_MS = 8000
/** The longest set_my_photo's throttle ever asks a phone to wait. */
const PHOTO_WAIT_MAX_MS = 10_000

/** set_my_photo, given up after 8 s: the answer is then status 0, and the call may still have worked. */
async function callSetMyPhoto(playerId: string, path: string | null) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PHOTO_CALL_TIMEOUT_MS)
  try {
    return await supabase.rpc('set_my_photo', { p_player_id: playerId, p_path: path }).abortSignal(controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * This phone's photo for its player: the prepared JPEG (preparePhoto) goes to
 * `path` (a new one in the player's folder, or the same one again when the
 * phone tries a failed save again), set_my_photo points the player at it,
 * then every other file in the folder is deleted (the photo it replaced, and
 * any a lost answer left). Returns the path. When set_my_photo says too_soon
 * (a second photo within 10 s), this waits the milliseconds its HINT names
 * and asks once more, so a quick retake only takes a few seconds longer. A
 * refusal deletes the new file again; a call that never got an answer
 * (status 0) leaves it, since it may have worked. Refusals: 'not_your_player',
 * 'archived', 'bad_path', 'not_uploaded', 'bad_file', 'too_soon', and
 * Storage's statuses (413, 415, 403).
 */
export async function setMyPhoto(
  player: Pick<PlayerRow, 'id' | 'session_id'>,
  photo: Blob,
  path: string = playerPhotoPath(player.session_id, player.id),
): Promise<string> {
  await uploadPlayerPhoto(path, photo)
  let result = await callSetMyPhoto(player.id, path)
  if (result.error?.details === 'too_soon') {
    const wait = Math.min(Number(result.error.hint) || PHOTO_WAIT_MAX_MS, PHOTO_WAIT_MAX_MS)
    await new Promise((resolve) => setTimeout(resolve, wait + 250))
    result = await callSetMyPhoto(player.id, path)
  }
  if (result.error) {
    const refused = failure(result.error, result.status)
    if (refused.status !== 0) await removePlayerPhotos([path])
    throw refused
  }
  await keepOnly(player, path)
  return path
}

/** Removes this phone's photo for its player, and deletes every file in its folder. */
export async function removeMyPhoto(player: Pick<PlayerRow, 'id' | 'session_id'>): Promise<void> {
  unwrap<PhotoChange>(await callSetMyPhoto(player.id, null))
  await keepOnly(player, null)
}

/**
 * The host's Remove photo: host_remove_photo, then the removed file is
 * deleted. Only that file: a new photo the guest is saving at the same
 * moment stays theirs.
 */
export async function removeGuestPhoto(playerId: string): Promise<void> {
  const change = unwrap<PhotoChange | null>(await supabase.rpc('host_remove_photo', { p_player_id: playerId }))
  if (change?.previous) await removePlayerPhotos([change.previous])
}

/** Deletes every file in the player's folder but `keep`. Never throws. */
async function keepOnly(player: Pick<PlayerRow, 'id' | 'session_id'>, keep: string | null): Promise<void> {
  const paths = await listPlayerPhotos(player.session_id, player.id).catch(() => [] as string[])
  await removePlayerPhotos(paths.filter((path) => path !== keep))
}

/** Deletes every file in a player's folder; a host may list every folder. Never throws. */
async function clearPlayerFolder(sessionId: string, playerId: string): Promise<void> {
  try {
    await removePlayerPhotos(await listPlayerPhotos(sessionId, playerId))
  } catch {
    // Left for the after-party script (docs/guest-photos.md, 11).
  }
}

// Host: parties ---------------------------------------------------------------------------

/** The host's parties, newest first: a 30 s poll, and on returning to the tab. */
export function useSessions(): LiveQuery<HostSessionRow[]> {
  const fetcher = useCallback(
    async () =>
      unwrap<HostSessionRow[]>(
        await supabase
          .from('sessions')
          .select('id, name, join_code, status, archived_at, created_at')
          .order('created_at', { ascending: false }),
      ),
    [],
  )
  return useLiveQuery(fetcher, { pollMs: 30_000 })
}

function checkPartyName(name: string): string {
  const trimmed = name.trim()
  if (length(trimmed) < 1 || length(trimmed) > 80) throw new GameCallError('Party names are 1 to 80 characters', 400, 'bad_name')
  return trimmed
}

/** Creates a party. Without a join code the database makes one. A taken code: 'join_code_taken'. */
export async function createSession(name: string, joinCode?: string): Promise<{ id: string }> {
  const trimmed = checkPartyName(name)
  const code = joinCode === undefined || joinCode.trim() === '' ? null : normalCode(joinCode)
  if (code !== null && !isJoinCode(code)) throw new GameCallError('Join codes are 4 to 12 letters or digits', 400, 'bad_code')
  // A random code that happens to be taken (rare) is simply made again.
  for (let attempt = 0; ; attempt++) {
    const result = await supabase
      .from('sessions')
      .insert({ name: trimmed, ...(code ? { join_code: code } : {}) })
      .select('id')
      .single()
    if (result.error?.code === '23505') {
      if (code) throw new GameCallError(`${code} is already taken. Try another code, or leave it empty.`, 409, 'join_code_taken')
      if (attempt < 2) continue
    }
    return unwrap<{ id: string }>(result)
  }
}

export async function renameSession(sessionId: string, name: string): Promise<void> {
  expectRow(await supabase.from('sessions').update({ name: checkPartyName(name) }).eq('id', sessionId).select('id'), 'That party is gone')
}

export async function setJoining(sessionId: string, open: boolean): Promise<void> {
  expectRow(
    await supabase.from('sessions').update({ status: open ? 'open' : 'closed' }).eq('id', sessionId).select('id'),
    'That party is gone',
  )
}

/** Archiving also closes joining: nobody new should join a party that is over. */
export async function archiveSession(sessionId: string, archived: boolean): Promise<void> {
  const patch = archived ? { archived_at: new Date().toISOString(), status: 'closed' as const } : { archived_at: null }
  expectRow(await supabase.from('sessions').update(patch).eq('id', sessionId).select('id'), 'That party is gone')
}

export async function deleteSession(sessionId: string): Promise<void> {
  // The party's photos first, best effort (docs/guest-photos.md, 4.3).
  try {
    await removePlayerPhotos(await listPartyPhotos(sessionId))
  } catch {
    // Left for the after-party script's --unreferenced.
  }
  unwrap(await supabase.from('sessions').delete().eq('id', sessionId))
}

/**
 * Puts a game on the TV stage, or clears it (null: back to the standings).
 * Putting a game on also leaves the recap scene, so the TV shows it at once.
 */
export async function setSpotlight(sessionId: string, gameId: string | null): Promise<void> {
  const patch = gameId === null ? { spotlight_game_id: null } : { spotlight_game_id: gameId, tv_scene: 'live' as const }
  expectRow(await supabase.from('sessions').update(patch).eq('id', sessionId).select('id'), 'That party is gone')
}

export async function setTvScene(sessionId: string, scene: 'live' | 'recap'): Promise<void> {
  expectRow(await supabase.from('sessions').update({ tv_scene: scene }).eq('id', sessionId).select('id'), 'That party is gone')
}

/**
 * How loud TV screens play the sound effects, 0 (off) to 100: paired TVs and
 * a TV tab of the host's browser follow it at once; phones keep their own volume.
 */
export async function setSoundVolume(sessionId: string, volume: number): Promise<void> {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
    throw new GameCallError('The volume is a whole number from 0 to 100', 400, 'bad_volume')
  }
  expectRow(await supabase.from('sessions').update({ sound_volume: volume }).eq('id', sessionId).select('id'), 'That party is gone')
}

// Host: games -------------------------------------------------------------------------------

function checkGameTitle(title: string): string {
  const trimmed = title.trim()
  if (length(trimmed) < 1 || length(trimmed) > 80) throw new GameCallError('Game titles are 1 to 80 characters', 400, 'bad_title')
  return trimmed
}

export async function addGame(sessionId: string, gameType: string, title: string, position: number): Promise<{ id: string }> {
  return unwrap<{ id: string }>(
    await supabase
      .from('session_games')
      .insert({ session_id: sessionId, game_type: gameType, title: checkGameTitle(title), position })
      .select('id')
      .single(),
  )
}

export async function renameGame(gameId: string, title: string): Promise<void> {
  expectRow(await supabase.from('session_games').update({ title: checkGameTitle(title) }).eq('id', gameId).select('id'), 'That game is gone')
}

export async function moveGame(gameId: string, position: number): Promise<void> {
  expectRow(await supabase.from('session_games').update({ position }).eq('id', gameId).select('id'), 'That game is gone')
}

/** Archiving a live game is refused: "End the game before archiving it" ('active'). */
export async function archiveGame(gameId: string, archived: boolean): Promise<void> {
  expectRow(
    await supabase
      .from('session_games')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', gameId)
      .select('id'),
    'That game is gone',
  )
}

export async function deleteGame(gameId: string): Promise<void> {
  unwrap(await supabase.from('session_games').delete().eq('id', gameId))
}

/** A game's saved settings (hosts only): the quiz's questions and answers, who is in each picture. Null when none are saved. */
export async function readGameSettings(gameId: string): Promise<Record<string, unknown> | null> {
  const row = unwrap<{ config: Record<string, unknown> } | null>(
    await supabase.from('game_settings').select('config').eq('game_id', gameId).maybeSingle(),
  )
  return row?.config ?? null
}

export async function saveGameSettings(gameId: string, config: Record<string, unknown>): Promise<void> {
  const result = await supabase.from('game_settings').upsert({ game_id: gameId, config })
  if (result.error?.code === '23514') throw new GameCallError('These settings are too big to save', 400, 'too_big')
  unwrap(result)
}

// Host: players -----------------------------------------------------------------------------

/**
 * The database stores the name clean (clean_name: odd spaces made plain,
 * invisible characters dropped), and counts look-alikes as the same name.
 */
export async function renamePlayer(playerId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (length(trimmed) < 1 || length(trimmed) > 40) throw new GameCallError('Names are 1 to 40 characters', 400, 'bad_name')
  const result = await supabase.from('players').update({ name: trimmed }).eq('id', playerId).select('id')
  if (result.error?.code === '23505') throw new GameCallError(`Someone is already called "${trimmed}"`, 409, 'name_taken')
  // Nothing left to see once it is cleaned, or over 40 characters.
  if (result.error?.code === '23514') throw new GameCallError('Names are 1 to 40 characters you can see', 400, 'bad_name')
  expectRow(result, 'That player is gone')
}

/**
 * Deletes the player, then sends a sync to every live game of the party, so
 * onPlayerLeave and isFinished run at once (4.5). A failed sync is not an
 * error: the removal stands, and the next timer or move runs the hooks.
 */
export async function removePlayer(sessionId: string, playerId: string): Promise<void> {
  // The photo first, best effort, then the guest's whole folder (docs/guest-photos.md, 4.3).
  await removeGuestPhoto(playerId).catch(() => undefined)
  await clearPlayerFolder(sessionId, playerId)
  unwrap(await supabase.from('players').delete().eq('id', playerId))
  const live = unwrap<{ id: string }[]>(
    await supabase.from('session_games').select('id').eq('session_id', sessionId).eq('status', 'active').is('archived_at', null),
  )
  await Promise.allSettled(live.map((game) => callGame({ type: 'sync', gameId: game.id })))
}

/**
 * A 6-character code that moves this player to a new phone, valid 5 minutes.
 * `expiresAt` is by this device's clock (Date.now()), taken before the call,
 * so the time left shown is never longer than the real one.
 */
export async function issuePlayerTransfer(playerId: string): Promise<{ code: string; expiresAt: number }> {
  const sentAt = Date.now()
  const code = unwrap<string>(await supabase.rpc('host_issue_transfer', { p_player_id: playerId }))
  return { code, expiresAt: sentAt + MOVE_CODE_MS }
}

/** host_revoke_transfer: the move code stops working at once (the host closed its dialog). A used code is fine. */
export async function revokePlayerTransfer(code: string): Promise<void> {
  unwrap(await supabase.rpc('host_revoke_transfer', { p_code: normalCode(code) }))
}

/** host_issue_screen_code: a 6-character code for pairing a TV, valid 15 minutes (`expiresAt` as above). */
export async function issueScreenCode(sessionId: string): Promise<{ code: string; expiresAt: number }> {
  const sentAt = Date.now()
  const code = unwrap<string>(await supabase.rpc('host_issue_screen_code', { p_session_id: sessionId }))
  return { code, expiresAt: sentAt + SCREEN_CODE_MS }
}

/** Deletes every paired screen of the party; each TV falls back to its pairing screen. */
export async function unpairScreens(sessionId: string): Promise<void> {
  unwrap(await supabase.from('session_screens').delete().eq('session_id', sessionId))
}

// Host: points ------------------------------------------------------------------------------

export async function awardPoints(input: {
  sessionId: string
  playerId: string
  gameId: string | null
  points: number
  reason: string | null
}): Promise<void> {
  if (!Number.isInteger(input.points) || input.points === 0) {
    throw new GameCallError('Points are a whole number other than 0', 400, 'bad_points')
  }
  const reason = input.reason?.trim() || null
  if (reason !== null && length(reason) > 200) throw new GameCallError('Reasons are at most 200 characters', 400, 'bad_reason')
  unwrap(
    await supabase.from('score_events').insert({
      session_id: input.sessionId,
      player_id: input.playerId,
      game_id: input.gameId,
      points: input.points,
      reason,
    }),
  )
}

export async function undoPoints(eventId: number): Promise<void> {
  unwrap(await supabase.from('score_events').delete().eq('id', eventId))
}

/** The award page's history, newest first; refetches whenever `revision` changes (pass snapshot.now). */
export function usePlayerEvents(playerId: string, revision?: number): LiveQuery<ScoreEvent[]> {
  const fetcher = useCallback(async () => {
    if (!isUuid(playerId)) return []
    return unwrap<ScoreEvent[]>(
      await supabase
        .from('score_events')
        .select('*')
        .eq('player_id', playerId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20),
    )
  }, [playerId])
  return useLiveQuery(fetcher, { revision: revision ?? null })
}

// The recap ---------------------------------------------------------------------------------

/** session_recap(): the raw material for buildRecapDoc. Hosts only. */
export async function fetchRawRecap(sessionId: string): Promise<RawRecap> {
  return unwrap<RawRecap>(await supabase.rpc('session_recap', { p_session_id: sessionId }))
}

/**
 * Upserts the doc with published_at set, so every Publish and every Update
 * logs, pings the room and moves the revision: the database stamps its own
 * clock over the value sent (touch_recap, 2.9).
 */
export async function publishRecap(sessionId: string, doc: RecapDoc): Promise<void> {
  unwrap(
    await supabase
      .from('session_recaps')
      .upsert({ session_id: sessionId, data: doc, published_at: new Date().toISOString() }, { onConflict: 'session_id' }),
  )
}

export async function unpublishRecap(sessionId: string): Promise<void> {
  unwrap(await supabase.from('session_recaps').update({ published_at: null }).eq('session_id', sessionId))
}

/** The published recap; refetches when `revision` (snapshot.recap.published_at) changes. Null when nothing is published. */
export function usePublishedRecap(sessionId: string, revision: number): LiveQuery<RecapDoc | null> {
  const published = revision > 0
  const fetcher = useCallback(async () => {
    if (!published || !isUuid(sessionId)) return null
    const row = unwrap<{ data: RecapDoc } | null>(
      await supabase.from('session_recaps').select('data').eq('session_id', sessionId).not('published_at', 'is', null).maybeSingle(),
    )
    return row?.data?.version === 1 ? row.data : null
  }, [sessionId, published])
  return useLiveQuery(fetcher, { revision })
}
