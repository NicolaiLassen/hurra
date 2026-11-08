import { cn } from '@/lib/utils'

const COLORS = ['bg-primary', 'bg-confetti-pink', 'bg-confetti-teal', 'bg-confetti-violet']

/** Initials on a colour derived from the name, so a player keeps their colour. */
export default function Avatar({ name, className }: { name: string; className?: string }) {
  const hash = Array.from(name).reduce((h, ch) => (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0, 7)
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()

  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full font-black text-background',
        COLORS[hash % COLORS.length],
        className,
      )}
    >
      {initials}
    </span>
  )
}
