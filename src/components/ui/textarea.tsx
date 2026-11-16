import * as React from "react"
import { cn } from "@/lib/utils"

/** A longer field, styled as Input. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-control border border-rule bg-overlay px-2.5 py-2 text-base text-paper transition-colors outline-none placeholder:text-paper-3 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/50 aria-invalid:ring-3 aria-invalid:ring-danger/40 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
