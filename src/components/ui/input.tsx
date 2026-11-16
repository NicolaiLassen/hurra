import * as React from "react"
import { cn } from "@/lib/utils"

/** A field: a rule border on the overlay surface, the host's control radius (docs/identity.md). */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-control border border-rule bg-overlay px-3 py-1 text-base text-paper transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-paper placeholder:text-paper-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/50 aria-invalid:ring-3 aria-invalid:ring-danger/40 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
