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

export const projectCreateBlankPayloadSchema = z.object({
  operationId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((name) => name !== '.' && name !== '..', {
      message: 'Project name cannot be "." or ".."'
    })
    .refine((name) => !/[\\/]/.test(name) && !name.includes('\0'), {
      message: 'Project name cannot contain path separators'
    })
})

export const projectCreateRemotePayloadSchema = z.object({
  hostId: z.string().min(1),
  label: z.string().trim().min(1),
  remotePath: z
    .string()
    .trim()
    .min(1)
    .refine(
      (path) => path.startsWith('/') && !path.includes('\0') && !/[\r\n]/u.test(path),
      'Remote project path must be an absolute POSIX path'
    )
})

export const projectRenamePayloadSchema = z.discriminatedUnion('projectKind', [
  z.object({
    projectKind: z.literal('local'),
    projectId: z.string().min(1),
    label: z.string().trim().min(1)
  }),
  z.object({
    projectKind: z.literal('remote'),
    projectId: z.string().min(1),
    label: z.string().trim().min(1)
  }),
  z.object({
    projectKind: z.literal('path'),
    path: z.string().min(1),
    label: z.string().trim().min(1)
  })
])

export const projectSelectPayloadSchema = projectSelectionSchema
