import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A field: the overlay surface edged in paper-3 at 60 percent, 3.2 to 1 on a
 * raised card, so it is found before it is focused (docs/identity.md). The
 * host's control radius.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-control border border-paper-3/60 bg-overlay px-3 py-1 text-base text-paper transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-paper placeholder:text-paper-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/50 aria-invalid:ring-3 aria-invalid:ring-danger/40 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
