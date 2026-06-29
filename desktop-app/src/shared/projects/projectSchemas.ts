import { z } from 'zod'

import type { ProjectSelection } from './projectTypes'

export const projectSelectionSchema = z.discriminatedUnion('projectKind', [
  z.object({ projectKind: z.literal('local'), projectId: z.string().min(1) }),
  z.object({
    projectKind: z.literal('remote'),
    projectId: z.string().min(1),
    hostId: z.string().min(1)
  }),
  z.object({
    projectKind: z.literal('path'),
    path: z.string().min(1),
    hostId: z.literal('local').optional()
  }),
  z.object({ projectKind: z.literal('projectless') })
]) satisfies z.ZodType<ProjectSelection>

export const projectCreateLocalPayloadSchema = z.object({
  name: z.string().trim().optional(),
  sourceRoots: z.array(z.string().min(1)).min(1)
})

export const projectSelectPayloadSchema = projectSelectionSchema
