import type { ReactElement } from 'react'
import type { GuestPiece } from '@/lib/guest'

/** A guest's piece, or the star, which stays in the confetti. */
export type PieceKind = GuestPiece | 'star'

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 22, strokeLinecap: 'round' } as const

/**
 * The logo's confetti (public/favicon.svg), each piece on its own square: the
 * logo's own paths in its 512 grid, framed by a viewBox around the piece. The
 * curl and the wave share a square size, so their strokes stay as even as in
 * the logo; the dot gets a smaller square, or it would be a speck on a small
 * token. The curl lies at 45 degrees, so it never reads as an S, and crosses
 * the out stripe instead of hiding under it.
 */
const PIECES: Record<PieceKind, { viewBox: string; shape: ReactElement }> = {
  dot: { viewBox: '313 139 74 74', shape: <circle cx="350" cy="176" r="22" fill="currentColor" /> },
  curl: {
    viewBox: '196 99 132 132',
    shape: <path d="M262 220 C 282 178, 236 158, 262 110" transform="rotate(-45 262 165)" {...STROKE} />,
  },
  wave: { viewBox: '285 199 132 132', shape: <path d="M302 258 C 340 242, 358 290, 400 270" {...STROKE} /> },
  star: {
    viewBox: '353.5 85.5 77 77',
    shape: <path d="M392 90 Q 397 119 426 124 Q 397 129 392 158 Q 387 129 358 124 Q 387 119 392 90 Z" fill="currentColor" />,
  },
}

/** One of the logo's confetti pieces in the current text colour, filling the square `className` gives it. */
export default function Piece({ kind, className }: { kind: PieceKind; className?: string }) {
  const { viewBox, shape } = PIECES[kind]
  return (
    <svg aria-hidden viewBox={viewBox} data-piece={kind} className={className}>
      {shape}
    </svg>
  )
}
