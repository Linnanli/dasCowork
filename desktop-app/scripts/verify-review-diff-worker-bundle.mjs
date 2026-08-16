import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const assetsDirectory = resolve(import.meta.dirname, '..', 'out', 'renderer', 'assets')
const workerFile =
  existsSync(assetsDirectory) &&
  readdirSync(assetsDirectory).find((file) => /^worker-[A-Za-z0-9_-]+\.js$/u.test(file))

if (!workerFile) {
  throw new Error('The production renderer bundle is missing the local Review diff worker asset.')
}

const workerSource = readFileSync(resolve(assetsDirectory, workerFile), 'utf8')
if (!workerSource.includes('pierre-dark')) {
  throw new Error('The local worker asset does not contain the Review diff highlighter runtime.')
}

console.log(`Verified local Review diff worker asset: ${workerFile}`)
