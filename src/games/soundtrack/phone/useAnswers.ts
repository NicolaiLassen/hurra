// What this phone has answered in Lydspor, and how it saves (spec 4.7 and
// 4.7.1): the database's answers with this phone's own saves on top until the
// snapshot catches up, the fields' unsaved drafts (kept in sessionStorage),
// typed saves one at a time per prompt, and photo taps: shown at once, sent
// as one or two writes, rolled back on a refusal, with the swap toast's Undo.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnswerPayload } from '@/games/core/Game'
import { answerPhoto, answerText } from '@/games/soundtrack/read'
import { promptKey, type SongPart, type TypedPart } from '@/games/soundtrack/types'
import { dbTrim, decideSave, NOT_EMPTIED, readDraft, refusalWords, serialSaves, writeDraft } from '@/games/soundtrack/typing'
import type { SubmitResult } from '@/lib/types'
import { confirmAnswer, planPhoto, photoChoice, settleLedger, shownAnswer, type Confirmed, type PhotoWrite } from './model'
import { swapToast } from './words'

/** The line under a field left with unsaved text after the lock. */
export const NOT_SENT_IN_TIME = 'This one was not sent before the lock.'

/** How long the swap toast and its Undo last, unless the next change comes first. */
export const TOAST_MS = 8000
/** How long both rows of a swap wear "Swapped". */
export const FLASH_MS = 4000

export type SwapNotice = { id: number; title: string; detail: string; undo: PhotoWrite[] }
/** Why a photo tap didn't go through; `offline` puts "Tap again" on the photo's tile. */
export type PhotoNote = { n: number; photo: number; words: string; offline: boolean }

type TextSave = { n: number; part: TypedPart; text: string }

/** Every typed part a draft may be kept for: the moment only ever has one with typed moments on. */
const TYPED: readonly TypedPart[] = ['title', 'singer', 'moment']

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

/** Every unsaved text this tab kept for the round, by prompt key. */
function storedDrafts(round: string, total: number): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (let n = 1; n <= total; n++) {
    for (const part of TYPED) {
      const key = promptKey(n, part)
      const text = readDraft(round, key)
      if (text !== null) drafts[key] = text
    }
  }
  return drafts
}

export type Answers = ReturnType<typeof useAnswers>

