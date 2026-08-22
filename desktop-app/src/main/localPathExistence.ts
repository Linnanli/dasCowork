import {
  codexExistingLocalPathsPayloadSchema,
  type CodexExistingLocalPathsPayload,
  type CodexExistingLocalPathsResult
} from '../shared/codexIpcApi'
import { resolveLocalOpenPath } from './localPathOpen'

export type LocalPathStat = (path: string) => Promise<unknown>

export async function listExistingLocalPaths(
  request: CodexExistingLocalPathsPayload,
  stat: LocalPathStat
): Promise<CodexExistingLocalPathsResult> {
  const validatedRequest = codexExistingLocalPathsPayloadSchema.parse(request)
  const checks = await Promise.all(
    validatedRequest.paths.map(async (candidate) => {
      const resolvedPath = resolveLocalOpenPath(candidate)
      try {
        await stat(resolvedPath)
        return candidate
      } catch {
        return undefined
      }
    })
  )

  return { existingPaths: checks.filter(isDefined) }
}

export function createListExistingLocalPathsHandler({ stat }: { stat: LocalPathStat }) {
  return async (_event: unknown, payload: unknown): Promise<CodexExistingLocalPathsResult> =>
    listExistingLocalPaths(codexExistingLocalPathsPayloadSchema.parse(payload), stat)
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
