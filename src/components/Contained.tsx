import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps a game's screen from taking the whole page down, on the TV and on the
 * phones: if it throws while rendering (or its lazy chunk fails to load on bad
 * Wi-Fi), `fallback` shows in its place and the party goes on. Give it a `key`
 * that changes with the game's round (and on the TV its scene), so the next
 * one tries the game's screen again.
 */
export default class Contained extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A game screen failed', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
