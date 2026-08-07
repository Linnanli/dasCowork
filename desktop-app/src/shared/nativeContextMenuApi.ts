import { z } from 'zod'

const nativeContextMenuActionSchema = z
  .object({
    type: z.literal('action'),
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(256),
    enabled: z.boolean().optional()
  })
  .strict()

const nativeContextMenuSeparatorSchema = z.object({ type: z.literal('separator') }).strict()

export const nativeContextMenuItemSchema = z.discriminatedUnion('type', [
  nativeContextMenuActionSchema,
  nativeContextMenuSeparatorSchema
])

export type NativeContextMenuItem = z.infer<typeof nativeContextMenuItemSchema>

export const nativeContextMenuRequestSchema = z
  .object({ items: z.array(nativeContextMenuItemSchema).min(1).max(32) })
  .strict()

export type NativeContextMenuRequest = z.infer<typeof nativeContextMenuRequestSchema>

export const nativeContextMenuIpcChannels = {
  show: 'desktop:show-native-context-menu'
} as const

export type DesktopNativeContextMenuApi = {
  show(items: readonly NativeContextMenuItem[]): Promise<string | null>
}
