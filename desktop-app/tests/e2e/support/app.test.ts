// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVitestPlanAssertionRecorder } from '../../../scripts/lib/test-plan-assertions.mjs'

import { collectAppReadinessSnapshot, redactDiagnosticData, serializeDiagnosticData } from './app'

const { planAssert } = createVitestPlanAssertionRecorder(expect)

function mountComposer(options: { editable?: boolean; send?: boolean; stop?: boolean } = {}): void {
  const { editable = true, send = true, stop = false } = options
  document.body.innerHTML = `
    <div class="aui-composer-root">
      <div class="aui-lexical-input" contenteditable="${editable ? 'true' : 'false'}"></div>
    </div>
    ${send ? '<button aria-label="发送消息"></button>' : ''}
    ${stop ? '<button aria-label="停止生成"></button>' : ''}
  `
}

function installCodex(codex: Record<string, unknown>): void {
  Object.defineProperty(window, 'desktopApp', {
    configurable: true,
    value: { codex }
  })
}

const readyCatalog = {
  models: [{ id: 'model-1' }],
  selectedModelId: 'model-1'
}

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'desktopApp')
  vi.restoreAllMocks()
})

describe('collectAppReadinessSnapshot', () => {
  it('reports the individual bridge, model, and composer readiness fields', async () => {
    mountComposer()
    installCodex({
      listModels: vi.fn().mockResolvedValue(readyCatalog)
    })

    await expect(collectAppReadinessSnapshot()).resolves.toEqual({
      bridgeReady: true,
      modelCatalogReady: true,
      composerMounted: true,
      composerEditable: true,
      sendButtonPresent: true,
      stopButtonPresent: false,
      probeError: null
    })
  })

  it('keeps composer state when the desktop Codex API is unavailable', async () => {
    mountComposer({ editable: false, send: false, stop: true })

    await expect(collectAppReadinessSnapshot()).resolves.toEqual({
      bridgeReady: false,
      modelCatalogReady: false,
      composerMounted: true,
      composerEditable: false,
      sendButtonPresent: false,
      stopButtonPresent: true,
      probeError: 'Desktop Codex API is unavailable'
    })
  })

  it('preserves the model-catalog rejection reason', async () => {
    mountComposer()
    installCodex({ listModels: vi.fn().mockRejectedValue(new Error('model catalog rejected')) })

    await expect(collectAppReadinessSnapshot()).resolves.toMatchObject({
      bridgeReady: false,
      modelCatalogReady: false,
      composerMounted: true,
      composerEditable: true,
      sendButtonPresent: true,
      stopButtonPresent: false,
      probeError: 'model catalog rejected'
    })
  })

  it('reports an RPC timeout without leaving the readiness promise pending', async () => {
    mountComposer()
    installCodex({
      listModels: vi.fn(() => new Promise(() => undefined))
    })

    await expect(collectAppReadinessSnapshot(10)).resolves.toMatchObject({
      bridgeReady: false,
      modelCatalogReady: false,
      probeError: 'E2E readiness probe timed out'
    })
  })
})

describe('redactDiagnosticData', () => {
  it('G12 removes credential variants while preserving correlation identifiers', async () => {
    const redacted = redactDiagnosticData({
      conversationId: 'conversation-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      clientUserMessageId: 'message-1',
      pendingApprovalRequestIds: ['approval-request-1'],
      headers: {
        authorization: 'Bearer sk-secret-token',
        'x-api-key': 'dashscope-secret',
        apiKey: 'camel-case-secret',
        refresh_token: 'refresh-secret',
        providerHeaders: { 'x-provider-secret': 'provider-secret' },
        accept: 'application/json'
      },
      body: JSON.stringify({
        experimental_bearer_token: 'sk-body-secret',
        password: 'body-password',
        clientUserMessageId: 'message-1'
      }),
      logs: [
        'Authorization: Bearer live-token-value',
        'api_key=another-secret-value',
        'client_secret=url-secret&threadId=thread-1'
      ]
    })
    const serialized = JSON.stringify(redacted)

    await planAssert({
      scenarioId: 'G12',
      assertionId: '诊断可关联而不泄露密钥',
      assertion: () => {
        for (const secret of [
          'sk-secret-token',
          'dashscope-secret',
          'camel-case-secret',
          'refresh-secret',
          'provider-secret',
          'sk-body-secret',
          'body-password',
          'live-token-value',
          'another-secret-value',
          'url-secret'
        ]) {
          expect(serialized).not.toContain(secret)
        }
        expect(serialized).toContain('conversation-1')
        expect(serialized).toContain('thread-1')
        expect(serialized).toContain('turn-1')
        expect(serialized).toContain('message-1')
        expect(serialized).toContain('approval-request-1')
        expect(redacted).toMatchObject({
          headers: {
            authorization: '[redacted]',
            'x-api-key': '[redacted]',
            apiKey: '[redacted]',
            refresh_token: '[redacted]',
            providerHeaders: '[redacted]',
            accept: 'application/json'
          }
        })
      }
    })
  })

  it('G12 serializes only after the diagnostic payload passes the credential scan', () => {
    const serialized = serializeDiagnosticData({
      conversationId: 'conversation-1',
      token: 'token-secret',
      log: 'Bearer bearer-secret'
    })

    expect(serialized).toContain('conversation-1')
    expect(serialized).not.toContain('token-secret')
    expect(serialized).not.toContain('bearer-secret')
  })
})
