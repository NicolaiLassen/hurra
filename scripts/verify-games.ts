// The game mechanic verifier (docs/developing.md, "The game mechanic
// verifier"): many simulated parties per game through the SDK, each checked
// against an oracle of the game's rules (the games that can be played in
// teams also in teams), then the old saves. Run it before a deploy:
//
//   npm run verify:games                 # the quick sweep, under two minutes
//   npm run verify:games -- --deep       # five times the seeds
//   npm run verify:games -- --game quiz --size 24 --seed 7   # one run again
//   npm run verify:games -- --game quiz --size 24 --seed 7 --teams   # one run in teams again
//   npm run verify:games -- --teams      # only the runs in teams (--solo: only those alone)
//
// It prints a compact report and writes it to .design/verify/report.md
// (`--report <path>` elsewhere). Exits 1 when an invariant breaks.
import './verify/hooks.ts'

const { main } = await import('./verify/run.ts')
process.exitCode = main(process.argv.slice(2))
