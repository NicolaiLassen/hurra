// Builds the old saves the verifier loads (saves.ts): for each version below,
// the games as they were at that commit (git archive into a temporary
// folder), each played by its own bot at that version in its own simulated
// party, with what game_load gave it captured in every phase it went
// through. Everything in it is the bots' invented content: guests named
// Guest 1 to 5, rehearsal questions, songs and sample photo paths.
//
//   node scripts/verify/make-saves.ts
//
// Run it again when a version worth keeping lands (production's, or one
// whose saves a party may still hold), and add that commit below.
import './hooks.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

/** The versions whose saves the night may meet: production's releases and the party build's steps. */
const VERSIONS: [string, string][] = [
  ['v2-rc1', 'production 14 Nov'],
  ['v2-rc6', 'production since 16 Nov'],
  ['f1c888c', 'fusion takes the TV, 25 Nov'],
  ['a0361ca', 'Lydspor arrives, 25 Nov'],
  ['dd4101c', 'Lydspor own average, 26 Nov'],
  ['2370ed8', 'the guest list, 26 Nov'],
  ['6875e30', 'the undealt deck, 26 Nov'],
  ['15a5c3e', 'Lydspor by names, 26 Nov'],
  ['7907e28', 'fusion hidden until asked, 26 Nov'],
]

type Saved = { version: string; game: string; label: string; loaded: unknown }

/** The paths of a value's keys, for telling a save's shape apart from another's. */
function shape(value: unknown, path = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    if (value.length > 0) shape(value[0], `${path}[]`, out)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const here = /^[0-9a-f-]{36}$|^\d+$/.test(key) ? `${path}.*` : `${path}.${key}`
      out.add(here)
      shape(item, here, out)
    }
  }
  return out
}

const out: Saved[] = []
const seen = new Set<string>()
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()

for (const [sha, about] of VERSIONS) {
  const dir = mkdtempSync(join(tmpdir(), 'hurra-saves-'))
  try {
    execFileSync('sh', ['-c', `git -C "${repo}" archive ${sha} src/games | tar -x -C "${dir}"`])
    const games = `${dir}/src/games`
    const { simulateParty } = await import(`${games}/core/simulate.ts`)
    const { botSight, hostBotSight } = await import(`${games}/core/contract.ts`)
    const { gameLogic } = await import(`${games}/logic.ts`)
    const { gameBots } = await import(`${games}/bots.ts`)
    for (const [type, logic] of gameLogic as Map<string, unknown>) {
      const bot = (gameBots as Map<string, { settings?: (ids: string[]) => unknown; move: (s: unknown) => unknown; hostMove?: (s: unknown) => unknown }>).get(type)
      if (!bot) continue
      const party = simulateParty({ games: [logic], players: 4 })
      const ids: string[] = party.players.map((p: { id: string }) => p.id)
      party.addGame('old', type, 'Old round', bot.settings?.(ids) ?? {})
      if (party.send(party.hostUser, { type: 'start', gameId: 'old' }).kind === 'refuse') continue
      let s = 99
      const random = () => {
        s = (s * 16807) % 2147483647
        return (s - 1) / 2147483646
      }
      const roster = [...ids]
      const captured = new Set<string>()
      for (let tick = 0; tick < 400; tick++) {
        const game = party.game('old')
        const st = party.stateOf('old')?.state as Record<string, unknown> | undefined
        const phase = typeof st?.phase === 'string' ? st.phase : Array.isArray(st?.knockouts) ? `knockouts ${Math.min(2, (st!.knockouts as unknown[]).length)}` : 'state'
        const label = `${game.status} ${phase}`
        const loaded = JSON.parse(JSON.stringify((party as unknown as { peek(id: string): unknown }).peek('old')))
        delete loaded.settings
        delete loaded.claimed
        delete loaded.caller
        const signature = `${type}|${label}|${[...shape(loaded.current?.state)].sort().join(',')}`
        if (!captured.has(label) && !seen.has(signature)) {
          captured.add(label)
          seen.add(signature)
          out.push({ version: `${sha} (${about})`, game: type, label, loaded })
        }
        if (game.status !== 'active') break
        if (tick === 3) {
          roster.push(party.addPlayer(`Guest ${roster.length + 1}`).id)
          party.sync('old')
        }
        if (tick === 6 && party.players.length > 2) {
          party.removePlayer(roster[1])
          party.sync('old')
        }
        for (const id of roster) {
          if (!party.players.some((p: { id: string }) => p.id === id) || party.game('old').status !== 'active') continue
          const move = bot.move(botSight(party, 'old', id, random)) as { kind: string; action?: unknown; key?: string; answer?: unknown } | null
          if (move?.kind === 'action') party.send(party.userOf(id), { type: 'action', gameId: 'old', action: move.action })
          if (move?.kind === 'answer') {
            try {
              party.submit('old', move.key, id, move.answer)
            } catch {
              // Too late, or answered already: the database's call.
            }
          }
        }
        const hostMove = party.game('old').status === 'active' ? (bot.hostMove?.(hostBotSight(party, 'old', random)) as { action: unknown; close?: string[] } | null) : null
        if (hostMove) party.send(party.hostUser, { type: 'host-action', gameId: 'old', action: hostMove.action, close: hostMove.close })
        party.tick(1000)
        const wake = party.game('old').wakeAt
        if (party.game('old').status === 'active' && wake !== null && wake <= party.now) party.sync('old')
      }
    }
    console.log(`${sha}: ${out.length} saves so far`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const file = new URL('./saves.json.gz', import.meta.url)
writeFileSync(file, gzipSync(JSON.stringify(out)))
console.log(`${out.length} saves written to ${file.pathname}`)
