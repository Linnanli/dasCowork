import type { AssistantRenderTarget, AssistantRenderUnit } from '@/lib/assistantRenderUnits'

export function renderUnitAttributes(
  unit: AssistantRenderUnit | undefined
): Record<string, string> | undefined {
  if (!unit) return undefined
  return renderTargetAttributes(unit.target, unit.key)
}

export function renderTargetAttributes(
  target: AssistantRenderTarget,
  key: string
): Record<string, string> {
  return {
    'data-render-unit-key': key,
    'data-render-target-id': target.id,
    'data-render-target-ids': target.itemIds.join(' ')
  }
}
