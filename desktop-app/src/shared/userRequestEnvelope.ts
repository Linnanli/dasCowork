export const USER_REQUEST_FOR_CODEX_HEADER = '## My request for Codex:'

/**
 * Appends the user-visible request to internal context using Codex's canonical
 * prompt boundary. The complete result is intended for model input.
 */
export function buildUserRequestEnvelope(context: string, request: string): string {
  const normalizedContext = context.trim()
  if (!normalizedContext) return request

  return [normalizedContext, USER_REQUEST_FOR_CODEX_HEADER, request].join('\n')
}

/**
 * Returns the text shown as the user message while preserving the complete
 * prompt elsewhere. Codex uses the last boundary when nested context exists.
 */
export function extractVisibleUserRequest(text: string): string {
  const sections = text.split(USER_REQUEST_FOR_CODEX_HEADER)
  return sections.length <= 1 ? text : (sections.at(-1) ?? '').trim()
}
