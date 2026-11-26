// Last one standing's readiness in the host's Games panel
// (GameModule.setupStatus), from its own check at start (parseConfig): at
// least one task, none too long, and points the start accepts. More guests
// than tasks is fine: tasks are dealt again, so the line only says so. A
// list shorter than the default one (saved before the default list grew to
// 60) says the default list's size too, so the host finds the reset.
import type { GameGuest } from '@/games/core/Game'
import { counted, type SetupStatus } from '@/games/core/setup'
import { DEFAULT_TASKS, EliminationGame, type EliminationConfig } from '@/games/elimination/logic'

const game = new EliminationGame()

/** How many tasks have words: the ones the game deals. */
export const taskCount = (tasks: unknown): number =>
  Array.isArray(tasks) ? tasks.filter((task) => typeof task === 'string' && task.trim() !== '').length : 0

/** Fewer tasks than the default list: an older saved list, or a short one of the host's own. */
export const shorterThanDefaults = (tasks: unknown): boolean => {
  const count = taskCount(tasks)
  return count > 0 && count < DEFAULT_TASKS.length
}

export function eliminationSetup(config: EliminationConfig, guests: readonly GameGuest[]): SetupStatus {
  const tasks = Array.isArray(config?.tasks) ? config.tasks.filter((task) => typeof task === 'string' && task.trim() !== '') : []
  if (tasks.length === 0) return { ready: false, line: 'No tasks yet' }
  try {
    game.parseConfig(config as unknown as Record<string, unknown>)
  } catch (error) {
    return { ready: false, line: (error as Error).message }
  }
  const all = counted(tasks.length, 'task')
  const line =
    guests.length === 0
      ? `${all} to deal`
      : tasks.length >= guests.length
        ? `${all}, enough for ${guests.length === 1 ? 'the one guest' : `all ${guests.length} guests`}`
        : `${all} for ${counted(guests.length, 'guest')}, so some get the same task`
  return { ready: true, line: shorterThanDefaults(tasks) ? `${line}; the default list has ${DEFAULT_TASKS.length}` : line }
}
