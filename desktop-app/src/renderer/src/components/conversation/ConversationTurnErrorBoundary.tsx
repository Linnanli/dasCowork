import { Component, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type Props = {
  resetKey: string
  renderUnitKind: string
  children: ReactNode
}

type State = {
  failed: boolean
  generation: number
}

/** Isolates a broken render unit without replaying its authoritative Codex turn. */
export class ConversationTurnErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, generation: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(): void {
    // Do not include message body, tool input, paths, or provider data in renderer logs.
    console.warn('conversation render unit failed', {
      messageId: this.props.resetKey,
      renderUnitKind: this.props.renderUnitKind
    })
  }

  componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false, generation: 0 })
    }
  }

  private retry = (): void => {
    this.setState((state) => ({ failed: false, generation: state.generation + 1 }))
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div
          data-slot="conversation-render-error"
          role="alert"
          className="border-destructive/20 bg-destructive/5 text-destructive mt-2 flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span>这条回复暂时无法显示。</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-slot="conversation-render-retry"
            onClick={this.retry}
          >
            重试渲染
          </Button>
        </div>
      )
    }

    return <div key={this.state.generation}>{this.props.children}</div>
  }
}
