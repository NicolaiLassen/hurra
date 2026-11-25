// Profile badges by their job (docs/identity.md, Colour jobs): square chips,
// gold only for a win, pink for the hunt's, never a guest colour as status.
import { createElement } from 'react'
import { prerender } from 'react-dom/static'
import { describe, expect, it, vi } from 'vitest'
import ProfileBadges from '@/components/ProfileBadges'
import type { GameData } from '@/lib/types'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

async function html(profile: GameData): Promise<string> {
  const { prelude } = await prerender(createElement(ProfileBadges, { profile }))
  return (await new Response(prelude).text()).replaceAll('<!-- -->', '')
}

describe('profile badges', () => {
  it('are square chips on the overlay surface, the hunt in pink and wins in gold', async () => {
    const page = await html({ elimination: { tags: 2, catches: 1, wins: 1 }, fusion: { detective: 1 }, quiz: { wins: 1 } })
    expect(page).toContain('rounded-chip bg-overlay')
    expect(page).not.toContain('rounded-full')
    expect(page).not.toMatch(/bg-white|text-confetti|text-guest/)
    // Tagged and caught are the hunt's; the hunt's, the quiz's and Who is fused?'s wins are gold.
    expect(page.split('text-pink').length - 1).toBe(2)
    expect(page.split('text-gold').length - 1).toBe(3)
  })
})
