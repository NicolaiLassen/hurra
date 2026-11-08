import QrScannerLib from 'qr-scanner'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parsePlayerCode } from '@/lib/urls'
import { cn } from '@/lib/utils'

/** Camera scanner for player QR codes, with a typed-code fallback. Reports the first code it reads. */
export default function QrScanner({ onCode, className }: { onCode: (code: string) => void; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onCodeRef = useRef(onCode)
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string>()
  const [wrongCode, setWrongCode] = useState(false)
  const [manual, setManual] = useState('')

  useEffect(() => {
    onCodeRef.current = onCode
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let done = false
    const scanner = new QrScannerLib(
      video,
      (result) => {
        const code = parsePlayerCode(result.data)
        if (!code) return setWrongCode(true)
        if (done) return
        done = true
        onCodeRef.current(code)
      },
      { preferredCamera: 'environment', highlightCodeOutline: true, maxScansPerSecond: 5 },
    )
    scanner.start().then(
      () => setCameraOn(true),
      (e: unknown) => setCameraError(e instanceof Error ? e.message : String(e)),
    )
    return () => scanner.destroy()
  }, [])

  const manualCode = parsePlayerCode(manual)

  return (
    <div className={cn('grid gap-4', className)}>
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-black ring-1 ring-foreground/10">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        <ScanFrame />
        {/* Until the video runs (the browser may be asking for permission), the box isn't just black. */}
        {!cameraOn && !cameraError && (
          <p className="absolute inset-0 grid place-items-center text-sm text-white/70">Starting the camera…</p>
        )}
        {cameraError && (
          <p className="absolute inset-x-8 bottom-8 text-center text-sm text-white/70">
            Camera unavailable ({cameraError}). Type the code below instead.
          </p>
        )}
      </div>
      {wrongCode && <p className="text-center text-sm text-muted-foreground">That isn't a player QR code.</p>}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (manualCode) onCodeRef.current(manualCode)
        }}
      >
        <Input
          className="font-mono tracking-widest uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or type their code"
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Player code"
        />
        <Button type="submit" variant="secondary" size="lg" disabled={!manualCode}>
          Go
        </Button>
      </form>
    </div>
  )
}

/** Rounded corner brackets marking where to hold the code. */
function ScanFrame() {
  const corner = 'absolute size-14 border-primary'
  return (
    <div aria-hidden className="pointer-events-none absolute inset-[14%]">
      <span className={cn(corner, 'top-0 left-0 rounded-tl-3xl border-t-4 border-l-4')} />
      <span className={cn(corner, 'top-0 right-0 rounded-tr-3xl border-t-4 border-r-4')} />
      <span className={cn(corner, 'bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4')} />
      <span className={cn(corner, 'right-0 bottom-0 rounded-br-3xl border-r-4 border-b-4')} />
    </div>
  )
}
