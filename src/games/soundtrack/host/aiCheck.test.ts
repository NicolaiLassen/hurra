// The host page's side of the AI check: when it asks, what it shows, and that
// any failure is a reply, never a throw. No network: fetch is stubbed.
import { describe, expect, it } from 'vitest'
import { aiDue, aiLine, aiStatus, requestAiCheck } from './aiCheck'

const locked = { phase: 'locked' as const, review: [], ai: null }

describe('the AI check on the host page', () => {
  it('is due once locked with the check on, until its verdicts are in', () => {
    expect(aiDue(true, locked)).toBe(true)
    expect(aiDue(true, { ...locked, phase: 'reveal' })).toBe(true)
    expect(aiDue(false, locked)).toBe(false)
    expect(aiDue(true, { ...locked, phase: 'lastCall', review: null })).toBe(false)
    expect(aiDue(true, { ...locked, ai: { at: 1, asked: 3, accepted: 1 } })).toBe(false)
    expect(aiDue(true, { ...locked, phase: 'done' })).toBe(false)
  })

  it('says how it went, and offers a retry only when it did not run', () => {
    expect(aiLine(aiStatus(false, locked, { kind: 'idle' }))).toBeNull()
    expect(aiLine(aiStatus(true, { ...locked, phase: 'playing' }, { kind: 'idle' }))).toBeNull()
    expect(aiLine(aiStatus(true, locked, { kind: 'running' }))).toMatch(/checking/)
    expect(aiStatus(true, locked, { kind: 'failed', message: 'The AI refused (502)' })).toEqual({ kind: 'failed', message: 'The AI refused (502)' })
    expect(aiLine({ kind: 'failed', message: 'The AI refused (502).' })).toBe(
      'The AI check didn’t run: the AI refused (502). The rule’s verdicts stand, and you can accept answers yourself.',
    )
    expect(aiLine(aiStatus(true, { ...locked, ai: { at: 1, asked: 12, accepted: 5 } }, { kind: 'failed', message: 'x' }))).toBe(
      'The AI accepted 5 of 12 typed answers the rule didn’t count. Undo any in the review.',
    )
    expect(aiLine({ kind: 'done', asked: 0, accepted: 0 })).toMatch(/nothing to look at/)
  })

  it('asks the server with the host’s token, and turns every failure into a reply', async () => {
    const seen: RequestInit[] = []
    const reply = (status: number, body: unknown) => async (_: unknown, init?: RequestInit) => {
      seen.push(init!)
      return Response.json(body, { status })
    }
    expect(await requestAiCheck('g1', { token: 't1', fetch: reply(200, { ran: true, asked: 4, accepted: 2 }) as typeof fetch })).toEqual({
      ran: true,
      asked: 4,
      accepted: 2,
      already: false,
    })
    expect(new Headers(seen[0].headers).get('authorization')).toBe('Bearer t1')
    expect(JSON.parse(String(seen[0].body))).toEqual({ gameId: 'g1' })
    expect(await requestAiCheck('g1', { token: 't1', fetch: reply(200, { ran: false, reason: 'timeout', message: "The AI didn't answer in time" }) as typeof fetch })).toEqual({
      ran: false,
      reason: 'timeout',
      message: "The AI didn't answer in time",
    })
    expect(await requestAiCheck('g1', { token: 't1', fetch: reply(403, { error: 'Only hosts can do that' }) as typeof fetch })).toMatchObject({ ran: false, message: 'Only hosts can do that' })
    expect(await requestAiCheck('g1', { token: 't1', fetch: reply(502, 'gateway') as typeof fetch })).toMatchObject({ ran: false, message: 'the server answered 502' })
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect(await requestAiCheck('g1', { token: null, fetch: offline })).toMatchObject({ ran: false, message: 'no answer from the server' })
  })
})
