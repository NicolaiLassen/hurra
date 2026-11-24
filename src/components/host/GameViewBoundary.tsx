import { ArrowClockwiseIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Keeps a game's own panel from taking the control room down with it: a view
 * that throws shows this note instead, and the card's Show on the TV and End
 * keep working.
 */
export default class GameViewBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`The host view of ${this.props.title} crashed`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid justify-items-start gap-3 rounded-lg bg-overlay p-4">
        <p className="flex items-start gap-2 text-sm">
          <WarningCircleIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-destructive" />
          <span>
            {this.props.title}'s controls stopped working on this page. The game itself is fine: Show on the TV and End still
            work, and so does a reload.
          </span>
        </p>
        <Button variant="secondary" onClick={() => this.setState({ error: null })}>
          <ArrowClockwiseIcon />
          Try again
        </Button>
      </div>
    )
  }
}
