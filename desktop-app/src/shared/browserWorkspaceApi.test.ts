import { describe, expect, it } from 'vitest'

import {
  BROWSER_WORKSPACE_BLANK_URL,
  BROWSER_WORKSPACE_API_VERSION,
  browserWorkspaceCreateRequestSchema,
  browserWorkspaceEventSchema,
  browserWorkspaceNavigateRequestSchema,
  browserWorkspaceSetBoundsRequestSchema
} from './browserWorkspaceApi'

const bounds = { x: 0, y: 0, width: 640, height: 480 }

describe('browser workspace API schemas', () => {
  it('accepts bounded browser view requests', () => {
    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'https://example.com',
        bounds
      }).success
    ).toBe(true)

    expect(
      browserWorkspaceNavigateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        viewId: 'browser-1',
        url: 'https://example.com/docs'
      }).success
    ).toBe(true)

    expect(
      browserWorkspaceSetBoundsRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        viewId: 'browser-1',
        bounds: { x: 8, y: 8, width: 800, height: 0 }
      }).success
    ).toBe(true)

    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: BROWSER_WORKSPACE_BLANK_URL,
        bounds
      }).success
    ).toBe(true)
  })

  it('rejects non-HTTPS URLs, malformed bounds, and arbitrary view options', () => {
    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'http://example.com',
        bounds,
        webPreferences: { nodeIntegration: true }
      }).success
    ).toBe(false)

    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'file:///etc/passwd',
        bounds,
        webPreferences: { nodeIntegration: true }
      }).success
    ).toBe(false)

    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'javascript:alert(1)',
        bounds,
        webPreferences: { nodeIntegration: true }
      }).success
    ).toBe(false)

    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'data:text/html,hello',
        bounds,
        webPreferences: { nodeIntegration: true }
      }).success
    ).toBe(false)

    expect(
      browserWorkspaceCreateRequestSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        workspaceId: 'workspace-1',
        url: 'https://example.com',
        bounds: { x: 0, y: 0, width: 0, height: 480 },
        webPreferences: { nodeIntegration: true }
      }).success
    ).toBe(false)
  })

  it('keeps events strict', () => {
    expect(
      browserWorkspaceEventSchema.safeParse({
        version: BROWSER_WORKSPACE_API_VERSION,
        type: 'updated',
        view: {
          viewId: 'browser-1',
          workspaceId: 'workspace-1',
          url: 'https://example.com',
          state: 'ready',
          loading: false,
          bounds,
          canGoBack: false,
          canGoForward: false,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          sessionPartition: 'persist:secret'
        }
      }).success
    ).toBe(false)
  })
})
