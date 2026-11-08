// Generates the app's sound library (src/games/core/sounds.ts) with the
// ElevenLabs sound effects API.
//
//   npm run sounds                    generate the sounds that are missing
//   npm run sounds -- coin gong       regenerate these
//   npm run sounds -- coin --takes 4  make 4 takes in sound-takes/ to listen to
//   npm run sounds -- --pick coin 3   use take 3 as public/sounds/coin.mp3
//
// Reads ELEVENLABS_API_KEY from the environment or .env.development.local.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { SOUND_NAMES, SOUNDS, type SoundName } from '../src/games/core/sounds.ts'

const OUT_DIR = 'public/sounds'
const TAKES_DIR = 'sound-takes'
const API = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'
const MODEL = 'eleven_text_to_sound_v3'
// Higher follows the brief more closely, at the cost of variety between takes.
const PROMPT_INFLUENCE = 0.6

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY
  for (const file of ['.env.development.local', '.env.local']) {
    if (!existsSync(file)) continue
    const match = readFileSync(file, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m)
    if (match) return match[1].trim()
  }
  throw new Error('Set ELEVENLABS_API_KEY in the environment or .env.development.local')
}

function assertSound(name: string): asserts name is SoundName {
  if (!(name in SOUNDS)) throw new Error(`Unknown sound "${name}". Known: ${SOUND_NAMES.join(', ')}`)
}

async function generate(name: SoundName, file: string) {
  const { prompt, seconds } = SOUNDS[name]
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: seconds, prompt_influence: PROMPT_INFLUENCE, model_id: MODEL }),
  })
  if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  console.log(`${file}  ${(statSync(file).size / 1024).toFixed(0)} KB`)
}

const args = process.argv.slice(2)

if (args[0] === '--pick') {
  const [, name, take] = args
  assertSound(name)
  copyFileSync(`${TAKES_DIR}/${name}-${take}.mp3`, `${OUT_DIR}/${name}.mp3`)
  console.log(`${OUT_DIR}/${name}.mp3 is now take ${take}`)
} else {
  const takesIndex = args.indexOf('--takes')
  const takes = takesIndex >= 0 ? Number(args[takesIndex + 1]) : 0
  const names = args.filter((arg, i) => !arg.startsWith('--') && (takesIndex < 0 || i !== takesIndex + 1))
  names.forEach(assertSound)
  const targets = (names.length ? names : SOUND_NAMES.filter((name) => !existsSync(`${OUT_DIR}/${name}.mp3`))) as SoundName[]
  if (targets.length === 0) console.log('All sounds exist. Name some to regenerate them, e.g. npm run sounds -- coin')

  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(TAKES_DIR, { recursive: true })
  for (const name of targets) {
    if (takes > 0) {
      for (let take = 1; take <= takes; take++) await generate(name, `${TAKES_DIR}/${name}-${take}.mp3`)
    } else {
      await generate(name, `${OUT_DIR}/${name}.mp3`)
    }
  }
}
