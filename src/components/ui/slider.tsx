import * as React from "react"
import { cn } from "@/lib/utils"
import { Slider as SliderPrimitive } from "radix-ui"

/**
 * shadcn/ui's slider with one thumb: a paper range and thumb on a rule track
 * (docs/identity.md). `thumbProps` reach the thumb, the element a screen reader
 * announces, so its name and value text go there.
 */
function Slider({
  className,
  thumbProps,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  thumbProps?: React.ComponentProps<typeof SliderPrimitive.Thumb>
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-rule"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-paper" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        {...thumbProps}
        className={cn(
          "block size-5.5 shrink-0 cursor-grab rounded-full bg-paper shadow-sm shadow-black/50 ring-paper/25 transition-[box-shadow] outline-none hover:ring-4 focus-visible:ring-4 focus-visible:ring-ring/50 active:cursor-grabbing disabled:pointer-events-none",
          thumbProps?.className
        )}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
