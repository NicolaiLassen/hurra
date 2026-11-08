// Helpers for unit-testing game plugins.
import type { GameInfo, GamePlayer, PlayerId } from './Game'

/** Game info with players named after their ids, an empty scoreboard and a fixed clock. */
export function testInfo<Config>(
  config: Config,
  playerIds: PlayerId[],
  overrides: Partial<GameInfo<Config>> = {},
): GameInfo<Config> {
  const players: GamePlayer[] = playerIds.map((id) => ({ id, name: id, profile: {} }))
  return {
    gameId: 'game-1',
    session: { id: 'session-1', name: 'Test party', data: {} },
    players,
    scoreboard: {},
    config,
    now: 1_000,
    ...overrides,
  }
}

/** A deterministic stand-in for Math.random. */
export function seededRandom(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}
