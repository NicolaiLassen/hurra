import { CheckCircleIcon, InfoIcon, WarningIcon, XCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { toast as sonner } from 'sonner'
import Callout from '@/components/Callout'
import type { Tone } from '@/games/core/Game'

type ToastOptions = {
  /** A second line under the title. */
  description?: ReactNode
  icon?: ReactNode
  tone?: Tone
  eyebrow?: ReactNode
  action?: { label: string; onClick: () => void }
  duration?: number
}

/**
 * The app's toasts, used like sonner's `toast` (import this one instead). Every
 * toast is the shared Callout at toast size, so phones and the TV share one look.
 */
function show(title: ReactNode, { description, icon, tone = 'gold', eyebrow, action, duration }: ToastOptions = {}) {
  return sonner.custom(
    (id) => (
      <Callout
        size="toast"
        tone={tone}
        icon={icon}
        eyebrow={eyebrow}
        title={title}
        detail={description}
        action={
          action && (
            <button
              type="button"
              className="h-8 shrink-0 cursor-pointer rounded-lg bg-foreground px-3 text-xs font-bold text-background hover:bg-foreground/90"
              onClick={() => {
                action.onClick()
                sonner.dismiss(id)
              }}
            >
              {action.label}
            </button>
          )
        }
      />
    ),
    { duration },
  )
}

export const toast = Object.assign(show, {
  success: (title: ReactNode, options?: ToastOptions) =>
    show(title, { tone: 'teal', icon: <CheckCircleIcon weight="fill" />, ...options }),
  error: (title: ReactNode, options?: ToastOptions) =>
    show(title, { tone: 'red', icon: <XCircleIcon weight="fill" />, ...options }),
  info: (title: ReactNode, options?: ToastOptions) =>
    show(title, { tone: 'violet', icon: <InfoIcon weight="fill" />, ...options }),
  warning: (title: ReactNode, options?: ToastOptions) =>
    show(title, { tone: 'gold', icon: <WarningIcon weight="fill" />, ...options }),
})
