import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// A state chip carries a word ("Live", "Done", "Out"), never a colour alone
// (docs/identity.md): gold for what is on air or leading, the overlay surface
// or a rule outline for other states, plain words for quiet ones, and pink for
// the hunt.
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden rounded-chip border border-transparent font-bold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-danger aria-invalid:ring-danger/40 [&>svg]:pointer-events-none",
  {
    variants: {
      size: {
        default: "h-5 gap-1 px-2 py-0.5 text-xs [&>svg]:size-3!",
        // A chip next to a heading, e.g. "Mads wins" by a game's live title.
        lg: "h-7 gap-1.5 px-3 text-sm [&>svg]:size-3.5!",
      },
      variant: {
        // On air, live, leading: gold.
        default: "bg-gold text-ink [a]:hover:bg-gold/90",
        secondary: "bg-overlay text-paper [a]:hover:bg-rule",
        destructive:
          "bg-danger/10 text-danger focus-visible:ring-danger/40 [a]:hover:bg-danger/20",
        outline: "border-rule text-paper-2 [a]:hover:bg-overlay [a]:hover:text-paper",
        // A quiet state as a plain word ("Done", "Ready").
        ghost: "text-paper-2 [a]:hover:bg-overlay",
        link: "text-paper underline decoration-paper-3 underline-offset-4 hover:decoration-paper",
        // The hunt: "Out", "Running since 20:30".
        hunt: "text-pink [a]:hover:bg-overlay",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
