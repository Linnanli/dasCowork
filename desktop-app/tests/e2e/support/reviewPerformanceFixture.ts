import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export const REVIEW_PERFORMANCE_SCHEMA_VERSION = 1
export const REVIEW_PERFORMANCE_SMALL_FILE_COUNTS = [50, 500, 1000] as const
export const REVIEW_PERFORMANCE_LARGE_DIFF_BYTES = 2 * 1024 * 1024

export type ReviewPerformanceSmallFileCount = (typeof REVIEW_PERFORMANCE_SMALL_FILE_COUNTS)[number]

export type ReviewPerformanceFixture = {
  projectRoot: string
  smallFileCount: ReviewPerformanceSmallFileCount
  largeDiffBytes: number
  changedFileCount: number
  fixtureSha256: string
}

export type ReviewPerformanceMetrics = {
  schemaVersion: typeof REVIEW_PERFORMANCE_SCHEMA_VERSION
  fixture: {
    sha256: string
    smallFileCount: ReviewPerformanceSmallFileCount
    largeDiffBytes: number
    changedFileCount: number
  }
  dom: {
    fileBlockCount: number
  }
  renderer: {
    longTasks: {
      count: number
      maxDurationMs: number
      over200msCount: number
      totalBlockingMs: number
    }
    reactCommitCount: number
    reviewMeasuresMs: Record<string, number[]>
  }
  actionDurationsMs: Record<string, number>
}

export async function createReviewPerformanceFixture(
  smallFileCount: ReviewPerformanceSmallFileCount
): Promise<ReviewPerformanceFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), `dascowork-review-perf-${smallFileCount}-`))
  await execFile('git', ['init'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.email', 'e2e@example.test'], { cwd: projectRoot })
  await execFile('git', ['config', 'user.name', 'E2E'], { cwd: projectRoot })

  const smallFilesDir = join(projectRoot, 'small-files')
  await mkdir(smallFilesDir, { recursive: true })
  for (let index = 0; index < smallFileCount; index += 1) {
    const filename = smallFileName(index)
    await writeFile(join(smallFilesDir, filename), smallFileContents(index, 'base'), 'utf8')
  }
  const largeDiffPath = join(projectRoot, 'z-large-diff.txt')
  await writeFile(largeDiffPath, largeDiffContents(REVIEW_PERFORMANCE_LARGE_DIFF_BYTES, 'base'))
  await execFile('git', ['add', '.'], { cwd: projectRoot })
  await execFile('git', ['commit', '-m', `baseline ${smallFileCount} files`], {
    cwd: projectRoot
  })

  for (let index = 0; index < smallFileCount; index += 1) {
    const filename = smallFileName(index)
    await writeFile(join(smallFilesDir, filename), smallFileContents(index, 'changed'), 'utf8')
  }
  await writeFile(largeDiffPath, largeDiffContents(REVIEW_PERFORMANCE_LARGE_DIFF_BYTES, 'changed'))

  const diff = await gitOutput(projectRoot, ['diff', '--no-ext-diff'])
  const fixtureSha256 = createHash('sha256').update(diff).digest('hex')

  return {
    projectRoot,
    smallFileCount,
    largeDiffBytes: REVIEW_PERFORMANCE_LARGE_DIFF_BYTES,
    changedFileCount: smallFileCount + 1,
    fixtureSha256
  }
}

export function buildReviewPerformanceMetrics(input: {
  fixture: ReviewPerformanceFixture
  domFileBlockCount: number
  actionDurationsMs: Record<string, number>
  renderer: ReviewPerformanceMetrics['renderer']
}): ReviewPerformanceMetrics {
  return {
    schemaVersion: REVIEW_PERFORMANCE_SCHEMA_VERSION,
    fixture: {
      sha256: input.fixture.fixtureSha256,
      smallFileCount: input.fixture.smallFileCount,
      largeDiffBytes: input.fixture.largeDiffBytes,
      changedFileCount: input.fixture.changedFileCount
    },
    dom: {
      fileBlockCount: input.domFileBlockCount
    },
    renderer: input.renderer,
    actionDurationsMs: input.actionDurationsMs
  }
}

function smallFileName(index: number): string {
  return `file-${index.toString().padStart(4, '0')}.txt`
}

function smallFileContents(index: number, revision: 'base' | 'changed'): string {
  return [
    `fixture-file=${index.toString().padStart(4, '0')}`,
    `revision=${revision}`,
    `payload=${(index * 17).toString(36).padStart(4, '0')}`
  ].join('\n')
}

function largeDiffContents(bytes: number, revision: 'base' | 'changed'): Buffer {
  return Buffer.alloc(bytes, revision === 'base' ? 'A' : 'B')
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd, maxBuffer: REVIEW_PERFORMANCE_LARGE_DIFF_BYTES * 4 }))
    .stdout
}
