import type { Tone } from '@/games/core/Game'

/** A tone's colours, the same on phones and the TV: the border, the tinted icon circle and the bar. */
export const CALLOUT_TONE: Record<Tone, { border: string; icon: string; bar: string }> = {
  gold: { border: 'border-primary/50', icon: 'bg-primary/15 text-primary', bar: 'bg-primary' },
  pink: { border: 'border-confetti-pink/50', icon: 'bg-confetti-pink/15 text-confetti-pink', bar: 'bg-confetti-pink' },
  teal: { border: 'border-confetti-teal/50', icon: 'bg-confetti-teal/15 text-confetti-teal', bar: 'bg-confetti-teal' },
  violet: {
    border: 'border-confetti-violet/50',
    icon: 'bg-confetti-violet/15 text-confetti-violet',
    bar: 'bg-confetti-violet',
  },
  red: { border: 'border-destructive/60', icon: 'bg-destructive/15 text-destructive', bar: 'bg-destructive' },
}
