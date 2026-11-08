import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Where toasts appear. They draw themselves: every toast is the shared Callout
 * (src/components/Callout.tsx), shown through `toast` from src/lib/toast.tsx,
 * so call that rather than sonner's own `toast`. Each toast fills the toaster's
 * column (sonner leaves an unstyled one as wide as its text, off centre).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return <Sonner theme="dark" className="toaster group" toastOptions={{ unstyled: true, className: 'w-full' }} {...props} />
}

export { Toaster }