export function useAnswers({
  round,
  total,
  played,
  myAnswers,
  submit,
  closed,
}: {
  /** The game round: drafts are kept per round. */
  round: string
  total: number
  played: number
  myAnswers: Readonly<Record<string, AnswerPayload>>
  submit: (key: string, answer: AnswerPayload) => Promise<SubmitResult>
  /** True once the answers are closed (the phone's clock past the lock): nothing is sent then. */
  closed: () => boolean
}) {
  const [ledger, setLedger] = useState<Record<string, Confirmed>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>(() => storedDrafts(round, total))
  const [saving, setSaving] = useState<Record<string, number>>({})
  const [under, setUnder] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Record<number, number | null> | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoNote, setPhotoNote] = useState<PhotoNote | null>(null)
  const [notice, setNotice] = useState<SwapNotice | null>(null)
  const [flash, setFlash] = useState<{ id: number; songs: number[] } | null>(null)

  // The latest of everything, for saves that finish after a render.
  const latest = useRef({ myAnswers, ledger, drafts, submit, closed, round, played, pending })
  useEffect(() => {
    latest.current = { myAnswers, ledger, drafts, submit, closed, round, played, pending }
  })
  const photoLock = useRef(false)

  // A save the snapshot has caught up with leaves the ledger, so a teammate's later answer shows (settleLedger).
  useEffect(() => {
    setLedger((current) => settleLedger(current, myAnswers))
  }, [myAnswers])

  const savedOf = (key: string) => shownAnswer(myAnswers[key], ledger[key])

  const keepDraft = useCallback((key: string, text: string | null) => {
    writeDraft(latest.current.round, key, text)
    setDrafts((current) => (text === null ? without(current, key) : current[key] === text ? current : { ...current, [key]: text }))
  }, [])

  /** Notes an answer the database confirmed. */
  const confirm = useCallback((key: string, answer: AnswerPayload) => {
    const snapshot = latest.current.myAnswers[key]
    setLedger((current) => ({ ...current, [key]: confirmAnswer(current[key], snapshot, answer) }))
  }, [])

  // Typed saves, one at a time per prompt; each decides again when its turn comes.
  const [queueText] = useState(() =>
    serialSaves<TextSave>(async (key, { n, part, text }) => {
      const now = latest.current
      const saved = answerText(shownAnswer(now.myAnswers[key], now.ledger[key]))
      const decision = decideSave(text, saved)
      if (decision.kind !== 'send') return
      if (now.closed()) {
        setUnder((current) => ({ ...current, [key]: NOT_SENT_IN_TIME }))
        return
      }
      setSaving((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))
      try {
        const result = await now.submit(key, { text: decision.text })
        confirm(key, result.answer)
        setUnder((current) => without(current, key))
        const draft = latest.current.drafts[key]
        if (draft !== undefined && dbTrim(draft) === dbTrim(text)) keepDraft(key, null)
      } catch (error) {
        setUnder((current) => ({ ...current, [key]: refusalWords(error, n, part) }))
      } finally {
        setSaving((current) => {
          const left = (current[key] ?? 1) - 1
          return left > 0 ? { ...current, [key]: left } : without(current, key)
        })
      }
    }),
  )

  /** The guest typed: the text waits as a draft (in memory and this tab's storage) until the field is left. */
  const change = useCallback(
    (n: number, part: TypedPart, text: string) => {
      const key = promptKey(n, part)
      const now = latest.current
      const saved = answerText(shownAnswer(now.myAnswers[key], now.ledger[key]))
      // Only the exact text drops the draft: a space typed after a saved word must stay under the cursor.
      keepDraft(key, text === saved ? null : text)
      setUnder((current) => (current[key] === NOT_EMPTIED ? without(current, key) : current))
    },
    [keepDraft],
  )

  /** The field was left (Next, Done, a tap elsewhere, the page going hidden): save it if it changed. */
  const leave = useCallback(
    (n: number, part: TypedPart, text: string) => {
      const key = promptKey(n, part)
      const now = latest.current
      const saved = answerText(shownAnswer(now.myAnswers[key], now.ledger[key]))
      const decision = decideSave(text, saved)
      if (decision.kind === 'none' || decision.kind === 'same') {
        keepDraft(key, null)
        return
      }
      if (decision.kind === 'restore') {
        keepDraft(key, null)
        setUnder((current) => ({ ...current, [key]: NOT_EMPTIED }))
        return
      }
      if (now.closed()) {
        setUnder((current) => ({ ...current, [key]: NOT_SENT_IN_TIME }))
        return
      }
      void queueText(key, { n, part, text })
    },
    [keepDraft, queueText],
  )

  /** Each played song's photo as this phone shows it, its own taps included at once. */
  const events: (number | null)[] = Array.from({ length: played }, (_, i) => {
    if (pending && i + 1 in pending) return pending[i + 1]
    return answerPhoto(savedOf(promptKey(i + 1, 'event')))
  })
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  })

  /** Sends photo writes in order; on a refusal, writes back what went through. Resolves true when all were saved. */
  const runWrites = useCallback(
    async (writes: PhotoWrite[], n: number, photo: number): Promise<boolean> => {
      const before = eventsRef.current
      photoLock.current = true
      setPhotoBusy(true)
      setPhotoNote(null)
      setNotice(null)
      setPending(Object.fromEntries(writes.map((w) => [w.n, w.photo])))
      const done: PhotoWrite[] = []
      const write = async ({ n: song, photo: value }: PhotoWrite) => {
        const key = promptKey(song, 'event')
        const result = await latest.current.submit(key, photoChoice(value))
        confirm(key, result.answer)
      }
      try {
        for (const w of writes) {
          await write(w)
          done.push(w)
        }
        return true
      } catch (error) {
        // Put back what went through, last first. If that fails too, the rows
        // that share a photo say so, and the scoring guard makes it pay nothing.
        for (const w of done.reverse()) {
          try {
            await write({ n: w.n, photo: before[w.n - 1] ?? null })
          } catch {
            break
          }
        }
        const words = refusalWords(error, n, 'event')
        setPhotoNote({ n, photo, words, offline: words.startsWith('Not sent') })
        return false
      } finally {
        setPending(null)
        photoLock.current = false
        setPhotoBusy(false)
      }
    },
    [confirm],
  )

  /** A tap on a photo for song n: placed, swapped or taken, at once; the toast offers Undo for a swap or take. */
  const tapPhoto = useCallback(
    async (n: number, photo: number) => {
      if (photoLock.current || latest.current.closed()) return
      const move = planPhoto(eventsRef.current, n, photo)
      if (move.kind === 'same') return
      const gave = eventsRef.current[n - 1] ?? null
      const ok = await runWrites(move.writes, n, photo)
      if (!ok || move.kind === 'place') return
      const id = Date.now()
      setNotice({ id, ...swapToast({ kind: move.kind, n, other: move.other, photo, gave }), undo: move.undo })
      setFlash({ id, songs: [n, move.other] })
    },
    [runWrites],
  )

  /** Undo: both songs get their photos back. */
  const undo = useCallback(async () => {
    const shown = notice
    if (!shown || photoLock.current || latest.current.closed()) return
    const [first] = shown.undo
    const ok = await runWrites(shown.undo, first.n, first.photo ?? 0)
    if (ok) setFlash({ id: Date.now(), songs: shown.undo.map((w) => w.n) })
  }, [notice, runWrites])

  // The toast lasts 8 seconds, "Swapped" 4.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice((current) => (current?.id === notice.id ? null : current)), TOAST_MS)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash((current) => (current?.id === flash.id ? null : current)), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  const savedText = (n: number, part: TypedPart) => answerText(savedOf(promptKey(n, part)))
  const fieldText = (n: number, part: TypedPart) => drafts[promptKey(n, part)] ?? savedText(n, part) ?? ''

  return {
    /** The text the database has for a part, as this phone knows it. */
    savedText,
    /** What a field shows: its draft, else the saved text. */
    fieldText,
    /** A draft the database doesn't have: "Not sent" on the board. */
    unsent: (n: number, part: TypedPart) => {
      const draft = drafts[promptKey(n, part)]
      if (draft === undefined) return false
      const text = dbTrim(draft)
      return text !== '' && text !== savedText(n, part)
    },
    saving: (n: number, part: TypedPart) => (saving[promptKey(n, part)] ?? 0) > 0,
    /** The line under a field: the server's words, or why it went back. */
    under: (n: number, part: TypedPart) => under[promptKey(n, part)] ?? null,
    /** Whether a part has an answer the database holds. */
    has: (n: number, part: SongPart) => (part === 'event' ? events[n - 1] != null : savedText(n, part) !== null),
    change,
    leave,
    events,
    photoBusy,
    photoNote,
    tapPhoto,
    notice,
    undo,
    dismissNotice: () => setNotice(null),
    flash: flash?.songs ?? [],
  }
}
