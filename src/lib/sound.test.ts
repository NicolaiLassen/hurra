// The TV's sound effects volume in the sound player (docs/engine-v2.md, 7.2),
// against a stand-in for the Web Audio API that records what it is asked to do.
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { soundVolumeGain } from './soundVolume'

type Sound = typeof import('./sound')
type Call = ['cancel', number] | ['set', number, number] | ['ramp', number, number]

class FakeParam {
  calls: Call[] = []
  value: number
  constructor(value: number) {
    this.value = value
  }
  cancelScheduledValues(at: number) {
    this.calls.push(['cancel', at])
  }
  setValueAtTime(value: number, at: number) {
    this.calls.push(['set', value, at])
    this.value = value
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.calls.push(['ramp', value, at])
  }
}

class FakeNode {
  connect() {}
  disconnect() {}
}

class FakeSource extends FakeNode {
  buffer: { duration: number; name?: string } | null = null
  onended: (() => void) | null = null
  start() {
    if (this.buffer?.name) started.push(this.buffer.name)
  }
  stop() {}
}

/** What the player asked of the Web Audio API: every context, the sounds that started. */
let contexts: FakeContext[] = []
let started: string[] = []

class FakeContext {
  state = 'running'
  currentTime = 12
  sampleRate = 44_100
  destination = new FakeNode()
  /** The first is the master gain; every sound gets its own after it. */
  gains: { gain: FakeParam }[] = []
  constructor() {
    contexts.push(this)
  }
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: new FakeParam(1) })
    this.gains.push(node)
    return node
  }
  createDynamicsCompressor() {
    const param = () => ({ value: 0 })
    return Object.assign(new FakeNode(), { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() })
  }
  createBuffer() {
    return { duration: 0 }
  }
  createBufferSource() {
    return new FakeSource()
  }
  async decodeAudioData(data: ArrayBuffer) {
    return { duration: 1, name: new TextDecoder().decode(data) }
  }
  async resume() {}
  addEventListener() {}
}

/** A fresh sound player (its state lives in the module). */
async function player(): Promise<Sound> {
  vi.resetModules()
  return import('./sound')
}

/** Turns sound on as the TV's sound toggle does: its change(true), taken from a render (no DOM needed). */
async function turnSoundOn(sound: Sound) {
  let change: ((on: boolean) => void) | undefined
  function Toggle() {
    change = sound.useSoundSetting(false, [])[1]
    return null
  }
  await prerender(createElement(Toggle))
  change!(true)
}

const master = () => contexts[0].gains[0].gain

beforeEach(() => {
  contexts = []
  started = []
  vi.stubGlobal('AudioContext', FakeContext)
  // Each sound file is its own name, so the stand-in knows which sound started.
  vi.stubGlobal('fetch', async (url: string) => new Response(new TextEncoder().encode(url.replace(/^\/sounds\/|\.mp3$/g, ''))))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('setEffectsVolume', () => {
  it('only remembers a volume set before audio is unlocked, and starts the master gain at it', async () => {
    const sound = await player()
    sound.setEffectsVolume(50)
    expect(contexts).toHaveLength(0)
    await sound.unlockAudio()
    expect(master().value).toBeCloseTo(0.8 * soundVolumeGain(50))
  })

  it('moves the master gain to a new volume smoothly, never in a jump', async () => {
    const sound = await player()
    await sound.unlockAudio()
    expect(master().value).toBe(0.8)
    sound.setEffectsVolume(25)
    const end = 12 + sound.VOLUME_RAMP_SECONDS
    expect(master().calls).toEqual([
      ['cancel', 12],
      ['set', 0.8, 12],
      ['ramp', 0.8 * soundVolumeGain(25), end],
    ])
    expect(sound.VOLUME_RAMP_SECONDS).toBeGreaterThan(0.05)
    // The same volume again changes nothing.
    sound.setEffectsVolume(25)
    expect(master().calls).toHaveLength(3)
  })

  it('takes 0 all the way to silence', async () => {
    const sound = await player()
    await sound.unlockAudio()
    sound.setEffectsVolume(0)
    expect(master().calls.at(-1)).toEqual(['ramp', 0, 12 + sound.VOLUME_RAMP_SECONDS])
  })

  it('starts no sound at all at 0, and plays again once the volume is back up', async () => {
    const sound = await player()
    await turnSoundOn(sound)
    sound.setEffectsVolume(0)
    await sound.playSound('fanfare')
    expect(started).toEqual([])
    sound.setEffectsVolume(75)
    await sound.playSound('fanfare')
    expect(started).toEqual(['fanfare'])
  })
})

describe('previewEffectsVolume', () => {
  it('plays one short sound once the gain has reached the new level, however many changes came together', async () => {
    vi.useFakeTimers()
    const sound = await player()
    await turnSoundOn(sound)
    sound.setEffectsVolume(25)
    sound.previewEffectsVolume()
    sound.setEffectsVolume(50)
    sound.previewEffectsVolume()
    await vi.advanceTimersByTimeAsync(sound.VOLUME_RAMP_SECONDS * 1000 - 1)
    expect(started).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => expect(started).toEqual([sound.VOLUME_PREVIEW]))
    await vi.advanceTimersByTimeAsync(5000)
    expect(started).toEqual(['coin'])
  })

  it('stays quiet at 0, and while this device has sound off', async () => {
    vi.useFakeTimers()
    const sound = await player()
    await turnSoundOn(sound)
    sound.setEffectsVolume(0)
    sound.previewEffectsVolume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual([])

    const off = await player()
    await off.unlockAudio()
    off.setEffectsVolume(50)
    off.previewEffectsVolume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual([])
  })
})
