import { ArrowCounterClockwiseIcon, InfoIcon } from '@phosphor-icons/react'
import EditableList from '@/components/EditableList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_DEAL_IN_MINUTES,
  DEFAULT_TASKS,
  MAX_DEAL_IN_MINUTES,
  MAX_POINTS,
  MAX_TASK_LENGTH,
  MAX_TASKS,
  type EliminationGame,
} from '@/games/elimination/logic'
import { shorterThanDefaults } from '@/games/elimination/setup'
import type { ConfigEditorProps } from '@/games/types'

/**
 * Last one standing's settings: the tasks, how long latecomers are dealt in,
 * and the points. A saved list shorter than the default one (the 30 saved
 * before the default list grew to 60, or a short list of the host's own)
 * gets a note on top with Reset to the 60 default tasks, so the reset isn't
 * only the small link beside the count.
 */
export default function ConfigEditor({ config, onChange }: ConfigEditorProps<EliminationGame>) {
  const count = config.tasks.filter((task) => task.trim()).length
  const shorter = shorterThanDefaults(config.tasks)
  const reset = () => onChange({ ...config, tasks: DEFAULT_TASKS })
  // The same limits the game checks when the host starts it, shown while editing.
  const tooLong = config.tasks.flatMap((task, i) => (Array.from(task.trim()).length > MAX_TASK_LENGTH ? [i + 1] : []))
  const problems = [
    count > MAX_TASKS && `Use at most ${MAX_TASKS} tasks: remove ${count - MAX_TASKS}.`,
    tooLong.length > 0 &&
      `Keep each task to ${MAX_TASK_LENGTH} characters: task ${tooLong.join(', ')} ${tooLong.length === 1 ? 'is' : 'are'} longer.`,
  ].filter((problem): problem is string => Boolean(problem))

  return (
    <div className="grid gap-5">
      {shorter && (
        <div role="note" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-raised p-4 text-sm">
          <InfoIcon weight="fill" aria-hidden className="size-5 shrink-0 self-start text-paper-2" />
          <p className="min-w-0 flex-1 basis-56 text-paper-2">
            <span className="font-semibold text-paper">
              {count === 1 ? 'This game has 1 saved task.' : `This game has ${count} saved tasks.`}
            </span>{' '}
            The default list has {DEFAULT_TASKS.length} party moments, so every guest gets a task of their own, latecomers too.
          </p>
          <Button type="button" variant="secondary" onClick={reset}>
            <ArrowCounterClockwiseIcon />
            Reset to the {DEFAULT_TASKS.length} default tasks
          </Button>
        </div>
      )}
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label asChild>
            <p>Tasks ({count})</p>
          </Label>
          {/* With the note on top, its button is the reset: one is enough. */}
          {!shorter && (
            <Button type="button" variant="link" className="px-0 text-muted-foreground" onClick={reset}>
              Reset to the default tasks
            </Button>
          )}
        </div>
        <EditableList
          items={config.tasks}
          onChange={(tasks) => onChange({ ...config, tasks })}
          itemLabel="task"
          placeholder="Get someone to …"
        />
        <p className="text-xs text-muted-foreground">
          Every guest is dealt one, latecomers too, and a task repeats only once all {count} have been dealt, so keep more
          tasks than guests. Phrase them as “Get someone to …”; you can paste several lines at once. Up to {MAX_TASKS} tasks of up to{' '}
          {MAX_TASK_LENGTH} characters.
        </p>
        {problems.map((problem) => (
          <p key={problem} role="alert" className="text-xs font-medium text-destructive">
            {problem}
          </p>
        ))}
      </div>
      <div className="grid gap-2 sm:max-w-80">
        <Label htmlFor="elimination-deal-in">Deal in latecomers for (minutes)</Label>
        <Input
          id="elimination-deal-in"
          type="number"
          min={0}
          max={MAX_DEAL_IN_MINUTES}
          step={5}
          value={config.dealInMinutes ?? DEFAULT_DEAL_IN_MINUTES}
          onChange={(e) => onChange({ ...config, dealInMinutes: wholeMinutes(e.target.value) })}
        />
        <p className="text-xs text-muted-foreground">
          A guest who joins after the start gets a task until then. 0 keeps it open until you close it on the night.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-80">
        <div className="grid gap-2">
          <Label htmlFor="elimination-points-tag">Points per tag</Label>
          <Input
            id="elimination-points-tag"
            type="number"
            min={0}
            max={MAX_POINTS}
            step={1}
            value={config.pointsPerTag}
            onChange={(e) => onChange({ ...config, pointsPerTag: wholePoints(e.target.value) })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="elimination-points-catch">Points per catch</Label>
          <Input
            id="elimination-points-catch"
            type="number"
            min={0}
            max={MAX_POINTS}
            step={1}
            value={config.pointsPerCatch}
            onChange={(e) => onChange({ ...config, pointsPerCatch: wholePoints(e.target.value) })}
          />
        </div>
      </div>
    </div>
  )
}

/** A whole number from 0 to MAX_POINTS, whatever was typed. */
const wholePoints = (value: string) => Math.min(MAX_POINTS, Math.max(0, Math.round(Number(value) || 0)))
/** Whole minutes from 0 to MAX_DEAL_IN_MINUTES, whatever was typed. */
const wholeMinutes = (value: string) => Math.min(MAX_DEAL_IN_MINUTES, Math.max(0, Math.round(Number(value) || 0)))
