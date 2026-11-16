import * as React from "react"
import { cn } from "cn"
import { Slider as SliderPrimitive } from "radix-ui"

/**
 * shadcn/ui's slider with one thumb. `thumbProps` reach the thumb, the element
 * a screen reader announces, so its name and value text go there.
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
        className="relative h-2 w-full grow overflow-hidden rounded-full bg-muted"
      >
        <SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        {...thumbProps}
        className={cn(
          "block size-5 shrink-0 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] outline-none hover:ring-4 focus-visible:ring-4 active:cursor-grabbing disabled:pointer-events-none",
          thumbProps?.className
        )}
      />
    </SliderPrimitive.Root>
  )
}

export { Slider }
