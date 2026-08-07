import {
  BROWSER_WORKSPACE_API_VERSION,
  type BrowserWorkspaceBounds
} from '../../../../../shared/browserWorkspaceApi'

/**
 * Reattach an existing native browser view after its React content moves to a
 * different workspace panel. The next frame lets the destination panel finish
 * layout before its DOM bounds are measured.
 */
export async function repositionBrowserWorkspaceView(tabId: string, viewId: string): Promise<void> {
  await nextAnimationFrame()
  const surface = browserSurfaceForTab(tabId)
  const bounds = browserWorkspaceBounds(surface)
  if (!bounds) return

  try {
    await window.desktopApp.workspace.browser.setBounds({
      version: BROWSER_WORKSPACE_API_VERSION,
      viewId,
      bounds
    })
    await window.desktopApp.workspace.browser.show({
      version: BROWSER_WORKSPACE_API_VERSION,
      viewId
    })
  } catch {
    // A concurrent close or panel collapse may dispose the native view first.
  }
}

export function browserWorkspaceBounds(
  element: HTMLDivElement | null
): BrowserWorkspaceBounds | undefined {
  if (!element) return undefined
  const surfaceRect = element.getBoundingClientRect()
  const workspaceShell = element.closest<HTMLElement>(
    '[data-workspace-panel-shell="true"], [data-slot="right-workspace-shell"]'
  )
  const clipRect = workspaceShell?.getBoundingClientRect()
  const left = clipRect ? Math.max(surfaceRect.left, clipRect.left) : surfaceRect.left
  const top = clipRect ? Math.max(surfaceRect.top, clipRect.top) : surfaceRect.top
  const right = clipRect ? Math.min(surfaceRect.right, clipRect.right) : surfaceRect.right
  const bottom = clipRect ? Math.min(surfaceRect.bottom, clipRect.bottom) : surfaceRect.bottom
  const visibleWidth = Math.max(0, Math.round(right - left))
  const visibleHeight = Math.max(0, Math.round(bottom - top))

  return {
    x: Math.max(0, Math.round(left)),
    y: Math.max(0, Math.round(top)),
    width: Math.max(1, visibleWidth),
    height: visibleWidth > 0 ? visibleHeight : 0
  }
}

function browserSurfaceForTab(tabId: string): HTMLDivElement | null {
  const owner = [...document.querySelectorAll<HTMLElement>('[data-workspace-browser-tab-id]')].find(
    (element) => element.dataset.workspaceBrowserTabId === tabId
  )
  return owner?.querySelector<HTMLDivElement>('[data-workspace-browser-surface]') ?? null
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      queueMicrotask(resolve)
      return
    }
    requestAnimationFrame(() => resolve())
  })
}
