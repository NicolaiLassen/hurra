import { describe, expect, it, vi } from 'vitest'

const shown = vi.hoisted(() => [] as { title: unknown; options: { tone?: string; description?: unknown } }[])
vi.mock('@/lib/toast', () => ({
  toast: (title: unknown, options: { tone?: string; description?: unknown }) => void shown.push({ title, options }),
}))

const { announcementTone, toastAnnouncement } = await import('./announcement')

describe('announcements on a phone', () => {
  it("shows a game's red as the hunt's pink, since danger is for destructive host actions only", () => {
    expect(announcementTone('red')).toBe('pink')
    expect(announcementTone('pink')).toBe('pink')
    expect(announcementTone('teal')).toBe('teal')
    expect(announcementTone(null)).toBe('gold')
    expect(announcementTone('plaid')).toBe('gold')
  })

  it("toasts a game's news without its exclamation marks, in its tone", () => {
    shown.length = 0
    toastAnnouncement({ message: "You're out!", detail: 'Ana got you', icon: 'skull', tone: 'red' })
    toastAnnouncement({ message: 'You caught Dee!', detail: 'You keep your task.', icon: 'detective', tone: 'teal' })
    expect(shown.map((t) => [t.title, t.options.description, t.options.tone])).toEqual([
      ["You're out", 'Ana got you', 'pink'],
      ['You caught Dee', 'You keep your task.', 'teal'],
    ])
  })
})
