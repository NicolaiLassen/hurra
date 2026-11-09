import { useEffect, useState } from 'react'
import { playSoftSound } from '@/lib/sound'
import type { ScoreRow } from '@/lib/types'

/** Point changes since the previous standings, by player, each with a counter that re-keys its bubble. */
export type Gains = Record<string, { amount: number; seq: number }>

/** How long a "+3" bubble stays up. */
const GAIN_MS = 2500

/** Point changes since the previous update, shown as "+3" bubbles for a moment, with the soft coin sound. */
export function useGains(rows: ScoreRow[] | undefined): Gains {
  const [prevRows, setPrevRows] = useState(rows)
  const [gains, setGains] = useState<Gains>({})

  // Compare with the previous render's rows (React's "adjust state on prop change" pattern).
  if (rows !== prevRows) {
    setPrevRows(rows)
    if (prevRows && rows) {
      const before = new Map(prevRows.map((r) => [r.player_id, r.points]))
      const changed: Gains = {}
      for (const row of rows) {
        const diff = row.points - (before.get(row.player_id) ?? row.points)
        if (diff) changed[row.player_id] = { amount: diff, seq: (gains[row.player_id]?.seq ?? 0) + 1 }
      }
      if (Object.keys(changed).length) setGains({ ...gains, ...changed })
    }
  }

  useEffect(() => {
    if (!Object.keys(gains).length) return
    playSoftSound('coin')
    const timer = setTimeout(() => setGains({}), GAIN_MS)
    return () => clearTimeout(timer)
  }, [gains])

  return gains
}
