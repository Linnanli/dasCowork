export type ScrollToRenderTargetOptions = {
  behavior?: ScrollBehavior
  focus?: boolean
  retryMs?: number
  root?: ParentNode
}

const DEFAULT_RETRY_MS = 1000
const RETRY_INTERVAL_MS = 50

export async function scrollToRenderTarget(
  targetId: string,
  options: ScrollToRenderTargetOptions = {}
): Promise<boolean> {
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS
  const deadline = Date.now() + retryMs
  const root = options.root ?? document

  while (true) {
    const target = findRenderTarget(root, targetId)
    if (target) {
      expandClosedParents(target)
      focusTarget(target, options.focus ?? true)
      target.scrollIntoView({ block: 'center', behavior: options.behavior ?? 'smooth' })
      return true
    }

    if (Date.now() >= deadline) return false
    await delay(RETRY_INTERVAL_MS)
  }
}

export function findRenderTarget(root: ParentNode, targetId: string): HTMLElement | undefined {
  const candidates = root.querySelectorAll<HTMLElement>(
    '[data-render-target-id], [data-render-target-ids]'
  )

  return [...candidates].find((candidate) => {
    if (candidate.dataset.renderTargetId === targetId) return true
    return candidate.dataset.renderTargetIds?.split(/\s+/).includes(targetId)
  })
}

function expandClosedParents(target: HTMLElement): void {
  const roots = [...target.querySelectorAll<HTMLElement>(collapsibleRootSelector())]

  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    if (isCollapsibleRoot(element)) roots.unshift(element)
  }

  for (const root of roots) {
    if (root.dataset.state !== 'closed') continue
    const trigger = root.querySelector<HTMLElement>(
      '[data-slot="tool-group-trigger"], [data-slot="tool-fallback-trigger"]'
    )
    trigger?.click()
  }
}

function collapsibleRootSelector(): string {
  return [
    '[data-slot="tool-group-root"]',
    '[data-slot="tool-fallback-root"]',
    '.aui-tool-group-root',
    '.aui-tool-fallback-root'
  ].join(', ')
}

function isCollapsibleRoot(element: HTMLElement): boolean {
  return (
    element.dataset.slot === 'tool-group-root' ||
    element.dataset.slot === 'tool-fallback-root' ||
    element.classList.contains('aui-tool-group-root') ||
    element.classList.contains('aui-tool-fallback-root')
  )
}

function focusTarget(target: HTMLElement, enabled: boolean): void {
  if (!enabled) return
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
