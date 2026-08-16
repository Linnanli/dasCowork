import { execFile as execFileCallback } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'

import {
  attachDiagnostics,
  appRoot,
  cleanupTempDirs,
  closeApp,
  collectRendererLogs,
  launchApp
} from './support/app'
import { createLocalProject, sendComposerMessage } from './support/chatActions'
import {
  applyPatchResponse,
  assistantMessageResponse,
  startMockBackend
} from './support/mockBackend'
import { startLocalSshServer, type LocalSshServer } from './support/local-ssh-server'

const execFile = promisify(execFileCallback)

test('P004-E2E-12/P004-EDGE-03 includes an untracked file in the real review snapshot and stages it', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-untracked-review-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('untracked-review', 'untracked-review-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'new-file.txt'), 'untracked\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Untracked ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Start the untracked file review test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    const operationFeedback = page.locator('[data-testid="local-git-operation-toast"]')
    await expect(panel).toContainText('new-file.txt')
    await panel.getByRole('button', { name: '隐藏文件树', exact: true }).click()
    const fileActions = panel.locator('[data-review-file-header-operation-actions]')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await fileActions.hover()
      await fileActions.getByRole('button', { name: '暂存未暂存文件', exact: true }).click()
      await expect(operationFeedback).toContainText(
        /Changes staged\.|审阅快照已过期，正在自动刷新。/
      )
      if ((await operationFeedback.allTextContents()).join('\n').includes('Changes staged.')) break
      await operationFeedback
        .getByRole('button', { name: 'Dismiss Git operation feedback' })
        .click()
    }
    await expect
      .poll(() => gitOutput(projectRoot, ['diff', '--cached', '--name-only']))
      .toBe('new-file.txt')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-12/P004-EDGE-02 opens an empty repository without a HEAD commit', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-empty-git-review-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('empty-git-review', 'empty-git-review-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await execFile('git', ['init'], { cwd: projectRoot })
    await execFile('git', ['config', 'user.email', 'e2e@example.test'], { cwd: projectRoot })
    await execFile('git', ['config', 'user.name', 'E2E'], { cwd: projectRoot })

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Empty Git ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open an empty Git repository.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await expect(panel).toContainText('No changes to review.')
    await expect(panel.getByRole('button', { name: '刷新更改' })).toBeEnabled()
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-12/P004-EDGE-04/P004-EDGE-05/P004-EDGE-06/P004-EDGE-07/P004-EDGE-08 identifies binary, renamed, copied, type-changed, and gitlink files in the real review panel', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-file-status-review-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('file-status-review', 'file-status-review-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'image.bin'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(projectRoot, 'typed.txt'), 'typed\n', 'utf8')
    await execFile('git', ['add', 'image.bin', 'typed.txt'], { cwd: projectRoot })
    await execFile('git', ['commit', '-m', 'add file forms'], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'image.bin'), Buffer.from([0, 4, 5, 6]))

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 File Status ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open the file status review.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await expect(panel).toContainText('image.bin')
    await expect(panel).toContainText('二进制文件暂不支持文本预览。')

    await execFile('git', ['checkout', '--', 'image.bin'], { cwd: projectRoot })
    await execFile('git', ['mv', 'notes.txt', 'renamed-notes.txt'], { cwd: projectRoot })
    await copyFile(join(projectRoot, 'renamed-notes.txt'), join(projectRoot, 'copied-notes.txt'))
    await execFile('git', ['add', 'copied-notes.txt'], { cwd: projectRoot })
    const typedBlob = (
      await execFile('git', ['hash-object', '-w', 'typed.txt'], { cwd: projectRoot })
    ).stdout.trim()
    await execFile('git', ['update-index', '--cacheinfo', `120000,${typedBlob},typed.txt`], {
      cwd: projectRoot
    })
    const head = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim()
    await execFile(
      'git',
      ['update-index', '--add', '--cacheinfo', `160000,${head},vendor/submodule`],
      { cwd: projectRoot }
    )
    await selectReviewSource(page, '已暂存')
    await expect(panel).toContainText('renamed-notes.txt')
    await expect(panel).toContainText('来自 notes.txt')
    await expect(panel).toContainText('copied-notes.txt')
    await expect(panel).toContainText('typed.txt')
    await expect(panel).toContainText('vendor/submodule')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-12 displays the large-diff file summary before rendering a selected file', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-large-diff-review-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('large-diff-review', 'large-diff-review-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'large.txt'), `${'x'.repeat(2 * 1024 * 1024 + 1_024)}\n`)

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Large Diff ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open the large diff review.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await expect(panel).toContainText('large.txt')
    await expect(panel).toContainText('差异内容过大，暂不渲染完整文本。')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-02/P004-E2E-03 stages, unstages, and safely reverts a real working-tree file', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-local-git-actions-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('review-actions', 'review-actions-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'notes.txt'), 'after\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Git Actions ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Start the local Git action test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await panel.getByRole('button', { name: '隐藏文件树', exact: true }).click()
    await expect(panel.getByRole('button', { name: '暂存未暂存文件', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '暂存未暂存文件', exact: true }).click()
    await expect
      .poll(() => gitOutput(projectRoot, ['diff', '--cached', '--name-only']))
      .toBe('notes.txt')

    await selectReviewSource(page, '已暂存')
    await expect(panel).toContainText('notes.txt')
    await panel.getByRole('button', { name: '取消暂存已暂存文件', exact: true }).click()
    await expect.poll(() => gitOutput(projectRoot, ['diff', '--cached', '--name-only'])).toBe('')

    await selectReviewSource(page, '未暂存')
    await expect(
      panel.getByRole('button', { name: '还原未暂存文件更改', exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: '还原未暂存文件更改', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('还原文件更改？')
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('after\n')

    await panel.getByRole('button', { name: '还原未暂存文件更改', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '还原', exact: true }).click()
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('before\n')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-06/P004-EDGE-09/P004-EDGE-12/P004-EDGE-13 keeps the successful index revert and shows a worktree conflict', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-staged-revert-partial-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('partial-revert', 'partial-revert-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'notes.txt'), 'staged\n', 'utf8')
    await execFile('git', ['add', 'notes.txt'], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'notes.txt'), 'worktree drift\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Partial Revert ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Start the staged revert partial-success test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await panel.getByRole('button', { name: '隐藏文件树', exact: true }).click()
    await selectReviewSource(page, '已暂存')
    await expect(
      panel.getByRole('button', { name: '还原已暂存文件更改', exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: '还原已暂存文件更改', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '还原', exact: true }).click()

    await expect(page.locator('[data-testid="local-git-operation-toast"]')).toContainText(
      '已应用：notes.txt'
    )
    await expect(page.locator('[data-testid="local-git-operation-toast"]')).toContainText(
      '冲突：notes.txt'
    )
    await expect.poll(() => gitOutput(projectRoot, ['diff', '--cached', '--name-only'])).toBe('')
    await expect
      .poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8'))
      .toBe('worktree drift\n')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-04/P004-E2E-13 undoes then reapplies a completed turn patch in a real Git repository', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-turn-patch-'))
  const patch = `*** Begin Patch
*** Update File: notes.txt
@@
-before
+after from turn
*** End Patch
`
  const backend = await startMockBackend({
    responses: [
      applyPatchResponse('turn-patch-change', 'turn-patch-call', patch),
      assistantMessageResponse(
        'turn-patch-final',
        'turn-patch-final-message',
        'Turn patch complete'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Turn Patch ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Update notes.txt through a turn patch.')

    const approval = page.locator('[data-slot="server-request-panel"]')
    const approvalAppeared = await approval
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (approvalAppeared) {
      await approval.getByRole('button', { name: '允许一次', exact: true }).click()
    }

    await expect(page.locator('[data-role="assistant"]')).toContainText('Turn patch complete')
    const turnCard = page.locator('[data-slot="turn-diff-entry-unit"]')
    const turnCardHeader = turnCard.locator('[data-slot="card-header"]')
    const turnCardActions = turnCardHeader.locator('[data-slot="card-action"]')
    await expect(turnCardHeader.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    await expect(turnCardHeader.getByRole('button', { name: '审核', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        turnCardHeader.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
        )
      )
      .toBe(3)
    await expect(turnCardActions).toHaveCSS('grid-column-start', '3')
    await expect(turnCardActions).toHaveCSS('grid-row-start', '1')
    await expect
      .poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8'))
      .toBe('after from turn\n')

    await turnCardHeader.getByRole('button', { name: '审核', exact: true }).click()
    const reviewPanel = reviewWorkspace(page)
    await expect(reviewPanel).toBeVisible()
    await expect(reviewPanel).toContainText('上一轮')

    await turnCard.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(turnCard.getByRole('button', { name: '重新应用', exact: true })).toBeEnabled()
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('before\n')

    await turnCard.getByRole('button', { name: '重新应用', exact: true }).click()
    await expect(turnCard.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    await expect
      .poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8'))
      .toBe('after from turn\n')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-18 undoes and reapplies a completed turn patch from a repository subdirectory', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-turn-patch-subdir-'))
  const projectSubdir = join(projectRoot, 'packages/app')
  const patch = `*** Begin Patch
*** Update File: notes.txt
@@
-before
+after from subdir turn
*** End Patch
`
  const backend = await startMockBackend({
    responses: [
      applyPatchResponse('turn-patch-subdir-change', 'turn-patch-subdir-call', patch),
      assistantMessageResponse(
        'turn-patch-subdir-final',
        'turn-patch-subdir-final-message',
        'Subdirectory turn patch complete'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await mkdir(projectSubdir, { recursive: true })
    await writeFile(join(projectSubdir, 'notes.txt'), 'before\n', 'utf8')
    await execFile('git', ['add', 'packages/app/notes.txt'], { cwd: projectRoot })
    await execFile('git', ['commit', '-m', 'add subdir notes'], { cwd: projectRoot })

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(
      page,
      `P004 Turn Patch Subdir ${Date.now().toString(36)}`,
      projectSubdir
    )
    await sendComposerMessage(page, 'Update subdir notes.txt through a turn patch.')

    const approval = page.locator('[data-slot="server-request-panel"]')
    const approvalAppeared = await approval
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (approvalAppeared) {
      await approval.getByRole('button', { name: '允许一次', exact: true }).click()
    }

    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Subdirectory turn patch complete'
    )
    const turnCard = page.locator('[data-slot="turn-diff-entry-unit"]')
    await expect
      .poll(() => readFile(join(projectSubdir, 'notes.txt'), 'utf8'))
      .toBe('after from subdir turn\n')

    await turnCard.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(turnCard.getByRole('button', { name: '重新应用', exact: true })).toBeEnabled()
    await expect.poll(() => readFile(join(projectSubdir, 'notes.txt'), 'utf8')).toBe('before\n')

    await turnCard.getByRole('button', { name: '重新应用', exact: true }).click()
    await expect(turnCard.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    await expect
      .poll(() => readFile(join(projectSubdir, 'notes.txt'), 'utf8'))
      .toBe('after from subdir turn\n')
    await expect
      .poll(() => gitOutput(projectRoot, ['status', '--short', 'packages/app/notes.txt']))
      .toBe('M packages/app/notes.txt')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-20 restores persisted turn batches after a Main-process relaunch', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-turn-patch-relaunch-'))
  const userDataDir = await mkdtemp(join(tmpdir(), 'dascowork-e2e-turn-patch-relaunch-user-data-'))
  const codexHomeDir = await mkdtemp(
    join(tmpdir(), 'dascowork-e2e-turn-patch-relaunch-codex-home-')
  )
  const patch = `*** Begin Patch
*** Update File: notes.txt
@@
-before
+after from persisted turn
*** End Patch
`
  const backend = await startMockBackend({
    responses: [
      applyPatchResponse('turn-patch-relaunch-change', 'turn-patch-relaunch-call', patch),
      assistantMessageResponse(
        'turn-patch-relaunch-final',
        'turn-patch-relaunch-final-message',
        'Persisted turn patch complete'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    const launchOptions = { userDataDir, codexHomeDir, preserveDataDirectories: true }
    app = await launchApp(backend, logs, launchOptions)
    let page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Relaunch ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Update notes.txt through a persisted turn patch.')
    const approval = page.locator('[data-slot="server-request-panel"]')
    const approvalAppeared = await approval
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (approvalAppeared) {
      await approval.getByRole('button', { name: '允许一次', exact: true }).click()
    }
    await expect(page.locator('[data-role="assistant"]')).toContainText(
      'Persisted turn patch complete'
    )
    await expect
      .poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8'))
      .toBe('after from persisted turn\n')

    await closeApp(app)
    app = undefined

    app = await launchApp(backend, logs, launchOptions)
    page = await app.firstWindow()
    collectRendererLogs(page, logs)
    const sidebar = page.locator('[data-slot="codex-sidebar"]')
    await sidebar
      .getByRole('button', { name: /^Update notes\.txt through a persisted turn patch\./ })
      .click()
    const turnCard = page.locator('[data-slot="turn-diff-entry-unit"]').last()
    await expect(turnCard.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()

    await turnCard.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(turnCard.getByRole('button', { name: '重新应用', exact: true })).toBeEnabled()
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('before\n')

    await turnCard.getByRole('button', { name: '重新应用', exact: true }).click()
    await expect(turnCard.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
    await expect
      .poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8'))
      .toBe('after from persisted turn\n')
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot, userDataDir, codexHomeDir])
  }
})

test('P004-E2E-07/P004-E2E-14 starts an inline Code review through the ordinary chat turn', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-inline-code-review-'))
  const reviewResponse = [
    'Inline review complete.',
    '::code-comment{title="[P2] Missing guard" body="Validate the value before use." file="notes.txt" start=1 end=1 priority=2}'
  ].join('\n')
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse(
        'inline-review-start',
        'inline-review-start-message',
        'Thread ready'
      ),
      assistantMessageResponse(
        'inline-review-result',
        'inline-review-result-message',
        reviewResponse
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'notes.txt'), 'after\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Inline Review ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Prepare the inline code review.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    const composerInput = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await composerInput.fill('/review')
    const commandPanel = page.getByRole('listbox', { name: '命令' })
    await expect(commandPanel.getByRole('option', { name: /Code review/ })).toBeVisible()
    await page.keyboard.press('Enter')

    const reviewContent = page.locator('[data-slot="composer-code-review-command-content"]')
    await expect(reviewContent).toBeVisible()
    await reviewContent.getByRole('button', { name: '审查未提交的更改', exact: true }).click()

    const assistant = page
      .locator('[data-role="assistant"]')
      .filter({ hasText: 'Inline review complete.' })
    await expect(assistant).toBeVisible()
    await expect(assistant.locator('[data-slot="review-comments-unit"]')).toContainText(
      'Missing guard'
    )
    await expect(reviewContent).toHaveCount(0)

    const reviewRequest = backend.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url === '/responses' &&
        request.body.includes('## Code review guidelines:')
    )
    expect(reviewRequest).toBeTruthy()
    expect(reviewRequest?.body).toContain('请检查我未提交的更改')
    expect(backend.requests.some((request) => request.url.includes('review/start'))).toBe(false)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-08 starts Code review in an independent new task through the ordinary chat turn', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-new-task-code-review-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('original-task', 'original-task-message', 'Original task ready'),
      assistantMessageResponse('new-task', 'new-task-message', 'New task ready'),
      assistantMessageResponse(
        'new-task-review',
        'new-task-review-message',
        'New-task review complete.'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    await writeFile(join(projectRoot, 'notes.txt'), 'after\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Original Review ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Prepare the original task.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Original task ready')

    const composerInput = page.locator('.aui-lexical-input[contenteditable="true"]').last()
    await composerInput.fill('/new')
    const commandPanel = page.getByRole('listbox', { name: '命令' })
    await expect(commandPanel.getByRole('option', { name: /New chat/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(0)

    await createLocalProject(page, `P004 New Task Review ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Prepare the review in the new task.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('New task ready')

    await composerInput.fill('/review')
    await expect(commandPanel.getByRole('option', { name: /Code review/ })).toBeVisible()
    await page.keyboard.press('Enter')
    const reviewContent = page.locator('[data-slot="composer-code-review-command-content"]')
    await expect(reviewContent).toBeVisible()
    await reviewContent.getByRole('button', { name: '审查未提交的更改', exact: true }).click()

    await expect(
      page.locator('[data-role="assistant"]').filter({ hasText: 'New-task review complete.' })
    ).toBeVisible()
    await expect(reviewContent).toHaveCount(0)
    const reviewRequest = backend.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.url === '/responses' &&
        request.body.includes('## Code review guidelines:')
    )
    expect(reviewRequest).toBeTruthy()
    expect(reviewRequest?.body).toContain('请检查我未提交的更改')
    expect(backend.requests.some((request) => request.url.includes('review/start'))).toBe(false)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-19 commits, pushes, disables clean push, and publishes a new branch through the review menu', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  testInfo.setTimeout(60_000)

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-review-publish-'))
  const remoteRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-review-publish-remote-'))
  const remote = join(remoteRoot, 'remote.git')
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('review-publish', 'review-publish-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    const initialBranch = await gitOutput(projectRoot, ['branch', '--show-current'])
    await execFile('git', ['init', '--bare', remote])
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'notes.txt'), 'publish through dialog\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Publish ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Open Review and publish the current changes.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')
    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    const operationFeedback = page.locator('[data-testid="local-git-operation-toast"]')
    await expect(panel.getByRole('button', { name: '提交或推送', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: '提交或推送', exact: true }).click()

    const dialog = page.locator('[data-slot="commit-or-push-dialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-action="commit"]')).toBeVisible()
    await expect(dialog.locator('[data-action="commit-and-push"]')).toBeVisible()
    await expect(dialog.locator('[data-action="push"]')).toBeEnabled()
    await dialog.getByLabel('提交信息').fill('Commit only from review')
    await dialog.locator('[data-action="commit"]').click()

    await expect(operationFeedback).toContainText(`已提交到 ${initialBranch}。`)
    await expect
      .poll(() => gitOutput(projectRoot, ['log', '-1', '--format=%s']))
      .toBe('Commit only from review')

    await panel.getByRole('button', { name: '提交或推送', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-action="commit"]')).toBeDisabled()
    await expect(dialog.locator('[data-action="push"]')).toBeEnabled()
    await dialog.locator('[data-action="push"]').click()

    await expect(operationFeedback).toContainText(`已推送 ${initialBranch}。`)
    await expect
      .poll(async () => {
        try {
          return await gitOutput(projectRoot, [
            'rev-parse',
            '--abbrev-ref',
            '--symbolic-full-name',
            '@{upstream}'
          ])
        } catch {
          return ''
        }
      })
      .toBe(`origin/${initialBranch}`)
    await expect
      .poll(() => gitOutput(remote, ['log', '-1', '--format=%s', `refs/heads/${initialBranch}`]))
      .toBe('Commit only from review')

    await expect(panel.getByRole('button', { name: '提交或推送', exact: true })).toBeDisabled()

    await writeFile(join(projectRoot, 'notes.txt'), 'publish new branch through dialog\n', 'utf8')
    await expect
      .poll(() => gitOutput(projectRoot, ['status', '--short', 'notes.txt']))
      .toBe('M notes.txt')
    await panel.getByRole('button', { name: '提交或推送', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: initialBranch, exact: true }).click()
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole('button', { name: '新分支', exact: true })
      .click()
    await dialog.getByLabel('新分支名称').fill('feature/published-from-review')
    await dialog.getByLabel('提交信息').fill('Publish from review')
    await dialog.locator('[data-action="commit-and-push"]').click()

    await expect(operationFeedback).toContainText('已推送 feature/published-from-review。')
    await expect
      .poll(() => gitOutput(projectRoot, ['branch', '--show-current']))
      .toBe('feature/published-from-review')
    await expect
      .poll(async () => {
        try {
          return await gitOutput(projectRoot, [
            'rev-parse',
            '--abbrev-ref',
            '--symbolic-full-name',
            '@{upstream}'
          ])
        } catch {
          return ''
        }
      })
      .toBe('origin/feature/published-from-review')
    await expect
      .poll(() =>
        gitOutput(remote, ['log', '-1', '--format=%s', 'refs/heads/feature/published-from-review'])
      )
      .toBe('Publish from review')
    await expect
      .poll(() => gitOutput(remote, ['show', 'refs/heads/feature/published-from-review:notes.txt']))
      .toBe('publish new branch through dialog')

    await expect(panel.getByRole('button', { name: '提交或推送', exact: true })).toBeDisabled()
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot, remoteRoot])
  }
})

test('P004-E2E-05/P004-EDGE-09 refuses an undo after later local edits leave the turn patch stale', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-turn-patch-drift-'))
  const patch = `*** Begin Patch
*** Update File: notes.txt
@@
-before
+after from turn
*** End Patch
`
  const backend = await startMockBackend({
    responses: [
      applyPatchResponse('turn-patch-drift-change', 'turn-patch-drift-call', patch),
      assistantMessageResponse(
        'turn-patch-drift-final',
        'turn-patch-drift-final-message',
        'Turn patch complete'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Turn Drift ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Update notes.txt through a turn patch.')
    const approval = page.locator('[data-slot="server-request-panel"]')
    const approvalAppeared = await approval
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (approvalAppeared) {
      await approval.getByRole('button', { name: '允许一次', exact: true }).click()
    }
    await expect(page.locator('[data-role="assistant"]')).toContainText('Turn patch complete')
    const turnCard = page.locator('[data-slot="turn-diff-entry-unit"]')
    await expect(turnCard.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()

    await writeFile(join(projectRoot, 'notes.txt'), 'manual drift\n', 'utf8')
    await turnCard.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(turnCard.getByRole('alert')).toContainText('Failed to revert changes')
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('manual drift\n')
    await expect(turnCard.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-09/P004-E2E-11/P004-EDGE-11 commits then retries a branch switch in a local-only repository', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-local-branch-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('branch-switch', 'branch-switch-message', 'Thread ready'),
      assistantMessageResponse(
        'generated-commit-message',
        'generated-commit-message-result',
        'Save local branch changes'
      )
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    const originalBranch = await gitOutput(projectRoot, ['branch', '--show-current'])
    await execFile('git', ['branch', 'other'], { cwd: projectRoot })
    await execFile('git', ['checkout', 'other'], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'notes.txt'), 'other branch\n', 'utf8')
    await execFile('git', ['add', 'notes.txt'], { cwd: projectRoot })
    await execFile('git', ['commit', '-m', 'other branch'], { cwd: projectRoot })
    await execFile('git', ['checkout', originalBranch], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'notes.txt'), 'blocked\n', 'utf8')

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, `P004 Branch ${Date.now().toString(36)}`, projectRoot)

    const switcher = page.locator('[data-slot="local-branch-switcher"]')
    await switcher.getByTitle('Switch branch').click()
    await expect(switcher.getByRole('dialog', { name: 'Switch branch' })).toBeVisible()
    await switcher.getByRole('option', { name: /other/ }).click()
    await expect(page.getByRole('dialog')).toContainText('Commit changes to switch branch')
    await page.getByRole('button', { name: 'Commit and switch branch…' }).click()
    const commitDialog = page.locator('[data-slot="commit-or-push-dialog"]')
    await expect(commitDialog.getByLabel('提交信息')).toHaveValue('')
    await commitDialog.getByLabel('提交信息').fill('Save local branch changes')
    await writeFile(join(projectRoot, 'notes.txt'), 'latest blocked\n', 'utf8')
    await writeFile(
      join(projectRoot, 'created-after-commit-dialog.txt'),
      'latest untracked\n',
      'utf8'
    )
    await commitDialog.locator('[data-action="commit"]').click()
    await expect.poll(() => gitOutput(projectRoot, ['branch', '--show-current'])).toBe('other')
    await expect
      .poll(() => gitOutput(projectRoot, ['log', originalBranch, '-1', '--format=%s']))
      .toBe('Save local branch changes')
    await expect
      .poll(() => gitOutput(projectRoot, ['show', `${originalBranch}:notes.txt`]))
      .toBe('latest blocked')
    await expect
      .poll(() =>
        gitOutput(projectRoot, ['show', `${originalBranch}:created-after-commit-dialog.txt`])
      )
      .toBe('latest untracked')

    await sendComposerMessage(page, 'Start the local branch switch test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')
    await expect(switcher).toHaveCount(0)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-10 keeps the branch and working tree when the blocked commit is cancelled or fails', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-local-branch-failure-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('branch-failure', 'branch-failure-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    const originalBranch = await gitOutput(projectRoot, ['branch', '--show-current'])
    await execFile('git', ['branch', 'other'], { cwd: projectRoot })
    await execFile('git', ['checkout', 'other'], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'notes.txt'), 'other branch\n', 'utf8')
    await execFile('git', ['add', 'notes.txt'], { cwd: projectRoot })
    await execFile('git', ['commit', '-m', 'other branch'], { cwd: projectRoot })
    await execFile('git', ['checkout', originalBranch], { cwd: projectRoot })
    await writeFile(join(projectRoot, 'notes.txt'), 'blocked\n', 'utf8')
    await execFile('git', ['config', 'user.name', ''], { cwd: projectRoot })

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(page, 'P004 Branch Failure ' + Date.now().toString(36), projectRoot)

    const switcher = page.locator('[data-slot="local-branch-switcher"]')
    await switcher.getByTitle('Switch branch').click()
    await switcher.getByRole('option', { name: /other/ }).click()
    const blockedDialog = page
      .getByRole('dialog')
      .filter({ hasText: 'Commit changes to switch branch' })
    await expect(blockedDialog).toContainText('Commit changes to switch branch')

    await blockedDialog.getByRole('button', { name: 'Commit and switch branch…' }).click()
    const commitDialog = page.locator('[data-slot="commit-or-push-dialog"]')
    await commitDialog.press('Escape')
    await expect(commitDialog).toHaveCount(0)
    await expect(blockedDialog).toContainText('Commit changes to switch branch')
    await expect
      .poll(() => gitOutput(projectRoot, ['branch', '--show-current']))
      .toBe(originalBranch)
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('blocked\n')

    await page.keyboard.press('Escape')
    await expect(blockedDialog).toHaveCount(0)
    await switcher.getByTitle('Switch branch').click()
    await switcher.getByRole('option', { name: /other/ }).click()
    await expect(blockedDialog).toContainText('Commit changes to switch branch')
    await blockedDialog.getByRole('button', { name: 'Commit and switch branch…' }).click()
    await page.getByLabel('提交信息').fill('must not switch')
    await page.locator('[data-slot="commit-or-push-dialog"] [data-action="commit"]').click()
    await expect(page.locator('[data-testid="local-git-operation-toast"]')).toBeVisible()
    await expect
      .poll(() => gitOutput(projectRoot, ['branch', '--show-current']))
      .toBe(originalBranch)
    await expect.poll(() => readFile(join(projectRoot, 'notes.txt'), 'utf8')).toBe('blocked\n')
    await expect(page.getByLabel('提交信息')).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="commit-or-push-dialog"]')).toHaveCount(0)
    await blockedDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(blockedDialog).toHaveCount(0)

    await sendComposerMessage(page, 'Start the local branch failure test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')
    await expect(switcher).toHaveCount(0)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-16 creates and checks out a local branch through the branch UI', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-local-create-branch-'))
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('local-create-branch', 'local-create-branch-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    const originalBranch = await gitOutput(projectRoot, ['branch', '--show-current'])

    app = await launchApp(backend, logs)
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createLocalProject(
      page,
      `P004 Local Create Branch ${Date.now().toString(36)}`,
      projectRoot
    )

    const switcher = page.locator('[data-slot="local-branch-switcher"]')
    await switcher.getByTitle('Switch branch').click()
    await expect(switcher.getByRole('option', { name: originalBranch })).toBeVisible()
    await switcher.getByRole('button', { name: 'Create and checkout new branch…' }).click()
    const createBranchDialog = page.locator('[data-slot="branch-create-dialog"]')
    await createBranchDialog.getByLabel('Branch name').fill('feature/local-ui-create')
    await createBranchDialog.getByRole('button', { name: 'Create and checkout' }).click()

    await expect
      .poll(() => gitOutput(projectRoot, ['branch', '--show-current']))
      .toBe('feature/local-ui-create')
    await switcher.getByTitle('Switch branch').click()
    await expect(switcher.getByRole('option', { name: 'feature/local-ui-create' })).toBeVisible()

    await sendComposerMessage(page, 'Start the local create branch UI test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')
    await expect(switcher).toHaveCount(0)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot])
  }
})

test('P004-E2E-15 runs remote review, stage, and commit-and-push actions through SSH', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')
  testInfo.setTimeout(60_000)

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-remote-git-review-'))
  const remoteRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-remote-git-review-bare-'))
  const remote = join(remoteRoot, 'remote.git')
  const terminalTracePath = join(remoteRoot, 'terminal-trace.jsonl')
  const commandTracePath = join(remoteRoot, 'command-trace.jsonl')
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('remote-git-review', 'remote-git-review-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined
  let sshServer: LocalSshServer | undefined

  try {
    await initializeGitRepository(projectRoot)
    await execFile('git', ['init', '--bare', remote])
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: projectRoot })
    sshServer = await startLocalSshServer({
      appServerPath: join(appRoot, 'tests/e2e/support/remote-git-app-server.mjs'),
      terminalTracePath,
      commandTracePath
    })

    app = await launchApp(backend, logs, {
      environment: {
        PATH: `${sshServer.sshBinDirectory}:${process.env.PATH ?? ''}`,
        DASCOWORK_E2E_REAL_SSH_PATH: sshServer.realSshPath,
        DASCOWORK_E2E_SSH_CONFIG: sshServer.sshConfigPath,
        DASCOWORK_REMOTE_CODEX_COMMAND: 'codex'
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createRemoteProject(page, `P004 Remote Git ${Date.now().toString(36)}`, projectRoot)

    const operationFeedback = page.locator('[data-testid="local-git-operation-toast"]')
    await sendComposerMessage(page, 'Start the remote Git review test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await writeFile(join(projectRoot, 'notes.txt'), 'remote review change\n', 'utf8')
    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await panel.getByRole('button', { name: '刷新更改', exact: true }).click()
    await expect(panel).toContainText('未提交')
    await expect(panel).toContainText('remote review change')
    await panel.getByRole('button', { name: '隐藏文件树', exact: true }).click()
    const fileActions = panel.locator('[data-review-file-header-operation-actions]')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await fileActions.hover()
      await fileActions.getByRole('button', { name: '暂存未暂存文件', exact: true }).click()
      await expect(operationFeedback).toContainText(
        /Changes staged\.|审阅快照已过期，正在自动刷新。/
      )
      if ((await operationFeedback.allTextContents()).join('\n').includes('Changes staged.')) break
      await operationFeedback
        .getByRole('button', { name: 'Dismiss Git operation feedback' })
        .click()
    }
    await expect(operationFeedback).toContainText('Changes staged.')
    await selectReviewSource(page, '已暂存')
    await expect(panel).toContainText('notes.txt')
    await panel.getByRole('button', { name: '提交或推送', exact: true }).click()
    const publishDialog = page.locator('[data-slot="commit-or-push-dialog"]')
    await expect(publishDialog).toBeVisible()
    await expect(publishDialog.locator('[data-action="commit-and-push"]')).toBeEnabled()
    await publishDialog.getByRole('button', { name: /^(main|master)$/, exact: false }).click()
    await page
      .locator('[data-slot="popover-content"]')
      .getByRole('button', { name: '新分支', exact: true })
      .click()
    await publishDialog.getByLabel('新分支名称').fill('feature/remote-review-published')
    await publishDialog.getByLabel('提交信息').fill('Publish remote Git changes')
    await publishDialog.locator('[data-action="commit-and-push"]').click()
    const publishFeedback = page.locator('[data-testid="local-git-operation-toast"]').filter({
      hasText:
        /正在创建新分支…|正在提交更改…|正在推送提交…|已推送 feature\/remote-review-published。|提交成功，但推送失败：|Git 操作失败。/
    })
    await expect(publishFeedback).toContainText('已推送 feature/remote-review-published。')

    await closeApp(app)
    app = undefined
    await expect
      .poll(() => readFile(join(projectRoot, '.git', 'config'), 'utf8'))
      .toContain(
        '[branch "feature/remote-review-published"]\n\tremote = origin\n\tmerge = refs/heads/feature/remote-review-published'
      )
    await expect
      .poll(() =>
        gitOutput(remote, ['for-each-ref', '--format=%(refname:short):%(subject)', 'refs/heads'])
      )
      .toContain('feature/remote-review-published:Publish remote Git changes')
    await expect
      .poll(() =>
        gitOutput(remote, ['show', 'refs/heads/feature/remote-review-published:notes.txt'])
      )
      .toBe('remote review change')

    await expect.poll(() => sshServer?.authenticatedConnectionCount() ?? 0).toBeGreaterThan(0)
    await expect
      .poll(() => sshServer?.remoteCommands.join('\n') ?? '')
      .toContain("exec 'codex' app-server --listen stdio://")
  } finally {
    await testInfo.attach('remote-command-trace.jsonl', {
      body: await readFile(commandTracePath).catch(() => Buffer.alloc(0)),
      contentType: 'application/x-ndjson'
    })
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await sshServer?.close()
    await backend.close()
    await cleanupTempDirs([projectRoot, remoteRoot])
  }
})

test('P004-E2E-17 recovers remote review data after a post-success transport close', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron E2E runs through Chromium')

  const projectRoot = await mkdtemp(join(tmpdir(), 'dascowork-e2e-remote-git-retry-'))
  const fakeSshDirectory = await mkdtemp(join(tmpdir(), 'dascowork-e2e-fake-ssh-retry-'))
  const sshLogPath = join(fakeSshDirectory, 'ssh.log')
  const crashControlPath = join(fakeSshDirectory, 'crash-next-command')
  const backend = await startMockBackend({
    responses: [
      assistantMessageResponse('remote-git-retry', 'remote-git-retry-message', 'Thread ready')
    ]
  })
  const logs: string[] = []
  let app: ElectronApplication | undefined

  try {
    await initializeGitRepository(projectRoot)
    const originalBranch = await gitOutput(projectRoot, ['branch', '--show-current'])
    await writeFile(join(projectRoot, 'notes.txt'), 'remote retry change\n', 'utf8')
    await symlink(join(appRoot, 'tests/e2e/support/fake-ssh.mjs'), join(fakeSshDirectory, 'ssh'))

    app = await launchApp(backend, logs, {
      environment: {
        PATH: `${fakeSshDirectory}:${process.env.PATH ?? ''}`,
        DASCOWORK_E2E_REMOTE_GIT_APP_SERVER_BIN: join(
          appRoot,
          'tests/e2e/support/remote-git-app-server.mjs'
        ),
        DASCOWORK_E2E_REMOTE_GIT_CRASH_ON_CONTROL_FILE: crashControlPath,
        DASCOWORK_E2E_REMOTE_GIT_SSH_LOG: sshLogPath,
        DASCOWORK_REMOTE_CODEX_COMMAND: 'codex'
      }
    })
    const page = await app.firstWindow()
    collectRendererLogs(page, logs)
    await createRemoteProject(page, `P004 Remote Retry ${Date.now().toString(36)}`, projectRoot)
    await sendComposerMessage(page, 'Start the remote Git retry test.')
    await expect(page.locator('[data-role="assistant"]')).toContainText('Thread ready')

    await openReviewWorkspace(page)
    const panel = reviewWorkspace(page)
    await expect(panel).toContainText('remote retry change')

    await writeFile(crashControlPath, 'crash the next remote command\n', 'utf8')
    await page.getByRole('button', { name: '选择审阅来源', exact: true }).click()
    await expect(page.getByText('远程工作区暂时不可用。', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '选择审阅来源', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: originalBranch, exact: true })).toBeVisible()
    await expect
      .poll(() => readFile(sshLogPath, 'utf8').then((log) => log.trim().split('\n').length))
      .toBeGreaterThanOrEqual(2)
  } finally {
    await attachDiagnostics(testInfo, logs, backend, app)
    await closeApp(app)
    await backend.close()
    await cleanupTempDirs([projectRoot, fakeSshDirectory])
  }
})

function reviewWorkspace(page: Page): Locator {
  return page.locator('[data-slot="review-workspace"]')
}

async function openReviewWorkspace(page: Page): Promise<void> {
  const openWorkspace = page.getByRole('button', { name: '打开工作区', exact: true })
  if (await openWorkspace.isVisible().catch(() => false)) await openWorkspace.click()

  const newTab = page.getByRole('button', { name: 'Open workspace tab', exact: true })
  if (await newTab.isVisible().catch(() => false)) {
    await newTab.click()
    await page.getByRole('menuitem', { name: /^Review/ }).click()
    return
  }

  await page.getByRole('button', { name: /^审阅/ }).click()
}

async function selectReviewSource(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: '选择审阅来源', exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

async function initializeGitRepository(projectRoot: string): Promise<void> {
  await execFile('git', ['init'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.email', 'e2e@example.test'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.name', 'E2E'], { cwd: projectRoot })
  await writeFile(join(projectRoot, 'notes.txt'), 'before\n', 'utf8')
  await execFile('git', ['add', 'notes.txt'], { cwd: projectRoot })
  await execFile('git', ['commit', '-m', 'initial'], { cwd: projectRoot })
}

async function createRemoteProject(page: Page, label: string, path: string): Promise<void> {
  await page.evaluate(
    async ({ projectLabel, remotePath }) => {
      await window.desktopApp.projects.createRemoteProject({
        hostId: 'e2e-remote',
        label: projectLabel,
        remotePath
      })
    },
    { projectLabel: label, remotePath: path }
  )
  await expect(page.locator('[data-slot="composer-project-card"]')).toContainText(label)
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: projectRoot })).stdout.trim()
}
