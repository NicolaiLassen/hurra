import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Each variant has one job (docs/identity.md): gold is only the one next step
// on a screen, the overlay surface carries secondary actions, a rule outline
// the quiet ones, danger the destructive ones. Radius by role: the host's
// control radius, the phone's on the big phone size.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding text-sm font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger/50 aria-invalid:ring-3 aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The one next step on a screen: gold, darker while pressed. Gold only
        // while the step can be taken: disabled (or busy), it is a plain overlay
        // bar, not gold at half strength, which on the ground is an olive brown.
        default: "bg-gold text-ink hover:bg-gold/90 active:bg-gold-rim disabled:bg-overlay disabled:text-paper-3 disabled:opacity-100",
        // Quiet: a rule outline, no fill.
        outline:
          "border-[1.5px] border-rule bg-transparent hover:bg-overlay hover:text-paper aria-expanded:bg-overlay aria-expanded:text-paper",
        // Secondary: the overlay surface.
        secondary:
          "bg-overlay text-paper hover:bg-rule aria-expanded:bg-rule",
        ghost:
          "hover:bg-overlay hover:text-paper aria-expanded:bg-overlay aria-expanded:text-paper",
        // Destructive host actions only.
        destructive:
          "bg-danger/10 text-danger hover:bg-danger/20 focus-visible:border-danger/40 focus-visible:ring-danger/40",
        link: "text-paper underline decoration-paper-3 underline-offset-4 hover:decoration-paper",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
        // Big touch target for phones: 54 px, the phone's radius and action size.
        xl: "h-13.5 gap-2 rounded-phone px-5 text-phone-action",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  isPending = false,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Its request is in flight: disabled (so a double tap can't send it twice) and marked busy. */
    isPending?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || isPending}
      aria-busy={isPending || undefined}
      {...props}
    />
  )
}

export { Button, buttonVariants }
