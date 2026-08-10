import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const assetsDirectory = resolve(import.meta.dirname, '..', 'out', 'renderer', 'assets')
const hasPdfWorker =
  existsSync(assetsDirectory) &&
  readdirSync(assetsDirectory).some((file) => /^pdf\.worker(?:\.min)?-[A-Za-z0-9_-]+\.mjs$/u.test(file))

if (!hasPdfWorker) {
  throw new Error('The production renderer bundle is missing the local PDF.js worker asset.')
}

console.log('Verified local PDF.js worker asset in the production renderer bundle.')
