import { useCallback, useEffect, useState } from 'react'
import { SOUND_NAMES, SOUNDS, type SoundName } from '@/games/core/sounds'
import { decideSound, type SoundSlot } from '@/lib/soundPolicy'
import { DEFAULT_SOUND_VOLUME, soundVolumeGain, soundVolumeOf } from '@/lib/soundVolume'

// Plays the sound library (public/sounds/<name>.mp3, generated with ElevenLabs
// by `npm run sounds`). Browsers keep audio locked until the page is tapped,
// so the first tap or key press anywhere unlocks it. One sound plays at a time
// (see soundPolicy.ts), through a master gain and a limiter so nothing clips.
// On the TV the master gain also follows the party's sound effects volume
// (setEffectsVolume); phones never set it.

const STORAGE_KEY = 'party:sound'
// Events that count as a user gesture everywhere. A touch only counts when it
// ends, so pointerdown alone never unlocks audio on phones.
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const
const GESTURE_OPTIONS: AddEventListenerOptions = { capture: true, passive: true }
/** The master gain at the full effects volume. */
const MASTER_GAIN = 0.8
/** How long a sound that's cut off takes to fade out. */
const FADE_SECONDS = 0.08
/** How long the master gain takes to reach a new effects volume: smooth, so a change never clicks. */
export const VOLUME_RAMP_SECONDS = 0.15
/**
 * The short sound a volume change plays on the TV. It is about as loud as most
 * effects (the knockout's slash, the announcement pop), so the host can judge
 * the level by it; the toggle's chime is a few dB quieter than they are.
 */
export const VOLUME_PREVIEW: SoundName = 'coin'
let context: AudioContext | null = null
let output: GainNode | null = null
let enabled = false
/** The TV's sound effects volume, 0 to 100 (setEffectsVolume). */
let effectsVolume = DEFAULT_SOUND_VOLUME
let pendingSoft: ReturnType<typeof setTimeout> | undefined
let pendingPreview: ReturnType<typeof setTimeout> | undefined
/** The sound that started last, with the nodes to fade it out. */
let current: (SoundSlot & { source: AudioBufferSourceNode; gain: GainNode }) | null = null
const buffers = new Map<SoundName, Promise<AudioBuffer | null>>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

const masterGain = () => MASTER_GAIN * soundVolumeGain(effectsVolume)

function audio() {
  if (!context) {
    const ctx = new AudioContext()
    context = ctx
    // Master gain into a limiter: even two full-level samples at once can't clip.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    limiter.connect(ctx.destination)
    output = ctx.createGain()
    // A volume the TV set before audio was unlocked applies from the first sound.
    output.gain.value = masterGain()
    output.connect(limiter)
    ctx.addEventListener('statechange', () => {
      // Wait for gestures again whenever the browser suspends audio (e.g. iOS after a call).
      if (ctx.state === 'running') stopListening()
      else startListening()
      notify()
    })
    // A context made during a gesture can start running without a statechange.
    if (ctx.state === 'running') stopListening()
    notify()
  }
  return context
}

/** Call from a tap: browsers keep audio locked until then. Resolves when audio can play (or can't). */
export function unlockAudio(): Promise<void> {
  const ctx = audio()
  if (ctx.state === 'running') {
    stopListening()
    return Promise.resolve()
  }
  // iOS only lets a context run once something has played inside the gesture.
  const silence = ctx.createBufferSource()
  silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
  silence.connect(ctx.destination)
  silence.start(0)
  return ctx.resume().catch(() => {})
}

function onGesture(event: Event) {
  // A press on the sound toggle unlocks audio in its own click handler, so the
  // toggle acts on what was on screen (unlocking here first could re-render it
  // as unlocked, and the click would then turn sound off).
  if (event.target instanceof Element && event.target.closest('[data-sound-toggle]')) return
  void unlockAudio()
}

function startListening() {
  if (typeof window === 'undefined') return
  for (const type of GESTURES) window.addEventListener(type, onGesture, GESTURE_OPTIONS)
}

function stopListening() {
  if (typeof window === 'undefined') return
  for (const type of GESTURES) window.removeEventListener(type, onGesture, GESTURE_OPTIONS)
}

startListening()

export const isAudioUnlocked = () => context?.state === 'running'

