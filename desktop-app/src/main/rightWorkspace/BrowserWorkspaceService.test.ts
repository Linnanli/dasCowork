import { describe, expect, it, vi } from 'vitest'

import {
  BROWSER_WORKSPACE_API_VERSION,
  type BrowserWorkspaceBounds
} from '../../shared/browserWorkspaceApi'
import {
  BrowserWorkspaceService,
  type BrowserWorkspaceHostAdapter,
  type BrowserWorkspaceViewAdapter
} from './BrowserWorkspaceService'

class FakeBrowserView implements BrowserWorkspaceViewAdapter {
  readonly loadURL = vi.fn()
  readonly setBounds = vi.fn()
  readonly goBack = vi.fn()
  readonly goForward = vi.fn()
  readonly reload = vi.fn()
  readonly stop = vi.fn()
  readonly destroy = vi.fn()
  private finishLoad: (() => void) | null = null
  private failLoad: ((error?: string) => void) | null = null
  private faviconUpdated: ((faviconUrls: string[]) => void) | null = null

  onDidFinishLoad(listener: () => void): void {
    this.finishLoad = listener
  }

  emitFinishLoad(): void {
    this.finishLoad?.()
  }

  onDidFailLoad(listener: (error?: string) => void): void {
    this.failLoad = listener
  }

  emitFailLoad(error: string): void {
    this.failLoad?.(error)
  }

  onFaviconUpdated(listener: (faviconUrls: string[]) => void): void {
    this.faviconUpdated = listener
  }

  emitFavicon(urls: string[]): void {
    this.faviconUpdated?.(urls)
  }

  canGoBack(): boolean {
    return true
  }

  canGoForward(): boolean {
    return false
  }

  getTitle(): string {
    return 'Example'
  }
}

function createHost(view: FakeBrowserView): BrowserWorkspaceHostAdapter {
  return {
    createView: vi.fn(() => view),
    attachView: vi.fn(),
    detachView: vi.fn(),
    openExternal: vi.fn()
  }
}

const bounds: BrowserWorkspaceBounds = { x: 0, y: 0, width: 640, height: 480 }

describe('BrowserWorkspaceService', () => {
  it('tracks view bounds and loading state through an injected host adapter', () => {
    const view = new FakeBrowserView()
    const host = createHost(view)
    const events: unknown[] = []
    const service = new BrowserWorkspaceService({
      host,
      createId: () => 'browser-1',
      now: () => new Date('2026-08-01T00:00:00.000Z')
    })
    service.onEvent((event) => events.push(event))

    expect(
      service.create({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'https://example.com',
        bounds
      })
    ).toMatchObject({ viewId: 'browser-1', state: 'loading', bounds })
    expect(host.attachView).toHaveBeenCalledWith(view)
    expect(view.loadURL).toHaveBeenCalledWith('https://example.com')

    view.emitFinishLoad()
    expect(service.list({ version: BROWSER_WORKSPACE_API_VERSION })).toMatchObject({
      views: [
        {
          viewId: 'browser-1',
          title: 'Example',
          state: 'ready',
          loading: false,
          canGoBack: true,
          canGoForward: false
        }
      ]
    })

    service.setBounds({
      version: BROWSER_WORKSPACE_API_VERSION,
      viewId: 'browser-1',
      bounds: { x: 10, y: 20, width: 800, height: 600 }
    })
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 800, height: 600 })
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'created',
      'updated',
      'updated'
    ])
  })

  it('blocks unsafe navigation, externalizes window opens, and denies permissions', () => {
    const view = new FakeBrowserView()
    const host = createHost(view)
    const service = new BrowserWorkspaceService({
      host,
      createId: () => 'browser-1',
      now: () => new Date('2026-08-01T00:00:00.000Z'),
      allowedProtocols: ['https:']
    })

    expect(() =>
      service.create({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'http://example.com',
        bounds
      })
    ).toThrow('browser workspace URL must use HTTPS')

    expect(service.handleWindowOpen('https://example.com/popup')).toEqual({ action: 'deny' })
    expect(host.openExternal).toHaveBeenCalledWith('https://example.com/popup')
    expect(service.handleWindowOpen('http://example.com/popup')).toEqual({ action: 'deny' })
    expect(service.handleWindowOpen('file:///etc/passwd')).toEqual({ action: 'deny' })
    expect(service.handlePermissionRequest()).toBe(false)
  })

  it('supports hiding with zero-height bounds and restoring bounds on show', () => {
    const view = new FakeBrowserView()
    const service = new BrowserWorkspaceService({
      host: createHost(view),
      createId: () => 'browser-1',
      now: () => new Date('2026-08-01T00:00:00.000Z')
    })
    service.create({
      version: BROWSER_WORKSPACE_API_VERSION,
      workspaceId: 'workspace-1',
      url: 'https://example.com',
      bounds
    })

    expect(
      service.hide({
        version: BROWSER_WORKSPACE_API_VERSION,
        viewId: 'browser-1'
      })
    ).toMatchObject({ bounds, visible: false })
    expect(view.setBounds).toHaveBeenLastCalledWith({ ...bounds, height: 0 })

    expect(
      service.show(
        {
          version: BROWSER_WORKSPACE_API_VERSION,
          viewId: 'browser-1'
        },
        { x: 0, y: 0, width: 640, height: 480 }
      )
    ).toMatchObject({ bounds, visible: true })
  })

  it('surfaces loading failures and favicon updates without exposing unsafe favicon URLs', () => {
    const view = new FakeBrowserView()
    const service = new BrowserWorkspaceService({
      host: createHost(view),
      createId: () => 'browser-1',
      now: () => new Date('2026-08-01T00:00:00.000Z')
    })
    const created = service.create({
      version: BROWSER_WORKSPACE_API_VERSION,
      workspaceId: 'workspace-1',
      url: 'https://example.com',
      bounds
    })

    view.emitFavicon(['http://insecure.test/favicon.ico', 'https://example.com/favicon.ico'])
    view.emitFailLoad('Connection refused')

    expect(service.list({ version: BROWSER_WORKSPACE_API_VERSION })).toMatchObject({
      views: [
        {
          viewId: created.viewId,
          state: 'failed',
          error: 'Connection refused',
          faviconUrl: 'https://example.com/favicon.ico'
        }
      ]
    })

    service.stop({ version: BROWSER_WORKSPACE_API_VERSION, viewId: created.viewId })
    expect(view.stop).toHaveBeenCalledOnce()
    expect(service.list({ version: BROWSER_WORKSPACE_API_VERSION }).views[0]).toMatchObject({
      state: 'ready',
      error: undefined
    })
  })

  it('detaches and destroys views without removing their final state', () => {
    const view = new FakeBrowserView()
    const host = createHost(view)
    const service = new BrowserWorkspaceService({
      host,
      createId: () => 'browser-1',
      now: () => new Date('2026-08-01T00:00:00.000Z')
    })
    service.create({
      version: BROWSER_WORKSPACE_API_VERSION,
      workspaceId: 'workspace-1',
      url: 'https://example.com',
      bounds
    })

    expect(
      service.destroy({
        version: BROWSER_WORKSPACE_API_VERSION,
        viewId: 'browser-1'
      })
    ).toMatchObject({ state: 'destroyed' })
    expect(host.detachView).toHaveBeenCalledWith(view)
    expect(view.destroy).toHaveBeenCalled()
    expect(() =>
      service.navigate({
        version: BROWSER_WORKSPACE_API_VERSION,
        viewId: 'browser-1',
        url: 'https://example.com/next'
      })
    ).toThrow('Browser view has been destroyed')
  })
})
