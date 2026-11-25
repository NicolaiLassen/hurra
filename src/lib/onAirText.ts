/**
 * A game's words as the app says them, on the TV and in a phone's toast:
 * without the exclamation marks a game may end its news with ("Bo is the
 * last one standing!", "You're out!"). The product keeps its one
 * exclamation mark for the winner's screen (docs/identity.md).
 */
export function onAirText(text: string): string {
  return text.replace(/\s*!+\s*$/, '').replace(/!+(\s)/g, '.$1')
}
