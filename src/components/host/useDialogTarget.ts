import { useCallback, useState } from 'react'

export type DialogTarget<T> = {
  /** What the dialog is about. Kept after it closes, so its text doesn't change while it fades out. */
  target: T | null
  open: boolean
  show: (target: T) => void
  onOpenChange: (open: boolean) => void
}

/** A dialog opened from a list's row menu (rename, restart, remove, move): which row it is for, and whether it is open. */
export function useDialogTarget<T>(): DialogTarget<T> {
  const [state, setState] = useState<{ target: T | null; open: boolean }>({ target: null, open: false })
  const show = useCallback((target: T) => setState({ target, open: true }), [])
  const onOpenChange = useCallback((open: boolean) => setState((s) => ({ ...s, open })), [])
  return { ...state, show, onOpenChange }
}
