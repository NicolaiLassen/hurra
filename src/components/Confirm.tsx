import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

/**
 * An "are you sure?" dialog. Wraps a trigger (usually a Button) passed as
 * `children`, or, for an action in a menu, is opened by its parent with `open`
 * and `onOpenChange`.
 */
export default function Confirm({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'destructive',
  onConfirm,
  open,
  onOpenChange,
  children,
}: {
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** 'destructive' (red) for what can't be taken back; 'default' (gold) otherwise. */
  variant?: 'destructive' | 'default'
  onConfirm: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction variant={variant} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
