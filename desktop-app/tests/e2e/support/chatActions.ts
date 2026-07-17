import { expect, type Page } from '@playwright/test'
import { appRoot } from './app'

export async function sendMessage(page: Page, message: string): Promise<void> {
  await expect(page.locator('body')).toContainText('qwen3.7-plus')
  await ensureLocalProjectSelected(page)
  await sendComposerMessage(page, message)
}

export async function sendComposerMessage(page: Page, message: string): Promise<void> {
  const input = page.locator('.aui-lexical-input[contenteditable="true"]').last()
  await input.fill(message)
  const sendButton = page.getByRole('button', { name: '发送消息', exact: true })
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
}

export async function ensureLocalProjectSelected(page: Page): Promise<void> {
  await createLocalProject(page, 'E2E Local Project', appRoot)
  await expect(page.locator('[data-slot="composer-project-card"]')).toContainText(
    'E2E Local Project'
  )
}

export async function createLocalProject(page: Page, name: string, root: string): Promise<void> {
  await page.evaluate(
    async ({ projectName, projectRoot }) => {
      await window.desktopApp.projects.createLocalProject({
        name: projectName,
        sourceRoots: [projectRoot]
      })
    },
    { projectName: name, projectRoot: root }
  )
}

export async function expectConversationInAuthoritativeList(
  page: Page,
  title: string
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async (expectedTitle) => {
          const state = await window.desktopApp.conversations.refreshConversationList()
          return (
            !state.error &&
            state.conversations.some(
              (conversation) =>
                conversation.title === expectedTitle || conversation.id === expectedTitle
            )
          )
        }, title),
      { timeout: 15_000 }
    )
    .toBe(true)
}
