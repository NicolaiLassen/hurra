// The top three's colours in one table, so the TV's podium, the quiz podium,
// the recaps and the rank coins agree (docs/identity.md, Colour jobs): gold
// for the leader, then paper and the darker paper-2, told apart by value. The
// steps' tops are far enough apart to read as two steps from the sofa: paper
// at 35 percent against paper-2 at 15 is 2.15 to 1 on the ground. Whole class
// names, so Tailwind finds them; each screen adds its own sizes.

/** Place 1, 2 and 3: the token's ring, the points and the place's figure, the step's top, a rank coin. */
export const PLACE_TONES = [
  { ring: 'ring-gold', text: 'text-gold', step: 'from-gold/45', coin: 'bg-gold text-ink' },
  { ring: 'ring-paper/80', text: 'text-paper', step: 'from-paper/35', coin: 'bg-paper text-ink' },
  { ring: 'ring-paper-2/80', text: 'text-paper-2', step: 'from-paper-2/15', coin: 'bg-paper-2 text-ink' },
] as const

/** A place's tones, 1 for the leader; ties share a place, and anyone past third has third's. */
export const placeTone = (place: number) => PLACE_TONES[Math.min(Math.max(place, 1), 3) - 1]
