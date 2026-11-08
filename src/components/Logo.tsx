import { cn } from '@/lib/utils'

/** The app icon (public/favicon.svg) as an in-page logo. */
export default function Logo({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={cn('size-14 rounded-[22%] ring-1 ring-white/10', className)} />
}
