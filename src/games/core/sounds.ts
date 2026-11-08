// The app's sound library. Games pick sounds by name (e.g. ctx.announce(...,
// { sound: 'slash' })) and the app plays them. The audio files live in
// public/sounds/<name>.mp3 and are generated from these prompts with
// ElevenLabs: `npm run sounds` (see scripts/generate-sounds.ts).
//
// Prompts are written as sound-design briefs: what makes the sound, its
// attack and tail, its length, and what must not be in it.
//
// Shared by the browser, the game engine and the generator script, so keep it
// plain data with no imports.
//
// `priority` decides which sound wins when two would overlap (see
// src/lib/soundPolicy.ts): a sound cuts off one of equal or lower priority and
// is skipped while a higher one plays.

export const SOUNDS = {
  coin: {
    prompt:
      'Satisfying reward sound for earning points in a party game: a bright, sparkling two-note ascending chime, like a gold coin collected in a polished mobile game. Crisp glassy attack, warm bell tone, short shimmering tail. Clean one-shot UI sound, no music, no voice, no background noise.',
    seconds: 1,
    priority: 2,
  },
  pop: {
    prompt:
      'Soft, rounded bubble pop for an on-screen announcement in a party app: a gentle wet pop followed by a tiny bright sparkle, friendly and modern, like a premium phone notification. Short one-shot, clean, no music, no voice.',
    seconds: 0.6,
    priority: 1,
  },
  chime: {
    prompt:
      'Warm magical sound-check chime: three quick ascending notes on celesta and harp with a soft glittering shimmer tail, inviting and celebratory, high-end app interface sound. One-shot, no music bed, no voice.',
    seconds: 1.4,
    priority: 1,
  },
  whoosh: {
    prompt:
      'Fast, smooth air whoosh moving from left to right, like a playing card flicked past the camera, clean and airy with no impact at the end. Cinematic interface transition, no music, no voice.',
    seconds: 0.7,
    priority: 1,
  },
  gong: {
    prompt:
      'Epic opening gong for a party game tournament: one deep, powerful orchestral gong strike with a rich low boom and a long shimmering metallic tail, slight hall reverb. Single hit, no other instruments, no voice.',
    seconds: 3,
    priority: 4,
  },
  slash: {
    prompt:
      'Sword slash knockout sound: a fast whoosh of a blade cutting through the air, ending in a sharp, bright metallic shing ring. Crisp cinematic foley, punchy and satisfying. Single strike, short tail, no music, no voice.',
    seconds: 1,
    priority: 3,
  },
  gotcha: {
    prompt:
      'Detective "caught you" reveal sting for a murder mystery party game: three punchy orchestral hits, dun dun DUN, with low brass, pizzicato strings and timpani, the last hit biggest with a suspenseful chord. Playful and theatrical, short, no voice.',
    seconds: 1.8,
    priority: 3,
  },
  sad: {
    prompt:
      'Comedic "you are out" sound: a solo muted trombone plays the classic sad trombone, four descending notes, wah wah wah waaah, the last note long and wobbling with exaggerated vibrato. Funny game show fail, dry studio recording, no other instruments, no voice.',
    seconds: 2.4,
    priority: 3,
  },
  fanfare: {
    prompt:
      'Victory fanfare for the last player standing: a short triumphant brass fanfare with a snare roll, rising into a big bright final chord, followed by a party crowd cheering and applauding. Energetic, celebratory, cinematic, no voice-over.',
    seconds: 3.5,
    priority: 5,
  },
  drumroll: {
    prompt:
      'Suspense drum roll for a game show reveal: a tight snare roll that builds steadily in volume and intensity for about two and a half seconds, ending with one crisp cymbal crash. No other instruments, no voice.',
    seconds: 3,
    priority: 3,
  },
} as const satisfies Record<string, { prompt: string; seconds: number; priority: number }>

export type SoundName = keyof typeof SOUNDS

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[]
