// The time of day as the TV and the recap print it. Only times the database
// holds are printed (a game's start or finish, an announcement's), never a
// planned time and never "4 min ago" (docs/identity.md, The TV's frame).

/** "21:40": a time of the night by this screen's clock, as Danish screens show it. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
