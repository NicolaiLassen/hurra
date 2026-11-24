// The band's way in while joining is open (`joinPlace` in scene.ts): the
// board draws its own join block and the lobby its big QR code. Codes are
// paper, never gold.

/** "Join with HURRA30", at the right of the band's bottom line, while a game holds the stage. */
export function JoinTag({ code }: { code: string }) {
  return (
    <p data-fit="join" className="flex h-15 shrink-0 items-center gap-4 text-tv-tab font-semibold whitespace-nowrap text-paper-2 short:h-13 short:gap-3 short:text-tv-floor">
      Join with
      <span className="font-mono text-tv-band font-extrabold tracking-[0.04em] text-paper short:text-tv-field">{code}</span>
    </p>
  )
}