export function subscribeAudio(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const isSoundName = (name: unknown): name is SoundName => typeof name === 'string' && name in SOUNDS

function load(name: SoundName) {
  let buffer = buffers.get(name)
  if (!buffer) {
    buffer = fetch(`/sounds/${name}.mp3`)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((data) => (data ? audio().decodeAudioData(data) : null))
      .catch(() => null)
      .then((result) => {
        // A failed download or decode is forgotten, so the next request tries again.
        if (!result) buffers.delete(name)
        return result
      })
    buffers.set(name, buffer)
  }
  return buffer
}

/** Plays a sound now; does nothing while sound is off or locked, if the file is missing, or if another sound wins. */
export async function playSound(name: unknown) {
  if (!enabled || !isSoundName(name)) return
  clearTimeout(pendingSoft) // a real sound beats a pending background one
  await start(name, false)
}

/** A background sound (e.g. points landing) that gives way to any other sound before or after it. */
export function playSoftSound(name: SoundName, delay = 400) {
  clearTimeout(pendingSoft)
  pendingSoft = setTimeout(() => void start(name, true), delay)
}

async function start(name: SoundName, soft: boolean) {
  // At effects volume 0 nothing starts: off means off, not a silent sound holding the slot.
  if (!enabled || effectsVolume === 0) return
  const ctx = audio()
  if (ctx.state !== 'running' || !output) return
  const buffer = await load(name)
  if (!buffer || !enabled || effectsVolume === 0) return

  // Decided after loading, so two sounds requested together still see each other.
  const now = performance.now()
  const { priority } = SOUNDS[name]
  const decision = decideSound({ name, priority, soft }, current, now)
  if (decision === 'skip') return
  if (decision === 'replace' && current) fadeOut(ctx, current)

  const gain = ctx.createGain()
  gain.connect(output)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(gain)
  source.onended = () => gain.disconnect()
  source.start()
  current = { name, priority, soft, startedAt: now, endsAt: now + buffer.duration * 1000, source, gain }
}

/**
 * The TV's sound effects volume, 0 to 100: the party's setting, which the host
 * picks in the control room (docs/engine-v2.md, 7.2). The master gain follows
 * it smoothly, over VOLUME_RAMP_SECONDS, and at 0 no sound starts. Before audio
 * is unlocked it is only remembered. Phones never call it, so they stay at 100
 * and the device's own volume.
 */
export function setEffectsVolume(volume: number) {
  const next = soundVolumeOf(volume)
  if (next === effectsVolume) return
  effectsVolume = next
  if (!context || !output) return
  const at = context.currentTime
  const { gain } = output
  gain.cancelScheduledValues(at)
  // A locked or suspended context's clock stands still, so a ramp would play
  // out after it resumes, from the old level: set the new one at once (nothing
  // is audible yet, so it can't click).
  if (context.state !== 'running') {
    gain.setValueAtTime(masterGain(), at)
    return
  }
  gain.setValueAtTime(gain.value, at)
  gain.linearRampToValueAtTime(masterGain(), at + VOLUME_RAMP_SECONDS)
}

/**
 * Plays VOLUME_PREVIEW once the master gain has reached the effects volume: a
 * change on the TV, so the host hears the new level in the room. Calls close
 * together play it once, and nothing plays at 0, while sound is off or locked.
 */
export function previewEffectsVolume() {
  clearTimeout(pendingPreview)
  pendingPreview = setTimeout(() => void playSound(VOLUME_PREVIEW), VOLUME_RAMP_SECONDS * 1000)
}

function fadeOut(ctx: AudioContext, sound: NonNullable<typeof current>) {
  const at = ctx.currentTime
  sound.gain.gain.cancelScheduledValues(at)
  sound.gain.gain.setValueAtTime(sound.gain.gain.value, at)
  sound.gain.gain.linearRampToValueAtTime(0, at + FADE_SECONDS)
  try {
    sound.source.stop(at + FADE_SECONDS)
  } catch {
    // It already stopped on its own.
  }
}

function readSetting(fallback: boolean) {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === null ? fallback : value === 'on'
  } catch {
    return fallback
  }
}

/**
 * The sounds a phone plays: the toggle's chime, and coin, sad and fanfare for
 * the feed rows aimed at its player and for quiz and fusion results (room-wide
 * sounds belong to the TV). Only a preload hint: any other sound still loads
 * when it first plays, since start() waits for its file.
 */
export const PHONE_SOUNDS: readonly SoundName[] = ['chime', 'coin', 'sad', 'fanfare']

/**
 * This device's sound on/off setting, remembered across visits. While it is
 * on, `preload` (every sound by default) is fetched and decoded ahead.
 */
export function useSoundSetting(defaultOn = true, preload: readonly SoundName[] = SOUND_NAMES) {
  const [on, setOn] = useState(() => readSetting(defaultOn))

  useEffect(() => {
    enabled = on
    if (on) preload.forEach(load)
  }, [on, preload])

  const change = useCallback((next: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // Storage can be unavailable (private mode); the setting just won't stick.
    }
    enabled = next
    if (next) unlockAudio()
    setOn(next)
  }, [])

  return [on, change] as const
}
