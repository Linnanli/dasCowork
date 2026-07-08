import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MockBackend } from './mockBackend'

export async function writeStandaloneWebSearchConfig(
  codexHomeDir: string,
  backend: MockBackend
): Promise<void> {
  await writeFile(
    join(codexHomeDir, 'config.toml'),
    `chatgpt_base_url = "${backend.baseUrl}"

[features]
standalone_web_search = true
`,
    'utf8'
  )
}

export async function writeFakeChatGptAuth(codexHomeDir: string): Promise<void> {
  await writeFile(
    join(codexHomeDir, 'auth.json'),
    JSON.stringify(
      {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: {
          id_token: fakeChatGptIdToken(),
          access_token: 'access-chatgpt',
          refresh_token: 'refresh-token',
          account_id: 'e2e-account'
        },
        last_refresh: '2099-01-01T00:00:00Z'
      },
      null,
      2
    ),
    'utf8'
  )
}

function fakeChatGptIdToken(): string {
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT' }),
    base64UrlJson({
      email: 'e2e@example.test',
      'https://api.openai.com/auth': {
        chatgpt_plan_type: 'pro',
        chatgpt_account_id: 'e2e-account'
      }
    }),
    Buffer.from('signature').toString('base64url')
  ].join('.')
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}
