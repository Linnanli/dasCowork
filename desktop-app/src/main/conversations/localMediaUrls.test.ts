import { describe, expect, it } from 'vitest'

import { normalizeLocalMediaUrls, restoreLocalMediaFileUrlsForModel } from './localMediaUrls'

describe('local media URL normalization', () => {
  it('converts local image and video file URLs without reading their contents', () => {
    const messages = [
      {
        id: 'user-1',
        role: 'user' as const,
        parts: [
          {
            type: 'file' as const,
            mediaType: 'image/*',
            url: 'file:///tmp/codex-clipboard.PNG'
          },
          {
            type: 'file' as const,
            mediaType: 'video/mp4',
            url: 'file:///tmp/demo.mp4'
          }
        ]
      }
    ]

    expect(normalizeLocalMediaUrls(messages, 'linux')).toEqual([
      {
        ...messages[0],
        parts: [
          { ...messages[0]!.parts[0], url: 'app://fs/@fs/tmp/codex-clipboard.PNG' },
          { ...messages[0]!.parts[1], url: 'app://fs/@fs/tmp/demo.mp4' }
        ]
      }
    ])
    expect(messages[0]!.parts[0]!.url).toBe('file:///tmp/codex-clipboard.PNG')
  })

  it('keeps data, blob, remote, and non-media file parts unchanged', () => {
    const parts = [
      { type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,AAEC' },
      { type: 'file' as const, mediaType: 'image/png', url: 'blob:https://app.test/id' },
      { type: 'file' as const, mediaType: 'image/png', url: 'https://example.com/image.png' },
      { type: 'file' as const, mediaType: 'text/plain', url: 'file:///tmp/readme.txt' }
    ]
    const messages = [{ id: 'user-1', role: 'user' as const, parts }]

    expect(normalizeLocalMediaUrls(messages, 'linux')).toEqual(messages)
  })

  it('restores a validated display URL in a separate model-input copy', () => {
    const messages = [
      {
        id: 'user-1',
        role: 'user' as const,
        parts: [
          {
            type: 'file' as const,
            mediaType: 'image/png',
            url: 'app://fs/@fs/tmp/image%20%23%3F%E4%B8%AD%E6%96%87.png'
          }
        ]
      }
    ]

    const restored = restoreLocalMediaFileUrlsForModel(messages, 'linux')

    expect(restored[0]!.parts[0]).toMatchObject({
      url: 'file:///tmp/image%20%23%3F%E4%B8%AD%E6%96%87.png'
    })
    expect(messages[0]!.parts[0]!.url.startsWith('app://fs/')).toBe(true)
  })

  it.each([
    'app://other/@fs/tmp/image.png',
    'app://fs/wrong/tmp/image.png',
    'app://fs/@fs/tmp/%252e%252e/secret.png',
    'app://fs/@fs/tmp/readme.txt'
  ])('rejects invalid app media input: %s', (url) => {
    const messages = [
      {
        id: 'user-1',
        role: 'user' as const,
        parts: [{ type: 'file' as const, mediaType: 'image/png', url }]
      }
    ]

    expect(() => restoreLocalMediaFileUrlsForModel(messages, 'linux')).toThrow(
      'Invalid local media URL in model input'
    )
  })
})
