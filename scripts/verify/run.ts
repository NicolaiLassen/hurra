// The game mechanic verifier's sweep: every registered game, across seeds and
// party sizes, each run checked against its game's oracle, paired with a run
// that reloads every table from JSON and (for some seeds) a plain repeat; the
// games that can be played in teams again in teams, with fewer seeds; then the
// old saves. Prints a compact report and writes it as Markdown.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gameBots } from '../../src/games/bots'
import { gameLogic } from '../../src/games/logic'
import { INVARIANT_WORDS, INVARIANTS, TEAM_PLAY_GAMES, type Adapter, type Invariant } from './core'
import { runParty, type RunResult } from './driver'
import { elimination } from './games/elimination'
import { fusion } from './games/fusion'
import { inPerson } from './games/inPerson'
import { quiz } from './games/quiz'
import { soundtrack } from './games/soundtrack'
import { checkOldSaves } from './saves'

const ADAPTERS: Adapter[] = [inPerson, elimination, quiz, fusion, soundtrack]
export const SIZES = [1, 2, 5, 24, 45]

type Options = {
  deep: boolean
  game: string | null
  size: number | null
  seed: number | null
  report: string | null
  quiet: boolean
  /** Only the runs in teams, or only the runs alone; both when neither. */
  teams: boolean
  solo: boolean
}

type Tally = { runs: number; failures: number; first: { seed: number; size: number; message: string; trace: string[] } | null }

export function parseArgs(argv: string[]): Options {
  const value = (name: string) => {
    const i = argv.indexOf(name)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  const number = (name: string) => (value(name) === null ? null : Number(value(name)))
  return {
    deep: argv.includes('--deep'),
    game: value('--game'),
    size: number('--size'),
    seed: number('--seed'),
    report: value('--report'),
    quiet: argv.includes('--quiet'),
    teams: argv.includes('--teams'),
    solo: argv.includes('--solo'),
  }
}

/** Seeds per party size: the big parties are slower, so fewer of them. */
function seedsFor(size: number, deep: boolean): number {
  const base = size <= 5 ? 60 : size <= 24 ? 24 : 12
  return deep ? base * 5 : base
}

/** Seeds per party size in teams: a third of those alone, as the runs in teams come on top. */
function teamSeedsFor(size: number, deep: boolean): number {
  return Math.ceil(seedsFor(size, deep) / 3)
}

/** How a game's runs in teams show in the report. */
const inTeams = (type: string) => `${type} in teams`

export function main(argv: string[]): number {
  const options = parseArgs(argv)
  const started = performance.now()
  const adapters = ADAPTERS.filter((a) => options.game === null || a.type === options.game)
  if (adapters.length === 0) {
    console.error(`No game ${options.game}. Games: ${ADAPTERS.map((a) => a.type).join(', ')}`)
    return 2
  }
  // Every registered game has an oracle here, and nothing here is a game the app doesn't know.
  const missing = [...gameLogic.keys()].filter((type) => !ADAPTERS.some((a) => a.type === type))
  if (missing.length > 0) {
    console.error(`No oracle for ${missing.join(', ')}: add one in scripts/verify/games before relying on this report.`)
  }
  const unknown = TEAM_PLAY_GAMES.filter((type) => !ADAPTERS.some((a) => a.type === type))
  if (unknown.length > 0) console.error(`TEAM_PLAY_GAMES names ${unknown.join(', ')}, which the verifier has no oracle for.`)

  const tallies = new Map<string, Map<Invariant, Tally>>()
  const tally = (game: string, invariant: Invariant) => {
    const byGame = tallies.get(game) ?? new Map<Invariant, Tally>()
    tallies.set(game, byGame)
    const t = byGame.get(invariant) ?? { runs: 0, failures: 0, first: null }
    byGame.set(invariant, t)
    return t
  }
  const endings = new Map<string, { game: number; host: number }>()
  const coverage = new Map<string, Map<string, number>>()
  let calls = 0

  /** One game's sweep, alone or in teams, under `label` in the report. */
  function sweep(adapter: Adapter, label: string, teams: boolean) {
    const logic = gameLogic.get(adapter.type)!
    const bot = gameBots.get(adapter.type)!
    const sizes = options.size !== null ? [options.size] : SIZES
    for (const size of sizes) {
      const count = teams ? teamSeedsFor(size, options.deep) : seedsFor(size, options.deep)
      const seeds = options.seed !== null ? [options.seed] : Array.from({ length: count }, (_, i) => i + 1)
      for (const seed of seeds) {
        const a = runParty(adapter, logic, bot, size, seed, { checks: true, reloads: false, teams })
        calls += a.calls
        const end = endings.get(label) ?? { game: 0, host: 0 }
        for (const how of a.endings) end[how]++
        endings.set(label, end)
        const cover = coverage.get(label) ?? new Map<string, number>()
        coverage.set(label, cover)
        for (const [what, n] of a.counts) cover.set(what, (cover.get(what) ?? 0) + n)
        for (const invariant of INVARIANTS) {
          if (invariant === 'same-seed-same-result' || invariant === 'reloads-change-nothing' || invariant === 'old-saves-load') continue
          if (invariant === 'latecomers-dealt-fairly' && adapter.type !== 'elimination') continue
          if (invariant === 'team-members-equal' && !teams) continue
          record(tally(label, invariant), a, a.failures.get(invariant))
        }
        // The same night with every table reloaded from JSON now and then: nothing may differ.
        const b = runParty(adapter, logic, bot, size, seed, { checks: false, reloads: true, teams })
        calls += b.calls
        cover.set('reloads in the paired runs', (cover.get('reloads in the paired runs') ?? 0) + (b.counts.get('reloads') ?? 0))
        const reloadFailure = b.failures.get('no-exception') ?? (b.hash !== a.hash ? { message: 'the night differs once the tables are reloaded from JSON', trace: [] } : undefined)
        record(tally(label, 'reloads-change-nothing'), a, reloadFailure)
        // And the same night again, plainly.
        if (seed % 3 === 1 || options.seed !== null) {
          const c = runParty(adapter, logic, bot, size, seed, { checks: false, reloads: false, teams })
          calls += c.calls
          record(tally(label, 'same-seed-same-result'), a, c.hash !== a.hash ? { message: 'the same seed gave a different night', trace: [] } : undefined)
        }
        if (!options.quiet) process.stdout.write('.')
      }
    }
    if (!options.quiet) process.stdout.write(` ${label}\n`)
  }

  for (const adapter of adapters) {
    if (!options.teams) sweep(adapter, adapter.type, false)
    if (!options.solo && TEAM_PLAY_GAMES.includes(adapter.type)) sweep(adapter, inTeams(adapter.type), true)
  }

  // States saved by older versions of the games.
  const saves = checkOldSaves(options.game)
  for (const [game, result] of saves) {
    const t = tally(game, 'old-saves-load')
    t.runs += result.runs
    t.failures += result.failures.length
    if (result.failures.length > 0 && !t.first) t.first = { seed: 0, size: 0, message: result.failures[0], trace: result.failures.slice(1, 6) }
  }

  const seconds = (performance.now() - started) / 1000
  const report = render(tallies, endings, coverage, { seconds, calls, deep: options.deep, saves: [...saves.values()].reduce((n, r) => n + r.runs, 0) })
  console.log(report.console)
  const path = options.report ?? '.design/verify/report.md'
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, report.markdown)
    console.log(`Report: ${path}`)
  } catch (error) {
    console.error(`Could not write the report to ${path}: ${error instanceof Error ? error.message : error}`)
  }
  const failed = [...tallies.values()].some((byGame) => [...byGame.values()].some((t) => t.failures > 0))
  return failed ? 1 : 0
}

