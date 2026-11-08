import { XIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import PlayerQr from '@/components/PlayerQr'
import QrScanner from '@/components/QrScanner'
import { Button } from '@/components/ui/button'
import type { Player } from '@/lib/types'
import { cn } from '@/lib/utils'

type Tab = 'scan' | 'mine'

/**
 * Full-screen sheet for player-to-player moments: one person scans while the
 * other shows their code, so both live behind one switch.
 */
export default function ScanSheet({
  player,
  hint,
  onCode,
  onClose,
}: {
  player: Player
  hint: string
  onCode: (code: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('scan')

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <header className="mx-auto flex max-w-md items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),1rem)]">
        <Button variant="ghost" size="icon-lg" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
        <div className="mx-auto flex rounded-full bg-muted p-1" role="tablist">
          {(
            [
              ['scan', 'Scan'],
              ['mine', 'My code'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                'h-10 rounded-full px-5 text-sm font-semibold transition-colors',
                tab === value ? 'bg-foreground text-background' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Balances the close button, so the tabs sit in the middle. */}
        <span className="size-10 shrink-0" />
      </header>

      <div className="mx-auto max-w-md px-4 py-6">
        {tab === 'scan' ? (
          <>
            <p className="mb-4 text-center text-muted-foreground">{hint}</p>
            <QrScanner onCode={onCode} />
          </>
        ) : (
          <>
            <p className="mb-4 text-center text-muted-foreground">Let them scan this</p>
            <PlayerQr player={player} />
          </>
        )}
      </div>
    </div>
  )
}
