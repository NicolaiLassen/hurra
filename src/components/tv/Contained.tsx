import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps a game's screen from taking the whole TV down: if it throws while
 * rendering (or its lazy chunk fails to load on bad Wi-Fi), the TV shows
 * `fallback` in its place and the party goes on. Give it a `key` that changes
 * with the game and scene, so the next scene tries the game's screen again.
 */
export default class Contained extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A game screen failed on the TV', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
