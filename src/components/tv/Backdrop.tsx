/** The ground behind every TV scene: the plain studio black, nothing moving (docs/identity.md). */
export default function Backdrop() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-ground" />
}
