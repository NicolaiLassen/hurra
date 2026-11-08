import EditableList from '@/components/EditableList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DEFAULT_TASKS, type EliminationGame } from '@/games/elimination/logic'
import type { ConfigEditorProps } from '@/games/types'

export default function ConfigEditor({ config, onChange }: ConfigEditorProps<EliminationGame>) {
  const count = config.tasks.filter((task) => task.trim()).length

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label asChild>
            <p>Tasks ({count})</p>
          </Label>
          <Button
            type="button"
            variant="link"
            className="px-0 text-muted-foreground"
            onClick={() => onChange({ ...config, tasks: DEFAULT_TASKS })}
          >
            Reset to the default tasks
          </Button>
        </div>
        <EditableList
          items={config.tasks}
          onChange={(tasks) => onChange({ ...config, tasks })}
          itemLabel="task"
          placeholder="Get someone to …"
        />
        <p className="text-xs text-muted-foreground">
          Every player is dealt one. Phrase them as “Get someone to …”; you can paste several lines at once.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-80">
        <div className="grid gap-2">
          <Label htmlFor="elimination-points-tag">Points per tag</Label>
          <Input
            id="elimination-points-tag"
            type="number"
            min={0}
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
            step={1}
            value={config.pointsPerCatch}
            onChange={(e) => onChange({ ...config, pointsPerCatch: wholePoints(e.target.value) })}
          />
        </div>
      </div>
    </div>
  )
}

const wholePoints = (value: string) => Math.max(0, Math.round(Number(value) || 0))
