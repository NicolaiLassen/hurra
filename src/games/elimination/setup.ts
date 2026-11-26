// Last one standing's readiness in the host's Games panel
// (GameModule.setupStatus), from its own check at start (parseConfig): at
// least one task, none too long, and points the start accepts. More guests
// than tasks is fine: tasks are dealt again, so the line only says so.
import type { GameGuest } from '@/games/core/Game'
import { counted, type SetupStatus } from '@/games/core/setup'
import { EliminationGame, type EliminationConfig } from '@/games/elimination/logic'

const game = new EliminationGame()

export function eliminationSetup(config: EliminationConfig, guests: readonly GameGuest[]): SetupStatus {
  const tasks = Array.isArray(config?.tasks) ? config.tasks.filter((task) => typeof task === 'string' && task.trim() !== '') : []
  if (tasks.length === 0) return { ready: false, line: 'No tasks yet' }
  try {
    game.parseConfig(config as unknown as Record<string, unknown>)
  } catch (error) {
    return { ready: false, line: (error as Error).message }
  }
  const all = counted(tasks.length, 'task')
  if (guests.length === 0) return { ready: true, line: `${all} to deal` }
  if (tasks.length >= guests.length) return { ready: true, line: `${all}, enough for ${guests.length === 1 ? 'the one guest' : `all ${guests.length} guests`}` }
  return { ready: true, line: `${all} for ${counted(guests.length, 'guest')}, so some get the same task` }
}
