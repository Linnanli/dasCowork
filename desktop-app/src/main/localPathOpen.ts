import {
  codexOpenLocalPathPayloadSchema,
  type CodexOpenLocalPathPayload
} from '../shared/codexIpcApi'

export type ShellOpenPath = (filePath: string) => Promise<string>

export async function openLocalPath(
  request: CodexOpenLocalPathPayload,
  shellOpenPath: ShellOpenPath
): Promise<void> {
  const error = await shellOpenPath(request.path)
  if (error) throw new Error(error)
}

export function createOpenLocalPathHandler(shellOpenPath: ShellOpenPath) {
  return async (_event: unknown, payload: unknown): Promise<void> => {
    const request = codexOpenLocalPathPayloadSchema.parse(payload)
    await openLocalPath(request, shellOpenPath)
  }
}
