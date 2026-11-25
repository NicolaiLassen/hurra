import { describe, expect, it } from 'vitest'
import { onAirText } from './onAirText'

describe('onAirText', () => {
  it("drops a game's exclamation marks, since the product keeps its one for the winner's screen", () => {
    expect(onAirText('Bo is the last one standing!')).toBe('Bo is the last one standing')
    expect(onAirText('Picture 3 was Ana and Bo!! ')).toBe('Picture 3 was Ana and Bo')
    expect(onAirText("That's you! No points on your own picture.")).toBe("That's you. No points on your own picture.")
    expect(onAirText("You're out!")).toBe("You're out")
  })

  it('leaves calm news as it is', () => {
    expect(onAirText('Clara got Frida')).toBe('Clara got Frida')
    expect(onAirText('Voting is closed. 6 pictures')).toBe('Voting is closed. 6 pictures')
  })
})
