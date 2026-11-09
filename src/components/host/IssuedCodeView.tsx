import { ArrowClockwiseIcon, ClockIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { formatCountdown } from '@/components/host/scene'
import type { IssuedCodeState } from '@/components/host/useIssuedCode'
import { useNow } from '@/components/host/useNow'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A one-time code in large type, one box per character so it reads out loud
 * and types without mistakes, with the time it has left and a way to get a
 * new one. Codes are 6 characters from an alphabet without 0, O, 1 and I.
 */
export default function IssuedCodeView({ code, className }: { code: IssuedCodeState; className?: string }) {
  const now = useNow(1000, code.issued !== null)
  const left = code.issued ? code.issued.expiresAt - now : 0
  const expired = code.issued !== null && left <= 0

  return (
    <div className={cn('grid justify-items-center gap-3', className)}>
      {code.issued ? (
        <p
          className={cn('flex gap-1.5 sm:gap-2', expired && 'opacity-30')}
          aria-label={`Code: ${[...code.issued.code].join(' ')}`}
        >
          {[...code.issued.code].map((char, i) => (
            <span
              key={i}
              aria-hidden
              className="grid h-14 w-11 place-items-center rounded-xl bg-muted font-mono text-3xl font-black text-primary ring-1 ring-foreground/10 sm:h-16 sm:w-12 sm:text-4xl"
            >
              {char}
            </span>
          ))}
        </p>
      ) : (
        // Holds the code's place while it is issued, so the dialog doesn't jump.
        <p className="flex gap-1.5 sm:gap-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-14 w-11 animate-pulse rounded-xl bg-muted sm:h-16 sm:w-12" />
          ))}
        </p>
      )}

      {code.error ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <WarningCircleIcon weight="fill" className="shrink-0" />
          {code.error}
        </p>
      ) : expired ? (
        <p className="text-sm text-muted-foreground">This code has expired.</p>
      ) : code.issued ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
          <ClockIcon className="shrink-0" />
          Works for {formatCountdown(left)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Getting a code…</p>
      )}

      {(expired || code.error || code.issued) && (
        <Button variant={expired || code.error ? 'default' : 'ghost'} size="lg" isPending={code.pending} onClick={code.renew}>
          <ArrowClockwiseIcon />
          {code.error ? 'Try again' : 'Get a new code'}
        </Button>
      )}
    </div>
  )
}