function record(t: Tally, run: RunResult, failure: { message: string; trace: string[] } | undefined) {
  t.runs++
  if (!failure) return
  t.failures++
  if (!t.first) t.first = { seed: run.seed, size: run.size, message: failure.message, trace: failure.trace }
}

function commit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src', 'scripts'], { encoding: 'utf8' }).trim() !== ''
    return dirty ? `${sha} with uncommitted changes` : sha
  } catch {
    return 'unknown'
  }
}

function render(
  tallies: Map<string, Map<Invariant, Tally>>,
  endings: Map<string, { game: number; host: number }>,
  coverage: Map<string, Map<string, number>>,
  meta: { seconds: number; calls: number; deep: boolean; saves: number },
) {
  const lines: string[] = []
  const md: string[] = []
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16)
  md.push('# Game mechanic verifier', '')
  md.push(
    `${when} UTC, commit ${commit()}, ${meta.deep ? 'deep' : 'quick'} sweep: party sizes ${SIZES.join(', ')}, ` +
      `alone and, for ${TEAM_PLAY_GAMES.join(', ')}, in 2 to 4 teams with a third of the seeds; ` +
      `${meta.calls.toLocaleString('en')} engine calls and ${meta.saves} old saves in ${meta.seconds.toFixed(1)} s.`,
    '',
  )
  md.push(
    'Run it with `npm run verify:games` (`-- --deep` for more seeds; `-- --game quiz --size 24 --seed 7` replays one run, ' +
      'with `--teams` a run in teams, and `--solo` or `--teams` alone keeps to the runs alone or in teams).',
    '',
  )
  md.push('| Game | Invariant | Runs | Result | First failing run |', '| --- | --- | ---: | --- | --- |')
  const failures: string[] = []
  for (const [game, byGame] of tallies) {
    const end = endings.get(game)
    lines.push(`${game}${end ? ` (rounds finished by the game ${end.game}, ended by the host ${end.host})` : ''}`)
    for (const invariant of INVARIANTS) {
      const t = byGame.get(invariant)
      if (!t) continue
      const ok = t.failures === 0
      const first = t.first ? (t.first.size > 0 ? `seed ${t.first.seed}, ${t.first.size} guests` : 'old save') : ''
      lines.push(`  ${ok ? 'pass' : 'FAIL'}  ${invariant.padEnd(24)} ${String(t.runs).padStart(4)} runs${ok ? '' : `, ${t.failures} failed, first ${first}: ${t.first!.message}`}`)
      md.push(`| ${game} | ${INVARIANT_WORDS[invariant]} | ${t.runs} | ${ok ? 'pass' : `**fail** (${t.failures})`} | ${ok ? '' : first} |`)
      if (!ok && t.first) {
        failures.push(`### ${game}: ${invariant}`, '', `${first}: ${t.first.message}`, '')
        if (t.first.trace.length > 0) failures.push('```', ...t.first.trace, '```', '')
      }
    }
  }
  md.push('')
  if (failures.length > 0) md.push('## Failures', '', ...failures)
  else md.push('Every invariant held.', '')
  md.push('## What the runs did', '')
  for (const [game, end] of endings) {
    const cover = [...(coverage.get(game) ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)).map(([what, n]) => `${what} ${n.toLocaleString('en')}`)
    md.push(`- **${game}**: ${end.game} rounds finished by the game, ${end.host} ended by the host; ${cover.join(', ')}.`)
  }
  md.push('')
  lines.push(`${meta.calls.toLocaleString('en')} engine calls, ${meta.saves} old saves, ${meta.seconds.toFixed(1)} s`)
  return { console: lines.join('\n'), markdown: md.join('\n') }
}
