import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const defaultTestExcludes = ['**/node_modules/**', '**/dist/**', '**/out/**', 'vendors/**']
const realGitTestFiles = [
  'src/main/localGit/GitManager.integration.test.ts',
  'src/main/localGit/LocalBranchService.test.ts',
  'src/main/localGit/LocalCommitService.test.ts',
  'src/main/localGit/LocalPushService.test.ts',
  'src/main/localGit/LocalGitService.integration.test.ts',
  'src/main/localGit/LocalGitService.test.ts',
  'src/main/localGit/reviewSnapshot.test.ts'
]

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...defaultTestExcludes, ...realGitTestFiles]
        }
      },
      {
        extends: true,
        test: {
          name: 'local-git-integration',
          include: realGitTestFiles,
          fileParallelism: false,
          testTimeout: 30_000
        }
      }
    ]
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@renderer': resolve('src/renderer/src')
    }
  }
})
