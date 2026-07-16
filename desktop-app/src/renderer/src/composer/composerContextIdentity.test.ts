import { describe, expect, it } from 'vitest'

import { buildComposerContextIdentityIndex } from './composerContextIdentity'

describe('composerContextIdentity', () => {
  it('indexes display and canonical names by URI without deriving missing names from the URI', () => {
    const index = buildComposerContextIdentityIndex([
      {
        id: 'apps',
        items: [
          {
            id: 'app://app_123',
            type: 'app',
            label: 'Slack Workspace',
            metadata: { mentionName: 'slack' }
          },
          { id: 'app://unknown-slug', type: 'app', label: 'Legacy App' }
        ]
      }
    ])

    expect(index.get('app://app_123')).toEqual({
      type: 'app',
      uri: 'app://app_123',
      displayLabel: 'Slack Workspace',
      mentionName: 'slack'
    })
    expect(index.get('app://unknown-slug')).toEqual({
      type: 'app',
      uri: 'app://unknown-slug',
      displayLabel: 'Legacy App'
    })
  })
})
